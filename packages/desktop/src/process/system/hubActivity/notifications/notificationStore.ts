/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  HubNotification,
  NotificationConnector,
  NotificationConnectorStatus,
  NotificationHubSettings,
  NotificationRules,
} from '@/common/types/platform/notificationHub';
import { DEFAULT_NOTIFICATION_RULES } from '@/common/types/platform/notificationHub';
import type { ConnectorCursor } from '../notificationSources/sourceAdapter';
import type { EscalationLedger } from '../notificationTriage/escalation';
import { normalizeReputation, type ReputationBook } from '../notificationTriage/senderReputation';

export type { ConnectorCursor } from '../notificationSources/sourceAdapter';

export type NotificationHubDocument = {
  version: 1;
  items: HubNotification[];
  settings: NotificationHubSettings;
  status: Record<string, NotificationConnectorStatus>;
  cursors: Record<string, ConnectorCursor>;
  /** Learned sender reputation; Main only. */
  reputation: ReputationBook;
  /** Today's LLM escalation usage; Main only. */
  escalation?: EscalationLedger;
};

export const MAX_ITEMS = 1000;
export const MAX_SEEN_PER_FEED = 300;
const DAY_MS = 24 * 60 * 60_000;
const CONNECTOR_KINDS = new Set(['imap', 'feed', 'web', 'youtube', 'os']);
const FILE_NAME = 'notification-hub.json';
const WRITE_DELAY_MS = 400;

export const DEFAULT_RULES: NotificationRules = DEFAULT_NOTIFICATION_RULES;

const emptyDocument = (): NotificationHubDocument => ({
  version: 1,
  items: [],
  settings: { connectors: [], rules: normalizeRules(undefined) },
  status: {},
  cursors: {},
  reputation: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const strings = (value: unknown, limit: number): string[] =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.slice(0, 200))
        .slice(0, limit)
    : [];

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

const bounded = (value: unknown, fallback: number, minimum: number, maximum: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value)))
    : fallback;

/** Fills every rule, keeping only well-formed values; unknown or missing ones take the default. */
export const normalizeRules = (raw: unknown): NotificationRules => {
  const rules = isRecord(raw) ? raw : {};
  const quiet = isRecord(rules.quietHours) ? rules.quietHours : {};
  const llm = isRecord(rules.llm) ? rules.llm : {};
  const defaults = DEFAULT_RULES.quietHours;
  return {
    vipSenders: strings(rules.vipSenders, 200),
    mutedSenders: strings(rules.mutedSenders, 200),
    urgentKeywords: strings(rules.urgentKeywords, 100),
    mutedSources: strings(rules.mutedSources, 200),
    useLaya: flag(rules.useLaya, DEFAULT_RULES.useLaya),
    interruptLevel: rules.interruptLevel === 'P1' ? 'P1' : 'P0',
    learnFromFeedback: flag(rules.learnFromFeedback, DEFAULT_RULES.learnFromFeedback),
    packageApps: flag(rules.packageApps, DEFAULT_RULES.packageApps),
    retentionDays: bounded(rules.retentionDays, DEFAULT_RULES.retentionDays, 1, 365),
    llm: {
      enabled: flag(llm.enabled, DEFAULT_RULES.llm.enabled),
      model: typeof llm.model === 'string' ? llm.model.trim().slice(0, 200) : DEFAULT_RULES.llm.model,
      dailyLimit: bounded(llm.dailyLimit, DEFAULT_RULES.llm.dailyLimit, 0, 500),
      includeSnippet: flag(llm.includeSnippet, DEFAULT_RULES.llm.includeSnippet),
    },
    systemAlertsForP0: flag(rules.systemAlertsForP0, DEFAULT_RULES.systemAlertsForP0),
    sound: flag(rules.sound, DEFAULT_RULES.sound),
    bringToFrontOnInput: flag(rules.bringToFrontOnInput, DEFAULT_RULES.bringToFrontOnInput),
    ramAlert: flag(rules.ramAlert, DEFAULT_RULES.ramAlert),
    quietHours: {
      enabled: flag(quiet.enabled, defaults.enabled),
      start: typeof quiet.start === 'string' && TIME.test(quiet.start) ? quiet.start : defaults.start,
      end: typeof quiet.end === 'string' && TIME.test(quiet.end) ? quiet.end : defaults.end,
    },
  };
};

/** Rebuilds a document from disk, dropping anything malformed instead of failing. */
export const normalizeDocument = (raw: unknown): NotificationHubDocument => {
  const base = emptyDocument();
  if (!isRecord(raw)) return base;
  const settings = isRecord(raw.settings) ? raw.settings : {};
  return {
    version: 1,
    items: Array.isArray(raw.items)
      ? (raw.items.filter((item) => isRecord(item) && typeof item.id === 'string') as HubNotification[]).slice(
          0,
          MAX_ITEMS
        )
      : [],
    settings: {
      connectors: Array.isArray(settings.connectors)
        ? (settings.connectors.filter(
            (connector) =>
              isRecord(connector) &&
              typeof connector.id === 'string' &&
              typeof connector.kind === 'string' &&
              CONNECTOR_KINDS.has(connector.kind)
          ) as NotificationConnector[])
        : [],
      rules: normalizeRules(settings.rules),
    },
    status: isRecord(raw.status) ? (raw.status as Record<string, NotificationConnectorStatus>) : {},
    cursors: isRecord(raw.cursors) ? (raw.cursors as Record<string, ConnectorCursor>) : {},
    reputation: normalizeReputation(raw.reputation),
    ...(isRecord(raw.escalation) && typeof raw.escalation.day === 'string' && typeof raw.escalation.used === 'number'
      ? { escalation: raw.escalation as EscalationLedger }
      : {}),
  };
};

/** Drops items older than the retention window. Returns how many were removed. */
export const pruneExpired = (document: NotificationHubDocument, now: number): number => {
  const cutoff = now - document.settings.rules.retentionDays * DAY_MS;
  const before = document.items.length;
  document.items = document.items.filter((item) => item.createdAt >= cutoff);
  return before - document.items.length;
};

export type NotificationStore = {
  read: () => NotificationHubDocument;
  update: (mutate: (document: NotificationHubDocument) => void) => void;
  flush: () => void;
};

/** JSON file in the app data directory, written atomically and coalesced. */
export const createNotificationStore = (dir: string): NotificationStore => {
  const filePath = path.join(dir, FILE_NAME);
  let document: NotificationHubDocument | undefined;
  let timer: NodeJS.Timeout | undefined;

  const load = (): NotificationHubDocument => {
    if (document) return document;
    try {
      document = normalizeDocument(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch {
      document = emptyDocument();
    }
    return document;
  };

  const flush = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!document) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const temp = `${filePath}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(document), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temp, filePath);
    } catch (error) {
      console.error('[NotificationHub] Failed to save notifications:', error);
    }
  };

  return {
    read: load,
    update: (mutate) => {
      const current = load();
      mutate(current);
      current.items = current.items.toSorted((left, right) => right.createdAt - left.createdAt).slice(0, MAX_ITEMS);
      if (!timer) {
        timer = setTimeout(flush, WRITE_DELAY_MS);
        timer.unref?.();
      }
    },
    flush,
  };
};
