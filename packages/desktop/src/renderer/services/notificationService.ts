/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_NOTIFICATION_RULES,
  notificationHubChannels,
  type HubNotification,
  type NotificationFeedbackAction,
  type NotificationHubSnapshot,
  type NotificationLevel,
  type NotificationQuery,
} from '@/common/types/platform/notificationHub';

export type { NotificationLevel } from '@/common/types/platform/notificationHub';

/** A hub notification with its text already translated for the current language. */
export type AppNotification = HubNotification & {
  /** Translated body text. */
  message: string;
  timestamp: number;
  /** In-app route to open, when the notification has one. */
  actionUrl?: string;
};

const EMPTY: NotificationHubSnapshot = {
  items: [],
  settings: {
    connectors: [],
    rules: DEFAULT_NOTIFICATION_RULES,
  },
  status: [],
  layaReady: false,
};

let current: NotificationHubSnapshot = EMPTY;
let started = false;
const listeners = new Set<(snapshot: NotificationHubSnapshot) => void>();

const publish = (snapshot: NotificationHubSnapshot): void => {
  current = snapshot;
  for (const listener of listeners) listener(snapshot);
};

/** One shared subscription to Main for every component that shows notifications. */
const ensureStarted = (): void => {
  if (started) return;
  started = true;
  try {
    notificationHubChannels.changed.on(publish);
    void notificationHubChannels.snapshot
      .invoke()
      .then(publish)
      .catch((): void => undefined);
  } catch {
    // Outside the desktop shell there is no hub; the empty snapshot stands.
  }
};

/** Live snapshot of the notification hub (items, connectors, rules). */
export const useNotificationHub = (): NotificationHubSnapshot => {
  const [snapshot, setSnapshot] = useState<NotificationHubSnapshot>(current);
  useEffect(() => {
    ensureStarted();
    listeners.add(setSnapshot);
    setSnapshot(current);
    return () => {
      listeners.delete(setSnapshot);
    };
  }, []);
  return snapshot;
};

export const notificationActions = {
  markRead: (ids: string[]) => notificationHubChannels.markRead.invoke({ ids }),
  markAllRead: () => notificationHubChannels.markAllRead.invoke(),
  remove: (ids: string[]) => notificationHubChannels.remove.invoke({ ids }),
  clear: (level?: NotificationLevel) => notificationHubChannels.clear.invoke({ level }),
  reclassify: (id: string, level: NotificationLevel, remember = false) =>
    notificationHubChannels.reclassify.invoke({ id, level, remember }),
  /** Learning signal (`opened`) or one-click mute/boost of the item's source or sender. */
  feedback: (id: string, action: NotificationFeedbackAction) => notificationHubChannels.feedback.invoke({ id, action }),
  /** Local digest of a period, computed in Main without any model. */
  summary: (query: NotificationQuery) => notificationHubChannels.summary.invoke(query),
};

/** Notifications for display, translated, with unread counts for the header badge. */
export function useNotifications(): {
  notifications: AppNotification[];
  unreadCount: number;
  unreadP0Count: number;
  unreadP1Count: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  remove: (id: string) => void;
  clearAll: () => void;
} {
  const { t } = useTranslation();
  const snapshot = useNotificationHub();
  const notifications = useMemo(
    () =>
      snapshot.items.map((item): AppNotification => ({
        ...item,
        title: item.i18n ? t(item.i18n.title, { ...item.i18n.params, defaultValue: item.title }) : item.title,
        message:
          item.i18n?.body !== undefined
            ? t(item.i18n.body, { ...item.i18n.params, defaultValue: item.body })
            : item.body,
        timestamp: item.createdAt,
        actionUrl: item.route,
      })),
    [snapshot.items, t]
  );
  const markAsRead = useCallback((id: string): void => {
    void notificationActions.markRead([id]);
  }, []);
  const markAllAsRead = useCallback((): void => {
    void notificationActions.markAllRead();
  }, []);
  const remove = useCallback((id: string): void => {
    void notificationActions.remove([id]);
  }, []);
  const clearAll = useCallback((): void => {
    void notificationActions.clear();
  }, []);
  const unread = notifications.filter((item) => !item.read);
  return {
    notifications,
    unreadCount: unread.filter((item) => item.level !== 'P3').length,
    unreadP0Count: unread.filter((item) => item.level === 'P0').length,
    unreadP1Count: unread.filter((item) => item.level === 'P1').length,
    markAsRead,
    markAllAsRead,
    remove,
    clearAll,
  };
}
