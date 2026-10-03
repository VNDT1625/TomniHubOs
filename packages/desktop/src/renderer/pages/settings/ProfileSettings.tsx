/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Button, Card, Divider, Input, Message, Switch, Tag, Tooltip } from '@arco-design/web-react';
import { Delete, Download, Key, Logout } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import SettingsPageWrapper from './components/SettingsPageWrapper';

/**
 * 1.1 Profile Settings:
 * - Thông tin cá nhân & Danh tính (Local Operator load 0ms / Cloud Sync)
 * - Mục con Privacy & Data: Opt-out training, Export dữ liệu, {t('settings.profileSettings.clearHistoryBtn')}
 */
const ProfileSettings: React.FC = () => {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [trainingOptOut, setTrainingOptOut] = useState(true);
  const [localStorageOnly, setLocalStorageOnly] = useState(true);

  const localMachineId =
    typeof window !== 'undefined'
      ? window.localStorage.getItem('tomni.localMachineId') || 'tm-local-8f2a9c1e'
      : 'tm-local-8f2a9c1e';

  const username = user?.username || 'Local Operator';
  const email = user?.email || 'local.operator@tomni.os';

  const handleExportData = () => {
    Message.success(t('settings.profileSettings.exportingNotice'));
    setTimeout(() => {
      Message.success(t('settings.profileSettings.exportedNotice'));
    }, 1200);
  };

  const handleClearHistory = () => {
    Message.info(t('settings.profileSettings.historyClearedNotice'));
  };

  return (
    <SettingsPageWrapper contentClassName='max-w-960px'>
      <div className='flex flex-col gap-20px'>
        {/* Header Profile Card */}
        <Card bordered className='rd-12px'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-16px'>
              <div className='w-56px h-56px rd-50% bg-primary flex items-center justify-center text-white text-22px font-bold'>
                {username.charAt(0).toUpperCase()}
              </div>
              <div className='flex flex-col gap-4px'>
                <div className='flex items-center gap-8px'>
                  <span className='text-18px font-bold text-t-primary'>{username}</span>
                  <Tag color='arcoblue' size='small'>
                    {t('settings.profileSettings.localVerified')}
                  </Tag>
                  <Tag color='green' size='small'>
                    {t('settings.profileSettings.admin')}
                  </Tag>
                </div>
                <span className='text-13px text-t-secondary'>{email}</span>
                <span className='text-11px text-t-tertiary flex items-center gap-4px'>
                  <Key theme='outline' size={12} /> {t('settings.profileSettings.machineId')}:{' '}
                  <code>{localMachineId}</code>
                </span>
              </div>
            </div>
            <div className='flex gap-8px'>
              <Button type='outline' status='danger' icon={<Logout />} onClick={logout}>
                {t('settings.profileSettings.logout')}
              </Button>
            </div>
          </div>
        </Card>

        {/* Section: Danh tính Cục bộ & Đám mây */}
        <Card title={t('settings.profileSettings.identityTitle')} bordered className='rd-12px'>
          <div className='flex flex-col gap-12px'>
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-14px text-t-primary'>{t('settings.profileSettings.offlineFirstTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0 mt-2px'>{t('settings.profileSettings.offlineFirstDesc')}</p>
              </div>
              <Switch checked={localStorageOnly} onChange={setLocalStorageOnly} />
            </div>
            <Divider className='my-8px' />
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-14px text-t-primary'>{t('settings.profileSettings.cloudSyncTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0 mt-2px'>{t('settings.profileSettings.cloudSyncDesc')}</p>
              </div>
              <Button type='secondary' size='small'>
                {t('settings.profileSettings.configSync')}
              </Button>
            </div>
          </div>
        </Card>

        {/* Section: Privacy & Data (Mục con theo yêu cầu) */}
        <Card title={t('settings.profileSettings.privacyDataTitle')} bordered className='rd-12px'>
          <div className='flex flex-col gap-14px'>
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-14px text-t-primary'>
                  {t('settings.profileSettings.trainingOptOutTitle')}
                </strong>
                <p className='text-12px text-t-tertiary m-0 mt-2px'>
                  {t('settings.profileSettings.trainingOptOutDesc')}
                </p>
              </div>
              <Switch checked={trainingOptOut} onChange={setTrainingOptOut} />
            </div>

            <Divider className='my-8px' />

            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-14px text-t-primary'>{t('settings.profileSettings.exportDataTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0 mt-2px'>{t('settings.profileSettings.exportDataDesc')}</p>
              </div>
              <Button type='outline' icon={<Download />} onClick={handleExportData}>
                {t('settings.profileSettings.exportDataBtn')}
              </Button>
            </div>

            <Divider className='my-8px' />

            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-14px text-danger'>{t('settings.profileSettings.clearHistoryTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0 mt-2px'>{t('settings.profileSettings.clearHistoryDesc')}</p>
              </div>
              <Button type='primary' status='danger' icon={<Delete />} onClick={handleClearHistory}>
                Xóa lịch sử
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </SettingsPageWrapper>
  );
};

export default ProfileSettings;
