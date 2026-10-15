/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from 'node:crypto';
import type {
  ConnectorDraft,
  ConnectorTestResult,
  HubNotification,
  NotificationCategory,
  NotificationConnector,
  NotificationFeedbackAction,
  NotificationHubSnapshot,
  NotificationLevel,
  NotificationQuery,
  NotificationRules,
  NotificationSourceKind,
  NotificationSummary,
  NotificationText,
  OsNotificationApp,
  WebConnector,
} from '@/common/types/platform/notificationHub';
import { NOTIFICATION_LEVELS } from '@/common/types/platform/notificationHub';
import type { NotificationClassifierFn } from './notificationClassifier';
import { normalizeRules, pruneExpired, type NotificationStore } from './notificationStore';
import type { ImapAccount, ImapFetchOptions, ImapFetchResult } from './imapClient';
import type { FeedFetcher } from './feedConnector';
import type { UnreadChange } from './webTitleWatcher';
import { listOsApps, type OsToastReader } from '../notificationSources/osToastSource';
import { createPackageNotificationGate, normalizePackagePost } from '../notificationSources/packageAppSource';
import { createSourceRegistry } from '../notificationSources/sourceRegistry';
import {
  adapterFor,
  cleanText,
  type ConnectorBase,
  type SourceAdapterRegistry,
  type SourceSignals,
} from '../notificationSources/sourceAdapter';
import type { CapturedWebNotification } from '../notificationSources/webNotificationCapture';
import { normalizeQuery, summarizeNotifications } from '../notificationInsights/notificationQuery';
import {
  EscalationQueue,
  isAmbiguous,
  type EscalationChat,
  type EscalationDecision,
} from '../notificationTriage/escalation';
import { senderIdentity } from '../notificationTriage/redaction';
import { recordReputation, reputationKey, reputationScore } from '../notificationTriage/senderReputation';
import { applyTriage, deliveryFor } from '../notificationTriage/triagePolicy';

export type IngestInput = {
  /** Stable identity of the underlying event; the same key is stored once. */
  key: string;
  source: NotificationSourceKind;
  connectorId?: string;
  sourceLabel: string;
  account?: string;
  sender?: string;
  title: string;
  body: string;
  route?: string;
  url?: string;
  createdAt?: number;
  rawRef?: string;
  signals?: SourceSignals;
  /** A package suggested its post is important (capped at P1 by the rules). */
  packageImportant?: boolean;
  hint?: { level: NotificationLevel; category: NotificationCategory; reason: string };
  i18n?: NotificationText;
  /** Unread items with this group are replaced instead of piling up (e.g. a site's unread counter). */
  group?: string;
};

export type SecretVault = {
  get: (connectorId: string) => Promise<string | undefined>;
  set: (connectorId: string, secret: string) => Promise<void>;
  remove: (connectorId: string) => Promise<void>;
};

export type NotificationHubDeps = {
  store: NotificationStore;
  classify: NotificationClassifierFn;
  secrets: SecretVault;
  fetchMail: (account: ImapAccount, options: ImapFetchOptions) => Promise<ImapFetchResult>;
  fetchFeed: FeedFetcher;
  /** Offered every new item whose delivery is `interrupt`; the alert policy decides whether it reaches the screen. */
  alert?: (notification: HubNotification, rules: NotificationRules) => void;
  layaReady?: () => boolean;
  now?: () => number;
  /** Windows notification list; undefined off Windows. */
  osReader?: () => OsToastReader | undefined;
  /** Chat for the opt-in LLM escalation with the configured model; undefined when no provider can serve it. */
  escalationChat?: (model: string) => EscalationChat | undefined;
  /** True when Tomny itself just showed this text as an OS alert. */
  recentlyShown?: (text: string) => boolean;
  /** Replaces source adapters (tests). */
  adapters?: Partial<SourceAdapterRegistry>;
};

const MAX_CONNECTORS = 30;
const POLL_TICK_MS = 60_000;
/** The same content arriving through two sources inside this window is stored once. */
export const DEDUPE_WINDOW_MS = 15 * 60_000;
const PRUNE_EVERY_MS = 60 * 60_000;

