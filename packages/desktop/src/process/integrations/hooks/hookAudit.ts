/**
 * Durable audit log of hook runs (design section 11.6 item 8).
 *
 * One JSON object per line. A record holds lengths and codes only: never stdin, never raw stdout or
 * stderr, never an absolute path (ids are validated against a strict character set). The file rotates
 * once at 1 MiB and keeps a single older file. A broken log never affects a hook outcome.
 */

import { appendFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { SUPPORTED_HOOK_EVENTS } from '@/common/integrations/hooks';
import type { HookAuditEntry, HookRunnerErrorCode } from './hookTypes';

/** Size at which the log rotates. */
export const HOOK_AUDIT_MAX_BYTES = 1024 * 1024;

/** Most records `readRecent` returns. */
export const HOOK_AUDIT_MAX_READ = 200;

/** Codes the registry adds on top of the runner's error codes. */
export type HookAuditErrorCode = HookRunnerErrorCode | 'approval-stale';

/** What callers hand to the log. `pluginId` is the only extra identity allowed besides `hookId`. */
export type HookAuditInput = Omit<HookAuditEntry, 'errorCode'> & {
  errorCode?: HookAuditErrorCode;
  pluginId?: string;
};

const recordSchema = z
  .object({
    ts: z.string().max(40),
    event: z.enum(SUPPORTED_HOOK_EVENTS),
    hookId: z.string().max(80).optional(),
    source: z.enum(['package', 'user', 'workspace']),
    pluginId: z.string().max(128).optional(),
    durationMs: z.number().int().nonnegative(),
    exitCode: z.number().int().nullable(),
    timedOut: z.boolean(),
    decision: z.enum(['deny', 'ask', 'block', 'stop', 'none']),
    stdoutLength: z.number().int().nonnegative(),
    stderrLength: z.number().int().nonnegative(),
    errorCode: z.string().max(40).optional(),
  })
  .strict();

/** One stored line, as returned to the UI. */
export type HookAuditRecord = z.infer<typeof recordSchema>;

export type HookAuditLogOptions = {
  /** Injected path of the JSONL file. */
  filePath: string;
  /** Rotation threshold in bytes. Default 1 MiB. */
  maxBytes?: number;
  now?: () => number;
};

export type HookAuditLog = {
  /** Queues one record. Never rejects. */
  record: (entry: HookAuditInput) => Promise<void>;
  /** Last records, oldest first, at most 200. Unreadable lines are skipped. */
  readRecent: (limit?: number) => Promise<HookAuditRecord[]>;
  /** Resolves when every queued write has finished. */
  flush: () => Promise<void>;
};

const SAFE_ID = /^[A-Za-z0-9._:-]+$/;

const safeId = (value: string | undefined, max: number): string | undefined =>
  value !== undefined && value.length > 0 && value.length <= max && SAFE_ID.test(value) ? value : undefined;

const count = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0);

/** Builds the stored record from an input, copying only whitelisted fields. */
export const toAuditRecord = (entry: HookAuditInput, timestamp: number): HookAuditRecord => {
  const record: HookAuditRecord = {
    ts: new Date(timestamp).toISOString(),
    event: entry.event,
    source: entry.source,
    durationMs: count(entry.durationMs),
    exitCode: Number.isInteger(entry.exitCode) ? entry.exitCode : null,
    timedOut: entry.timedOut === true,
    decision: entry.decision,
    stdoutLength: count(entry.stdoutLength),
    stderrLength: count(entry.stderrLength),
  };
  const hookId = safeId(entry.hookId, 80);
  if (hookId !== undefined) record.hookId = hookId;
  const pluginId = safeId(entry.pluginId, 128);
  if (pluginId !== undefined) record.pluginId = pluginId;
  if (entry.errorCode !== undefined) record.errorCode = entry.errorCode;
  return record;
};

const parseLines = (text: string): HookAuditRecord[] => {
  const records: HookAuditRecord[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed = recordSchema.safeParse(JSON.parse(line));
      if (parsed.success) records.push(parsed.data);
    } catch {
      // A torn or foreign line is skipped.
    }
  }
  return records;
};

const readOrEmpty = async (file: string): Promise<string> => {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
};

/** Creates the audit log for one file. */
export const createHookAuditLog = (options: HookAuditLogOptions): HookAuditLog => {
  const { filePath } = options;
  const maxBytes = Math.max(256, options.maxBytes ?? HOOK_AUDIT_MAX_BYTES);
  const now = options.now ?? Date.now;
  const rotated = `${filePath}.1`;
  let queue: Promise<void> = Promise.resolve();

  const write = async (line: string): Promise<void> => {
    await mkdir(path.dirname(filePath), { recursive: true });
    let size = 0;
    try {
      size = (await stat(filePath)).size;
    } catch {
      size = 0;
    }
    if (size > 0 && size + Buffer.byteLength(line) > maxBytes) {
      await rm(rotated, { force: true });
      await rename(filePath, rotated);
    }
    await appendFile(filePath, line, 'utf8');
  };

  return {
    record: (entry) => {
      const line = `${JSON.stringify(toAuditRecord(entry, now()))}\n`;
      queue = queue.then(() => write(line)).catch((): void => undefined);
      return queue;
    },
    readRecent: async (limit = 50) => {
      await queue;
      const wanted = Math.min(HOOK_AUDIT_MAX_READ, Math.max(1, Math.trunc(Number.isFinite(limit) ? limit : 50)));
      const current = parseLines(await readOrEmpty(filePath));
      const records = current.length >= wanted ? current : [...parseLines(await readOrEmpty(rotated)), ...current];
      return records.slice(-wanted);
    },
    flush: async () => {
      await queue;
    },
  };
};
