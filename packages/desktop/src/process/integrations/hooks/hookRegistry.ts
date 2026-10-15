/**
 * HookRegistry: the three hook sources (package, user, workspace), content-pinned approval, switches
 * and parallel execution (repotopackage design sections 9.4 and 11).
 *
 * Execution path contract (AGENTS.md section 6):
 * - identity: a stable id per hook plus its source; package hooks also carry the package id;
 * - capabilities: hooks never grant anything and never act as a guard; results are merged with
 *   `mergeDecisions`, where "allow" cannot be represented;
 * - approval: per hook, pinned to the content of the script. Main computes the hash itself; a hash
 *   sent by the renderer is only compared against it. Any difference auto-disables the hook, at load
 *   and again right before each run;
 * - secrets: no secret is handled here; the runner builds a minimal child environment;
 * - network: not restricted on Windows in v1 (shown in the approval lines);
 * - limits: the runner's timeout, output caps and app-wide concurrency limiter;
 * - audit: one lengths-only line per run, plus a line when a hook is auto-disabled.
 *
 * TOCTOU: after the hash check at the top of `executeOne`, the runner re-checks right before the spawn
 * (after path planning and after the concurrency slot): `beforeSpawn` re-computes the pinning hash and the
 * runner hashes the real path of the script against the approved digest. A change switches the hook off.
 * What remains is the few microseconds between that last read and the operating system opening the file.
 */

/* oxlint-disable no-await-in-loop -- hashing and settings files are read one at a time to keep memory and handle use bounded */

import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  evaluateMatcher,
  isSupportedEvent,
  mergeDecisions,
  parseHooksConfig,
  type HookEventName,
  type HookHandler,
  type HookResult,
} from '@/common/integrations/hooks';
import { createHookAuditLog, type HookAuditLog, type HookAuditRecord } from './hookAudit';
import {
  buildDescribeLines,
  computeHookId,
  computeHookPinning,
  redactHookPaths,
  type HookDescribeLine,
  type HookPinContext,
} from './hookPinning';
import {
  createHookRegistryStore,
  userHookRecordSchema,
  type HookRegistryStore,
  type HookStoreIo,
  type HookStoreLoadReport,
  type HookStoreState,
  type UserHookRecord,
} from './hookRegistryStore';
import { runHook } from './hookRunner';
import type {
  HookAuditEntry,
  HookInterpreterResolver,
  HookLimiter,
  HookRunnerErrorCode,
  HookRunnerInput,
  HookSource,
} from './hookTypes';

const PACKAGE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const MAX_PACKAGE_HOOKS = 256;
const MAX_SETTINGS_BYTES = 1024 * 1024;
const WORKSPACE_SETTINGS_FILES = ['settings.json', 'settings.local.json'] as const;
const TOOL_EVENTS: ReadonlySet<HookEventName> = new Set<HookEventName>([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
]);

/** Why a hook is or is not runnable. Stable codes; the UI translates them. */
export type HookStatus =
  | 'ready'
  | 'needs-approval'
  | 'needs-consent'
  | 'stale'
  | 'disabled'
  | 'unsupported'
  | 'forbidden';

/** A hook as the registry holds it. Main-only: it carries real paths and must never reach the renderer. */
export type HookEntry = {
  /** SHA-256 hex of source, scope, event, matcher, command and args. */
  id: string;
  source: HookSource;
  pluginId?: string;
  pluginRoot?: string;
  pluginData?: string;
  workspaceDir?: string;
  handler: HookHandler;
  enabled: boolean;
  approval?: { hash: string; approvedAt: number };
};

/** A hook handed over by the package host (task T3.4). */
export type PackageHookInput = { handler: HookHandler; pluginRoot: string; pluginData?: string };

