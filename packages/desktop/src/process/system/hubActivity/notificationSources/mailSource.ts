/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImapConnector } from '@/common/types/platform/notificationHub';
import {
  isGmailHost,
  type ImapAccount,
  type ImapFetchOptions,
  type ImapFetchResult,
} from '../notifications/imapClient';
import { clampInterval, cleanText, type NotificationSourceAdapter } from './sourceAdapter';

const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const FIRST_MAIL_ITEMS = 10;
const MAX_MAIL_ITEMS_PER_SYNC = 30;
const SYNC_TIMEOUT_MS = 30_000;

export type MailFetcher = (account: ImapAccount, options: ImapFetchOptions) => Promise<ImapFetchResult>;

/**
 * Read-only IMAP mail. Several accounts (for example several Gmail addresses)
 * are several connectors. By default only unread mail and only headers are read;
 * the app password lives in the OS-encrypted vault and reaches only this call.
 */
export const createMailSource = (fetchMail: MailFetcher): NotificationSourceAdapter<ImapConnector> => ({
  kind: 'imap',
  source: 'email',
  validate: (draft, base, existing) => {
    const host = cleanText(draft.host, 253).toLowerCase();
    const user = cleanText(draft.user, 200);
    const port = Number(draft.port) || 993;
    if (!HOST.test(host)) return { error: 'host' };
    if (!user) return { error: 'user' };
    if (port < 1 || port > 65_535) return { error: 'port' };
    const password = typeof draft.password === 'string' && draft.password.length > 0 ? draft.password : undefined;
    if (password && password.length > 500) return { error: 'password' };
    return {
      connector: {
        ...base,
        kind: 'imap',
        host,
        port,
        user,
        mailbox: cleanText(draft.mailbox, 100) || 'INBOX',
        intervalMinutes: clampInterval(draft.intervalMinutes, 5),
        hasSecret: Boolean(password) || Boolean(existing?.hasSecret),
        headersOnly: draft.headersOnly !== false,
        unreadOnly: draft.unreadOnly !== false,
      },
      secret: password,
    };
  },
  sourceChanged: (before, after) =>
    before.host !== after.host || before.user !== after.user || before.mailbox !== after.mailbox,
  account: (connector) => connector.user,
  sync: async ({ connector, cursor, secret, now }) => {
    const password = await secret();
    if (!password) throw new Error('No password saved for this account');
    const first = cursor?.lastUid === undefined;
    const result = await fetchMail(
      { host: connector.host, port: connector.port, user: connector.user, password, mailbox: connector.mailbox },
      {
        afterUid: cursor?.lastUid ?? 0,
        uidValidity: cursor?.uidValidity,
        limit: first ? FIRST_MAIL_ITEMS : MAX_MAIL_ITEMS_PER_SYNC,
        timeoutMs: SYNC_TIMEOUT_MS,
        headersOnly: connector.headersOnly !== false,
        unreadOnly: connector.unreadOnly !== false,
        gmail: isGmailHost(connector.host),
      }
    );
    return {
      items: result.mails.map((mail) => ({
        key: `${connector.id}:${result.uidValidity}:${mail.uid}`,
        sender: mail.sender,
        title: mail.subject || '(no subject)',
        body: mail.snippet,
        createdAt: mail.date && mail.date <= now() ? mail.date : undefined,
        account: connector.user,
        rawRef: `imap:${result.uidValidity}:${mail.uid}`,
        signals:
          mail.important || mail.category ? { important: mail.important, mailCategory: mail.category } : undefined,
      })),
      cursor: { uidValidity: result.uidValidity, lastUid: result.highestUid },
    };
  },
});
