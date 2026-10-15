/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import React, { useEffect, useState } from 'react';
import { Button, Card, Divider, Switch, TimePicker } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { notificationHubChannels, type NotificationRules } from '@/common/types/platform/notificationHub';
import NotificationSourcesPanel from '@/renderer/components/layout/Titlebar/NotificationHub/NotificationSourcesPanel';
import NotificationTriagePanel from '@/renderer/components/layout/Titlebar/NotificationHub/NotificationTriagePanel';
import { useNotificationHub } from '@/renderer/services/notificationService';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const Row: React.FC<{ title: string; description: string; children: React.ReactNode }> = ({
  title,
  description,
  children,
}) => (
  <div className='flex items-center justify-between gap-12px'>
    <div>
      <strong className='text-13px text-t-primary'>{title}</strong>
      <p className='text-12px text-t-tertiary m-0'>{description}</p>
    </div>
    {children}
  </div>
);

/**
 * 3.2 Notification: the OS banner switch, the notification hub's alert rules
 * (sound, window attention, RAM alert, quiet hours), Laya triage and budget, and
 * the sources and accounts (also reachable from the notification drawer).
 */
const NotificationSettings: React.FC = () => {
  const { t } = useTranslation();
  const [desktopBanner, setDesktopBanner] = useState(true);
  const hub = useNotificationHub();
  const { rules } = hub.settings;

  useEffect(() => {
    let cancelled = false;
    void ipcBridge.systemSettings.getNotificationEnabled
      .invoke()
      .then((enabled) => {
        if (!cancelled) setDesktopBanner(enabled);
      })
      .catch((): undefined => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const saveRules = (patch: Partial<NotificationRules>): void => {
    void notificationHubChannels.saveRules.invoke({ ...rules, ...patch }).catch((): undefined => undefined);
  };
  const setQuiet = (patch: Partial<NotificationRules['quietHours']>): void =>
    saveRules({ quietHours: { ...rules.quietHours, ...patch } });

  return (
    <SettingsPageWrapper contentClassName='max-w-960px'>
      <div className='flex flex-col gap-20px'>
        <Card title={t('settings.notificationSettings.channelsTitle')} bordered className='rd-12px'>
          <div className='flex flex-col gap-12px'>
            <Row
              title={t('settings.notificationSettings.desktopBannerTitle')}
              description={t('settings.notificationSettings.desktopBannerDesc')}
            >
              <Switch
                checked={desktopBanner}
                onChange={(enabled) => {
                  setDesktopBanner(enabled);
                  void ipcBridge.systemSettings.setNotificationEnabled.invoke({ enabled });
                }}
              />
            </Row>
            <Divider className='my-6px' />
            <Row
              title={t('settings.notificationSettings.soundTitle')}
              description={t('settings.notificationSettings.soundDesc')}
            >
              <Switch
                data-testid='notification-sound'
                disabled={!desktopBanner}
                checked={rules.sound}
                onChange={(sound) => saveRules({ sound })}
              />
            </Row>
            <Divider className='my-6px' />
            <div className='flex items-center justify-between gap-12px'>
              <p className='text-12px text-t-tertiary m-0'>{t('settings.notificationSettings.sourcesHint')}</p>
              <Button size='small' onClick={() => window.dispatchEvent(new CustomEvent('tomni-open-notifications'))}>
                {t('settings.notificationSettings.openCenter')}
              </Button>
            </div>
          </div>
        </Card>

        <Card title={t('settings.notificationSettings.alertTitle')} bordered className='rd-12px'>
          <div className='flex flex-col gap-12px'>
            <Row
              title={t('settings.notificationSettings.permissionDialogTitle')}
              description={t('settings.notificationSettings.permissionDialogDesc')}
            >
              <Switch
                data-testid='notification-attention'
                checked={rules.bringToFrontOnInput}
                onChange={(bringToFrontOnInput) => saveRules({ bringToFrontOnInput })}
              />
            </Row>
            <Divider className='my-6px' />
            <Row
              title={t('settings.notificationSettings.ramAlertTitle')}
              description={t('settings.notificationSettings.ramAlertDesc')}
            >
              <Switch
                data-testid='notification-ram'
                checked={rules.ramAlert}
                onChange={(ramAlert) => saveRules({ ramAlert })}
              />
            </Row>
          </div>
        </Card>

        <Card title={t('settings.notificationSettings.quietHoursTitle')} bordered className='rd-12px'>
          <div className='flex flex-col gap-12px'>
            <Row
              title={t('settings.notificationSettings.focusModeTitle')}
              description={t('settings.notificationSettings.focusModeDesc')}
            >
              <Switch
                data-testid='notification-quiet'
                checked={rules.quietHours.enabled}
                onChange={(enabled) => setQuiet({ enabled })}
              />
            </Row>
            <div className='flex items-center gap-8px flex-wrap'>
              <span className='text-12px text-t-secondary'>{t('settings.notificationSettings.quietFrom')}</span>
              <TimePicker
                format='HH:mm'
                allowClear={false}
                disabled={!rules.quietHours.enabled}
                value={rules.quietHours.start}
                onChange={(start) => start && setQuiet({ start })}
              />
              <span className='text-12px text-t-secondary'>{t('settings.notificationSettings.quietTo')}</span>
              <TimePicker
                format='HH:mm'
                allowClear={false}
                disabled={!rules.quietHours.enabled}
                value={rules.quietHours.end}
                onChange={(end) => end && setQuiet({ end })}
              />
            </div>
          </div>
        </Card>

        <Card title={t('common.notificationHub.triage.cardTitle')} bordered className='rd-12px tnh-scope'>
          <NotificationTriagePanel snapshot={hub} />
        </Card>

        <Card title={t('common.notificationHub.sources.cardTitle')} bordered className='rd-12px tnh-scope'>
          <NotificationSourcesPanel snapshot={hub} showCatalog />
        </Card>
      </div>
    </SettingsPageWrapper>
  );
};

export default NotificationSettings;
