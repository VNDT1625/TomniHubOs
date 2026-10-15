import { ipcBridge } from '@/common';
import { hubActivityChannels } from '@/common/types/agent/hubActivity';
import { useConversationHistoryContext } from '@/renderer/hooks/context/ConversationHistoryContext';
import { buildConversationExportJson, joinFilePath, sanitizeFileName } from '@/renderer/utils/chat/conversationExport';
import { emitter } from '@/renderer/utils/emitter';
import { Input, Message, Modal } from '@arco-design/web-react';
import { getActivityTime } from '@/renderer/utils/chat/timeline';
import { getWorkspaceDisplayName } from '@/renderer/utils/workspace/workspace';
import { AllApplication, BookOpen, BuildingTwo, FolderOpen, Home, Lightning, Picture, Remind, Schedule, ShareTwo } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Calculator, ChevronDown, ChevronRight, Code2, Compass, FileText, Package, Pin, Workflow } from 'lucide-react';
import type { RoleNode } from '@process/company/companyOrchestrator';
import type { HubActivityStatus } from '@/common/types/agent/hubActivity';
import type { HubAppDefinition } from './catalog';
import { useCompanyTree } from './company/useCompanyTree';
import { ActiveSessions } from './ActiveSessions';
import { buildActiveApps, type ActiveOpenTarget } from './activeSessionsModel';
import { resizeSidebarSections, type SidebarSectionHeights, type SidebarSplitter } from './sidebarSectionSizing';
import { MIN_SIDEBAR_PINS, orderSidebarEntries } from './sidebarPins';
import { useDeleteChat, useDeleteChats } from './useDeleteChat';
import { useLiveSessions } from './useLiveSessions';

type PinnedPackageApp = {
  id: string;
  packageId: string;
  moduleId: string;
    title: string;
    installed?: boolean;
  baseRoute?: string;
};

type HubSidebarProps = {
  onNavigate: (path: string, state?: Record<string, unknown>) => void;
  pinnedApps: readonly HubAppDefinition[];
    pinnedPackageApps: readonly PinnedPackageApp[];
    navOrder: readonly string[];
  onMoveNav: (source: string, target: string) => void;
    pinnedAppIds: readonly string[];
  onToggleAppPin: (id: string) => void;
  totalApps: number;
  runningAgentCount?: number;
  onOpenApp: (app: HubAppDefinition) => void;
  onOpenPackageApp: (app: PinnedPackageApp) => void;
  onOpenHome: () => void;
  onOpenCompany: () => void;
  /** Open the group chat of a company (or of one of its sub-groups). */
  onOpenCompanyGroup: (companyId: string, groupId?: string) => void;
  /** Open the private chat with one agent of a company. */
  onOpenCompanyAgent: (companyId: string, roleId: string) => void;
  /** Which primary nav item is highlighted; null highlights none (e.g. a package surface owns the centre). */
  activeNavId?: HubNavId | null;
  onOpenLauncher: () => void;
  /** Live status of conversations that are running or just finished, keyed by conversation id. */
  liveStatus?: ReadonlyMap<string, HubActivityStatus>;
  /** Fired when the pointer leaves an edge-hovered panel so the shell can retract it. */
  onPeekLeave?: () => void;
  /** Open one session listed under Active (a chat, or a tab/session an app reported). */
  onOpenSession: (target: ActiveOpenTarget) => void;
  /** Add a session to an app listed under Active ("+"). */
  onCreateSession?: (appId: string) => void;
  /** Close one session listed under Active ("x"). */
  onCloseSession?: (appId: string, sessionId: string) => void;
  /** Display names for package apps, keyed by package id. */
  appTitles?: Readonly<Record<string, string>>;
};

