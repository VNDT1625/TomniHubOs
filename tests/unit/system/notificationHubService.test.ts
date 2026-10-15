/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchNewMailOver, type ImapTransport } from '@process/system/hubActivity/notifications/imapClient';
import { createNotificationClassifier } from '@process/system/hubActivity/notifications/notificationClassifier';
import {
  NotificationHubService,
  validateConnector,
  type NotificationHubDeps,
} from '@process/system/hubActivity/notifications/notificationHubService';
import { createNotificationStore } from '@process/system/hubActivity/notifications/notificationStore';

/** Scripted IMAP server: answers each tagged command from `replies`. */
const fakeImap = (replies: Record<string, (tag: string) => string>) => {
  const socket = new EventEmitter() as EventEmitter & ImapTransport & { written: string[] };
  socket.written = [];
  socket.write = (data: string) => {
    socket.written.push(data);
    const [tag = '', verb = '', second = ''] = data.trim().split(' ');
    const key = verb === 'UID' ? `UID ${second}` : verb;
    const reply = replies[key]?.(tag) ?? `${tag} OK done\r\n`;
    setImmediate(() => socket.emit('data', Buffer.from(reply)));
    return true;
  };
  socket.destroy = () => true;
  setImmediate(() => socket.emit('data', Buffer.from('* OK IMAP ready\r\n')));
  return socket;
};

describe('read-only IMAP fetch', () => {
  it('logs in, examines the mailbox and parses literals without marking mail read', async () => {
    const header = 'From: =?UTF-8?B?U+G6v3A=?= <boss@acme.com>\r\nSubject: Report\r\nContent-Type: text/plain\r\n\r\n';
    const text = 'Please send it today';
    const socket = fakeImap({
      EXAMINE: (tag) => `* 3 EXISTS\r\n* OK [UIDVALIDITY 42] ok\r\n${tag} OK [READ-ONLY] done\r\n`,
      'UID SEARCH': (tag) => `* SEARCH 7 9\r\n${tag} OK done\r\n`,
      'UID FETCH': (tag) =>
        `* 1 FETCH (UID 9 BODY[HEADER.FIELDS (FROM SUBJECT)] {${Buffer.byteLength(header)}}\r\n${header} BODY[TEXT]<0> {${text.length}}\r\n${text})\r\n${tag} OK done\r\n`,
    });
    const result = await fetchNewMailOver(
      socket,
      { host: 'imap.x', port: 993, user: 'me@x.com', password: 'p"w', mailbox: 'INBOX' },
      { afterUid: 8, uidValidity: 42, limit: 10 }
    );
    expect(result).toMatchObject({ uidValidity: 42, highestUid: 9 });
    expect(result.mails).toEqual([
      expect.objectContaining({
        uid: 9,
        sender: 'Sếp <boss@acme.com>',
        subject: 'Report',
        snippet: 'Please send it today',
      }),
    ]);
    expect(socket.written[0]).toBe('T1 LOGIN "me@x.com" "p\\"w"\r\n');
    expect(socket.written.some((line) => line.includes('EXAMINE "INBOX"'))).toBe(true);
    expect(socket.written.some((line) => line.includes('BODY.PEEK[TEXT]'))).toBe(true);
    expect(socket.written.some((line) => /STORE|SELECT /.test(line))).toBe(false);
  });

  it('surfaces a rejected login', async () => {
    const socket = fakeImap({ LOGIN: (tag) => `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n` });
    await expect(
      fetchNewMailOver(
        socket,
        { host: 'h', port: 993, user: 'u', password: 'p', mailbox: 'INBOX' },
        { afterUid: 0, limit: 5 }
      )
    ).rejects.toThrow(/Invalid credentials/);
  });
});

