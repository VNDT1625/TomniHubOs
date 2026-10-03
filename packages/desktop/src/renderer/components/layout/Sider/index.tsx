import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { useConversationHistoryContext } from '@/renderer/hooks/context/ConversationHistoryContext';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { blurActiveElement } from '@/renderer/utils/ui/focus';
import { cleanupSiderTooltips } from '@/renderer/utils/ui/siderTooltip';
import { Button, Tooltip } from '@arco-design/web-react';
import {
  AllApplication,
  BuildingTwo,
  Compass,
  DashboardOne,
  Down,
  FileText,
  FolderOpen,
  History,
  Home,
  Lightning,
  MessageOne,
  Right,
} from '@icon-park/react';
import React, { Suspense, useCallback, useMemo, useState } from 'react';
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
  { id: 'store', key: 'guid.hubHome.shell.store', path: '/store', Icon: AllApplication },
  { id: 'history', key: 'guid.hubHome.shell.nav.history', path: '/history', Icon: History },
  { id: 'company', key: 'guid.hubHome.shell.nav.company', path: '/company', Icon: BuildingTwo },
  { id: 'management', key: 'guid.hubHome.shell.nav.manage', path: '/manager', Icon: DashboardOne },
] as const;

type PinnedAppItem = {
  id: string;
  label: string;
  path: string;
  Icon: typeof Compass;
  subItems?: { id: string; label: string; path: string }[];
};

