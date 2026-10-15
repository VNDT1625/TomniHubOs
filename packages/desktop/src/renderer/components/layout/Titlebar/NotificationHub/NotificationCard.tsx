/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Dropdown, Menu } from '@arco-design/web-react';
import { AddOne, Check, Close, LinkOne, More } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import {
  NOTIFICATION_LEVELS,
  type NotificationFeedbackAction,
  type NotificationLevel,
} from '@/common/types/platform/notificationHub';
import { notificationActions, type AppNotification } from '@/renderer/services/notificationService';

const shortAge = (timestamp: number, locale: string): string => {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, {
    numeric: 'auto',
    style: 'narrow',
  });
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(seconds, 'second');
  if (abs < 3600) return format.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), 'hour');
  return format.format(Math.round(seconds / 86_400), 'day');
};

/** Chat toasts and page notifications name the person in their title. */
const titleNamesPerson = (item: AppNotification): boolean =>
  !item.sender && (item.source === 'os' || item.source === 'web');

/**
 * One notification as a quiet row: a level dot, the title, one muted line of
 * source, sender and age. Actions are icons that appear on hover or focus;
 * the rarer ones (re-rank, mute, boost) sit in the "more" menu.
 */
const NotificationCard: React.FC<{
  item: AppNotification;
  mutedSource: boolean;
  onOpen: (item: AppNotification) => void;
  onCreateTask: (item: AppNotification) => void;
}> = ({ item, mutedSource, onOpen, onCreateTask }) => {
  const { t, i18n } = useTranslation();
  const canOpen = Boolean(item.actionUrl || item.url);
  const moreMenu = (
    <Menu
      onClickMenuItem={(key) => {
        const [kind, value] = key.split(':') as [string, string];
        if (kind === 'level') void notificationActions.reclassify(item.id, value as NotificationLevel);
        if (kind === 'remember') void notificationActions.reclassify(item.id, value as NotificationLevel, true);
        if (kind === 'feedback') void notificationActions.feedback(item.id, value as NotificationFeedbackAction);
      }}
    >
      {NOTIFICATION_LEVELS.filter((level) => level !== item.level).map((level) => (
        <Menu.Item key={`level:${level}`}>{t(`common.notificationHub.level.${level}`)}</Menu.Item>
      ))}
      {item.sender && (
        <>
          <Menu.Item key='remember:P0'>{t('common.notificationHub.actions.alwaysImportant')}</Menu.Item>
          <Menu.Item key='remember:P3'>{t('common.notificationHub.actions.alwaysMute')}</Menu.Item>
        </>
      )}
      {titleNamesPerson(item) && (
        <>
          <Menu.Item key='feedback:boostSender'>{t('common.notificationHub.actions.boostSender')}</Menu.Item>
          <Menu.Item key='feedback:muteSender'>{t('common.notificationHub.actions.muteSender')}</Menu.Item>
        </>
      )}
      <Menu.Item key={mutedSource ? 'feedback:unmuteSource' : 'feedback:muteSource'}>
        {t(mutedSource ? 'common.notificationHub.actions.unmuteSource' : 'common.notificationHub.actions.muteSource', {
          name: item.sourceLabel,
        })}
      </Menu.Item>
    </Menu>
  );
  const meta = [item.sourceLabel, item.sender, shortAge(item.timestamp, i18n.language)].filter(Boolean).join(' · ');
  const why = `${t(`common.notificationHub.level.${item.level}`)} · ${t(`common.notificationHub.by.${item.classifiedBy}`)}`;
  return (
    <article
      className={`tnh-row tnh-row--${item.level} ${item.read ? 'tnh-row--read' : ''}`}
      data-testid={`notification-${item.id}`}
      aria-label={`${t(`common.notificationHub.level.${item.level}`)}: ${item.title}`}
      title={why}
    >
      <span className={`tnh-dot tnh-dot--${item.level}`} aria-hidden='true' />
      <div className='tnh-row-main'>
        <div className='tnh-row-title'>{item.title}</div>
        <div className='tnh-row-meta'>{meta}</div>
        {item.message && <div className='tnh-row-body'>{item.message}</div>}
      </div>
      <div className='tnh-row-actions'>
        {canOpen && (
          <button
            type='button'
            className='tnh-icon-btn'
            aria-label={t('common.notificationHub.actions.open')}
            onClick={() => onOpen(item)}
          >
            <LinkOne theme='outline' size={15} />
          </button>
        )}
        <button
          type='button'
          className='tnh-icon-btn'
          aria-label={t('common.notificationHub.actions.createTask')}
          onClick={() => onCreateTask(item)}
        >
          <AddOne theme='outline' size={15} />
        </button>
        {!item.read && (
          <button
            type='button'
            className='tnh-icon-btn'
            aria-label={t('common.notificationHub.actions.markRead')}
            onClick={() => void notificationActions.markRead([item.id])}
          >
            <Check theme='outline' size={15} />
          </button>
        )}
        <Dropdown droplist={moreMenu} trigger='click' position='br'>
          <button
            type='button'
            className='tnh-icon-btn'
            aria-haspopup='menu'
            aria-label={t('common.notificationHub.actions.move')}
          >
            <More theme='outline' size={15} />
          </button>
        </Dropdown>
        <button
          type='button'
          className='tnh-icon-btn'
          aria-label={t('common.notificationHub.actions.remove')}
          onClick={() => void notificationActions.remove([item.id])}
        >
          <Close theme='outline' size={15} />
        </button>
      </div>
    </article>
  );
};

export default NotificationCard;
