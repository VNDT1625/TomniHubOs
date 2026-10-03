/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

export type NotificationLevel = 'P0' | 'P1' | 'P2' | 'P3';
export type NotificationSource = 'system' | 'agent' | 'cron' | 'tom' | 'telegram' | 'email' | 'zalo';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  timestamp: number;
  level: NotificationLevel;
  source: NotificationSource;
  read: boolean;
  actionUrl?: string;
  actionLabel?: string;
  metadata?: Record<string, unknown>;
}

const STORAGE_KEY = 'tomni.notifications.v1';

const INITIAL_NOTIFICATIONS: AppNotification[] = [
  {
    id: 'notif_welcome_tom',
    title: 'Thưởng Chào Mừng Đăng Ký',
    message: 'Bạn đã nhận được +5.00 TOM trong ví tài khoản để bắt đầu trải nghiệm AI Agent và các công cụ.',
    timestamp: Date.now() - 1000 * 60 * 5, // 5 mins ago
    level: 'P0',
    source: 'tom',
    read: false,
    actionUrl: '/account',
    actionLabel: 'Xem Ví TOM',
  },
  {
    id: 'notif_laya_ready',
    title: 'Laya Decision Engine Đã Khởi Động',
    message:
      'Mô hình phân loại cục bộ (~33ms, Zero Data Egress) đang chủ động lọc thông báo và bảo vệ thông tin cá nhân.',
    timestamp: Date.now() - 1000 * 60 * 15, // 15 mins ago
    level: 'P1',
    source: 'system',
    read: false,
    actionUrl: '/settings/system',
    actionLabel: 'Xem Trạng Thái',
  },
  {
    id: 'notif_cron_status',
    title: 'Lập Lịch Tác Vụ Sẵn Sàng',
    message: 'Bộ điều phối Cron Job tự động đã sẵn sàng thực thi các tác vụ nền định kỳ.',
    timestamp: Date.now() - 1000 * 60 * 60, // 1 hour ago
    level: 'P1',
    source: 'cron',
    read: true,
    actionUrl: '/scheduled',
    actionLabel: 'Quản Lý Lập Lịch',
  },
  {
    id: 'notif_agent_ready',
    title: 'Công Cụ & MCP Hub Đồng Bộ Hoá',
    message: 'Môi trường Agent Chat và các công cụ MCP cục bộ đã hoàn tất nạp cấu hình.',
    timestamp: Date.now() - 1000 * 60 * 120, // 2 hours ago
    level: 'P2',
    source: 'agent',
    read: true,
    actionUrl: '/guid',
    actionLabel: 'Tạo Hội Thoại',
  },
];

type Listener = () => void;
const listeners = new Set<Listener>();

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error('Failed to notify notification listener:', err);
    }
  }
}

function loadStoredNotifications(): AppNotification[] {
  if (typeof window === 'undefined') return INITIAL_NOTIFICATIONS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_NOTIFICATIONS));
      return INITIAL_NOTIFICATIONS;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as AppNotification[];
    }
    return INITIAL_NOTIFICATIONS;
  } catch {
    return INITIAL_NOTIFICATIONS;
  }
}

function persistNotifications(items: AppNotification[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (err) {
    console.error('Failed to persist notifications:', err);
  }
}

let inMemoryNotifications: AppNotification[] = loadStoredNotifications();

export const notificationService = {
  getAll(): AppNotification[] {
    return [...inMemoryNotifications];
  },

  getUnreadCount(): number {
    return inMemoryNotifications.filter((n) => !n.read).length;
  },

  getUnreadP0Count(): number {
    return inMemoryNotifications.filter((n) => !n.read && n.level === 'P0').length;
  },

  getUnreadP1Count(): number {
    return inMemoryNotifications.filter((n) => !n.read && n.level === 'P1').length;
  },

  add(item: {
    title: string;
    message: string;
    level: NotificationLevel;
    source: NotificationSource;
    actionUrl?: string;
    actionLabel?: string;
    metadata?: Record<string, unknown>;
  }): AppNotification {
    const newNotif: AppNotification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: item.title,
      message: item.message,
      timestamp: Date.now(),
      level: item.level,
      source: item.source,
      read: false,
      actionUrl: item.actionUrl,
      actionLabel: item.actionLabel,
      metadata: item.metadata,
    };
    inMemoryNotifications = [newNotif, ...inMemoryNotifications];
    persistNotifications(inMemoryNotifications);
    notifyListeners();
    return newNotif;
  },

  markAsRead(id: string): void {
    let changed = false;
    inMemoryNotifications = inMemoryNotifications.map((item) => {
      if (item.id === id && !item.read) {
        changed = true;
        return { ...item, read: true };
      }
      return item;
    });
    if (changed) {
      persistNotifications(inMemoryNotifications);
      notifyListeners();
    }
  },

  markAllAsRead(): void {
    const hasUnread = inMemoryNotifications.some((n) => !n.read);
    if (!hasUnread) return;
    inMemoryNotifications = inMemoryNotifications.map((n) => ({ ...n, read: true }));
    persistNotifications(inMemoryNotifications);
    notifyListeners();
  },

  remove(id: string): void {
    const filtered = inMemoryNotifications.filter((n) => n.id !== id);
    if (filtered.length !== inMemoryNotifications.length) {
      inMemoryNotifications = filtered;
      persistNotifications(inMemoryNotifications);
      notifyListeners();
    }
  },

  clearAll(): void {
    if (inMemoryNotifications.length === 0) return;
    inMemoryNotifications = [];
    persistNotifications(inMemoryNotifications);
    notifyListeners();
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/**
 * React hook to access realtime notifications
 */
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
  const [notifications, setNotifications] = useState<AppNotification[]>(() => notificationService.getAll());

  useEffect(() => {
    const unsubscribe = notificationService.subscribe(() => {
      setNotifications(notificationService.getAll());
    });
    return () => unsubscribe();
  }, []);

  return {
    notifications,
    unreadCount: notifications.filter((n) => !n.read).length,
    unreadP0Count: notifications.filter((n) => !n.read && n.level === 'P0').length,
    unreadP1Count: notifications.filter((n) => !n.read && n.level === 'P1').length,
    markAsRead: notificationService.markAsRead,
    markAllAsRead: notificationService.markAllAsRead,
    remove: notificationService.remove,
    clearAll: notificationService.clearAll,
  };
}
