/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Card, Divider, Switch, TimePicker } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import SettingsPageWrapper from './components/SettingsPageWrapper';

/**
 * 3.2 Notification:
 * - Desktop OS Banner & Push
 * - Âm thanh thông báo
 * - Yêu cầu cấp quyền khẩn cấp (Permission Prompt)
 * - Cảnh báo tài nguyên (RAM vượt quá 85%, hết Token)
 * - Chế độ Không làm phiền (Quiet Hours)
 */
const NotificationSettings: React.FC = () => {
  const { t } = useTranslation();
  const [desktopBanner, setDesktopBanner] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [permissionPopup, setPermissionPopup] = useState(true);
  const [ramAlert, setRamAlert] = useState(true);
  const [quietHours, setQuietHours] = useState(false);

  return (
    <SettingsPageWrapper contentClassName='max-w-960px'>
      <div className='flex flex-col gap-20px'>
        <Card title={t('settings.notificationSettings.channelsTitle')} bordered className='rd-12px'>
          <div className='flex flex-col gap-12px'>
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-13px text-t-primary'>
                  {t('settings.notificationSettings.desktopBannerTitle')}
                </strong>
                <p className='text-12px text-t-tertiary m-0'>{t('settings.notificationSettings.desktopBannerDesc')}</p>
              </div>
              <Switch checked={desktopBanner} onChange={setDesktopBanner} />
            </div>
            <Divider className='my-6px' />
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-13px text-t-primary'>{t('settings.notificationSettings.soundTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0'>{t('settings.notificationSettings.soundDesc')}</p>
              </div>
              <Switch checked={soundEnabled} onChange={setSoundEnabled} />
            </div>
          </div>
        </Card>

        <Card title={t('settings.notificationSettings.alertTitle')} bordered className='rd-12px'>
          <div className='flex flex-col gap-12px'>
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-13px text-t-primary'>
                  {t('settings.notificationSettings.permissionDialogTitle')}
                </strong>
                <p className='text-12px text-t-tertiary m-0'>
                  {t('settings.notificationSettings.permissionDialogDesc')}
                </p>
              </div>
              <Switch checked={permissionPopup} onChange={setPermissionPopup} />
            </div>
            <Divider className='my-6px' />
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-13px text-t-primary'>{t('settings.notificationSettings.ramAlertTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0'>{t('settings.notificationSettings.ramAlertDesc')}</p>
              </div>
              <Switch checked={ramAlert} onChange={setRamAlert} />
            </div>
          </div>
        </Card>

        <Card title={t('settings.notificationSettings.quietHoursTitle')} bordered className='rd-12px'>
          <div className='flex items-center justify-between'>
            <div>
              <strong className='text-13px text-t-primary'>{t('settings.notificationSettings.focusModeTitle')}</strong>
              <p className='text-12px text-t-tertiary m-0 mt-2px'>{t('settings.notificationSettings.focusModeDesc')}</p>
            </div>
            <Switch checked={quietHours} onChange={setQuietHours} />
          </div>
        </Card>
      </div>
    </SettingsPageWrapper>
  );
};

export default NotificationSettings;
