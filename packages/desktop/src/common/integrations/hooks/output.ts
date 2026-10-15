/**
 * Interpretation of a finished hook process (design section 11.4 and 11.6).
 *
 * Safety invariants enforced here:
 * - hooks can only tighten: a `permissionDecision` of `allow` is never a grant;
 * - `updatedInput` and `updatedToolOutput` are never applied;
 * - every failure mode (timeout, crash, bad JSON, odd exit code) fails open with a warning;
 * - all text is bounded before it reaches the model context.
 */

import type { HookEventName } from './events';

/** Maximum characters of any single string a hook may return. */
export const MAX_HOOK_STRING_LENGTH = 10_000;

/** Maximum bytes read from each of stdout and stderr. */
export const MAX_HOOK_STREAM_BYTES = 64 * 1024;

const TRUNCATION_NOTE = '\n[truncated by Tomny: hook output too long]';

/** Raw outcome of one hook process. `exitCode` is null when the process never started or was killed. */
export type HookRunInput = {
  event: HookEventName;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

/** Normalized decision of one hook (or of several, after {@link mergeDecisions}). */
export type HookResult = {
  /** The action (tool call, prompt, stop) must not proceed. */
  blocked: boolean;
  /** Why it was blocked, or the question to show when `permissionDecision` is `ask`. */
  reason?: string;
  /** PreToolUse only. `allow` is deliberately not representable. */
  permissionDecision?: 'deny' | 'ask';
  /** Untrusted text to add to the model context. */
  additionalContext?: string;
  /** Message for the user. */
  systemMessage?: string;
  /** Shown when `continue` is false. */
  stopReason?: string;
  /** Present and false when the hook asks to stop the turn. */
  continue?: boolean;
  /** Non-fatal problems for the audit log; never contain raw hook output beyond short excerpts. */
  warnings: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Cuts text to `max` characters, including a visible note when something was removed. */
export const truncateHookText = (text: string, max: number = MAX_HOOK_STRING_LENGTH): string => {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - TRUNCATION_NOTE.length)) + TRUNCATION_NOTE;
};

/** Limits a stream to {@link MAX_HOOK_STREAM_BYTES} UTF-8 bytes, dropping a split trailing character. */
export const capStream = (text: string): string => {
  const head = text.length > MAX_HOOK_STREAM_BYTES ? text.slice(0, MAX_HOOK_STREAM_BYTES) : text;
  const bytes = new TextEncoder().encode(head);
  if (bytes.length <= MAX_HOOK_STREAM_BYTES) return head;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, MAX_HOOK_STREAM_BYTES)).replace(/�$/, '');
};

const CONTEXT_EVENTS: ReadonlySet<HookEventName> = new Set<HookEventName>([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
]);
const PLAIN_TEXT_CONTEXT_EVENTS: ReadonlySet<HookEventName> = new Set<HookEventName>([
  'SessionStart',
  'UserPromptSubmit',
]);
const EXIT2_BLOCK_EVENTS: ReadonlySet<HookEventName> = new Set<HookEventName>([
  'PreToolUse',
  'UserPromptSubmit',
  'Stop',
]);
const EXIT2_CONTEXT_EVENTS: ReadonlySet<HookEventName> = new Set<HookEventName>(['PostToolUse', 'PostToolUseFailure']);

const DEFAULT_BLOCK_REASON = 'Blocked by hook';

type Draft = {
  blocked: boolean;
  reason?: string;
  permission?: 'deny' | 'ask';
  contexts: string[];
  systemMessage?: string;
  stopReason?: string;
  stop: boolean;
  warnings: string[];
};

const readString = (source: Record<string, unknown>, key: string, draft: Draft): string | undefined => {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  draft.warnings.push(`Ignored "${key}": expected a string`);
  return undefined;
};

