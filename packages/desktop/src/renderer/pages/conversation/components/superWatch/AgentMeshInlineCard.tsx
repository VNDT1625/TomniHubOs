/**
 * Team integration for the generic ChatDock.
 *
 * The default Team panel is intentionally cheap: one lightweight overview call
 * shows what every agent is doing. Detailed inspection, direct chat, queue,
 * worklog and task controls are mounted and polled only after the user presses
 * Control.
 */
import { Button, Empty, Input, InputNumber, Message, Spin, Tag, Tooltip } from '@arco-design/web-react';
import { Delete, Down, PauseOne, Robot, Up } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { agentMeshClient } from '@/renderer/services/agentMeshClient';
import { useChatDockItem, type ChatDockItem } from '../ChatDock';
import type { AgentMeshOverview, AgentMeshSnapshot } from '@process/agentRuntime/agentMesh/service';
import type { AgentInspection, AgentMessage } from '@process/agentRuntime/agentMesh/mesh';
import type { AgentWorklogEntry } from '@process/agentRuntime/agentMesh/controller';

const CLOSED_POLL_MS = 8000;
const OVERVIEW_POLL_MS = 3500;
const CONTROL_POLL_MS = 2500;
const ACTIVE_STATUSES = new Set(['queued', 'waiting_dependency', 'starting', 'working']);
const MAX_CHAT_MESSAGES = 50;
const CONCURRENCY_STORAGE_KEY = 'tomny.chat.team.maxConcurrent';
const DEFAULT_MAX_CONCURRENT = 4;
const MIN_MAX_CONCURRENT = 1;
const MAX_MAX_CONCURRENT = 8;

type AgentMeshInlineCardProps = { conversationId: string };

const belongsToConversation = (sessionId: string, conversationId: string): boolean =>
  sessionId === conversationId ||
  sessionId.startsWith(`${conversationId}:team:`) ||
  sessionId.includes(`:team:${conversationId}:`);

const clampConcurrency = (value: number): number =>
  Math.max(MIN_MAX_CONCURRENT, Math.min(MAX_MAX_CONCURRENT, Math.trunc(value || DEFAULT_MAX_CONCURRENT)));

const readConcurrencyPreference = (): number => {
  try {
    return clampConcurrency(Number(window.localStorage.getItem(CONCURRENCY_STORAGE_KEY)));
  } catch {
    return DEFAULT_MAX_CONCURRENT;
  }
};