const PINNED_APPS: PinnedAppItem[] = [
  {
    id: 'browser',
    label: 'Browser',
    path: '/browser',
    Icon: Compass,
    subItems: [
      { id: 'browser-yt', label: 'YouTube', path: '/browser?url=https%3A%2F%2Fyoutube.com' },
      { id: 'browser-gpt', label: 'ChatGPT', path: '/browser?url=https%3A%2F%2Fchatgpt.com' },
      { id: 'browser-new', label: 'New Tab', path: '/browser' },
    ],
  },
  {
    id: 'document-studio',
    label: 'Document Studio',
    path: '/apps/com.tomni.document-studio/studio',
    Icon: FileText,
    subItems: [
      { id: 'doc-writer', label: 'Writer / Docx', path: '/apps/com.tomni.document-studio/studio?mode=document' },
      { id: 'doc-sheet', label: 'Spreadsheet / Xlsx', path: '/apps/com.tomni.document-studio/studio?mode=spreadsheet' },
    ],
  },
  {
    id: 'automation-studio',
    label: 'Automation Studio',
    path: '/apps/com.tomni.automation-studio/automation',
    Icon: Lightning,
  },
];

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

  const { conversations = [] } = useConversationHistoryContext();

  const [expandedApps, setExpandedApps] = useState<Record<string, boolean>>({ browser: false });
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({ 'Default Workspace': true });
  const [showAllWorkspaceChats, setShowAllWorkspaceChats] = useState<Record<string, boolean>>({});

  const workspaceGroups = useMemo(() => {
    const groups: Record<string, typeof conversations> = {};
    for (const conv of conversations) {
      const ws = (conv as any)?.extra?.workspace?.trim() || 'Default Workspace';
      if (!groups[ws]) groups[ws] = [];
      groups[ws].push(conv);
    }
    if (Object.keys(groups).length === 0) {
      groups['Default Workspace'] = [];
    }
    return groups;
  }, [conversations]);

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

  const toggleAppSub = useCallback((appId: string, e: any) => {
    e?.stopPropagation?.();
    setExpandedApps((prev) => ({ ...prev, [appId]: !prev[appId] }));
  }, []);

  const toggleWorkspace = useCallback((ws: string) => {
    setExpandedWorkspaces((prev) => ({ ...prev, [ws]: !prev[ws] }));
  }, []);

  const toggleShowAll = useCallback((ws: string, e: any) => {
    e?.stopPropagation?.();
    setShowAllWorkspaceChats((prev) => ({ ...prev, [ws]: !prev[ws] }));
  }, []);

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
    Icon: (typeof PRIMARY_NAV)[number]['Icon'],
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
      <div className={styles.scrollArea}>
        <nav className={styles.navigation} aria-label={t('guid.hubHome.shell.primaryNavigation')}>
          {PRIMARY_NAV.map((item) =>
            renderNavButton(item.id, t(item.key), item.path, item.Icon, isNavActive(pathname, item.path))
          )}
        </nav>

        <div className={styles.divider} />

        {/* Pinned Apps Section */}
        <section className={styles.section}>
          <div className={styles.sectionLabel}>
            <span className={styles.sidebarCopy}>{t('guid.hubHome.shell.pinnedApps')}</span>
            <AllApplication theme='outline' size={13} fill='currentColor' />
          </div>
          {PINNED_APPS.map((app) => {
            const hasSub = (app.subItems?.length ?? 0) > 0;
            const isExpanded = expandedApps[app.id] ?? false;
            const active = isNavActive(pathname, app.path);

            return (
              <div key={app.id} className={styles.appItemWrapper}>
                <Button
                  type='text'
                  long
                  className={`${styles.navButton} ${active ? styles.navButtonActive : ''}`}
                  icon={<app.Icon theme='outline' size={16} fill='currentColor' />}
                  aria-label={app.label}
                  onClick={() => navigateTo(app.path)}
                >
                  <span className={styles.sidebarCopy}>{app.label}</span>
                </Button>
                {hasSub && !collapsed && (
                  <Button
                    type='text'
                    size='mini'
                    className={styles.appSubToggle}
                    aria-label={`Toggle ${app.label} tabs`}
                    onClick={(e) => toggleAppSub(app.id, e)}
                  >
                    {isExpanded ? (
                      <Down theme='outline' size={12} fill='currentColor' />
                    ) : (
                      <Right theme='outline' size={12} fill='currentColor' />
                    )}
                  </Button>
                )}
                {hasSub && isExpanded && !collapsed && (
                  <div className={styles.subAppList}>
                    {app.subItems?.map((sub) => (
                      <Button
                        key={sub.id}
                        type='text'
                        long
                        className={styles.subAppItem}
                        onClick={() => navigateTo(sub.path)}
                      >
                        <span className={styles.sidebarCopy}>{sub.label}</span>
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>

        <div className={styles.divider} />

        {/* Workspaces & Projects Tree Section */}
        <section className={styles.section}>
          <div className={styles.sectionLabel}>
            <span className={styles.sidebarCopy}>{t('guid.hubHome.shell.workspaces')}</span>
            <FolderOpen theme='outline' size={13} fill='currentColor' />
          </div>

          <div className={styles.workspaceTree}>
            {Object.entries(workspaceGroups).map(([wsName, convList]) => {
              const isWsExpanded = expandedWorkspaces[wsName] ?? true;
              const showAll = showAllWorkspaceChats[wsName] ?? false;
              const displayedChats = showAll ? convList : convList.slice(0, 3);
              const remainingCount = convList.length - 3;

              return (
                <div key={wsName} className={styles.workspaceFolder}>
                  <div
                    className={styles.workspaceHeader}
                    onClick={() => toggleWorkspace(wsName)}
                    role='button'
                    tabIndex={0}
                  >
                    {!collapsed &&
                      (isWsExpanded ? (
                        <Down theme='outline' size={11} fill='currentColor' />
                      ) : (
                        <Right theme='outline' size={11} fill='currentColor' />
                      ))}
                    <FolderOpen theme='outline' size={14} fill='currentColor' />
                    <span className={styles.sidebarCopy}>{wsName}</span>
                  </div>

                  {isWsExpanded && !collapsed && (
                    <div className={styles.conversationList}>
                      {displayedChats.map((chat) => {
                        const isChatActive = pathname === `/conversation/${chat.id}`;
                        const chatTitle = chat.name || 'Cuộc trò chuyện mới';
                        return (
                          <div
                            key={chat.id}
                            className={`${styles.conversationItem} ${isChatActive ? styles.conversationItemActive : ''}`}
                            onClick={() => navigateTo(`/conversation/${chat.id}`)}
                            title={chatTitle}
                          >
                            <MessageOne theme='outline' size={13} fill='currentColor' />
                            <span className={styles.conversationTitle}>{chatTitle}</span>
                          </div>
                        );
                      })}

                      {convList.length === 0 && (
                        <div
                          className={styles.conversationItem}
                          onClick={() => navigateTo('/guid')}
                          style={{ opacity: 0.6 }}
                        >
                          <MessageOne theme='outline' size={13} fill='currentColor' />
                          <span className={styles.conversationTitle}>Tạo cuộc trò chuyện mới</span>
                        </div>
                      )}

                      {remainingCount > 0 && (
                        <Button
                          type='text'
                          size='mini'
                          className={styles.showMoreBtn}
                          onClick={(e) => toggleShowAll(wsName, e)}
                        >
                          {showAll ? 'Thu gọn' : `Xem thêm (${remainingCount})`}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className={styles.spacer} />

      {/* Footer Section: Clean Account Button Only */}
      {showAccount && (
        <Button
          type='text'
          long
          className={`${styles.accountButton} ${pathname === '/account' ? styles.navButtonActive : ''}`}
          aria-label={accountName}
          onClick={() => navigateTo('/account')}
        >
          <span className={styles.accountAvatar}>{accountInitial}</span>
          <span className={`${styles.accountCopy} ${styles.sidebarCopy}`}>
            <strong>{accountName}</strong>
            <small>Tài khoản & Cấp bậc</small>
          </span>
          <Right className={styles.sidebarCopy} theme='outline' size={13} fill='currentColor' />
        </Button>
      )}
    </div>
  );
};

export default Sider;
