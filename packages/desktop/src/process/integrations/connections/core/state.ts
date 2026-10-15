/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Durable, Main-owned state of every connection of every installed package (docs/platform/repotopackage-design.md
 * section 6.5). A connection is switched off until the user turns it on; this store is the only place that
 * records otherwise. The renderer reads it through IPC and never writes it directly.
 *
 * Failing closed: a missing, unreadable or corrupt file is treated as "nothing is enabled", and a record that
 * fails validation is dropped, so damage can only ever switch connections off.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const CONNECTION_STATUSES = ['off', 'on', 'needs-input', 'unsupported', 'error'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

const PACKAGE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SHA256_HEX = /^sha256-[a-f0-9]{64}$/;
const MAX_RECORDS = 5_000;

const recordSchema = z
  .object({
    packageId: z.string().regex(PACKAGE_ID),
    packageVersion: z.string().min(1).max(64),
    /** `${kind}:${id}`, or `skill:${path}`. */
    connectionKey: z.string().min(3).max(300),
    enabled: z.boolean(),
    status: z.enum(CONNECTION_STATUSES),
    reason: z.string().max(500).optional(),
    /** SHA-256 of what the user approved; a change in the approved content invalidates the approval. */
    approvalHash: z.string().regex(SHA256_HEX).optional(),
    approvedAt: z.number().int().nonnegative().optional(),
    lastError: z.string().max(500).optional(),
    /** Names the host installed in its target store, so disabling removes exactly those. */
    installed: z.array(z.string().min(1).max(300)).max(500).optional(),
    /**
     * Code-running kinds only. When true, the connection is enabled again at the next start without a prompt, provided
     * its approval hash still matches the current content. Absent (older files) means false.
     */
    autoStart: z.boolean().optional(),
  })
  .strict()
  .refine((record) => !record.enabled || record.status === 'on' || record.status === 'error', {
    message: 'an enabled connection must be on or in error',
  });

export type InstalledConnectionState = z.infer<typeof recordSchema>;

/** Version 1 files (no `autoStart`) are read as they are; every save writes version 2. */
const fileSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  records: z.array(z.unknown()).max(MAX_RECORDS),
});

export type ConnectionStateStore = Readonly<{
  initialize: () => Promise<void>;
  /** All records, or those of one package. Returns copies. */
  list: (packageId?: string) => InstalledConnectionState[];
  get: (packageId: string, connectionKey: string) => InstalledConnectionState | undefined;
  save: (state: InstalledConnectionState) => Promise<void>;
  /** Replaces every record of a package at once (install, update). */
  replaceForPackage: (packageId: string, states: readonly InstalledConnectionState[]) => Promise<void>;
  removePackage: (packageId: string) => Promise<void>;
}>;

const keyOf = (packageId: string, connectionKey: string): string => `${packageId}\u0000${connectionKey}`;

export const parseConnectionState = (value: unknown): InstalledConnectionState | undefined => {
  const parsed = recordSchema.safeParse(value);
  // A record from an older file has no autoStart: it reads as false, the only value that restarts nothing.
  return parsed.success ? { ...parsed.data, autoStart: parsed.data.autoStart === true } : undefined;
};

export const createJsonConnectionStateStore = (filePath: string): ConnectionStateStore => {
  const records = new Map<string, InstalledConnectionState>();
  let writes: Promise<void> = Promise.resolve();

  const persist = (): Promise<void> => {
    const snapshot = JSON.stringify({ schemaVersion: 2, records: [...records.values()] }, null, 2);
    const task = writes.then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporary, snapshot, 'utf8');
      await rename(temporary, filePath);
    });
    // A failed write must not poison later writes, but the caller still sees the failure.
    writes = task.catch((): undefined => undefined);
    return task;
  };

  const mutate = async (change: () => void): Promise<void> => {
    const before = new Map(records);
    change();
    try {
      await persist();
    } catch (error) {
      records.clear();
      for (const [key, value] of before) records.set(key, value);
      throw error;
    }
  };

  return {
    initialize: async () => {
      records.clear();
      let text: string;
      try {
        text = await readFile(filePath, 'utf8');
      } catch {
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return;
      }
      const file = fileSchema.safeParse(raw);
      if (!file.success) return;
      for (const item of file.data.records) {
        const record = parseConnectionState(item);
        if (record) records.set(keyOf(record.packageId, record.connectionKey), record);
      }
    },
    list: (packageId) =>
      [...records.values()]
        .filter((record) => packageId === undefined || record.packageId === packageId)
        .map((record) => structuredClone(record)),
    get: (packageId, connectionKey) => {
      const record = records.get(keyOf(packageId, connectionKey));
      return record ? structuredClone(record) : undefined;
    },
    save: async (state) => {
      const record = recordSchema.parse(state);
      await mutate(() => {
        records.set(keyOf(record.packageId, record.connectionKey), record);
      });
    },
    replaceForPackage: async (packageId, states) => {
      const parsed = states.map((state) => recordSchema.parse(state));
      if (parsed.some((record) => record.packageId !== packageId)) {
        throw new Error('Connection state belongs to a different package.');
      }
      await mutate(() => {
        for (const [key, record] of records) if (record.packageId === packageId) records.delete(key);
        for (const record of parsed) records.set(keyOf(record.packageId, record.connectionKey), record);
      });
    },
    removePackage: async (packageId) => {
      await mutate(() => {
        for (const [key, record] of records) if (record.packageId === packageId) records.delete(key);
      });
    },
  };
};
