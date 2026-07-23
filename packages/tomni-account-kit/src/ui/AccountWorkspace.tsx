import { Avatar, Button, Select, Space, Tag, Typography } from '@arco-design/web-react';
import { Logout, Refresh } from '@icon-park/react';
import React, { useState } from 'react';
import type { AccountClientContract, AccountLocale, AccountNavigationKey, AccountSnapshot } from '../types';
import { useAccountI18n } from '../i18n';
import { NavigationRail } from './NavigationRail';
import {
  DataPrivacyScreen,
  DevicesScreen,
  OrganizationScreen,
  OverviewScreen,
  ProfileScreen,
  SecurityScreen,
  SubscriptionScreen,
} from './screens';
import styles from './AccountPrototype.module.css';

export const AccountWorkspace: React.FC<{
  client: AccountClientContract;
  snapshot: AccountSnapshot;
}> = ({ client, snapshot }) => {
  const { t, locale, setLocale } = useAccountI18n();
  const [active, setActive] = useState<AccountNavigationKey>('overview');

  const page = {
    overview: <OverviewScreen snapshot={snapshot} />,
    profile: <ProfileScreen client={client} snapshot={snapshot} />,
    security: <SecurityScreen client={client} snapshot={snapshot} />,
    devices: <DevicesScreen client={client} snapshot={snapshot} />,
    organization: <OrganizationScreen client={client} snapshot={snapshot} />,
    subscription: <SubscriptionScreen client={client} snapshot={snapshot} />,
    privacy: <DataPrivacyScreen client={client} snapshot={snapshot} />,
  }[active];

  return (
    <div className={styles.workspace}>
      <NavigationRail active={active} onChange={setActive} snapshot={snapshot} />
      <main className={styles.content}>
        <header className={styles.topbar}>
          <Space>
            <Avatar>{snapshot.user?.avatarInitials}</Avatar>
            <div>
              <Typography.Text bold>{snapshot.user?.displayName}</Typography.Text>
              <div>
                <Typography.Text type='secondary'>{snapshot.user?.email}</Typography.Text>
              </div>
            </div>
            <Tag color='arcoblue'>{snapshot.subscription.planId.toUpperCase()}</Tag>
          </Space>
          <Space>
            <Select
              value={locale}
              style={{ width: 140 }}
              options={[
                { label: t('languageVi'), value: 'vi-VN' },
                { label: t('languageEn'), value: 'en-US' },
              ]}
              onChange={(value) => setLocale(value as AccountLocale)}
            />
            <Button icon={<Refresh />} onClick={() => void client.resetPrototype()}>
              {t('resetPrototype')}
            </Button>
            <Button icon={<Logout />} onClick={() => void client.logout()}>
              {t('signOut')}
            </Button>
          </Space>
        </header>
        {page}
      </main>
    </div>
  );
};