/** Reads the documented JSON fields of one hook into the draft. */
const applyJson = (event: HookEventName, json: Record<string, unknown>, draft: Draft): void => {
  if (json.continue !== undefined) {
    if (typeof json.continue === 'boolean') {
      if (!json.continue) draft.stop = true;
    } else {
      draft.warnings.push('Ignored "continue": expected a boolean');
    }
  }
  draft.stopReason = readString(json, 'stopReason', draft) ?? draft.stopReason;
  draft.systemMessage = readString(json, 'systemMessage', draft) ?? draft.systemMessage;

  let specific: Record<string, unknown> = {};
  if (json.hookSpecificOutput !== undefined) {
    if (!isRecord(json.hookSpecificOutput)) {
      draft.warnings.push('Ignored "hookSpecificOutput": expected an object');
    } else if (json.hookSpecificOutput.hookEventName !== undefined && json.hookSpecificOutput.hookEventName !== event) {
      draft.warnings.push('Ignored "hookSpecificOutput": hookEventName does not match the event');
    } else {
      specific = json.hookSpecificOutput;
    }
  }

  if (json.updatedInput !== undefined || specific.updatedInput !== undefined) {
    draft.warnings.push('Ignored "updatedInput": hooks cannot rewrite tool input');
  }
  if (json.updatedToolOutput !== undefined || specific.updatedToolOutput !== undefined) {
    draft.warnings.push('Ignored "updatedToolOutput": hooks cannot rewrite tool output');
  }

  const topDecision = readString(json, 'decision', draft);
  const topReason = readString(json, 'reason', draft);

  if (event === 'PreToolUse') {
    let sawDeny = false;
    let sawAsk = false;
    const consider = (value: string | undefined, source: string): void => {
      if (value === undefined) return;
      if (value === 'deny' || value === 'block') sawDeny = true;
      else if (value === 'ask') sawAsk = true;
      else if (value === 'allow' || value === 'approve') {
        draft.warnings.push(`Ignored ${source} "${value}": hooks cannot grant permission`);
      } else {
        draft.warnings.push(`Ignored ${source} "${value.slice(0, 40)}": unknown value`);
      }
    };
    consider(readString(specific, 'permissionDecision', draft), 'permissionDecision');
    consider(topDecision, 'decision');
    if (sawDeny) {
      draft.permission = 'deny';
      draft.blocked = true;
    } else if (sawAsk) {
      draft.permission = 'ask';
    }
    const specificReason = readString(specific, 'permissionDecisionReason', draft);
    draft.reason = specificReason ?? topReason ?? draft.reason;
  } else if (event === 'UserPromptSubmit' || event === 'Stop') {
    if (topDecision === 'block') {
      draft.blocked = true;
      draft.reason = topReason ?? draft.reason;
    } else if (topDecision !== undefined) {
      draft.warnings.push(`Ignored decision "${topDecision.slice(0, 40)}": only "block" is supported`);
    }
  } else if (event === 'PostToolUse' || event === 'PostToolUseFailure') {
    // The tool already ran: a block decision becomes feedback for the agent, never a block.
    if (topDecision === 'block' && topReason !== undefined) draft.contexts.push(topReason);
  }

  if (CONTEXT_EVENTS.has(event)) {
    const context = readString(specific, 'additionalContext', draft);
    if (context !== undefined) draft.contexts.push(context);
  }
};

/**
 * Turns the outcome of a hook process into a normalized result for one event.
 * Never throws and never returns a permission grant.
 */