/** Sanitized hook for the renderer: no real paths and no hash. */
export type HookView = {
  id: string;
  source: HookSource;
  pluginId?: string;
  event: string;
  matcher?: string;
  form: HookHandler['form'];
  command: string;
  args?: string[];
  timeoutSec: number;
  status: HookStatus;
  statusReason?: string;
  enabled: boolean;
  approved: boolean;
  approvedAt?: number;
  /** True when the hook would run now (ready, and neither the global nor its source switch is off). */
  active: boolean;
};

export type HookSwitches = { disableAll: boolean; sources: Record<HookSource, boolean> };

export type HookRegistryErrorCode =
  | 'HOOK_NOT_FOUND'
  | 'HOOK_UNSUPPORTED'
  | 'HOOK_FORBIDDEN'
  | 'HOOK_NEEDS_CONSENT'
  | 'HOOK_HASH_MISMATCH'
  | 'HOOK_APPROVAL_REQUIRED'
  | 'HOOK_INVALID'
  | 'HOOK_STORE_FAILED';

export type HookRegistryResult =
  | { ok: true; hook: HookView }
  | { ok: false; code: HookRegistryErrorCode; message: string };

/** What the approval dialog shows, plus the hash the caller must send back to approve. */
export type HookDescription = { lines: HookDescribeLine[]; hash: string };

export type WorkspaceHooksIssue = { file: string; code: string; message: string };

export type WorkspaceHooksResult = { consented: boolean; hooks: HookView[]; issues: WorkspaceHooksIssue[] };

/** Per-run inputs. The test seams mirror those of `runHook`. */
export type HookRunContext = {
  /** Session workspace: selects workspace hooks and is the working directory. */
  workspaceDir?: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  resolveInterpreter?: HookInterpreterResolver;
};

/** Sanitized outcome of one hook: no stdin, no raw stdout or stderr. */
export type HookRunReport = {
  hookId: string;
  source: HookSource;
  pluginId?: string;
  ok: boolean;
  errorCode?: HookRunnerErrorCode | 'approval-stale';
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  result: HookResult;
};

export type HookRunSummary = { merged: HookResult; perHook: HookRunReport[]; warnings: string[] };

export type HookRegistryOptions = {
  /** Injected path of the registry state file, for example `<userData>/hooks/user-hooks.json`. */
  storeFilePath: string;
  /** Injected path of the audit JSONL file. */
  auditFilePath: string;
  /** Concurrency gate shared with other hook callers. Defaults to the app-wide limiter. */
  limiter?: HookLimiter;
  now?: () => number;
  auditMaxBytes?: number;
  /** Test seam for the state file's filesystem. */
  storeIo?: HookStoreIo;
};

export type HookRegistry = {
  /** Loads the state file. Must be called once before use. Never throws. */
  initialize: () => Promise<HookStoreLoadReport>;
  registerPackageHooks: (packageId: string, entries: readonly PackageHookInput[]) => Promise<HookView[]>;
  unregisterPackageHooks: (packageId: string, options?: { forgetApprovals?: boolean }) => Promise<void>;
  addUserHook: (input: unknown) => Promise<HookRegistryResult>;
  removeUserHook: (id: string) => Promise<boolean>;
  /** Reads the workspace settings. Hooks stay `needs-consent` and never run until consent is granted. */
  loadWorkspaceHooks: (workspaceDir: string) => Promise<WorkspaceHooksResult>;
  setWorkspaceConsent: (workspaceDir: string, granted: boolean) => Promise<boolean>;
  hasWorkspaceConsent: (workspaceDir: string) => Promise<boolean>;
  listHooks: (workspaceDir?: string) => Promise<HookView[]>;
  /** Main-only access to one entry (real paths included). */
  getEntry: (id: string) => HookEntry | undefined;
  describeHook: (id: string) => Promise<HookDescription | undefined>;
  approveHook: (id: string, expectedHash: string) => Promise<HookRegistryResult>;
  setHookEnabled: (id: string, enabled: boolean) => Promise<HookRegistryResult>;
  setDisableAll: (disabled: boolean) => Promise<boolean>;
  setSourceEnabled: (source: HookSource, enabled: boolean) => Promise<boolean>;
  getSwitches: () => HookSwitches;
  run: (event: HookEventName, payload: Record<string, unknown>, context?: HookRunContext) => Promise<HookRunSummary>;
  readAudit: (limit?: number) => Promise<HookAuditRecord[]>;
  /** Resolves when pending audit writes are done. */
  flush: () => Promise<void>;
};

