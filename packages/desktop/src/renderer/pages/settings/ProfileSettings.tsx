/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Card, Divider, Switch } from '@arco-design/web-react';
import { Delete, Download, Logout } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import NotActiveNotice from './components/NotActiveNotice';
import SettingsPageWrapper from './components/SettingsPageWrapper';

/**
 * Profile: the signed-in account and sign-out are real. Sync, the training opt-out, export and clearing
 * history have nothing behind them yet, so they are shown switched off instead of pretending to work.
 */
const ProfileSettings: React.FC = () => {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const username = user?.username || t('settings.profileSettings.noAccount');

  return (
    <SettingsPageWrapper contentClassName='max-w-960px'>
      <div className='flex flex-col gap-20px'>
        <Card bordered className='rd-12px'>
          <div className='flex flex-wrap items-center justify-between gap-12px'>
            <div className='flex items-center gap-16px min-w-0'>
              <div className='w-56px h-56px rd-50% bg-primary flex items-center justify-center text-white text-22px font-bold'>
                {username.charAt(0).toUpperCase()}
              </div>
              <div className='flex flex-col gap-4px min-w-0'>
                <span className='text-18px font-bold text-t-primary' data-testid='profile-username'>
                  {username}
                </span>
                {user?.email && <span className='text-13px text-t-secondary'>{user.email}</span>}
              </div>
            </div>
            {user && (
              <Button type='outline' status='danger' icon={<Logout />} onClick={logout}>
                {t('settings.profileSettings.logout')}
              </Button>
            )}
          </div>
        </Card>

        <NotActiveNotice detail={t('settings.notActive.profile')} />

        <Card title={t('settings.profileSettings.identityTitle')} bordered className='rd-12px'>
          <div className='flex flex-col gap-12px'>
            <div className='flex items-center justify-between gap-12px'>
              <div>
                <strong className='text-14px text-t-primary'>{t('settings.profileSettings.offlineFirstTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0 mt-2px'>{t('settings.profileSettings.offlineFirstDesc')}</p>
              </div>
              <Switch checked={false} disabled />
            </div>
            <Divider className='my-8px' />
            <div className='flex items-center justify-between gap-12px'>
              <div>
                <strong className='text-14px text-t-primary'>{t('settings.profileSettings.cloudSyncTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0 mt-2px'>{t('settings.profileSettings.cloudSyncDesc')}</p>
              </div>
              <Button type='secondary' size='small' disabled>
                {t('settings.profileSettings.configSync')}
              </Button>
            </div>
          </div>
        </Card>

        <Card title={t('settings.profileSettings.privacyDataTitle')} bordered className='rd-12px'>
          <div className='flex flex-col gap-14px'>
            <div className='flex items-center justify-between gap-12px'>
              <div>
                <strong className='text-14px text-t-primary'>
                  {t('settings.profileSettings.trainingOptOutTitle')}
                </strong>
                <p className='text-12px text-t-tertiary m-0 mt-2px'>
                  {t('settings.profileSettings.trainingOptOutDesc')}
                </p>
              </div>
              <Switch checked={false} disabled />
            </div>
            <Divider className='my-8px' />
            <div className='flex items-center justify-between gap-12px'>
              <div>
                <strong className='text-14px text-t-primary'>{t('settings.profileSettings.exportDataTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0 mt-2px'>{t('settings.profileSettings.exportDataDesc')}</p>
              </div>
              <Button type='outline' icon={<Download />} disabled>
                {t('settings.profileSettings.exportDataBtn')}
              </Button>
            </div>
            <Divider className='my-8px' />
            <div className='flex items-center justify-between gap-12px'>
              <div>
                <strong className='text-14px text-t-primary'>{t('settings.profileSettings.clearHistoryTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0 mt-2px'>{t('settings.profileSettings.clearHistoryDesc')}</p>
              </div>
              <Button type='outline' status='danger' icon={<Delete />} disabled>
                {t('settings.profileSettings.clearHistoryBtn')}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </SettingsPageWrapper>
  );
};

export default ProfileSettings;
