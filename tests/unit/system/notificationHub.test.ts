/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { HubActivityItem } from '@/common/types/agent/hubActivity';
import {
  DEFAULT_NOTIFICATION_RULES,
  type NotificationRules,
  type WebConnector,
} from '@/common/types/platform/notificationHub';
import { parseFeed } from '@process/system/hubActivity/notifications/feedConnector';
import { createActivityNotifier } from '@process/system/hubActivity/notifications/internalNotificationSources';
import {
  decodeEncodedWords,
  extractSnippet,
  parseHeaders,
} from '@process/system/hubActivity/notifications/mailParsing';
import {
  classifyByRules,
  createNotificationClassifier,
} from '@process/system/hubActivity/notifications/notificationClassifier';
import { normalizeDocument } from '@process/system/hubActivity/notifications/notificationStore';
import {
  createWebTitleWatcher,
  matchWebConnector,
  normalizeAllowedOrigin,
  parseUnreadCount,
  type WatchedContents,
} from '@process/system/hubActivity/notifications/webTitleWatcher';

const rules = (patch: Partial<NotificationRules> = {}): NotificationRules => ({
  ...DEFAULT_NOTIFICATION_RULES,
  ...patch,
});

describe('notification classifier rules', () => {
  it('ranks one-time codes and urgent requests as P0', () => {
    expect(classifyByRules({ source: 'email', title: 'Mã OTP của bạn là 123456', body: '' }, rules()).level).toBe('P0');
    expect(classifyByRules({ source: 'email', title: 'Your verification code', body: '' }, rules()).reason).toBe('otp');
    expect(classifyByRules({ source: 'email', title: 'Gửi báo cáo gấp trước 14h', body: '' }, rules()).level).toBe(
      'P0'
    );
  });

  it('filters promotions and bulk senders to P3', () => {
    const promo = classifyByRules({ source: 'email', title: 'Giảm giá 50% hôm nay', body: '' }, rules());
    expect(promo).toMatchObject({ level: 'P3', category: 'promotion' });
    const bulk = classifyByRules(
      { source: 'email', sender: 'Shop <no-reply@shop.vn>', title: 'Hello', body: '' },
      rules()
    );
    expect(bulk.level).toBe('P3');
  });

  it('lets the user lists win over everything', () => {
    const vip = classifyByRules(
      { source: 'email', sender: 'Boss <boss@acme.com>', title: 'hi', body: '' },
      rules({ vipSenders: ['acme.com'] })
    );
    expect(vip).toMatchObject({ level: 'P0', reason: 'vip-sender', final: true });
    const muted = classifyByRules(
      { source: 'email', sender: 'x@spam.io', title: 'URGENT', body: '' },
      rules({ mutedSenders: ['spam.io'] })
    );
    expect(muted).toMatchObject({ level: 'P3', reason: 'muted-sender' });
  });

  it('keeps the level Tomny proposes for its own events', () => {
    const result = classifyByRules(
      { source: 'agent', title: 'x', body: '', hint: { level: 'P0', category: 'system', reason: 'needs-input' } },
      rules()
    );
    expect(result).toMatchObject({ level: 'P0', reason: 'needs-input', final: true });
  });

  it('uses Laya only when it is running and confident', async () => {
    const predictor = vi.fn().mockResolvedValue({
      answers: { priority: { choice: 'P1', confidence: 0.9 }, category: { choice: 'work', confidence: 0.8 } },
    });
    const classify = createNotificationClassifier({ laya: () => predictor });
    await expect(
      classify({ source: 'email', sender: 'a@b.c', title: 'Meeting notes', body: '' }, rules())
    ).resolves.toMatchObject({
      level: 'P1',
      category: 'work',
      classifiedBy: 'laya',
    });

    predictor.mockResolvedValueOnce({ answers: { priority: { choice: 'P0', confidence: 0.3 } } });
    await expect(classify({ source: 'feed', title: 'Release 2.0', body: '' }, rules())).resolves.toMatchObject({
      level: 'P2',
      classifiedBy: 'rules',
    });

    const offline = createNotificationClassifier({ laya: () => undefined });
    await expect(offline({ source: 'email', title: 'Hi', body: '' }, rules())).resolves.toMatchObject({
      classifiedBy: 'rules',
    });
    const optedOut = await classify({ source: 'email', title: 'Hi', body: '' }, rules({ useLaya: false }));
    expect(optedOut.classifiedBy).toBe('rules');
  });

  it('never lets the model override a one-time code', async () => {
    const predictor = vi.fn();
    const classify = createNotificationClassifier({ laya: () => predictor });
    await expect(classify({ source: 'email', title: 'Your OTP', body: '' }, rules())).resolves.toMatchObject({
      level: 'P0',
    });
    expect(predictor).not.toHaveBeenCalled();
  });
});

describe('mail parsing', () => {
  it('decodes encoded words and folded headers', () => {
    expect(decodeEncodedWords('=?UTF-8?B?QsOhbyBjw6Fv?= =?UTF-8?Q?_th=C3=A1ng?=')).toBe('Báo cáo tháng');
    const headers = parseHeaders('From: "Ann" <ann@x.com>\r\nSubject: Hello\r\n world\r\n');
    expect(headers).toEqual({ from: '"Ann" <ann@x.com>', subject: 'Hello world' });
  });

  it('extracts a plain-text snippet from multipart mail', () => {
    const headers = { 'content-type': 'multipart/alternative; boundary="b1"' };
    const body = [
      '--b1',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>HTML version</p>',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Xin ch=C3=A0o, h=E1=BB=8Dp l=C3=BAc 9h',
      '--b1--',
    ].join('\r\n');
    expect(extractSnippet(headers, body)).toBe('Xin chào, họp lúc 9h');
    expect(extractSnippet({ 'content-type': 'text/html' }, '<b>Hi</b> <script>x()</script>there')).toBe('Hi there');
  });
});

