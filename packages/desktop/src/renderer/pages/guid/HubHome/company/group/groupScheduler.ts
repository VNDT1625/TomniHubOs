/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { listGroups } from '../companyGroups';
import { fireGroupEvent } from './groupEngine';
import { dueOccurrence, readAllMeta, readMeta, splitChatKey, writeMeta } from './groupMeta';

/**
 * Fires group calendar events while the app is open. Events that came due while
 * the app was closed fire on the next check, marked late; a repeating event only
 * fires its latest occurrence. Each agent still runs under its own permission
 * mode, and anything it needs approved waits for the user.
 */

const TICK_MS = 30_000;
/** An occurrence fired more than this after its time is shown as late. */
const LATE_AFTER_MS = 5 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let language = 'en-US';

const tick = async (): Promise<void> => {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const [key, meta] of readAllMeta()) {
      const due = meta.events
        .map((event) => ({ event, at: dueOccurrence(event, now) }))
        .filter((item): item is { event: typeof item.event; at: number } => item.at !== null);
      if (due.length === 0) continue;
      const ids = splitChatKey(key);
      if (!ids) continue;

      // Mark first, so a slow or failing run can never fire the same occurrence twice.
      const latest = readMeta(key);
      writeMeta(key, {
        ...latest,
        events: latest.events.map((event) => {
          const hit = due.find((item) => item.event.id === event.id);
          return hit ? { ...event, lastFiredAt: hit.at } : event;
        }),
      });

      const [structureRes, rulesRes] = await Promise.all([
        ipcBridge.company.getStructure.invoke({ companyId: ids.companyId }),
        ipcBridge.company.getRules.invoke({ companyId: ids.companyId }),
      ]).catch((): readonly [null, null] => [null, null]);
      if (!structureRes?.ok) continue;
      const structure = structureRes.data;
      const group = listGroups(structure).find((item) => item.id === ids.groupId);
      if (!group) continue;
      const ctx = {
        companyId: ids.companyId,
        companyName: ids.companyId,
        group,
        structure,
        rules: rulesRes?.ok ? rulesRes.data : [],
        language,
      };
      for (const { event, at } of due) void fireGroupEvent(ctx, event, now - at > LATE_AFTER_MS);
    }
  } finally {
    ticking = false;
  }
};

/** Start the calendar loop once per app session; later calls only update the language. */
export const ensureGroupScheduler = (nextLanguage: string): void => {
  language = nextLanguage;
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  void tick();
};