/** Internal hook record; `HookEntry` is this plus the approval state. */
type HookBase = {
  id: string;
  source: HookSource;
  pluginId?: string;
  pluginRoot?: string;
  pluginData?: string;
  workspaceDir?: string;
  workspaceKey?: string;
  handler: HookHandler;
};

type Workspace = { key: string; dir: string; bases: HookBase[]; issues: WorkspaceHooksIssue[] };

const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');

const pinContextOf = (base: HookBase): HookPinContext => {
  const context: HookPinContext = { source: base.source };
  if (base.pluginRoot !== undefined) context.pluginRoot = base.pluginRoot;
  if (base.pluginData !== undefined) context.pluginData = base.pluginData;
  if (base.workspaceDir !== undefined) context.workspaceDir = base.workspaceDir;
  return context;
};

const isMatchAll = (matcher: string | undefined): boolean => {
  const trimmed = matcher?.trim() ?? '';
  return trimmed === '' || trimmed === '*';
};

const failure = (code: HookRegistryErrorCode, message: string): HookRegistryResult => ({ ok: false, code, message });

const userBaseOf = (record: UserHookRecord): HookBase => {
  const handler: HookHandler = {
    event: record.event,
    command: record.command,
    timeoutSec: record.timeoutSec,
    form: record.args !== undefined ? 'exec' : 'shell',
    unsupported: !isSupportedEvent(record.event),
  };
  if (record.matcher !== undefined) handler.matcher = record.matcher;
  if (record.args !== undefined) handler.args = [...record.args];
  return { id: computeHookId('user', undefined, handler), source: 'user', handler };
};

const uniqueById = (bases: readonly HookBase[]): HookBase[] => [
  ...new Map(bases.map((base) => [base.id, base])).values(),
];

/** Normalizes a workspace to its real path and a comparison key. Undefined when it is not a directory. */
const resolveWorkspace = async (dir: string): Promise<{ key: string; real: string } | undefined> => {
  try {
    const real = await realpath(path.resolve(dir));
    if (!(await stat(real)).isDirectory()) return undefined;
    const slashed = real.replace(/\\/g, '/').replace(/\/+$/, '');
    return { key: process.platform === 'win32' ? slashed.toLowerCase() : slashed, real };
  } catch {
    return undefined;
  }
};

const readSettingsHooks = async (
  file: string,
  label: string
): Promise<{ handlers: HookHandler[]; issues: WorkspaceHooksIssue[] }> => {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return { handlers: [], issues: [] };
  }
  if (text.length > MAX_SETTINGS_BYTES) {
    return { handlers: [], issues: [{ file: label, code: 'limit-exceeded', message: 'Settings file is too large' }] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      handlers: [],
      issues: [{ file: label, code: 'invalid-config', message: 'Settings file is not valid JSON' }],
    };
  }
  const parsed = parseHooksConfig(raw);
  return {
    handlers: parsed.handlers,
    issues: parsed.issues.map((issue) => ({ file: label, code: issue.code, message: issue.message })),
  };
};

const consentedFor = (base: HookBase, state: HookStoreState): boolean =>
  base.source !== 'workspace' || (base.workspaceKey !== undefined && state.consents.includes(base.workspaceKey));

