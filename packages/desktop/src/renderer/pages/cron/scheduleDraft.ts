/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseScheduleCommand, type ScheduleDraft } from '@/common/chat/slash/scheduleCommand';
import { emitter } from '@/renderer/utils/emitter';

let pendingDraft: ScheduleDraft | null = null;

/** The draft left by `/schedule`, handed out once so a refresh does not reopen the form. */
export const takePendingScheduleDraft = (): ScheduleDraft | null => {
  const draft = pendingDraft;
  pendingDraft = null;
  return draft;
};

/**
 * Handles `/schedule ...` typed in a message box: opens the Schedule page with the new-task form filled in.
 * Nothing is created until the user picks an agent and confirms. Returns true when the input was a schedule
 * command, so the caller must not send it as a message.
 */
export const runScheduleCommand = (input: string): boolean => {
  const draft = parseScheduleCommand(input);
  if (!draft) return false;
  pendingDraft = draft;
  if (window.location.hash.replace(/^#/u, '').split('?')[0] === '/scheduled') {
    emitter.emit('cron.schedule-draft');
  } else {
    window.location.hash = '#/scheduled';
  }
  return true;
};
