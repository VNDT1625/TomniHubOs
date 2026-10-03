import tomniIcon from '@/renderer/assets/tomni-icon.svg';
import Sider from '@/renderer/components/layout/Sider';
import WindowControls from '@/renderer/components/layout/WindowControls';
import FeedbackButton from '@/renderer/components/base/FeedbackButton';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { useThemeContext } from '@/renderer/hooks/context/ThemeContext';
import ConversationSearchPopover from '@/renderer/pages/conversation/GroupedHistory/ConversationSearchPopover';
import { changeLanguage } from '@/renderer/services/i18n';
import { useSystemMetrics } from '@/renderer/pages/settings/ResourceSettings/system/useSystemMetrics';
import { isElectronDesktop, isMacOS } from '@/renderer/utils/platform';
import type { PackageListing } from '@/common/packages';
import { packageClient } from '@/renderer/pages/hub/packageClient';
import { Badge, Button, Card, Modal, Popover, Tooltip } from '@arco-design/web-react';
import {
  AllApplication,
  BuildingTwo,
  ChartHistogram,
  Code,
  Communication,
  DashboardOne,
  Down,
  Edit,
  Gift,
  GraphicDesign,
  Left,
  List,
  Moon,
  Pic,
  Plus,
  Remind,
  Right,
  Robot,
  Search,
  Shield,
  SunOne,
  Time,
  User,
} from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HUB_APPS,
  HUB_CATEGORIES,
  HUB_QUICK_PROMPTS,
  addRecentHubApp,
  parseRecentHubApps,
  type HubAppDefinition,
  type HubAppId,
  type HubCategoryId,
  type HubTone,
} from './catalog';
import styles from './HubHome.module.css';
import { PromptLibraryModal } from './PromptLibraryModal';
import { useNotifications } from '@/renderer/services/notificationService';
import { useManagerStore } from '@/renderer/pages/manager/useManagerStore';

const RECENT_APPS_STORAGE_KEY = 'tomni.hub.recentApps';
const COMPACT_SIDEBAR_MEDIA_QUERY = '(max-width: 839px)';

const LANGUAGE_OPTIONS = [
  { code: 'vi-VN', shortLabel: 'VI', label: 'Tiếng Việt' },
  { code: 'en-US', shortLabel: 'EN', label: 'English' },
  { code: 'zh-CN', shortLabel: '中', label: '简体中文' },
  { code: 'zh-TW', shortLabel: '繁', label: '繁體中文' },
  { code: 'ja-JP', shortLabel: '日', label: '日本語' },
  { code: 'ko-KR', shortLabel: 'KO', label: '한국어' },
  { code: 'tr-TR', shortLabel: 'TR', label: 'Türkçe' },
  { code: 'ru-RU', shortLabel: 'RU', label: 'Русский' },
  { code: 'uk-UA', shortLabel: 'UA', label: 'Українська' },
] as const;

const clampPercent = (value?: number): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
};

const calculateStoragePercent = (disks: readonly { totalMB: number; freeMB: number }[] | undefined): number | null => {
  if (!disks) return null;
  const totals = disks.reduce(
    (sum, disk) => {
      if (!Number.isFinite(disk.totalMB) || disk.totalMB <= 0) return sum;
      const freeMB = Number.isFinite(disk.freeMB) ? Math.min(disk.totalMB, Math.max(0, disk.freeMB)) : disk.totalMB;
      return { totalMB: sum.totalMB + disk.totalMB, usedMB: sum.usedMB + disk.totalMB - freeMB };
    },
    { totalMB: 0, usedMB: 0 }
  );
  return totals.totalMB > 0 ? clampPercent((totals.usedMB / totals.totalMB) * 100) : null;
};

const TONE_CLASS: Record<HubTone, string> = {
  primary: styles.tonePrimary,
  danger: styles.toneDanger,
  info: styles.toneInfo,
  success: styles.toneSuccess,
  warning: styles.toneWarning,
};

