/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from '@arco-design/web-react';
import { Book, Calendar, DashboardOne, FolderClose, Schedule, Search, Theme } from '@icon-park/react';
import type { ManagerCoreHealth, ManagerCoreLoadStatus } from './managerCoreClient';
import styles from '../manager.module.css';
import tomnyAgenticIcon from '@/renderer/assets/tomny-agentic-icon.svg';

export type ManagerSection = 'overview' | 'tasks' | 'daily' | 'learn' | 'data' | 'schedule' | 'core';

export type ManagerSidebarProps = {
  active: ManagerSection;
  onChange: (section: ManagerSection) => void;
  onSearch: () => void;
  onAppearance: () => void;
  counts: {
    tasks: number;
    overdue: number;
    notes: number;
    eventsToday: number;
    activeRuns: number;
  };
  coreStatus: ManagerCoreLoadStatus;
  coreHealth?: ManagerCoreHealth;
};

type NavItem = {
  key: ManagerSection;
  label: string;
  icon: React.ReactNode;
  count?: number;
  danger?: boolean;
  status?: React.ReactNode;
};

const ManagerSidebar: React.FC<ManagerSidebarProps> = ({
  active,
  onChange,
  onSearch,
  onAppearance,
  counts,
  coreStatus,
  coreHealth,
}) => {
  const { t } = useTranslation();

  const healthClass =
    coreStatus === 'unavailable'
      ? styles.coreDotUnavailable
      : coreHealth === 'unhealthy'
        ? styles.coreDotUnhealthy
        : coreHealth === 'degraded'
          ? styles.coreDotDegraded
          : coreStatus === 'loading'
            ? styles.coreDotLoading
            : styles.coreDotHealthy;

  const items: NavItem[] = [
    {
      key: 'overview',
      label: t('manager.workspace.nav.overview'),
      icon: <DashboardOne theme='outline' size='16' />,
    },
    {
      key: 'tasks',
      label: t('manager.tabs.tasks'),
      icon: <Calendar theme='outline' size='16' />,
      count: counts.overdue || counts.tasks,
      danger: counts.overdue > 0,
    },
    {
      key: 'schedule',
      label: t('manager.tabs.schedule'),
      icon: <Schedule theme='outline' size='16' />,
      count: counts.eventsToday,
    },
    {
      key: 'daily',
      label: t('manager.notes.cat.daily'),
      icon: <Calendar theme='outline' size='16' />,
    },
    {
      key: 'learn',
      label: t('manager.notes.cat.learn'),
      icon: <Book theme='outline' size='16' />,
    },
    {
      key: 'data',
      label: t('manager.notes.cat.data'),
      icon: <FolderClose theme='outline' size='16' />,
      count: counts.notes,
    },
    {
      key: 'core',
      label: t('manager.workspace.nav.core'),
      icon: <img src={tomnyAgenticIcon} alt='' className={styles.coreNavIcon} />,
      count: counts.activeRuns,
      status: <span className={`${styles.coreDot} ${healthClass}`} />,
    },
  ];

  return (
    <header className={styles.managerSidebar}>
      <div className={styles.sidebarBrand}>
        <div className={styles.sidebarBrandMark}>
          <DashboardOne theme='outline' size='17' />
        </div>
        <div className={styles.sidebarBrandCopy}>
          <div className={styles.sidebarBrandTitle}>{t('manager.title')}</div>
          <div className={styles.sidebarBrandSubtitle}>{t('manager.workspace.controlCenter')}</div>
        </div>
      </div>

      <nav className={styles.sidebarNav} aria-label={t('manager.workspace.navigation')}>
        <span className={styles.sidebarSectionLabel}>{t('manager.tabs.notes')}</span>
        <div className={styles.sidebarNavGroup}>
          {items.map((item) => (
            <Tooltip key={item.key} content={item.label} mini position='bottom'>
              <Button
                type='text'
                className={`${styles.sidebarNavButton} ${active === item.key ? styles.sidebarNavButtonActive : ''}`}
                icon={item.icon}
                aria-label={item.label}
                onClick={() => onChange(item.key)}
              >
                <span className={styles.sidebarNavLabel}>{item.label}</span>
                {item.status}
                {typeof item.count === 'number' && item.count > 0 && (
                  <span className={`${styles.sidebarCount} ${item.danger ? styles.sidebarCountDanger : ''}`}>
                    {item.count}
                  </span>
                )}
              </Button>
            </Tooltip>
          ))}
        </div>
      </nav>

      <div className={styles.sidebarQuickTools}>
        <Tooltip content={t('manager.palette.tooltip')} mini position='bottom'>
          <Button
            type='text'
            icon={<Search theme='outline' size='17' />}
            onClick={onSearch}
            aria-label={t('manager.palette.tooltip')}
          />
        </Tooltip>
        <Tooltip content={t('manager.appearance.title')} mini position='bottom'>
          <Button
            type='text'
            icon={<Theme theme='outline' size='17' />}
            onClick={onAppearance}
            aria-label={t('manager.appearance.title')}
          />
        </Tooltip>
      </div>
    </header>
  );
};

export default ManagerSidebar;
