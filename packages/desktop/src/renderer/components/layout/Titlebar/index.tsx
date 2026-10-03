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
  Search,
  SettingTwo,
} from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { ipcBridge } from '@/common';
import { TEAM_MODE_ENABLED } from '@/common/config/constants';
import tomniIcon from '@/renderer/assets/tomni-icon.svg';
import MobileConversationBrand from './MobileConversationBrand';
import WindowControls from '../WindowControls';
import TomBalanceWidget from './TomBalanceWidget';
import SettingsGlassDropdown from './SettingsGlassDropdown';
import GlobalSearchModal from './GlobalSearchModal';
import NotificationCenterDrawer from './NotificationCenterDrawer';
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
  const [searchModalVisible, setSearchModalVisible] = useState(false);
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

  // Global Ctrl+K / Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchModalVisible((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
  const iconSize = 18;
  const desktopIconStroke = layout?.isMobile ? undefined : 2.5;
  const showSiderToggle = Boolean(layout?.setSiderCollapsed) && !(layout?.isMobile && isSettingsRoute);
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
        style={mobileCenterStyle}
        className={classNames('flex items-center gap-8px app-titlebar bg-2 border-b border-[var(--border-base)]', {
          'app-titlebar--mobile': layout?.isMobile,
          'app-titlebar--mobile-conversation': layout?.isMobile && workspaceAvailable,
          'app-titlebar--desktop': isDesktopRuntime,
          'app-titlebar--mac': isMacRuntime,
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
          <div
            className='app-titlebar__brand-tag app-titlebar__no-drag'
            onClick={() => void navigate('/guid')}
            title='Tomni Hub Agent OS'
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
            <span
              style={{
                fontWeight: 700,
                fontSize: '13px',
                color: 'var(--color-text-1, #f8fafc)',
                letterSpacing: '0.02em',
              }}
            >
              Tomny
            </span>
          </div>
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
            className='app-titlebar__search-container app-titlebar__no-drag'
            style={{
              flex: 1,
              display: 'flex',
              justifyContent: 'center',
              maxWidth: '440px',
              margin: '0 auto',
            }}
          >
            <button
              type='button'
              className='app-titlebar__omni-search-btn'
              onClick={() => setSearchModalVisible(true)}
              title='Tìm kiếm hội thoại, ứng dụng, cài đặt... (Ctrl + K)'
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                height: '28px',
                padding: '0 10px',
                borderRadius: '8px',
                border: '1px solid var(--color-border-2, rgba(255, 255, 255, 0.12))',
                background: 'var(--color-fill-2, rgba(255, 255, 255, 0.05))',
                color: 'var(--color-text-3, #94a3b8)',
                fontSize: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                <Search theme='outline' size={14} fill='currentColor' />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Tìm kiếm hoặc gõ lệnh...
                </span>
              </div>
              <kbd
                style={{
                  fontSize: '10px',
                  padding: '1px 5px',
                  borderRadius: '4px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: 'var(--color-text-3, #94a3b8)',
                  fontFamily: 'monospace',
                  flexShrink: 0,
                }}
              >
                Ctrl + K
              </kbd>
            </button>
          </div>
        )}

        {/* Right Section: Toolbar (TOM Balance, Notification Bell, Settings, Account Dropdown, Window Controls) */}
        <div ref={toolbarRef} className='app-titlebar__toolbar'>
          {layout?.isMobile && <div id='app-titlebar-actions-slot' className='app-titlebar__actions-slot' />}

          {/* Realtime TOM Balance Widget */}
          <TomBalanceWidget />

          {/* Notification Hub Bell Button */}
          <Badge
            count={unreadP0Count + unreadP1Count}
            dot={unreadP0Count + unreadP1Count === 0 && unreadCount > 0}
            style={{
              backgroundColor: unreadP0Count > 0 ? '#ef4444' : '#f59e0b',
              boxShadow: unreadP0Count > 0 ? '0 0 8px rgba(239, 68, 68, 0.6)' : undefined,
            }}
          >
            <button
              type='button'
              className='app-titlebar__button app-titlebar__no-drag'
              title='Trung tâm Thông báo (Laya Engine)'
              aria-label='Trung tâm Thông báo'
              onClick={() => setNotificationsDrawerVisible(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '28px',
                height: '28px',
                borderRadius: '14px',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: unreadP0Count > 0 ? '#f87171' : '#e2e8f0',
                cursor: 'pointer',
                transition: 'all 0.2s',
                margin: '0 2px',
              }}
            >
              <Remind theme='outline' size={14} fill='currentColor' />
            </button>
          </Badge>

          {/* Direct Settings Navigation Button */}
          <button
            type='button'
            className='app-titlebar__button app-titlebar__no-drag'
            title='Cài đặt hệ thống'
            aria-label='Cài đặt hệ thống'
            onClick={() => void navigate('/settings')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              borderRadius: '14px',
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#e2e8f0',
              cursor: 'pointer',
              transition: 'all 0.2s',
              margin: '0 2px',
            }}
          >
            <SettingTwo theme='outline' size={14} fill='currentColor' />
          </button>

          {/* Settings & Account Glassmorphism Dropdown */}
          <SettingsGlassDropdown />

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

      {/* Global Search & Command Palette Modal */}
      <GlobalSearchModal visible={searchModalVisible} onClose={() => setSearchModalVisible(false)} />

      {/* Omni Notification Center Drawer */}
      <NotificationCenterDrawer
        visible={notificationsDrawerVisible}
        onClose={() => setNotificationsDrawerVisible(false)}
      />
    </>
  );
};

export default Titlebar;
