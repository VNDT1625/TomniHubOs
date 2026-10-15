import { describe, expect, it } from 'vitest';
import { createExtensionEventBus, type ExtensionEvent } from '@process/integrations/browserExtensions/api/types';
import {
  createCommandsApi,
  type CommandsPort,
  type KeyPress,
} from '@process/integrations/browserExtensions/api/groups/ui/commands';
import { createGrantRegistry, grantSeedFromManifest } from '@process/integrations/browserExtensions/api/grants';
import { ID_A, ID_B, call, manifestOf, shimWith, workerOf } from './shimFixture';
import { eventsOf } from './portsFixture';

const ID_C = 'cccccccccccccccccccccccccccccccc';

const fakeKeys = () => {
  const listeners = new Set<(press: KeyPress) => boolean>();
  const port: CommandsPort = {
    subscribeKeys: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  /** Sends a press to every listener and reports whether one matched. */
  const press = (value: KeyPress): boolean => {
    let matched = false;
    for (const listener of Array.from(listeners)) if (listener(value)) matched = true;
    return matched;
  };
  return { port, press };
};

const toggle = { key: 'Y', ctrl: true, alt: false, shift: true, meta: false };

describe('chrome.commands from the manifest', () => {
  it('lists the commands with their suggested shortcut, and drops names and shortcuts that are not valid', async () => {
    const shim = shimWith({
      [ID_A]: manifestOf({
        commands: {
          toggle: { description: 'Toggle it', suggested_key: { default: 'Ctrl+Shift+Y' } },
          broken: { description: 'Bad key', suggested_key: { default: 'Ctrl+Shift+Yes' } },
          _hidden: { description: 'Not a command', suggested_key: { default: 'Alt+Q' } },
          _execute_action: { description: 'Open', suggested_key: { default: 'Alt+Shift+P' } },
        },
      }),
    });
    expect(await call(shim, workerOf(ID_A), 'commands.getAll')).toEqual({
      ok: true,
      value: [
        { name: 'toggle', description: 'Toggle it', shortcut: 'Ctrl+Shift+Y' },
        { name: 'broken', description: 'Bad key', shortcut: '' },
        { name: '_execute_action', description: 'Open', shortcut: 'Alt+Shift+P' },
      ],
    });
    const bare = shimWith({ [ID_B]: manifestOf() });
    expect(await call(bare, workerOf(ID_B), 'commands.getAll')).toEqual({ ok: true, value: [] });
  });
});

describe('chrome.commands.onCommand', () => {
  it('fires the command of the extension that owns the pressed shortcut, and consumes that press', () => {
    const keys = fakeKeys();
    const shim = shimWith(
      {
        [ID_A]: manifestOf({ commands: { toggle: { suggested_key: { default: 'Ctrl+Shift+Y' } } } }),
        [ID_B]: manifestOf(),
      },
      { ports: { commands: keys.port } }
    );
    const events = eventsOf(shim);
    expect(keys.press(toggle)).toBe(true);
    expect(events.filter((event) => event.name === 'commands.onCommand')).toEqual([
      expect.objectContaining({ extensionId: ID_A, payload: 'toggle', args: ['toggle'] }),
    ]);
    expect(keys.press({ ...toggle, shift: false })).toBe(false);
    expect(keys.press({ ...toggle, key: 'Q' })).toBe(false);
  });

  it('reads Ctrl as Command on macOS, which the shim uses through the same grants', () => {
    const grants = createGrantRegistry({ log: () => undefined });
    const seed = grantSeedFromManifest(
      { extensionId: ID_A, packageId: 'p', connectionId: 'c' },
      manifestOf({ commands: { toggle: { suggested_key: { default: 'Ctrl+Shift+Y' } } } })
    );
    if (seed === undefined) throw new Error('the manifest should be usable');
    grants.register(seed);
    const events = createExtensionEventBus();
    const seen: ExtensionEvent[] = [];
    events.subscribe((event) => seen.push(event));
    let listener: ((press: KeyPress) => boolean) | undefined;
    createCommandsApi(
      { grants, events },
      {
        subscribeKeys: (value) => {
          listener = value;
          return () => undefined;
        },
      },
      'darwin'
    );
    expect(listener?.({ key: 'Y', ctrl: false, alt: false, shift: true, meta: true })).toBe(true);
    expect(listener?.({ key: 'Y', ctrl: true, alt: false, shift: true, meta: false })).toBe(false);
    expect(seen.map((event) => [event.extensionId, event.name, event.payload])).toEqual([
      [ID_A, 'commands.onCommand', 'toggle'],
    ]);
  });

  it('is not wired without the key port, and sends nothing', () => {
    const shim = shimWith({ [ID_C]: manifestOf({ commands: { toggle: { suggested_key: { default: 'Ctrl+Y' } } } }) });
    const events = eventsOf(shim);
    expect(events).toEqual([]);
  });
});
