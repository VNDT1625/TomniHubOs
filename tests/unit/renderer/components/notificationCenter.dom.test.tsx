/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_NOTIFICATION_RULES,
  type HubNotification,
  type NotificationHubSnapshot,
} from '@/common/types/platform/notificationHub';
import NotificationCenterDrawer from '@/renderer/components/layout/Titlebar/NotificationHub/NotificationCenterDrawer';
import NotificationsPage from '@/renderer/pages/notifications/NotificationsPage';

const hub = vi.hoisted(() => {
  const handlers: Array<(snapshot: unknown) => void> = [];
  const call = () => vi.fn(async () => true);
  return {
    handlers,
    channels: {
      snapshot: { invoke: vi.fn() },
      markRead: { invoke: call() },
      markAllRead: { invoke: call() },
      remove: { invoke: call() },
      clear: { invoke: call() },
      reclassify: { invoke: call() },
      feedback: { invoke: call() },
      summary: {
        invoke: vi.fn(async () => ({
          since: 0,
          until: 1,
          total: 2,
          unread: 1,
          byLevel: { P0: 1, P1: 0, P2: 1, P3: 0 },
          bySource: [
            {
              key: 'mail',
              label: 'Work mail',
              source: 'email',
              count: 2,
              unread: 1,
            },
          ],
          byCategory: {},
          topSenders: [],
          highlights: [
            {
              id: 'agent',
              level: 'P0',
              category: 'system',
              delivery: 'interrupt',
              source: 'agent',
              sourceLabel: 'Tomny Agent',
              title: 'Refactor needs your answer',
              snippet: '',
              createdAt: 0,
              read: false,
            },
          ],
          text: '',
        })),
      },
      listOsApps: {
        invoke: vi.fn(async () => [{ appId: 'Telegram.TelegramDesktop', label: 'Telegram', count: 4 }]),
      },
      saveConnector: {
        invoke: vi.fn(async () => ({ connector: { id: 'new' } })),
      },
      removeConnector: { invoke: call() },
      testConnector: { invoke: vi.fn(async () => ({ ok: true, count: 2 })) },
      syncNow: { invoke: call() },
      saveRules: { invoke: vi.fn(async (rules: unknown) => rules) },
      changed: {
        on: (handler: (snapshot: unknown) => void) => handlers.push(handler),
      },
    },
  };
});
const manager = vi.hoisted(() => ({ addTask: vi.fn() }));
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('@/common/types/platform/notificationHub', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/types/platform/notificationHub')>()),
  notificationHubChannels: hub.channels,
}));
vi.mock('@/renderer/pages/manager/managerBridgeClient', () => ({
  managerClient: manager,
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    shell: { openExternal: { invoke: vi.fn(async () => undefined) } },
  },
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.name !== undefined) return `${key}:${String(options.name)}`;
      if (key === 'common.notificationHub.summary')
        return `P0=${options?.p0} P1=${options?.p1} filtered=${options?.filtered}`;
      return key;
    },
    i18n: { language: 'en-US' },
  }),
}));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: { ...actual.Message, success: vi.fn(), error: vi.fn() },
  };
});

const notification = (patch: Partial<HubNotification>): HubNotification => ({
  id: 'n1',
  source: 'email',
  sourceLabel: 'Work mail',
  title: 'Hello',
  body: '',
  createdAt: Date.now() - 60_000,
  level: 'P2',
  category: 'work',
  classifiedBy: 'rules',
  reason: 'default',
  read: false,
  ...patch,
});

const snapshot = (items: HubNotification[], patch: Partial<NotificationHubSnapshot> = {}): NotificationHubSnapshot => ({
  items,
  settings: {
    connectors: [],
    rules: DEFAULT_NOTIFICATION_RULES,
  },
  status: [],
  layaReady: false,
  ...patch,
});

const push = (next: NotificationHubSnapshot) =>
  act(() => {
    for (const handler of hub.handlers) handler(next);
  });

const renderPage = () =>
  render(
    <MemoryRouter>
      <NotificationsPage />
    </MemoryRouter>
  );

const renderDrawer = () =>
  render(
    <MemoryRouter>
      <NotificationCenterDrawer visible onClose={vi.fn()} />
    </MemoryRouter>
  );

