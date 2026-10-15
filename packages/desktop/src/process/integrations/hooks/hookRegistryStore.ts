/**
 * Durable state of the hook registry: user hooks, switches, workspace consent and content-pinned
 * approvals, in one JSON file written atomically (temporary file, then rename).
 *
 * Fail closed: a missing, unreadable or corrupt file is an empty state, so no hook is approved; a
 * record that fails strict validation is dropped on its own. Damage can only switch hooks off.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { HOOK_LIMITS, isKnownEvent, type KnownHookEventName } from '@/common/integrations/hooks';
import type { HookSource } from './hookTypes';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_USER_HOOKS = 256;
const MAX_CONSENTS = 256;
const MAX_APPROVALS = 5000;
const HOOK_ID = /^[a-f0-9]{64}$/;
const HASH = /^sha256-[a-f0-9]{64}$/;

/** A user hook as stored. The id is recomputed from the content, never stored. */
export type UserHookRecord = {
  event: KnownHookEventName;
  matcher?: string;
  command: string;
  args?: string[];
  timeoutSec: number;
};

/** A content-pinned approval. `enabled` is the on/off switch of that hook; `staleAt` marks an auto-disable. */
export type StoredApproval = { hash: string; approvedAt: number; enabled: boolean; staleAt?: number };

export type HookStoreState = {
  disableAll: boolean;
  sourceEnabled: Record<HookSource, boolean>;
  userHooks: UserHookRecord[];
  /** Normalized real paths of workspaces the user allowed. */
  consents: string[];
  approvals: Map<string, StoredApproval>;
};

export type HookStoreLoadReport = { corrupt: boolean; droppedRecords: number };

