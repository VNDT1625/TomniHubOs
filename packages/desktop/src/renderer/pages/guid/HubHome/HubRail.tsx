import { Dropdown, Menu } from '@arco-design/web-react';
import {
  FolderOpen,
  GitCompareArrows,
  Brain,
  KeyRound,
  Layers3,
  Plus,
  X,
  Eye,
  Maximize2,
  ExternalLink,
  Minimize2,
  MessageSquare,
  Activity,
  Monitor,
  Users,
    Package,
    Radio,
    Terminal,
    ChartNoAxesCombined,
  Square,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { previewTitleOf } from './previewTitle';
import type { HubActivityItem } from '@/common/types/agent/hubActivity';
import { HubExecutionPanel } from './inspector/HubExecutionPanel';
import { useHumanTerminals } from './terminal/HumanTerminalContext';
import { HumanTerminalViewport } from './terminal/HumanTerminalViewport';
import { HubSystemMonitor } from './monitor/HubSystemMonitor';

import MarkdownView from '@/renderer/components/Markdown';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HubExplorer } from '@/renderer/pages/guid/HubHome/explorer/HubExplorer';
import { RealtimeWidgetRail } from '@/renderer/pages/realtime/widgets/RealtimeWidgetRail';
import { HubSessionMemory } from './memory/HubSessionMemory';
import { HubSessionContext } from './memory/HubSessionContext';
import { HubSessionSecrets } from './memory/HubSessionSecrets';

type TabId =
    | 'files'
  | 'realtime'

  | 'chat'
  | 'activity'
  | 'live'
  | 'subagents'
  | 'artifacts'
  | 'diff'
  | 'memory'
  | 'context'
  | 'secrets'
    | 'preview'
    | 'console'
  | 'system-monitor';
type HubPreview = {
  id: string;
  title: string;
  content: string;
  type: 'html' | 'markdown' | 'code' | 'diff';
  previewId?: string;
  pending?: boolean;
  sourceId?: string;
  blockIndex?: number;
};
const HTMLViewer = React.lazy(() => import('@/renderer/pages/conversation/Preview/components/viewers/HTMLViewer'));
type HubRailProps = {
  workspaceName?: string;
  onFocusDirectory: (path: string) => void | Promise<void>;
  agentName: string;
  /** Workspace explicitly selected by the active agent tile. */
  workspace?: string;
  /** Selected native conversation id, not the activity registry id. */
  conversationId?: string;
  /** Live selected monitor item; absent outside Mission Control. */
    activityItem?: HubActivityItem;
  /** Live Hub jobs, not OS processes, from the shared activity registry. */
  activityItems?: readonly HubActivityItem[];

    onOpenActivity?: (item: HubActivityItem) => void;
    onOpenHumanTerminal?: () => void;
  /** Main Terminal Mode is the exclusive interactive PTY owner. */
  terminalMode?: boolean;
  /** Fired when the pointer leaves an edge-hovered panel so the shell can retract it. */
  onPeekLeave?: () => void;
    enableHomePreview?: boolean;
  isRealtime?: boolean;
  onPreviewOpened?: () => void;
  onOpenPreviewInBrowser?: (html: string) => Promise<void>;
};
const TAB_LABEL: Record<TabId, string> = {
    files: 'guid.hubHome.layout.tabWorkspace',
  realtime: 'guid.hubHome.shell.nav.realtime',
  chat: 'guid.hubHome.inspector.chat',
  activity: 'guid.hubHome.inspector.activity',
  live: 'guid.hubHome.inspector.live',
  subagents: 'guid.hubHome.inspector.subagents',
  artifacts: 'guid.hubHome.inspector.artifacts',
  diff: 'guid.hubHome.layout.tabDiff',
  memory: 'guid.hubHome.memory.title',
  context: 'guid.hubHome.context.title',
  secrets: 'guid.hubHome.secrets.title',
    preview: 'Preview',
    console: 'guid.hubHome.terminal.console',
  'system-monitor': 'guid.hubHome.systemMonitor.title',
};
const TAB_ICON = {
    files: FolderOpen,
  realtime: Radio,

  chat: MessageSquare,
  activity: Activity,
  live: Monitor,
  subagents: Users,
  artifacts: Package,
  diff: GitCompareArrows,
  memory: Brain,
  context: Layers3,
  secrets: KeyRound,
    preview: Eye,
    console: Terminal,
  'system-monitor': ChartNoAxesCombined,
};
const AGENT_TABS: readonly TabId[] = ['files', 'chat', 'activity'];
const FALLBACK_TABS: TabId[] = ['files'];
const RAIL_TABS_STORAGE_KEY = 'tomni.hub.railTabs.v1';

