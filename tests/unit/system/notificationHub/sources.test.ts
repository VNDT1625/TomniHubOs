/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { ImapConnector, OsConnector, WebConnector } from '@/common/types/platform/notificationHub';
import { fetchNewMailOver, type ImapTransport } from '@process/system/hubActivity/notifications/imapClient';
import { createMailSource } from '@process/system/hubActivity/notificationSources/mailSource';
import { resolveYoutubeChannel, youtubeFeedUrl } from '@process/system/hubActivity/notificationSources/feedSource';
import {
  appLabel,
  createOsToastSource,
  msToFileTime,
  parseToastText,
  type OsToast,
} from '@process/system/hubActivity/notificationSources/osToastSource';
import {
  createPackageNotificationGate,
  normalizePackagePost,
} from '@process/system/hubActivity/notificationSources/packageAppSource';
import {
  WEB_NOTIFICATION_MARKER,
  createWebNotificationCapture,
  parseCapturedMessage,
  type CapturableContents,
} from '@process/system/hubActivity/notificationSources/webNotificationCapture';

const fakeImap = (replies: Record<string, (tag: string, line: string) => string>) => {
  const socket = new EventEmitter() as EventEmitter & ImapTransport & { written: string[] };
  socket.written = [];
  socket.write = (data: string) => {
    socket.written.push(data);
    const [tag = '', verb = '', second = ''] = data.trim().split(' ');
    const key = verb === 'UID' ? `UID ${second}` : verb;
    const reply = replies[key]?.(tag, data) ?? `${tag} OK done\r\n`;
    setImmediate(() => socket.emit('data', Buffer.from(reply)));
    return true;
  };
  socket.destroy = () => true;
  setImmediate(() => socket.emit('data', Buffer.from('* OK IMAP ready\r\n')));
  return socket;
};

describe('Gmail over read-only IMAP', () => {
  it('reads headers only, skips read mail and uses Gmail importance and tabs at no cost', async () => {
    const header = (subject: string) => `From: Boss <boss@acme.com>\r\nSubject: ${subject}\r\n\r\n`;
    const h1 = header('Contract');
    const h2 = header('Seen already');
    const h3 = header('50% off');
    const socket = fakeImap({
      EXAMINE: (tag) => `* OK [UIDVALIDITY 7] ok\r\n${tag} OK done\r\n`,
      'UID SEARCH': (tag, line) =>
        line.includes('category:promotions')
          ? `* SEARCH 3\r\n${tag} OK done\r\n`
          : line.includes('X-GM-RAW')
            ? `* SEARCH\r\n${tag} OK done\r\n`
            : `* SEARCH 1 2 3\r\n${tag} OK done\r\n`,
      'UID FETCH': (tag) =>
        [
          `* 1 FETCH (UID 1 FLAGS () X-GM-LABELS ("\\\\Important" "\\\\Inbox") BODY[HEADER.FIELDS (FROM SUBJECT)] {${Buffer.byteLength(h1)}}\r\n${h1})`,
          `* 2 FETCH (UID 2 FLAGS (\\Seen) X-GM-LABELS () BODY[HEADER.FIELDS (FROM SUBJECT)] {${Buffer.byteLength(h2)}}\r\n${h2})`,
          `* 3 FETCH (UID 3 FLAGS () X-GM-LABELS () BODY[HEADER.FIELDS (FROM SUBJECT)] {${Buffer.byteLength(h3)}}\r\n${h3})`,
          `${tag} OK done\r\n`,
        ].join('\r\n'),
    });
    const result = await fetchNewMailOver(
      socket,
      { host: 'imap.gmail.com', port: 993, user: 'me@gmail.com', password: 'app-pass', mailbox: 'INBOX' },
      { afterUid: 0, limit: 10, headersOnly: true, unreadOnly: true, gmail: true }
    );
    expect(result.mails.map((mail) => [mail.uid, mail.subject, mail.important ?? false, mail.category])).toEqual([
      [1, 'Contract', true, undefined],
      [3, '50% off', false, 'promotions'],
    ]);
    expect(result.mails.every((mail) => mail.snippet === '')).toBe(true);
    expect(socket.written.some((line) => line.includes('BODY.PEEK[TEXT]'))).toBe(false);
    expect(socket.written.some((line) => /STORE|SELECT /.test(line))).toBe(false);
    expect(result.highestUid).toBe(3);
  });

  it('defaults new mail connectors to headers and unread only, one connector per account', async () => {
    const fetchMail = vi.fn(async (_account: unknown, _options: unknown) => ({
      uidValidity: 1,
      highestUid: 4,
      mails: [{ uid: 4, subject: 'Hi', snippet: '' }],
    }));
    const source = createMailSource(fetchMail);
    const validated = source.validate(
      {
        kind: 'imap',
        label: 'Work',
        enabled: true,
        host: 'imap.gmail.com',
        port: 993,
        user: 'a@gmail.com',
        mailbox: '',
        intervalMinutes: 5,
        password: 'p',
      },
      { id: 'c1', label: 'Work', enabled: true },
      undefined
    );
    expect(validated).toMatchObject({
      connector: { headersOnly: true, unreadOnly: true, hasSecret: true },
      secret: 'p',
    });
    const connector = (validated as { connector: ImapConnector }).connector;
    const synced = await source.sync!({
      connector,
      cursor: undefined,
      secret: async () => 'p',
      now: () => Date.now(),
      signal: new AbortController().signal,
    });
    expect(fetchMail.mock.calls[0]![1]).toMatchObject({ headersOnly: true, unreadOnly: true, gmail: true });
    expect(synced.items[0]).toMatchObject({ account: 'a@gmail.com', rawRef: 'imap:1:4', title: 'Hi' });
    expect(synced.cursor).toEqual({ uidValidity: 1, lastUid: 4 });
  });
});