describe('notification center drawer', () => {
  beforeEach(() => {
    hub.channels.snapshot.invoke.mockResolvedValue(snapshot([]));
    manager.addTask.mockResolvedValue({ ok: true, data: {} });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('ranks hub items into Focus, Digest and Filtered and translates Tomny events', async () => {
    renderPage();
    await waitFor(() => expect(hub.handlers.length).toBeGreaterThan(0));
    push(
      snapshot([
        notification({
          id: 'agent',
          source: 'agent',
          level: 'P0',
          title: 'Refactor needs your answer',
          i18n: {
            title: 'common.notificationHub.event.needsInput',
            params: { name: 'Refactor' },
          },
          route: '/conversation/c1',
        }),
        notification({ id: 'digest', level: 'P2', title: 'Release notes' }),
        notification({
          id: 'promo',
          level: 'P3',
          title: 'Flash sale',
          read: true,
        }),
      ])
    );

    const focus = await screen.findByTestId('notification-agent');
    expect(within(focus).getByText('common.notificationHub.event.needsInput:Refactor')).toBeTruthy();
    expect(screen.queryByTestId('notification-digest')).toBeNull();

    fireEvent.click(within(focus).getByLabelText('common.notificationHub.actions.open'));
    expect(hub.channels.feedback.invoke).toHaveBeenCalledWith({
      id: 'agent',
      action: 'opened',
    });
    expect(navigateMock).toHaveBeenCalledWith('/conversation/c1');

    fireEvent.click(screen.getByText('common.notificationHub.tabs.filtered'));
    expect(await screen.findByTestId('notification-promo')).toBeTruthy();
  });

  it('turns a notification into a task and can learn from a correction', async () => {
    renderPage();
    await waitFor(() => expect(hub.handlers.length).toBeGreaterThan(0));
    push(
      snapshot([
        notification({
          id: 'mail',
          level: 'P1',
          sender: 'Lan <lan@home.vn>',
          title: 'Dinner?',
        }),
      ])
    );

    const card = await screen.findByTestId('notification-mail');
    fireEvent.click(within(card).getByLabelText('common.notificationHub.actions.createTask'));
    await waitFor(() =>
      expect(manager.addTask).toHaveBeenCalledWith({
        input: expect.objectContaining({
          title: 'Dinner?',
          priority: 'high',
          tags: ['notification'],
        }),
      })
    );

    fireEvent.click(within(card).getByLabelText('common.notificationHub.actions.move'));
    fireEvent.click(await screen.findByText('common.notificationHub.actions.alwaysMute'));
    expect(hub.channels.reclassify.invoke).toHaveBeenCalledWith({
      id: 'mail',
      level: 'P3',
      remember: true,
    });
  });

  it('keeps the pointer under the bell when a wide rail pushes it out of the right-hand slot', async () => {
    const innerWidth = 1512;
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: innerWidth,
    });

    // The badge is absolutely positioned at
    // right: calc(max(var(--hub-rail-w), 150px) + 52px), so a 400px rail parks its
    // centre 468px from the window's right edge — left of the 400px panel slot.
    const fromRight = 400 + 52 + 16;
    const centreX = innerWidth - fromRight;
    const bell = document.createElement('button');
    bell.setAttribute('aria-label', 'Trung tâm Thông báo');
    bell.getBoundingClientRect = () =>
      ({
        left: centreX - 16,
        right: centreX + 16,
        top: 10,
        bottom: 42,
        width: 32,
        height: 32,
        x: centreX - 16,
        y: 10,
      }) as unknown as DOMRect;
    document.body.appendChild(bell);

    try {
      renderDrawer();
      await screen.findByTestId('notification-flash');

      const drawer = document.querySelector<HTMLElement>('.arco-drawer');
      expect(drawer).toBeTruthy();
      const rightInset = Number.parseFloat(drawer!.style.right);
      const arrowRight = Number.parseFloat(drawer!.style.getPropertyValue('--tnh-arrow-right'));

      // The pointer sits ARROW_HALF (10px) left of where `right` measures from.
      const pointerCentre = innerWidth - rightInset - arrowRight - 10;
      expect(Math.abs(pointerCentre - centreX)).toBeLessThanOrEqual(1);
      // ...while still staying clear of both panel edges.
      expect(arrowRight + 10).toBeGreaterThanOrEqual(28);
      expect(400 - (arrowRight + 10)).toBeGreaterThanOrEqual(28);
    } finally {
      bell.remove();
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: originalWidth,
      });
    }
  });

  it('adds a Gmail account from the Sources tab without echoing the password back', async () => {
    renderPage();
    await waitFor(() => expect(hub.handlers.length).toBeGreaterThan(0));
    push(snapshot([]));

    fireEvent.click(screen.getByText('common.notificationHub.tabs.sources'));
    fireEvent.click(await screen.findByText('common.notificationHub.sources.add'));
    const form = screen.getByTestId('connector-form');
    fireEvent.change(within(form).getByLabelText('common.notificationHub.sources.user'), {
      target: { value: 'me@gmail.com' },
    });
    fireEvent.change(within(form).getByLabelText('common.notificationHub.sources.password'), {
      target: { value: 'abcd efgh' },
    });
    fireEvent.click(within(form).getByText('common.notificationHub.sources.save'));

    await waitFor(() =>
      expect(hub.channels.saveConnector.invoke).toHaveBeenCalledWith({
        draft: expect.objectContaining({
          kind: 'imap',
          host: 'imap.gmail.com',
          port: 993,
          user: 'me@gmail.com',
          label: 'me@gmail.com',
          password: 'abcd efgh',
          enabled: true,
        }),
      })
    );
  });

  it('allows a site from the presets and lists connector status', async () => {
    renderPage();
    await waitFor(() => expect(hub.handlers.length).toBeGreaterThan(0));
    push(
      snapshot([], {
        settings: {
          connectors: [
            {
              id: 'm1',
              kind: 'imap',
              label: 'Work',
              enabled: true,
              host: 'imap.x.com',
              port: 993,
              user: 'me',
              mailbox: 'INBOX',
              intervalMinutes: 5,
              hasSecret: false,
            },
          ],
          rules: DEFAULT_NOTIFICATION_RULES,
        },
        status: [{ id: 'm1', lastError: 'timed out' }],
      })
    );

    fireEvent.click(screen.getByText('common.notificationHub.tabs.sources'));
    const connector = await screen.findByTestId('connector-m1');
    expect(
      within(connector).getByText('common.notificationHub.sources.lastError', {
        exact: false,
      })
    ).toBeTruthy();
    expect(within(connector).getByText(/noPassword/)).toBeTruthy();
    fireEvent.click(within(connector).getByText('common.notificationHub.sources.syncNow'));
    await waitFor(() =>
      expect(hub.channels.testConnector.invoke).toHaveBeenCalledWith({
        id: 'm1',
      })
    );

    fireEvent.click(screen.getByText('common.notificationHub.sources.add'));
    const form = screen.getByTestId('connector-form');
    fireEvent.click(within(form).getByText('common.notificationHub.sources.kind.web'));
    fireEvent.click(within(screen.getByTestId('connector-form')).getByText('Facebook'));
    fireEvent.click(within(screen.getByTestId('connector-form')).getByText('common.notificationHub.sources.save'));
    await waitFor(() =>
      expect(hub.channels.saveConnector.invoke).toHaveBeenCalledWith({
        draft: expect.objectContaining({
          kind: 'web',
          origin: 'facebook.com',
          label: 'Facebook',
        }),
      })
    );
  });

  it('filters by search and unread, and offers boost and mute in the more menu', async () => {
    renderPage();
    await waitFor(() => expect(hub.handlers.length).toBeGreaterThan(0));
    push(
      snapshot([
        notification({
          id: 'a',
          source: 'os',
          connectorId: 'os',
          sourceLabel: 'Windows',
          account: 'Zalo',
          level: 'P1',
          title: 'Sếp Minh',
        }),
        notification({
          id: 'b',
          source: 'email',
          sourceLabel: 'Work mail',
          account: 'me@work.vn',
          level: 'P1',
          title: 'Contract',
          read: true,
        }),
      ])
    );
    expect(await screen.findByTestId('notification-b')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('common.notificationHub.view.unreadOnly'));
    await waitFor(() => expect(screen.queryByTestId('notification-b')).toBeNull());
    expect(screen.getByTestId('notification-a')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('common.notificationHub.view.search'), { target: { value: 'zzz' } });
    await waitFor(() => expect(screen.queryByTestId('notification-a')).toBeNull());
    fireEvent.change(screen.getByLabelText('common.notificationHub.view.search'), { target: { value: '' } });

    const card = await screen.findByTestId('notification-a');
    fireEvent.click(within(card).getByLabelText('common.notificationHub.actions.move'));
    fireEvent.click(await screen.findByText('common.notificationHub.actions.boostSender'));
    expect(hub.channels.feedback.invoke).toHaveBeenCalledWith({ id: 'a', action: 'boostSender' });
    fireEvent.click(within(card).getByLabelText('common.notificationHub.actions.move'));
    fireEvent.click(await screen.findByText('common.notificationHub.actions.muteSource:Windows'));
    expect(hub.channels.feedback.invoke).toHaveBeenCalledWith({ id: 'a', action: 'muteSource' });
  });

  it('adds desktop apps and a YouTube channel as sources', async () => {
    renderPage();
    await waitFor(() => expect(hub.handlers.length).toBeGreaterThan(0));
    push(snapshot([]));
    fireEvent.click(screen.getByText('common.notificationHub.tabs.sources'));
    fireEvent.click(await screen.findByText('common.notificationHub.sources.add'));
    fireEvent.click(within(screen.getByTestId('connector-form')).getByText('common.notificationHub.sources.kind.os'));
    fireEvent.click(await within(screen.getByTestId('connector-form')).findByText('Telegram · 4'));
    fireEvent.click(within(screen.getByTestId('connector-form')).getByText('common.notificationHub.sources.save'));
    await waitFor(() =>
      expect(hub.channels.saveConnector.invoke).toHaveBeenCalledWith({
        draft: expect.objectContaining({
          kind: 'os',
          apps: ['Telegram.TelegramDesktop'],
        }),
      })
    );

    fireEvent.click(await screen.findByText('common.notificationHub.sources.add'));
    fireEvent.click(
      within(screen.getByTestId('connector-form')).getByText('common.notificationHub.sources.kind.youtube')
    );
    fireEvent.change(
      within(screen.getByTestId('connector-form')).getByLabelText('common.notificationHub.sources.channel'),
      {
        target: { value: '@fireship' },
      }
    );
    fireEvent.click(within(screen.getByTestId('connector-form')).getByText('common.notificationHub.sources.save'));
    await waitFor(() =>
      expect(hub.channels.saveConnector.invoke).toHaveBeenCalledWith({
        draft: expect.objectContaining({
          kind: 'youtube',
          channelId: '@fireship',
          label: '@fireship',
        }),
      })
    );
  });

  it('flash shows only a few unread urgent/important items and leads to the page', async () => {
    renderDrawer();
    await waitFor(() => expect(hub.handlers.length).toBeGreaterThan(0));
    push(
      snapshot([
        notification({
          id: 'u',
          level: 'P0',
          title: 'Server down',
          route: '/conversation/c9',
        }),
        notification({ id: 'i', level: 'P1', title: 'Contract' }),
        notification({ id: 'd', level: 'P2', title: 'Digest item' }),
        notification({
          id: 'r',
          level: 'P1',
          title: 'Already read',
          read: true,
        }),
        notification({ id: 'p', level: 'P3', title: 'Promo', read: true }),
      ])
    );
    const flash = await screen.findByTestId('notification-flash');
    expect(within(flash).getByText('Server down')).toBeTruthy();
    expect(within(flash).getByText('Contract')).toBeTruthy();
    for (const hidden of ['Digest item', 'Already read', 'Promo']) expect(within(flash).queryByText(hidden)).toBeNull();
    expect(screen.queryByText('common.notificationHub.tabs.focus')).toBeNull();

    fireEvent.click(within(flash).getByText('common.notificationHub.flash.viewAllMore'));
    expect(navigateMock).toHaveBeenCalledWith('/notifications');
    fireEvent.click(screen.getByTestId('flash-u'));
    expect(hub.channels.feedback.invoke).toHaveBeenCalledWith({
      id: 'u',
      action: 'opened',
    });
    expect(navigateMock).toHaveBeenCalledWith('/conversation/c9');
  });
});
