/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Button, Tabs, Tooltip } from '@arco-design/web-react';
import { CheckOne, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { notificationHubChannels } from '@/common/types/platform/notificationHub';
import NotificationFeed, {
  tabOf,
  type FeedTab,
} from '@/renderer/components/layout/Titlebar/NotificationHub/NotificationFeed';
import NotificationSourcesPanel from '@/renderer/components/layout/Titlebar/NotificationHub/NotificationSourcesPanel';
import NotificationTriagePanel from '@/renderer/components/layout/Titlebar/NotificationHub/NotificationTriagePanel';
import { notificationActions, useNotificationHub, useNotifications } from '@/renderer/services/notificationService';

const FEED_TABS: readonly FeedTab[] = ['focus', 'digest', 'filtered'];

/**
 * Notification center: the Hub-shell page behind the sidebar's Notifications
 * entry. One flat row of tabs (the three lists, sources, Laya settings); the
 * header bell only shows a short flash of what needs attention.
 */
const NotificationsPage: React.FC = () => {
  const { t } = useTranslation();
  const hub = useNotificationHub();
  const { notifications } = useNotifications();
  const [syncing, setSyncing] = useState(false);
  const unread = (tab: FeedTab) => notifications.filter((item) => !item.read && tabOf(item) === tab).length;

  const sync = async () => {
    setSyncing(true);
    try {
      await notificationHubChannels.syncNow.invoke({});
    } finally {
      setSyncing(false);
    }
  };

  const feedTitle = (tab: FeedTab) => {
    const count = tab === 'filtered' ? 0 : unread(tab);
    return (
      <span className='tnh-tab'>
        {t(`common.notificationHub.tabs.${tab}`)}
        {count > 0 && <span className='tnh-count'>{count}</span>}
      </span>
    );
  };

  return (
    <div className='hub-page tnh-scope tnh-page' data-testid='notifications-page'>
      <div className='hub-page-heading'>
        <div>
          <h1>{t('common.notificationHub.title')}</h1>
          <p>{t('common.notificationHub.page.subtitle')}</p>
        </div>
        <span className='tnh-header-actions'>
          <Tooltip content={t('common.notificationHub.actions.syncAll')}>
            <Button
              type='text'
              loading={syncing}
              icon={<Refresh theme='outline' size={16} />}
              aria-label={t('common.notificationHub.actions.syncAll')}
              onClick={() => void sync()}
            />
          </Tooltip>
          <Tooltip content={t('common.notificationHub.actions.markAllRead')}>
            <Button
              type='text'
              icon={<CheckOne theme='outline' size={16} />}
              aria-label={t('common.notificationHub.actions.markAllRead')}
              onClick={() => void notificationActions.markAllRead()}
            />
          </Tooltip>
        </span>
      </div>
      <Tabs defaultActiveTab='focus' type='line'>
        {FEED_TABS.map((tab) => (
          <Tabs.TabPane key={tab} title={feedTitle(tab)}>
            <NotificationFeed tab={tab} />
          </Tabs.TabPane>
        ))}
        <Tabs.TabPane key='sources' title={t('common.notificationHub.tabs.sources')}>
          <NotificationSourcesPanel snapshot={hub} showCatalog />
        </Tabs.TabPane>
        <Tabs.TabPane key='triage' title={t('common.notificationHub.page.tabs.triage')}>
          <NotificationTriagePanel snapshot={hub} />
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
};

export default NotificationsPage;