const report = (base: HookBase, over: Partial<HookRunReport>): HookRunReport => ({
  hookId: base.id,
  source: base.source,
  ...(base.pluginId !== undefined ? { pluginId: base.pluginId } : {}),
  ok: true,
  exitCode: null,
  timedOut: false,
  durationMs: 0,
  result: { blocked: false, warnings: [] },
  ...over,
});

/** Creates a registry. Nothing is read or written until `initialize`. */
export const createHookRegistry = (options: HookRegistryOptions): HookRegistry => {
  const store: HookRegistryStore = createHookRegistryStore(options.storeFilePath, options.storeIo);
  const auditOptions = {
    filePath: options.auditFilePath,
    ...(options.auditMaxBytes ? { maxBytes: options.auditMaxBytes } : {}),
  };
  const audit: HookAuditLog = createHookAuditLog(options.now ? { ...auditOptions, now: options.now } : auditOptions);
  const now = options.now ?? Date.now;
  const packageHooks = new Map<string, HookBase[]>();
  const workspaces = new Map<string, Workspace>();
  let userBases: HookBase[] = [];

  const rebuildUserBases = (): void => {
    userBases = uniqueById(store.state().userHooks.map(userBaseOf));
  };

  const allBases = (): HookBase[] => [
    ...[...packageHooks.values()].flat(),
    ...userBases,
    ...[...workspaces.values()].flatMap((workspace) => workspace.bases),
  ];

  const findBase = (id: string): HookBase | undefined => allBases().find((base) => base.id === id);

  const statusOf = (base: HookBase, state: HookStoreState): { status: HookStatus; reason?: string } => {
    const approval = state.approvals.get(base.id);
    if (base.handler.unsupported) return { status: 'unsupported', reason: 'unsupported-event' };
    if (base.source === 'package' && base.handler.form === 'shell') {
      return { status: 'forbidden', reason: 'package-shell-form' };
    }
    if (!consentedFor(base, state)) return { status: 'needs-consent', reason: 'workspace-consent' };
    if (!approval) return { status: 'needs-approval' };
    if (!approval.enabled) {
      return approval.staleAt !== undefined
        ? { status: 'stale', reason: 'content-changed' }
        : { status: 'disabled', reason: 'switched-off' };
    }
    return { status: 'ready' };
  };

  const viewOf = (base: HookBase): HookView => {
    const state = store.state();
    const approval = state.approvals.get(base.id);
    const { status, reason } = statusOf(base, state);
    const context = pinContextOf(base);
    const view: HookView = {
      id: base.id,
      source: base.source,
      event: base.handler.event,
      form: base.handler.form,
      command: redactHookPaths(base.handler.command, context),
      timeoutSec: base.handler.timeoutSec,
      status,
      enabled: status === 'ready',
      approved: approval !== undefined && status !== 'stale',
      active: status === 'ready' && !state.disableAll && state.sourceEnabled[base.source],
    };
    if (base.pluginId !== undefined) view.pluginId = base.pluginId;
    if (base.handler.matcher !== undefined) view.matcher = base.handler.matcher;
    if (base.handler.args !== undefined) view.args = base.handler.args.map((arg) => redactHookPaths(arg, context));
    if (reason !== undefined) view.statusReason = reason;
    if (approval !== undefined && view.approved) view.approvedAt = approval.approvedAt;
    return view;
  };

  const entryOf = (base: HookBase): HookEntry => {
    const approval = store.state().approvals.get(base.id);
    const entry: HookEntry = {
      id: base.id,
      source: base.source,
      handler: base.handler,
      enabled: approval?.enabled === true,
    };
    if (base.pluginId !== undefined) entry.pluginId = base.pluginId;
    if (base.pluginRoot !== undefined) entry.pluginRoot = base.pluginRoot;
    if (base.pluginData !== undefined) entry.pluginData = base.pluginData;
    if (base.workspaceDir !== undefined) entry.workspaceDir = base.workspaceDir;
    if (approval) entry.approval = { hash: approval.hash, approvedAt: approval.approvedAt };
    return entry;
  };

  const logStale = (base: HookBase): void => {
    if (!isSupportedEvent(base.handler.event)) return;
    void audit.record({
      event: base.handler.event,
      hookId: base.id,
      source: base.source,
      ...(base.pluginId !== undefined ? { pluginId: base.pluginId } : {}),
      durationMs: 0,
      exitCode: null,
      timedOut: false,
      decision: 'none',
      stdoutLength: 0,
      stderrLength: 0,
      errorCode: 'approval-stale',
    });
  };

  /** Switches stale hooks off for good: the user must approve the new content again. */
  const disableStale = async (stale: readonly HookBase[]): Promise<void> => {
    if (stale.length === 0) return;
    for (const base of stale) logStale(base);
    try {
      await store.update((draft) => {
        for (const base of stale) {
          const approval = draft.approvals.get(base.id);
          if (approval) {
            approval.enabled = false;
            approval.staleAt = now();
          }
        }
      });
    } catch {
      // The hooks are still skipped by the caller; only the persisted flag is missing.
    }
  };

  /** Load-time check: every enabled approval must still match the current content. */
  const verifyBases = async (bases: readonly HookBase[]): Promise<void> => {
    const state = store.state();
    const stale: HookBase[] = [];
    for (const base of bases) {
      const approval = state.approvals.get(base.id);
      if (!approval?.enabled) continue;
      const pinning = await computeHookPinning(base.handler, pinContextOf(base));
      if (pinning.hash !== approval.hash) stale.push(base);
    }
    await disableStale(stale);
  };

  const refreshWorkspace = async (workspaceDir: string): Promise<Workspace | undefined> => {
    const resolved = await resolveWorkspace(workspaceDir);
    if (!resolved) return undefined;
    const scope = `ws:${sha256Hex(resolved.key).slice(0, 16)}`;
    const handlers: HookHandler[] = [];
    const issues: WorkspaceHooksIssue[] = [];
    for (const name of WORKSPACE_SETTINGS_FILES) {
      const read = await readSettingsHooks(path.join(resolved.real, '.claude', name), name);
      handlers.push(...read.handlers);
      issues.push(...read.issues);
    }
    const bases = uniqueById(
      handlers.map(
        (handler): HookBase => ({
          id: computeHookId('workspace', scope, handler),
          source: 'workspace',
          workspaceDir: resolved.real,
          workspaceKey: resolved.key,
          handler,
        })
      )
    );
    const workspace: Workspace = { key: resolved.key, dir: resolved.real, bases, issues };
    workspaces.set(resolved.key, workspace);
    if (store.state().consents.includes(resolved.key)) await verifyBases(bases);
    return workspace;
  };

  const registerPackageHooks = async (packageId: string, entries: readonly PackageHookInput[]): Promise<HookView[]> => {
    if (!PACKAGE_ID.test(packageId)) throw new RangeError('Invalid package id');
    const collected: HookBase[] = [];
    for (const entry of entries.slice(0, MAX_PACKAGE_HOOKS)) {
      const base: HookBase = {
        id: computeHookId('package', packageId, entry.handler),
        source: 'package',
        pluginId: packageId,
        pluginRoot: entry.pluginRoot,
        handler: entry.handler,
      };
      if (entry.pluginData !== undefined) base.pluginData = entry.pluginData;
      collected.push(base);
    }
    const bases = uniqueById(collected);
    packageHooks.set(packageId, bases);
    await verifyBases(bases);
    return bases.map(viewOf);
  };

  const unregisterPackageHooks = async (
    packageId: string,
    unregisterOptions?: { forgetApprovals?: boolean }
  ): Promise<void> => {
    const bases = packageHooks.get(packageId) ?? [];
    packageHooks.delete(packageId);
    if (unregisterOptions?.forgetApprovals !== true || bases.length === 0) return;
    try {
      await store.update((draft) => {
        for (const base of bases) draft.approvals.delete(base.id);
      });
    } catch {
      // Approvals are content-pinned, so a leftover record cannot enable anything by itself.
    }
  };

  const guarded = async (action: () => Promise<HookRegistryResult>): Promise<HookRegistryResult> => {
    try {
      return await action();
    } catch {
      return failure('HOOK_STORE_FAILED', 'The hook settings could not be saved');
    }
  };

  const approveHook = (id: string, expectedHash: string): Promise<HookRegistryResult> =>
    guarded(async () => {
      const base = findBase(id);
      if (!base) return failure('HOOK_NOT_FOUND', 'Unknown hook');
      const state = store.state();
      const { status } = statusOf(base, state);
      if (status === 'unsupported') return failure('HOOK_UNSUPPORTED', 'This event is not supported yet');
      if (status === 'forbidden') return failure('HOOK_FORBIDDEN', 'Package hooks must use exec form');
      if (status === 'needs-consent') return failure('HOOK_NEEDS_CONSENT', 'Allow hooks for this workspace first');
      const pinning = await computeHookPinning(base.handler, pinContextOf(base));
      if (typeof expectedHash !== 'string' || expectedHash !== pinning.hash) {
        return failure('HOOK_HASH_MISMATCH', 'The hook changed since it was shown; review it again');
      }
      await store.update((draft) => {
        draft.approvals.set(base.id, { hash: pinning.hash, approvedAt: now(), enabled: true });
      });
      return { ok: true, hook: viewOf(base) };
    });

  const setHookEnabled = (id: string, enabled: boolean): Promise<HookRegistryResult> =>
    guarded(async () => {
      const base = findBase(id);
      if (!base) return failure('HOOK_NOT_FOUND', 'Unknown hook');
      const approval = store.state().approvals.get(id);
      if (enabled) {
        const { status } = statusOf(base, store.state());
        if (status === 'unsupported' || status === 'forbidden' || status === 'needs-consent') {
          return failure(
            status === 'needs-consent' ? 'HOOK_NEEDS_CONSENT' : 'HOOK_FORBIDDEN',
            'This hook cannot be enabled'
          );
        }
        const pinning = await computeHookPinning(base.handler, pinContextOf(base));
        if (!approval || approval.hash !== pinning.hash) {
          return failure('HOOK_APPROVAL_REQUIRED', 'The hook must be approved again');
        }
      } else if (!approval) {
        return { ok: true, hook: viewOf(base) };
      }
      await store.update((draft) => {
        const record = draft.approvals.get(id);
        if (!record) return;
        record.enabled = enabled;
        if (enabled) delete record.staleAt;
      });
      return { ok: true, hook: viewOf(base) };
    });

  const addUserHook = (input: unknown): Promise<HookRegistryResult> =>
    guarded(async () => {
      const parsed = userHookRecordSchema.safeParse(input);
      if (!parsed.success) return failure('HOOK_INVALID', 'The hook definition is not valid');
      const record = parsed.data as UserHookRecord;
      const base = userBaseOf(record);
      if (!userBases.some((existing) => existing.id === base.id)) {
        await store.update((draft) => {
          draft.userHooks.push(record);
        });
        rebuildUserBases();
      }
      return { ok: true, hook: viewOf(base) };
    });

  const removeUserHook = async (id: string): Promise<boolean> => {
    if (!userBases.some((base) => base.id === id)) return false;
    try {
      await store.update((draft) => {
        draft.userHooks = draft.userHooks.filter((record) => userBaseOf(record).id !== id);
        draft.approvals.delete(id);
      });
      rebuildUserBases();
      return true;
    } catch {
      return false;
    }
  };

  const setSwitch = async (mutate: (draft: HookStoreState) => void): Promise<boolean> => {
    try {
      await store.update(mutate);
      return true;
    } catch {
      return false;
    }
  };

  const executeOne = async (
    base: HookBase,
    event: HookEventName,
    payload: Record<string, unknown>,
    context: HookRunContext,
    stale: HookBase[]
  ): Promise<HookRunReport> => {
    const approval = store.state().approvals.get(base.id);
    // Re-hash right before the spawn: the script may have changed since it was approved (TOCTOU).
    const pinning = await computeHookPinning(base.handler, pinContextOf(base));
    if (!approval?.enabled || approval.hash !== pinning.hash) {
      stale.push(base);
      return report(base, {
        ok: false,
        errorCode: 'approval-stale',
        result: { blocked: false, warnings: ['The hook changed since it was approved and was switched off'] },
      });
    }
    // Only a hook that pins exactly one script can name the digest the runner must see on the real path.
    const pinnedDigest = base.handler.form === 'exec' && pinning.files.length === 1 ? pinning.digests[0] : undefined;
    const cwd = base.workspaceDir ?? context.workspaceDir ?? base.pluginRoot ?? os.homedir();
    const placeholders = {
      ...(base.pluginRoot !== undefined ? { pluginRoot: base.pluginRoot } : {}),
      ...(base.pluginData !== undefined ? { pluginData: base.pluginData } : {}),
      ...(base.workspaceDir !== undefined || context.workspaceDir !== undefined
        ? { projectDir: base.workspaceDir ?? context.workspaceDir }
        : {}),
    };
    const input: HookRunnerInput = {
      handler: {
        form: base.handler.form,
        command: base.handler.command,
        timeoutSec: base.handler.timeoutSec,
        ...(base.handler.args !== undefined ? { args: base.handler.args } : {}),
      },
      event,
      payload: { ...payload, hook_event_name: event },
      cwd,
      placeholders,
      source: base.source,
      hookId: base.id,
      ...(pinnedDigest?.startsWith('sha256:') ? { expectedFileSha256: pinnedDigest.slice('sha256:'.length) } : {}),
      beforeSpawn: async () => {
        const current = store.state().approvals.get(base.id);
        if (current?.enabled !== true) return false;
        const again = await computeHookPinning(base.handler, pinContextOf(base));
        return again.hash === current.hash;
      },
      onAudit: (entry: HookAuditEntry) => {
        void audit.record(base.pluginId !== undefined ? { ...entry, pluginId: base.pluginId } : entry);
      },
      ...(options.limiter ? { limiter: options.limiter } : {}),
      ...(context.signal ? { signal: context.signal } : {}),
      ...(context.env ? { env: context.env } : {}),
      ...(context.resolveInterpreter ? { resolveInterpreter: context.resolveInterpreter } : {}),
    };
    try {
      const outcome = await runHook(input);
      if (outcome.error?.code === 'HOOK_CONTENT_CHANGED') stale.push(base);
      return report(base, {
        ok: outcome.ok,
        ...(outcome.error ? { errorCode: outcome.error.code } : {}),
        exitCode: outcome.run.exitCode,
        timedOut: outcome.run.timedOut,
        durationMs: outcome.run.durationMs,
        result: outcome.interpreted,
      });
    } catch {
      // A hook problem never breaks the turn (section 11.6 item 10).
      return report(base, { ok: false, result: { blocked: false, warnings: ['The hook could not run'] } });
    }
  };

  const run = async (
    event: HookEventName,
    payload: Record<string, unknown>,
    context: HookRunContext = {}
  ): Promise<HookRunSummary> => {
    const nothing = (): HookRunSummary => ({ merged: mergeDecisions([]), perHook: [], warnings: [] });
    if (!isSupportedEvent(event) || store.state().disableAll) return nothing();

    const candidates: HookBase[] = [...[...packageHooks.values()].flat(), ...userBases];
    if (context.workspaceDir !== undefined) {
      // Re-read on every run so a removed hook or a revoked consent takes effect immediately.
      const workspace = await refreshWorkspace(context.workspaceDir);
      if (workspace) candidates.push(...workspace.bases);
    }

    const state = store.state();
    const warnings: string[] = [];
    const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : undefined;
    const selected = candidates.filter((base) => {
      if (!state.sourceEnabled[base.source] || base.handler.event !== event) return false;
      if (statusOf(base, state).status !== 'ready') return false;
      if (isMatchAll(base.handler.matcher)) return true;
      if (!TOOL_EVENTS.has(event) || toolName === undefined) return false;
      const outcome = evaluateMatcher(base.handler.matcher, toolName);
      if (outcome.flag) warnings.push(`Hook ${base.id.slice(0, 8)}: matcher refused (${outcome.flag})`);
      return outcome.matched;
    });
    if (selected.length === 0) return { merged: mergeDecisions([]), perHook: [], warnings };

    const stale: HookBase[] = [];
    const perHook = await Promise.all(selected.map((base) => executeOne(base, event, payload, context, stale)));
    await disableStale(stale);

    for (const entry of perHook) {
      for (const warning of entry.result.warnings) warnings.push(`Hook ${entry.hookId.slice(0, 8)}: ${warning}`);
    }
    return { merged: mergeDecisions(perHook.map((entry) => entry.result)), perHook, warnings };
  };

  return {
    initialize: async () => {
      const loaded = await store.load();
      rebuildUserBases();
      await verifyBases(userBases);
      return loaded;
    },
    registerPackageHooks,
    unregisterPackageHooks,
    addUserHook,
    removeUserHook,
    loadWorkspaceHooks: async (workspaceDir) => {
      const workspace = await refreshWorkspace(workspaceDir);
      if (!workspace) {
        return {
          consented: false,
          hooks: [],
          issues: [{ file: '', code: 'workspace-unavailable', message: 'The workspace folder is not available' }],
        };
      }
      return {
        consented: store.state().consents.includes(workspace.key),
        hooks: workspace.bases.map(viewOf),
        issues: workspace.issues,
      };
    },
    setWorkspaceConsent: async (workspaceDir, granted) => {
      const resolved = await resolveWorkspace(workspaceDir);
      if (!resolved) return false;
      return setSwitch((draft) => {
        const others = draft.consents.filter((key) => key !== resolved.key);
        draft.consents = granted ? [...others, resolved.key] : others;
      });
    },
    hasWorkspaceConsent: async (workspaceDir) => {
      const resolved = await resolveWorkspace(workspaceDir);
      return resolved !== undefined && store.state().consents.includes(resolved.key);
    },
    listHooks: async (workspaceDir) => {
      const bases = [...[...packageHooks.values()].flat(), ...userBases];
      if (workspaceDir !== undefined) {
        const workspace = await refreshWorkspace(workspaceDir);
        if (workspace) bases.push(...workspace.bases);
      }
      return bases.map(viewOf);
    },
    getEntry: (id) => {
      const base = findBase(id);
      return base ? entryOf(base) : undefined;
    },
    describeHook: async (id) => {
      const base = findBase(id);
      if (!base || !consentedFor(base, store.state())) return undefined;
      const context = pinContextOf(base);
      const pinning = await computeHookPinning(base.handler, context);
      return { lines: buildDescribeLines(base.handler, context, base.pluginId, pinning), hash: pinning.hash };
    },
    approveHook,
    setHookEnabled,
    setDisableAll: (disabled) =>
      setSwitch((draft) => {
        draft.disableAll = disabled;
      }),
    setSourceEnabled: (source, enabled) =>
      setSwitch((draft) => {
        draft.sourceEnabled[source] = enabled;
      }),
    getSwitches: () => {
      const state = store.state();
      return { disableAll: state.disableAll, sources: { ...state.sourceEnabled } };
    },
    run,
    readAudit: (limit) => audit.readRecent(limit),
    flush: () => audit.flush(),
  };
};