const idFor = (source: NotificationSourceKind, key: string): string =>
  `${source}:${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;

/** Fingerprint of who said what, independent of the source it arrived through. */
export const contentKey = (sender: string | undefined, title: string, body: string): string => {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256')
    .update(`${senderIdentity(sender) ?? ''}|${normalize(title)}|${normalize(body).slice(0, 120)}`)
    .digest('hex')
    .slice(0, 20);
};

const errorText = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 300);

const KINDS = new Set(['imap', 'feed', 'web', 'youtube', 'os']);

const noFetch = async (): Promise<never> => {
  throw new Error('validation does not fetch');
};

const VALIDATION_ADAPTERS = createSourceRegistry({ fetchMail: noFetch, fetchFeed: noFetch });

/**
 * Validates a connector draft synchronously (mail, feed, site, desktop apps; a
 * YouTube draft must already carry a channel id here). Returns an error code
 * instead of throwing. The hub's `saveConnector` also resolves YouTube handles.
 */
export const validateConnector = (
  draft: ConnectorDraft,
  existing: NotificationConnector | undefined
): { connector: NotificationConnector; password?: string } | { error: string } => {
  const label = cleanText(draft.label, 80);
  if (!label) return { error: 'label' };
  if (!KINDS.has(draft.kind)) return { error: 'kind' };
  if (draft.kind === 'youtube') {
    const channelId = cleanText(draft.channelId, 40);
    if (!/^UC[\w-]{22}$/.test(channelId)) return { error: 'channel' };
  }
  const base: ConnectorBase = { id: existing?.id ?? randomUUID(), label, enabled: draft.enabled !== false };
  const result = adapterFor<NotificationConnector>(VALIDATION_ADAPTERS, draft).validate(
    draft as never,
    base,
    existing as never
  );
  if (result instanceof Promise) return { error: 'kind' };
  if ('error' in result) return result;
  return result.secret ? { connector: result.connector, password: result.secret } : { connector: result.connector };
};

const cleanList = (values: unknown, limit: number): string[] =>
  Array.isArray(values)
    ? [
        ...new Set(
          values
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim().slice(0, 200))
            .filter(Boolean)
        ),
      ].slice(0, limit)
    : [];

const withoutKey = (list: string[], key: string): string[] =>
  list.filter((entry) => entry.toLowerCase() !== key.toLowerCase());

export class NotificationHubService {
  private readonly listeners = new Set<(snapshot: NotificationHubSnapshot) => void>();
  private readonly syncing = new Set<string>();
  private readonly adapters: SourceAdapterRegistry;
  private readonly escalation: EscalationQueue;
  private readonly packageGate: ReturnType<typeof createPackageNotificationGate>;
  private pollTimer?: NodeJS.Timeout;
  private notifyTimer?: NodeJS.Timeout;
  private lastPruneAt = 0;
  private readonly now: () => number;

  constructor(private readonly deps: NotificationHubDeps) {
    this.now = deps.now ?? Date.now;
    this.adapters = {
      ...createSourceRegistry({
        fetchMail: deps.fetchMail,
        fetchFeed: deps.fetchFeed,
        osReader: deps.osReader,
        recentlyShown: deps.recentlyShown,
      }),
      ...deps.adapters,
    };
    this.packageGate = createPackageNotificationGate(this.now);
    this.escalation = new EscalationQueue({
      rules: () => this.rules().llm,
      chat: () => {
        const { model } = this.rules().llm;
        return model ? deps.escalationChat?.(model) : undefined;
      },
      ledger: {
        read: () => this.deps.store.read().escalation,
        write: (ledger) => {
          this.deps.store.update((document) => {
            document.escalation = ledger;
          });
          this.changed();
        },
      },
      apply: (decisions) => this.applyEscalation(decisions),
      now: this.now,
    });
  }

  private rules(): NotificationRules {
    return this.deps.store.read().settings.rules;
  }

  snapshot(): NotificationHubSnapshot {
    const document = this.deps.store.read();
    return {
      items: document.items.map((item) => ({ ...item })),
      settings: {
        connectors: document.settings.connectors.map((connector) => ({ ...connector })),
        rules: structuredClone(document.settings.rules),
      },
      status: Object.values(document.status).map((status) => ({ ...status })),
      layaReady: this.deps.layaReady?.() ?? false,
      escalation: this.escalation.status(),
    };
  }

  /** What agents may read: items and rules, never connectors, cursors or secrets. */
  readView(): { items: readonly HubNotification[]; rules: NotificationRules } {
    const document = this.deps.store.read();
    return { items: document.items.map((item) => ({ ...item })), rules: structuredClone(document.settings.rules) };
  }

  subscribe(listener: (snapshot: NotificationHubSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined;
      const snapshot = this.snapshot();
      for (const listener of this.listeners) {
        try {
          listener(snapshot);
        } catch (error) {
          console.error('[NotificationHub] listener failed:', error);
        }
      }
    }, 150);
    this.notifyTimer.unref?.();
  }

  private offerAlert(notification: HubNotification, rules: NotificationRules): void {
    try {
      this.deps.alert?.(notification, rules);
    } catch (error) {
      console.error('[NotificationHub] alert failed:', error);
    }
  }

  /** Classifies, triages and stores one event. Returns undefined when it was already stored or is a duplicate. */
  async ingest(input: IngestInput): Promise<HubNotification | undefined> {
    const id = idFor(input.source, input.key);
    const now = this.now();
    const title = input.title.slice(0, 300);
    const body = input.body.slice(0, 600);
    const dedupeKey = contentKey(input.sender, title, body);
    const isDuplicate = (items: readonly HubNotification[]): boolean =>
      items.some(
        (item) =>
          item.id === id ||
          (!input.group &&
            item.dedupeKey === dedupeKey &&
            Math.abs((item.receivedAt ?? item.createdAt) - now) < DEDUPE_WINDOW_MS)
      );
    if (isDuplicate(this.deps.store.read().items)) return undefined;
    const rules = this.rules();
    const classification = await this.deps.classify(
      {
        source: input.source,
        sender: input.sender,
        title,
        body,
        hint: input.hint,
        signals: input.signals,
        packageImportant: input.packageImportant,
      },
      rules
    );
    const reputationSubject =
      input.account && input.connectorId ? `${input.connectorId}:${input.account}` : input.connectorId;
    const triage = applyTriage(classification, {
      rules,
      source: input.source,
      connectorId: input.connectorId,
      reputation: reputationScore(this.deps.store.read().reputation, reputationKey(input.sender, reputationSubject)),
    });
    const notification: HubNotification = {
      id,
      source: input.source,
      ...(input.connectorId ? { connectorId: input.connectorId } : {}),
      sourceLabel: input.sourceLabel.slice(0, 80),
      ...(input.account ? { account: input.account.slice(0, 200) } : {}),
      ...(input.sender ? { sender: input.sender.slice(0, 200) } : {}),
      title,
      body,
      ...(input.route ? { route: input.route } : {}),
      ...(input.url ? { url: input.url } : {}),
      createdAt: input.createdAt ?? now,
      receivedAt: now,
      level: triage.level,
      category: triage.category,
      classifiedBy: triage.classifiedBy,
      reason: triage.reason,
      delivery: triage.delivery,
      ...(triage.confidence !== undefined ? { confidence: triage.confidence } : {}),
      dedupeKey,
      ...(input.rawRef ? { rawRef: input.rawRef.slice(0, 300) } : {}),
      read: triage.level === 'P3',
      ...(input.i18n ? { i18n: input.i18n } : {}),
      ...(input.group ? { group: input.group } : {}),
    };
    let stored = false;
    this.deps.store.update((document) => {
      if (isDuplicate(document.items)) return;
      if (input.group) {
        const group = input.group;
        document.items = document.items.filter((item) => item.read || item.group !== group);
      }
      document.items.unshift(notification);
      stored = true;
    });
    if (!stored) return undefined;
    this.changed();
    if (notification.delivery === 'interrupt') this.offerAlert(notification, rules);
    if (!triage.final && isAmbiguous(notification)) this.escalation.enqueue(notification);
    return notification;
  }

  /** Applies opt-in model decisions to items the rules placed and nobody corrected since. */
  private applyEscalation(decisions: readonly EscalationDecision[]): void {
    const rules = this.rules();
    const promoted: HubNotification[] = [];
    this.deps.store.update((document) => {
      for (const decision of decisions) {
        const item = document.items.find((entry) => entry.id === decision.id);
        if (!item || item.classifiedBy !== 'rules') continue;
        const wasInterrupting = item.delivery === 'interrupt';
        item.level = decision.level;
        item.category = decision.category;
        item.classifiedBy = 'llm';
        item.reason = 'llm';
        item.delivery = deliveryFor(decision.level, rules);
        if (decision.level === 'P3') item.read = true;
        if (item.delivery === 'interrupt' && !wasInterrupting && !item.read) promoted.push({ ...item });
      }
    });
    this.changed();
    for (const item of promoted) this.offerAlert(item, rules);
  }

  markRead(ids: readonly string[]): boolean {
    const wanted = new Set(ids);
    let changed = false;
    this.deps.store.update((document) => {
      for (const item of document.items) {
        if (wanted.has(item.id) && !item.read) {
          item.read = true;
          changed = true;
        }
      }
    });
    if (changed) this.changed();
    return changed;
  }

  markAllRead(): boolean {
    return this.markRead(
      this.deps.store
        .read()
        .items.filter((item) => !item.read)
        .map((item) => item.id)
    );
  }

  /** Removing an unread item without opening it counts against its sender when learning is on. */
  remove(ids: readonly string[]): boolean {
    const wanted = new Set(ids);
    let changed = false;
    const now = this.now();
    this.deps.store.update((document) => {
      const before = document.items.length;
      if (document.settings.rules.learnFromFeedback) {
        for (const item of document.items) {
          if (!wanted.has(item.id) || item.read || item.classifiedBy === 'user') continue;
          const key = reputationKey(
            item.sender,
            item.account && item.connectorId ? `${item.connectorId}:${item.account}` : item.connectorId
          );
          if (key) recordReputation(document.reputation, key, 'dismissed', now);
        }
      }
      document.items = document.items.filter((item) => !wanted.has(item.id));
      changed = document.items.length !== before;
    });
    if (changed) this.changed();
    return changed;
  }

  clear(level?: NotificationLevel): boolean {
    let changed = false;
    this.deps.store.update((document) => {
      const before = document.items.length;
      document.items = level ? document.items.filter((item) => item.level !== level) : [];
      changed = document.items.length !== before;
    });
    if (changed) this.changed();
    return changed;
  }

  /** User correction. With `remember`, the sender joins the VIP (P0) or muted (P3) list. */
  reclassify(id: string, level: NotificationLevel, remember = false): boolean {
    if (!NOTIFICATION_LEVELS.includes(level)) return false;
    let changed = false;
    this.deps.store.update((document) => {
      const item = document.items.find((entry) => entry.id === id);
      if (!item) return;
      item.level = level;
      item.classifiedBy = 'user';
      item.reason = 'user';
      item.delivery = deliveryFor(level, document.settings.rules);
      changed = true;
      const sender = item.sender?.match(/<([^>]+)>/)?.[1] ?? item.sender;
      if (!remember || !sender) return;
      const rules = document.settings.rules;
      rules.vipSenders = withoutKey(rules.vipSenders, sender);
      rules.mutedSenders = withoutKey(rules.mutedSenders, sender);
      if (level === 'P0') rules.vipSenders.push(sender);
      if (level === 'P3') rules.mutedSenders.push(sender);
    });
    if (changed) this.changed();
    return changed;
  }

  /**
   * Learning and one-click controls: `opened` raises the sender's reputation and
   * marks the item read; mute/unmute act on the item's source (connector, package
   * or Tomny event kind); boost/mute sender edit the VIP and muted lists.
   */
  feedback(id: string, action: NotificationFeedbackAction): boolean {
    let changed = false;
    const now = this.now();
    this.deps.store.update((document) => {
      const item = document.items.find((entry) => entry.id === id);
      if (!item) return;
      const rules = document.settings.rules;
      const sourceKey = item.connectorId ?? item.source;
      // Chat toasts and page notifications carry the person's name in the title.
      const who =
        senderIdentity(item.sender) ?? (item.source === 'os' || item.source === 'web' ? item.title.trim() : undefined);
      switch (action) {
        case 'opened': {
          const key = reputationKey(
            item.sender,
            item.account && item.connectorId ? `${item.connectorId}:${item.account}` : item.connectorId
          );
          if (key && rules.learnFromFeedback) recordReputation(document.reputation, key, 'opened', now);
          item.read = true;
          changed = true;
          return;
        }
        case 'muteSource':
          rules.mutedSources = [...withoutKey(rules.mutedSources, sourceKey), sourceKey].slice(-200);
          changed = true;
          return;
        case 'unmuteSource':
          rules.mutedSources = withoutKey(rules.mutedSources, sourceKey);
          changed = true;
          return;
        case 'boostSender':
        case 'muteSender': {
          if (!who) return;
          rules.vipSenders = withoutKey(rules.vipSenders, who);
          rules.mutedSenders = withoutKey(rules.mutedSenders, who);
          if (action === 'boostSender') rules.vipSenders.push(who.slice(0, 200));
          else rules.mutedSenders.push(who.slice(0, 200));
          changed = true;
          return;
        }
      }
    });
    if (changed) this.changed();
    return changed;
  }

  /** Local digest of a period; no model is involved. */
  summary(query: unknown): NotificationSummary {
    const view = this.readView();
    return summarizeNotifications(
      view.items,
      normalizeQuery(query) satisfies NotificationQuery,
      view.rules,
      this.now()
    );
  }

  saveRules(rules: NotificationRules): NotificationRules {
    const next = normalizeRules({
      ...rules,
      vipSenders: cleanList(rules.vipSenders, 200),
      mutedSenders: cleanList(rules.mutedSenders, 200),
      urgentKeywords: cleanList(rules.urgentKeywords, 100),
      mutedSources: cleanList(rules.mutedSources, 200),
    });
    this.deps.store.update((document) => {
      document.settings.rules = next;
      pruneExpired(document, this.now());
    });
    this.changed();
    return next;
  }

  async saveConnector(draft: ConnectorDraft): Promise<NotificationConnector | { error: string }> {
    const document = this.deps.store.read();
    const existing = draft.id ? document.settings.connectors.find((connector) => connector.id === draft.id) : undefined;
    if (draft.id && !existing) return { error: 'missing' };
    if (existing && existing.kind !== draft.kind) return { error: 'kind' };
    if (!KINDS.has(draft.kind)) return { error: 'kind' };
    if (!existing && document.settings.connectors.length >= MAX_CONNECTORS) return { error: 'limit' };
    const label = cleanText(draft.label, 80);
    if (!label) return { error: 'label' };
    const adapter = adapterFor<NotificationConnector>(this.adapters, draft);
    const result = await adapter.validate(
      draft as never,
      { id: existing?.id ?? randomUUID(), label, enabled: draft.enabled !== false },
      existing as never
    );
    if ('error' in result) return result;
    if (result.secret) await this.deps.secrets.set(result.connector.id, result.secret);
    const connector = result.connector;
    const reset = existing && adapter.sourceChanged?.(existing as never, connector as never);
    this.deps.store.update((current) => {
      const index = current.settings.connectors.findIndex((entry) => entry.id === connector.id);
      if (index >= 0) current.settings.connectors[index] = connector;
      else current.settings.connectors.push(connector);
      if (reset) {
        delete current.cursors[connector.id];
        delete current.status[connector.id];
      }
    });
    this.changed();
    if (connector.enabled && !adapter.passive) void this.sync(connector.id);
    return connector;
  }

  async removeConnector(id: string): Promise<boolean> {
    const exists = this.deps.store.read().settings.connectors.some((connector) => connector.id === id);
    if (!exists) return false;
    await this.deps.secrets.remove(id).catch((): void => undefined);
    this.deps.store.update((document) => {
      document.settings.connectors = document.settings.connectors.filter((connector) => connector.id !== id);
      document.settings.rules.mutedSources = document.settings.rules.mutedSources.filter((entry) => entry !== id);
      delete document.cursors[id];
      delete document.status[id];
    });
    this.changed();
    return true;
  }

  webConnectors(): WebConnector[] {
    return this.deps.store
      .read()
      .settings.connectors.filter((connector): connector is WebConnector => connector.kind === 'web');
  }

  /** A watched site's unread counter went up. */
  async onWebUnread(change: UnreadChange): Promise<void> {
    const { connector } = change;
    await this.ingest({
      key: `${connector.id}:${change.count}:${Math.floor(this.now() / 60_000)}`,
      source: 'web',
      connectorId: connector.id,
      sourceLabel: connector.label,
      account: connector.origin,
      title: `${connector.label}: ${change.count} unread`,
      body: change.title,
      url: change.url,
      group: `web:${connector.id}`,
      i18n: {
        title: 'common.notificationHub.event.webUnread',
        params: { name: connector.label, count: change.count, added: change.added },
      },
    });
    this.setStatus(connector.id, { lastSyncAt: this.now(), lastCount: change.count, lastError: undefined });
  }

  /** A page on an allowed site raised a web notification (ChatGPT finished, a new message…). */
  async onWebNotification(captured: CapturedWebNotification): Promise<void> {
    const { connector } = captured;
    const identity =
      captured.tag || createHash('sha256').update(`${captured.title}|${captured.body}`).digest('hex').slice(0, 16);
    await this.ingest({
      key: `${connector.id}:notification:${identity}:${Math.floor(this.now() / 60_000)}`,
      source: 'web',
      connectorId: connector.id,
      sourceLabel: connector.label,
      account: connector.origin,
      title: captured.title,
      body: captured.body,
      url: captured.url,
      rawRef: captured.tag ? `web-tag:${captured.tag}` : undefined,
    });
    this.setStatus(connector.id, { lastSyncAt: this.now(), lastError: undefined });
  }

  /**
   * Entry point of the `notifications.post` package capability. The arguments are
   * untrusted; malformed, rate-limited or disabled posts return false.
   */
  postFromPackage(packageId: string, args: unknown): boolean {
    if (!this.rules().packageApps || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(packageId) || packageId.length > 200) {
      return false;
    }
    const post = normalizePackagePost(args);
    if (!post) return false;
    const event = this.packageGate(packageId, packageId, post);
    if ('error' in event) return false;
    void this.ingest({
      key: event.key,
      source: 'app',
      connectorId: `app:${packageId}`,
      sourceLabel: event.sourceLabel,
      account: packageId,
      title: event.title,
      body: event.body,
      url: event.url,
      packageImportant: event.important,
    });
    return true;
  }

  private setStatus(id: string, patch: { lastSyncAt?: number; lastError?: string; lastCount?: number }): void {
    this.deps.store.update((document) => {
      document.status[id] = { ...document.status[id], ...patch, id };
      if (patch.lastError === undefined) delete document.status[id]!.lastError;
    });
    this.changed();
  }

  /** Syncs one polled connector now. Returns how many new items it stored. */
  async sync(id: string): Promise<ConnectorTestResult> {
    const connector = this.deps.store.read().settings.connectors.find((entry) => entry.id === id);
    if (!connector) return { ok: false, error: 'missing' };
    const adapter = adapterFor<NotificationConnector>(this.adapters, connector);
    if (adapter.passive || !adapter.sync) return { ok: false, error: 'missing' };
    if (this.syncing.has(id)) return { ok: false, error: 'busy' };
    this.syncing.add(id);
    const controller = new AbortController();
    try {
      const result = await adapter.sync({
        connector,
        cursor: this.deps.store.read().cursors[id],
        secret: () => this.deps.secrets.get(id),
        now: this.now,
        signal: controller.signal,
      });
      let stored = 0;
      for (const item of result.items) {
        const added = await this.ingest({
          key: item.key,
          source: adapter.source,
          connectorId: connector.id,
          sourceLabel: connector.label,
          account: item.account ?? adapter.account?.(connector),
          sender: item.sender,
          title: item.title,
          body: item.body,
          url: item.url,
          createdAt: item.createdAt,
          rawRef: item.rawRef,
          signals: item.signals,
          hint: item.hint,
        });
        if (added) stored += 1;
      }
      this.deps.store.update((document) => {
        document.cursors[id] = result.cursor;
      });
      this.setStatus(id, { lastSyncAt: this.now(), lastCount: stored, lastError: undefined });
      return { ok: true, count: stored };
    } catch (error) {
      const message = errorText(error);
      this.setStatus(id, { lastSyncAt: this.now(), lastError: message });
      return { ok: false, error: message };
    } finally {
      controller.abort();
      this.syncing.delete(id);
    }
  }

  private polled(connector: NotificationConnector): boolean {
    const adapter = adapterFor<NotificationConnector>(this.adapters, connector);
    return connector.enabled && !adapter.passive && Boolean(adapter.sync);
  }

  async syncAll(): Promise<void> {
    const connectors = this.deps.store.read().settings.connectors.filter((entry) => this.polled(entry));
    for (const connector of connectors) await this.sync(connector.id);
  }

  /** Desktop apps seen in the Windows notification list, for the picker. */
  async osApps(): Promise<OsNotificationApp[]> {
    try {
      return await listOsApps(this.deps.osReader?.(), this.now());
    } catch {
      return [];
    }
  }

  /** Polls connectors whose interval has passed and applies the retention window. */
  private async tick(): Promise<void> {
    if (this.now() - this.lastPruneAt >= PRUNE_EVERY_MS) {
      this.lastPruneAt = this.now();
      let removed = 0;
      this.deps.store.update((document) => {
        removed = pruneExpired(document, this.now());
      });
      if (removed > 0) this.changed();
    }
    const document = this.deps.store.read();
    for (const connector of document.settings.connectors) {
      if (!this.polled(connector) || !('intervalMinutes' in connector)) continue;
      const last = document.status[connector.id]?.lastSyncAt ?? 0;
      if (this.now() - last >= connector.intervalMinutes * 60_000) await this.sync(connector.id);
    }
  }

  start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => void this.tick(), POLL_TICK_MS);
    this.pollTimer.unref?.();
    const first = setTimeout(() => void this.tick(), 15_000);
    first.unref?.();
  }

  dispose(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.pollTimer = undefined;
    this.escalation.dispose();
    this.deps.store.flush();
  }
}
