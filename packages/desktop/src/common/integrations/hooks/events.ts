/**
 * Hook event catalogue for Tomny Hooks (repotopackage design section 11.3).
 * Pure data and predicates: no I/O, no runtime imports.
 */

/** Events the v1 hook runner can fire. */
export const SUPPORTED_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'Notification',
  'SessionEnd',
] as const;

/** Events Claude Code defines that v1 keeps in packages but never fires (disabled, reason "unsupported event"). */
export const KNOWN_UNSUPPORTED_HOOK_EVENTS = [
  'Setup',
  'InstructionsLoaded',
  'UserPromptExpansion',
  'MessageDisplay',
  'PermissionRequest',
  'PostToolBatch',
  'PermissionDenied',
  'SubagentStart',
  'SubagentStop',
  'TaskCreated',
  'TaskCompleted',
  'StopFailure',
  'TeammateIdle',
  'ConfigChange',
  'CwdChanged',
  'DirectoryAdded',
  'FileChanged',
  'WorktreeCreate',
  'WorktreeRemove',
  'PreCompact',
  'PostCompact',
  'PreModelSwitch',
  'PostModelSwitch',
  'Elicitation',
  'ElicitationResult',
] as const;

/** An event the v1 runner supports. */
export type HookEventName = (typeof SUPPORTED_HOOK_EVENTS)[number];

/** An event that Claude Code knows but v1 does not run. */
export type UnsupportedHookEventName = (typeof KNOWN_UNSUPPORTED_HOOK_EVENTS)[number];

/** Any event name Claude Code documents. */
export type KnownHookEventName = HookEventName | UnsupportedHookEventName;

const SUPPORTED_SET: ReadonlySet<string> = new Set(SUPPORTED_HOOK_EVENTS);
const KNOWN_SET: ReadonlySet<string> = new Set<string>([...SUPPORTED_HOOK_EVENTS, ...KNOWN_UNSUPPORTED_HOOK_EVENTS]);

/** True when v1 can fire this event. Exact, case-sensitive match. */
export const isSupportedEvent = (name: unknown): name is HookEventName =>
  typeof name === 'string' && SUPPORTED_SET.has(name);

/** True when Claude Code documents this event (supported or not). */
export const isKnownEvent = (name: unknown): name is KnownHookEventName =>
  typeof name === 'string' && KNOWN_SET.has(name);

/**
 * Whether exit code 2 / a deny decision can block the action for this event (section 11.4).
 * For the other events the hook is observe-only or only feeds context back.
 */
export const HOOK_EVENT_CAN_BLOCK: Readonly<Record<HookEventName, boolean>> = {
  SessionStart: false,
  UserPromptSubmit: true,
  PreToolUse: true,
  PostToolUse: false,
  PostToolUseFailure: false,
  Stop: true,
  Notification: false,
  SessionEnd: false,
};

/** Convenience wrapper over {@link HOOK_EVENT_CAN_BLOCK}. */
export const canEventBlock = (event: HookEventName): boolean => HOOK_EVENT_CAN_BLOCK[event];

/** Default per-hook timeout in seconds. */
export const DEFAULT_HOOK_TIMEOUT_SEC = 60;

/** Total budget for all SessionEnd hooks, in seconds (the app is closing; never hold shutdown). */
export const SESSION_END_BUDGET_SEC = 1.5;

/** Default timeout per event, in seconds. */
export const DEFAULT_TIMEOUT_BY_EVENT: Readonly<Record<HookEventName, number>> = {
  SessionStart: DEFAULT_HOOK_TIMEOUT_SEC,
  UserPromptSubmit: 30,
  PreToolUse: DEFAULT_HOOK_TIMEOUT_SEC,
  PostToolUse: DEFAULT_HOOK_TIMEOUT_SEC,
  PostToolUseFailure: DEFAULT_HOOK_TIMEOUT_SEC,
  Stop: DEFAULT_HOOK_TIMEOUT_SEC,
  Notification: DEFAULT_HOOK_TIMEOUT_SEC,
  SessionEnd: SESSION_END_BUDGET_SEC,
};

/** Default timeout in seconds for an event; unsupported events fall back to 60. */
export const defaultTimeoutSec = (event: KnownHookEventName): number =>
  isSupportedEvent(event) ? DEFAULT_TIMEOUT_BY_EVENT[event] : DEFAULT_HOOK_TIMEOUT_SEC;

/**
 * Timeout the runner must actually enforce. SessionEnd is capped by the shared budget even
 * when a handler asks for more.
 */
export const effectiveTimeoutSec = (event: KnownHookEventName, requestedSec: number | undefined): number => {
  const base = requestedSec !== undefined && Number.isFinite(requestedSec) ? requestedSec : defaultTimeoutSec(event);
  return event === 'SessionEnd' ? Math.min(base, SESSION_END_BUDGET_SEC) : base;
};
