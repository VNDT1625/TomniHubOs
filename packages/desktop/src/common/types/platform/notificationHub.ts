/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { bridge } from '@office-ai/platform';

/**
 * Laya priority matrix: P0 is critical, P1 important, P2 normal (the Digest),
 * P3 noise kept for review. Only items whose delivery is `interrupt` may leave
 * the drawer as an OS alert.
 */
export type NotificationLevel = 'P0' | 'P1' | 'P2' | 'P3';

export const NOTIFICATION_LEVELS: readonly NotificationLevel[] = ['P0', 'P1', 'P2', 'P3'];

export type NotificationCategory =
  'work' | 'personal' | 'finance' | 'security' | 'promotion' | 'social' | 'system' | 'other';

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  'work',
  'personal',
  'finance',
  'security',
  'promotion',
  'social',
  'system',
  'other',
];

/**
 * Where a notification came from: Tomny itself, a connector the user allowed
 * (mail, feed, site, YouTube channel, desktop apps) or an installed package app.
 */
export type NotificationSourceKind =
  'agent' | 'schedule' | 'team' | 'system' | 'email' | 'feed' | 'web' | 'youtube' | 'os' | 'app';

export const NOTIFICATION_SOURCE_KINDS: readonly NotificationSourceKind[] = [
  'agent',
  'schedule',
  'team',
  'system',
  'email',
  'feed',
  'web',
  'youtube',
  'os',
  'app',
];

/** Who decided the level: the local Laya model, the deterministic rules, the user, or the opt-in LLM escalation. */
export type NotificationClassifier = 'laya' | 'rules' | 'user' | 'llm';

/** What a notification may do: alert now, wait in the feed, or stay hidden in Filtered. */
export type NotificationDelivery = 'interrupt' | 'digest' | 'silent';

export const NOTIFICATION_DELIVERIES: readonly NotificationDelivery[] = ['interrupt', 'digest', 'silent'];

/**
 * One normalized notification. Every source maps into this shape; `body` is the
 * short snippet (never a full message body) and `rawRef` points back to the
 * source item without carrying its content.
 */
export type HubNotification = {
  id: string;
  source: NotificationSourceKind;
  /** Connector id for connector sources, `app:<packageId>` for package apps; absent for Tomny's own events. */
  connectorId?: string;
  /** Display name of the source, e.g. "Work Gmail" or "Facebook". */
  sourceLabel: string;
  /** Account the item belongs to (mailbox address, channel, desktop app), when the source has several. */
  account?: string;
  /** Sender address or name, when the source has one. */
  sender?: string;
  title: string;
  /** Short snippet, at most 600 characters. Mail connectors keep it empty unless the user allows previews. */
  body: string;
  /** In-app route to open (Tomny events). */
  route?: string;
  /** Web page to open in the built-in browser (connector events). */
  url?: string;
  /** When the event happened at the source. */
  createdAt: number;
  /** When Tomny stored it. */
  receivedAt?: number;
  level: NotificationLevel;
  category: NotificationCategory;
  classifiedBy: NotificationClassifier;
  /** Short machine reason code for the level, e.g. `vip-sender`, `otp`, `promotion`. */
  reason: string;
  /** Absent on items stored before delivery existed; readers derive it from the level. */
  delivery?: NotificationDelivery;
  /** Classifier confidence in [0, 1] when a model decided. */
  confidence?: number;
  /** Content fingerprint used to drop the same message arriving through two sources. */
  dedupeKey?: string;
  /** Source-native reference (mail UID, feed entry id, toast order). Never content. */
  rawRef?: string;
  read: boolean;
  /** Unread items of one group replace each other (a site's unread counter). */
  group?: string;
  /** Tomny's own events carry translation keys so every locale renders them; `title`/`body` hold the English text. */
  i18n?: NotificationText;
};

export type NotificationText = {
  title: string;
  body?: string;
  params?: Record<string, string | number>;
};

export type ImapConnector = {
  id: string;
  kind: 'imap';
  label: string;
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  /** Mailbox to watch; defaults to INBOX. */
  mailbox: string;
  intervalMinutes: number;
  /** True once a password is stored in the OS-encrypted vault. The secret itself never leaves Main. */
  hasSecret: boolean;
  /** Read headers only (default). False also keeps a short preview of the text. */
  headersOnly?: boolean;
  /** Skip mail that is already read (default). */
  unreadOnly?: boolean;
};

export type FeedConnector = {
  id: string;
  kind: 'feed';
  label: string;
  enabled: boolean;
  url: string;
  intervalMinutes: number;
};