const NAV = [
  { id: 'home', labelKey: 'guid.hubHome.shell.nav.home', path: '/guid', Icon: Home },
  { id: 'artifacts', labelKey: 'guid.hubHome.shell.nav.artifacts', path: '/artifacts', Icon: Picture },
  { id: 'schedule', labelKey: 'guid.hubHome.shell.nav.schedule', path: '/scheduled', Icon: Schedule },
  { id: 'company', labelKey: 'guid.hubHome.shell.nav.company', path: '/company', Icon: BuildingTwo },
  { id: 'store', labelKey: 'guid.hubHome.shell.store', path: '/store', Icon: AllApplication },
  { id: 'realtime', labelKey: 'guid.hubHome.shell.nav.realtime', path: '/realtime', Icon: Lightning },
  { id: 'social', labelKey: 'guid.hubHome.shell.nav.social', path: '/social', Icon: ShareTwo },
  { id: 'library', labelKey: 'guid.hubHome.shell.nav.library', path: '/library', Icon: BookOpen },
  { id: 'notifications', labelKey: 'common.notificationHub.title', path: '/notifications', Icon: Remind },
] as const;

/** Primary navigation entries of the Hub shell sidebar. */
export type HubNavId = (typeof NAV)[number]['id'];

type SidebarMode = 'workspace' | 'company';
const SIDEBAR_MODE_STORAGE_KEY = 'tomni.hub.sidebarMode';
const readSidebarMode = (): SidebarMode => {
  try {
    return window.localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY) === 'company' ? 'company' : 'workspace';
  } catch {
    return 'workspace';
  }
};

/** Active rows re-evaluate this often so an idle session turns grey without any new event. */
const ACTIVE_CLOCK_MS = 30_000;
const MIN_TOMNY_SECTION_HEIGHT = 64 + MIN_SIDEBAR_PINS * 32;
const MIN_APPS_SECTION_HEIGHT = 62 + MIN_SIDEBAR_PINS * 32;
const MIN_WORKSPACES_SECTION_HEIGHT = 160;
const SECTION_MINIMUMS: SidebarSectionHeights = {
  tomny: MIN_TOMNY_SECTION_HEIGHT,
  apps: MIN_APPS_SECTION_HEIGHT,
  workspaces: MIN_WORKSPACES_SECTION_HEIGHT,
};

const APP_ICON: Readonly<Record<string, string>> = {
  chat: 'chat',
  'com.tomni.browser': 'browser',
  terminal: 'terminal',
};
const APP_TITLE_KEY: Readonly<Record<string, string>> = {
  chat: 'guid.hubHome.shell.appChat',
  'com.tomni.browser': 'guid.hubHome.shell.appBrowser',
  terminal: 'guid.hubHome.shell.appTerminal',
};

