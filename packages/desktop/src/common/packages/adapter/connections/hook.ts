/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { commonFields, CONTROL_CHARACTER, connectionId, type Shaped } from '../primitives';

/** Events the hook runner fires in v1 (design section 11.3). Other events are kept in the package, switched off. */
export const ADAPTER_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'Notification',
  'SessionEnd',
] as const;

/** One piece of a hook command line: bounded, and free of control characters. */
const commandText = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((value) => !CONTROL_CHARACTER.test(value), 'must not contain control characters');

/**
 * `hook`: one handler for one event. It is data until the user approves it; the host never runs it on its own.
 * `command` without `args` is the shell form, with `args` the exec form (design section 11.2). `event` is any
 * event name rather than only `ADAPTER_HOOK_EVENTS`, so a hook for an event this version does not fire survives in
 * the package and is reported off with a reason instead of being lost.
 */
export const buildHookConnection = (shaped: Shaped) =>
  shaped({
    kind: z.literal('hook'),
    id: connectionId,
    event: z
      .string()
      .max(64)
      .regex(/^[A-Za-z][A-Za-z0-9]*$/),
    /** Empty, `*` or absent matches everything; a list of names or a bounded regular expression otherwise. */
    matcher: z.string().max(300).optional(),
    command: commandText(1, 500),
    args: z.array(commandText(0, 500)).max(32).optional(),
    timeoutSec: z.number().int().min(1).max(600).optional(),
    ...commonFields,
  });