/**
 * A site the user allowed to notify through the built-in browser. When a tab on
 * this origin shows a higher unread count in its title (Facebook, Gmail,
 * Messenger, Zalo Web...), the hub records it. With `captureNotifications`, web
 * notifications the page itself raises (ChatGPT, Claude, Gemini, chat apps) are
 * taken into the hub instead of popping up directly.
 */
export type WebConnector = {
  id: string;
  kind: 'web';
  label: string;
  enabled: boolean;
  origin: string;
  captureNotifications?: boolean;
};

/** New uploads of one YouTube channel through its public feed (no API key). */
export type YoutubeConnector = {
  id: string;
  kind: 'youtube';
  label: string;
  enabled: boolean;
  /** Channel id (`UC…`), resolved from a URL or @handle when saved. */
  channelId: string;
  intervalMinutes: number;
};

/**
 * Notifications other desktop apps showed in Windows (Zalo, Telegram, Discord,
 * Outlook, browsers…), read from the Windows notification list. `apps` limits it
 * to chosen app ids; empty means every app except Tomny itself.
 */
export type OsConnector = {
  id: string;
  kind: 'os';
  label: string;
  enabled: boolean;
  apps: string[];
  intervalMinutes: number;
};

export type NotificationConnector = ImapConnector | FeedConnector | WebConnector | YoutubeConnector | OsConnector;

export type NotificationConnectorKind = NotificationConnector['kind'];

export type NotificationConnectorStatus = {
  id: string;
  lastSyncAt?: number;
  lastError?: string;
  /** Items seen on the last successful sync. */
  lastCount?: number;
};

/**
 * Opt-in escalation of unclear items to a configured model. Off by default; only
 * redacted subjects (and previews when allowed) leave the device, in small
 * batches, within a daily item budget.
 */
export type NotificationLlmRules = {
  enabled: boolean;
  /** Model id understood by the provider broker; empty keeps escalation off. */
  model: string;
  /** Items sent per day at most. */
  dailyLimit: number;
  /** Also send the redacted preview, not only the subject. */
  includeSnippet: boolean;
};

export type NotificationRules = {
  /** Senders (address, domain or name fragment) always ranked P0. */
  vipSenders: string[];
  /** Senders always filtered to P3. */
  mutedSenders: string[];
  /** Extra words that make a message urgent (P0). */
  urgentKeywords: string[];
  /** Muted sources: connector ids, `app:<packageId>` or source kinds such as `feed`. */
  mutedSources: string[];
  /** Use the local Laya model when it is already running. */
  useLaya: boolean;
  /** Lowest level that may interrupt (OS alert). P0 by default. */
  interruptLevel: 'P0' | 'P1';
  /** Learn sender reputation from what the user opens or dismisses. */
  learnFromFeedback: boolean;
  /** Accept notifications from installed package apps that declare `notifications.show`. */
  packageApps: boolean;
  /** Days to keep notifications. */
  retentionDays: number;
  llm: NotificationLlmRules;
  /** Show an OS notification for interrupting items. */
  systemAlertsForP0: boolean;
  /** Play the OS sound with an alert (never during quiet hours). */
  sound: boolean;
  /** Restore and flash the Tomny window when an agent waits for an answer while Tomny is in the background. */
  bringToFrontOnInput: boolean;
  /** Notify when memory use stays above 85%. */
  ramAlert: boolean;
  /** Daily window ("HH:mm", may cross midnight) in which only urgent items reach the screen, silently. */
  quietHours: { enabled: boolean; start: string; end: string };
};

export const DEFAULT_NOTIFICATION_RULES: NotificationRules = {
  vipSenders: [],
  mutedSenders: [],
  urgentKeywords: [],
  mutedSources: [],
  useLaya: true,
  interruptLevel: 'P0',
  learnFromFeedback: true,
  packageApps: true,
  retentionDays: 30,
  llm: { enabled: false, model: '', dailyLimit: 40, includeSnippet: false },
  systemAlertsForP0: true,
  sound: true,
  bringToFrontOnInput: true,
  ramAlert: true,
  quietHours: { enabled: false, start: '22:00', end: '07:00' },
};

export type NotificationHubSettings = {
  connectors: NotificationConnector[];
  rules: NotificationRules;
};

/** Daily usage of the opt-in LLM escalation. */
export type NotificationEscalationStatus = {
  /** Enabled and a model is set. */
  active: boolean;
  usedToday: number;
  limit: number;
  /** Items waiting for the next batch. */
  pending: number;
  lastRunAt?: number;
  lastError?: string;
};

export type NotificationHubSnapshot = {
  items: HubNotification[];
  settings: NotificationHubSettings;
  status: NotificationConnectorStatus[];
  layaReady: boolean;
  escalation?: NotificationEscalationStatus;
};

