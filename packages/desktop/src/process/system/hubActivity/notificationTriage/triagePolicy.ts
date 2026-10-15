/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  HubNotification,
  NotificationCategory,
  NotificationClassifier,
  NotificationDelivery,
  NotificationLevel,
  NotificationRules,
  NotificationSourceKind,
} from '@/common/types/platform/notificationHub';
import { NOTIFICATION_LEVELS } from '@/common/types/platform/notificationHub';
import { REPUTATION_STEP } from './senderReputation';

/**
 * Triage after classification, in this order and at no model cost:
 * 1. a muted source silences the item;
 * 2. learned sender reputation moves a rule-based level one step (never to P0);
 * 3. the interrupt threshold turns the level into a delivery.
 */
export type TriageClassification = {
  level: NotificationLevel;
  category: NotificationCategory;
  classifiedBy: NotificationClassifier;
  reason: string;
  /** The user's lists, one-time codes, security alerts and Tomny's own events are not adjusted. */
  final?: boolean;
  confidence?: number;
};

export type TriageResult = TriageClassification & { delivery: NotificationDelivery };

const RANK: Record<NotificationLevel, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export const levelRank = (level: NotificationLevel): number => RANK[level];

/** True when `level` is at least as urgent as `threshold`. */
export const atLeast = (level: NotificationLevel, threshold: NotificationLevel): boolean =>
  RANK[level] <= RANK[threshold];

/** Noise stays silent; levels at or above the interrupt threshold interrupt; the rest waits in the feed. */
export const deliveryFor = (
  level: NotificationLevel,
  rules: Pick<NotificationRules, 'interruptLevel'>
): NotificationDelivery => {
  if (level === 'P3') return 'silent';
  return atLeast(level, rules.interruptLevel) ? 'interrupt' : 'digest';
};

/** Delivery of a stored item; items saved before delivery existed derive it from their level. */
export const deliveryOf = (
  item: Pick<HubNotification, 'delivery' | 'level'>,
  rules: Pick<NotificationRules, 'interruptLevel'>
): NotificationDelivery => item.delivery ?? deliveryFor(item.level, rules);

/** A source is muted by its connector id, `app:<packageId>`, or its whole kind. */
export const isSourceMuted = (
  rules: Pick<NotificationRules, 'mutedSources'>,
  item: { source: NotificationSourceKind; connectorId?: string }
): boolean =>
  rules.mutedSources.some(
    (entry) => entry === item.source || (item.connectorId !== undefined && entry === item.connectorId)
  );

const shift = (level: NotificationLevel, steps: number, floor: NotificationLevel): NotificationLevel => {
  const next = Math.min(3, Math.max(RANK[floor], RANK[level] + steps));
  return NOTIFICATION_LEVELS[next] ?? level;
};

export const applyTriage = (
  classification: TriageClassification,
  context: {
    rules: Pick<NotificationRules, 'interruptLevel' | 'mutedSources' | 'learnFromFeedback'>;
    source: NotificationSourceKind;
    connectorId?: string;
    reputation: number;
  }
): TriageResult => {
  const { rules } = context;
  if (isSourceMuted(rules, context) && classification.reason !== 'needs-input') {
    return { ...classification, level: 'P3', reason: 'muted-source', final: true, delivery: 'silent' };
  }
  let result: TriageClassification = classification;
  const adjustable = !classification.final && classification.classifiedBy !== 'user' && rules.learnFromFeedback;
  if (adjustable && context.reputation >= REPUTATION_STEP && classification.level !== 'P0') {
    // Learned trust lifts at most to P1: a sender earns attention, not interruptions.
    const level = shift(classification.level, -1, 'P1');
    if (level !== classification.level) result = { ...classification, level, reason: 'reputation-up' };
  } else if (adjustable && context.reputation <= -REPUTATION_STEP && classification.level !== 'P0') {
    const level = shift(classification.level, 1, 'P0');
    if (level !== classification.level) result = { ...classification, level, reason: 'reputation-down' };
  }
  return { ...result, delivery: deliveryFor(result.level, rules) };
};
