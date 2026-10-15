/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { NotificationConnectorKind } from './notificationHub';

/**
 * What each source can honestly do today:
 * - `working`: Tomny fetches it itself once the user adds the account or channel;
 * - `session`: works while the user is signed in to the site in the built-in
 *   browser (unread counter in the tab title and the page's own notifications);
 * - `adapter-ready`: the hub contract exists but the provider integration
 *   (OAuth app, bot token, paid API) is not built, so it cannot be added yet.
 */
export type NotificationSourceSupport = 'working' | 'session' | 'adapter-ready';

export type NotificationSourceGroup = 'mail' | 'ai' | 'social' | 'messages' | 'video' | 'desktop' | 'apps';

export type NotificationSourcePreset = {
  id: string;
  label: string;
  group: NotificationSourceGroup;
  support: NotificationSourceSupport;
  /** Connector to create; `package` sources need no connector. */
  kind: NotificationConnectorKind | 'package';
  origin?: string;
  host?: string;
  port?: number;
  /** Take the site's own web notifications into the hub. */
  captureNotifications?: boolean;
};

export const NOTIFICATION_SOURCE_CATALOG: readonly NotificationSourcePreset[] = [
  { id: 'gmail', label: 'Gmail', group: 'mail', support: 'working', kind: 'imap', host: 'imap.gmail.com', port: 993 },
  {
    id: 'outlook',
    label: 'Outlook',
    group: 'mail',
    support: 'working',
    kind: 'imap',
    host: 'outlook.office365.com',
    port: 993,
  },
  {
    id: 'yahoo',
    label: 'Yahoo Mail',
    group: 'mail',
    support: 'working',
    kind: 'imap',
    host: 'imap.mail.yahoo.com',
    port: 993,
  },
  {
    id: 'icloud',
    label: 'iCloud Mail',
    group: 'mail',
    support: 'working',
    kind: 'imap',
    host: 'imap.mail.me.com',
    port: 993,
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    group: 'ai',
    support: 'session',
    kind: 'web',
    origin: 'chatgpt.com',
    captureNotifications: true,
  },
  {
    id: 'claude',
    label: 'Claude',
    group: 'ai',
    support: 'session',
    kind: 'web',
    origin: 'claude.ai',
    captureNotifications: true,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    group: 'ai',
    support: 'session',
    kind: 'web',
    origin: 'gemini.google.com',
    captureNotifications: true,
  },
  {
    id: 'copilot',
    label: 'Copilot',
    group: 'ai',
    support: 'session',
    kind: 'web',
    origin: 'copilot.microsoft.com',
    captureNotifications: true,
  },
  {
    id: 'facebook',
    label: 'Facebook',
    group: 'social',
    support: 'session',
    kind: 'web',
    origin: 'facebook.com',
    captureNotifications: true,
  },
  {
    id: 'instagram',
    label: 'Instagram',
    group: 'social',
    support: 'session',
    kind: 'web',
    origin: 'instagram.com',
    captureNotifications: true,
  },
  {
    id: 'x',
    label: 'X',
    group: 'social',
    support: 'session',
    kind: 'web',
    origin: 'x.com',
    captureNotifications: true,
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    group: 'social',
    support: 'session',
    kind: 'web',
    origin: 'linkedin.com',
    captureNotifications: true,
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    group: 'social',
    support: 'session',
    kind: 'web',
    origin: 'tiktok.com',
    captureNotifications: true,
  },
  {
    id: 'youtube-site',
    label: 'YouTube',
    group: 'social',
    support: 'session',
    kind: 'web',
    origin: 'youtube.com',
    captureNotifications: true,
  },
  {
    id: 'messenger',
    label: 'Messenger',
    group: 'messages',
    support: 'session',
    kind: 'web',
    origin: 'messenger.com',
    captureNotifications: true,
  },
  {
    id: 'zalo',
    label: 'Zalo',
    group: 'messages',
    support: 'session',
    kind: 'web',
    origin: 'chat.zalo.me',
    captureNotifications: true,
  },
  {
    id: 'telegram-web',
    label: 'Telegram',
    group: 'messages',
    support: 'session',
    kind: 'web',
    origin: 'web.telegram.org',
    captureNotifications: true,
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    group: 'messages',
    support: 'session',
    kind: 'web',
    origin: 'web.whatsapp.com',
    captureNotifications: true,
  },
  {
    id: 'google-messages',
    label: 'Google Messages',
    group: 'messages',
    support: 'session',
    kind: 'web',
    origin: 'messages.google.com',
    captureNotifications: true,
  },
  {
    id: 'discord',
    label: 'Discord',
    group: 'messages',
    support: 'session',
    kind: 'web',
    origin: 'discord.com',
    captureNotifications: true,
  },
  {
    id: 'slack',
    label: 'Slack',
    group: 'messages',
    support: 'session',
    kind: 'web',
    origin: 'slack.com',
    captureNotifications: true,
  },
  { id: 'gmail-web', label: 'Gmail (web)', group: 'mail', support: 'session', kind: 'web', origin: 'mail.google.com' },
  { id: 'youtube-channel', label: 'YouTube channel', group: 'video', support: 'working', kind: 'youtube' },
  { id: 'windows-apps', label: 'Windows apps', group: 'desktop', support: 'working', kind: 'os' },
  { id: 'package-apps', label: 'Tomny apps', group: 'apps', support: 'working', kind: 'package' },
  { id: 'gmail-api', label: 'Gmail API (OAuth)', group: 'mail', support: 'adapter-ready', kind: 'imap' },
  {
    id: 'facebook-graph',
    label: 'Facebook Page / followers API',
    group: 'social',
    support: 'adapter-ready',
    kind: 'web',
  },
  { id: 'telegram-bot', label: 'Telegram Bot API', group: 'messages', support: 'adapter-ready', kind: 'web' },
  {
    id: 'youtube-comments',
    label: 'YouTube comments (Data API)',
    group: 'video',
    support: 'adapter-ready',
    kind: 'youtube',
  },
];

/** Site presets for the "allowed site" form. */
export const SITE_SOURCE_PRESETS = NOTIFICATION_SOURCE_CATALOG.filter(
  (entry): entry is NotificationSourcePreset & { origin: string } =>
    entry.kind === 'web' && entry.support === 'session' && typeof entry.origin === 'string'
);