export type NotificationPeriod = '1h' | 'today' | '24h' | '7d' | 'all';

export type NotificationQuery = {
  period?: NotificationPeriod;
  /** Overrides `period` when set. */
  sinceMs?: number;
  source?: NotificationSourceKind;
  connectorId?: string;
  /** Include this level and anything more urgent. */
  minLevel?: NotificationLevel;
  unreadOnly?: boolean;
  /** Case-insensitive text in title, sender or source. */
  text?: string;
  limit?: number;
};

/** A notification as an agent or the summary card sees it: redacted, no raw body. */
export type NotificationDigestItem = {
  id: string;
  level: NotificationLevel;
  category: NotificationCategory;
  delivery: NotificationDelivery;
  source: NotificationSourceKind;
  sourceLabel: string;
  account?: string;
  sender?: string;
  title: string;
  snippet: string;
  createdAt: number;
  read: boolean;
  url?: string;
  route?: string;
};

export type NotificationSummary = {
  since: number;
  until: number;
  total: number;
  unread: number;
  byLevel: Record<NotificationLevel, number>;
  bySource: Array<{ key: string; label: string; source: NotificationSourceKind; count: number; unread: number }>;
  byCategory: Partial<Record<NotificationCategory, number>>;
  topSenders: Array<{ sender: string; count: number }>;
  /** Most important items first. */
  highlights: NotificationDigestItem[];
  /** Plain English digest an agent can rephrase. */
  text: string;
};

/** A desktop app that showed Windows notifications recently (id only, never content). */
export type OsNotificationApp = { appId: string; label: string; count: number; lastAt?: number };

export type NotificationFeedbackAction = 'opened' | 'muteSource' | 'unmuteSource' | 'boostSender' | 'muteSender';

export type ConnectorDraft =
  | (Omit<ImapConnector, 'id' | 'hasSecret'> & { id?: string; password?: string })
  | (Omit<FeedConnector, 'id'> & { id?: string })
  | (Omit<WebConnector, 'id'> & { id?: string })
  | (Omit<YoutubeConnector, 'id'> & { id?: string })
  | (Omit<OsConnector, 'id'> & { id?: string });

export type SaveConnectorResult = { connector?: NotificationConnector; error?: string };

export type ConnectorTestResult = { ok: boolean; count?: number; error?: string };

export const notificationHubChannels = {
  snapshot: bridge.buildProvider<NotificationHubSnapshot, void>('notification-hub.snapshot'),
  markRead: bridge.buildProvider<boolean, { ids: string[] }>('notification-hub.mark-read'),
  markAllRead: bridge.buildProvider<boolean, void>('notification-hub.mark-all-read'),
  remove: bridge.buildProvider<boolean, { ids: string[] }>('notification-hub.remove'),
  clear: bridge.buildProvider<boolean, { level?: NotificationLevel }>('notification-hub.clear'),
  /** User correction: sets the level and, with `remember`, adds the sender to the VIP or muted list. */
  reclassify: bridge.buildProvider<boolean, { id: string; level: NotificationLevel; remember?: boolean }>(
    'notification-hub.reclassify'
  ),
  /** Learning signal and one-click mute/boost for the item's source or sender. */
  feedback: bridge.buildProvider<boolean, { id: string; action: NotificationFeedbackAction }>(
    'notification-hub.feedback'
  ),
  /** Deterministic digest of a period; computed locally, no model involved. */
  summary: bridge.buildProvider<NotificationSummary, NotificationQuery>('notification-hub.summary'),
  /** Desktop apps seen in the Windows notification list, to pick from. Empty off Windows. */
  listOsApps: bridge.buildProvider<OsNotificationApp[], void>('notification-hub.list-os-apps'),
  /** `error` is a validation code: label, host, user, port, password, url, origin, channel, kind, missing or limit. */
  /** The draft is wrapped so the bridge's conditional parameter type does not distribute over the union. */
  saveConnector: bridge.buildProvider<SaveConnectorResult, { draft: ConnectorDraft }>(
    'notification-hub.save-connector'
  ),
  removeConnector: bridge.buildProvider<boolean, { id: string }>('notification-hub.remove-connector'),
  testConnector: bridge.buildProvider<ConnectorTestResult, { id: string }>('notification-hub.test-connector'),
  syncNow: bridge.buildProvider<boolean, { id?: string }>('notification-hub.sync-now'),
  saveRules: bridge.buildProvider<NotificationRules | null, NotificationRules>('notification-hub.save-rules'),
  changed: bridge.buildEmitter<NotificationHubSnapshot>('notification-hub.changed'),
};
