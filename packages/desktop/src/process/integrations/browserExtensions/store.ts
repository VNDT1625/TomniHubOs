/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main-owned memory of the extension host (docs/platform/repotopackage-design.md section 12.2):
 * - the generated public key of each package + connection that has no key of its own, so its extension id stays
 *   the same across updates and re-enabling;
 * - which extensions are loaded on purpose (Electron forgets them at exit), with the last load error.
 *
 * Failing closed: a missing or corrupt file means "nothing is loaded". A lost key only means a new id for an
 * extension that had a generated one. Records that fail validation are dropped. The renderer never touches this.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const SEGMENT = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const MAX_RECORDS = 2_000;

const keySchema = z
  .object({
    packageId: z.string().regex(SEGMENT),
    connectionId: z.string().regex(SEGMENT),
    publicKey: z
      .string()
      .min(1)
      .max(1000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();

const loadedSchema = z
  .object({
    packageId: z.string().regex(SEGMENT),
    connectionId: z.string().regex(SEGMENT),
    extensionId: z.string().regex(/^[a-p]{32}$/),
    name: z.string().max(200).optional(),
    version: z.string().max(64).optional(),
    lastError: z.string().max(500).optional(),
    /** Header surfaces from the connection; missing means none. The reader normalises unknown names. */
    surfaces: z.array(z.string().max(32)).max(8).optional(),
    /** Site access from the manifest, and the optional site access the extension may ask for later. */
    siteAccess: z.array(z.string().max(500)).max(100).optional(),
    optionalSiteAccess: z.array(z.string().max(500)).max(100).optional(),
    /** Toolbar icon as a data URL of a raster image, read from the working copy when the extension is loaded. */
    iconDataUrl: z
      .string()
      .max(100_000)
      .regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/u)
      .optional(),
  })
  .strict();

export type GeneratedKeyRecord = z.infer<typeof keySchema>;
export type LoadedExtensionRecord = z.infer<typeof loadedSchema>;

const fileSchema = z.object({
  schemaVersion: z.literal(1),
  keys: z.array(z.unknown()).max(MAX_RECORDS),
  loaded: z.array(z.unknown()).max(MAX_RECORDS),
});

export type ExtensionStore = Readonly<{
  initialize: () => Promise<void>;
  getKey: (packageId: string, connectionId: string) => string | undefined;
  setKey: (packageId: string, connectionId: string, publicKey: string) => Promise<void>;
  getLoaded: (packageId: string, connectionId: string) => LoadedExtensionRecord | undefined;
  listLoaded: () => LoadedExtensionRecord[];
  saveLoaded: (record: LoadedExtensionRecord) => Promise<void>;
  removeLoaded: (packageId: string, connectionId: string) => Promise<void>;
}>;

const keyOf = (packageId: string, connectionId: string): string => `${packageId}\u0000${connectionId}`;

export const createExtensionStore = (filePath: string): ExtensionStore => {
  const keys = new Map<string, GeneratedKeyRecord>();
  const loaded = new Map<string, LoadedExtensionRecord>();
  let writes: Promise<void> = Promise.resolve();

  const persist = (): Promise<void> => {
    const snapshot = JSON.stringify(
      { schemaVersion: 1, keys: [...keys.values()], loaded: [...loaded.values()] },
      null,
      2
    );
    const task = writes.then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporary, snapshot, 'utf8');
      await rename(temporary, filePath);
    });
    writes = task.catch((): undefined => undefined);
    return task;
  };

  return {
    initialize: async () => {
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(filePath, 'utf8'));
      } catch {
        return;
      }
      const parsed = fileSchema.safeParse(raw);
      if (!parsed.success) return;
      for (const item of parsed.data.keys) {
        const record = keySchema.safeParse(item);
        if (record.success) keys.set(keyOf(record.data.packageId, record.data.connectionId), record.data);
      }
      for (const item of parsed.data.loaded) {
        const record = loadedSchema.safeParse(item);
        if (record.success) loaded.set(keyOf(record.data.packageId, record.data.connectionId), record.data);
      }
    },
    getKey: (packageId, connectionId) => keys.get(keyOf(packageId, connectionId))?.publicKey,
    setKey: async (packageId, connectionId, publicKey) => {
      keys.set(keyOf(packageId, connectionId), keySchema.parse({ packageId, connectionId, publicKey }));
      await persist();
    },
    getLoaded: (packageId, connectionId) => {
      const record = loaded.get(keyOf(packageId, connectionId));
      return record ? { ...record } : undefined;
    },
    listLoaded: () => Array.from(loaded.values(), (record) => Object.assign({}, record)),
    saveLoaded: async (record) => {
      const valid = loadedSchema.parse(record);
      loaded.set(keyOf(valid.packageId, valid.connectionId), valid);
      await persist();
    },
    removeLoaded: async (packageId, connectionId) => {
      if (loaded.delete(keyOf(packageId, connectionId))) await persist();
    },
  };
};
