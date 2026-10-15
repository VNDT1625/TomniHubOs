import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { NotificationRequest } from '@process/integrations/browserExtensions/api/groups/ui/notifications';
import {
  createNotificationsPort,
  createWindowsPort,
  type HubWindow,
  type NativeNotification,
} from '@process/integrations/browserExtensions/wiring/hubPorts';

class FakeNotification extends EventEmitter implements NativeNotification {
  shown = 0;
  closed = 0;

  constructor(readonly options: { title: string; body: string; silent: boolean }) {
    super();
  }

  show(): void {
    this.shown += 1;
  }

  close(): void {
    this.closed += 1;
  }
}

const request = (extra: Partial<NotificationRequest> = {}): NotificationRequest => ({
  id: 'p1',
  title: 'Hi',
  message: 'There',
  source: 'Alpha',
  silent: false,
  ...extra,
});

describe('native notifications behind chrome.notifications', () => {
  it('shows the extension name before the title, strips hidden characters, and reports clicks by port id', () => {
    const natives: FakeNotification[] = [];
    const port = createNotificationsPort({
      supported: () => true,
      create: (options) => {
        const native = new FakeNotification(options);
        natives.push(native);
        return native;
      },
    });
    const clicked: string[] = [];
    port.subscribeClicks((id) => clicked.push(id));
    port.show(request({ title: 'Hi‮there', message: 'Body\u0007', silent: true }));
    expect(natives[0]?.options).toEqual({ title: 'Alpha: Hi there', body: 'Body ', silent: true });
    expect(natives[0]?.shown).toBe(1);
    natives[0]?.emit('click');
    expect(clicked).toEqual(['p1']);
    port.close('p1');
    expect(natives[0]?.closed).toBe(1);
  });

  it('refuses to show when the system does not support notifications', () => {
    const port = createNotificationsPort({
      supported: () => false,
      create: () => new FakeNotification({ title: '', body: '', silent: false }),
    });
    expect(() => port.show(request())).toThrow(/not supported/);
  });
});

describe('the Hub window behind chrome.windows', () => {
  it('reads focus and bounds from the window, and focuses it on request', () => {
    const focus = new EventEmitter();
    let focused = false;
    const window: HubWindow = {
      isDestroyed: () => false,
      isFocused: () => focused,
      focus: () => {
        focused = true;
      },
      getBounds: () => ({ x: 5, y: 6, width: 900, height: 700 }),
      on: (event, listener) => focus.on(event, listener),
      removeListener: (event, listener) => focus.removeListener(event, listener),
    };
    const port = createWindowsPort(() => window);
    expect(port.isFocused()).toBe(false);
    expect(port.bounds()).toEqual({ left: 5, top: 6, width: 900, height: 700 });
    const reported: boolean[] = [];
    const stop = port.subscribeFocus((value) => reported.push(value));
    focus.emit('focus');
    focus.emit('blur');
    expect(reported).toEqual([true, false]);
    stop();
    focus.emit('focus');
    expect(reported).toEqual([true, false]);
    port.focus();
    expect(port.isFocused()).toBe(true);
  });

  it('reads as unfocused with no size when the window is gone', () => {
    const port = createWindowsPort(() => undefined);
    expect(port.isFocused()).toBe(false);
    expect(port.bounds()).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });
});