describe('YouTube channels without an API key', () => {
  it('resolves ids, channel URLs and @handles to the public feed', async () => {
    const fetchText = vi.fn(
      async (_url: string, _signal: AbortSignal) => '<meta itemprop="identifier" content="UCabcdefghijklmnopqrstuv">'
    );
    const signal = new AbortController().signal;
    expect(await resolveYoutubeChannel('UCabcdefghijklmnopqrstuv', fetchText, signal)).toBe('UCabcdefghijklmnopqrstuv');
    expect(
      await resolveYoutubeChannel('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', fetchText, signal)
    ).toBe('UCabcdefghijklmnopqrstuv');
    expect(fetchText).not.toHaveBeenCalled();
    expect(await resolveYoutubeChannel('@somecreator', fetchText, signal)).toBe('UCabcdefghijklmnopqrstuv');
    expect(fetchText.mock.calls[0]![0]).toBe('https://www.youtube.com/@somecreator');
    expect(await resolveYoutubeChannel('not a channel', fetchText, signal)).toBeUndefined();
    expect(youtubeFeedUrl('UCabcdefghijklmnopqrstuv')).toContain('feeds/videos.xml?channel_id=UC');
  });
});

describe('Windows desktop notifications', () => {
  const toast = (order: number, appId: string, lines: string[], minutesAgo = 1): OsToast => ({
    order,
    appId,
    arrivalTime: msToFileTime(Date.now() - minutesAgo * 60_000),
    payload: `<toast><visual><binding template="ToastGeneric">${lines.map((line) => `<text>${line}</text>`).join('')}<text placement="attribution">via app</text></binding></visual></toast>`,
  });

  it('parses visible toast lines and names apps', () => {
    expect(parseToastText(toast(1, 'x', ['Lan', 'Đi ăn trưa &amp; họp?']).payload)).toEqual([
      'Lan',
      'Đi ăn trưa & họp?',
    ]);
    expect(appLabel('com.squirrel.Discord.Discord')).toBe('Discord');
    expect(appLabel('C:\\Users\\me\\AppData\\Local\\Programs\\Zalo\\Zalo.exe')).toBe('Zalo');
  });

  it('reads new toasts after its cursor, skips Tomny itself and honours the app allowlist', async () => {
    const toasts = [
      toast(10, 'com.squirrel.Discord.Discord', ['dev-team', 'build is red']),
      toast(11, 'com.tomny.app', ['Tomny · Urgent', 'x']),
      toast(12, 'Telegram.TelegramDesktop', ['Mẹ', 'Con về chưa?']),
    ];
    const reader = {
      read: vi.fn(async (after: number) => toasts.filter((entry) => entry.order > after)),
      maxOrder: vi.fn(async () => 12),
      apps: vi.fn(async () => []),
    };
    const source = createOsToastSource(() => reader);
    const connector: OsConnector = {
      id: 'os',
      kind: 'os',
      label: 'Windows',
      enabled: true,
      apps: ['telegram'],
      intervalMinutes: 1,
    };
    const context = {
      connector,
      secret: async (): Promise<string | undefined> => undefined,
      now: () => Date.now(),
      signal: new AbortController().signal,
    };
    const first = await source.sync!({ ...context, cursor: undefined });
    expect(first.items.map((item) => [item.title, item.body, item.account])).toEqual([
      ['Mẹ', 'Con về chưa?', 'Telegram'],
    ]);
    expect(first.cursor.mark).toBe(12);
    toasts.push(toast(13, 'Telegram.TelegramDesktop', ['Mẹ', 'Ăn cơm']));
    const next = await source.sync!({ ...context, cursor: first.cursor });
    expect(next.items.map((item) => item.body)).toEqual(['Ăn cơm']);
    await expect(createOsToastSource(() => undefined).sync!({ ...context, cursor: undefined })).rejects.toThrow(
      'unsupported'
    );
  });
});

