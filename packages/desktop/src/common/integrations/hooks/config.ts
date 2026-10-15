/**
 * Lenient parser for Claude Code style hook configuration (design section 11.2):
 * `{ hooks: { <Event>: [ { matcher?, hooks: [ { type, command, args?, timeout? } ] } ] } }`.
 * The input is untrusted (package files, workspace settings), so parsing never throws and every
 * rejected entry becomes an issue instead.
 */

import { z } from 'zod';
import { defaultTimeoutSec, isKnownEvent, isSupportedEvent, type KnownHookEventName } from './events';

/** Hard limits from design section 11.2. */
export const HOOK_LIMITS = {
  commandMaxLength: 500,
  argsMaxCount: 32,
  argMaxLength: 500,
  timeoutMinSec: 1,
  timeoutMaxSec: 600,
  /** Parser-side bounds so a hostile file cannot create unbounded work. */
  maxGroupsPerEvent: 64,
  maxHandlersPerGroup: 64,
  maxHandlers: 256,
  maxIssues: 100,
} as const;

/** How a command is launched: `exec` when `args` is present (even empty), otherwise through a shell. */
export type HookCommandForm = 'exec' | 'shell';

/** One normalized command hook. */
export type HookHandler = {
  event: KnownHookEventName;
  /** Raw matcher text; evaluate with `matchesTool`. Absent means match all. */
  matcher?: string;
  command: string;
  args?: string[];
  timeoutSec: number;
  form: HookCommandForm;
  /** True for events v1 does not fire. The handler is kept (disabled) so the UI can explain why. */
  unsupported: boolean;
};

/** Reasons a configuration entry did not become an active handler. */
export type HookConfigIssueCode =
  | 'invalid-config'
  | 'invalid-group'
  | 'invalid-handler'
  | 'needs-runtime'
  | 'unsupported-event'
  | 'unknown-event'
  | 'limit-exceeded';

/** A problem found while parsing. `path` is a dotted location such as `hooks.PreToolUse[0].hooks[1]`. */
export type HookConfigIssue = {
  code: HookConfigIssueCode;
  path: string;
  message: string;
  event?: string;
};

/** Parse result. Always returned, never thrown. */
export type ParsedHooksConfig = {
  handlers: HookHandler[];
  issues: HookConfigIssue[];
};

