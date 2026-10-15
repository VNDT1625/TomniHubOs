/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NOTIFICATION_RULES } from '@/common/types/platform/notificationHub';
import { decideAlert } from '@process/system/hubActivity/notifications/alertPolicy';
import { createNotificationClassifier } from '@process/system/hubActivity/notifications/notificationClassifier';
import {
  NotificationHubService,
  type NotificationHubDeps,
} from '@process/system/hubActivity/notifications/notificationHubService';
import { createNotificationStore } from '@process/system/hubActivity/notifications/notificationStore';
import { createNotificationMcpServer } from '@process/system/hubActivity/notificationInsights/notificationMcpServer';
import { msToFileTime, type OsToast } from '@process/system/hubActivity/notificationSources/osToastSource';

const NOW = new Date(2026, 9, 8, 10, 0).getTime();

describe('notification hub: aggregate → triage → alert only what matters → agent summary', () => {
  let dir: string;
  let secrets: Map<string, string>;
  let clock: number;

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
      now: () => clock,
      ...patch,
    });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhf-'));
    secrets = new Map();
    clock = NOW;
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('alerts only for interrupting items and keeps the rest in the feed', async () => {
    const alert = vi.fn();
    const service = makeService({ alert });
    const mail = await service.ingest({
      key: 'm1',
      source: 'email',
      sourceLabel: 'Gmail',
      sender: 'a@x.com',
      title: 'Câu hỏi về hợp đồng',
      body: '',
    });
    const promo = await service.ingest({
      key: 'm2',
      source: 'email',
      sourceLabel: 'Gmail',
      sender: 'deals@shop.vn',
      title: 'Giảm giá 50% hôm nay',
      body: '',
    });
    const otp = await service.ingest({
      key: 'm3',
      source: 'email',
      sourceLabel: 'Bank',
      sender: 'bank@vcb.vn',
      title: 'Mã OTP 482913',
      body: '',
    });
    const outage = await service.ingest({
      key: 'o1',
      source: 'os',
      connectorId: 'os',
      sourceLabel: 'Windows',
      account: 'Discord',
      title: 'ops',
      body: 'Production is down, urgent',
    });
    expect(mail).toMatchObject({ level: 'P1', delivery: 'digest' });
    expect(promo).toMatchObject({ level: 'P3', delivery: 'silent', read: true });
    expect(otp).toMatchObject({ level: 'P0', delivery: 'interrupt' });
    expect(outage).toMatchObject({ level: 'P0', delivery: 'interrupt' });
    expect(alert.mock.calls.map((call) => call[0].id)).toEqual([otp!.id, outage!.id]);
    const focused = decideAlert(mail!, DEFAULT_NOTIFICATION_RULES, { now: new Date(NOW), focused: false });
    expect(focused.banner).toBe(false);
    service.dispose();
  });

  it('stores the same message once even when two sources report it', async () => {
    const service = makeService();
    const first = await service.ingest({
      key: 'web:1',
      source: 'web',
      connectorId: 'w',
      sourceLabel: 'Messenger',
      title: 'Lan',
      body: 'Tối nay đi ăn không?',
    });
    clock += 60_000;
    const second = await service.ingest({
      key: 'os:9',
      source: 'os',
      connectorId: 'os',
      sourceLabel: 'Windows',
      title: 'Lan',
      body: 'Tối nay đi ăn không?',
    });
    expect(first).toBeDefined();
    expect(second).toBeUndefined();
    clock += 20 * 60_000;
    expect(
      await service.ingest({
        key: 'os:10',
        source: 'os',
        connectorId: 'os',
        sourceLabel: 'Windows',
        title: 'Lan',
        body: 'Tối nay đi ăn không?',
      })
    ).toBeDefined();
    service.dispose();
  });

  it('learns from one-click feedback: mute a source, boost a sender, reputation from opens', async () => {
    const alert = vi.fn();
    const service = makeService({ alert });
    const noisy = await service.ingest({
      key: 'f1',
      source: 'feed',
      connectorId: 'blog',
      sourceLabel: 'Blog',
      title: 'Post',
      body: '',
    });
    expect(service.feedback(noisy!.id, 'muteSource')).toBe(true);
    expect(
      await service.ingest({
        key: 'f2',
        source: 'feed',
        connectorId: 'blog',
        sourceLabel: 'Blog',
        title: 'Post 2',
        body: '',
      })
    ).toMatchObject({ delivery: 'silent', reason: 'muted-source' });

    const zalo = await service.ingest({
      key: 'z1',
      source: 'os',
      connectorId: 'os',
      sourceLabel: 'Windows',
      account: 'Zalo',
      title: 'Sếp Minh',
      body: 'Gửi file giúp anh',
    });
    expect(zalo).toMatchObject({ level: 'P2' });
    service.feedback(zalo!.id, 'boostSender');
    expect(service.snapshot().settings.rules.vipSenders).toContain('Sếp Minh');
    const boosted = await service.ingest({
      key: 'z2',
      source: 'os',
      connectorId: 'os',
      sourceLabel: 'Windows',
      account: 'Zalo',
      title: 'Sếp Minh',
      body: 'Họp lúc 3h',
    });
    expect(boosted).toMatchObject({ level: 'P0', delivery: 'interrupt', reason: 'vip-sender' });

    for (const key of ['n1', 'n2', 'n3']) {
      const item = await service.ingest({
        key,
        source: 'email',
        sourceLabel: 'Mail',
        sender: 'Hà <ha@team.vn>',
        title: `Tin ${key}`,
        body: 'thảo luận nhóm',
      });
      service.feedback(item!.id, 'opened');
    }
    expect(
      await service.ingest({
        key: 'n4',
        source: 'feed',
        connectorId: 'x',
        sourceLabel: 'Mail',
        sender: 'ha@team.vn',
        title: 'Bài mới',
        body: '',
      })
    ).toMatchObject({ level: 'P1', reason: 'reputation-up' });
    service.dispose();
  });

  it('reads other desktop apps through the Windows list and package apps through the capability', async () => {
    const toasts: OsToast[] = [
      {
        order: 1,
        appId: 'Telegram.TelegramDesktop',
        arrivalTime: msToFileTime(NOW - 60_000),
        payload: '<toast><visual><binding><text>Mẹ</text><text>Con về chưa?</text></binding></visual></toast>',
      },
    ];
    const reader = {
      read: async (after: number) => toasts.filter((toast) => toast.order > after),
      maxOrder: async () => 1,
      apps: async (): Promise<never[]> => [],
    };
    const service = makeService({ osReader: () => reader });
    const saved = await service.saveConnector({
      kind: 'os',
      label: 'Windows apps',
      enabled: true,
      apps: [],
      intervalMinutes: 1,
    });
    expect('id' in saved).toBe(true);
    await vi.waitFor(() =>
      expect(service.snapshot().items.some((item) => item.source === 'os' && item.title === 'Mẹ')).toBe(true)
    );

    expect(service.postFromPackage('tomny.demo-app', { title: 'Export finished', importance: 'important' })).toBe(true);
    expect(service.postFromPackage('tomny.demo-app', { title: '' })).toBe(false);
    expect(service.postFromPackage('../evil', { title: 'x' })).toBe(false);
    await vi.waitFor(() =>
      expect(service.snapshot().items.find((item) => item.source === 'app')).toMatchObject({
        level: 'P1',
        connectorId: 'app:tomny.demo-app',
      })
    );
    service.saveRules({ ...service.snapshot().settings.rules, packageApps: false });
    expect(service.postFromPackage('tomny.demo-app', { title: 'more' })).toBe(false);
    service.dispose();
  });

  it('escalates only ambiguous items, within budget, and a promotion to urgent alerts late', async () => {
    const alert = vi.fn();
    const chat = vi.fn(async () => '[{"i":0,"level":"P0","category":"work"}]');
    const service = makeService({ alert, escalationChat: () => chat });
    service.saveRules({
      ...service.snapshot().settings.rules,
      llm: { enabled: true, model: 'small', dailyLimit: 10, includeSnippet: false },
    });
    await service.ingest({ key: 'otp', source: 'email', sourceLabel: 'Mail', title: 'OTP 123456', body: '' });
    const unclear = await service.ingest({
      key: 'u1',
      source: 'email',
      sourceLabel: 'Mail',
      sender: 'kh@client.vn',
      title: 'Re: báo giá',
      body: '',
    });
    alert.mockClear();
    clock += 120_000;
    // The batch timer is long in production; flush the waiting batch directly here.
    await (service as unknown as { escalation: { flush: () => Promise<number> } }).escalation.flush();
    expect(chat).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(service.snapshot().items.find((item) => item.id === unclear!.id)).toMatchObject({
        level: 'P0',
        classifiedBy: 'llm',
        delivery: 'interrupt',
      })
    );
    expect(alert).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(chat.mock.calls)).not.toContain('kh@client.vn');
    expect(JSON.stringify(chat.mock.calls)).not.toContain('123456');
    expect(service.snapshot().escalation).toMatchObject({ active: true, usedToday: 1, limit: 10 });
    service.dispose();
  });

  it('summarizes what the user missed, locally, for the drawer and for agents', async () => {
    const service = makeService();
    await service.ingest({
      key: 'a',
      source: 'email',
      sourceLabel: 'Work Gmail',
      account: 'me@work.vn',
      sender: 'Boss <boss@acme.com>',
      title: 'Server down, mã 778899',
      body: 'urgent',
    });
    await service.ingest({
      key: 'b',
      source: 'youtube',
      connectorId: 'yt',
      sourceLabel: 'Fireship',
      title: 'New video',
      body: '',
    });
    await service.ingest({
      key: 'c',
      source: 'email',
      sourceLabel: 'Work Gmail',
      sender: 'ads@shop.vn',
      title: 'Khuyến mãi',
      body: '',
    });
    const summary = service.summary({ period: 'today' });
    expect(summary).toMatchObject({ total: 3, byLevel: { P0: 1, P1: 0, P2: 1, P3: 1 } });
    expect(summary.highlights[0]).toMatchObject({ level: 'P0', title: 'Server down, mã [code]' });
    expect(summary.text).toContain('1 urgent');

    const server = createNotificationMcpServer(
      () => service.readView(),
      () => clock
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).toSorted()).toEqual(['notifications_recent', 'notifications_summary']);
    const missed = await client.callTool({ name: 'notifications_summary', arguments: { period: 'today' } });
    const text = (missed.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain('Server down');
    expect(text).not.toContain('778899');
    expect(text).not.toMatch(/password|secret|connectors/i);
    const recent = await client.callTool({ name: 'notifications_recent', arguments: { minLevel: 'P1', limit: 5 } });
    expect(JSON.parse((recent.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ count: 1 });
    expect(service.snapshot().items.every((item) => item.level === 'P3' || !item.read)).toBe(true);
    await client.close();
    service.dispose();
  });

  it('drops items past the retention window', async () => {
    const service = makeService();
    await service.ingest({
      key: 'old',
      source: 'feed',
      sourceLabel: 'Feed',
      title: 'Old',
      body: '',
      createdAt: NOW - 40 * 86_400_000,
    });
    await service.ingest({ key: 'new', source: 'feed', sourceLabel: 'Feed', title: 'New', body: '' });
    service.saveRules({ ...service.snapshot().settings.rules, retentionDays: 30 });
    expect(service.snapshot().items.map((item) => item.title)).toEqual(['New']);
    service.dispose();
  });
});