const AgentMeshInlineCard: React.FC<AgentMeshInlineCardProps> = ({ conversationId }) => {
  const { t } = useTranslation();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [overview, setOverview] = useState<AgentMeshOverview | null>(null);
  const [snapshot, setSnapshot] = useState<AgentMeshSnapshot | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<AgentInspection | null>(null);
  const [worklog, setWorklog] = useState<AgentWorklogEntry[]>([]);
  const [controlMode, setControlMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [maxConcurrent, setMaxConcurrent] = useState(readConcurrencyPreference);

  const selectableAgents = useMemo(() => overview?.agents.filter((item) => item.agentId !== 'user') ?? [], [overview]);
  const activeCount = selectableAgents.filter((item) => ACTIVE_STATUSES.has(item.status)).length;
  const queuedCount = selectableAgents.reduce((total, item) => total + item.queuedMessages, 0);
  const stuckCount = selectableAgents.filter((item) => item.stuck).length;
  const leaderId = useMemo(
    () => snapshot?.agents.find((agent) => agent.agentId === 'leader')?.agentId ?? null,
    [snapshot]
  );

  const applyOverview = useCallback((next: AgentMeshOverview): void => {
    setOverview(next);
    setSelectedAgentId((current) => {
      const selectable = next.agents.filter((item) => item.agentId !== 'user');
      if (current && selectable.some((item) => item.agentId === current)) return current;
      return (
        selectable.find((item) => ACTIVE_STATUSES.has(item.status))?.agentId ??
        selectable.find((item) => item.agentId === 'leader')?.agentId ??
        selectable[0]?.agentId ??
        null
      );
    });
  }, []);

  const discover = useCallback(async (): Promise<void> => {
    if (document.visibilityState === 'hidden') return;
    try {
      const sessions = await agentMeshClient.sessions();
      const candidate = sessions.toReversed().find((id) => belongsToConversation(id, conversationId));
      if (!candidate) {
        setSessionId(null);
        setOverview(null);
        return;
      }
      const result = await agentMeshClient.overview(candidate);
      if (!result.ok) return;
      setSessionId(candidate);
      applyOverview(result.data);
    } catch {
      // Team is optional for normal single-agent conversations.
    }
  }, [applyOverview, conversationId]);

  const refreshOverview = useCallback(async (): Promise<void> => {
    if (!sessionId || document.visibilityState === 'hidden') return;
    try {
      const result = await agentMeshClient.overview(sessionId);
      if (result.ok) applyOverview(result.data);
    } catch {
      // Preserve the last lightweight state while the optional bridge recovers.
    }
  }, [applyOverview, sessionId]);

  const refreshControl = useCallback(async (): Promise<void> => {
    if (!sessionId || !selectedAgentId || document.visibilityState === 'hidden') return;
    try {
      const [overviewResult, snapshotResult, inspectResult, logResult] = await Promise.all([
        agentMeshClient.overview(sessionId),
        agentMeshClient.snapshot(sessionId),
        agentMeshClient.inspect({ sessionId, agentId: selectedAgentId }),
        agentMeshClient.worklog(sessionId, selectedAgentId),
      ]);
      if (overviewResult.ok) applyOverview(overviewResult.data);
      if (snapshotResult.ok) setSnapshot(snapshotResult.data);
      setInspection(inspectResult.ok ? inspectResult.data : null);
      setWorklog(logResult.ok ? logResult.data : []);
    } catch {
      // Preserve the last control state while the optional bridge recovers.
    }
  }, [applyOverview, selectedAgentId, sessionId]);

  const chatMessages = useMemo(() => {
    if (!snapshot || !selectedAgentId) return [];
    return snapshot.messages
      .filter(
        (message) =>
          (message.fromAgentId === 'user' && message.toAgentId === selectedAgentId) ||
          (message.fromAgentId === selectedAgentId && message.toAgentId === 'user')
      )
      .slice(-MAX_CHAT_MESSAGES);
  }, [selectedAgentId, snapshot]);

  const mutate = useCallback(
    async (operation: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> => {
      setBusy(true);
      try {
        const result = await operation();
        if (!result.ok) {
          Message.error(result.error || t('ide.agentMesh.actionFailed'));
          return false;
        }
        await refreshControl();
        return true;
      } catch {
        Message.error(t('ide.agentMesh.actionFailed'));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refreshControl, t]
  );

  const removeMessage = (message: AgentMessage): void => {
    if (!sessionId || !leaderId || !inspection) return;
    void mutate(() =>
      agentMeshClient.removeQueue({
        sessionId,
        actorId: leaderId,
        targetId: inspection.agent.agentId,
        messageId: message.messageId,
      })
    );
  };

  const moveMessage = (message: AgentMessage, direction: -1 | 1): void => {
    if (!sessionId || !leaderId || !inspection) return;
    const queue = inspection.queue.filter((item) => item.status === 'queued');
    const index = queue.findIndex((item) => item.messageId === message.messageId);
    if (index < 0 || index + direction < 0 || index + direction >= queue.length) return;
    const beforeMessageId = direction < 0 ? queue[index - 1]?.messageId : queue[index + 2]?.messageId;
    void mutate(() =>
      agentMeshClient.reorderQueue({
        sessionId,
        actorId: leaderId,
        targetId: inspection.agent.agentId,
        messageId: message.messageId,
        beforeMessageId,
      })
    );
  };

  const stopTask = (mode: 'graceful' | 'interrupt' | 'cancel'): void => {
    if (!sessionId || !leaderId || !inspection?.task) return;
    void mutate(() => agentMeshClient.stop({ sessionId, actorId: leaderId, taskId: inspection.task!.taskId, mode }));
  };

  const sendMessage = async (): Promise<void> => {
    const content = draft.trim();
    if (!content || !sessionId || !selectedAgentId || busy) return;
    const delivery = inspection && ACTIVE_STATUSES.has(inspection.status) ? 'enqueue-after-task' : 'send-now';
    const sent = await mutate(() =>
      agentMeshClient.send({
        sessionId,
        fromAgentId: 'user',
        toAgentId: selectedAgentId,
        kind: 'question',
        content,
        delivery,
      })
    );
    if (sent) setDraft('');
  };

  const updateConcurrency = async (value: number): Promise<void> => {
    const next = clampConcurrency(value);
    setMaxConcurrent(next);
    try {
      window.localStorage.setItem(CONCURRENCY_STORAGE_KEY, String(next));
    } catch {
      // Persistence is best effort; Main still receives the live preference.
    }
    const result = await agentMeshClient.setConcurrencyPolicy(next).catch((): null => null);
    if (result?.ok === false) Message.error(result.error || t('ide.agentMesh.actionFailed'));
  };

  const controlPanel = useMemo(
    () =>
      !controlMode ? null : (
        <div className='flex flex-col gap-14px' data-testid='agent-mesh-control-panel'>
          <section className='rd-10px border border-arco-2 bg-fill-1 p-10px'>
            <div className='flex items-center justify-between gap-12px'>
              <div>
                <div className='text-12px font-600 text-t-primary'>
                  {t('ide.agentMesh.maxConcurrent', { defaultValue: 'Parallel agent limit' })}
                </div>
                <div className='mt-2px text-10px text-t-tertiary'>
                  {t('ide.agentMesh.maxConcurrentHint', {
                    defaultValue: 'Default 4. The Core may lower this when the machine is under pressure.',
                  })}
                </div>
              </div>
              <InputNumber
                min={MIN_MAX_CONCURRENT}
                max={MAX_MAX_CONCURRENT}
                value={maxConcurrent}
                onChange={(value) => void updateConcurrency(Number(value))}
                className='w-82px'
              />
            </div>
          </section>

          <div className='flex flex-wrap items-center gap-6px'>
            {selectableAgents.map((item) => (
              <Button
                key={item.agentId}
                size='small'
                type={selectedAgentId === item.agentId ? 'primary' : 'secondary'}
                status={item.stuck ? 'danger' : 'default'}
                onClick={() => setSelectedAgentId(item.agentId)}
              >
                {item.agentId}
              </Button>
            ))}
            <Tag size='small'>
              {t('ide.agentMesh.summary', {
                agents: selectableAgents.length,
                active: activeCount,
                queued: queuedCount,
              })}
            </Tag>
          </div>

          {!inspection ? (
            <div className='py-24px flex-center'>
              <Spin />
            </div>
          ) : (
            <>
              <section className='rd-10px border border-arco-2 bg-fill-1 p-12px'>
                <div className='flex items-start justify-between gap-12px'>
                  <div className='min-w-0'>
                    <div className='text-13px font-600 text-t-primary'>{inspection.agent.agentId}</div>
                    <div className='mt-3px text-11px text-t-secondary'>
                      {inspection.task?.objective ?? t('ide.agentMesh.idle')}
                    </div>
                  </div>
                  <Tag size='small' color={inspection.stuck ? 'red' : 'arcoblue'}>
                    {inspection.status}
                  </Tag>
                </div>
                {inspection.currentAction ? (
                  <div className='mt-10px rd-8px bg-2 px-10px py-8px'>
                    <div className='text-11px font-600 text-t-primary'>{inspection.currentAction.name}</div>
                    {inspection.currentAction.detail ? (
                      <div className='mt-2px max-h-72px overflow-y-auto whitespace-pre-wrap text-11px text-t-secondary'>
                        {inspection.currentAction.detail}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {inspection.task && ACTIVE_STATUSES.has(inspection.status) ? (
                  <div className='mt-10px flex flex-wrap gap-6px'>
                    <Button
                      size='mini'
                      loading={busy}
                      icon={<PauseOne size={13} />}
                      onClick={() => stopTask('graceful')}
                    >
                      {t('ide.agentMesh.finishStep')}
                    </Button>
                    <Button size='mini' status='warning' loading={busy} onClick={() => stopTask('interrupt')}>
                      {t('ide.agentMesh.stopNow')}
                    </Button>
                    <Button size='mini' status='danger' loading={busy} onClick={() => stopTask('cancel')}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                ) : null}
              </section>

              <section className='rd-10px border border-arco-2 p-10px'>
                <div className='mb-8px text-12px font-600 text-t-primary'>{t('team.workspace.nav.communication')}</div>
                <div className='max-h-240px min-h-80px overflow-y-auto rd-8px bg-fill-1 p-8px'>
                  {chatMessages.length === 0 ? (
                    <Empty description={t('team.noMessages')} />
                  ) : (
                    <div className='flex flex-col gap-7px'>
                      {chatMessages.map((message) => {
                        const fromUser = message.fromAgentId === 'user';
                        return (
                          <div key={message.messageId} className={`flex ${fromUser ? 'justify-end' : 'justify-start'}`}>
                            <div
                              className={`max-w-85% rd-9px px-9px py-7px text-11px whitespace-pre-wrap ${
                                fromUser ? 'bg-primary-light-2 text-t-primary' : 'bg-2 text-t-secondary'
                              }`}
                            >
                              {message.content}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className='mt-8px flex items-end gap-6px'>
                  <Input.TextArea
                    value={draft}
                    onChange={setDraft}
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    disabled={busy}
                  />
                  <Button
                    type='primary'
                    size='small'
                    loading={busy}
                    disabled={!draft.trim()}
                    onClick={() => void sendMessage()}
                  >
                    {t('common.send')}
                  </Button>
                </div>
              </section>

              <section>
                <div className='mb-6px text-12px font-600 text-t-primary'>{t('ide.agentMesh.queueTitle')}</div>
                {inspection.queue.filter((message) => message.status === 'queued').length === 0 ? (
                  <Empty description={t('ide.agentMesh.queueEmpty')} />
                ) : (
                  <div className='flex flex-col gap-6px'>
                    {inspection.queue
                      .filter((message) => message.status === 'queued')
                      .map((message, index, queue) => (
                        <div
                          key={message.messageId}
                          className='flex items-start gap-6px rd-8px border border-arco-2 p-8px'
                        >
                          <Input.TextArea
                            autoSize={{ minRows: 1, maxRows: 4 }}
                            defaultValue={message.content}
                            onBlur={(value) => {
                              if (!sessionId || !leaderId || value.target.value === message.content) return;
                              void mutate(() =>
                                agentMeshClient.updateQueue({
                                  sessionId,
                                  actorId: leaderId,
                                  targetId: inspection.agent.agentId,
                                  messageId: message.messageId,
                                  patch: { content: value.target.value },
                                })
                              );
                            }}
                          />
                          <div className='flex shrink-0 flex-col gap-2px'>
                            <Tooltip content={t('ide.agentMesh.moveUp')} mini>
                              <Button
                                type='text'
                                size='mini'
                                disabled={index === 0 || busy}
                                icon={<Up size={12} />}
                                onClick={() => moveMessage(message, -1)}
                              />
                            </Tooltip>
                            <Tooltip content={t('ide.agentMesh.moveDown')} mini>
                              <Button
                                type='text'
                                size='mini'
                                disabled={index === queue.length - 1 || busy}
                                icon={<Down size={12} />}
                                onClick={() => moveMessage(message, 1)}
                              />
                            </Tooltip>
                            <Tooltip content={t('common.delete')} mini>
                              <Button
                                type='text'
                                size='mini'
                                status='danger'
                                disabled={busy}
                                icon={<Delete size={12} />}
                                onClick={() => removeMessage(message)}
                              />
                            </Tooltip>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </section>

              <section>
                <div className='mb-6px text-12px font-600 text-t-primary'>{t('ide.agentMesh.worklogTitle')}</div>
                {worklog.length === 0 ? (
                  <Empty description={t('ide.agentMesh.worklogEmpty')} />
                ) : (
                  <div className='max-h-220px overflow-y-auto rd-8px border border-arco-2'>
                    {worklog.toReversed().map((entry) => (
                      <div key={entry.sequence} className='border-b border-b-1 px-10px py-7px last:border-b-0'>
                        <div className='flex items-center justify-between gap-8px text-10px text-t-tertiary'>
                          <span>
                            {entry.agentId} · {entry.kind}
                          </span>
                          <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div className='mt-2px whitespace-pre-wrap text-11px text-t-secondary'>{entry.summary}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      ),
    [
      activeCount,
      busy,
      chatMessages,
      controlMode,
      draft,
      inspection,
      leaderId,
      maxConcurrent,
      mutate,
      queuedCount,
      selectableAgents,
      selectedAgentId,
      sessionId,
      t,
      worklog,
    ]
  );

  const overviewPanel = useMemo(
    () => (
      <div className='flex flex-col gap-12px' data-testid='agent-mesh-overview-panel'>
        <div className='flex items-center justify-between gap-10px'>
          <div className='text-11px text-t-secondary'>
            {t('ide.agentMesh.summary', {
              agents: selectableAgents.length,
              active: activeCount,
              queued: queuedCount,
            })}
          </div>
          <Button
            size='small'
            type={controlMode ? 'primary' : 'secondary'}
            onClick={() => setControlMode((value) => !value)}
            data-testid='agent-mesh-control-button'
          >
            {controlMode
              ? t('ide.agentMesh.simpleView', { defaultValue: 'Simple' })
              : t('ide.agentMesh.control', { defaultValue: 'Control' })}
          </Button>
        </div>

        {!overview ? (
          <div className='py-24px flex-center'>
            <Spin />
          </div>
        ) : selectableAgents.length === 0 ? (
          <Empty description={t('ide.agentMesh.idle')} />
        ) : (
          <div className='flex flex-col gap-7px'>
            {selectableAgents.map((agent) => (
              <section key={agent.agentId} className='rd-10px border border-arco-2 bg-fill-1 px-10px py-9px'>
                <div className='flex items-center justify-between gap-8px'>
                  <span className='min-w-0 truncate text-12px font-600 text-t-primary'>{agent.agentId}</span>
                  <Tag
                    size='small'
                    color={agent.stuck ? 'red' : ACTIVE_STATUSES.has(agent.status) ? 'arcoblue' : 'gray'}
                  >
                    {agent.status}
                  </Tag>
                </div>
                <div className='mt-4px line-clamp-2 text-11px text-t-secondary'>
                  {agent.objective ?? t('ide.agentMesh.idle')}
                </div>
                {agent.currentAction ? (
                  <div className='mt-6px rd-7px bg-2 px-8px py-6px'>
                    <div className='text-10px font-600 text-t-primary'>{agent.currentAction.name}</div>
                    {agent.currentAction.detail ? (
                      <div className='mt-1px line-clamp-2 text-10px text-t-tertiary'>{agent.currentAction.detail}</div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        )}

        {controlPanel}
      </div>
    ),
    [activeCount, controlMode, controlPanel, overview, queuedCount, selectableAgents, t]
  );

  const dockItem = useMemo<ChatDockItem>(
    () => ({
      id: 'team',
      label: t('ide.agentMesh.title'),
      icon: <Robot theme='outline' size={14} />,
      mode: 'panel',
      order: 20,
      visible: selectableAgents.length > 0,
      badge: activeCount,
      attentionBadge: stuckCount,
      panelTitle: t('ide.agentMesh.drawerTitle'),
      panelWidth: controlMode ? 560 : 420,
      panel: overviewPanel,
      testId: 'agent-mesh-clip',
    }),
    [activeCount, controlMode, overviewPanel, selectableAgents.length, stuckCount, t]
  );
  const { isOpen } = useChatDockItem(dockItem);

  useEffect(() => {
    setSessionId(null);
    setOverview(null);
    setSnapshot(null);
    setSelectedAgentId(null);
    setInspection(null);
    setWorklog([]);
    setControlMode(false);
    setDraft('');
    void discover();
  }, [conversationId, discover]);

  useEffect(() => {
    void agentMeshClient.setConcurrencyPolicy(maxConcurrent).catch((): undefined => undefined);
  }, []);

  useEffect(() => {
    if (isOpen) return;
    setControlMode(false);
    setSnapshot(null);
    setInspection(null);
    setWorklog([]);
    const timer = setInterval(() => void discover(), CLOSED_POLL_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void discover();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [discover, isOpen]);

  useEffect(() => {
    if (!isOpen || controlMode) return;
    void refreshOverview();
    const timer = setInterval(() => void refreshOverview(), OVERVIEW_POLL_MS);
    return () => clearInterval(timer);
  }, [controlMode, isOpen, refreshOverview]);

  useEffect(() => {
    if (!isOpen || !controlMode || !sessionId || !selectedAgentId) return;
    setInspection(null);
    void refreshControl();
    const timer = setInterval(() => void refreshControl(), CONTROL_POLL_MS);
    return () => clearInterval(timer);
  }, [controlMode, isOpen, refreshControl, selectedAgentId, sessionId]);

  return null;
};

export default AgentMeshInlineCard;
