/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ConnectorDraft,
  NotificationCategory,
  NotificationConnector,
  NotificationConnectorKind,
  NotificationLevel,
  NotificationSourceKind,
} from '@/common/types/platform/notificationHub';

/**
 * The one contract every connector source implements. The hub owns storage,
 * triage, dedupe and alerts; an adapter only validates its connector and turns
 * its transport (IMAP, a feed, the Windows notification list…) into items.
 */

/** Sync bookkeeping per connector; kept in Main, never sent to the renderer. */
export type ConnectorCursor = {
  uidValidity?: number;
  lastUid?: number;
  /** Entry ids already seen (bounded). */
  seen?: string[];
  /** Highest source sequence already read (Windows notification order). */
  mark?: number;
};

/** Extra zero-cost ranking hints a transport already knows. */
export type SourceSignals = {
  /** Gmail's own importance marker. */
  important?: boolean;
  /** Gmail category tab. */
  mailCategory?: 'promotions' | 'social' | 'updates' | 'forums';
};

/** One item as an adapter reports it; the hub adds identity, triage and storage. */
export type SourceItem = {
  /** Stable identity inside the connector; the same key is stored once. */
  key: string;
  sender?: string;
  title: string;
  body: string;
  url?: string;
  createdAt?: number;
  account?: string;
  rawRef?: string;
  signals?: SourceSignals;
  hint?: { level: NotificationLevel; category: NotificationCategory; reason: string };
};

export type SourceSyncContext<C extends NotificationConnector> = {
  connector: C;
  cursor: ConnectorCursor | undefined;
  /** The connector's secret from the OS-encrypted vault, read only when needed. */
  secret: () => Promise<string | undefined>;
  now: () => number;
  signal: AbortSignal;
};

export type SourceSyncResult = { items: SourceItem[]; cursor: ConnectorCursor };

export type ConnectorBase = { id: string; label: string; enabled: boolean };

/** `secret` is stored in the vault by the hub and never kept on the connector. */
export type SourceValidation<C extends NotificationConnector> = { connector: C; secret?: string } | { error: string };

export type DraftOf<C extends NotificationConnector> = Extract<ConnectorDraft, { kind: C['kind'] }>;

export type NotificationSourceAdapter<C extends NotificationConnector> = {
  kind: C['kind'];
  source: NotificationSourceKind;
  /** Event-fed sources (site titles, page notifications) are not polled. */
  passive?: boolean;
  validate: (
    draft: DraftOf<C>,
    base: ConnectorBase,
    existing: C | undefined
  ) => SourceValidation<C> | Promise<SourceValidation<C>>;
  /** True when an edit points the connector somewhere else, so its cursor must restart. */
  sourceChanged?: (before: C, after: C) => boolean;
  /** Account shown with each item (mailbox address, channel). */
  account?: (connector: C) => string | undefined;
  sync?: (context: SourceSyncContext<C>) => Promise<SourceSyncResult>;
};

export type SourceAdapterRegistry = {
  [K in NotificationConnectorKind]: NotificationSourceAdapter<Extract<NotificationConnector, { kind: K }>>;
};

/** The adapter for a connector, typed to that connector. */
export const adapterFor = <C extends NotificationConnector>(
  registry: SourceAdapterRegistry,
  connector: Pick<C, 'kind'>
): NotificationSourceAdapter<C> => registry[connector.kind] as unknown as NotificationSourceAdapter<C>;

export const clampInterval = (value: unknown, fallback: number, minimum = 2): number => {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(240, Math.max(minimum, number));
};

export const cleanText = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
