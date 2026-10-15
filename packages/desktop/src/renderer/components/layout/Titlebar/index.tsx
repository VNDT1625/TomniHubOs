import React, { useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { Badge } from '@arco-design/web-react';
import {
  ArrowCircleLeft,
  ArrowLeft,
  ArrowRight,
  ExpandLeft,
  ExpandRight,
  Peoples,
  Remind,
  SettingTwo,
} from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { ipcBridge } from '@/common';
import { TEAM_MODE_ENABLED } from '@/common/config/constants';
import tomniIcon from '@/renderer/assets/tomni-icon.svg';
import MobileConversationBrand from './MobileConversationBrand';
import { isGuidPath, isHubPagePath } from '../hubRoutes';
import WindowControls from '../WindowControls';
import TomBalanceWidget from './TomBalanceWidget';
import SettingsGlassDropdown from './SettingsGlassDropdown';
import SuperSearch from '@renderer/components/layout/SuperSearch';
import NotificationCenterDrawer from './NotificationHub/NotificationCenterDrawer';
import ExtensionStrip, { surfaceForPath } from './extensions/ExtensionStrip';
import { useNotifications } from '@/renderer/services/notificationService';
import { WORKSPACE_STATE_EVENT, dispatchWorkspaceToggleEvent } from '@renderer/utils/workspace/workspaceEvents';
import type { WorkspaceStateDetail } from '@renderer/utils/workspace/workspaceEvents';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useNavigationHistory } from '@/renderer/hooks/context/NavigationHistoryContext';
import { isElectronDesktop, isMacOS } from '@/renderer/utils/platform';
import './titlebar.css';

interface TitlebarProps {
  workspaceAvailable: boolean;
}

const SidebarIcon: React.FC<{ size?: number; strokeWidth?: number }> = ({ size = 18, strokeWidth = 4 }) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 48 48'
    fill='none'
    stroke='currentColor'
    strokeWidth={strokeWidth}
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden='true'
    focusable='false'
  >
    <rect x='6' y='10' width='36' height='28' rx='5' />
    <line x1='18' y1='10' x2='18' y2='38' />
  </svg>
);