describe('page notification capture', () => {
  const connector: WebConnector = {
    id: 'w1',
    kind: 'web',
    label: 'ChatGPT',
    enabled: true,
    origin: 'chatgpt.com',
    captureNotifications: true,
  };

  const contents = (url: string) => {
    const emitter = new EventEmitter();
    const page = {
      id: Math.floor(Math.random() * 1e6),
      getURL: () => url,
      isDestroyed: () => false,
      executeJavaScript: vi.fn(async () => undefined),
      on: (event: string, listener: (...args: unknown[]) => void) => emitter.on(event, listener),
      once: (event: string, listener: () => void) => emitter.once(event, listener),
    } satisfies CapturableContents;
    return { page, emit: (event: string, ...args: unknown[]) => emitter.emit(event, ...args) };
  };

  it('injects only into allowed pages and turns marked console lines into notifications', () => {
    const received = vi.fn();
    const capture = createWebNotificationCapture(() => [connector], received);
    const allowed = contents('https://chatgpt.com/c/123');
    const other = contents('https://evil.example/');
    capture.observe(allowed.page);
    capture.observe(other.page);
    allowed.emit('dom-ready');
    other.emit('dom-ready');
    expect(allowed.page.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(other.page.executeJavaScript).not.toHaveBeenCalled();
    const line = `${WEB_NOTIFICATION_MARKER}${JSON.stringify({ title: 'ChatGPT', body: 'Your answer is ready', tag: 't1' })}`;
    allowed.emit('console-message', { message: line });
    other.emit('console-message', { message: line });
    allowed.emit('console-message', { message: 'ordinary log' });
    expect(received).toHaveBeenCalledTimes(1);
    expect(received.mock.calls[0]![0]).toMatchObject({ title: 'ChatGPT', body: 'Your answer is ready', tag: 't1' });
  });

  it('bounds malformed and flooding pages', () => {
    expect(parseCapturedMessage(`${WEB_NOTIFICATION_MARKER}{bad json`)).toBeUndefined();
    expect(parseCapturedMessage(`${WEB_NOTIFICATION_MARKER}${JSON.stringify({ title: '' })}`)).toBeUndefined();
    const received = vi.fn();
    const capture = createWebNotificationCapture(
      () => [connector],
      received,
      () => 0
    );
    const page = contents('https://chatgpt.com/');
    capture.observe(page.page);
    for (let index = 0; index < 50; index += 1) {
      page.emit('console-message', {}, 0, `${WEB_NOTIFICATION_MARKER}${JSON.stringify({ title: `n${index}` })}`);
    }
    expect(received).toHaveBeenCalledTimes(20);
  });
});

describe('package app posts', () => {
  it('accepts bounded https-only posts, caps importance and rate-limits each package', () => {
    expect(normalizePackagePost({ title: '  Build done ', url: 'javascript:alert(1)', importance: 'urgent' })).toEqual({
      title: 'Build done',
    });
    expect(normalizePackagePost({ title: 'x', url: 'https://ok.dev/a', importance: 'important', id: 'r1' })).toEqual({
      title: 'x',
      url: 'https://ok.dev/a',
      id: 'r1',
      importance: 'important',
    });
    expect(normalizePackagePost({ body: 'no title' })).toBeUndefined();
    const gate = createPackageNotificationGate(() => 0);
    const results = Array.from({ length: 35 }, (_unused, index) => gate('tomny.demo', 'Demo', { title: `t${index}` }));
    expect(results.filter((result) => 'error' in result)).toHaveLength(5);
  });
});
