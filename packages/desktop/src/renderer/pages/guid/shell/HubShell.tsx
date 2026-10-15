/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import FeedbackButton from '@/renderer/components/base/FeedbackButton';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { getFirstRunnablePackageModule, getRunnablePackageModules } from '@/renderer/pages/hub/PackageAppHost';
import { packageClient } from '@/renderer/pages/hub/packageClient';
import { flushCloudPackageOutbox } from '@/renderer/pages/hub/cloudPackageLibrary';
import { PackageRestoreOnboarding } from '@/renderer/pages/hub/PackageRestoreOnboarding';
import { requestPackagePermissionUpdateConsent } from '@/renderer/pages/hub/StoreProductDetail/permissionConsent';
import {
        buildLauncherModel,
  buildAllAppCards,
    buildInstalledPackageCards,
  isAvailableSignedAppPackage,
  isPackageListingInstalled,
  webEmbedAppsOf,
  type LauncherWebEmbedApp,
} from '@/renderer/pages/hub/installedPackageApps';
import type { PackageListing } from '@/common/packages';
import { Message, Modal } from '@arco-design/web-react';
import { ExpandLeft, ExpandRight, Terminal, Message as ChatIcon } from '@icon-park/react';
import { useOptionalAuth } from '@/renderer/hooks/context/AuthContext';
import { Calculator, Code2, Compass, FileText, Package, PanelLeftOpen, PanelRightOpen, Pin, PinOff, Workflow } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { HUB_APPS, HUB_CATEGORIES, type HubAppDefinition, type HubCategoryId } from '../HubHome/catalog';
import { ensureGroupScheduler } from '../HubHome/company/group/groupScheduler';
import { useOpenCompanyAgent } from '../HubHome/company/useCompanyTree';
import { HubRail } from '../HubHome/HubRail';
import { HumanTerminalProvider } from '../HubHome/terminal/HumanTerminalContext';
import { HubSidebar, type HubNavId } from '../HubHome/HubSidebar';
import { DEFAULT_APP_PINS, DEFAULT_NAV_PINS, DEFAULT_PACKAGE_SHORTCUTS, getDefaultAppBaseRoute, normalizeSidebarPins, pinStorageKey, reorderSidebarEntries, toggleSidebarPin } from '../HubHome/sidebarPins';
import { useHubActivity } from '../HubHome/useHubActivity';
import { HubShellContext, type HubRailTarget, type HubShellContextValue } from './hubShellContext';
import { requestActiveTab, requestTabsRefresh } from './browserTabHandoff';
import type { ActiveOpenTarget } from '../HubHome/activeSessionsModel';
import { createSessionActions } from '../HubHome/sessionActions';
import { emitPackageSessionAction } from '@/renderer/pages/hub/packageSessionActions';
import { browserHostClient as browserClient } from '@/common/packages/browserHostClient';
import {
  buildSafeHtmlDocument,
  MAX_HTML_PREVIEW_CHARS,
} from '@/renderer/components/Markdown/htmlPreview/sandboxDocument';
import { webEmbedClient } from '@/common/integrations/webEmbed/webEmbedClient';
import PackageCliMenu from './PackageCliMenu';

const COMPACT_SIDEBAR_MEDIA_QUERY = '(max-width: 839px)';
const COMPACT_HUB_PANELS_MEDIA_QUERY = '(max-width: 1100px)';

// Resizable side panels: [default, min, max] in px.
const SIDER_WIDTH = { def: 232, min: 200, max: 360 } as const;
const RAIL_WIDTH = { def: 300, min: 240, max: 640 } as const;
const COLLAPSED_SIDER_WIDTH = 0;
const WIDTH_STORAGE_KEY = 'tomni.hub.panelWidths';
const CHAT_HIDDEN_STORAGE_KEY = 'tomni.hub.chatHidden';

const readChatHidden = (): boolean => {
  try {
    return window.localStorage.getItem(CHAT_HIDDEN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const clampWidth = (value: number, range: { min: number; max: number }) =>
  Math.min(range.max, Math.max(range.min, Math.round(value)));

const readStoredWidths = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WIDTH_STORAGE_KEY) ?? '{}') as {
      sider?: number;
      rail?: number;
    };
    return {
      sider: clampWidth(Number(parsed.sider) || SIDER_WIDTH.def, SIDER_WIDTH),
      rail: clampWidth(Number(parsed.rail) || RAIL_WIDTH.def, RAIL_WIDTH),
    };
  } catch {
    return { sider: SIDER_WIDTH.def, rail: RAIL_WIDTH.def };
  }
};

const isCompactViewport = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(COMPACT_SIDEBAR_MEDIA_QUERY).matches;

const routeStartsWith = (pathname: string, route: string): boolean =>
  pathname === route || pathname.startsWith(`${route}/`);

