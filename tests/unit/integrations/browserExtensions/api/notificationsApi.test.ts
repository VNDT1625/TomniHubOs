/* oxlint-disable no-await-in-loop -- each call is awaited in order so the next one sees its effect */

import { describe, expect, it } from 'vitest';
import type {
  NotificationRequest,
  NotificationsPort,
} from '@process/integrations/browserExtensions/api/groups/ui/notifications';
import { ID_A, ID_B, call, manifestOf, shimWith, workerOf } from './shimFixture';
import { eventsOf } from './portsFixture';

const ID_C = 'cccccccccccccccccccccccccccccccc';

const fakeNotifications = () => {
  const requests: NotificationRequest[] = [];
  const closed: string[] = [];
  const clicks = new Set<(id: string) => void>();
  const port: NotificationsPort = {
    show: (request) => {
      requests.push(request);
    },
    close: (id) => {
      closed.push(id);
    },
    subscribeClicks: (listener) => {
      clicks.add(listener);
      return () => void clicks.delete(listener);
    },
  };
  return {
    port,
    requests,
    closed,
    click: (id: string) => {
      for (const listener of Array.from(clicks)) listener(id);
    },
  };
};

const setup = () => {
  const native = fakeNotifications();
  const shim = shimWith(
    {
      [ID_A]: manifestOf({ name: 'Alpha', permissions: ['notifications'] }),
      [ID_B]: manifestOf({ name: 'Beta', permissions: ['notifications'] }),
      [ID_C]: manifestOf({ name: 'Gamma' }),
    },
    { ports: { notifications: native.port } }
  );
  return { shim, native, events: eventsOf(shim) };
};

describe('chrome.notifications permission and shape', () => {
  it('needs the notifications permission for every method', async () => {
    const { shim, native } = setup();
    const attempts: [string, unknown[]][] = [
      ['notifications.create', [{ title: 'Hi', message: 'There' }]],
      ['notifications.clear', ['x']],
      ['notifications.getAll', []],
    ];
    for (const [method, args] of attempts) {
      expect(await call(shim, workerOf(ID_C), method, ...args)).toMatchObject({
        ok: false,
        code: 'PERMISSION_DENIED',
      });
    }
    expect(native.requests).toEqual([]);
  });

  it('shows a basic notification under the extension name, drops fields it does not show, and returns its id', async () => {
    const { shim, native } = setup();
    expect(
      await call(shim, workerOf(ID_A), 'notifications.create', 'n1', {
        type: 'basic',
        title: 'Hello',
        message: 'World',
        iconUrl: 'icon.png',
        priority: 2,
      })
    ).toEqual({ ok: true, value: 'n1' });
    expect(native.requests).toEqual([
      expect.objectContaining({ title: 'Hello', message: 'World', source: 'Alpha', silent: false }),
    ]);
    const generated = await call(shim, workerOf(ID_A), 'notifications.create', { title: 'No id' });
    expect(generated).toMatchObject({ ok: true, value: expect.stringMatching(/^notification-/) });
  });

  it('refuses other notification types, and a notification that reuses an id replaces the old one', async () => {
    const { shim, native } = setup();
    expect(await call(shim, workerOf(ID_A), 'notifications.create', { type: 'image', title: 't' })).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED',
    });
    await call(shim, workerOf(ID_A), 'notifications.create', 'same', { title: 'one' });
    await call(shim, workerOf(ID_A), 'notifications.create', 'same', { title: 'two' });
    expect(native.closed).toEqual([native.requests[0]?.id]);
    expect(await call(shim, workerOf(ID_A), 'notifications.getAll')).toEqual({ ok: true, value: { same: true } });
  });
});

describe('chrome.notifications clear, clicks and limits', () => {
  it('clears only its own notifications and sends a click only to the extension that showed it', async () => {
    const { shim, native, events } = setup();
    await call(shim, workerOf(ID_A), 'notifications.create', 'mine', { title: 'a' });
    expect(await call(shim, workerOf(ID_B), 'notifications.clear', 'mine')).toEqual({ ok: true, value: false });
    native.click(native.requests[0]?.id ?? '');
    expect(events.filter((event) => event.name === 'notifications.onClicked')).toEqual([
      expect.objectContaining({ extensionId: ID_A, payload: 'mine' }),
    ]);
    expect(await call(shim, workerOf(ID_A), 'notifications.clear', 'mine')).toEqual({ ok: true, value: true });
    expect(native.closed).toEqual([native.requests[0]?.id]);
    expect(await call(shim, workerOf(ID_A), 'notifications.getAll')).toEqual({ ok: true, value: {} });
  });

  it('limits how many notifications are shown per minute', async () => {
    const { shim } = setup();
    for (let index = 0; index < 20; index += 1) {
      expect(await call(shim, workerOf(ID_B), 'notifications.create', { title: `n${index}` })).toMatchObject({
        ok: true,
      });
    }
    expect(await call(shim, workerOf(ID_B), 'notifications.create', { title: 'one more' })).toMatchObject({
      ok: false,
      code: 'BUSY',
    });
  });

  it('answers UNSUPPORTED when native notifications are not wired', async () => {
    const shim = shimWith({ [ID_A]: manifestOf({ permissions: ['notifications'] }) });
    expect(await call(shim, workerOf(ID_A), 'notifications.create', { title: 'x' })).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED',
    });
  });
});
