import { ipcBridge } from '@/common';
import { Bot, Cpu, FolderOpen, Paperclip, X } from 'lucide-react';
import { rememberApprovedWorkspace } from '@/renderer/components/workspace';
import { useSystemMetrics } from '@/renderer/pages/settings/ResourceSettings/system/useSystemMetrics';
import type { HubActivityItem } from '@/common/types/agent/hubActivity';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HUB_QUICK_PROMPTS, type HubAppDefinition } from './catalog';
import { HubAgents } from './HubAgents';
import { HumanTerminalWorkspace } from './terminal/HumanTerminalWorkspace';
import { PromptLibraryModal } from './PromptLibraryModal';
import { recommendedPingLimit } from './liveGrid';
import type { HubActivityControls } from './useHubActivity';
import { useHubRailTarget, useHubShell, type HubRailTarget } from '../shell/hubShellContext';

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
  attachmentCount?: number;
  /** Collapsible attachment inventory rendered in the context strip below the composer. */
  attachmentInventory?: React.ReactNode;
  onFocusDirectory: (path: string) => void;
  /** Raised when a live tile is selected or cleared so the caller can retarget the composer. */
  onSelectActivity?: (item: HubActivityItem | undefined) => void;
  assistants?: readonly Assistant[];
  onSelectAssistant?: (assistantKey: string) => void;
};

const resolved = (value: boolean) => Promise.resolve(value);
const EMPTY_ACTIVITY: HubActivityControls = {
  items: [],
  ready: true,
  stop: () => resolved(false),
  respond: () => resolved(false),
  dismiss: () => resolved(false),
};
const NO_APPS: readonly HubAppDefinition[] = [];

/**
 * Home centre: the live agent grid and the composer. The sidebar, rail and
 * footer belong to the persistent Hub shell that wraps every route.
 */
