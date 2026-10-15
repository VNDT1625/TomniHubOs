/**
 * Shared contracts of the Tomny hook runner (design section 11.6).
 * Main-process only: nothing here touches the DOM.
 */

import type { HookCommandForm, HookEventName, HookResult, PlaceholderContext } from '@/common/integrations/hooks';

/** Where a hook came from. Only `package` hooks are restricted to exec form inside the plugin root. */
export type HookSource = 'package' | 'user' | 'workspace';

/** Stable error codes. `HOOK_TIMEOUT` and `HOOK_ABORTED` still carry a partial run. */
export type HookRunnerErrorCode =
  | 'HOOK_START_FAILED'
  | 'HOOK_RUNTIME_MISSING'
  | 'HOOK_SHELL_FORBIDDEN'
  | 'HOOK_PATH_FORBIDDEN'
  | 'HOOK_TIMEOUT'
  | 'HOOK_ABORTED'
  | 'HOOK_QUEUE_DROPPED'
  | 'HOOK_CONTENT_CHANGED';

/** A failure that is reported to the caller instead of being thrown. */
export type HookRunnerError = {
  code: HookRunnerErrorCode;
  message: string;
};

/** The command part of a normalized hook handler. */
export type HookRunnerHandler = {
  form: HookCommandForm;
  command: string;
  args?: readonly string[];
  /** Requested timeout in seconds; capped by `effectiveTimeoutSec` (SessionEnd budget). */
  timeoutSec?: number;
};

/** Interpreters a package hook may name in exec form (section 11.6 item 3). */
export const HOOK_INTERPRETER_NAMES = [
  'node',
  'python',
  'python3',
  'bash',
  'sh',
  'pwsh',
  'powershell',
  'bun',
  'deno',
  'uv',
] as const;

export type HookInterpreterName = (typeof HOOK_INTERPRETER_NAMES)[number];

/** Finds an interpreter executable. Returns an absolute path, or undefined when it is not installed. */
export type HookInterpreterResolver = (name: HookInterpreterName) => string | undefined | Promise<string | undefined>;

/** Decision summary written to the audit log. */
export type HookAuditDecision = 'deny' | 'ask' | 'block' | 'stop' | 'none';

/**
 * One audit record. It deliberately holds no stdin and no raw stdout/stderr, only lengths
 * (section 11.6 item 8).
 */
export type HookAuditEntry = {
  event: HookEventName;
  hookId?: string;
  source: HookSource;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  decision: HookAuditDecision;
  /** Bytes the process wrote to stdout (before the 64 KB cap). */
  stdoutLength: number;
  /** Bytes the process wrote to stderr (before the 64 KB cap). */
  stderrLength: number;
  errorCode?: HookRunnerErrorCode;
};

/** Raw facts about the process run. */
export type HookRunRecord = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  /** True when the stdin payload had to be shortened to fit 256 KB. */
  truncatedInput: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

/** Outcome of asking the limiter for a slot. */
export type HookLimiterTicket = { kind: 'acquired'; release: () => void } | { kind: 'dropped' } | { kind: 'aborted' };

/** App-wide concurrency gate for hook processes. */
export type HookLimiter = {
  acquire: (options: { droppable: boolean; signal?: AbortSignal }) => Promise<HookLimiterTicket>;
  stats: () => { running: number; queued: number; peakRunning: number; dropped: number };
};

/** Everything the runner needs for one handler. */
export type HookRunnerInput = {
  handler: HookRunnerHandler;
  event: HookEventName;
  /** JSON object written to stdin. */
  payload: Record<string, unknown>;
  cwd: string;
  placeholders: PlaceholderContext;
  source: HookSource;
  hookId?: string;
  /** Test seam: replaces the interpreter lookup. */
  resolveInterpreter?: HookInterpreterResolver;
  /** Test seam: the "parent" environment the minimal child environment is filtered from. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onAudit?: (entry: HookAuditEntry) => void;
  /** Concurrency gate. Defaults to the app-wide limiter (8 running). */
  limiter?: HookLimiter;
  /**
   * TOCTOU guard. SHA-256 hex of the script the caller approved. The runner hashes the real path of the script
   * it is about to run, right before the spawn, and refuses (`HOOK_CONTENT_CHANGED`) on a mismatch.
   * Ignored for shell-form hooks and for commands that are not a script file.
   */
  expectedFileSha256?: string;
  /**
   * Last check before the spawn, after path planning and after the concurrency slot was granted (the longest
   * waits happen there). Resolve to false to refuse the run (`HOOK_CONTENT_CHANGED`). A throw refuses too.
   * `scriptFile` is the real path the runner resolved for the script, when there is one.
   */
  beforeSpawn?: (info: { scriptFile?: string }) => boolean | Promise<boolean>;
};

/** Result of one runner call. Never thrown for ordinary failures. */
export type HookRunnerResult = {
  /** False when `error` is set. A false value never means "blocked": hooks fail open. */
  ok: boolean;
  run: HookRunRecord;
  interpreted: HookResult;
  error?: HookRunnerError;
};