export const HubSidebar: React.FC<HubSidebarProps> = ({
  onNavigate,
  pinnedApps,
    pinnedPackageApps,
    navOrder,
  onMoveNav,
    pinnedAppIds,
  onToggleAppPin,
  totalApps,
  runningAgentCount = 0,
  onOpenApp,
  onOpenPackageApp,
  onOpenHome,
  onOpenCompany,
  onOpenCompanyGroup,
  onOpenCompanyAgent,
  activeNavId = 'home',
  onOpenLauncher,
  liveStatus,
  onPeekLeave,
  onOpenSession,
  onCreateSession,
  onCloseSession,
  appTitles,
}) => {
  const { t } = useTranslation();
    const { conversations = [] } = useConversationHistoryContext();
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const tomnySectionRef = useRef<HTMLDivElement>(null);
  const appsSectionRef = useRef<HTMLDivElement>(null);
  const workspacesSectionRef = useRef<HTMLDivElement>(null);
    const [sectionHeights, setSectionHeights] = useState<SidebarSectionHeights | undefined>();
    const pinnedNavCount = NAV.length;
  const pinnedAppCount = pinnedAppIds.length;
  const draggingNav = useRef<string | null>(null);
  const minimums = useMemo<SidebarSectionHeights>(() => ({
    ...SECTION_MINIMUMS,
        tomny: 38 + MIN_SIDEBAR_PINS * 32,
    // All pinned app rows plus the launcher must remain visible.
    apps: 30 + (pinnedAppCount + 1) * 32,
  }), [pinnedAppCount, pinnedNavCount]);
  const maximums = useMemo(() => ({
        tomny: 38 + pinnedNavCount * 32,
    apps: 30 + (pinnedAppCount + 1) * 32,
  }), [pinnedAppCount, pinnedNavCount]);
    const orderedNav = useMemo(() => orderSidebarEntries(NAV, navOrder), [navOrder]);
  const orderedApps = useMemo(() => orderSidebarEntries([
    ...pinnedApps.map((app) => ({ kind: 'built-in' as const, id: app.id, app })),
    ...pinnedPackageApps.map((app) => ({ kind: 'package' as const, id: app.id, app })),
  ], pinnedAppIds), [pinnedApps, pinnedPackageApps, pinnedAppIds]);
  const [mode, setMode] = useState<SidebarMode>(readSidebarMode);
  const [companyExpansion, setCompanyExpansion] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const companies = useCompanyTree(mode === 'company');

  const toggleMode = useCallback((): void => {
    setMode((current) => {
      const next: SidebarMode = current === 'company' ? 'workspace' : 'company';
      try {
        window.localStorage.setItem(SIDEBAR_MODE_STORAGE_KEY, next);
      } catch {
        // The mode just will not persist.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const content = contentRef.current;
        content?.style.setProperty('--hub-sider-tomny-min', `${minimums.tomny}px`);
    content?.style.setProperty('--hub-sider-apps-min', `${minimums.apps}px`);
    content?.style.setProperty('--hub-sider-tomny-max', `${maximums.tomny}px`);
    content?.style.setProperty('--hub-sider-apps-max', `${maximums.apps}px`);
    if (sectionHeights === undefined) {
      content?.style.removeProperty('--hub-sider-tomny-h');
      content?.style.removeProperty('--hub-sider-apps-h');
      content?.style.removeProperty('--hub-sider-workspaces-h');
      content?.removeAttribute('data-sections-resized');
      return;
    }
    content?.style.setProperty('--hub-sider-tomny-h', `${sectionHeights.tomny}px`);
    content?.style.setProperty('--hub-sider-apps-h', `${sectionHeights.apps}px`);
    content?.style.setProperty('--hub-sider-workspaces-h', `${sectionHeights.workspaces}px`);
    content?.setAttribute('data-sections-resized', 'true');
    }, [sectionHeights, minimums, maximums]);

  useEffect(() => {
    setSectionHeights((current) => {
      if (!current) return current;
      const tomny = Math.min(maximums.tomny, Math.max(minimums.tomny, current.tomny));
      const apps = Math.min(maximums.apps, Math.max(minimums.apps, current.apps));
      if (tomny === current.tomny && apps === current.apps) return current;
      return { tomny, apps, workspaces: current.workspaces + current.tomny + current.apps - tomny - apps };
    });
  }, [minimums, maximums]);

  const readSectionHeights = useCallback((): SidebarSectionHeights => {
    const readHeight = (section: HTMLDivElement | null, fallback: number): number =>
      section?.getBoundingClientRect().height ?? fallback;
    return {
      tomny: readHeight(tomnySectionRef.current, minimums.tomny),
      apps: readHeight(appsSectionRef.current, minimums.apps),
      workspaces: readHeight(workspacesSectionRef.current, MIN_WORKSPACES_SECTION_HEIGHT),
    };
    }, [minimums]);

  const changeSectionHeights = useCallback(
    (splitter: SidebarSplitter, delta: number): void => {
      setSectionHeights((current) =>
        resizeSidebarSections(current ?? readSectionHeights(), splitter, delta, minimums, maximums)
      );
    },
        [readSectionHeights, minimums, maximums]
  );

  const handleSectionResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, splitter: SidebarSplitter): void => {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        changeSectionHeights(splitter, -16);
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        changeSectionHeights(splitter, 16);
      }
    },
    [changeSectionHeights]
  );

  const startSectionResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, splitter: SidebarSplitter): void => {
      if (!contentRef.current) return;
      event.preventDefault();
      const handle = event.currentTarget;
      const startY = event.clientY;
      const startHeights = sectionHeights ?? readSectionHeights();
      handle.setPointerCapture(event.pointerId);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';

      const finish = (): void => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        handle.removeEventListener('pointermove', resize);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('pointercancel', finish);
      };
      const resize = (moveEvent: PointerEvent): void => {
        setSectionHeights(
          resizeSidebarSections(startHeights, splitter, Math.round(moveEvent.clientY - startY), minimums, maximums)
        );
      };
      handle.addEventListener('pointermove', resize);
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
    },
        [readSectionHeights, sectionHeights, minimums, maximums]
  );

  const { apps: liveApps } = useLiveSessions();
  const goHome = useCallback(() => onNavigate('/guid'), [onNavigate]);
  const deleteChat = useDeleteChat(goHome);
    const deleteChats = useDeleteChats(goHome);
  const showChatInHub = useCallback(async (conversationId: string): Promise<void> => {
    try {
      const found = await hubActivityChannels.showConversation.invoke({ conversation_id: conversationId });
      if (!found) throw new Error('Chat unavailable');
      window.sessionStorage.setItem('tomni.hub.focusAgentId', `agent:${conversationId}`);
      onNavigate('/guid');
      window.dispatchEvent(new CustomEvent('tomni:hub-focus-agent', { detail: `agent:${conversationId}` }));
    } catch {
      Message.error(t('guid.hubHome.live.actionFailed'));
    }
  }, [onNavigate, t]);

  const saveRename = useCallback(async (): Promise<void> => {
    if (!renameTarget?.name.trim() || renameBusy) return;
    setRenameBusy(true);
    try {
      const ok = await ipcBridge.conversation.update.invoke({
        id: renameTarget.id, updates: { name: renameTarget.name.trim().slice(0, 120) },
      });
      if (!ok) throw new Error('Rename rejected');
      emitter.emit('chat.history.refresh');
      setRenameTarget(null);
      Message.success(t('conversation.history.renameSuccess'));
    } catch {
      Message.error(t('conversation.history.renameFailed'));
    } finally {
      setRenameBusy(false);
    }
  }, [renameBusy, renameTarget, t]);

  const forkChat = useCallback(async (conversationId: string): Promise<void> => {
    try {
      const fork = await ipcBridge.conversation.fork.invoke({ id: conversationId });
      emitter.emit('chat.history.refresh');
      onNavigate(`/conversation/${fork.id}`);
    } catch {
      Message.error(t('guid.hubHome.live.actionFailed'));
    }
  }, [onNavigate, t]);

  const exportChat = useCallback(async (conversationId: string): Promise<void> => {
    try {
      const conversation = await ipcBridge.conversation.get.invoke({ id: conversationId });
      if (!conversation) throw new Error('Chat unavailable');
      const folders = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory', 'createDirectory'] });
      if (!folders?.[0]) return;
      const messages = [];
      let page = 0;
            while (page < 100) {
        // Page N+1 depends on the preceding cursor/has_more response.
        // oxlint-disable-next-line no-await-in-loop
        const batch = await ipcBridge.database.getConversationMessages.invoke({
          conversation_id: conversationId, page, page_size: 500, content_mode: 'full',
        });
        messages.push(...batch.items);
        if (!batch.has_more) break;
        page += 1;
      }
      if (page >= 100) throw new Error('Chat export is too large');
      const name = sanitizeFileName(conversation.name || 'chat');
      const output = joinFilePath(folders[0], `${name}-${conversation.id.slice(0, 8)}-${Date.now()}.json`);
      const saved = await ipcBridge.fs.writeFile.invoke({ path: output, data: buildConversationExportJson(conversation, messages) });
      if (!saved) throw new Error('Export rejected');
      Message.success(t('conversation.history.exportSuccess'));
    } catch {
      Message.error(t('conversation.history.exportFailed'));
    }
  }, [t]);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), ACTIVE_CLOCK_MS);
    return () => window.clearInterval(timer);
  }, []);
  // Apps that hold at least one live session: Chat comes from the conversation history, every other app reports its own.
  const activeRows = useMemo(
    () =>
      buildActiveApps({
        apps: liveApps,
        chats: conversations.map((conversation) => ({
          id: conversation.id,
          name: conversation.name,
          workspace: conversation.extra?.workspace,
          activityAt: getActivityTime(conversation),
        })),
        liveStatus,
        labelFor: (appId) => {
          const titleKey = APP_TITLE_KEY[appId];
          return {
            title: titleKey ? t(titleKey) : (appTitles?.[appId] ?? appId.split('.').at(-1) ?? appId),
            icon: APP_ICON[appId] ?? 'app',
          };
        },
        workspaceLabel: (workspace) => getWorkspaceDisplayName(workspace, false, t),
        now: clock,
      }),
    [appTitles, clock, conversations, liveApps, liveStatus, t]
  );

  const renderCompanyNode = (companyId: string, node: RoleNode, nested: boolean): React.ReactNode => {
    const key = `${companyId}::${node.id}`;
    if (node.children.length === 0) {
      return (
        <button
          key={key}
          type='button'
          className={`hub-nav-item ${nested ? 'hub-nav-item--nested' : ''}`}
          data-testid={`hub-company-agent-${key}`}
          title={node.responsibilities || node.name}
          onClick={() => onOpenCompanyAgent(companyId, node.id)}
        >
          <span className='hub-n-icon'>
            <Bot size={14} strokeWidth={1.75} aria-hidden='true' />
          </span>
          <span className='hub-n-label'>{node.name}</span>
        </button>
      );
    }
    const expanded = companyExpansion.get(key) ?? false;
    return (
      <div key={key} className='hub-workspace-group'>
        <div className='hub-workspace-folder-row'>
          <button
            type='button'
            className='hub-workspace-toggle'
            aria-expanded={expanded}
            aria-label={t(expanded ? 'guid.hubHome.shell.collapseWorkspace' : 'guid.hubHome.shell.expandWorkspace', {
              name: node.name,
            })}
            onClick={() => setCompanyExpansion((current) => new Map(current).set(key, !expanded))}
          >
            {expanded ? (
              <ChevronDown size={14} strokeWidth={1.75} aria-hidden='true' />
            ) : (
              <ChevronRight size={14} strokeWidth={1.75} aria-hidden='true' />
            )}
          </button>
          <button
            type='button'
            className='hub-nav-item'
            data-testid={`hub-company-group-${key}`}
            title={node.responsibilities || node.name}
            onClick={() => onOpenCompanyGroup(companyId, node.id)}
          >
            <span className='hub-n-icon'>
              <FolderOpen theme='outline' size={14} fill='currentColor' />
            </span>
            <span className='hub-n-label'>{node.name}</span>
          </button>
        </div>
        {expanded && node.children.map((child) => renderCompanyNode(companyId, child, true))}
      </div>
    );
  };

  const renderCompanies = (): React.ReactNode => {
    if (companies.length === 0) {
      return <div className='hub-agents-empty'>{t('guid.hubHome.shell.companiesEmpty')}</div>;
    }
    return companies.map(({ companyId, structure }) => {
      const expanded = companyExpansion.get(companyId) ?? false;
      return (
        <div key={companyId} className='hub-workspace-group'>
          <div className='hub-workspace-folder-row'>
            <button
              type='button'
              className='hub-workspace-toggle'
              aria-expanded={expanded}
              aria-label={t(expanded ? 'guid.hubHome.shell.collapseWorkspace' : 'guid.hubHome.shell.expandWorkspace', {
                name: companyId,
              })}
              onClick={() => setCompanyExpansion((current) => new Map(current).set(companyId, !expanded))}
            >
              {expanded ? (
                <ChevronDown size={14} strokeWidth={1.75} aria-hidden='true' />
              ) : (
                <ChevronRight size={14} strokeWidth={1.75} aria-hidden='true' />
              )}
            </button>
            <button
              type='button'
              className='hub-nav-item'
              data-testid={`hub-company-${companyId}`}
              title={companyId}
              onClick={() => onOpenCompanyGroup(companyId)}
            >
              <span className='hub-n-icon'>
                <BuildingTwo theme='outline' size={14} fill='currentColor' />
              </span>
              <span className='hub-n-label'>{companyId}</span>
            </button>
          </div>
          {expanded && structure && structure.root.children.map((child) => renderCompanyNode(companyId, child, true))}
        </div>
      );
    });
  };

  return (
    <aside className='hub-sider' data-testid='global-hub-sidebar' onMouseLeave={onPeekLeave}>
      <div ref={contentRef} className='hub-sider-content'>
        <div ref={tomnySectionRef} className='hub-sider-section hub-sider-tomny'>
          <div className='hub-sider-brand'>
            <span className='hub-sider-name'>TOMNY</span>
          </div>
                              <div className='hub-sider-section-scroll'>
            <nav aria-label={t('guid.hubHome.shell.primaryNavigation')}>
              {orderedNav.map(({ id, labelKey, path, Icon }) => (
                <button
                  key={id}
                  draggable
                  onDragStart={(event) => {
                    draggingNav.current = id;
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', id);
                  }}
                  onDragOver={(event) => { if (draggingNav.current && draggingNav.current !== id) event.preventDefault(); }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const source = draggingNav.current;
                    if (source && source !== id) onMoveNav(source, id);
                    draggingNav.current = null;
                  }}
                  onDragEnd={() => { draggingNav.current = null; }}
                  onKeyDown={(event) => {
                    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                    event.preventDefault();
                    const index = orderedNav.findIndex((item) => item.id === id);
                    const target = orderedNav[index + (event.key === 'ArrowUp' ? -1 : 1)];
                    if (target) onMoveNav(id, target.id);
                  }}
                                    type='button'
                  className={`hub-nav-item ${activeNavId === id ? 'hub-active' : ''}`}
                  aria-label={t(labelKey)}
                  data-testid={`hub-nav-${id}`}
                  onClick={() => {
                    if (id === 'home') {
                      onOpenHome();
                      onNavigate(path);
                      return;
                    }
                    if (id === 'company') {
                      onOpenCompany();
                      return;
                    }
                    onNavigate(path);
                  }}
                >
                  <span className='hub-n-icon'>
                    <Icon theme='outline' size={14} fill='currentColor' />
                  </span>
                                                      <span className='hub-n-label'>{t(labelKey)}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>

        <div
          className='hub-sider-section-divider hub-sider-section-divider--apps'
          role='separator'
          aria-orientation='horizontal'
          aria-label={t('guid.hubHome.shell.pinnedApps')}
          tabIndex={0}
          onPointerDown={(event) => startSectionResize(event, 'tomny-apps')}
          onDoubleClick={() => setSectionHeights(undefined)}
          onKeyDown={(event) => handleSectionResizeKeyDown(event, 'tomny-apps')}
        >
          <ChevronDown size={14} strokeWidth={1.75} aria-hidden='true' />
        </div>

        <div ref={appsSectionRef} className='hub-sider-section hub-sider-apps'>
          <div className='hub-side-label'>{t('guid.hubHome.shell.pinnedApps')}</div>
          <div className='hub-sider-section-scroll'>
                                    {orderedApps.map(({ id, kind, app }) => (
              <div key={id} className='hub-app-row'>
                {kind === 'built-in' ? (
                  <button type='button' className='hub-nav-item' aria-label={t(app.labelKey)}
                    data-testid={`hub-app-${app.id}`} onClick={() => onOpenApp(app)}>
                    <span className='hub-n-icon'><app.Icon theme='outline' size={14} fill='currentColor' /></span>
                    <span className='hub-n-label'>{t(app.labelKey)}</span>
                  </button>
                ) : (
                  <button type='button' className='hub-nav-item'
                                        data-not-installed={app.installed === false && !app.baseRoute ? 'true' : undefined}
                    title={app.installed === false && !app.baseRoute
                      ? t('guid.hubHome.shell.notInstalled', { defaultValue: 'Chưa cài đặt - chọn để tải và mở ứng dụng' })
                      : app.title}
                    aria-label={app.title} data-testid={`hub-package-app-${app.id}`}
                    onClick={() => onOpenPackageApp(app)}>
                    <span className='hub-n-icon'>
                      {app.packageId === 'com.tomni.browser' ? <Compass size={14} />
                        : app.packageId === 'com.tomni.ide' ? <Code2 size={14} />
                        : app.packageId === 'com.tomni.document-studio' ? <FileText size={14} />
                        : app.packageId === 'com.tomni.automation-studio' ? <Workflow size={14} />
                        : app.packageId === 'com.tomni.calculator' ? <Calculator size={14} /> : <Package size={14} />}
                    </span>
                    <span className='hub-n-label'>{app.title}</span>
                  </button>
                )}
                <button type='button' className='hub-app-unpin' data-testid={`hub-unpin-app-${id}`}
                  disabled={pinnedAppIds.length <= MIN_SIDEBAR_PINS}
                  aria-label={`Bỏ ghim ${kind === 'built-in' ? t(app.labelKey) : app.title}`}
                  onClick={() => onToggleAppPin(id)} title='Bỏ ghim ứng dụng'>
                  <Pin size={12} />
                </button>
              </div>
            ))}
            <button type='button' className='hub-nav-item' data-testid='hub-open-launcher' onClick={onOpenLauncher}>
              <span className='hub-n-icon'>
                <AllApplication theme='outline' size={14} fill='currentColor' />
              </span>
                                          <span className='hub-n-label'>{t('guid.hubHome.shell.viewAllApps', { count: totalApps })}</span>
            </button>
          </div>
        </div>

        <div
          className='hub-sider-section-divider hub-sider-section-divider--workspaces'
          role='separator'
          aria-orientation='horizontal'
          aria-label={t('guid.hubHome.shell.active')}
          tabIndex={0}
          onPointerDown={(event) => startSectionResize(event, 'apps-workspaces')}
          onDoubleClick={() => setSectionHeights(undefined)}
          onKeyDown={(event) => handleSectionResizeKeyDown(event, 'apps-workspaces')}
        >
          <ChevronDown size={14} strokeWidth={1.75} aria-hidden='true' />
        </div>

        <div ref={workspacesSectionRef} className='hub-sider-section hub-sider-workspaces'>
          <div className='hub-side-label'>
            {t(mode === 'company' ? 'guid.hubHome.shell.companies' : 'guid.hubHome.shell.active')}
          </div>
          <div className='hub-sider-section-scroll'>
            {mode === 'company' && renderCompanies()}
            {mode === 'workspace' && (
              <ActiveSessions
                rows={activeRows}
                onOpen={onOpenSession}
                onDeleteChat={deleteChat}
                                onDeleteChats={deleteChats}
                onShowChat={(id) => void showChatInHub(id)}
                onRenameChat={(id, name) => setRenameTarget({ id, name })}
                onForkChat={(id) => void forkChat(id)}
                onExportChat={(id) => void exportChat(id)}
                onCreateSession={onCreateSession}
                onCloseSession={onCloseSession}
              />
            )}
          </div>
        </div>
      </div>
      <div className='hub-sidebar-status' role='status' data-testid='hub-sidebar-running'>
        <span className='hub-dot hub-dot-g' />
        {t('guid.hubHome.live.running', { count: runningAgentCount })}
        <button
          type='button'
          className='hub-sidebar-mode'
          data-testid='hub-sidebar-mode-toggle'
          aria-pressed={mode === 'company'}
          title={t(mode === 'company' ? 'guid.hubHome.shell.showActive' : 'guid.hubHome.shell.showCompanies')}
          onClick={toggleMode}
        >
          {mode === 'company' ? (
            <FolderOpen theme='outline' size={12} fill='currentColor' />
          ) : (
            <BuildingTwo theme='outline' size={12} fill='currentColor' />
          )}
          {t(mode === 'company' ? 'guid.hubHome.shell.active' : 'guid.hubHome.shell.companies')}
        </button>
            </div>
      <Modal
        title={t('conversation.history.rename')}
        visible={Boolean(renameTarget)}
        confirmLoading={renameBusy}
        onOk={() => void saveRename()}
        onCancel={() => setRenameTarget(null)}
        autoFocus={false}
      >
        <Input
          value={renameTarget?.name ?? ''}
          maxLength={120}
          aria-label={t('conversation.history.rename')}
          onChange={(name) => setRenameTarget((current) => current ? { ...current, name } : null)}
          onPressEnter={() => void saveRename()}
        />
      </Modal>
    </aside>
  );
};