const HubHome: React.FC<HubHomeProps> = ({
  composer,
  onNavigate,
  onFocusComposer,
  onPromptSelect,
  selectedAgentName,
  selectedModelName,
  workspaceName,
  attachmentCount = 0,
  attachmentInventory,
  onFocusDirectory,
  onSelectActivity,
  assistants = [],
  onSelectAssistant = () => undefined,
}) => {
  const { t } = useTranslation();
    const shell = useHubShell();
  const terminalMode = shell?.terminalMode ?? false;
  const [promptLibraryVisible, setPromptLibraryVisible] = useState(false);

  // Every agent turn, team, scheduled run and app process running anywhere, pushed live from Main.
  const activity = shell?.activity ?? EMPTY_ACTIVITY;
    const [selectedActivityId, setSelectedActivityId] = useState<string>();
  useEffect(() => {
    const focusAgent = (id: string | undefined) => {
      if (!id || !activity.items.some((item) => item.id === id)) return;
      setSelectedActivityId(id);
      onSelectActivity?.(activity.items.find((item) => item.id === id));
      window.sessionStorage.removeItem('tomni.hub.focusAgentId');
    };
    focusAgent(window.sessionStorage.getItem('tomni.hub.focusAgentId') ?? undefined);
    const onFocus = (event: Event) => focusAgent((event as CustomEvent<string>).detail);
    window.addEventListener('tomni:hub-focus-agent', onFocus);
    return () => window.removeEventListener('tomni:hub-focus-agent', onFocus);
  }, [activity.items, onSelectActivity]);
  const selectedActivity = useMemo(
    () => activity.items.find((item) => item.id === selectedActivityId),
    [activity.items, selectedActivityId]
  );
  const [contextStarted, setContextStarted] = useState(false);
  const [choosingWorkspace, setChoosingWorkspace] = useState(false);
  const hasContext = contextStarted || Boolean(workspaceName?.trim()) || attachmentCount > 0 || activity.items.length > 0;
  const runningAgentCount = activity.items.filter((item) => item.kind === 'agent' && item.status === 'running').length;
  // A selected live tile owns the folder the rail is showing, so the chat input bar must show
  // the same one — otherwise the next message is composed against a workspace the user never
  // picked, and the reply lands somewhere the composer did not advertise.
  const composerRoot = selectedActivity?.workspace ?? workspaceName;
  const composerWorkspace =
    composerRoot
      ?.replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || composerRoot;
  useEffect(() => {
    if (workspaceName?.trim() || activity.items.length > 0) setContextStarted(true);
  }, [workspaceName, activity.items.length]);
  // Every path that drops the tile selection must tell the caller too, or the composer keeps
  // replying into an agent whose folder the user has already moved away from.
  const clearActivitySelection = useCallback(() => {
    setSelectedActivityId(undefined);
    onSelectActivity?.(undefined);
  }, [onSelectActivity]);
  // Selection appearance is derived from the live activity snapshot. When its item disappears,
  // clear the parent continuation target too instead of silently retaining an invisible agent.
  useEffect(() => {
    if (selectedActivityId && !selectedActivity) clearActivitySelection();
  }, [clearActivitySelection, selectedActivity, selectedActivityId]);

  // The sidebar "Chat" entry lives in the shell; it asks the Home composer for focus.
  useEffect(() => {
    window.addEventListener('tomni-hub-focus-composer', onFocusComposer);
    return () => window.removeEventListener('tomni-hub-focus-composer', onFocusComposer);
  }, [onFocusComposer]);

  const railFocusDirectory = useCallback(
    (path: string) => {
      clearActivitySelection();
      onFocusDirectory(path);
      onFocusComposer();
    },
    [clearActivitySelection, onFocusComposer, onFocusDirectory]
  );
  const railTarget = useMemo<HubRailTarget>(
    () => ({
      workspaceName: selectedActivity ? selectedActivity.workspace : workspaceName,
      agentName: selectedActivity?.title ?? selectedAgentName,
      workspace: selectedActivity?.kind === 'agent' ? selectedActivity.workspace : undefined,
            conversationId: selectedActivity?.kind === 'agent' ? selectedActivity.sourceId : undefined,
      activityId: selectedActivity?.id,
      onFocusDirectory: railFocusDirectory,
    }),
    [railFocusDirectory, selectedActivity, selectedAgentName, workspaceName]
  );
  useHubRailTarget(railTarget);

  const chooseComposerWorkspace = useCallback(async () => {
    if (choosingWorkspace) return;
    setChoosingWorkspace(true);
    try {
      const paths = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory', 'createDirectory'] });
      if (paths?.[0]) {
        rememberApprovedWorkspace(paths[0]);
        clearActivitySelection();
        onFocusDirectory(paths[0]);
        onFocusComposer();
      }
    } catch {
      Message.error(t('guid.hubHome.composerContext.folderError'));
    } finally {
      setChoosingWorkspace(false);
    }
  }, [choosingWorkspace, clearActivitySelection, onFocusDirectory, onFocusComposer, t]);
  const metrics = useSystemMetrics();
  const pingAdvice = useMemo(() => {
    const cpu = metrics.status === 'ready' ? (metrics.live?.cpu.overallPercent ?? null) : null;
    const ram = metrics.status === 'ready' ? (metrics.live?.memory.usedPercent ?? null) : null;
    const advice = recommendedPingLimit(cpu, ram);
    const value = advice.reason === 'cpu' ? cpu : advice.reason === 'ram' ? ram : null;
    return { ...advice, value: value === null ? null : Math.round(value) };
  }, [metrics.live, metrics.status]);

  const openApp = useCallback(
    (app: HubAppDefinition) => {
      if (app.id === 'chat') {
        shell?.setTerminalMode(false);
        onFocusComposer();
        return;
      }
      if (shell) shell.openApp(app);
      else onNavigate(app.path, app.state);
    },
    [onFocusComposer, onNavigate, shell]
  );

  const openActivity = useCallback(
    (item: HubActivityItem) => {
      if (item.appId === 'terminal') {
        if (shell) shell.openTerminal();
        else onNavigate('/store');
        return;
      }
      if (item.route) onNavigate(item.route);
    },
    [onNavigate, shell]
  );

  return (
    <div
      className={`hub-home-center ${terminalMode ? 'hub-home-center--terminal' : ''}`}
            data-testid='hub-home-center'
      onDropCapture={(event) => {
        // A reference from a different Explorer root must start in that workspace,
        // not silently continue an already-selected agent in another workspace.
        const draggedRoot = event.dataTransfer.getData('application/x-tomni-explorer-workspace-root');
        if (
          selectedActivity?.workspace &&
          draggedRoot &&
          selectedActivity.workspace.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase() !==
            draggedRoot.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
        ) {
          clearActivitySelection();
        }
      }}
      onClick={(event) => {
        const target = event.target;
        if (terminalMode || !selectedActivityId || !(target instanceof Element)) return;
        if (target.closest('[data-testid="hub-agent-grid"], .hub-composer, .hub-composer-context')) return;
        clearActivitySelection();
      }}
    >
            {terminalMode ? (
        <HumanTerminalWorkspace workspacePath={workspaceName} />
      ) : (
        <>
      <HubAgents
        activity={activity}
        apps={shell?.availableApps ?? NO_APPS}
        selectedId={selectedActivity?.id}
        pingAdvice={pingAdvice}
        onSelect={(item) => {
          if (!item) {
            clearActivitySelection();
            return;
          }
          setSelectedActivityId(item.id);
          onSelectActivity?.(item);
        }}
        onOpenItem={openActivity}
        onOpenApp={openApp}
        onNavigate={onNavigate}
        onFocusComposer={onFocusComposer}
        assistants={assistants}
        onSelectAssistant={onSelectAssistant}
      />
      <div className='hub-composer'>{composer}</div>
      {hasContext ? (
        <div className='hub-composer-context' data-testid='hub-composer-context'>
          <div className='hub-composer-context-strip' role='group' aria-label={t('guid.hubHome.composerContext.label')}>
            {attachmentInventory}
            <div className='hub-composer-context-workspace'>
              <button
                type='button'
                className='hub-composer-workspace'
                data-testid='hub-composer-workspace'
                onClick={() => void chooseComposerWorkspace()}
                disabled={choosingWorkspace}
                aria-label={t('guid.hubHome.composerContext.changeWorkspace')}
                title={composerRoot || t('guid.hubHome.composerContext.chooseWorkspace')}
              >
                <FolderOpen size={15} strokeWidth={1.75} aria-hidden='true' />
                <span>{composerWorkspace || t('guid.hubHome.composerContext.defaultWorkspace')}</span>
              </button>
              {composerRoot && (
                <button
                  type='button'
                  className='hub-composer-workspace-clear'
                  data-testid='hub-composer-workspace-clear'
                  aria-label={t('guid.hubHome.composerContext.clearWorkspace')}
                  title={t('guid.hubHome.composerContext.clearWorkspace')}
                  onClick={() => {
                    clearActivitySelection();
                    onFocusDirectory('');
                    onFocusComposer();
                  }}
                >
                  <X size={12} strokeWidth={1.75} aria-hidden='true' />
                </button>
              )}
            </div>
            <div className='hub-composer-context-meta'>
              {selectedModelName && (
                <span
                  className='hub-composer-context-model'
                  title={`${t('guid.hubHome.composerContext.model')}: ${selectedModelName}`}
                >
                  <Cpu size={14} strokeWidth={1.75} aria-hidden='true' />
                  <span>{selectedModelName}</span>
                </span>
              )}
              {attachmentCount > 0 && !attachmentInventory && (
                <span
                  title={t('guid.hubHome.composerContext.attachments', { count: attachmentCount })}
                  aria-label={t('guid.hubHome.composerContext.attachments', { count: attachmentCount })}
                >
                  <Paperclip size={14} strokeWidth={1.75} aria-hidden='true' />
                  {attachmentCount}
                </span>
              )}
              {runningAgentCount > 0 && (
                <span className='hub-composer-context-running'>
                  <Bot size={14} strokeWidth={1.75} aria-hidden='true' />
                  {t('guid.hubHome.live.running', { count: runningAgentCount })}
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className='hub-suggest-row' aria-label={t('guid.hubHome.quickPromptsLabel')}>
          {HUB_QUICK_PROMPTS.map((key) => (
            <button key={key} type='button' className='hub-suggest-chip' onClick={() => onPromptSelect(t(key))}>
              {t(key)}
            </button>
          ))}
          <button type='button' className='hub-suggest-chip' onClick={() => setPromptLibraryVisible(true)}>
            {t('guid.hubHome.shell.more')}
          </button>
        </div>
                  )}
        </>
      )}

      <PromptLibraryModal
        visible={!terminalMode && promptLibraryVisible}
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
