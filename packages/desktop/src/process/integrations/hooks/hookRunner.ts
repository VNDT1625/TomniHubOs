/**
 * HookRunner: runs ONE hook handler and returns the interpreted decision (repotopackage design section 11).
 *
 * Execution path contract (AGENTS.md section 6):
 * - identity: `source` plus the caller-supplied `hookId`; the registry (T3.2) owns approval and pinning;
 * - capabilities: a hook never grants anything; `interpretHookResult` only lets it tighten;
 * - secrets: the child gets a minimal environment, never the parent's keys or tokens;
 * - network: NOT restricted on Windows in v1 (no sandbox driver); a hook process can reach the network;
 * - limits: timeout with whole-tree kill, 256 KB stdin, 64 KB per output stream, 8 hooks at once;
 * - audit: one entry per call with lengths only, never stdin or raw output.
 *
 * The runner never throws for ordinary failures: every failure fails open (section 11.6 item 10).
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath } from 'node:fs/promises';
import {
  effectiveTimeoutSec,
  interpretHookResult,
  type HookEventName,
  type HookResult,
} from '@/common/integrations/hooks';
import { defaultHookLimiter, isDroppableEvent } from './hookLimiter';
import { planHookCommand } from './hookInterpreters';
import { buildHookEnv, buildHookStdin } from './hookPayload';
import { runHookProcess, type HookProcessOutcome } from './hookProcess';
import type {
  HookAuditDecision,
  HookAuditEntry,
  HookRunRecord,
  HookRunnerError,
  HookRunnerInput,
  HookRunnerResult,
} from './hookTypes';

export { createHookLimiter, defaultHookLimiter } from './hookLimiter';
export type { HookLimiterOptions } from './hookLimiter';
export * from './hookTypes';

const MIN_TIMEOUT_MS = 50;
const MAX_TIMEOUT_MS = 600_000;

const emptyRun = (durationMs: number): HookRunRecord => ({
  exitCode: null,
  stdout: '',
  stderr: '',
  timedOut: false,
  durationMs,
  truncatedInput: false,
  stdoutTruncated: false,
  stderrTruncated: false,
});

const decisionOf = (interpreted: HookResult): HookAuditDecision => {
  if (interpreted.permissionDecision === 'deny') return 'deny';
  if (interpreted.blocked) return 'block';
  if (interpreted.permissionDecision === 'ask') return 'ask';
  if (interpreted.continue === false) return 'stop';
  return 'none';
};

const audit = (
  input: HookRunnerInput,
  run: HookRunRecord,
  interpreted: HookResult,
  stdoutLength: number,
  stderrLength: number,
  error: HookRunnerError | undefined
): void => {
  if (!input.onAudit) return;
  const entry: HookAuditEntry = {
    event: input.event,
    source: input.source,
    durationMs: run.durationMs,
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    decision: decisionOf(interpreted),
    stdoutLength,
    stderrLength,
  };
  if (input.hookId !== undefined) entry.hookId = input.hookId;
  if (error) entry.errorCode = error.code;
  try {
    input.onAudit(entry);
  } catch {
    // A broken audit sink must never affect the hook outcome.
  }
};

const interpret = (event: HookEventName, run: HookRunRecord, error: HookRunnerError | undefined): HookResult => {
  const interpreted = interpretHookResult({
    event,
    exitCode: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
    timedOut: run.timedOut,
  });
  // The generic warning says the hook did not finish; keep the specific reason for the log and the UI.
  if (error) interpreted.warnings.push(`${error.code}: ${error.message}`);
  return interpreted;
};

const failure = (
  input: HookRunnerInput,
  code: HookRunnerError['code'],
  message: string,
  stdoutLength = 0,
  stderrLength = 0
): HookRunnerResult => {
  const error: HookRunnerError = { code, message };
  const run = emptyRun(0);
  const interpreted = interpret(input.event, run, error);
  audit(input, run, interpreted, stdoutLength, stderrLength, error);
  return { ok: false, run, interpreted, error };
};

const errorFor = (outcome: HookProcessOutcome): HookRunnerError | undefined => {
  if (outcome.startError !== undefined) {
    return { code: 'HOOK_START_FAILED', message: `The hook process did not start: ${outcome.startError}` };
  }
  if (outcome.timedOut) return { code: 'HOOK_TIMEOUT', message: 'The hook timed out and its process tree was killed' };
  if (outcome.aborted)
    return { code: 'HOOK_ABORTED', message: 'The hook was cancelled and its process tree was killed' };
  return undefined;
};

const sha256OfFile = async (file: string): Promise<string> => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
};

/**
 * Last check before the spawn (TOCTOU guard). Hashes the real path of the script that is about to run and
 * runs the caller's `beforeSpawn`. Returns a refusal message, or undefined when the run may start.
 * Fails closed for this one run: an unreadable script or a throwing callback means "do not start".
 */
