/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveSpotlightTarget } from '@/common/ui/spotlightTargets';
import { emitter } from '@/renderer/utils/emitter';

const GUIDE_COMMAND = /^\s*\/guide(?:\s+([\s\S]*))?$/iu;

/**
 * Handles `/guide <what you are looking for>` typed in a message box. Returns true when the message was a
 * guide command, so the caller must not send it on; the result tells the caller what to tell the user.
 */
export const runGuideCommand = (input: string): { handled: false } | { handled: true; found: boolean } => {
  const match = GUIDE_COMMAND.exec(input);
  if (!match) return { handled: false };
  const request = match[1]?.trim() ?? '';
  return { handled: true, found: request !== '' && showSpotlight(request) !== undefined };
};

/**
 * Points the user at a control by describing it ("where do I turn on Super?"). Returns the id that was
 * highlighted, or undefined when nothing in the app's catalog matches the request.
 */
export const showSpotlight = (request: string, note?: string): string | undefined => {
  const target = resolveSpotlightTarget(request);
  if (!target) return undefined;
  emitter.emit('ui.spotlight', { targetId: target.id, ...(note ? { note } : {}) });
  return target.id;
};