const CATEGORY_ICON: Record<HubCategoryId, typeof Communication> = {
  communication: Communication,
  creative: GraphicDesign,
  developer: Code,
  productivity: DashboardOne,
};

type HubHomeProps = {
  composer: React.ReactNode;
  onNavigate: (path: string, state?: Record<string, unknown>) => void;
  onFocusComposer: () => void;
  onPromptSelect: (prompt: string) => void;
  agentCount?: number;
  capabilityCount: number;
  selectedAgentName: string;
  selectedModelName?: string;
  workspaceName?: string;
};

type LauncherScope = HubCategoryId | 'all' | null;

const readRecentApps = (): HubAppId[] => {
  if (typeof window === 'undefined') return [];
  return parseRecentHubApps(window.localStorage.getItem(RECENT_APPS_STORAGE_KEY));
};

const AppIcon: React.FC<{ app: HubAppDefinition; size?: number }> = ({ app, size = 18 }) => {
  const Icon = app.Icon;
  return (
    <span className={`${styles.appIcon} ${TONE_CLASS[app.tone]}`} aria-hidden='true'>
      <Icon theme='outline' size={size} fill='currentColor' />
    </span>
  );
};

const HubHome: React.FC<HubHomeProps> = ({
  composer,
  onNavigate,
  onFocusComposer,
  onPromptSelect,
  selectedAgentName,
  selectedModelName,
}) => {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useThemeContext();
  const { user } = useAuth();
  const [launcherScope, setLauncherScope] = useState<LauncherScope>(null);
  const [promptLibraryVisible, setPromptLibraryVisible] = useState(false);
  const [recentAppIds, setRecentAppIds] = useState<HubAppId[]>(readRecentApps);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(COMPACT_SIDEBAR_MEDIA_QUERY).matches
  );
  const [installedPackages, setInstalledPackages] = useState<PackageListing[]>([]);
  const openSearchRef = useRef<(() => void) | null>(null);
  const desktopRuntime = isElectronDesktop();
  const coreStatusKey = 'guid.hubHome.shell.coreHealthy';
  const systemMetrics = useSystemMetrics();
  const cpuPercent = clampPercent(systemMetrics.live?.cpu.overallPercent);
  const ramPercent = clampPercent(systemMetrics.live?.memory.usedPercent);
  const storagePercent = calculateStoragePercent(systemMetrics.staticInfo?.disks);
  const hasSystemMetrics = systemMetrics.status === 'ready';
  const currentLanguage =
    LANGUAGE_OPTIONS.find((option) => option.code === (i18n.resolvedLanguage || i18n.language)) ??
    LANGUAGE_OPTIONS.find((option) => (i18n.resolvedLanguage || i18n.language).startsWith(option.code.split('-')[0])) ??
    LANGUAGE_OPTIONS[1];
  const accountName = user?.username || 'Tomny';
  const accountInitials =
    accountName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'T';

  // Notifications and task statistics
  const { notifications } = useNotifications();
  const managerStore = useManagerStore();

  const tasks = useMemo(() => managerStore.data?.tasks || [], [managerStore.data?.tasks]);
  const inProgressTasks = useMemo(() => tasks.filter((t) => t.status === 'in_progress'), [tasks]);
  const pendingTasks = useMemo(() => tasks.filter((t) => t.status === 'todo'), [tasks]);
  const blockedTasks = useMemo(() => tasks.filter((t) => t.priority === 'urgent' && t.status !== 'done'), [tasks]);

  const totalTasks = tasks.length || 1;
  const inProgressCount = inProgressTasks.length;
  const pendingCount = pendingTasks.length;
  const blockedCount = blockedTasks.length;

  const inProgressPercent = tasks.length > 0 ? Math.min(100, Math.round((inProgressCount / totalTasks) * 100)) : 0;
  const pendingPercent = tasks.length > 0 ? Math.min(100, Math.round((pendingCount / totalTasks) * 100)) : 0;
  const blockedPercent = tasks.length > 0 ? Math.min(100, Math.round((blockedCount / totalTasks) * 100)) : 0;

  const featuredCategories = useMemo(() => HUB_CATEGORIES.filter((category) => category.featured), []);
  const availableHubApps = useMemo(() => {
    const installedIds = new Set(installedPackages.map((item) => item.manifest.id));
    return HUB_APPS.filter((app) => !app.packageId || installedIds.has(app.packageId));
  }, [installedPackages]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const compactViewport = window.matchMedia(COMPACT_SIDEBAR_MEDIA_QUERY);
    const handleViewportChange = (event: MediaQueryListEvent) => setSidebarCollapsed(event.matches);
    setSidebarCollapsed(compactViewport.matches);
    compactViewport.addEventListener('change', handleViewportChange);
    return () => compactViewport.removeEventListener('change', handleViewportChange);
  }, []);

  useEffect(() => {
    void packageClient
      .list({ installedOnly: true })
      .then((items) =>
        setInstalledPackages(
          items.filter((item) => item.delivery === 'downloaded-package' && item.manifest.modules.length > 0)
        )
      )
      .catch(() => setInstalledPackages([]));
  }, []);

  const recentApps = useMemo(
    () =>
      recentAppIds
        .map((id) => availableHubApps.find((app) => app.id === id))
        .filter((app): app is HubAppDefinition => Boolean(app)),
    [availableHubApps, recentAppIds]
  );
  const launcherApps = useMemo(() => {
    if (!launcherScope || launcherScope === 'all') return availableHubApps;
    return availableHubApps.filter((app) => app.category === launcherScope);
  }, [availableHubApps, launcherScope]);
  const launcherTitle =
    launcherScope === 'all'
      ? t('guid.hubHome.allApps')
      : t(HUB_CATEGORIES.find((category) => category.id === launcherScope)?.titleKey ?? 'guid.hubHome.appsTitle');

  const rememberApp = useCallback((appId: HubAppId) => {
    setRecentAppIds((current) => {
      const next = addRecentHubApp(current, appId);
      try {
        window.localStorage.setItem(RECENT_APPS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage availability must never block app navigation.
      }
      return next;
    });
  }, []);

  const openApp = useCallback(
    (app: HubAppDefinition) => {
      rememberApp(app.id);
      setLauncherScope(null);
      if (app.id === 'chat') {
        onFocusComposer();
        return;
      }
      onNavigate(app.path, app.state);
    },
    [onFocusComposer, onNavigate, rememberApp]
  );

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      openSearchRef.current?.();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const accountPopover = (
    <div className={`${styles.hubPopover} ${styles.quickPreferences}`}>
      <div className={styles.sidebarAccount}>
        <span className={styles.sidebarAccountAvatar}>{accountInitials}</span>
        <span className={styles.sidebarAccountCopy}>
          <strong>{accountName}</strong>
          <small>{t('settings.personalProfile.title')}</small>
        </span>
      </div>
      <div className={styles.quickPreferencesHeader}>
        <span>{t('settings.theme')}</span>
      </div>
      <div className={styles.quickPreferenceGrid}>
        <Button
          type={theme === 'light' ? 'secondary' : 'text'}
          className={styles.quickPreferenceButton}
          icon={<SunOne theme={theme === 'light' ? 'filled' : 'outline'} size={14} fill='currentColor' />}
          onClick={() => void setTheme('light')}
        >
          {t('settings.lightMode')}
        </Button>
        <Button
          type={theme === 'dark' ? 'secondary' : 'text'}
          className={styles.quickPreferenceButton}
          icon={<Moon theme={theme === 'dark' ? 'filled' : 'outline'} size={14} fill='currentColor' />}
          onClick={() => void setTheme('dark')}
        >
          {t('settings.darkMode')}
        </Button>
      </div>
      <div className={styles.quickPreferencesHeader}>
        <span>{t('settings.language')}</span>
      </div>
      <div className={styles.quickLanguageGrid}>
        {LANGUAGE_OPTIONS.map((option) => (
          <Tooltip key={option.code} content={option.label}>
            <Button
              type={currentLanguage.code === option.code ? 'secondary' : 'text'}
              className={styles.quickPreferenceButton}
              aria-label={option.label}
              onClick={() => void changeLanguage(option.code)}
            >
              {option.shortLabel}
            </Button>
          </Tooltip>
        ))}
      </div>
      <Button
        type='text'
        long
        className={styles.quickPreferenceButton}
        icon={<User theme='outline' size={14} fill='currentColor' />}
        onClick={() => onNavigate('/settings/personal')}
      >
        {t('common.goToSettings')}
      </Button>
    </div>
  );

  return (
    <div
      className={`${styles.hubShell} ${sidebarCollapsed ? styles.hubShellCollapsed : ''}`}
      data-sidebar-collapsed={sidebarCollapsed}
      data-testid='hub-home-shell'
    >
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <img src={tomniIcon} alt='' />
          <span className={styles.brandName}>Tomny</span>
          <Tooltip content={t(sidebarCollapsed ? 'common.expand' : 'common.collapse')} position='right'>
            <Button
              type='text'
              shape='circle'
              className={styles.sidebarToggle}
              icon={
                sidebarCollapsed ? (
                  <Right theme='outline' size={14} fill='currentColor' />
                ) : (
                  <Left theme='outline' size={14} fill='currentColor' />
                )
              }
              aria-label={t(sidebarCollapsed ? 'common.expand' : 'common.collapse')}
              aria-expanded={!sidebarCollapsed}
              data-testid='hub-sidebar-toggle'
              onClick={() => setSidebarCollapsed((current) => !current)}
            />
          </Tooltip>
        </div>

        <Sider collapsed={sidebarCollapsed} showAccount={false} onNavigate={(path) => onNavigate(path)} />
      </aside>

      <header className={styles.topbar}>
        <ConversationSearchPopover
          onConversationSelect={() => undefined}
          renderTrigger={({ onClick, isActive }) => {
            openSearchRef.current = onClick;
            return (
              <Button
                type='secondary'
                className={`${styles.searchTrigger} ${isActive ? styles.searchTriggerActive : ''}`}
                icon={<Search theme='outline' size={15} fill='currentColor' />}
                onClick={onClick}
              >
                <span>{t('guid.hubHome.shell.searchPlaceholder')}</span>
                <kbd>Ctrl + K</kbd>
              </Button>
            );
          }}
        />

        <div className={styles.topbarActions}>
          <Tooltip content={t('guid.hubHome.shell.store')}>
            <Button
              type='text'
              shape='circle'
              className={styles.topbarButton}
              icon={<Gift theme='outline' size={16} fill='currentColor' />}
              aria-label={t('guid.hubHome.shell.store')}
              onClick={() => onNavigate('/store')}
            />
          </Tooltip>
          <Tooltip content={t('guid.hubHome.status.notificationsTitle')}>
            <Badge count={0} dot>
              <Button
                type='text'
                shape='circle'
                className={styles.topbarButton}
                icon={<Remind theme='outline' size={16} fill='currentColor' />}
                aria-label={t('guid.hubHome.status.notificationsTitle')}
                onClick={() => window.dispatchEvent(new CustomEvent('tomni-open-notifications'))}
              />
            </Badge>
          </Tooltip>
          <Popover trigger='click' position='br' className={styles.hubPopoverPopup} content={accountPopover}>
            <Button type='text' className={styles.accountButton} aria-label={accountName}>
              <span className={styles.avatar}>{accountInitials}</span>
              <Down theme='outline' size={12} fill='currentColor' />
            </Button>
          </Popover>
          {desktopRuntime && !isMacOS() ? <WindowControls /> : null}
        </div>
      </header>

      <div className={styles.body}>
        <main className={styles.main}>
          <section className={styles.intro}>
            <h1>{t('guid.hubHome.title')}</h1>
            <p>{t('guid.hubHome.subtitle')}</p>
          </section>

          <div className={styles.composer}>{composer}</div>

          <div className={styles.quickPromptRow} aria-label={t('guid.hubHome.quickPromptsLabel')}>
            {HUB_QUICK_PROMPTS.map((key) => {
              const iconMap: Record<string, React.ReactNode> = {
                'guid.hubHome.quickPrompts.plan': <List theme='outline' size={13} fill='currentColor' />,
                'guid.hubHome.quickPrompts.analyze': <ChartHistogram theme='outline' size={13} fill='currentColor' />,
                'guid.hubHome.quickPrompts.write': <Edit theme='outline' size={13} fill='currentColor' />,
                'guid.hubHome.quickPrompts.build': <Pic theme='outline' size={13} fill='currentColor' />,
              };
              return (
                <Button
                  key={key}
                  type='secondary'
                  size='small'
                  icon={iconMap[key]}
                  onClick={() => onPromptSelect(t(key))}
                >
                  {t(key)}
                </Button>
              );
            })}
            <Button
              type='secondary'
              size='small'
              icon={<AllApplication theme='outline' size={13} fill='currentColor' />}
              onClick={() => setPromptLibraryVisible(true)}
            >
              {t('guid.hubHome.shell.more')}
            </Button>
          </div>

          <section className={styles.appsSection} aria-labelledby='hub-home-apps-title'>
            <div className={styles.sectionHeading}>
              <h2 id='hub-home-apps-title'>{t('guid.hubHome.appsTitle')}</h2>
              <Button type='text' size='small' onClick={() => setLauncherScope('all')}>
                <span className={styles.inlineAction}>
                  {t('guid.hubHome.viewAll')}
                  <Right theme='outline' size={13} fill='currentColor' />
                </span>
              </Button>
            </div>

            <div className={styles.categoryGrid}>
              {featuredCategories.map((category) => {
                const categoryApps = availableHubApps.filter((app) => app.category === category.id);
                const CategoryIcon = CATEGORY_ICON[category.id];
                return (
                  <Card key={category.id} className={styles.categoryCard} bordered>
                    <Button
                      type='text'
                      long
                      className={styles.categoryHeader}
                      data-testid={`hub-category-${category.id}`}
                      onClick={() => setLauncherScope(category.id)}
                    >
                      <span className={`${styles.categoryMark} ${TONE_CLASS[category.tone]}`} aria-hidden='true'>
                        <CategoryIcon theme='outline' size={17} fill='currentColor' />
                      </span>
                      <span>
                        <strong>{t(category.titleKey)}</strong>
                        <small>{t(category.descriptionKey)}</small>
                      </span>
                    </Button>

                    <div className={styles.categoryApps}>
                      {categoryApps.map((app) => (
                        <Button
                          key={app.id}
                          type='text'
                          long
                          className={styles.appRowButton}
                          data-testid={`hub-app-${app.id}`}
                          onClick={() => openApp(app)}
                        >
                          <span className={styles.appRow}>
                            <AppIcon app={app} />
                            <span className={styles.appCopy}>
                              <strong>{t(app.labelKey)}</strong>
                              <small>{t(app.descriptionKey)}</small>
                            </span>
                          </span>
                        </Button>
                      ))}
                    </div>

                    <Button
                      type='text'
                      size='small'
                      shape='circle'
                      className={styles.categoryViewAll}
                      icon={<Plus theme='outline' size={13} fill='currentColor' />}
                      aria-label={t('guid.hubHome.viewAll')}
                      onClick={() => setLauncherScope(category.id)}
                    />
                  </Card>
                );
              })}
            </div>
          </section>

          {installedPackages.length > 0 && (
            <section className={styles.recentSection} aria-label={t('guid.hubHome.shell.store')}>
              <div className={styles.sectionHeading}>
                <h2>{t('guid.hubHome.shell.store')}</h2>
                <Button type='text' size='small' onClick={() => onNavigate('/store')}>
                  <span className={styles.inlineAction}>
                    {t('guid.hubHome.viewAll')}
                    <Right theme='outline' size={13} fill='currentColor' />
                  </span>
                </Button>
              </div>
              <div className={styles.recentGrid}>
                {installedPackages.map((item) => {
                  const module = item.manifest.modules[0]!;
                  return (
                    <Button
                      key={item.manifest.id}
                      type='secondary'
                      long
                      className={styles.recentButton}
                      onClick={() =>
                        onNavigate(`/apps/${encodeURIComponent(item.manifest.id)}/${encodeURIComponent(module.id)}`)
                      }
                    >
                      <span className={styles.recentContent}>
                        <AllApplication theme='outline' size={16} fill='currentColor' />
                        <span>
                          <strong>{item.manifest.name}</strong>
                          <small>{item.manifest.description}</small>
                        </span>
                      </span>
                    </Button>
                  );
                })}
              </div>
            </section>
          )}

          <section className={styles.recentSection} aria-labelledby='hub-home-recent-title'>
            <div className={styles.sectionHeading}>
              <h2 id='hub-home-recent-title'>{t('guid.hubHome.recentTitle')}</h2>
              <Button type='text' size='small' onClick={() => setLauncherScope('all')}>
                <span className={styles.inlineAction}>
                  {t('guid.hubHome.viewAll')}
                  <Right theme='outline' size={13} fill='currentColor' />
                </span>
              </Button>
            </div>
            {recentApps.length > 0 ? (
              <div className={styles.recentGrid}>
                {recentApps.map((app) => (
                  <Button
                    key={app.id}
                    type='secondary'
                    long
                    className={styles.recentButton}
                    onClick={() => openApp(app)}
                  >
                    <span className={styles.recentContent}>
                      <AppIcon app={app} size={16} />
                      <span>
                        <strong>{t(app.labelKey)}</strong>
                        <small>{t(app.descriptionKey)}</small>
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            ) : (
              <div className={styles.recentEmpty}>{t('guid.hubHome.recentEmpty')}</div>
            )}
          </section>
        </main>

        <aside className={styles.statusRail} aria-label={t('guid.hubHome.status.title')}>
          <Button
            type='secondary'
            long
            className={styles.systemStatusButton}
            icon={<span className={`${styles.statusDot} ${styles.dotSuccess}`} />}
            onClick={() => onNavigate('/settings/resource')}
          >
            <span className={styles.inlineAction}>
              {t('guid.hubHome.status.systemTitle')}
              <Right theme='outline' size={13} fill='currentColor' />
            </span>
          </Button>

          {/* Realtime Work Status Card connected to Manager Store */}
          <Card className={styles.statusCard} bordered>
            <div className={styles.statusHeading}>
              <span>{t('guid.hubHome.status.workTitle')}</span>
              <Button type='text' size='mini' onClick={() => onNavigate('/manager')}>
                {t('guid.hubHome.viewAll')}
              </Button>
            </div>
            <div className={styles.metricList}>
              <div style={{ cursor: 'pointer' }} onClick={() => onNavigate('/manager')}>
                <span className={`${styles.statusDot} ${styles.dotSuccess}`} />
                <span>{t('guid.hubHome.status.workInProgress', { count: inProgressCount })}</span>
                <div className={styles.metricValue}>
                  <div className={styles.metricTrack}>
                    <span className={styles.metricFill} style={{ width: `${inProgressPercent}%` }} />
                  </div>
                  <strong>{inProgressPercent}%</strong>
                </div>
              </div>
              <div style={{ cursor: 'pointer' }} onClick={() => onNavigate('/manager')}>
                <span className={`${styles.statusDot} ${styles.dotWarning}`} />
                <span>{t('guid.hubHome.status.workPending', { count: pendingCount })}</span>
                <div className={styles.metricValue}>
                  <div className={styles.metricTrack}>
                    <span
                      className={`${styles.metricFill} ${styles.metricFillWarning}`}
                      style={{ width: `${pendingPercent}%` }}
                    />
                  </div>
                  <strong>{pendingPercent}%</strong>
                </div>
              </div>
              <div style={{ cursor: 'pointer' }} onClick={() => onNavigate('/manager')}>
                <span className={`${styles.statusDot} ${styles.dotDanger}`} />
                <span>{t('guid.hubHome.status.workBlocked', { count: blockedCount })}</span>
                <div className={styles.metricValue}>
                  <div className={styles.metricTrack}>
                    <span
                      className={`${styles.metricFill} ${styles.metricFillDanger}`}
                      style={{ width: `${blockedPercent}%` }}
                    />
                  </div>
                  <strong>{blockedPercent}%</strong>
                </div>
              </div>
            </div>
          </Card>

          {/* Realtime Notifications Card connected to Notification Center */}
          <Card className={styles.statusCard} bordered>
            <div className={styles.statusHeading}>
              <span>{t('guid.hubHome.status.notificationsTitle')}</span>
              <Button
                type='text'
                size='mini'
                onClick={() => window.dispatchEvent(new CustomEvent('tomni-open-notifications'))}
              >
                {t('guid.hubHome.viewAll')}
              </Button>
            </div>
            <div className={styles.notificationList}>
              {notifications.slice(0, 3).map((item) => (
                <div
                  key={item.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    if (item.actionUrl) {
                      onNavigate(item.actionUrl);
                    } else {
                      window.dispatchEvent(new CustomEvent('tomni-open-notifications'));
                    }
                  }}
                >
                  {item.source === 'cron' ? (
                    <Time theme='outline' size={13} fill='#10b981' />
                  ) : item.source === 'agent' ? (
                    <Robot theme='outline' size={13} fill='#a855f7' />
                  ) : item.source === 'tom' ? (
                    <Gift theme='outline' size={13} fill='#f59e0b' />
                  ) : (
                    <Shield theme='outline' size={13} fill='#38bdf8' />
                  )}
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.level}</small>
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card className={styles.statusCard} bordered>
            <div className={styles.statusHeading}>
              <span>{t('guid.hubHome.status.modelsTitle')}</span>
              <Button type='text' size='mini' onClick={() => onNavigate('/settings/model')}>
                {t('guid.hubHome.status.manage')}
              </Button>
            </div>
            <div className={styles.identityRow}>
              <span className={`${styles.statusIcon} ${styles.tonePrimary}`} aria-hidden='true'>
                <Robot theme='outline' size={17} fill='currentColor' />
              </span>
              <span>
                <strong>{selectedModelName || t('guid.hubHome.status.automatic')}</strong>
                <small>{t('guid.hubHome.status.active')}</small>
              </span>
            </div>
            <div className={styles.identityRow}>
              <span className={`${styles.statusIcon} ${styles.toneInfo}`} aria-hidden='true'>
                <Robot theme='outline' size={17} fill='currentColor' />
              </span>
              <span>
                <strong>{selectedAgentName}</strong>
                <small>{t('guid.hubHome.status.agents')}</small>
              </span>
            </div>
          </Card>

          <Card className={styles.statusCard} bordered data-testid='hub-system-status'>
            <div className={styles.statusHeading}>
              <span>{t('guid.hubHome.status.systemTitle')}</span>
              <Button type='text' size='mini' onClick={() => onNavigate('/settings/resource')}>
                {t('guid.hubHome.status.details')}
              </Button>
            </div>
            <div className={styles.systemGrid}>
              <div className={styles.systemMetric}>
                <span className={styles.systemMetricLabel}>{t('guid.hubHome.status.cpu')}</span>
                <div className={styles.systemTrack}>
                  <span
                    className={`${styles.systemFill} ${styles.systemFillCpu}`}
                    style={{ width: `${hasSystemMetrics ? (cpuPercent ?? 0) : 0}%` }}
                  />
                </div>
                <strong>{hasSystemMetrics && cpuPercent !== null ? `${cpuPercent}%` : '—'}</strong>
              </div>
              <div className={styles.systemMetric}>
                <span className={styles.systemMetricLabel}>{t('guid.hubHome.status.ram')}</span>
                <div className={styles.systemTrack}>
                  <span
                    className={`${styles.systemFill} ${styles.systemFillRam}`}
                    style={{ width: `${hasSystemMetrics ? (ramPercent ?? 0) : 0}%` }}
                  />
                </div>
                <strong>{hasSystemMetrics && ramPercent !== null ? `${ramPercent}%` : '—'}</strong>
              </div>
              <div className={styles.systemMetric}>
                <span className={styles.systemMetricLabel}>{t('guid.hubHome.status.storage')}</span>
                <div className={styles.systemTrack}>
                  <span
                    className={`${styles.systemFill} ${styles.systemFillStorage}`}
                    style={{ width: `${hasSystemMetrics ? (storagePercent ?? 0) : 0}%` }}
                  />
                </div>
                <strong>{hasSystemMetrics && storagePercent !== null ? `${storagePercent}%` : '—'}</strong>
              </div>
            </div>
            <div className={styles.systemReady}>
              <span>{t('guid.hubHome.status.connection')}</span>
              <strong>
                {systemMetrics.status === 'ready'
                  ? t('guid.hubHome.status.connectionGood')
                  : systemMetrics.status === 'loading'
                    ? t('common.loading')
                    : t('common.error')}
              </strong>
            </div>
          </Card>
        </aside>
      </div>

      <footer className={styles.footer}>
        <div>
          <span>{t('guid.hubHome.shell.version')}</span>
          <span aria-hidden='true'>·</span>
          <Button type='text' size='mini' onClick={() => onNavigate('/settings/about')}>
            {t('guid.hubHome.shell.support')}
          </Button>
          <span aria-hidden='true'>·</span>
          <FeedbackButton module='hub-home' className={styles.footerFeedbackButton} />
        </div>
        <div className={styles.footerStatus}>
          <span className={`${styles.statusDot} ${desktopRuntime ? styles.dotSuccess : styles.dotWarning}`} />
          <span>{t(coreStatusKey)}</span>
        </div>
      </footer>

      <Modal
        visible={launcherScope !== null}
        title={launcherTitle}
        footer={null}
        unmountOnExit
        maskClosable
        maskStyle={{
          background: 'color-mix(in srgb, var(--bg-base) 52%, transparent)',
          backdropFilter: 'blur(6px) saturate(120%)',
          WebkitBackdropFilter: 'blur(6px) saturate(120%)',
        }}
        className={styles.launcherModal}
        onCancel={() => setLauncherScope(null)}
      >
        <p className={styles.launcherHint}>{t('guid.hubHome.launcherHint')}</p>
        <div className={styles.launcherGrid} data-testid='hub-app-launcher'>
          {launcherApps.map((app) => (
            <Button key={app.id} type='text' className={styles.launcherApp} onClick={() => openApp(app)}>
              <span className={styles.launcherAppContent}>
                <AppIcon app={app} size={22} />
                <strong>{t(app.labelKey)}</strong>
                <small>{t(app.descriptionKey)}</small>
              </span>
            </Button>
          ))}
        </div>
      </Modal>

      {/* Rich Prompt Templates Library Modal */}
      <PromptLibraryModal
        visible={promptLibraryVisible}
        onClose={() => setPromptLibraryVisible(false)}
        onSelectPrompt={(text) => {
          onPromptSelect(text);
          onFocusComposer();
        }}
      />
    </div>
  );
};

export default HubHome;