export const interpretHookResult = (input: HookRunInput): HookResult => {
  const { event } = input;
  const draft: Draft = { blocked: false, contexts: [], stop: false, warnings: [] };
  const finish = (): HookResult => {
    const result: HookResult = { blocked: draft.blocked, warnings: draft.warnings };
    const reason = draft.reason !== undefined && draft.reason !== '' ? draft.reason : undefined;
    if (draft.blocked) result.reason = truncateHookText(reason ?? DEFAULT_BLOCK_REASON);
    else if (reason !== undefined && draft.permission === 'ask') result.reason = truncateHookText(reason);
    if (draft.permission !== undefined) result.permissionDecision = draft.permission;
    const context = draft.contexts.filter((part) => part !== '').join('\n');
    if (context !== '') result.additionalContext = truncateHookText(context);
    if (draft.systemMessage) result.systemMessage = truncateHookText(draft.systemMessage);
    if (draft.stop) {
      result.continue = false;
      if (draft.stopReason) result.stopReason = truncateHookText(draft.stopReason);
    }
    return result;
  };

  if (input.timedOut) {
    draft.warnings.push('Hook timed out; ignored');
    return finish();
  }
  const code = input.exitCode;
  if (code === null || !Number.isInteger(code)) {
    draft.warnings.push('Hook did not run to completion; ignored');
    return finish();
  }
  if (code !== 0 && code !== 2) {
    draft.warnings.push(`Hook exited with code ${code}; ignored`);
    return finish();
  }

  const stdout = capStream(input.stdout).trim();
  const stderr = capStream(input.stderr).trim();

  let json: Record<string, unknown> | undefined;
  let plainText: string | undefined;
  if (stdout.startsWith('{') && stdout.endsWith('}')) {
    try {
      const parsed: unknown = JSON.parse(stdout);
      if (isRecord(parsed)) json = parsed;
      else draft.warnings.push('Hook output was not a JSON object; ignored');
    } catch {
      draft.warnings.push('Hook output looked like JSON but could not be parsed; ignored');
    }
  } else if (stdout !== '') {
    plainText = stdout;
  }

  if (json) applyJson(event, json, draft);

  if (code === 0) {
    if (plainText !== undefined && PLAIN_TEXT_CONTEXT_EVENTS.has(event)) draft.contexts.push(plainText);
    return finish();
  }

  // Exit code 2: blocks only where the action has not happened yet.
  if (EXIT2_BLOCK_EVENTS.has(event)) {
    draft.blocked = true;
    if (event === 'PreToolUse') draft.permission = 'deny';
    if (draft.reason === undefined || draft.reason === '') draft.reason = stderr;
  } else if (EXIT2_CONTEXT_EVENTS.has(event) && stderr !== '') {
    draft.contexts.push(stderr);
  }
  return finish();
};

/**
 * Combines the results of hooks that ran in parallel for one event.
 * Priority: deny > ask > no decision. Any `continue: false` stops the turn.
 */
export const mergeDecisions = (results: readonly HookResult[]): HookResult => {
  const merged: HookResult = { blocked: false, warnings: [] };
  if (results.length === 0) return merged;

  const blockedOnes = results.filter((r) => r.blocked);
  const askOnes = results.filter((r) => r.permissionDecision === 'ask' && !r.blocked);
  const joinReasons = (list: readonly HookResult[]): string | undefined => {
    const reasons = [...new Set(list.map((r) => r.reason).filter((r): r is string => !!r))];
    return reasons.length > 0 ? truncateHookText(reasons.join('\n')) : undefined;
  };

  if (blockedOnes.length > 0) {
    merged.blocked = true;
    const reason = joinReasons(blockedOnes);
    if (reason !== undefined) merged.reason = reason;
    if (blockedOnes.some((r) => r.permissionDecision === 'deny')) merged.permissionDecision = 'deny';
  } else if (askOnes.length > 0) {
    merged.permissionDecision = 'ask';
    const reason = joinReasons(askOnes);
    if (reason !== undefined) merged.reason = reason;
  }

  const contexts = results.map((r) => r.additionalContext).filter((c): c is string => !!c);
  if (contexts.length > 0) merged.additionalContext = contexts.join('\n\n');
  const messages = results.map((r) => r.systemMessage).filter((m): m is string => !!m);
  if (messages.length > 0) merged.systemMessage = messages.join('\n');

  const stoppers = results.filter((r) => r.continue === false);
  if (stoppers.length > 0) {
    merged.continue = false;
    const stopReasons = stoppers.map((r) => r.stopReason).filter((s): s is string => !!s);
    if (stopReasons.length > 0) merged.stopReason = truncateHookText([...new Set(stopReasons)].join('\n'));
  }

  merged.warnings = results.flatMap((r) => r.warnings);
  return merged;
};