/** Schema of a `command` handler. Unknown fields are stripped (Zod default). */
export const hookCommandSchema = z.object({
  type: z.literal('command'),
  command: z.string().min(1).max(HOOK_LIMITS.commandMaxLength),
  args: z.array(z.string().max(HOOK_LIMITS.argMaxLength)).max(HOOK_LIMITS.argsMaxCount).optional(),
  timeout: z.number().min(HOOK_LIMITS.timeoutMinSec).max(HOOK_LIMITS.timeoutMaxSec).optional(),
  /** Alias used by the adapter.json `hook` connection. */
  timeoutSec: z.number().min(HOOK_LIMITS.timeoutMinSec).max(HOOK_LIMITS.timeoutMaxSec).optional(),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const describeZodError = (error: z.ZodError): string =>
  error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
    .join('; ');

/**
 * Parses a settings-shaped object `{ hooks: {...} }`. A bare events map is not accepted: the
 * `hooks` wrapper is required so the parser never guesses. A missing `hooks` key is an empty config.
 * Never throws.
 */
export const parseHooksConfig = (raw: unknown): ParsedHooksConfig => {
  const handlers: HookHandler[] = [];
  const issues: HookConfigIssue[] = [];
  const addIssue = (issue: HookConfigIssue): void => {
    if (issues.length < HOOK_LIMITS.maxIssues) issues.push(issue);
  };

  try {
    if (!isRecord(raw)) {
      addIssue({ code: 'invalid-config', path: '', message: 'Configuration must be an object' });
      return { handlers, issues };
    }
    const hooks = raw.hooks;
    if (hooks === undefined) return { handlers, issues };
    if (!isRecord(hooks)) {
      addIssue({ code: 'invalid-config', path: 'hooks', message: '"hooks" must be an object keyed by event name' });
      return { handlers, issues };
    }

    for (const eventName of Object.keys(hooks)) {
      const eventPath = `hooks.${eventName}`;
      if (!isKnownEvent(eventName)) {
        addIssue({ code: 'unknown-event', path: eventPath, event: eventName, message: `Unknown event "${eventName}"` });
        continue;
      }
      const unsupported = !isSupportedEvent(eventName);
      if (unsupported) {
        addIssue({
          code: 'unsupported-event',
          path: eventPath,
          event: eventName,
          message: `Event "${eventName}" is not supported yet; its hooks are kept disabled`,
        });
      }
      const groups = hooks[eventName];
      if (!Array.isArray(groups)) {
        addIssue({
          code: 'invalid-group',
          path: eventPath,
          event: eventName,
          message: 'Expected an array of matcher groups',
        });
        continue;
      }
      if (groups.length > HOOK_LIMITS.maxGroupsPerEvent) {
        addIssue({
          code: 'limit-exceeded',
          path: eventPath,
          event: eventName,
          message: `More than ${HOOK_LIMITS.maxGroupsPerEvent} matcher groups; extra groups ignored`,
        });
      }

      groups.slice(0, HOOK_LIMITS.maxGroupsPerEvent).forEach((group: unknown, groupIndex) => {
        const groupPath = `${eventPath}[${groupIndex}]`;
        if (!isRecord(group) || !Array.isArray(group.hooks)) {
          addIssue({
            code: 'invalid-group',
            path: groupPath,
            event: eventName,
            message: 'Matcher group must be an object with a "hooks" array',
          });
          return;
        }
        const rawMatcher = group.matcher;
        if (rawMatcher !== undefined && typeof rawMatcher !== 'string') {
          addIssue({ code: 'invalid-group', path: groupPath, event: eventName, message: '"matcher" must be a string' });
          return;
        }
        const matcher: string | undefined = typeof rawMatcher === 'string' ? rawMatcher : undefined;
        if (group.hooks.length > HOOK_LIMITS.maxHandlersPerGroup) {
          addIssue({
            code: 'limit-exceeded',
            path: groupPath,
            event: eventName,
            message: `More than ${HOOK_LIMITS.maxHandlersPerGroup} handlers in a group; extra handlers ignored`,
          });
        }

        group.hooks.slice(0, HOOK_LIMITS.maxHandlersPerGroup).forEach((entry: unknown, handlerIndex) => {
          const handlerPath = `${groupPath}.hooks[${handlerIndex}]`;
          if (!isRecord(entry)) {
            addIssue({
              code: 'invalid-handler',
              path: handlerPath,
              event: eventName,
              message: 'Handler must be an object',
            });
            return;
          }
          if (typeof entry.type !== 'string') {
            addIssue({ code: 'invalid-handler', path: handlerPath, event: eventName, message: '"type" is required' });
            return;
          }
          if (entry.type !== 'command') {
            addIssue({
              code: 'needs-runtime',
              path: handlerPath,
              event: eventName,
              message: `Handler type "${entry.type.slice(0, 40)}" needs a runtime Tomny does not provide in v1`,
            });
            return;
          }
          const parsed = hookCommandSchema.safeParse(entry);
          if (!parsed.success) {
            addIssue({
              code: 'invalid-handler',
              path: handlerPath,
              event: eventName,
              message: describeZodError(parsed.error),
            });
            return;
          }
          if (handlers.length >= HOOK_LIMITS.maxHandlers) {
            addIssue({
              code: 'limit-exceeded',
              path: handlerPath,
              event: eventName,
              message: `More than ${HOOK_LIMITS.maxHandlers} handlers; extra handlers ignored`,
            });
            return;
          }
          const { command, args, timeout, timeoutSec } = parsed.data;
          const handler: HookHandler = {
            event: eventName,
            command,
            timeoutSec: timeout ?? timeoutSec ?? defaultTimeoutSec(eventName),
            form: args !== undefined ? 'exec' : 'shell',
            unsupported,
          };
          if (matcher !== undefined) handler.matcher = matcher;
          if (args !== undefined) handler.args = args;
          handlers.push(handler);
        });
      });
    }
  } catch (error: unknown) {
    // Defensive: hostile getters or proxies must not break callers.
    addIssue({
      code: 'invalid-config',
      path: '',
      message: `Configuration could not be read: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
  }
  return { handlers, issues };
};