/** Primary-nav item owning the current route; null when none (e.g. a package or chat). */
const resolveActiveNavId = (pathname: string): HubNavId | null => {
  if (routeStartsWith(pathname, '/artifacts')) return 'artifacts';
      if (routeStartsWith(pathname, '/guid')) return 'home';
  if (routeStartsWith(pathname, '/realtime')) return 'realtime';
  if (routeStartsWith(pathname, '/company')) return 'company';
  if (routeStartsWith(pathname, '/scheduled')) return 'schedule';
  if (routeStartsWith(pathname, '/store') || routeStartsWith(pathname, '/products')) return 'store';

  if (routeStartsWith(pathname, '/library') || routeStartsWith(pathname, '/file-viewer')) return 'library';
  if (routeStartsWith(pathname, '/notifications')) return 'notifications';
  return null;
};

/** Centre layout variant: Home owns a composer grid, packages a full-bleed frame, the rest scroll. */
const resolveMainVariant = (pathname: string): string => {
  if (routeStartsWith(pathname, '/guid')) return 'hub-main--home';
  if (routeStartsWith(pathname, '/apps')) return 'hub-main--package';
  if (routeStartsWith(pathname, '/company')) return 'hub-main--company';
  return 'hub-main--route';
};

type PinnedPackageApp = {
  id: string;
  packageId: string;
  moduleId: string;
  title: string;
};

type LauncherScope = HubCategoryId | 'all' | null;

/**
 * The one application frame: sidebar, centre, rail and footer. Every
 * authenticated route renders inside the centre, so Store, packages, chat,
 * settings and Home share the same chrome, colours and panel sizes.
 */
const HubShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { t, i18n } = useTranslation();
    const user = useOptionalAuth()?.user;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const layout = useLayoutContext();
  const [launcherScope, setLauncherScope] = useState<LauncherScope>(null);
  // Layout owns the collapse flag when present, so chat pages that auto-collapse
  // the sidebar for a preview keep working; tests render the shell standalone.
  const [localCollapsed, setLocalCollapsed] = useState(isCompactViewport);
  const sidebarCollapsed = layout ? layout.siderCollapsed : localCollapsed;
  const setLayoutCollapsed = layout?.setSiderCollapsed;
  const collapsedRef = useRef(sidebarCollapsed);
  collapsedRef.current = sidebarCollapsed;
  const setSidebarCollapsed = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      const value = typeof next === 'function' ? next(collapsedRef.current) : next;
      if (setLayoutCollapsed) setLayoutCollapsed(value);
      else setLocalCollapsed(value);
    },
    [setLayoutCollapsed]
  );
      const [installedPackages, setInstalledPackages] = useState<PackageListing[]>([]);
  const [packageLibraryReady, setPackageLibraryReady] = useState(false);
    const [navOrder, setNavOrder] = useState<readonly string[]>(DEFAULT_NAV_PINS);
  const [pinnedAppIds, setPinnedAppIds] = useState<readonly string[]>(DEFAULT_APP_PINS);
  useEffect(() => {
    const navIds = ['home', 'artifacts', 'schedule', 'company', 'store', 'realtime', 'social', 'library', 'notifications'];
    const appIds = [...DEFAULT_APP_PINS, ...installedPackages.flatMap((entry) =>
      entry.installedManifest?.modules.map((module) => `${entry.installedManifest?.id}:${module.id}`) ?? [])];
    const read = (kind: 'nav' | 'apps'): unknown => {
      try { return JSON.parse(window.localStorage.getItem(pinStorageKey(kind, user?.id)) ?? 'null') as unknown; }
      catch { return null; }
    };
        setNavOrder(reorderSidebarEntries(navIds, read('nav')));
    setPinnedAppIds(normalizeSidebarPins(read('apps'), [...new Set(appIds)], DEFAULT_APP_PINS));
  }, [user?.id, installedPackages]);
    const moveNav = useCallback((source: string, target: string): void => {
    setNavOrder((current) => {
      const updated = reorderSidebarEntries(current, source, target);
      try { window.localStorage.setItem(pinStorageKey('nav', user?.id), JSON.stringify(updated)); } catch { /* storage optional */ }
      return updated;
    });
  }, [user?.id]);
  const [webEmbedApps, setWebEmbedApps] = useState<readonly LauncherWebEmbedApp[]>([]);
  const [panelWidths, setPanelWidths] = useState(readStoredWidths);
  const [railCollapsed, setRailCollapsed] = useState(false);
  // Hiding keeps the composer mounted so the draft survives while the centre stays visible.
    const [chatHidden, setChatHidden] = useState(readChatHidden);
  const [terminalMode, setTerminalMode] = useState(false);
  const [railTarget, setRailTarget] = useState<HubRailTarget>();
  // Only a hover that opened a panel may close it again; a manual open must stick.
  const siderPeekRef = useRef(false);
  const railPeekRef = useRef(false);
  const shellRef = useRef<HTMLDivElement>(null);

  // The panel toggles live in the titlebar, which is outside this component.
  useEffect(() => {
    const toggle = () => {
      siderPeekRef.current = false;
      setSidebarCollapsed((current) => !current);
    };
    window.addEventListener('tomni-hub-toggle-sidebar', toggle);
    return () => {
      window.removeEventListener('tomni-hub-toggle-sidebar', toggle);
    };
  }, [setSidebarCollapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAT_HIDDEN_STORAGE_KEY, chatHidden ? '1' : '0');
    } catch {
      // storage unavailable: the choice just does not persist
    }
  }, [chatHidden]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'h') {
        event.preventDefault();
        setChatHidden((current) => !current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Edge peek: a collapsed panel slides out only when the pointer sits on the frame
  // edge itself, and retracts as soon as the pointer leaves it.
  const openSiderPeek = useCallback(() => {
    siderPeekRef.current = true;
    setSidebarCollapsed(false);
  }, [setSidebarCollapsed]);
  const closeSiderPeek = useCallback(() => {
    if (!siderPeekRef.current) return;
    siderPeekRef.current = false;
    setSidebarCollapsed(true);
  }, [setSidebarCollapsed]);
  const openRailPeek = useCallback(() => {
    railPeekRef.current = true;
    setRailCollapsed(false);
  }, []);
    const closeRailPeek = useCallback(() => {
    if (!railPeekRef.current) return;
    railPeekRef.current = false;
    setRailCollapsed(true);
  }, []);

  // Selecting a Home monitor tile is an explicit request to inspect it.
  useEffect(() => {
    if (!routeStartsWith(pathname, '/guid') || !railTarget?.activityId) return;
    railPeekRef.current = false;
    setRailCollapsed(false);
  }, [pathname, railTarget?.activityId]);

  const railWidth = railCollapsed ? 0 : panelWidths.rail;

  // The titlebar lives outside the shell, so the widths are published as root CSS variables.
  const siderWidth = sidebarCollapsed ? COLLAPSED_SIDER_WIDTH : panelWidths.sider;
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--hub-sider-w', `${siderWidth}px`);
    root.style.setProperty('--hub-rail-w', `${railWidth}px`);
    return () => {
      root.style.removeProperty('--hub-sider-w');
      root.style.removeProperty('--hub-rail-w');
    };
  }, [siderWidth, railWidth]);

  // A native WebContentsView (Browser package) floats outside the DOM; moving the
  // centre without resizing its host would leave the view at stale coordinates.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return () => window.cancelAnimationFrame(frame);
  }, [siderWidth, railWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, JSON.stringify(panelWidths));
    } catch {
      // storage unavailable: widths just don't persist
    }
  }, [panelWidths]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const compactViewport = window.matchMedia(COMPACT_SIDEBAR_MEDIA_QUERY);
    const compactHubPanels = window.matchMedia(COMPACT_HUB_PANELS_MEDIA_QUERY);
    const applyCompactState = (): void => {
      setSidebarCollapsed(compactHubPanels.matches || compactViewport.matches);
      setRailCollapsed(compactHubPanels.matches);
    };
    applyCompactState();
    compactViewport.addEventListener('change', applyCompactState);
    compactHubPanels.addEventListener('change', applyCompactState);
    return () => {
      compactViewport.removeEventListener('change', applyCompactState);
      compactHubPanels.removeEventListener('change', applyCompactState);
    };
  }, [setSidebarCollapsed]);

  const startResize = useCallback((side: 'sider' | 'rail') => {
    return (event: React.PointerEvent<HTMLDivElement>) => {
      const shell = shellRef.current;
      if (!shell) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      const rect = shell.getBoundingClientRect();
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      const onMove = (moveEvent: PointerEvent) => {
        setPanelWidths((current) =>
          side === 'sider'
            ? { ...current, sider: clampWidth(moveEvent.clientX - rect.left, SIDER_WIDTH) }
            : { ...current, rail: clampWidth(rect.right - moveEvent.clientX, RAIL_WIDTH) }
        );
      };
      const onUp = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    };
  }, []);

  // Every agent turn, team, scheduled run and app process running anywhere, pushed live from Main.
  const activity = useHubActivity();
  const runningAgentCount = activity.items.filter((item) => item.kind === 'agent' && item.status === 'running').length;
  const attentionCount = activity.items.filter(
    (item) => item.status === 'needs_input' || item.status === 'error'
  ).length;
  const liveConversationStatus = useMemo(
    () =>
      new Map(
        activity.items.filter((item) => item.kind === 'agent').map((item) => [item.sourceId, item.status] as const)
      ),
    [activity.items]
  );

    const packageLoadEpoch = useRef(0);
  const loadInstalledPackages = useCallback(() => {
    const epoch = ++packageLoadEpoch.current;
    void packageClient
      .list({ installedOnly: true })
      .then(async (items): Promise<void> => {
                if (epoch !== packageLoadEpoch.current) return;
        const installed = items.filter((item) => isPackageListingInstalled(item));
        setInstalledPackages(installed);
        const connections = window.electronAPI?.packageConnections;
        if (!connections) {
          setWebEmbedApps([]);
          return;
        }
                const packageIds = installed.flatMap((item) =>
          item.installedManifest ? [item.installedManifest.id] : []
        );
        const apps = (
          await Promise.all(
            packageIds.map((packageId) =>
              connections.list({ packageId }).then((result) =>
                result.ok ? webEmbedAppsOf(packageId, result.data) : []
              )
            )
          )
        ).flat();
                if (epoch === packageLoadEpoch.current) setWebEmbedApps(apps);
      })
      .catch(() => {
        if (epoch !== packageLoadEpoch.current) return;
        setInstalledPackages([]);
        setWebEmbedApps([]);
      })
      .finally(() => setPackageLibraryReady(true));
  }, []);
    // Reconnect/return to the Hub replays account-scoped package mutations after outages.
  useEffect(() => {
    if (!user?.id) return;
    const replay = (): void => {
      void flushCloudPackageOutbox(user.id).catch((): undefined => undefined);
    };
    window.addEventListener('online', replay);
    window.addEventListener('focus', replay);
    replay();
    return () => {
      window.removeEventListener('online', replay);
      window.removeEventListener('focus', replay);
    };
  }, [user?.id]);

  // The Store lives inside this shell now, so an install or removal must refresh

  // the pinned apps without a reload: re-read on every route change.
  useEffect(() => {
    loadInstalledPackages();
  }, [loadInstalledPackages, pathname]);
      useEffect(() => {
    const warnOnCloudFailure = (): void => {
      Message.warning(t('guid.hubHome.layout.cloudSyncFailed', {
        defaultValue: 'Ứng dụng đã thay đổi trên máy, nhưng chưa đồng bộ danh sách với Supabase. Hãy kiểm tra kết nối và thử lại sau.',
      }));
    };
    window.addEventListener('tomni-package-cloud-sync-failed', warnOnCloudFailure);
    return () => window.removeEventListener('tomni-package-cloud-sync-failed', warnOnCloudFailure);
  }, [t]);

  useEffect(() => {
    window.addEventListener('tomni-packages-changed', loadInstalledPackages);
    window.addEventListener('focus', loadInstalledPackages);
    const refreshWhenVisible = (): void => { if (document.visibilityState === 'visible') loadInstalledPackages(); };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    // Main also emits this for local Repo-to-Package imports and package removals.
        const off = packageClient.onContributionsChanged?.(() => loadInstalledPackages()) ?? (() => undefined);
    return () => {
      packageLoadEpoch.current++;
      off();
      window.removeEventListener('tomni-packages-changed', loadInstalledPackages);
      window.removeEventListener('focus', loadInstalledPackages);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loadInstalledPackages]);

  // Store and All Apps share one installed-state predicate and one launcher model.
  const launcherModel = useMemo(
    () => buildLauncherModel(HUB_APPS, installedPackages, getRunnablePackageModules, webEmbedApps),
    [installedPackages, webEmbedApps]
  );
      // Browser, IDE and every other app must be package-owned; never expose static routes
  // as installed apps in the launcher. Core route support is not an installed artifact.
  const availableApps = launcherModel.builtInApps;
    const pinnedPackageApps: readonly PinnedPackageApp[] = useMemo(() => {
    const installedById = new Map(launcherModel.pinnedPackageApps.map((app) => [app.id, app]));
    const defaults = DEFAULT_PACKAGE_SHORTCUTS.map((app) => ({
      ...app,
            installed: installedById.has(app.id),
      baseRoute: getDefaultAppBaseRoute(app.packageId),
      ...(installedById.has(app.id) ? installedById.get(app.id) : {}),
    }));
    return [...defaults, ...launcherModel.pinnedPackageApps.filter((app) =>
      !DEFAULT_PACKAGE_SHORTCUTS.some((defaultApp) => defaultApp.id === app.id))];
  }, [launcherModel.pinnedPackageApps]);
  // Optional apps are package-owned. The pinned sidebar must only contain
  // installed package surfaces; static routes would escape the shell centre.
      const pinnedApps = useMemo<readonly HubAppDefinition[]>(() => [], []);
  const displayPackageApps = useMemo(() => pinnedPackageApps.filter((app) => pinnedAppIds.includes(app.id)), [pinnedPackageApps, pinnedAppIds]);
      // Home, Git, Chat, Company and Manager routes are not downloaded applications.
  // The launcher mirrors every default-pinned package module; the sidebar itself supplies its scroll viewport.
    const launcherInstalledPackages = useMemo(() =>
        buildAllAppCards(DEFAULT_PACKAGE_SHORTCUTS, buildInstalledPackageCards(installedPackages, getRunnablePackageModules)),
    [installedPackages]);
    const totalApps = launcherInstalledPackages.length;
  const toggleAppPin = useCallback((id: string): void => {
    const selectable = [...DEFAULT_APP_PINS, ...launcherModel.pinnedPackageApps.map((app) => app.id)];
    setPinnedAppIds((current) => {
      const updated = toggleSidebarPin(current, id, selectable);
      try { window.localStorage.setItem(pinStorageKey('apps', user?.id), JSON.stringify(updated)); } catch { /* storage optional */ }
      return updated;
    });
  }, [launcherModel.pinnedPackageApps, user?.id]);
  const launcherTitle =
    launcherScope === 'all'
      ? t('guid.hubHome.allApps')
      : t(HUB_CATEGORIES.find((category) => category.id === launcherScope)?.titleKey ?? 'guid.hubHome.appsTitle');

  const onNavigate = useCallback(
    (path: string, state?: Record<string, unknown>) => {
      void navigate(path, state ? { state } : undefined);
    },
    [navigate]
  );

  const openApp = useCallback(
    (app: HubAppDefinition) => {
      if (app.id === 'chat') {
        setTerminalMode(false);
        if (!routeStartsWith(pathname, '/guid')) onNavigate('/guid');
        window.dispatchEvent(new CustomEvent('tomni-hub-focus-composer'));
        return;
      }
      onNavigate(app.path, app.state);
    },
    [onNavigate, pathname]
  );

    const openPackageSurface = useCallback(
    (surface: { packageId: string; moduleId: string }) => {
      onNavigate(`/apps/${encodeURIComponent(surface.packageId)}/${encodeURIComponent(surface.moduleId)}`);
    },
    [onNavigate]
  );

  /** A launch request must not silently redirect to Store or claim a missing package is installed. */
  const openLauncherPackage = useCallback((app: { packageId: string; title: string }): void => {
        const installed = installedPackages.find((item) => item.installedManifest?.id === app.packageId);
    if (installed) {
      if (!installed.enabled || installed.revoked || installed.installedTrust === 'unsigned-revoked') {
        Message.warning(t('guid.hubHome.layout.packageNotEnabled', {
          name: app.title,
          defaultValue: `${app.title} đã bị tắt hoặc thu hồi; cần bật lại trong quản lý ứng dụng.`,
        }));
        return;
      }
      const module = getFirstRunnablePackageModule(installed);
      if (module) openPackageSurface({ packageId: app.packageId, moduleId: module.id });
      else Message.warning(t('guid.hubHome.layout.packageNoSurface', {
        name: app.title,
        defaultValue: `${app.title} không cung cấp giao diện để mở.`,
      }));
            return;
    }
    // Legacy base routes are a temporary fallback, never a substitute for an installed signed app.
    const baseRoute = getDefaultAppBaseRoute(app.packageId);
    if (baseRoute) {
      onNavigate(baseRoute);
      return;
    }
        // Check fresh signed Store releases when the user opens an uninstalled app.
    // A temporary catalog network failure may use the last verified local catalog;
    // Main still enforces exact artifact signature, permissions and host compatibility.
    void packageClient.refresh().catch(() => packageClient.list()).then((catalog) => {
      const candidate = catalog.find((entry) => entry.manifest.id === app.packageId);
            if (!isAvailableSignedAppPackage(candidate)) {
        Message.warning(t('guid.hubHome.layout.noCompatibleRelease', { name: app.title }));
        return;
      }
      Modal.confirm({
      title: t('guid.hubHome.layout.installAndOpenTitle', { name: app.title, defaultValue: `Cài đặt ${app.title}?` }),
      content: t('guid.hubHome.layout.installAndOpenDescription', {
        defaultValue: 'Ứng dụng chưa được cài. Bạn có muốn tải package đã ký và mở ứng dụng sau khi cài đặt không?',
      }),
      okText: t('guid.hubHome.layout.installAndOpen', { defaultValue: 'Cài và mở' }),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          const receipt = await requestPackagePermissionUpdateConsent(app.packageId, t);
          if (receipt === null) return;
          const installedPackage = await packageClient.install(app.packageId, receipt ?? undefined);
          const module = getFirstRunnablePackageModule(installedPackage);
          if (!module) throw new Error('PACKAGE_NO_RUNNABLE_SURFACE');
          openPackageSurface({ packageId: app.packageId, moduleId: module.id });
        } catch (error) {
          Message.error(t('guid.hubHome.layout.installAndOpenFailed', {
            name: app.title,
            reason: error instanceof Error ? error.message : 'INSTALL_FAILED',
            defaultValue: `Không thể cài và mở ${app.title}: ${error instanceof Error ? error.message : 'INSTALL_FAILED'}`,
          }));
        }
            },
      });
    }).catch((error: unknown) => {
      Message.error(t('guid.hubHome.layout.catalogReadFailed', {
        reason: error instanceof Error ? error.message : 'CATALOG_UNAVAILABLE',
      }));
    });
  }, [installedPackages, onNavigate, openPackageSurface, t]);

  const openWebEmbedApp = useCallback(
    (app: LauncherWebEmbedApp) => {
      void webEmbedClient.openApp({ packageId: app.packageId, connectionId: app.connectionId }).then((result) => {
                if (result.ok !== false) return;
        Message.error(
          t(`guid.hubHome.webEmbedError.${result.error}`, { defaultValue: t('guid.hubHome.webEmbedError.UNAVAILABLE') })
        );
      });
    },
    [t]
  );

  // A session that cannot be resolved (app uninstalled, no runnable module) simply does nothing.
  const openSession = useCallback(
    (target: ActiveOpenTarget) => {
      setLauncherScope(null);
      if (target.kind === 'conversation') {
        onNavigate(`/conversation/${target.id}`);
        return;
      }
      if (target.appId === 'com.tomni.browser') {
        requestActiveTab(target.sessionId);
        onNavigate('/browser');
        return;
      }
      if (target.appId === 'terminal') {
        onNavigate('/ide');
        return;
      }
      const listing = installedPackages.find((item) => item.installedManifest?.id === target.appId);
      const packageModule = listing ? getFirstRunnablePackageModule(listing) : undefined;
      if (!packageModule) return;
      onNavigate(`/apps/${encodeURIComponent(target.appId)}/${encodeURIComponent(packageModule.id)}`, {
        focusSession: target.sessionId,
      });
    },
    [installedPackages, onNavigate]
  );

  const { createSession, closeSession } = useMemo(
    () =>
      createSessionActions({
        openBrowserTab: (url) => browserClient.openTab({ url }),
        closeBrowserTab: async (id) => {
          await browserClient.destroyTab({ id });
          requestTabsRefresh();
        },
        focusBrowserTab: requestActiveTab,
        navigate: (path) => onNavigate(path),
        emit: emitPackageSessionAction,
      }),
    [onNavigate]
  );

  const appTitles = useMemo<Readonly<Record<string, string>>>(
    () =>
      Object.fromEntries(
        installedPackages.flatMap((item) =>
          item.installedManifest ? [[item.installedManifest.id, item.installedManifest.name]] : []
        )
      ),
    [installedPackages]
  );

  const openCompany = useCallback(() => {
    setLauncherScope(null);
    onNavigate('/company', { companyFocus: { nonce: Date.now() } });
  }, [onNavigate]);

  const openCompanyGroup = useCallback(
    (companyId: string, groupId?: string) => {
      setLauncherScope(null);
      onNavigate('/company', { companyFocus: { companyId, groupId, nonce: Date.now() } });
    },
    [onNavigate]
  );

  const openCompanyAgentChat = useOpenCompanyAgent(i18n.language);
  // Group calendars fire while the app is open, wherever the user is.
  useEffect(() => ensureGroupScheduler(i18n.language), [i18n.language]);
  const openCompanyAgent = useCallback(
    (companyId: string, roleId: string) => {
      void openCompanyAgentChat(companyId, roleId).then((conversationId) => {
        if (conversationId) onNavigate(`/conversation/${conversationId}`);
        else Message.error(t('company.center.chat.openError'));
      });
    },
    [onNavigate, openCompanyAgentChat, t]
  );

  const openPackage = useCallback(
    (item: PackageListing) => {
      const packageModule = getFirstRunnablePackageModule(item);
      const manifest = item.installedManifest;
      if (!packageModule || !manifest) return;
      openPackageSurface({ packageId: manifest.id, moduleId: packageModule.id });
    },
    [openPackageSurface]
  );

  const openTerminal = useCallback(() => {
    const terminalPackage = installedPackages.find((item) => item.manifest.id.toLowerCase().includes('terminal'));
    if (terminalPackage) {
      openPackage(terminalPackage);
      return;
    }
    onNavigate('/store');
  }, [installedPackages, onNavigate, openPackage]);

  const contextValue = useMemo<HubShellContextValue>(
    () => ({ activity, availableApps, openApp, openTerminal, terminalMode, setTerminalMode, setRailTarget, openCompanyAgent }),
    [activity, availableApps, openApp, openTerminal, terminalMode, openCompanyAgent]
  );

  const defaultFocusDirectory = useCallback((path: string) => onNavigate('/guid', { workspace: path }), [onNavigate]);

  return (
    <HubShellContext.Provider value={contextValue}>
      <HumanTerminalProvider>
      <div
        ref={shellRef}
        className={`hub-shell ${sidebarCollapsed ? 'hub-shell-collapsed' : ''} ${railCollapsed ? 'hub-shell-rail-collapsed' : ''} ${chatHidden ? 'hub-shell-chat-hidden' : ''}`}
        data-sidebar-collapsed={sidebarCollapsed}
        data-testid='hub-home-shell'
      >
        <HubSidebar
          onNavigate={onNavigate}
          pinnedApps={pinnedApps}
                    pinnedPackageApps={displayPackageApps}
                    navOrder={navOrder}
          onMoveNav={moveNav}
                    pinnedAppIds={pinnedAppIds}
          onToggleAppPin={toggleAppPin}
          totalApps={totalApps}
          onOpenApp={openApp}
                    onOpenPackageApp={openLauncherPackage}
          onOpenHome={() => undefined}
          onOpenCompany={openCompany}
          onOpenCompanyGroup={openCompanyGroup}
          onOpenCompanyAgent={openCompanyAgent}
          activeNavId={resolveActiveNavId(pathname)}
          onOpenLauncher={() => setLauncherScope('all')}
          liveStatus={liveConversationStatus}
          runningAgentCount={runningAgentCount}
          onPeekLeave={closeSiderPeek}
          onOpenSession={openSession}
          onCreateSession={(appId) => void createSession(appId)}
          onCloseSession={(appId, sessionId) => void closeSession(appId, sessionId)}
          appTitles={appTitles}
        />

        <main className={`hub-main ${resolveMainVariant(pathname)}`} data-testid='hub-shell-center'>
          {children}
        </main>
        <HubRail
          terminalMode={terminalMode && routeStartsWith(pathname, '/guid')}
           isRealtime={routeStartsWith(pathname, '/realtime')}
          workspaceName={railTarget?.workspaceName}
          agentName={railTarget?.agentName ?? ''}
          workspace={railTarget?.workspace}
                    conversationId={railTarget?.conversationId}
                    activityItem={activity.items.find((item) => item.id === railTarget?.activityId)}
          activityItems={activity.items}
          onOpenActivity={(item) => { if (item.route) onNavigate(item.route); }}
          onOpenHumanTerminal={() => {
            setTerminalMode(true);
            railPeekRef.current = false;
            onNavigate('/guid');
          }}
          onFocusDirectory={railTarget?.onFocusDirectory ?? defaultFocusDirectory}
          onPeekLeave={closeRailPeek}
          enableHomePreview={routeStartsWith(pathname, '/guid')}
          onPreviewOpened={() => {
            railPeekRef.current = false;
            setRailCollapsed(false);
          }}
          onOpenPreviewInBrowser={async (html) => {
            if (html.length > MAX_HTML_PREVIEW_CHARS) throw new Error('HTML preview exceeds safe size limit');
            const safeHtml = buildSafeHtmlDocument(html);
            const tab = await browserClient.openTab({
              url: `data:text/html;charset=utf-8,${encodeURIComponent(safeHtml)}`,
            });
            requestActiveTab(tab.id);
            onNavigate('/browser');
          }}
        />

        {!sidebarCollapsed && (
          <div
            className='hub-resizer hub-resizer--sider'
            role='separator'
            aria-orientation='vertical'
            data-testid='hub-resizer-sider'
            onPointerDown={startResize('sider')}
          />
        )}
        <div
          className='hub-resizer hub-resizer--rail'
          role='separator'
          aria-orientation='vertical'
          data-testid='hub-resizer-rail'
          onPointerDown={startResize('rail')}
        />

        {sidebarCollapsed && (
          <button
            type='button'
            className='hub-peek hub-peek--sider'
            data-testid='hub-peek-sider'
            aria-label={t('common.expandMore', { defaultValue: 'Expand sidebar' })}
            onMouseEnter={openSiderPeek}
            onClick={openSiderPeek}
          >
            <PanelLeftOpen size={16} strokeWidth={1.75} aria-hidden='true' />
          </button>
        )}
        {railCollapsed && (
          <button
            type='button'
            className='hub-peek hub-peek--rail'
            data-testid='hub-peek-rail'
            aria-label={t('guid.hubHome.layout.sidePanelOpen', { defaultValue: 'Open side panel' })}
            onMouseEnter={openRailPeek}
            onClick={openRailPeek}
          >
            <PanelRightOpen size={16} strokeWidth={1.75} aria-hidden='true' />
          </button>
        )}

        <footer className='hub-statusbar'>
          {attentionCount > 0 && (
            <span className='hub-sb-item' data-testid='hub-footer-attention'>
              <span className='hub-dot hub-dot-y' />
              {t('guid.hubHome.live.attention', { count: attentionCount })}
            </span>
          )}
          <FeedbackButton module='hub-home' className='hub-sb-btn' />
          <span className='hub-sb-ver'>{t('guid.hubHome.shell.version')}</span>
          <span className='hub-sb-right'>
            <button
              type='button'
              className={`hub-sb-btn hub-sb-chat-toggle ${chatHidden || (terminalMode && routeStartsWith(pathname, '/guid')) ? '' : 'hub-sb-active'}`}
              title={t(chatHidden ? 'guid.hubHome.layout.chatHintShow' : 'guid.hubHome.layout.chatHintHide')}
              aria-pressed={!chatHidden && !(terminalMode && routeStartsWith(pathname, '/guid'))}
              aria-keyshortcuts='Control+Shift+H'
              data-testid='hub-footer-chat-toggle'
              onClick={() => {
                 if (routeStartsWith(pathname, '/guid')) { setTerminalMode(false); setChatHidden(false); }
                 else setChatHidden((current) => !current);
               }}
            >
              <ChatIcon theme='outline' size={12} fill='currentColor' />
              {t('guid.hubHome.layout.chat')}
            </button>
            <button
              type='button'
              className={`hub-sb-btn hub-sb-terminal ${terminalMode && routeStartsWith(pathname, '/guid') ? 'hub-sb-active' : ''}`}
              title={t('guid.hubHome.layout.terminalHint')}
              data-testid='hub-footer-terminal'
              aria-pressed={terminalMode && routeStartsWith(pathname, '/guid')}

              onClick={() => {
                 if (routeStartsWith(pathname, '/guid')) setTerminalMode(true);
                 else { setTerminalMode(true); onNavigate('/guid'); }
               }}
            >
              <Terminal theme='outline' size={12} fill='currentColor' />
              {t('guid.hubHome.layout.terminal')}
            </button>
            <PackageCliMenu
              installedPackages={installedPackages}
              workspace={railTarget?.workspace}
              onOpened={openTerminal}
            />
            <button
              type='button'
              className={`hub-sb-btn hub-sb-rail-toggle ${railCollapsed ? '' : 'hub-sb-active'}`}
              title={t(railCollapsed ? 'guid.hubHome.layout.sidePanelOpen' : 'guid.hubHome.layout.sidePanelClose', {
                defaultValue: railCollapsed ? 'Mở bảng phụ' : 'Đóng bảng phụ',
              })}
              aria-expanded={!railCollapsed}
              data-testid='hub-footer-rail-toggle'
              onClick={() => {
                railPeekRef.current = false;
                setRailCollapsed((current) => !current);
              }}
            >
              {railCollapsed ? (
                <ExpandLeft theme='outline' size={12} fill='currentColor' />
              ) : (
                <ExpandRight theme='outline' size={12} fill='currentColor' />
              )}
              {t('guid.hubHome.layout.sidePanel', { defaultValue: 'Bảng phụ' })}
            </button>
          </span>
        </footer>

                <PackageRestoreOnboarding userId={user?.id} ready={packageLibraryReady} />
        <Modal
          visible={launcherScope !== null}
          title={launcherTitle}
          footer={null}
          unmountOnExit
          maskClosable
          className='hub-launcher'
          onCancel={() => setLauncherScope(null)}
        >
                    <div className='hub-launcher-grid' data-testid='hub-app-launcher'>
            {launcherInstalledPackages.map((app) => {
              const pinId = app.moduleId ? `${app.packageId}:${app.moduleId}` : undefined;
                            const embeddedApp = app.enabled
                ? launcherModel.webEmbedApps.find((item) => item.packageId === app.packageId)
                : undefined;
              const openInstalledApp = (): void => {
                setLauncherScope(null);
                                if (embeddedApp && app.installed && !app.moduleId) openWebEmbedApp(embeddedApp);
                else openLauncherPackage(app);
              };
              return (
                <div className='hub-launcher-app' key={app.packageId} data-testid={`hub-installed-package-${app.packageId}`}>
                  <button type='button' className='hub-launcher-app-open'
                    aria-label={app.title} onClick={openInstalledApp}>
                    <span className='hub-launcher-app-icon' data-testid={`hub-package-app-icon-${app.packageId}`}>
                      {app.packageId === 'com.tomni.browser' ? <Compass size={26} />
                        : app.packageId === 'com.tomni.ide' ? <Code2 size={26} />
                        : app.packageId === 'com.tomni.document-studio' ? <FileText size={26} />
                        : app.packageId === 'com.tomni.automation-studio' ? <Workflow size={26} />
                        : app.packageId === 'com.tomni.calculator' ? <Calculator size={26} /> : <Package size={26} />}
                    </span>
                    <span className='hub-launcher-app-label'>{app.title}</span>
                                        <span className='hub-launcher-app-meta'>
                      {app.revoked ? t('guid.hubHome.layout.revokedPackage', { defaultValue: 'Package đã thu hồi' })


                                                                           : !app.installed ? t('guid.hubHome.layout.notInstalledPackage', { defaultValue: 'Chưa cài · chọn để tải và mở' })
                         : !app.enabled ? t('guid.hubHome.layout.disabledPackage', { defaultValue: 'Package đang tắt' })
                          : app.localBuilt ? t('guid.hubHome.layout.localPackage', { defaultValue: 'Tạo trên máy này' })
                            : t('guid.hubHome.layout.installedPackage', { defaultValue: 'Đã cài trên máy' })}
                    </span>
                  </button>
                  {pinId && app.pinnable && (
                    <button type='button' className='hub-launcher-app-pin'
                      data-testid={`hub-pin-app-${pinId}`}
                      disabled={pinnedAppIds.includes(pinId) && pinnedAppIds.length <= 3}
                      aria-label={`${pinnedAppIds.includes(pinId) ? t('guid.hubHome.layout.unpin', { defaultValue: 'Bỏ ghim' }) : t('guid.hubHome.layout.pin', { defaultValue: 'Ghim' })} ${app.title}`}
                      aria-pressed={pinnedAppIds.includes(pinId)}
                      onClick={() => toggleAppPin(pinId)}>
                      {pinnedAppIds.includes(pinId) ? <Pin size={14} /> : <PinOff size={14} />}
                    </button>
                  )}
                                    {(

                   <button type='button' className='hub-launcher-app-manage'
                    data-testid={`hub-manage-package-${app.packageId}`}
                    onClick={() => { setLauncherScope(null); onNavigate(`/store/package/${encodeURIComponent(app.packageId)}`); }}>
                    {t('guid.hubHome.layout.managePackage', { defaultValue: 'Quản lý' })}
                  </button>
                  )}
                </div>
              );
            })}
            {totalApps === 0 && (
              <p className='hub-launcher-empty'>{t('guid.hubHome.layout.noInstalledPackages', { defaultValue: 'Chưa có ứng dụng nào được cài trên thiết bị.' })}</p>
            )}
          </div>
        </Modal>
            </div>
      </HumanTerminalProvider>
    </HubShellContext.Provider>
  );
};

export default HubShell;