describe('connector validation', () => {
  it('accepts sane drafts and rejects bad ones', () => {
    expect(
      validateConnector(
        {
          kind: 'imap',
          label: 'Work',
          enabled: true,
          host: 'imap.gmail.com',
          port: 993,
          user: 'me',
          mailbox: '',
          intervalMinutes: 1,
          password: 'x',
        },
        undefined
      )
    ).toMatchObject({
      connector: { host: 'imap.gmail.com', mailbox: 'INBOX', intervalMinutes: 2, hasSecret: true },
      password: 'x',
    });
    expect(
      validateConnector(
        {
          kind: 'imap',
          label: 'W',
          enabled: true,
          host: 'bad host',
          port: 993,
          user: 'me',
          mailbox: '',
          intervalMinutes: 5,
        },
        undefined
      )
    ).toEqual({ error: 'host' });
    expect(
      validateConnector(
        { kind: 'feed', label: 'F', enabled: true, url: 'file:///etc/passwd', intervalMinutes: 30 },
        undefined
      )
    ).toEqual({ error: 'url' });
    expect(
      validateConnector({ kind: 'web', label: 'FB', enabled: true, origin: 'https://www.facebook.com' }, undefined)
    ).toMatchObject({ connector: { origin: 'facebook.com' } });
  });
});

