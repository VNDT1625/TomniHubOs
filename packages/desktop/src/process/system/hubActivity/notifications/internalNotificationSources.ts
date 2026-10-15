/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HubActivityItem, HubActivitySnapshot, HubActivityStatus } from '@/common/types/agent/hubActivity';
import type {
  NotificationCategory,
  NotificationLevel,
  NotificationSourceKind,
  NotificationText,
} from '@/common/types/platform/notificationHub';

export type InternalEvent = {
  key: string;
  source: NotificationSourceKind;
  sourceLabel: string;
  title: string;
  body: string;
  route?: string;
  hint: { level: NotificationLevel; category: NotificationCategory; reason: string };
  i18n: NotificationText;
};

type Rule = {
  level: NotificationLevel;
  reason: string;
  key: string;
  english: (name: string) => string;
};

const KEY_PREFIX = 'common.notificationHub.event';

/** Which status changes are worth a notification, per kind of work. Stopping is the user's own action. */
const RULES: Partial<Record<HubActivityItem['kind'], Partial<Record<HubActivityStatus, Rule>>>> = {
  agent: {
    needs_input: {
      level: 'P0',
      reason: 'needs-input',
      key: 'needsInput',
      english: (name) => `${name} needs your answer`,
    },
    error: { level: 'P1', reason: 'run-failed', key: 'failed', english: (name) => `${name} failed` },
    done: { level: 'P1', reason: 'run-done', key: 'done', english: (name) => `${name} finished` },
  },
  schedule: {
    error: {
      level: 'P1',
      reason: 'schedule-failed',
      key: 'scheduleFailed',
      english: (name) => `Scheduled task ${name} failed`,
    },
    done: {
      level: 'P2',
      reason: 'schedule-done',
      key: 'scheduleDone',
      english: (name) => `Scheduled task ${name} finished`,
    },
  },
  team: {
    needs_input: {
      level: 'P0',
      reason: 'needs-input',
      key: 'needsInput',
      english: (name) => `${name} needs your answer`,
    },
    error: { level: 'P1', reason: 'run-failed', key: 'failed', english: (name) => `${name} failed` },
    done: { level: 'P2', reason: 'run-done', key: 'done', english: (name) => `${name} finished` },
  },
};

const SOURCE: Record<HubActivityItem['kind'], NotificationSourceKind> = {
  agent: 'agent',
  schedule: 'schedule',
  team: 'team',
  app: 'system',
};

const LABEL: Record<HubActivityItem['kind'], string> = {
  agent: 'Tomny Agent',
  schedule: 'Schedule',
  team: 'Team',
  app: 'Tomny',
};

const QUICK_RUN_MS = 20_000;
const LONG_RUN_MS = 120_000;

/** A quick chat reply is not news; a long agent run is. */
const gradeCompletion = (item: HubActivityItem, rule: Rule | undefined): Rule | undefined => {
  if (!rule || item.kind !== 'agent' || item.status !== 'done') return rule;
  const duration = item.updatedAt - item.startedAt;
  if (duration < QUICK_RUN_MS) return undefined;
  return duration >= LONG_RUN_MS ? rule : { ...rule, level: 'P2' };
};

const bodyOf = (item: HubActivityItem, status: HubActivityStatus): string => {
  if (status === 'needs_input') return item.prompt?.title ?? item.task ?? '';
  return (item.preview || item.task || '').slice(-300);
};

/**
 * Turns Hub activity transitions into notification events. The first snapshot
 * only sets the baseline, so restarting the app never replays old work.
 */
export const createActivityNotifier = (emit: (event: InternalEvent) => void) => {
  const last = new Map<string, HubActivityStatus>();
  let seeded = false;

  return (snapshot: HubActivitySnapshot): void => {
    const present = new Set<string>();
    for (const item of snapshot.items) {
      present.add(item.id);
      const previous = last.get(item.id);
      last.set(item.id, item.status);
      if (!seeded || previous === item.status) continue;
      // Work that appears already finished was not watched running; only report it if it needs the user.
      if (previous === undefined && item.status !== 'needs_input' && item.status !== 'error') continue;
      const rule = gradeCompletion(item, RULES[item.kind]?.[item.status]);
      if (!rule) continue;
      const name = item.title || LABEL[item.kind];
      emit({
        key: `${item.id}:${item.status}:${item.startedAt}:${item.prompt?.id ?? ''}`,
        source: SOURCE[item.kind],
        sourceLabel: LABEL[item.kind],
        title: rule.english(name),
        body: bodyOf(item, item.status),
        route: item.route,
        hint: { level: rule.level, category: 'system', reason: rule.reason },
        i18n: { title: `${KEY_PREFIX}.${rule.key}`, params: { name } },
      });
    }
    for (const id of last.keys()) if (!present.has(id)) last.delete(id);
    seeded = true;
  };
};
