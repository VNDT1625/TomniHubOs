import { Avatar, Button, Space, Tag, Typography } from '@arco-design/web-react';
import { Bill, DashboardOne, Data, Devices, Lock, People, User } from '@icon-park/react';
import React from 'react';
import type { AccountNavigationKey, AccountSnapshot } from '../types';
import { useAccountI18n } from '../i18n';
import styles from './AccountPrototype.module.css';

const items: Array<{
  key: AccountNavigationKey;
  label:
    | 'navigationOverview'
    | 'navigationProfile'
    | 'navigationSecurity'
    | 'navigationDevices'
    | 'navigationOrganization'
    | 'navigationSubscription'
    | 'navigationPrivacy';
  icon: React.ReactNode;
}> = [
  { key: 'overview', label: 'navigationOverview', icon: <DashboardOne /> },
  { key: 'profile', label: 'navigationProfile', icon: <User /> },
  { key: 'security', label: 'navigationSecurity', icon: <Lock /> },
  { key: 'devices', label: 'navigationDevices', icon: <Devices /> },
  { key: 'organization', label: 'navigationOrganization', icon: <People /> },
  { key: 'subscription', label: 'navigationSubscription', icon: <Bill /> },
  { key: 'privacy', label: 'navigationPrivacy', icon: <Data /> },
];

export const NavigationRail: React.FC<{
  active: AccountNavigationKey;
  onChange(key: AccountNavigationKey): void;
  snapshot: AccountSnapshot;
}> = ({ active, onChange, snapshot }) => {
  const { t } = useAccountI18n();
  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <Space>
          <Avatar>{snapshot.user?.avatarInitials ?? 'T'}</Avatar>
          <div className={styles.sidebarMeta}>
            <Typography.Text bold>{t('brand')}</Typography.Text>
            <div>
              <Tag size='small'>{t('prototypeBadge')}</Tag>
            </div>
          </div>
        </Space>
      </div>
      <nav>
        {items.map((item) => (
          <Button
            key={item.key}
            type={active === item.key ? 'primary' : 'text'}
            icon={item.icon}
            className={styles.navButton}
            onClick={() => onChange(item.key)}
          >
            <span className={styles.sidebarLabel}>{t(item.label)}</span>
          </Button>
        ))}
      </nav>
      <div className={styles.sidebarFooter}>
        <Typography.Text type='secondary' className={styles.sidebarMeta}>
          {snapshot.user?.email}
        </Typography.Text>
      </div>
    </aside>
  );
};