const checkBeforeSpawn = async (
  input: HookRunnerInput,
  scriptFile: string | undefined
): Promise<string | undefined> => {
  let realScript: string | undefined;
  if (scriptFile !== undefined) {
    try {
      realScript = await realpath(scriptFile);
    } catch {
      return 'The hook script could not be resolved right before it ran';
    }
    if (input.expectedFileSha256 !== undefined) {
      const expected = input.expectedFileSha256
        .trim()
        .toLowerCase()
        .replace(/^sha256[:-]/, '');
      let actual: string;
      try {
        actual = await sha256OfFile(realScript);
      } catch {
        return 'The hook script could not be read right before it ran';
      }
      if (actual !== expected) return 'The hook script changed since it was approved';
    }
  }
  if (input.beforeSpawn) {
    try {
      const allowed = await input.beforeSpawn(realScript === undefined ? {} : { scriptFile: realScript });
      if (!allowed) return 'The hook changed since it was approved';
    } catch {
      return 'The hook could not be re-verified right before it ran';
    }
  }
  return undefined;
};

const execute = async (input: HookRunnerInput): Promise<HookRunnerResult> => {
  const parentEnv = input.env ?? process.env;
  const plan = await planHookCommand({
    handler: input.handler,
    source: input.source,
    placeholders: input.placeholders,
    cwd: input.cwd,
    resolveInterpreter: input.resolveInterpreter,
    env: parentEnv,
  });
  if (plan.kind === 'error') return failure(input, plan.error.code, plan.error.message);

  const limiter = input.limiter ?? defaultHookLimiter;
  const ticket = await limiter.acquire({ droppable: isDroppableEvent(input.event), signal: input.signal });
  if (ticket.kind === 'dropped') {
    return failure(input, 'HOOK_QUEUE_DROPPED', 'Too many hooks are waiting; this observe-only hook was dropped');
  }
  if (ticket.kind === 'aborted') return failure(input, 'HOOK_ABORTED', 'The hook was cancelled before it started');

  try {
    const refusal = await checkBeforeSpawn(input, plan.scriptFile);
    if (refusal !== undefined) return failure(input, 'HOOK_CONTENT_CHANGED', refusal);
    const stdin = buildHookStdin(input.payload);
    const env = buildHookEnv(
      parentEnv,
      input.placeholders,
      plan.usesElectronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}
    );
    const requestedSec = effectiveTimeoutSec(input.event, input.handler.timeoutSec);
    const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, requestedSec * 1000));

    const started = Date.now();
    const outcome = await runHookProcess(
      { file: plan.file, args: plan.args, shell: plan.shell, env, cwd: input.cwd },
      stdin.text,
      timeoutMs,
      input.signal
    );
    const run: HookRunRecord = {
      exitCode: outcome.exitCode,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      timedOut: outcome.timedOut,
      durationMs: Date.now() - started,
      truncatedInput: stdin.truncated,
      stdoutTruncated: outcome.stdoutTruncated,
      stderrTruncated: outcome.stderrTruncated,
    };
    const error = errorFor(outcome);
    const interpreted = interpret(input.event, run, error);
    audit(input, run, interpreted, outcome.stdoutBytes, outcome.stderrBytes, error);
    return error ? { ok: false, run, interpreted, error } : { ok: true, run, interpreted };
  } finally {
    ticket.release();
  }
};

/**
 * Runs one hook handler. Resolves with the raw run record and the interpreted decision; ordinary failures
 * (cannot start, forbidden command, missing runtime, timeout, cancel, dropped) come back in `error`
 * and are never thrown. The interpreted decision of a failed hook is always non-blocking.
 */
export const runHook = async (input: HookRunnerInput): Promise<HookRunnerResult> => {
  try {
    return await execute(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(input, 'HOOK_START_FAILED', `Unexpected hook runner failure: ${message}`);
  }
};
