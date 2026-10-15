/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `chrome.commands` (docs/platform/repotopackage-design.md sections 12.3 and 12.8): `getAll` lists the commands an
 * extension declares in its manifest, with the shortcut suggested for this system, and `onCommand` fires when the
 * person presses that shortcut while a Browser tab has the focus.
 *
 * - No permission is needed, as in Chrome. Only the shortcuts the manifest suggests are bound. The person cannot change
 *   them yet, and a shortcut that is malformed is dropped when the manifest is read (grants.ts).
 * - Keys pressed in the Hub window never reach this. A press that matches a command is consumed, so the page does not
 *   get that key too.
 * - The event carries the command name only. Chrome's optional tab argument is not sent.
 */

import { z } from 'zod';
import type { CommandPlatform, CommandSpec } from '@process/integrations/browserExtensions/api/grants';
import { emitTo } from '@process/integrations/browserExtensions/api/groups/shared/emit';
import { defineApiMethod, type ApiGroup, type GroupContext } from '@process/integrations/browserExtensions/api/types';

/** One key press as the wiring reads it: the key in the accelerator grammar and the modifiers held. */
export type KeyPress = Readonly<{ key: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }>;

export type CommandsPort = Readonly<{
  /** Returns the unsubscribe function. The listener returns true when the press matched a command. */
  subscribeKeys: (listener: (press: KeyPress) => boolean) => () => void;
}>;

const platformKey = (platform: NodeJS.Platform): CommandPlatform => {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'mac';
  if (platform === 'linux') return 'linux';
  return 'default';
};

/**
 * Chrome's meaning of the modifiers: `Ctrl` is Command on macOS and `MacCtrl` is Control there. Elsewhere `Ctrl` is
 * Control and the Mac-only modifiers have no effect.
 */
const parseAccelerator = (text: string, mac: boolean): KeyPress => {
  const parts = text.split('+');
  const modifiers = new Set(parts.slice(0, -1));
  return {
    key: parts[parts.length - 1] ?? '',
    ctrl: mac ? modifiers.has('MacCtrl') : modifiers.has('Ctrl'),
    alt: modifiers.has('Alt'),
    shift: modifiers.has('Shift'),
    meta: mac ? modifiers.has('Ctrl') || modifiers.has('Command') : false,
  };
};

const sameKey = (left: KeyPress, right: KeyPress): boolean =>
  left.key === right.key &&
  left.ctrl === right.ctrl &&
  left.alt === right.alt &&
  left.shift === right.shift &&
  left.meta === right.meta;

export const createCommandsApi = (
  context: GroupContext,
  port: CommandsPort | undefined,
  platform: NodeJS.Platform = process.platform
): ApiGroup => {
  const both = ['service-worker', 'frame'] as const;
  const mac = platform === 'darwin';
  /** The suggested shortcut for this system, falling back to the one for every system. Empty when there is none. */
  const shortcutOf = (spec: CommandSpec): string =>
    spec.shortcuts[platformKey(platform)] ?? spec.shortcuts.default ?? '';

  const methods = [
    defineApiMethod({
      name: 'commands.getAll',
      callers: both,
      args: z.tuple([]),
      handle: (call) =>
        call.grants.commands.map((spec) => ({
          name: spec.name,
          description: spec.description,
          shortcut: shortcutOf(spec),
        })),
    }),
  ];

  const unsubscribe = port?.subscribeKeys((press) => {
    let matched = false;
    for (const extensionId of context.grants.ids()) {
      const grants = context.grants.get(extensionId);
      if (grants === undefined) continue;
      for (const spec of grants.commands) {
        const text = shortcutOf(spec);
        if (text === '' || !sameKey(parseAccelerator(text, mac), press)) continue;
        matched = true;
        emitTo(context, extensionId, 'commands.onCommand', [spec.name]);
      }
    }
    return matched;
  });

  return { methods, ...(unsubscribe === undefined ? {} : { dispose: unsubscribe }) };
};
