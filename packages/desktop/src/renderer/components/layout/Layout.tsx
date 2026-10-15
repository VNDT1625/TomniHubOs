/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { TEAM_MODE_ENABLED } from '@/common/config/constants';
import { configService } from '@/common/config/configService';
import type { ICssTheme } from '@/common/config/storage';
import AppLoader from '@/renderer/components/layout/AppLoader';
import PwaPullToRefresh from '@/renderer/components/layout/PwaPullToRefresh';
import { scheduleNavigationAfterPaint } from '@/renderer/components/layout/routeTransition';
import Titlebar from '@/renderer/components/layout/Titlebar';
import SpotlightOverlay from '@/renderer/components/Spotlight/SpotlightOverlay';
import { Layout as ArcoLayout } from '@arco-design/web-react';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { NavigateOptions, To } from 'react-router-dom';
import { LayoutContext } from '@renderer/hooks/context/LayoutContext';
import { NavigationHistoryProvider } from '@renderer/hooks/context/NavigationHistoryContext';
import { useDeepLink } from '@renderer/hooks/system/useDeepLink';
import { useNotificationClick } from '@renderer/hooks/system/useNotificationClick';
import { useDirectorySelection } from '@renderer/hooks/file/useDirectorySelection';
import { processCustomCss } from '@renderer/utils/theme/customCssProcessor';
import { applyWallpaper } from '@renderer/utils/theme/wallpaper';
import { applyMarkdownTextColors } from '@renderer/utils/theme/markdownTextColors';
import { cleanupSiderTooltips } from '@renderer/utils/ui/siderTooltip';
import HubShell from '@/renderer/pages/guid/shell/HubShell';
import { useConversationShortcuts } from '@renderer/hooks/ui/useConversationShortcuts';
import { isElectronDesktop } from '@renderer/utils/platform';
import { computeCssSyncDecision, resolveCssByActiveTheme } from '@renderer/utils/theme/themeCssSync';
import '@renderer/styles/layout.css';

const UpdateModal = React.lazy(() => import('@/renderer/components/settings/UpdateModal'));

const detectMobileViewportOrTouch = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (isElectronDesktop()) {
    return window.innerWidth < 768;
  }
  const width = window.innerWidth;
  const byWidth = width < 768;
  // 仅在小屏时才将 coarse/touch 视为移动端，避免触控笔记本被误判
  // Treat touch/coarse pointer as mobile only on smaller viewports
  const smallScreen = width < 1024;
  const byMedia = window.matchMedia('(hover: none)').matches || window.matchMedia('(pointer: coarse)').matches;
  const byTouchPoints = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  return byWidth || (smallScreen && (byMedia || byTouchPoints));
};