const Titlebar: React.FC<TitlebarProps> = ({ workspaceAvailable }) => {
  const { t } = useTranslation();
  const appTitle = useMemo(() => 'Tomny', []);
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(true);
  const [mobileCenterTitle, setMobileCenterTitle] = useState(appTitle);
  const [mobileCenterOffset, setMobileCenterOffset] = useState(0);
  const [headerSides, setHeaderSides] = useState({ left: 120, right: 284 });
  const [notificationsDrawerVisible, setNotificationsDrawerVisible] = useState(false);
  const { unreadP0Count, unreadP1Count, unreadCount } = useNotifications();
  const layout = useLayoutContext();
  const navigationHistory = useNavigationHistory();
  const location = useLocation();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const lastNonSettingsPathRef = useRef('/guid');

  // Global listener for opening notification center
  useEffect(() => {
    const handleOpenNotif = () => setNotificationsDrawerVisible(true);
    window.addEventListener('tomni-open-notifications', handleOpenNotif);
    return () => window.removeEventListener('tomni-open-notifications', handleOpenNotif);
  }, []);

  // Sync workspace collapsed state
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<WorkspaceStateDetail>;
      if (typeof customEvent.detail?.collapsed === 'boolean') {
        setWorkspaceCollapsed(customEvent.detail.collapsed);
      }
    };
    window.addEventListener(WORKSPACE_STATE_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(WORKSPACE_STATE_EVENT, handler as EventListener);
    };
  }, []);

  const isDesktopRuntime = isElectronDesktop();
  const isMacRuntime = isDesktopRuntime && isMacOS();
  const showWindowControls = isDesktopRuntime && !isMacRuntime;
  const showWorkspaceButton = workspaceAvailable && (!isDesktopRuntime || isMacRuntime);

  const workspaceTooltip = workspaceCollapsed
    ? t('common.expandMore', { defaultValue: 'Expand workspace' })
    : t('common.collapse', { defaultValue: 'Collapse workspace' });
  const backToChatTooltip = t('common.back', { defaultValue: 'Back to Chat' });
  const isSettingsRoute = location.pathname.startsWith('/settings');
  // v3 Home header: back/forward, centred search, bell dot, avatar, window controls only.
  // v3 header on every desktop route; Home additionally owns the HubSidebar toggle.
  const isHome = !layout?.isMobile;
  const onGuidRoute = isGuidPath(location.pathname);
  const hasLegacySider = !isHubPagePath(location.pathname);
  const iconSize = 18;
  const desktopIconStroke = layout?.isMobile ? undefined : 2.5;
  const showSiderToggle = Boolean(layout?.setSiderCollapsed) && !(layout?.isMobile && isSettingsRoute) && !isHome;
  const showBackToChatButton = Boolean(layout?.isMobile && isSettingsRoute);
  const siderTooltip = layout?.siderCollapsed
    ? t('common.expandMore', { defaultValue: 'Expand sidebar' })
    : t('common.collapse', { defaultValue: 'Collapse sidebar' });
  const showHistoryNav = Boolean(navigationHistory) && !layout?.isMobile;
  const historyBackTooltip = t('common.historyBack', { defaultValue: 'Back' });
  const historyForwardTooltip = t('common.forward', { defaultValue: 'Forward' });

  const handleSiderToggle = () => {
    if (!showSiderToggle || !layout?.setSiderCollapsed) return;
    layout.setSiderCollapsed(!layout.siderCollapsed);
  };

  const handleWorkspaceToggle = () => {
    if (!workspaceAvailable) {
      return;
    }
    dispatchWorkspaceToggleEvent();
  };

  const handleBackToChat = () => {
    const target = lastNonSettingsPathRef.current;
    if (target && !target.startsWith('/settings')) {
      void navigate(target);
      return;
    }
    void navigate(-1);
  };

  useEffect(() => {
    if (!isSettingsRoute) {
      const path = `${location.pathname}${location.search}${location.hash}`;
      lastNonSettingsPathRef.current = path;
      try {
        sessionStorage.setItem('tomny:last-non-settings-path', path);
      } catch {
        // ignore
      }
      return;
    }
    try {
      const stored = sessionStorage.getItem('tomny:last-non-settings-path');
      if (stored) {
        lastNonSettingsPathRef.current = stored;
      }
    } catch {
      // ignore
    }
  }, [isSettingsRoute, location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!layout?.isMobile) {
      setMobileCenterTitle(appTitle);
      return;
    }

    if (TEAM_MODE_ENABLED) {
      const teamMatch = location.pathname.match(/^\/team\/([^/]+)/);
      const team_id = teamMatch?.[1];
      if (team_id) {
        let cancelled = false;
        void ipcBridge.team.get
          .invoke({ id: team_id })
          .then((team) => {
            if (cancelled) return;
            setMobileCenterTitle(team?.name || appTitle);
          })
          .catch(() => {
            if (cancelled) return;
            setMobileCenterTitle(appTitle);
          });
        return () => {
          cancelled = true;
        };
      }
    }

    const match = location.pathname.match(/^\/conversation\/([^/]+)/);
    const conversation_id = match?.[1];
    if (!conversation_id) {
      setMobileCenterTitle(appTitle);
      return;
    }

    let cancelled = false;
    void ipcBridge.conversation.get
      .invoke({ id: conversation_id })
      .then((conversation) => {
        if (cancelled) return;
        setMobileCenterTitle(conversation?.name || appTitle);
      })
      .catch(() => {
        if (cancelled) return;
        setMobileCenterTitle(appTitle);
      });

    return () => {
      cancelled = true;
    };
  }, [appTitle, layout?.isMobile, location.pathname]);

  useEffect(() => {
    if (!layout?.isMobile) {
      setMobileCenterOffset(0);
      return;
    }

    const updateOffset = () => {
      const leftWidth = menuRef.current?.offsetWidth || 0;
      const rightWidth = toolbarRef.current?.offsetWidth || 0;
      setMobileCenterOffset((leftWidth - rightWidth) / 2);
    };

    updateOffset();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateOffset);
      return () => window.removeEventListener('resize', updateOffset);
    }

    const observer = new ResizeObserver(() => updateOffset());
    if (containerRef.current) observer.observe(containerRef.current);
    if (menuRef.current) observer.observe(menuRef.current);
    if (toolbarRef.current) observer.observe(toolbarRef.current);

    return () => observer.disconnect();
  }, [layout?.isMobile, showBackToChatButton, showWorkspaceButton, mobileCenterTitle]);

  // Keep the search inside the real space left between navigation and
  // notification/avatar/window controls as the Hub rail changes width.
  useEffect(() => {
    if (!isHome || layout?.isMobile) return undefined;
    const measure = () => {
      const left = Math.ceil(menuRef.current?.getBoundingClientRect().width ?? 120);
      const right = Math.ceil(toolbarRef.current?.getBoundingClientRect().width ?? 284);
      setHeaderSides((value) => (value.left === left && value.right === right ? value : { left, right }));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      if (menuRef.current) observer.observe(menuRef.current);
      if (toolbarRef.current) observer.observe(toolbarRef.current);
      if (containerRef.current) observer.observe(containerRef.current);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isHome, layout?.isMobile]);

  const mobileCenterStyle = layout?.isMobile
    ? ({
        '--app-titlebar-mobile-center-offset': `${workspaceAvailable ? mobileCenterOffset : 0}px`,
      } as React.CSSProperties)
    : undefined;

  const menuStyle: React.CSSProperties = useMemo(() => {
    if (!isMacRuntime || !showSiderToggle) return {};
    const marginLeft = layout?.isMobile ? '0px' : '76px';
    return {
      marginLeft,
    };
  }, [isMacRuntime, showSiderToggle, layout?.isMobile]);

  return (
    <>
      <div
        ref={containerRef}
        style={
          isHome && !layout?.isMobile
            ? ({
                ...mobileCenterStyle,
                '--titlebar-menu-w': `${headerSides.left}px`,
                '--titlebar-toolbar-w': `${headerSides.right}px`,
              } as React.CSSProperties)
            : mobileCenterStyle
        }
        className={classNames('flex items-center gap-8px app-titlebar bg-2 border-b border-[var(--border-base)]', {
          'app-titlebar--mobile': layout?.isMobile,
          'app-titlebar--mobile-conversation': layout?.isMobile && workspaceAvailable,
          'app-titlebar--desktop': isDesktopRuntime,
          'app-titlebar--mac': isMacRuntime,
          'app-titlebar--home': isHome,
          'app-titlebar--page': isHome && !onGuidRoute,
        })}
      >
        {/* Left Section: Menu Controls, History & Brand Logo */}
        <div ref={menuRef} className='app-titlebar__menu' style={menuStyle}>
          {showBackToChatButton && (
            <button
              type='button'
              className={classNames('app-titlebar__button', layout?.isMobile && 'app-titlebar__button--mobile')}
              onClick={handleBackToChat}
              aria-label={backToChatTooltip}
            >
              <ArrowCircleLeft theme='outline' size={iconSize} fill='currentColor' />
            </button>
          )}
          {showSiderToggle && (
            <button
              type='button'
              className={classNames('app-titlebar__button', layout?.isMobile && 'app-titlebar__button--mobile')}
              onClick={handleSiderToggle}
              aria-label={siderTooltip}
            >
              <SidebarIcon size={iconSize} strokeWidth={desktopIconStroke} />
            </button>
          )}
          {isHome && (onGuidRoute || (hasLegacySider && layout?.setSiderCollapsed)) && (
            <button
              type='button'
              className='app-titlebar__button app-titlebar__no-drag'
              onClick={() =>
                onGuidRoute
                  ? window.dispatchEvent(new CustomEvent('tomni-hub-toggle-sidebar'))
                  : layout?.setSiderCollapsed?.(!layout.siderCollapsed)
              }
              aria-label='Toggle sidebar'
              data-testid='hub-sidebar-toggle'
            >
              <SidebarIcon size={iconSize} strokeWidth={desktopIconStroke} />
            </button>
          )}
          {showHistoryNav && (
            <>
              <button
                type='button'
                className='app-titlebar__button app-titlebar__button--nav'
                onClick={() => navigationHistory?.back()}
                disabled={!navigationHistory?.canBack}
                aria-label={historyBackTooltip}
                title={historyBackTooltip}
              >
                <ArrowLeft theme='outline' size={iconSize} fill='currentColor' strokeWidth={desktopIconStroke} />
              </button>
              <button
                type='button'
                className='app-titlebar__button app-titlebar__button--nav'
                onClick={() => navigationHistory?.forward()}
                disabled={!navigationHistory?.canForward}
                aria-label={historyForwardTooltip}
                title={historyForwardTooltip}
              >
                <ArrowRight theme='outline' size={iconSize} fill='currentColor' strokeWidth={desktopIconStroke} />
              </button>
            </>
          )}

          {/* Brand Mark with Logo */}
          {!isHome && (
            <div
              className='app-titlebar__brand-tag app-titlebar__no-drag'
              onClick={() => void navigate('/guid')}
              title='Tomny Hub Agent OS'
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                marginLeft: '8px',
                padding: '3px 8px',
                borderRadius: '6px',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <img src={tomniIcon} alt='Tomny' style={{ width: '18px', height: '18px' }} />
              <span className='app-titlebar__brand-tag-text'>Tomny</span>
            </div>
          )}
        </div>

        {/* Center Section: Mobile Brand or Desktop Omni Search */}
        {layout?.isMobile ? (
          <div
            className={classNames('app-titlebar__brand', {
              'app-titlebar__brand--centered': true,
            })}
            aria-label={mobileCenterTitle}
            title={mobileCenterTitle}
          >
            {(() => {
              const conversationMatch = location.pathname.match(/^\/conversation\/([^/]+)/);
              const conversation_id = conversationMatch?.[1];
              if (conversation_id) {
                return <MobileConversationBrand conversation_id={conversation_id} fallbackTitle={mobileCenterTitle} />;
              }
              const isTeamRoute = TEAM_MODE_ENABLED && /^\/team\/[^/]+/.test(location.pathname);
              return (
                <span className='app-titlebar__brand-mobile'>
                  {isTeamRoute && (
                    <span className='app-titlebar__brand-icon' aria-hidden='true'>
                      <Peoples theme='outline' size='16' fill='currentColor' />
                    </span>
                  )}
                  <span className='app-titlebar__brand-text'>{mobileCenterTitle}</span>
                </span>
              );
            })()}
          </div>
        ) : (
          <div
            className={classNames('app-titlebar__search-container app-titlebar__no-drag', {
              'app-titlebar__search-container--page': !isHome,
            })}
          >
            <SuperSearch />
          </div>
        )}

        {/* Right Section: Toolbar (TOM Balance, Notification Bell, Settings, Account Dropdown, Window Controls) */}
        <div ref={toolbarRef} className='app-titlebar__toolbar'>
          {layout?.isMobile && <div id='app-titlebar-actions-slot' className='app-titlebar__actions-slot' />}

          {/* Realtime TOM Balance Widget */}
          {!isHome && <TomBalanceWidget />}

          {/* Extension strip: pinned icons and the puzzle popup, before the bell (docs section 12.5, T4.5) */}
          {!layout?.isMobile && (
            <ExtensionStrip
              surface={surfaceForPath(location.pathname)}
              sidePanelOpen={workspaceAvailable && !workspaceCollapsed}
            />
          )}

          {/* Notification Hub Bell Button */}
          <Badge
            count={isHome ? 0 : unreadP0Count + unreadP1Count}
            dot={isHome ? false : unreadP0Count + unreadP1Count === 0 && unreadCount > 0}
            style={
              isHome
                ? undefined
                : {
                    backgroundColor: unreadP0Count > 0 ? '#ef4444' : '#f59e0b',
                    boxShadow: unreadP0Count > 0 ? '0 0 8px rgba(239, 68, 68, 0.6)' : undefined,
                  }
            }
          >
            <button
              type='button'
              className={classNames('app-titlebar__button app-titlebar__no-drag', {
                'app-titlebar__pill-btn': !isHome,
                'app-titlebar__pill-btn--alert': !isHome && unreadP0Count > 0,
              })}
              title='Trung tâm Thông báo (Laya Engine)'
              aria-label='Trung tâm Thông báo'
              onClick={() => setNotificationsDrawerVisible(true)}
            >
              <Remind theme='outline' size={14} fill='currentColor' />
              {isHome && unreadCount > 0 && <span className='app-titlebar__bell-dot' />}
            </button>
          </Badge>

          {/* Direct Settings Navigation Button */}
          {!isHome && (
            <button
              type='button'
              className='app-titlebar__button app-titlebar__no-drag app-titlebar__pill-btn app-titlebar__settings-btn'
              title='Cài đặt hệ thống'
              aria-label='Cài đặt hệ thống'
              onClick={() => void navigate('/settings')}
            >
              <SettingTwo theme='outline' size={14} fill='currentColor' />
            </button>
          )}

          {/* Settings & Account Glassmorphism Dropdown */}
          <SettingsGlassDropdown variant={isHome ? 'home' : 'default'} />

          {/* Workspace Toggle Button */}
          {showWorkspaceButton && (
            <button
              type='button'
              className={classNames('app-titlebar__button', layout?.isMobile && 'app-titlebar__button--mobile')}
              onClick={handleWorkspaceToggle}
              aria-label={workspaceTooltip}
            >
              {workspaceCollapsed ? (
                <ExpandRight theme='outline' size={iconSize} fill='currentColor' />
              ) : (
                <ExpandLeft theme='outline' size={iconSize} fill='currentColor' />
              )}
            </button>
          )}

          {/* Native Desktop Window Controls */}
          {showWindowControls && <WindowControls />}
        </div>
      </div>

      {/* Omni Notification Center Drawer */}
      <NotificationCenterDrawer
        visible={notificationsDrawerVisible}
        onClose={() => setNotificationsDrawerVisible(false)}
      />
    </>
  );
};

export default Titlebar;
