/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useLayoutEffect, useMemo, useState } from 'react';
import { Drawer } from '@arco-design/web-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { notificationActions, useNotifications } from '@/renderer/services/notificationService';
import { useOpenNotification } from './NotificationFeed';

type NotificationCenterDrawerProps = {
  visible: boolean;
  onClose: () => void;
};

const PANEL_WIDTH = 340;
const PANEL_GAP = 12; // preferred distance from the window's right edge
const ARROW_HALF = 10;
/** How far the pointer must stay inside the panel before it slides over to reach the bell. */
const ARROW_INSET = 28;
const BELL_SELECTOR = 'button[aria-label="Trung tâm Thông báo"]';
/** The flash shows only what needs a look; the rest lives on the Notifications page. */
const MAX_FLASH = 5;

type Anchor = { top: number; right: number; arrowRight: number };

/** Where the panel opens: under the bell, with the arrow centred on it.
 *
 * The panel prefers the window's right edge, but the badge tracks `--hub-rail-w` and slides
 * left as the rail widens. Pinning the panel and clamping the arrow instead left the pointer
 * stuck at the panel's edge while the bell kept moving, so the panel shifts left just far
 * enough to keep the bell `ARROW_INSET` inside it. */
const measureAnchor = (): Anchor => {
  const bell = document.querySelector<HTMLElement>(BELL_SELECTOR);
  if (!bell) return { top: 56, right: PANEL_GAP, arrowRight: 40 };
  const rect = bell.getBoundingClientRect();
  const centreX = rect.left + rect.width / 2;
  const fromRight = window.innerWidth - centreX;
  const right = Math.round(Math.max(PANEL_GAP, fromRight - (PANEL_WIDTH - ARROW_INSET)));
  return {
    top: Math.round(rect.bottom + ARROW_HALF + 2),
    right,
    arrowRight: Math.round(fromRight - right - ARROW_HALF),
  };
};

const shortAge = (timestamp: number, locale: string): string => {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' });
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(seconds, 'second');
  if (abs < 3600) return format.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), 'hour');
  return format.format(Math.round(seconds / 86_400), 'day');
};

/**
 * Flash notifications: the header bell's quick look. It lists the few unread
 * urgent and important items, one line each, and leads to the Notifications
 * page for everything else.
 */
export const NotificationCenterDrawer: React.FC<NotificationCenterDrawerProps> = ({ visible, onClose }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { notifications, unreadCount } = useNotifications();
  const open = useOpenNotification(onClose);

  const flash = useMemo(
    () =>
      notifications
        .filter((item) => !item.read && (item.level === 'P0' || item.level === 'P1'))
        .toSorted((left, right) => (left.level === right.level ? 0 : left.level === 'P0' ? -1 : 1))
        .slice(0, MAX_FLASH),
    [notifications]
  );
  const flashIds = useMemo(() => new Set(flash.map((item) => item.id)), [flash]);
  const more = Math.max(0, unreadCount - flash.length);

  const [anchor, setAnchor] = useState<Anchor>(() => ({ top: 56, right: PANEL_GAP, arrowRight: 40 }));
  useLayoutEffect(() => {
    if (visible) setAnchor(measureAnchor());
  }, [visible]);

  const openAll = () => {
    onClose();
    navigate('/notifications');
  };

  return (
    <Drawer
      width={PANEL_WIDTH}
      placement='right'
      maskStyle={{ background: 'transparent' }}
      style={
        {
          top: anchor.top,
          right: anchor.right,
          bottom: 'auto',
          height: 'auto',
          maxHeight: `calc(100vh - ${anchor.top + 16}px)`,
          '--tnh-arrow-right': `${anchor.arrowRight}px`,
        } as React.CSSProperties
      }
      title={<span>{t('common.notificationHub.flash.title')}</span>}
      visible={visible}
      onCancel={onClose}
      footer={null}
      className='tomni-glass-panel tomni-notif-drawer tomni-notif-flash'
    >
      <div className='tnh-flash' data-testid='notification-flash'>
        {flash.length === 0 ? (
          <div className='tnh-empty'>{t('common.notificationHub.flash.empty')}</div>
        ) : (
          <ul className='tnh-flash-list'>
            {flash.map((item) => (
              <li key={item.id}>
                <button
                  type='button'
                  className={`tnh-flash-row tnh-flash-row--${item.level}`}
                  data-testid={`flash-${item.id}`}
                  onClick={() => open(item)}
                >
                  <span className={`tnh-dot tnh-dot--${item.level}`} aria-hidden='true' />
                  <span className='tnh-flash-text'>
                    <span className='tnh-flash-title'>{item.title}</span>
                    <span className='tnh-flash-meta'>
                      {item.sourceLabel} · {shortAge(item.timestamp, i18n.language)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className='tnh-flash-foot'>
          <button type='button' className='tnh-action' onClick={openAll}>
            {more > 0
              ? t('common.notificationHub.flash.viewAllMore', { count: more })
              : t('common.notificationHub.flash.viewAll')}
          </button>
          {flash.length > 0 && (
            <button
              type='button'
              className='tnh-action tnh-action--quiet'
              onClick={() => void notificationActions.markRead([...flashIds])}
            >
              {t('common.notificationHub.actions.markAllRead')}
            </button>
          )}
        </div>
      </div>
    </Drawer>
  );
};

export default NotificationCenterDrawer;