const Layout: React.FC<{
  /** Legacy sider slot; the Hub shell sidebar replaced it on every route. */
  sider?: React.ReactNode;
  onSessionClick?: () => void;
}> = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [customCss, setCustomCss] = useState<string>('');
  const [routeTransitioning, setRouteTransitioning] = useState(false);
  const { contextHolder: directorySelectionContextHolder } = useDirectorySelection();
  useDeepLink();
  useNotificationClick();
  const navigate = useNavigate();
  useConversationShortcuts({ navigate });
  const location = useLocation();

  useEffect(() => {
    applyWallpaper(configService.get('ui.wallpaper'));
    return configService.subscribe('ui.wallpaper', applyWallpaper);
  }, []);

  useEffect(() => {
    applyMarkdownTextColors(configService.get('ui.markdownTextColors'));
    return configService.subscribe('ui.markdownTextColors', applyMarkdownTextColors);
  }, []);

  const workspaceAvailable =
    location.pathname.startsWith('/conversation/') || (TEAM_MODE_ENABLED && location.pathname.startsWith('/team/'));
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const cancelPendingNavigationRef = useRef<(() => void) | null>(null);
  const lastCssRef = useRef('');
  const lastUiCssUpdateAtRef = useRef(0);

  const navigateWithFeedback = useCallback(
    (to: To, options?: NavigateOptions): void => {
      const currentPath = `${location.pathname}${location.search}${location.hash}`;
      if (typeof to === 'string' && to === currentPath) {
        void navigate(to, options);
        return;
      }

      cancelPendingNavigationRef.current?.();
      setRouteTransitioning(true);
      cancelPendingNavigationRef.current = scheduleNavigationAfterPaint(() => {
        cancelPendingNavigationRef.current = null;
        void navigate(to, options);
      });
    },
    [location.hash, location.pathname, location.search, navigate]
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setRouteTransitioning(false));
    return () => window.cancelAnimationFrame(frame);
  }, [location.key]);

  useEffect(
    () => () => {
      cancelPendingNavigationRef.current?.();
    },
    []
  );

  const loadAndHealCustomCss = useCallback(async () => {
    try {
      const [savedCssRaw, activeThemeId, savedThemes] = await Promise.all([
        configService.get('customCss'),
        configService.get('css.activeThemeId'),
        configService.get('css.themes'),
      ]);

      const decision = computeCssSyncDecision({
        savedCss: savedCssRaw || '',
        activeThemeId: activeThemeId || '',
        savedThemes: (savedThemes || []) as ICssTheme[],
        currentUiCss: customCss,
        lastUiCssUpdateAt: lastUiCssUpdateAtRef.current,
      });

      if (decision.shouldSkipApply) {
        return;
      }

      let effectiveCss = decision.effectiveCss;

      // If the active theme resolved to empty CSS and there IS a saved activeThemeId
      // (but it no longer matches any known theme), fall back to default and persist.
      if (!effectiveCss && activeThemeId && activeThemeId !== 'default-theme') {
        const defaultCss = resolveCssByActiveTheme('default-theme', (savedThemes || []) as ICssTheme[]);
        effectiveCss = defaultCss;
        // Persist the fallback so Layout doesn't keep retrying
        await Promise.all([
          configService.set('css.activeThemeId', 'default-theme'),
          configService.set('customCss', effectiveCss),
        ]).catch((error) => {
          console.warn('Failed to persist theme fallback:', error);
        });
      } else if (decision.shouldHealStorage) {
        await configService.set('customCss', effectiveCss).catch((error) => {
          console.warn('Failed to heal custom CSS from active theme:', error);
        });
      }

      setCustomCss(effectiveCss);
      if (lastCssRef.current !== effectiveCss) {
        lastCssRef.current = effectiveCss;
        window.dispatchEvent(new CustomEvent('custom-css-updated', { detail: { customCss: effectiveCss } }));
      }
    } catch (error) {
      console.error('Failed to load or heal custom CSS:', error);
    }
  }, [customCss]);

  // 加载并监听自定义 CSS 配置 / Load & watch custom CSS configuration
  useEffect(() => {
    void loadAndHealCustomCss();

    const handleCssUpdate = (event: CustomEvent) => {
      if (event.detail?.customCss !== undefined) {
        const css = event.detail.customCss || '';
        lastCssRef.current = css;
        lastUiCssUpdateAtRef.current = Date.now();
        setCustomCss(css);
      }
    };
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key && (event.key.includes('customCss') || event.key.includes('css.activeThemeId'))) {
        void loadAndHealCustomCss();
      }
    };

    window.addEventListener('custom-css-updated', handleCssUpdate as EventListener);
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('custom-css-updated', handleCssUpdate as EventListener);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [loadAndHealCustomCss]);

  // Re-sync theme css on route changes, because some settings pages do not mount CssThemeSettings.
  useEffect(() => {
    void loadAndHealCustomCss();
  }, [location.pathname, location.search, location.hash, loadAndHealCustomCss]);

  // 注入自定义 CSS / Inject custom CSS into document head
  useEffect(() => {
    const styleId = 'user-defined-custom-css';

    if (!customCss) {
      document.getElementById(styleId)?.remove();
      return;
    }

    const wrappedCss = processCustomCss(customCss);

    const ensureStyleAtEnd = () => {
      let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;

      if (styleEl && styleEl.textContent === wrappedCss && styleEl === document.head.lastElementChild) {
        return;
      }

      styleEl?.remove();
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      styleEl.type = 'text/css';
      styleEl.textContent = wrappedCss;
      document.head.appendChild(styleEl);
    };

    ensureStyleAtEnd();

    const observer = new MutationObserver((mutations) => {
      const hasNewStyle = mutations.some((mutation) =>
        Array.from(mutation.addedNodes).some((node) => node.nodeName === 'STYLE' || node.nodeName === 'LINK')
      );

      if (hasNewStyle) {
        const element = document.getElementById(styleId);
        if (element && element !== document.head.lastElementChild) {
          ensureStyleAtEnd();
        }
      }
    });

    observer.observe(document.head, { childList: true });

    return () => {
      observer.disconnect();
      document.getElementById(styleId)?.remove();
    };
  }, [customCss]);

  // 检测移动端并响应窗口大小变化
  useEffect(() => {
    const checkMobile = () => {
      const mobile = detectMobileViewportOrTouch();
      setIsMobile(mobile);
    };

    // 初始检测
    checkMobile();

    // 监听窗口大小变化
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 进入移动端后立即折叠 / Collapse immediately when switching to mobile
  useEffect(() => {
    if (!isMobile || collapsedRef.current) {
      return;
    }
    setCollapsed(true);
  }, [isMobile]);

  // 清理侧栏 Tooltip 残留节点，避免移动端路由切换后浮层卡在左上角
  useEffect(() => {
    cleanupSiderTooltips();
  }, [isMobile, collapsed, location.pathname, location.search, location.hash]);

  // Bridge Main Process logs to F12 Console
  useEffect(() => {
    const unsubscribe = ipcBridge.application.logStream.on((entry) => {
      const prefix = `%c[Main:${entry.tag}]%c ${entry.message}`;
      const style = 'color:#7c3aed;font-weight:bold';
      if (entry.level === 'error') {
        console.error(prefix, style, 'color:inherit', ...(entry.data !== undefined ? [entry.data] : []));
      } else if (entry.level === 'warn') {
        console.warn(prefix, style, 'color:inherit', ...(entry.data !== undefined ? [entry.data] : []));
      } else {
        console.log(prefix, style, 'color:inherit', ...(entry.data !== undefined ? [entry.data] : []));
      }
    });
    return () => unsubscribe();
  }, []);

  // Handle tray events from main process / 处理来自主进程的托盘事件
  useEffect(() => {
    if (!isElectronDesktop()) return;

    // Navigate to guid page when requested from tray / 托盘请求导航到 guid 页面
    const handleNavigateToGuid = () => {
      void navigate('/guid');
    };

    // Navigate to conversation when requested from tray / 托盘请求导航到对话页面
    const handleNavigateToConversation = (event: CustomEvent<{ conversation_id: string }>) => {
      void navigate(`/conversation/${event.detail.conversation_id}`);
    };

    // Open about dialog when requested from tray / 托盘请求打开关于对话框
    const handleOpenAbout = () => {
      // Navigate to settings/about page / 导航到设置/关于页面
      void navigate('/settings/about');
    };

    // Handle pause all tasks request from tray / 托盘请求暂停所有任务
    const handlePauseAllTasks = async () => {
      const { ipcBridge } = await import('@/common');
      const result = await ipcBridge.task.stopAll.invoke();
      if (result?.success) {
        // Navigate to settings page to show task status
        void navigate('/settings/system');
      }
    };

    // Handle check update request from tray / 托盘请求检查更新
    // 1. Navigate to about page / 导航到关于页面
    // 2. Trigger update modal check / 触发更新模态框检查
    const handleCheckUpdate = () => {
      void navigate('/settings/about');
      // Trigger update modal after a short delay to ensure page is loaded
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('tomny-open-update-modal', { detail: { source: 'tray' } }));
      }, 100);
    };

    // Listen for tray events / 监听托盘事件
    window.addEventListener('tray:navigate-to-guid', handleNavigateToGuid as EventListener);
    window.addEventListener('tray:navigate-to-conversation', handleNavigateToConversation as EventListener);
    window.addEventListener('tray:open-about', handleOpenAbout as EventListener);
    window.addEventListener('tray:pause-all-tasks', handlePauseAllTasks as EventListener);
    window.addEventListener('tray:check-update', handleCheckUpdate as EventListener);

    return () => {
      window.removeEventListener('tray:navigate-to-guid', handleNavigateToGuid as EventListener);
      window.removeEventListener('tray:navigate-to-conversation', handleNavigateToConversation as EventListener);
      window.removeEventListener('tray:open-about', handleOpenAbout as EventListener);
      window.removeEventListener('tray:pause-all-tasks', handlePauseAllTasks as EventListener);
      window.removeEventListener('tray:check-update', handleCheckUpdate as EventListener);
    };
  }, [navigate]);

  // Every route renders inside the Hub shell, which owns its own sidebar width variable.
  useEffect(() => {
    document.documentElement.style.setProperty('--page-sider-w', '0px');
  }, []);

  return (
    <LayoutContext.Provider
      value={{
        isMobile,
        siderCollapsed: collapsed,
        setSiderCollapsed: setCollapsed,
        navigateWithFeedback,
      }}
    >
      <NavigationHistoryProvider>
        <div className='app-shell app-shell--glass flex flex-col size-full min-h-0'>
          <Titlebar workspaceAvailable={workspaceAvailable} />
          <SpotlightOverlay />
          {/* Every authenticated route renders in the centre of the one Hub shell. */}
          <ArcoLayout className={'size-full layout flex-1 min-h-0'}>
            <ArcoLayout.Content className='relative layout-content layout-content--glass flex flex-col min-h-0'>
              {routeTransitioning && <AppLoader overlay />}
              <HubShell>
                <Outlet />
              </HubShell>
              {directorySelectionContextHolder}
              <PwaPullToRefresh />
              <Suspense fallback={null}>
                <UpdateModal />
              </Suspense>
            </ArcoLayout.Content>
          </ArcoLayout>
        </div>
      </NavigationHistoryProvider>
    </LayoutContext.Provider>
  );
};

export default Layout;
