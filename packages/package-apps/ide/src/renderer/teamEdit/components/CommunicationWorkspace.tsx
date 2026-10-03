import { Avatar, Button, Empty, Input, Message, Select, Tag, Tooltip } from '@arco-design/web-react';
import { AtSign, Communication, FileEditingOne, Link, ListView, People, Send, Star, Time } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IdeTeamTask, TeamEditSnapshot } from '@package-apps/ide/renderer/teamEdit/teamEditClient';
import { teamEditClient } from '@package-apps/ide/renderer/teamEdit/teamEditClient';
import { USER_AGENT_ID } from '@package-apps/ide/renderer/teamEdit/useTeamEdit';
import {
  formatDateTime,
  groupPath,
  initials,
  participantById,
  TASK_STATUS_COLORS,
  TASK_STATUS_KEYS,
  taskProgress,
} from '@package-apps/ide/renderer/teamEdit/components/teamWorkspaceUtils';
import styles from '@package-apps/ide/renderer/teamEdit/components/TeamWorkspace.module.css';

type Channel = { type: 'general' } | { type: 'task'; taskId: string };

type Props = {
  rootPath: string;
  snapshot: TeamEditSnapshot | null;
  readOnly: boolean;
  onRefresh: () => Promise<void>;
};

const CommunicationWorkspace: React.FC<Props> = ({ rootPath, snapshot, readOnly, onRefresh }) => {
  const { t } = useTranslation();
  const messages = snapshot?.messages ?? [];
  const tasks = snapshot?.tasks ?? [];
  const groups = snapshot?.groups ?? [];
  const participants = snapshot?.participants ?? [];
  const activity = snapshot?.activity ?? [];
  const [channel, setChannel] = useState<Channel>({ type: 'general' });
  const [body, setBody] = useState('');
  const [linkedTaskId, setLinkedTaskId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const selectedTask = channel.type === 'task' ? (tasks.find((task) => task.id === channel.taskId) ?? null) : null;
  const visibleMessages = messages.filter((message) =>
    channel.type === 'general' ? message.taskId === null : message.taskId === channel.taskId
  );
  const sortedMessages = visibleMessages.toSorted((left, right) => left.createdAt - right.createdAt);
  const taskThreadCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const message of messages) {
      if (message.taskId) counts.set(message.taskId, (counts.get(message.taskId) ?? 0) + 1);
    }
    return counts;
  }, [messages]);

  const sendMessage = async () => {
    if (!body.trim()) return;
    setSending(true);
    const taskId = channel.type === 'task' ? channel.taskId : linkedTaskId;
    const result = await teamEditClient
      .postMessage(rootPath, USER_AGENT_ID, body.trim(), taskId)
      .catch((): null => null);
    setSending(false);
    if (!result?.ok) {
      Message.error(result && 'error' in result ? result.error : t('common.unknownError'));
      return;
    }
    setBody('');
    if (channel.type === 'general') setLinkedTaskId(null);
    await onRefresh();
  };

  const title =
    channel.type === 'general'
      ? t('ide.team.workspace.communicationView.general')
      : (selectedTask?.title ?? t('ide.team.workspace.communicationView.taskThread'));

  return (
    <div className={`${styles.body} flex-1`}>
      <div className={styles.threeColumn}>
        <aside className={styles.panel}>
          <div className={styles.panelHeader}>
            <Communication size={15} className='text-primary' />
            <span className='font-650 text-13px text-t-primary'>{t('ide.team.workspace.communicationView.title')}</span>
          </div>
          <div className={styles.panelScroll}>
            <div className={styles.panelSection}>
              <div className='mb-7px text-10px font-650 uppercase tracking-wide text-t-tertiary'>
                {t('ide.team.workspace.communicationView.workspaceChannels')}
              </div>
              <Button
                type={channel.type === 'general' ? 'primary' : 'text'}
                long
                className='!justify-start'
                icon={<Communication size={13} />}
                onClick={() => setChannel({ type: 'general' })}
              >
                {t('ide.team.workspace.communicationView.general')}
                <Tag size='small' className='ml-auto'>
                  {messages.filter((message) => message.taskId === null).length}
                </Tag>
              </Button>
            </div>

            <div className={styles.panelSection}>
              <div className='mb-7px flex items-center gap-6px text-10px font-650 uppercase tracking-wide text-t-tertiary'>
                <ListView size={12} />
                {t('ide.team.workspace.communicationView.taskThreads')}
              </div>
              {tasks.length === 0 ? (
                <div className='text-11px text-t-tertiary'>{t('ide.team.workspace.communicationView.noThreads')}</div>
              ) : (
                <div className='flex flex-col gap-2px'>
                  {tasks.slice(0, 12).map((task) => {
                    const active = channel.type === 'task' && channel.taskId === task.id;
                    return (
                      <Button
                        key={task.id}
                        type={active ? 'secondary' : 'text'}
                        long
                        size='small'
                        className='!justify-start !min-w-0'
                        onClick={() => setChannel({ type: 'task', taskId: task.id })}
                      >
                        <Tag size='small'>{task.id.slice(0, 6).toUpperCase()}</Tag>
                        <span className='truncate'>{task.title}</span>
                        {(taskThreadCounts.get(task.id) ?? 0) > 0 ? (
                          <Tag size='small' color='orange' className='ml-auto'>
                            {taskThreadCounts.get(task.id)}
                          </Tag>
                        ) : null}
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className={styles.panelSection}>
              <div className='mb-7px flex items-center gap-6px text-10px font-650 uppercase tracking-wide text-t-tertiary'>
                <People size={12} />
                {t('ide.team.workspace.communicationView.people')}
              </div>
              <div className='flex flex-col gap-2px'>
                {participants.map((participant) => (
                  <div key={participant.agentId} className={styles.listItem}>
                    <Avatar size={26}>{initials(participant.label)}</Avatar>
                    <div className='min-w-0 flex-1'>
                      <div className='truncate text-11px font-600 text-t-primary'>{participant.label}</div>
                      <div className='text-9px text-t-tertiary'>
                        {participant.isUser
                          ? t('ide.team.workspace.communicationView.member')
                          : t('ide.team.workspace.communicationView.agent')}
                      </div>
                    </div>
                    <span className='size-7px rd-full bg-success' aria-hidden />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <main className={`${styles.panel} flex flex-col`}>
          <div className={styles.panelHeader}>
            <span className='size-26px rd-8px bg-fill-2 flex-center text-primary'>
              {channel.type === 'general' ? <Communication size={14} /> : <ListView size={14} />}
            </span>
            <div className='min-w-0'>
              <div className='flex items-center gap-6px'>
                <span className='truncate text-13px font-700 text-t-primary'>{title}</span>
                <Star size={13} className='text-t-tertiary' />
              </div>
              <div className='truncate text-10px text-t-tertiary'>
                {channel.type === 'general'
                  ? t('ide.team.workspace.communicationView.generalSubtitle')
                  : t('ide.team.workspace.communicationView.taskSubtitle')}
              </div>
            </div>
            <div className='flex-1' />
            <div className='flex -space-x-5px'>
              {participants.slice(0, 4).map((participant) => (
                <Avatar key={participant.agentId} size={23} className='border border-solid border-bg-1'>
                  {initials(participant.label)}
                </Avatar>
              ))}
            </div>
            <Tag size='small'>{participants.length}</Tag>
          </div>

          <div className='flex-1 min-h-0 overflow-auto px-10px py-8px'>
            {sortedMessages.length === 0 ? (
              <div className={styles.emptyState}>
                <Empty description={t('ide.team.workspace.noMessages')} />
              </div>
            ) : (
              <div className='flex flex-col gap-2px'>
                {sortedMessages.map((message) => {
                  const sender = participantById(participants, message.senderId);
                  const linkedTask = tasks.find((task) => task.id === message.taskId);
                  return (
                    <div key={message.id} className={styles.messageRow}>
                      <Avatar size={32}>{initials(sender?.label ?? message.senderId)}</Avatar>
                      <div className='min-w-0'>
                        <div className='flex flex-wrap items-center gap-6px'>
                          <span className='text-12px font-700 text-t-primary'>{sender?.label ?? message.senderId}</span>
                          {!sender?.isUser && sender ? (
                            <Tag size='small' color='arcoblue'>
                              AI
                            </Tag>
                          ) : null}
                          <span className='text-9px text-t-tertiary'>{formatDateTime(message.createdAt)}</span>
                        </div>
                        <div className='mt-4px whitespace-pre-wrap text-12px leading-18px text-t-secondary'>
                          {message.body}
                        </div>
                        {linkedTask ? (
                          <Button
                            size='mini'
                            type='text'
                            className='!mt-4px !px-0'
                            icon={<Link size={11} />}
                            onClick={() => setChannel({ type: 'task', taskId: linkedTask.id })}
                          >
                            {linkedTask.title}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className={styles.composer}>
            <Input.TextArea
              value={body}
              onChange={setBody}
              disabled={readOnly}
              autoSize={{ minRows: 2, maxRows: 4 }}
              placeholder={t('ide.team.workspace.communicationView.messagePlaceholder', { channel: title })}
              className='!border-0 !bg-transparent'
            />
            <div className='mt-5px flex items-center gap-5px'>
              <Tooltip content={t('ide.team.workspace.communicationView.mention')} mini>
                <Button type='text' size='mini' icon={<AtSign size={14} />} />
              </Tooltip>
              <Tooltip content={t('ide.team.workspace.communicationView.linkTask')} mini>
                <Button type='text' size='mini' icon={<Link size={14} />} />
              </Tooltip>
              {channel.type === 'general' ? (
                <Select
                  allowClear
                  size='mini'
                  value={linkedTaskId ?? undefined}
                  placeholder={t('ide.team.workspace.linkTask')}
                  style={{ width: 180 }}
                  options={tasks.map((task) => ({ value: task.id, label: task.title }))}
                  onChange={(value) => setLinkedTaskId(value ?? null)}
                />
              ) : null}
              <div className='flex-1' />
              <Button
                type='primary'
                size='small'
                icon={<Send size={13} />}
                loading={sending}
                disabled={readOnly || !body.trim()}
                onClick={() => void sendMessage()}
              >
                {t('common.send')}
              </Button>
            </div>
          </div>
        </main>

        <ConversationInspector
          selectedTask={selectedTask}
          tasks={tasks}
          groups={groups}
          participants={participants}
          messages={messages}
          activity={activity}
          onSelectTask={(task) => setChannel({ type: 'task', taskId: task.id })}
        />
      </div>
    </div>
  );
};

const ConversationInspector: React.FC<{
  selectedTask: IdeTeamTask | null;
  tasks: IdeTeamTask[];
  groups: TeamEditSnapshot['groups'];
  participants: TeamEditSnapshot['participants'];
  messages: TeamEditSnapshot['messages'];
  activity: TeamEditSnapshot['activity'];
  onSelectTask: (task: IdeTeamTask) => void;
}> = ({ selectedTask, tasks, groups, participants, messages, activity, onSelectTask }) => {
  const { t } = useTranslation();
  const relatedMessages = selectedTask ? messages.filter((message) => message.taskId === selectedTask.id) : messages;
  const owner = selectedTask ? participantById(participants, selectedTask.assigneeId) : undefined;
  const pinned = selectedTask ? participantById(participants, selectedTask.pinnedAgentId) : undefined;
  const path = selectedTask ? groupPath(selectedTask.groupId, groups) : [];

  return (
    <aside className={styles.panel}>
      <div className={styles.panelHeader}>
        <Communication size={15} />
        <span className='font-650 text-13px text-t-primary'>
          {selectedTask
            ? t('ide.team.workspace.communicationView.threadDetails')
            : t('ide.team.workspace.communicationView.channelDetails')}
        </span>
      </div>
      <div className={styles.panelScroll}>
        <div className={styles.detailHero}>
          <div className='text-13px font-700 text-t-primary'>
            {selectedTask?.title ?? t('ide.team.workspace.communicationView.general')}
          </div>
          <div className='mt-5px text-10px leading-16px text-t-secondary'>
            {selectedTask?.description || t('ide.team.workspace.communicationView.generalDescription')}
          </div>
          <div className='mt-9px flex items-center gap-6px'>
            <Tag size='small'>
              {relatedMessages.length} {t('ide.team.workspace.communicationView.messagesShort')}
            </Tag>
            {selectedTask ? (
              <Tag size='small' color={TASK_STATUS_COLORS[selectedTask.status]}>
                {t(TASK_STATUS_KEYS[selectedTask.status])}
              </Tag>
            ) : null}
          </div>
        </div>

        <div className={styles.panelSection}>
          <div className='mb-8px text-10px font-650 uppercase tracking-wide text-t-tertiary'>
            {t('ide.team.workspace.communicationView.participants')}
          </div>
          <div className='flex flex-wrap gap-5px'>
            {participants.map((participant) => (
              <Tooltip key={participant.agentId} content={participant.label} mini>
                <Avatar size={26}>{initials(participant.label)}</Avatar>
              </Tooltip>
            ))}
          </div>
        </div>

        {selectedTask ? (
          <div className={styles.panelSection}>
            <div className='mb-8px flex items-center gap-6px text-10px font-650 uppercase tracking-wide text-t-tertiary'>
              <ListView size={12} />
              {t('ide.team.workspace.communicationView.relatedTask')}
            </div>
            <div className='rd-9px border border-solid border-b-1 bg-fill-1 p-9px'>
              <div className='flex items-center gap-6px'>
                <Tag size='small'>{selectedTask.id.slice(0, 6).toUpperCase()}</Tag>
                <span className='truncate text-12px font-650 text-t-primary'>{selectedTask.title}</span>
              </div>
              <div className='mt-8px flex items-center gap-7px'>
                <ProgressLine percent={taskProgress(selectedTask, tasks)} />
                <span className='text-10px text-t-tertiary'>{taskProgress(selectedTask, tasks)}%</span>
              </div>
              <div className='mt-8px grid grid-cols-[62px_1fr] gap-x-7px gap-y-5px text-10px'>
                <span className='text-t-tertiary'>{t('ide.team.workspace.tasksView.owner')}</span>
                <span className='truncate text-t-primary'>{owner?.label ?? t('ide.team.workspace.unassigned')}</span>
                <span className='text-t-tertiary'>{t('ide.team.workspace.tasksView.group')}</span>
                <span className='truncate text-t-primary'>
                  {path.join(' / ') || t('ide.team.workspace.tasksView.noGroup')}
                </span>
                <span className='text-t-tertiary'>{t('ide.team.workspace.tasksView.executor')}</span>
                <span className='truncate text-t-primary'>
                  {pinned?.label ?? t('ide.team.workspace.tasksView.noAgent')}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.panelSection}>
            <div className='mb-8px text-10px font-650 uppercase tracking-wide text-t-tertiary'>
              {t('ide.team.workspace.communicationView.activeThreads')}
            </div>
            <div className='flex flex-col gap-5px'>
              {tasks.slice(0, 5).map((task) => (
                <Button
                  key={task.id}
                  type='text'
                  long
                  size='small'
                  className='!justify-start'
                  onClick={() => onSelectTask(task)}
                >
                  <Tag size='small'>{task.id.slice(0, 6).toUpperCase()}</Tag>
                  <span className='truncate'>{task.title}</span>
                  <Tag size='small' className='ml-auto'>
                    {messages.filter((message) => message.taskId === task.id).length}
                  </Tag>
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className={styles.panelSection}>
          <div className='mb-8px flex items-center gap-6px text-10px font-650 uppercase tracking-wide text-t-tertiary'>
            <Time size={12} />
            {t('ide.team.workspace.communicationView.recentNotifications')}
          </div>
          <div className='flex flex-col gap-7px'>
            {activity
              .toReversed()
              .slice(0, 5)
              .map((item) => (
                <div key={item.seq} className='flex items-start gap-7px text-10px'>
                  <span className='mt-2px size-20px rd-6px bg-fill-2 flex-center text-primary shrink-0'>
                    {item.relPath ? <FileEditingOne size={11} /> : <People size={11} />}
                  </span>
                  <div className='min-w-0 flex-1'>
                    <div className='truncate text-t-secondary'>{item.agentId}</div>
                    <div className='truncate text-t-tertiary'>{item.relPath ?? item.kind}</div>
                  </div>
                  <span className='whitespace-nowrap text-t-tertiary'>{formatDateTime(item.at)}</span>
                </div>
              ))}
            {activity.length === 0 ? <div className='text-11px text-t-tertiary'>{t('ide.team.noActivity')}</div> : null}
          </div>
        </div>
      </div>
    </aside>
  );
};

const ProgressLine: React.FC<{ percent: number }> = ({ percent }) => (
  <span className='h-4px flex-1 overflow-hidden rd-full bg-fill-3'>
    <span className='block h-full bg-primary' style={{ width: `${percent}%` }} />
  </span>
);

export default CommunicationWorkspace;