/** Filesystem seam so tests can inject failures. */
export type HookStoreIo = {
  readFile: (file: string) => Promise<string>;
  writeFile: (file: string, data: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
  rm: (file: string) => Promise<void>;
};

const defaultIo: HookStoreIo = {
  readFile: (file) => readFile(file, 'utf8'),
  writeFile: (file, data) => writeFile(file, data, 'utf8'),
  rename,
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
  rm: (file) => rm(file, { force: true }),
};

export const userHookRecordSchema = z
  .object({
    event: z.string().refine((value): value is KnownHookEventName => isKnownEvent(value)),
    matcher: z.string().max(1000).optional(),
    command: z.string().min(1).max(HOOK_LIMITS.commandMaxLength),
    args: z.array(z.string().max(HOOK_LIMITS.argMaxLength)).max(HOOK_LIMITS.argsMaxCount).optional(),
    timeoutSec: z.number().min(HOOK_LIMITS.timeoutMinSec).max(HOOK_LIMITS.timeoutMaxSec),
  })
  .strict();

const approvalSchema = z
  .object({
    hash: z.string().regex(HASH),
    approvedAt: z.number().int().nonnegative(),
    enabled: z.boolean(),
    staleAt: z.number().int().nonnegative().optional(),
  })
  .strict();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** An absent switch keeps its default; a present but invalid one fails closed (off). */
const readSwitch = (value: unknown, defaultValue: boolean): boolean =>
  value === undefined ? defaultValue : typeof value === 'boolean' ? value : false;

/** The empty state: nothing approved, nothing consented, every switch at its default. */
export const emptyHookStoreState = (): HookStoreState => ({
  disableAll: false,
  sourceEnabled: { package: true, user: true, workspace: true },
  userHooks: [],
  consents: [],
  approvals: new Map(),
});

const cloneState = (state: HookStoreState): HookStoreState => ({
  disableAll: state.disableAll,
  sourceEnabled: { ...state.sourceEnabled },
  userHooks: state.userHooks.map((record) => ({ ...record, ...(record.args ? { args: [...record.args] } : {}) })),
  consents: [...state.consents],
  approvals: new Map([...state.approvals].map(([id, approval]) => [id, { ...approval }])),
});

const parseState = (value: unknown): { state: HookStoreState; dropped: number } | undefined => {
  if (!isRecord(value) || value.schemaVersion !== 1) return undefined;
  const state = emptyHookStoreState();
  let dropped = 0;

  // A present but non-boolean "disableAll" fails closed (everything off).
  state.disableAll = value.disableAll === undefined ? false : value.disableAll !== false;
  const sources = isRecord(value.sources) ? value.sources : {};
  for (const source of ['package', 'user', 'workspace'] as const) {
    state.sourceEnabled[source] = readSwitch(sources[source], true);
  }

  if (Array.isArray(value.userHooks)) {
    for (const raw of value.userHooks.slice(0, MAX_USER_HOOKS)) {
      const parsed = userHookRecordSchema.safeParse(raw);
      if (parsed.success) state.userHooks.push(parsed.data as UserHookRecord);
      else dropped += 1;
    }
  }
  if (Array.isArray(value.consents)) {
    for (const raw of value.consents.slice(0, MAX_CONSENTS)) {
      if (typeof raw === 'string' && raw.length > 0 && raw.length <= 1024) state.consents.push(raw);
      else dropped += 1;
    }
  }
  if (isRecord(value.approvals)) {
    for (const [id, raw] of Object.entries(value.approvals).slice(0, MAX_APPROVALS)) {
      const parsed = approvalSchema.safeParse(raw);
      if (HOOK_ID.test(id) && parsed.success) state.approvals.set(id, parsed.data as StoredApproval);
      else dropped += 1;
    }
  }
  return { state, dropped };
};

const serialize = (state: HookStoreState): string =>
  JSON.stringify(
    {
      schemaVersion: 1,
      disableAll: state.disableAll,
      sources: state.sourceEnabled,
      userHooks: state.userHooks,
      consents: state.consents,
      approvals: Object.fromEntries(state.approvals),
    },
    null,
    2
  );

export type HookRegistryStore = {
  /** Reads the file. Never throws; damage yields the empty state. */
  load: () => Promise<HookStoreLoadReport>;
  /** The current state. Treat as read-only; change it through `update`. */
  state: () => HookStoreState;
  /** Applies `mutate` to a copy, writes it atomically, and only then makes it current. Rejects if the write fails. */
  update: (mutate: (draft: HookStoreState) => void) => Promise<void>;
};

/** Creates the store for one file. */
export const createHookRegistryStore = (filePath: string, io: HookStoreIo = defaultIo): HookRegistryStore => {
  let current = emptyHookStoreState();
  let queue: Promise<void> = Promise.resolve();
  let counter = 0;

  const writeAtomic = async (text: string): Promise<void> => {
    await io.mkdir(path.dirname(filePath));
    counter += 1;
    const temporary = `${filePath}.${process.pid}.${counter}.tmp`;
    try {
      await io.writeFile(temporary, text);
      await io.rename(temporary, filePath);
    } catch (error) {
      await io.rm(temporary).catch((): void => undefined);
      throw error;
    }
  };

  return {
    load: async () => {
      let text: string;
      try {
        text = await io.readFile(filePath);
      } catch (error) {
        current = emptyHookStoreState();
        const missing = typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
        return { corrupt: !missing, droppedRecords: 0 };
      }
      try {
        if (text.length > MAX_FILE_BYTES) throw new Error('too large');
        const parsed = parseState(JSON.parse(text));
        if (!parsed) throw new Error('bad schema');
        current = parsed.state;
        return { corrupt: false, droppedRecords: parsed.dropped };
      } catch {
        current = emptyHookStoreState();
        // Keep the damaged file for diagnosis; the next save replaces the original.
        await io.rename(filePath, `${filePath}.corrupt`).catch((): void => undefined);
        return { corrupt: true, droppedRecords: 0 };
      }
    },
    state: () => current,
    update: (mutate) => {
      const task = queue.then(async () => {
        const draft = cloneState(current);
        mutate(draft);
        await writeAtomic(serialize(draft));
        current = draft;
      });
      queue = task.catch((): void => undefined);
      return task;
    },
  };
};