describe('notification hub service', () => {
  let dir: string;
  let secrets: Map<string, string>;

  const makeService = (patch: Partial<NotificationHubDeps> = {}) =>
    new NotificationHubService({
      store: createNotificationStore(dir),
      classify: createNotificationClassifier(),
      secrets: {
        get: async (id) => secrets.get(id),
        set: async (id, secret) => void secrets.set(id, secret),
        remove: async (id) => void secrets.delete(id),
      },
      fetchMail: vi.fn(),
      fetchFeed: vi.fn(),
      now: () => 1_000_000,
      ...patch,
    });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-'));
    secrets = new Map();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('stores each event once, alerts on P0 and persists', async () => {
    const alert = vi.fn();
    const service = makeService({ alert });
    const first = await service.ingest({
      key: 'k1',
      source: 'email',
      sourceLabel: 'Mail',
      title: 'Your OTP code',
      body: '',
    });
    expect(first).toMatchObject({ level: 'P0', category: 'security', read: false });
    expect(
      await service.ingest({ key: 'k1', source: 'email', sourceLabel: 'Mail', title: 'Your OTP code', body: '' })
    ).toBeUndefined();
    expect(alert).toHaveBeenCalledTimes(1);
    const promo = await service.ingest({
      key: 'k2',
      source: 'email',
      sourceLabel: 'Mail',
      title: 'Flash sale 50% off',
      body: '',
    });
    expect(promo).toMatchObject({ level: 'P3', read: true });
    service.dispose();
    expect(
      makeService()
        .snapshot()
        .items.map((item) => item.id)
    ).toEqual([promo!.id, first!.id]);
  });

  it('replaces unread items of the same group', async () => {
    const service = makeService();
    await service.ingest({ key: 'a', source: 'web', sourceLabel: 'FB', title: '2 unread', body: '', group: 'web:fb' });
    await service.ingest({ key: 'b', source: 'web', sourceLabel: 'FB', title: '4 unread', body: '', group: 'web:fb' });
    expect(service.snapshot().items.map((item) => item.title)).toEqual(['4 unread']);
  });

  it('learns from a correction when asked', async () => {
    const service = makeService();
    const item = await service.ingest({
      key: 'c',
      source: 'email',
      sourceLabel: 'Mail',
      sender: 'Lan <lan@home.vn>',
      title: 'Dinner?',
      body: '',
    });
    expect(service.reclassify(item!.id, 'P0', true)).toBe(true);
    const snapshot = service.snapshot();
    expect(snapshot.items[0]).toMatchObject({ level: 'P0', classifiedBy: 'user' });
    expect(snapshot.settings.rules.vipSenders).toEqual(['lan@home.vn']);
    service.reclassify(item!.id, 'P3', true);
    expect(service.snapshot().settings.rules).toMatchObject({ vipSenders: [], mutedSenders: ['lan@home.vn'] });
  });

  it('syncs a mail account from its cursor and keeps the password in the vault', async () => {
    const fetchMail = vi
      .fn()
      .mockResolvedValueOnce({
        uidValidity: 5,
        highestUid: 11,
        mails: [{ uid: 11, subject: 'Hello', sender: 'a@b.c', snippet: 'Hi' }],
      })
      .mockResolvedValueOnce({ uidValidity: 5, highestUid: 11, mails: [] });
    const service = makeService({ fetchMail });
    const saved = await service.saveConnector({
      kind: 'imap',
      label: 'Work',
      enabled: false,
      host: 'imap.x.com',
      port: 993,
      user: 'me',
      mailbox: 'INBOX',
      intervalMinutes: 5,
      password: 'app-pass',
    });
    expect(saved).toMatchObject({ hasSecret: true });
    expect(JSON.stringify(service.snapshot())).not.toContain('app-pass');
    const id = (saved as { id: string }).id;
    await expect(service.sync(id)).resolves.toEqual({ ok: true, count: 1 });
    await service.sync(id);
    expect(fetchMail.mock.calls[0]![0]).toMatchObject({ password: 'app-pass' });
    expect(fetchMail.mock.calls[1]![1]).toMatchObject({ afterUid: 11, uidValidity: 5 });
    expect(service.snapshot().items[0]).toMatchObject({ source: 'email', title: 'Hello', connectorId: id });
  });

  it('records a sync error on the connector', async () => {
    const service = makeService({ fetchMail: vi.fn().mockRejectedValue(new Error('timed out')) });
    const saved = await service.saveConnector({
      kind: 'imap',
      label: 'W',
      enabled: false,
      host: 'imap.x.com',
      port: 993,
      user: 'me',
      mailbox: 'INBOX',
      intervalMinutes: 5,
    });
    const id = (saved as { id: string }).id;
    await expect(service.sync(id)).resolves.toEqual({ ok: false, error: 'No password saved for this account' });
    secrets.set(id, 'x');
    await expect(service.sync(id)).resolves.toEqual({ ok: false, error: 'timed out' });
    expect(service.snapshot().status).toEqual([expect.objectContaining({ id, lastError: 'timed out' })]);
  });

  it('adds only a few entries on the first feed sync, then new ones', async () => {
    const rss = (ids: number[]) =>
      `<rss><channel><title>B</title>${ids.map((id) => `<item><guid>${id}</guid><title>Post ${id}</title></item>`).join('')}</channel></rss>`;
    const fetchFeed = vi
      .fn()
      .mockResolvedValueOnce(rss([5, 4, 3, 2, 1]))
      .mockResolvedValueOnce(rss([6, 5, 4]));
    const service = makeService({ fetchFeed });
    const saved = await service.saveConnector({
      kind: 'feed',
      label: 'Blog',
      enabled: false,
      url: 'https://b.io/feed',
      intervalMinutes: 30,
    });
    const id = (saved as { id: string }).id;
    await expect(service.sync(id)).resolves.toEqual({ ok: true, count: 3 });
    await expect(service.sync(id)).resolves.toEqual({ ok: true, count: 1 });
    expect(service.snapshot().items.map((item) => item.title)).toContain('Post 6');
  });

  it('removes a connector together with its secret', async () => {
    const service = makeService();
    const saved = await service.saveConnector({
      kind: 'imap',
      label: 'W',
      enabled: false,
      host: 'imap.x.com',
      port: 993,
      user: 'me',
      mailbox: 'INBOX',
      intervalMinutes: 5,
      password: 'p',
    });
    const id = (saved as { id: string }).id;
    expect(await service.removeConnector(id)).toBe(true);
    expect(secrets.has(id)).toBe(false);
    expect(service.snapshot().settings.connectors).toEqual([]);
  });
});
