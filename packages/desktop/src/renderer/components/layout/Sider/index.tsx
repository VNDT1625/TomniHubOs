import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { HUB_APPS, type HubAppDefinition } from '@/renderer/pages/guid/HubHome/catalog';
import { blurActiveElement } from '@/renderer/utils/ui/focus';
import { cleanupSiderTooltips } from '@/renderer/utils/ui/siderTooltip';
import { Button, Tooltip } from '@arco-design/web-react';
import {
  AllApplication,
  BuildingTwo,
  DashboardOne,
  FolderOpen,
  History,
  Home,
  Right,
  SettingTwo,
} from '@icon-park/react';
import React, { Suspense, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import type { NavigateOptions } from 'react-router-dom';
import styles from './Sider.module.css';

const SettingsSider = React.lazy(() => import('@renderer/pages/settings/components/SettingsSider'));

type SiderProps = {
  onSessionClick?: () => void;
  onNavigate?: (path: string, options?: NavigateOptions) => void;
  showAccount?: boolean;
  collapsed?: boolean;
};

const PRIMARY_NAV = [
  { id: 'home', key: 'guid.hubHome.shell.nav.home', path: '/guid', Icon: Home },
  { id: 'management', key: 'guid.hubHome.shell.nav.manage', path: '/manager', Icon: DashboardOne },
  { id: 'store', key: 'guid.hubHome.shell.store', path: '/store', Icon: AllApplication },
  { id: 'history', key: 'guid.hubHome.shell.nav.history', path: '/history', Icon: History },
  { id: 'company', key: 'guid.hubHome.shell.nav.company', path: '/company', Icon: BuildingTwo },
] as const;

const PINNED_APPS = HUB_APPS.filter((app) => ['chat', 'terminal', 'git'].includes(app.id));

const isNavActive = (pathname: string, path: string): boolean =>
  path === '/guid'
    ? pathname === '/guid' || pathname.startsWith('/conversation/')
    : pathname === path || pathname.startsWith(`${path}/`);

const Sider: React.FC<SiderProps> = ({ onSessionClick, onNavigate, showAccount = true, collapsed = false }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const layout = useLayoutContext();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isSettings = pathname.startsWith('/settings');
  const accountName = user?.username || 'Tomny';
  const accountInitial = accountName.trim().charAt(0).toUpperCase() || 'T';

  const navigateTo = useCallback(
    (path: string, options?: NavigateOptions): void => {
      cleanupSiderTooltips();
      blurActiveElement();
      if (onNavigate) {
        onNavigate(path, options);
      } else if (layout?.navigateWithFeedback) {
        layout.navigateWithFeedback(path, options);
      } else {
        void navigate(path, options);
      }
      onSessionClick?.();
    },
    [layout, navigate, onNavigate, onSessionClick]
  );

  if (isSettings) {
    return (
      <Suspense fallback={<div className='size-full' />}>
        <SettingsSider collapsed={collapsed} tooltipEnabled={collapsed && !layout?.isMobile} />
      </Suspense>
    );
  }

  const renderNavButton = (
    key: string,
    label: string,
    path: string,
    Icon: HubAppDefinition['Icon'] | (typeof PRIMARY_NAV)[number]['Icon'],
    active: boolean
  ) => {
    const button = (
      <Button
        key={key}
        type='text'
        long
        className={`${styles.navButton} ${active ? styles.navButtonActive : ''}`}
        icon={<Icon theme='outline' size={16} fill='currentColor' />}
        aria-label={label}
        onClick={() => navigateTo(path)}
      >
        <span className={styles.sidebarCopy}>{label}</span>
      </Button>
    );
    return collapsed && !layout?.isMobile ? (
      <Tooltip key={key} content={label} position='right'>
        {button}
      </Tooltip>
    ) : (
      button
    );
  };

  return (
    <div className={`${styles.siderContent} ${collapsed ? styles.collapsed : ''}`} data-testid='global-hub-sidebar'>
      <nav className={styles.navigation} aria-label={t('guid.hubHome.shell.primaryNavigation')}>
        {PRIMARY_NAV.map((item) =>
          renderNavButton(item.id, t(item.key), item.path, item.Icon, isNavActive(pathname, item.path))
        )}
      </nav>

      <div className={styles.divider} />
      <section className={styles.section}>
        <div className={styles.sectionLabel}>
          <span className={styles.sidebarCopy}>{t('guid.hubHome.shell.pinnedApps')}</span>
          <AllApplication theme='outline' size={13} fill='currentColor' />
        </div>
        {PINNED_APPS.map((app) =>
          renderNavButton(app.id, t(app.labelKey), app.path, app.Icon, isNavActive(pathname, app.path))
        )}
      </section>

      <div className={styles.divider} />
      <section className={styles.section}>
        <div className={styles.sectionLabel}>
          <span className={styles.sidebarCopy}>{t('guid.hubHome.shell.workspaces')}</span>
          <FolderOpen theme='outline' size={13} fill='currentColor' />
        </div>
        {renderNavButton('workspace', 'Tomny', '/guid', Home, false)}
      </section>

      <div className={styles.spacer} />
      {renderNavButton(
        'store-footer',
        t('guid.hubHome.shell.store'),
        '/store',
        AllApplication,
        pathname.startsWith('/store')
      )}
      {renderNavButton(
        'settings-footer',
        t('guid.hubHome.shell.nav.settings'),
        '/settings/model',
        SettingTwo,
        pathname.startsWith('/settings')
      )}
      {showAccount && (
        <Button
          type='text'
          long
          className={styles.accountButton}
          aria-label={accountName}
          onClick={() => navigateTo('/settings/personal')}
        >
          <span className={styles.accountAvatar}>{accountInitial}</span>
          <span className={`${styles.accountCopy} ${styles.sidebarCopy}`}>
            <strong>{accountName}</strong>
            <small>{t('settings.personalProfile.title')}</small>
          </span>
          <Right className={styles.sidebarCopy} theme='outline' size={13} fill='currentColor' />
        </Button>
      )}
    </div>
  );
};

export default Sider;
