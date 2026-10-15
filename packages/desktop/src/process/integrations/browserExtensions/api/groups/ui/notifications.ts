/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `chrome.notifications` (docs/platform/repotopackage-design.md sections 12.3 and 12.8): `create`, `clear`, `getAll` and
 * `onClicked`, shown as native notifications through {@link NotificationsPort}. Every method needs the manifest
 * `notifications` permission.
 *
 * - Only `basic` notifications exist. Other types answer UNSUPPORTED. `iconUrl` and the other optional fields are
 *   accepted and ignored: a notification shows its title and message, and the Hub prefixes the extension's name.
 * - Each extension has its own notifications, and a click is sent only to the extension that created it.
 * - Limits per extension: 50 open at once, and 20 shown per minute, so a loop cannot flood the person.
 */

import { z } from 'zod';
import { emitTo } from '@process/integrations/browserExtensions/api/groups/shared/emit';
import {
  ApiError,
  defineApiMethod,
  type ApiGroup,
  type GroupContext,
} from '@process/integrations/browserExtensions/api/types';

export type NotificationRequest = Readonly<{
  /** The id the port knows this notification by. It is not the extension's id for it. */
  id: string;
  title: string;
  message: string;
  /** The extension's name, shown before the title so the person knows where it came from. */
  source: string;
  silent: boolean;
}>;

export type NotificationsPort = Readonly<{
  show: (request: NotificationRequest) => void;
  close: (id: string) => void;
  /** Returns the unsubscribe function. The listener gets the port id of the notification that was clicked. */
  subscribeClicks: (listener: (id: string) => void) => () => void;
}>;

const NOTIFICATIONS = ['notifications'] as const;
const MAX_ACTIVE = 50;
const SHOW_WINDOW_MS = 60_000;
const SHOW_PER_WINDOW = 20;
const MAX_TITLE = 200;
const MAX_MESSAGE = 1000;

/** Unknown fields are dropped rather than refused, so an extension that sends Chrome's optional fields still works. */
const optionsSchema = z.object({
  type: z.enum(['basic', 'image', 'list', 'progress']).optional(),
  title: z.string().max(MAX_TITLE),
  message: z.string().max(MAX_MESSAGE).optional(),
  iconUrl: z.string().max(2048).optional(),
  silent: z.boolean().optional(),
});

export const createNotificationsApi = (context: GroupContext, port: NotificationsPort | undefined): ApiGroup => {
  const both = ['service-worker', 'frame'] as const;
  /** Per extension: the notification id the extension chose (or was given) to the port id. */
  const byExtension = new Map<string, Map<string, string>>();
  /** Port id to its owner, so a click can be sent back to the right extension. */
  const owners = new Map<string, Readonly<{ extensionId: string; notificationId: string }>>();
  const shown = new Map<string, number[]>();
  let sequence = 0;

  const need = (): NotificationsPort => {
    if (port === undefined) {
      throw new ApiError('UNSUPPORTED', 'chrome.notifications is not available: native notifications are not wired.');
    }
    return port;
  };
  /** Forgets one notification of an extension and returns its port id, when it had one. */
  const forget = (extensionId: string, notificationId: string): string | undefined => {
    const own = byExtension.get(extensionId);
    const internal = own?.get(notificationId);
    if (own === undefined || internal === undefined) return undefined;
    own.delete(notificationId);
    if (own.size === 0) byExtension.delete(extensionId);
    owners.delete(internal);
    return internal;
  };
  const throttle = (extensionId: string): void => {
    const stamp = Date.now();
    const recent = (shown.get(extensionId) ?? []).filter((time) => stamp - time < SHOW_WINDOW_MS);
    if (recent.length >= SHOW_PER_WINDOW) {
      throw new ApiError('BUSY', 'Too many notifications were shown too quickly.');
    }
    shown.set(extensionId, [...recent, stamp]);
  };

  const methods = [
    defineApiMethod({
      name: 'notifications.create',
      callers: both,
      requires: NOTIFICATIONS,
      args: z.union([z.tuple([optionsSchema]), z.tuple([z.string().max(256), optionsSchema])]),
      handle: (call, args) => {
        const host = need();
        const list: readonly unknown[] = args;
        const requested = list.length === 2 ? String(list[0]) : '';
        const options = (list.length === 2 ? list[1] : list[0]) as z.output<typeof optionsSchema>;
        if (options.type !== undefined && options.type !== 'basic') {
          throw new ApiError('UNSUPPORTED', 'Only basic notifications are supported in Tomny.');
        }
        throttle(call.extensionId);
        sequence += 1;
        const notificationId = requested === '' ? `notification-${sequence}` : requested;
        // Re-using an id replaces that notification, so it does not count twice.
        const replaced = forget(call.extensionId, notificationId);
        if (replaced !== undefined) host.close(replaced);
        if ((byExtension.get(call.extensionId)?.size ?? 0) >= MAX_ACTIVE) {
          throw new ApiError('REJECTED', 'Too many notifications are open.');
        }

        const internal = `notification-port-${sequence}`;
        const own = byExtension.get(call.extensionId) ?? new Map<string, string>();
        own.set(notificationId, internal);
        byExtension.set(call.extensionId, own);
        owners.set(internal, { extensionId: call.extensionId, notificationId });
        try {
          host.show({
            id: internal,
            title: options.title,
            message: options.message ?? '',
            source: call.grants.name,
            silent: options.silent === true,
          });
        } catch (error) {
          forget(call.extensionId, notificationId);
          throw error;
        }
        return notificationId;
      },
    }),
    defineApiMethod({
      name: 'notifications.clear',
      callers: both,
      requires: NOTIFICATIONS,
      args: z.tuple([z.string().max(256)]),
      handle: (call, [notificationId]) => {
        const host = need();
        const internal = forget(call.extensionId, notificationId);
        if (internal === undefined) return false;
        host.close(internal);
        return true;
      },
    }),
    defineApiMethod({
      name: 'notifications.getAll',
      callers: both,
      requires: NOTIFICATIONS,
      args: z.tuple([]),
      handle: (call) =>
        Object.fromEntries([...(byExtension.get(call.extensionId)?.keys() ?? [])].map((id) => [id, true])),
    }),
  ];

  const unsubscribe = port?.subscribeClicks((internal) => {
    const owner = owners.get(internal);
    if (owner !== undefined) emitTo(context, owner.extensionId, 'notifications.onClicked', [owner.notificationId]);
  });

  return { methods, ...(unsubscribe === undefined ? {} : { dispose: unsubscribe }) };
};