type StoredRailTabs = { openTabs?: unknown; active?: unknown };

const isTabId = (value: unknown): value is TabId =>
  ['files', 'realtime', 'chat', 'activity', 'live', 'subagents', 'artifacts', 'diff', 'memory', 'context', 'secrets', 'console', 'system-monitor'].includes(
    value as TabId
  );

const readStoredRailTabs = (): { openTabs: TabId[]; active: TabId } => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(RAIL_TABS_STORAGE_KEY) ?? '{}') as StoredRailTabs;
    const openTabs = Array.isArray(stored.openTabs) ? stored.openTabs.filter(isTabId) : [];
    const uniqueTabs = [...new Set(openTabs)];
    const restoredTabs: TabId[] = uniqueTabs.length > 0 ? uniqueTabs : FALLBACK_TABS;
    return {
      openTabs: restoredTabs,
      active: isTabId(stored.active) && restoredTabs.includes(stored.active) ? stored.active : restoredTabs[0]!,
    };
  } catch {
    return { openTabs: FALLBACK_TABS, active: 'files' };
  }
};

export const HubRail: React.FC<HubRailProps> = ({
  workspaceName,
  onFocusDirectory,
  agentName,
  conversationId,
    activityItem,
  activityItems = [],

    onOpenActivity,
    onOpenHumanTerminal,
  terminalMode = false,
  onPeekLeave,
    enableHomePreview = false,
  isRealtime = false,

  onPreviewOpened,
  onOpenPreviewInBrowser,
}) => {
    const { t } = useTranslation();
  const terminals = useHumanTerminals();
  const [consoleSessionId, setConsoleSessionId] = useState('follow');
    const [railTabs, setRailTabs] = useState(readStoredRailTabs);
  const previousNonRealtimeTab = useRef<TabId | null>(null);
  useEffect(() => {
    if (isRealtime) {
      setRailTabs((current) => {
        if (previousNonRealtimeTab.current === null) previousNonRealtimeTab.current = current.active;
        if (current.active === 'realtime' && current.openTabs.includes('realtime')) return current;
        return { openTabs: current.openTabs.includes('realtime') ? current.openTabs : [...current.openTabs, 'realtime'], active: 'realtime' };
      });
    } else if (previousNonRealtimeTab.current !== null) {
      const prior = previousNonRealtimeTab.current;
      previousNonRealtimeTab.current = null;
      setRailTabs((current) => ({ ...current, active: current.openTabs.includes(prior) ? prior : 'files' }));
    }
  }, [isRealtime]);
  const { openTabs, active } = railTabs;
  const [previewTabs, setPreviewTabs] = useState<HubPreview[]>([]);
  const [selectedPreviewId, setSelectedPreviewId] = useState<string>();
  const previewSequence = useRef(0);
  const [expandedPreview, setExpandedPreview] = useState(false);
  const [browserError, setBrowserError] = useState('');
  useEffect(() => {
    if (!expandedPreview) return undefined;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedPreview(false);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [expandedPreview]);
    const selectedPreview = previewTabs.find((preview) => preview.id === selectedPreviewId) ?? previewTabs[0];
  const consoleSession = terminals.sessions.find((session) => session.id === consoleSessionId)
    ?? terminals.sessions.find((session) => session.id === terminals.activeId)
    ?? terminals.sessions[0];
  const sessionPreviews = previewTabs.filter((entry) => activityItem && entry.sourceId === activityItem.id);
      const baseTabs: readonly TabId[] = isRealtime ? ['realtime', 'files'] :
    enableHomePreview && activityItem
      ? [
          ...AGENT_TABS,
          ...(activityItem.kind === 'app' ? (['live'] as const) : []),
          ...(activityItem.kind === 'team' && activityItem.steps.length > 0 ? (['subagents'] as const) : []),
          ...(sessionPreviews.length ? (['artifacts'] as const) : []),
          ...(sessionPreviews.some((entry) => entry.type === 'diff') ? (['diff'] as const) : []),
          ...(conversationId ? (['memory', 'context', 'secrets'] as const) : []),
          ...(previewTabs.length ? (['preview'] as const) : []),
        ]
      : conversationId
        ? ['files', 'diff', 'memory', 'context', 'secrets']
                 : [...FALLBACK_TABS, ...(previewTabs.length ? (['preview'] as const) : [])];
    const availableTabs: readonly TabId[] = isRealtime
    ? [...baseTabs, 'system-monitor']
    : ['realtime', ...baseTabs, 'console', 'system-monitor'];
  const visibleTabs = openTabs.filter((tab) => availableTabs.includes(tab));
    const renderedTabs: TabId[] = visibleTabs.length > 0 ? visibleTabs : isRealtime ? ['realtime'] : FALLBACK_TABS;
  const activeTab = renderedTabs.includes(active) ? active : isRealtime ? 'realtime' : 'files';
  const setOpenTabs = useCallback((update: React.SetStateAction<TabId[]>) => {
    setRailTabs((current) => {
      const candidateTabs = typeof update === 'function' ? update(current.openTabs) : update;
      const nextTabs: TabId[] = candidateTabs.length > 0 ? candidateTabs : FALLBACK_TABS;
      return { openTabs: nextTabs, active: nextTabs.includes(current.active) ? current.active : nextTabs[0]! };
    });
  }, []);
  const setActive = useCallback((tabId: TabId) => setRailTabs((current) => ({ ...current, active: tabId })), []);
  // Selecting a monitor opens its mini Chat the first time, without stealing
  // focus from an Inspector tab that the user is already inspecting.
  useEffect(() => {
    if (!enableHomePreview || !activityItem) return;
    setRailTabs((current) => {
      if (current.active !== 'files' || current.openTabs.includes('chat')) return current;
      return { openTabs: [...current.openTabs, 'chat'], active: 'chat' };
    });
  }, [activityItem?.id, enableHomePreview]);
  useEffect(() => {
    try {
      // Ephemeral previews should not resurrect without their content after a restart.
      const storedTabs = railTabs.openTabs.filter((tab) => tab !== 'preview');
      const storedActive = railTabs.active === 'preview' ? 'files' : railTabs.active;
      window.localStorage.setItem(
        RAIL_TABS_STORAGE_KEY,
        JSON.stringify({ openTabs: storedTabs, active: storedActive })
      );
    } catch {
      // The rail remains usable if local persistence is unavailable.
    }
  }, [railTabs]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enableHomePreview) return undefined;
    const onPreviewOpen = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          content?: unknown;
          contentType?: unknown;
          metadata?: {
            title?: unknown;
            file_name?: unknown;
            language?: unknown;
            previewId?: unknown;
            pending?: unknown;
            sourceId?: unknown;
            blockIndex?: unknown;
          };
        }>
      ).detail;
      if (
        !detail ||
        typeof detail.content !== 'string' ||
        !detail.content.trim() ||
        detail.content.length > 250_000 ||
        !['html', 'markdown', 'code', 'diff'].includes(String(detail.contentType))
      )
        return;
      const type = detail.contentType as HubPreview['type'];
      const label =
        typeof detail.metadata?.file_name === 'string'
          ? detail.metadata.file_name
          : typeof detail.metadata?.title === 'string'
            ? detail.metadata.title
            : type.toUpperCase();
      const previewId = typeof detail.metadata?.previewId === 'string' ? detail.metadata.previewId : undefined;
      const id =
        previewId && previewTabs.some((entry) => entry.previewId === previewId)
          ? previewTabs.find((entry) => entry.previewId === previewId)!.id
          : `hub-preview-${++previewSequence.current}`;
      const title =
        type === 'html' ? previewTitleOf(detail.content, label, previewSequence.current) : label.slice(0, 120);
      setPreviewTabs((current) => {
        const existing = current.find((entry) => entry.id === id);
        if (existing)
          return current.map((entry) =>
            entry.id === id
              ? { ...entry, content: detail.content as string, title, pending: detail.metadata?.pending === true }
              : entry
          );
        return [
          ...current.slice(-7),
          {
            id,
            title,
            content: detail.content as string,
            type,
            previewId,
            pending: detail.metadata?.pending === true,
            ...(typeof detail.metadata?.sourceId === 'string'
              ? {
                  sourceId: detail.metadata.sourceId,
                  blockIndex: Number.isInteger(detail.metadata.blockIndex) ? (detail.metadata.blockIndex as number) : 0,
                }
              : {}),
          },
        ];
      });
      setSelectedPreviewId(id);
      setOpenTabs((current) => (current.includes('preview') ? current : [...current, 'preview']));
      setActive('preview');
      onPreviewOpened?.();
    };
    window.addEventListener('preview.open', onPreviewOpen);
    return () => window.removeEventListener('preview.open', onPreviewOpen);
  }, [enableHomePreview, onPreviewOpened, setActive, setOpenTabs, previewTabs]);

  useEffect(() => {
    if (!enableHomePreview) return undefined;
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ previewId?: unknown; content?: unknown; pending?: unknown }>).detail;
      if (
        typeof detail?.previewId !== 'string' ||
        typeof detail.content !== 'string' ||
        detail.content.length > 250_000
      )
        return;
      setPreviewTabs((current) =>
        current.map((entry) =>
          entry.previewId === detail.previewId
            ? {
                ...entry,
                content: detail.content as string,
                pending: detail.pending === true,
                title:
                  entry.type === 'html'
                    ? previewTitleOf(detail.content as string, undefined, Number(entry.id.split('-').pop()) || 1)
                    : entry.title,
              }
            : entry
        )
      );
    };
    window.addEventListener('preview.update', onUpdate);
    return () => window.removeEventListener('preview.update', onUpdate);
  }, [enableHomePreview]);
  useEffect(() => {
    if (!enableHomePreview) return undefined;
    const onSourceUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ sourceId?: unknown; blocks?: unknown; pending?: unknown }>).detail;
      if (!detail || typeof detail.sourceId !== 'string' || !Array.isArray(detail.blocks)) return;
      const blocks: unknown[] = detail.blocks;
      setPreviewTabs((current) =>
        current.map((entry) => {
          if (entry.sourceId !== detail.sourceId || entry.type !== 'html') return entry;
          const html = blocks[entry.blockIndex ?? 0];
          if (typeof html !== 'string' || html.length > 250_000) return entry;
          const pending = detail.pending === true;
          if (entry.content === html && entry.pending === pending) return entry;
          return {
            ...entry,
            content: html,
            pending,
            title: previewTitleOf(html, undefined, Number(entry.id.split('-').pop()) || 1),
          };
        })
      );
    };
    window.addEventListener('preview.source-update', onSourceUpdate);
    return () => window.removeEventListener('preview.source-update', onSourceUpdate);
  }, [enableHomePreview]);

  const closeTab = useCallback(
    (id: TabId) => {
      if (renderedTabs.length <= 1) return;
      const index = renderedTabs.indexOf(id);
      const nextVisibleTabs = renderedTabs.filter((tab) => tab !== id);
      setOpenTabs((current) => current.filter((tab) => tab !== id));
      if (activeTab === id) setActive(nextVisibleTabs[Math.min(index, nextVisibleTabs.length - 1)]!);
    },
    [activeTab, renderedTabs, setOpenTabs, setActive]
  );

  return (
    <aside
      className='hub-rail'
      aria-label={t('guid.hubHome.status.title')}
      data-testid='global-hub-rail'
      onMouseLeave={onPeekLeave}
    >
      <div className='hub-tabbar' role='tablist'>
        {renderedTabs.map((id) => (
          <div className={`hub-rail-tab ${activeTab === id ? 'hub-active' : ''}`} key={id}>
            <button
              type='button'
              role='tab'
              id={`hub-tab-${id}`}
              aria-controls={`hub-panel-${id}`}
              aria-selected={activeTab === id}
              tabIndex={activeTab === id ? 0 : -1}
              className={`hub-tab-btn ${activeTab === id ? 'hub-active' : ''}`}
              data-testid={`hub-rail-tab-${id}`}
              onClick={() => setActive(id)}
              onKeyDown={(event) => {
                const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                if (!offset && event.key !== 'Home' && event.key !== 'End') return;
                event.preventDefault();
                const index =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? renderedTabs.length - 1
                      : (renderedTabs.indexOf(id) + offset + renderedTabs.length) % renderedTabs.length;
                const next = renderedTabs[index]!;
                setActive(next);
                document.getElementById(`hub-tab-${next}`)?.focus();
              }}
            >
              <span>
                {t(TAB_LABEL[id], {
                  defaultValue:
                    id === 'subagents'
                      ? 'Subagents'
                      : id === 'artifacts'
                        ? 'Artifacts'
                        : id === 'activity'
                          ? 'Activity'
                          : id === 'live'
                            ? 'Live'
                            : id === 'chat'
                              ? 'Chat'
                              : id,
                })}
              </span>
            </button>
            <button
              type='button'
              className='hub-tab-close'
              disabled={renderedTabs.length <= 1}
              aria-label={t('guid.hubHome.layout.closeTab') + ': ' + t(TAB_LABEL[id])}
              onClick={() => closeTab(id)}
            >
              <X size={11} />
            </button>
          </div>
        ))}
        <Dropdown
          trigger='click'
          droplist={
            <Menu
              className='hub-explorer-menu'
              onClickMenuItem={(id) => {
                if (!availableTabs.includes(id as TabId)) return;
                const tab = id as TabId;
                setOpenTabs((current) => (current.includes(tab) ? current : [...current, tab]));
                setActive(tab);
              }}
            >
              {availableTabs.map((id) => {
                const Icon = TAB_ICON[id];
                return (
                  <Menu.Item key={id}>
                    <Icon size={15} />
                    {t(TAB_LABEL[id], { defaultValue: id })}
                  </Menu.Item>
                );
              })}
            </Menu>
          }
        >
          <button
            type='button'
            className='hub-tab-btn hub-tab-add'
            aria-label={t('guid.hubHome.layout.addTab')}
            data-testid='hub-rail-tab-add'
            aria-haspopup='menu'
          >
            <Plus size={13} />
          </button>
        </Dropdown>
      </div>
      <div className='hub-tab-panels' ref={panelRef}>
        <div
          id='hub-panel-files'
          role='tabpanel'
          aria-labelledby='hub-tab-files'
          className='hub-tab-panel hub-explorer-panel'
          data-testid='hub-workspace-panel'
          hidden={activeTab !== 'files'}
        >
          <HubExplorer workspaceName={workspaceName} onFocusDirectory={onFocusDirectory} />
        </div>
                {activeTab === 'realtime' && (
          <div id='hub-panel-realtime' role='tabpanel' aria-labelledby='hub-tab-realtime' className='hub-tab-panel realtime-rail-panel'>
            <RealtimeWidgetRail />
          </div>
        )}
                {activeTab === 'console' && (
          <section id='hub-panel-console' role='tabpanel' aria-labelledby='hub-tab-console' className='hub-tab-panel hub-terminal-rail' data-testid='hub-rail-console'>
            <div className='hub-terminal-rail-toolbar'>
              <label>
                <span className='sr-only'>{t('guid.hubHome.terminal.choose', { defaultValue: 'Chọn terminal' })}</span>
                <select
                  value={consoleSessionId !== 'follow' && terminals.sessions.some((session) => session.id === consoleSessionId) ? consoleSessionId : 'follow'}
                  onChange={(event) => setConsoleSessionId(event.currentTarget.value)}
                  aria-label={t('guid.hubHome.terminal.choose', { defaultValue: 'Chọn terminal' })}
                >
                  <option value='follow'>{t('guid.hubHome.terminal.follow', { defaultValue: 'Theo terminal đang chọn' })}</option>
                  {terminals.sessions.map((session) => (
                    <option key={session.id} value={session.id}>{session.title}</option>
                  ))}
                </select>
              </label>
                            <button
                type='button'
                data-testid='hub-console-new-terminal'
                disabled={terminals.status !== 'ready'}
                title={t('guid.hubHome.terminal.new', { defaultValue: 'Terminal mới' })}
                aria-label={t('guid.hubHome.terminal.new', { defaultValue: 'Terminal mới' })}
                                onClick={() => void terminals.create().then((created) => { if (created) setConsoleSessionId(created.id); })}
              ><Plus size={14}/></button>
              {!terminalMode && consoleSession?.status === 'running' && (
                <button
                  type='button'
                  data-testid='hub-console-interrupt'
                  title={t('guid.hubHome.terminal.interrupt', { defaultValue: 'Ngắt lệnh (Ctrl+C)' })}
                  aria-label={t('guid.hubHome.terminal.interrupt', { defaultValue: 'Ngắt lệnh (Ctrl+C)' })}
                  onClick={() => terminals.write(consoleSession.id, '\x03')}
                ><Square size={13}/></button>
              )}
              {onOpenHumanTerminal && (
                <button
                  type='button'
                  title={t('guid.hubHome.terminal.open', { defaultValue: 'Mở Terminal Workspace' })}
                  onClick={() => {
                    if (consoleSession) terminals.select(consoleSession.id);
                    onOpenHumanTerminal();
                  }}
                ><ExternalLink size={14}/></button>
              )}
            </div>
            {consoleSession ? (
              <HumanTerminalViewport
                key={consoleSession.id}
                                sessionId={consoleSession.id}
                readOnly={terminalMode || consoleSession.status !== 'running'}
                noResize={terminalMode}
                inRail
              />
            ) : (
              <p className='hub-inspector-muted'>{t('guid.hubHome.terminal.empty', { defaultValue: 'Chưa có phiên Terminal' })}</p>
            )}
                        {terminals.error && <p className='hub-human-terminal-error' role='alert'>{terminals.error}</p>}
            <p className='hub-terminal-rail-note'>
              {terminalMode
                ? t('guid.hubHome.terminal.readonly', { defaultValue: 'Điều khiển chi tiết ở Terminal Workspace.' })
                : t('guid.hubHome.terminal.quickControl', { defaultValue: 'Nhấp Console và gõ lệnh trực tiếp. Không chuyển khỏi Chat.' })}
            </p>
          </section>
        )}
                {activeTab === 'system-monitor' && (
          <div
            id='hub-panel-system-monitor'
            role='tabpanel'
            aria-labelledby='hub-tab-system-monitor'
            className='hub-tab-panel hub-system-rail-panel'
            data-testid='hub-rail-system-monitor'
          >
            <HubSystemMonitor activities={activityItems} onOpenActivity={onOpenActivity} />
          </div>
        )}
        {activeTab === 'preview' && (
          <div
            id='hub-panel-preview'
            role='tabpanel'
            aria-labelledby='hub-tab-preview'
            className='hub-tab-panel hub-rail-preview-panel'
            data-testid='hub-rail-preview-panel'
          >
            <div className='hub-rail-preview-tabs' role='tablist' aria-label='Các bản xem trước'>
              {previewTabs.map((entry) => (
                <div key={entry.id} className='hub-rail-preview-tab'>
                  <button
                    type='button'
                    role='tab'
                    aria-selected={selectedPreview?.id === entry.id}
                    onClick={() => setSelectedPreviewId(entry.id)}
                    title={entry.title}
                  >
                    {entry.title}
                  </button>
                  <button
                    type='button'
                    aria-label={`Đóng preview ${entry.title}`}
                    onClick={() => {
                      const remaining = previewTabs.filter((item) => item.id !== entry.id);
                      setPreviewTabs(remaining);
                      if (selectedPreview?.id === entry.id) setSelectedPreviewId(remaining.at(-1)?.id);
                      if (!remaining.length) {
                        setOpenTabs((current) => current.filter((tab) => tab !== 'preview'));
                        setActive('files');
                      }
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
            {selectedPreview && (
              <div className='hub-rail-preview-toolbar' data-testid='hub-preview-toolbar'>
                <span title={selectedPreview.title}>{selectedPreview.title}</span>
                <button
                  type='button'
                  title='Mở toàn màn hình'
                  aria-label='Mở toàn màn hình'
                  onClick={() => setExpandedPreview(true)}
                >
                  <Maximize2 size={13} />
                </button>
                {selectedPreview.type === 'html' && onOpenPreviewInBrowser && (
                  <button
                    type='button'
                    title='Mở bằng Browser của Tomni'
                    aria-label='Mở bằng Browser của Tomni'
                    onClick={() => {
                      setBrowserError('');
                      void onOpenPreviewInBrowser?.(selectedPreview.content).catch(() =>
                        setBrowserError('Không mở được Browser. Kiểm tra Browser package đã được cài và bật.')
                      );
                    }}
                  >
                    <ExternalLink size={13} />
                  </button>
                )}
              </div>
            )}
            {browserError && (
              <p className='hub-rail-preview-error' role='alert'>
                {browserError}
              </p>
            )}
            {selectedPreview && (
              <div className='hub-rail-preview-content' data-testid='hub-rail-preview-content'>
                {selectedPreview.pending && (
                  <p role='status' className='hub-preview-loading'>
                    Đang viết code… Giao diện được cập nhật trong lúc Agent làm việc.
                  </p>
                )}
                {selectedPreview.type === 'html' ? (
                  <React.Suspense fallback={<div>Đang tải bản xem trước…</div>}>
                    <HTMLViewer
                      key={selectedPreview.id}
                      content={selectedPreview.content}
                      compactToolbar
                      streaming={selectedPreview.pending}
                    />
                  </React.Suspense>
                ) : selectedPreview.type === 'markdown' ? (
                  <MarkdownView>{selectedPreview.content}</MarkdownView>
                ) : (
                  <pre className='hub-rail-preview-code'>
                    <code>{selectedPreview.content}</code>
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
        {expandedPreview &&
          selectedPreview &&
          createPortal(
            <div
              className='hub-preview-fullscreen'
              role='dialog'
              aria-modal='true'
              aria-label={`Xem toàn màn hình: ${selectedPreview.title}`}
            >
              <div className='hub-preview-fullscreen-toolbar'>
                <strong>{selectedPreview.title}</strong>
                <button type='button' aria-label='Đóng toàn màn hình' onClick={() => setExpandedPreview(false)}>
                  <Minimize2 size={16} /> Thu nhỏ
                </button>
              </div>
              <div className='hub-preview-fullscreen-body'>
                {selectedPreview.type === 'html' ? (
                  <React.Suspense fallback={<p>Đang tải bản xem trước…</p>}>
                    <HTMLViewer
                      key={`fullscreen-${selectedPreview.id}`}
                      content={selectedPreview.content}
                      streaming={selectedPreview.pending}
                    />
                  </React.Suspense>
                ) : selectedPreview.type === 'markdown' ? (
                  <MarkdownView>{selectedPreview.content}</MarkdownView>
                ) : (
                  <pre className='hub-rail-preview-code'>{selectedPreview.content}</pre>
                )}
              </div>
            </div>,
            document.body
          )}
        {activityItem && (['chat', 'activity', 'live', 'subagents'] as const).some((id) => id === activeTab) && (
          <div
            id={`hub-panel-${activeTab}`}
            role='tabpanel'
            className='hub-tab-panel hub-inspector-panel'
            data-testid={`hub-rail-${activeTab}`}
          >
            <HubExecutionPanel
              item={activityItem}
              mode={activeTab as 'chat' | 'activity' | 'live' | 'subagents'}
              onOpenItem={onOpenActivity}
            />
          </div>
        )}
        {activeTab === 'artifacts' && (
          <div
            id='hub-panel-artifacts'
            role='tabpanel'
            className='hub-tab-panel hub-inspector-panel'
            data-testid='hub-rail-artifacts'
          >
            <div className='hub-panel-head'>
              {t('guid.hubHome.inspector.artifacts', { defaultValue: 'Session Artifacts' })}
            </div>
            {previewTabs
              .filter((entry) => entry.sourceId === activityItem?.id)
              .map((entry) => (
                <button
                  key={entry.id}
                  type='button'
                  className='hub-inspector-artifact'
                  onClick={() => {
                    setSelectedPreviewId(entry.id);
                    setActive('preview');
                  }}
                >
                  {entry.title}
                </button>
              ))}
            {!previewTabs.some((entry) => entry.sourceId === activityItem?.id) && (
              <p className='hub-inspector-muted'>
                {t('guid.hubHome.inspector.noArtifacts', {
                  defaultValue: 'Chưa có bản xem trước nào được liên kết với phiên này.',
                })}
              </p>
            )}
          </div>
        )}
        {activeTab === 'diff' && (
          <div id='hub-panel-diff' role='tabpanel' aria-labelledby='hub-tab-diff' className='hub-tab-panel'>
            <div className='hub-panel-head'>{t('guid.hubHome.layout.tabDiff')}</div>
            <div className='hub-diff-placeholder'>{t('guid.hubHome.layout.diffEmpty')}</div>
          </div>
        )}
        {activeTab === 'memory' && (
          <div
            id='hub-panel-memory'
            role='tabpanel'
            aria-labelledby='hub-tab-memory'
            className='hub-tab-panel hub-memory-panel'
          >
            <HubSessionMemory
              key={conversationId ?? 'none'}
              sessionId={conversationId}
              sessionName={agentName}
              active={activeTab === 'memory'}
            />
          </div>
        )}
        {activeTab === 'context' && (
          <div
            id='hub-panel-context'
            role='tabpanel'
            aria-labelledby='hub-tab-context'
            className='hub-tab-panel hub-memory-panel'
          >
            <HubSessionContext
              key={conversationId ?? 'none'}
              sessionId={conversationId}
              sessionName={agentName}
              active={activeTab === 'context'}
            />
          </div>
        )}
        {activeTab === 'secrets' && (
          <div
            id='hub-panel-secrets'
            role='tabpanel'
            aria-labelledby='hub-tab-secrets'
            className='hub-tab-panel hub-memory-panel'
          >
            <HubSessionSecrets
              key={conversationId ?? 'none'}
              sessionId={conversationId}
              active={activeTab === 'secrets'}
            />
          </div>
        )}
      </div>
    </aside>
  );
};