describe('feed parsing', () => {
  it('reads RSS items and keeps only http links', () => {
    const feed = parseFeed(
      '<rss><channel><title>Blog</title><item><title>Post &amp; more</title><link>https://b.io/1</link><guid>1</guid><description><![CDATA[<p>Hello</p>]]></description><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item><item><title>Bad</title><link>javascript:alert(1)</link></item></channel></rss>'
    );
    expect(feed.title).toBe('Blog');
    expect(feed.entries[0]).toMatchObject({ id: '1', title: 'Post & more', summary: 'Hello', link: 'https://b.io/1' });
    expect(feed.entries[1]!.link).toBeUndefined();
  });

  it('reads Atom entries', () => {
    const feed = parseFeed(
      '<feed><title>Releases</title><entry><id>tag:1</id><title>v2</title><link rel="alternate" href="https://g.io/v2"/><updated>2026-10-01T00:00:00Z</updated><summary>Notes</summary></entry></feed>'
    );
    expect(feed.entries).toEqual([
      {
        id: 'tag:1',
        title: 'v2',
        summary: 'Notes',
        link: 'https://g.io/v2',
        publishedAt: Date.parse('2026-10-01T00:00:00Z'),
      },
    ]);
  });
});

describe('allowed-site watcher', () => {
  const facebook: WebConnector = { id: 'fb', kind: 'web', label: 'Facebook', enabled: true, origin: 'facebook.com' };

  it('parses unread counts and allowed origins', () => {
    expect(parseUnreadCount('(3) Facebook')).toBe(3);
    expect(parseUnreadCount('Inbox (12) - me@gmail.com - Gmail')).toBe(12);
    expect(parseUnreadCount('Facebook')).toBeUndefined();
    expect(normalizeAllowedOrigin('https://www.facebook.com/')).toBe('facebook.com');
    expect(normalizeAllowedOrigin('*.zalo.me')).toBe('zalo.me');
    expect(normalizeAllowedOrigin('javascript:alert(1)')).toBeUndefined();
    expect(matchWebConnector('https://m.facebook.com/home', [facebook])).toBe(facebook);
    expect(matchWebConnector('https://evilfacebook.com', [facebook])).toBeUndefined();
    expect(matchWebConnector('https://facebook.com', [{ ...facebook, enabled: false }])).toBeUndefined();
  });

  it('reports only rises after the first title', () => {
    const onChange = vi.fn();
    const watcher = createWebTitleWatcher(() => [facebook], onChange);
    const listeners: Array<(event: unknown, title: string) => void> = [];
    const contents: WatchedContents = {
      id: 7,
      getURL: () => 'https://www.facebook.com/',
      isDestroyed: () => false,
      on: (_event, listener) => listeners.push(listener),
      once: () => undefined,
    };
    watcher.observe(contents);
    watcher.observe(contents);
    expect(listeners).toHaveLength(1);
    listeners[0]!({}, '(2) Facebook');
    listeners[0]!({}, '(5) Facebook');
    listeners[0]!({}, '(1) Facebook');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toMatchObject({ count: 5, added: 3 });
  });
});

describe('activity notifications', () => {
  const item = (patch: Partial<HubActivityItem>): HubActivityItem => ({
    id: 'agent:c1',
    kind: 'agent',
    sourceId: 'c1',
    title: 'Refactor',
    status: 'running',
    startedAt: 0,
    updatedAt: 0,
    steps: [],
    canStop: true,
    ...patch,
  });

  it('emits for transitions after the baseline and grades completions', () => {
    const emit = vi.fn();
    const notify = createActivityNotifier(emit);
    notify({ generatedAt: 0, items: [item({ status: 'needs_input' })] });
    expect(emit).not.toHaveBeenCalled();

    notify({ generatedAt: 1, items: [item({ status: 'running' })] });
    notify({
      generatedAt: 2,
      items: [item({ status: 'needs_input', prompt: { id: 'p', title: 'Run npm?', description: '', options: [] } })],
    });
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ hint: expect.objectContaining({ level: 'P0' }), body: 'Run npm?' })
    );

    notify({ generatedAt: 3, items: [item({ status: 'running' })] });
    notify({ generatedAt: 4, items: [item({ status: 'done', updatedAt: 5_000 })] });
    expect(emit).toHaveBeenCalledTimes(1);

    notify({ generatedAt: 5, items: [item({ status: 'running', startedAt: 10_000 })] });
    notify({ generatedAt: 6, items: [item({ status: 'done', startedAt: 10_000, updatedAt: 200_000 })] });
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ hint: expect.objectContaining({ level: 'P1' }) }));
  });
});

describe('notification store document', () => {
  it('drops malformed data instead of failing', () => {
    const document = normalizeDocument({
      items: [{ id: 'a' }, 'bad'],
      settings: {
        connectors: [
          { id: 'x', kind: 'evil' },
          { id: 'f', kind: 'feed' },
        ],
        rules: { vipSenders: ['a', 3] },
      },
    });
    expect(document.items).toHaveLength(1);
    expect(document.settings.connectors.map((connector) => connector.id)).toEqual(['f']);
    expect(document.settings.rules).toMatchObject({ vipSenders: ['a'], useLaya: true });
    expect(normalizeDocument('nope').items).toEqual([]);
  });
});
