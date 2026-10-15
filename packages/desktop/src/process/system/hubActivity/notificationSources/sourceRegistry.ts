/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebConnector } from '@/common/types/platform/notificationHub';
import type { FeedFetcher } from '../notifications/feedConnector';
import { normalizeAllowedOrigin } from '../notifications/webTitleWatcher';
import { createFeedSource, createYoutubeSource } from './feedSource';
import { createMailSource, type MailFetcher } from './mailSource';
import { createOsToastSource, type OsToastReader } from './osToastSource';
import { cleanText, type NotificationSourceAdapter, type SourceAdapterRegistry } from './sourceAdapter';

/**
 * Allowed sites in the built-in browser. Passive: the title watcher and the
 * page-notification capture feed it as the user browses.
 */
export const webSource: NotificationSourceAdapter<WebConnector> = {
  kind: 'web',
  source: 'web',
  passive: true,
  validate: (draft, base) => {
    const origin = normalizeAllowedOrigin(cleanText(draft.origin, 300));
    if (!origin) return { error: 'origin' };
    return { connector: { ...base, kind: 'web', origin, captureNotifications: draft.captureNotifications === true } };
  },
  account: (connector) => connector.origin,
};

export type SourceRegistryDeps = {
  fetchMail: MailFetcher;
  fetchFeed: FeedFetcher;
  /** Windows notification list; undefined off Windows. */
  osReader?: () => OsToastReader | undefined;
  /** True when Tomny itself just showed this text, so its own alert is not read back. */
  recentlyShown?: (text: string) => boolean;
};

export const createSourceRegistry = (deps: SourceRegistryDeps): SourceAdapterRegistry => ({
  imap: createMailSource(deps.fetchMail),
  feed: createFeedSource(deps.fetchFeed),
  web: webSource,
  youtube: createYoutubeSource(deps.fetchFeed),
  os: createOsToastSource(deps.osReader ?? (() => undefined), { recentlyShown: deps.recentlyShown }),
});
