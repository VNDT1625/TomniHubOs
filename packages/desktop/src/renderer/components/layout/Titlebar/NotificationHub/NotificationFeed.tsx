/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Input, Message, Switch } from '@arco-design/web-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { managerClient } from '@/renderer/pages/manager/managerBridgeClient';
import {
  notificationActions,
  useNotificationHub,
  useNotifications,
  type AppNotification,
} from '@/renderer/services/notificationService';
import NotificationCard from './NotificationCard';
import { EMPTY_FILTER, filterFeed, type FeedFilter } from './notificationView';

export type FeedTab = 'focus' | 'digest' | 'filtered';

const MAX_SHOWN = 150;

export const tabOf = (item: Pick<AppNotification, 'level'>): FeedTab =>
  item.level === 'P0' || item.level === 'P1' ? 'focus' : item.level === 'P2' ? 'digest' : 'filtered';

/** Opens a notification's target: an in-app route, the built-in browser, or the system browser. */
export const useOpenNotification = (onNavigate?: () => void) => {
  const navigate = useNavigate();
  return (item: AppNotification) => {
    void notificationActions.feedback(item.id, 'opened');
    if (item.actionUrl) {
      onNavigate?.();
      navigate(item.actionUrl);
    } else if (item.source === 'web') {
      onNavigate?.();
      navigate('/browser');
    } else if (item.url) {
      void ipcBridge.shell.openExternal.invoke(item.url).catch((): void => undefined);
    }
  };
};

/** One list of the Notifications page: a search box, an unread switch and the rows of one tab. */
const NotificationFeed: React.FC<{ tab: FeedTab }> = ({ tab }) => {
  const { t } = useTranslation();
  const { notifications } = useNotifications();
  const hub = useNotificationHub();
  const open = useOpenNotification();
  const [filter, setFilter] = useState<FeedFilter>(EMPTY_FILTER);
  const mutedSources = hub.settings.rules.mutedSources;

  const items = useMemo(
    () =>
      filterFeed(
        notifications.filter((item) => tabOf(item) === tab),
        filter
      ).slice(0, MAX_SHOWN),
    [notifications, tab, filter]
  );

  const createTask = async (item: AppNotification) => {
    try {
      const result = await managerClient.addTask({
        input: {
          title: item.title.slice(0, 200),
          description: [item.sourceLabel, item.sender, item.message].filter(Boolean).join('\n'),
          priority: item.level === 'P0' ? 'urgent' : item.level === 'P1' ? 'high' : 'medium',
          tags: ['notification'],
        },
      });
      if (!result.ok) throw new Error('add-task');
      void notificationActions.markRead([item.id]);
      Message.success(t('common.notificationHub.taskCreated'));
    } catch {
      Message.error(t('common.notificationHub.taskFailed'));
    }
  };

  return (
    <div className='tnh-feed'>
      <div className='tnh-filterbar' role='search'>
        <Input
          allowClear
          value={filter.text}
          placeholder={t('common.notificationHub.view.search')}
          aria-label={t('common.notificationHub.view.search')}
          onChange={(text) => setFilter((current) => ({ ...current, text }))}
        />
        <label className='tnh-toolbar-switch'>
          <Switch
            size='small'
            checked={filter.unreadOnly}
            aria-label={t('common.notificationHub.view.unreadOnly')}
            onChange={(unreadOnly) => setFilter((current) => ({ ...current, unreadOnly }))}
          />
          <span>{t('common.notificationHub.view.unreadOnly')}</span>
        </label>
      </div>
      {items.length === 0 ? (
        <div className='tnh-empty'>{t(`common.notificationHub.empty.${tab}`)}</div>
      ) : (
        <div className='tnh-rows'>
          {items.map((item) => (
            <NotificationCard
              key={item.id}
              item={item}
              mutedSource={mutedSources.includes(item.connectorId ?? item.source)}
              onOpen={open}
              onCreateTask={(entry) => void createTask(entry)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default NotificationFeed;
