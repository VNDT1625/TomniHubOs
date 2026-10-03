import {
  Avatar,
  Button,
  Empty,
  Input,
  Message,
  Modal,
  Progress,
  Radio,
  Select,
  Tag,
  Tooltip,
} from '@arco-design/web-react';
import { AddOne, CheckOne, Delete, FolderOpen, Link, Plus, Search, SettingTwo, TreeDiagram } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { teamEditClient } from '@package-apps/ide/renderer/teamEdit/teamEditClient';
import type {
  IdeTeamGroup,
  IdeTeamTask,
  IdeTeamTaskStatus,
  TeamEditSnapshot,
} from '@package-apps/ide/renderer/teamEdit/teamEditClient';
import { USER_AGENT_ID } from '@package-apps/ide/renderer/teamEdit/useTeamEdit';
import {
  directChildren,
  formatDateTime,
  groupPath,
  initials,
  participantById,
  TASK_STATUS_COLORS,
  TASK_STATUS_KEYS,
  taskDepth,
  taskProgress,
  toTaskInput,
} from '@package-apps/ide/renderer/teamEdit/components/teamWorkspaceUtils';
import styles from '@package-apps/ide/renderer/teamEdit/components/TeamWorkspace.module.css';

type TaskView = 'list' | 'board' | 'mine';

type Props = {
  rootPath: string;
  snapshot: TeamEditSnapshot | null;
  readOnly: boolean;
  onRefresh: () => Promise<void>;
};

type TaskDraft = {
  title: string;
  description: string;
  scope: 'personal' | 'group';
  groupId: string | null;
  parentTaskId: string | null;
  assigneeId: string | null;
  pinnedAgentId: string | null;
};

const EMPTY_TASK_DRAFT: TaskDraft = {
  title: '',
  description: '',
  scope: 'personal',
  groupId: null,
  parentTaskId: null,
  assigneeId: null,
  pinnedAgentId: null,
};

const resultError = (result: { ok: true } | { ok: false; error: string } | null): string | undefined =>
  result && 'error' in result ? result.error : undefined;

const shortTaskId = (task: IdeTeamTask): string => task.id.slice(0, 7).toUpperCase();

const TasksWorkspace: React.FC<Props> = ({ rootPath, snapshot, readOnly, onRefresh }) => {
  const { t } = useTranslation();
  const tasks = snapshot?.tasks ?? [];
  const groups = snapshot?.groups ?? [];
  const participants = snapshot?.participants ?? [];
  const agents = participants.filter((participant) => !participant.isUser);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(tasks[0]?.id ?? null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [view, setView] = useState<TaskView>('list');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<IdeTeamTaskStatus | 'all'>('all');
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(EMPTY_TASK_DRAFT);
  const [groupName, setGroupName] = useState('');
  const [parentGroupId, setParentGroupId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (selectedTaskId && !tasks.some((task) => task.id === selectedTaskId)) setSelectedTaskId(tasks[0]?.id ?? null);
    if (!selectedTaskId && tasks[0]) setSelectedTaskId(tasks[0].id);
  }, [selectedTaskId, tasks]);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const groupOptions = groups.map((group) => ({ label: group.name, value: group.id }));
  const taskOptions = tasks.map((task) => ({ label: task.title, value: task.id }));
  const participantOptions = participants.map((participant) => ({
    label: participant.label,
    value: participant.agentId,
  }));
  const agentOptions = agents.map((participant) => ({ label: participant.label, value: participant.agentId }));

  const filteredTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return tasks
      .filter((task) => (selectedGroupId ? task.groupId === selectedGroupId : true))
      .filter((task) => (statusFilter === 'all' ? true : task.status === statusFilter))
      .filter((task) =>
        view === 'mine' ? task.assigneeId === USER_AGENT_ID || task.creatorId === USER_AGENT_ID : true
      )
      .filter((task) => `${task.title} ${task.description}`.toLowerCase().includes(normalizedQuery))
      .toSorted((left, right) => {
        const depthDifference = taskDepth(left, tasks) - taskDepth(right, tasks);
        return depthDifference === 0 ? right.updatedAt - left.updatedAt : depthDifference;
      });
  }, [query, selectedGroupId, statusFilter, tasks, view]);

  const createTask = async () => {
    if (!taskDraft.title.trim()) {
      Message.warning(t('ide.team.workspace.taskTitleRequired'));
      return;
    }
    setSaving(true);
    const result = await teamEditClient
      .saveTask(rootPath, {
        title: taskDraft.title.trim(),
        description: taskDraft.description.trim(),
        scope: taskDraft.scope,
        groupId: taskDraft.scope === 'group' ? taskDraft.groupId : null,
        parentTaskId: taskDraft.parentTaskId,
        creatorId: USER_AGENT_ID,
        assigneeId: taskDraft.assigneeId,
        pinnedAgentId: taskDraft.pinnedAgentId,
        status: 'todo',
      })
      .catch((): null => null);
    setSaving(false);
    if (!result?.ok) {
      Message.error(resultError(result) ?? t('common.unknownError'));
      return;
    }
    setTaskModalOpen(false);
    setTaskDraft(EMPTY_TASK_DRAFT);
    setSelectedTaskId(result.data.id);
    await onRefresh();
  };

  const createGroup = async () => {
    if (!groupName.trim()) {
      Message.warning(t('ide.team.workspace.groupNameRequired'));
      return;
    }
    setSaving(true);
    const result = await teamEditClient
      .saveGroup(rootPath, { name: groupName.trim(), parentGroupId, memberIds: [] })
      .catch((): null => null);
    setSaving(false);
    if (!result?.ok) {
      Message.error(resultError(result) ?? t('common.unknownError'));
      return;
    }
    setGroupModalOpen(false);
    setGroupName('');
    setParentGroupId(null);
    setSelectedGroupId(result.data.id);
    await onRefresh();
  };

  const updateTask = async (task: IdeTeamTask, updates: Partial<IdeTeamTask>) => {
    const result = await teamEditClient
      .saveTask(rootPath, toTaskInput({ ...task, ...updates }))
      .catch((): null => null);
    if (!result?.ok) {
      Message.error(resultError(result) ?? t('common.unknownError'));
      return;
    }
    await onRefresh();
  };

  const removeTask = async (task: IdeTeamTask) => {
    Modal.confirm({
      title: t('ide.team.workspace.tasksView.deleteTaskTitle'),
      content: t('ide.team.workspace.tasksView.deleteTaskConfirm', { title: task.title }),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        const result = await teamEditClient.removeTask(rootPath, task.id).catch((): null => null);
        if (!result?.ok) {
          Message.error(resultError(result) ?? t('common.unknownError'));
          return;
        }
        await onRefresh();
      },
    });
  };

  const removeGroup = async (group: IdeTeamGroup) => {
    Modal.confirm({
      title: t('ide.team.workspace.tasksView.deleteGroupTitle'),
      content: t('ide.team.workspace.tasksView.deleteGroupConfirm', { name: group.name }),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        const result = await teamEditClient.removeGroup(rootPath, group.id).catch((): null => null);
        if (!result?.ok) {
          Message.error(resultError(result) ?? t('common.unknownError'));
          return;
        }
        if (selectedGroupId === group.id) setSelectedGroupId(null);
        await onRefresh();
      },
    });
  };

  return (
    <div className={`${styles.body} flex-1`}>
      <div className={styles.threeColumn}>
        <aside className={styles.panel}>
          <div className={styles.panelHeader}>
            <TreeDiagram size={15} className='text-primary' />
            <span className='font-650 text-13px text-t-primary'>{t('ide.team.workspace.tasksView.organization')}</span>
            <div className='flex-1' />
            <Tooltip content={t('ide.team.workspace.createGroup')} mini>
              <Button
                type='text'
                size='mini'
                icon={<AddOne size={14} />}
                disabled={readOnly}
                onClick={() => setGroupModalOpen(true)}
              />
            </Tooltip>
          </div>
          <div className={styles.panelScroll}>
            <div className={styles.panelSection}>
              <Button
                type={selectedGroupId === null ? 'primary' : 'text'}
                long
                className='!justify-start'
                icon={<FolderOpen size={14} />}
                onClick={() => setSelectedGroupId(null)}
              >
                {t('ide.team.workspace.tasksView.allWorkspace')}
              </Button>
            </div>
            <div className={styles.panelSection}>
              {groups.length === 0 ? (
                <Empty description={t('ide.team.workspace.tasksView.noGroups')} />
              ) : (
                <GroupTree
                  groups={groups}
                  tasks={tasks}
                  selectedGroupId={selectedGroupId}
                  onSelect={setSelectedGroupId}
                  onDelete={readOnly ? undefined : removeGroup}
                />
              )}
            </div>
            <div className={styles.panelSection}>
              <div className='mb-8px text-11px font-650 uppercase tracking-wide text-t-tertiary'>
                {t('ide.team.workspace.tasksView.people')} · {participants.length}
              </div>
              <div className='flex flex-col gap-3px'>
                {participants.slice(0, 8).map((participant) => (
                  <div key={participant.agentId} className={styles.listItem}>
                    <Avatar size={26}>{initials(participant.label)}</Avatar>
                    <span className='min-w-0 flex-1 truncate text-12px text-t-primary'>{participant.label}</span>
                    <Tag size='small' color={participant.isUser ? 'arcoblue' : 'green'}>
                      {participant.isUser
                        ? t('ide.team.workspace.tasksView.member')
                        : t('ide.team.workspace.tasksView.agent')}
                    </Tag>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <main className={styles.panel}>
          <div className={styles.panelHeader}>
            <Radio.Group type='button' size='small' value={view} onChange={(value) => setView(value as TaskView)}>
              <Radio value='list'>{t('ide.team.workspace.tasksView.list')}</Radio>
              <Radio value='board'>{t('ide.team.workspace.tasksView.board')}</Radio>
              <Radio value='mine'>{t('ide.team.workspace.tasksView.myTasks')}</Radio>
            </Radio.Group>
            <div className='flex-1' />
            <Button
              type='primary'
              size='small'
              icon={<Plus size={13} />}
              disabled={readOnly}
              onClick={() => {
                setTaskDraft({
                  ...EMPTY_TASK_DRAFT,
                  scope: selectedGroupId ? 'group' : 'personal',
                  groupId: selectedGroupId,
                });
                setTaskModalOpen(true);
              }}
            >
              {t('ide.team.workspace.newTask')}
            </Button>
          </div>
          <div className='flex h-[48px] items-center gap-8px border-b border-b-1 px-12px'>
            <Input
              size='small'
              prefix={<Search size={13} />}
              value={query}
              onChange={setQuery}
              placeholder={t('ide.team.workspace.tasksView.searchPlaceholder')}
              style={{ minWidth: 210, maxWidth: 340 }}
            />
            <Select
              size='small'
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as IdeTeamTaskStatus | 'all')}
              style={{ width: 152 }}
              options={[
                { value: 'all', label: t('ide.team.workspace.tasksView.allStatuses') },
                ...Object.keys(TASK_STATUS_KEYS).map((status) => ({
                  value: status,
                  label: t(TASK_STATUS_KEYS[status as IdeTeamTaskStatus]),
                })),
              ]}
            />
            <div className='flex-1' />
            <Tag>{filteredTasks.length}</Tag>
          </div>

          <div className='h-[calc(100%-94px)] overflow-auto'>
            {filteredTasks.length === 0 ? (
              <div className={styles.emptyState}>
                <Empty description={t('ide.team.workspace.noTasks')} />
              </div>
            ) : view === 'board' ? (
              <TaskBoard
                tasks={filteredTasks}
                allTasks={tasks}
                participants={participants}
                selectedTaskId={selectedTaskId}
                onSelect={setSelectedTaskId}
              />
            ) : (
              <>
                <div className={`${styles.taskRow} ${styles.taskHeader}`}>
                  <span>{t('ide.team.workspace.tasksView.task')}</span>
                  <span>{t('ide.team.workspace.tasksView.owner')}</span>
                  <span>{t('ide.team.workspace.tasksView.executor')}</span>
                  <span>{t('ide.team.workspace.tasksView.progress')}</span>
                  <span>{t('ide.team.workspace.tasksView.status')}</span>
                </div>
                {filteredTasks.map((task) => {
                  const assignee = participantById(participants, task.assigneeId);
                  const pinned = participantById(participants, task.pinnedAgentId);
                  const progress = taskProgress(task, tasks);
                  const children = directChildren(task.id, tasks);
                  return (
                    <Button
                      key={task.id}
                      type='text'
                      long
                      className={`!h-auto !p-0 !text-left ${styles.taskRow} ${
                        task.id === selectedTaskId ? styles.taskRowActive : ''
                      }`}
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <span className='min-w-0'>
                        <span className='flex items-center gap-6px'>
                          <Tag size='small'>{shortTaskId(task)}</Tag>
                          <span className='truncate text-12px font-650 text-t-primary'>{task.title}</span>
                        </span>
                        <span className='mt-3px block truncate text-10px text-t-tertiary'>
                          {task.description || t('ide.team.workspace.tasksView.noDescription')}
                        </span>
                      </span>
                      <span className='inline-flex min-w-0 items-center gap-6px text-11px text-t-secondary'>
                        <Avatar size={22}>{initials(assignee?.label ?? t('ide.team.workspace.unassigned'))}</Avatar>
                        <span className='truncate'>{assignee?.label ?? t('ide.team.workspace.unassigned')}</span>
                      </span>
                      <span className='inline-flex min-w-0 items-center gap-6px text-11px text-t-secondary'>
                        {pinned ? (
                          <>
                            <span className='size-22px rd-7px bg-fill-2 flex-center text-primary'>AI</span>
                            <span className='truncate'>{pinned.label}</span>
                          </>
                        ) : (
                          <span className='text-t-tertiary'>{t('ide.team.workspace.tasksView.noAgent')}</span>
                        )}
                      </span>
                      <span className='min-w-0'>
                        <span className='mb-3px flex items-center justify-between text-10px text-t-tertiary'>
                          <span>{progress}%</span>
                          {children.length > 0 ? (
                            <span>
                              {children.filter((child) => child.status === 'done').length}/{children.length}
                            </span>
                          ) : null}
                        </span>
                        <Progress percent={progress} size='small' showText={false} />
                      </span>
                      <span>
                        <Tag size='small' color={TASK_STATUS_COLORS[task.status]}>
                          {t(TASK_STATUS_KEYS[task.status])}
                        </Tag>
                      </span>
                    </Button>
                  );
                })}
              </>
            )}
          </div>
        </main>

        <TaskInspector
          task={selectedTask}
          tasks={tasks}
          groups={groups}
          participants={participants}
          readOnly={readOnly}
          onUpdate={updateTask}
          onDelete={removeTask}
        />
      </div>

      <Modal
        title={t('ide.team.workspace.newTask')}
        visible={taskModalOpen}
        confirmLoading={saving}
        okText={t('ide.team.workspace.createTask')}
        cancelText={t('common.cancel')}
        onCancel={() => setTaskModalOpen(false)}
        onOk={() => void createTask()}
      >
        <div className='flex flex-col gap-10px'>
          <Input
            value={taskDraft.title}
            onChange={(title) => setTaskDraft((draft) => ({ ...draft, title }))}
            placeholder={t('ide.team.workspace.taskTitlePlaceholder')}
          />
          <Input.TextArea
            value={taskDraft.description}
            onChange={(description) => setTaskDraft((draft) => ({ ...draft, description }))}
            autoSize={{ minRows: 3, maxRows: 6 }}
            placeholder={t('ide.team.workspace.taskDescriptionPlaceholder')}
          />
          <Radio.Group
            type='button'
            value={taskDraft.scope}
            onChange={(scope) => setTaskDraft((draft) => ({ ...draft, scope: scope as 'personal' | 'group' }))}
          >
            <Radio value='personal'>{t('ide.team.workspace.personalTask')}</Radio>
            <Radio value='group'>{t('ide.team.workspace.groupTask')}</Radio>
          </Radio.Group>
          {taskDraft.scope === 'group' ? (
            <Select
              allowClear
              value={taskDraft.groupId ?? undefined}
              options={groupOptions}
              placeholder={t('ide.team.workspace.selectGroup')}
              onChange={(groupId) => setTaskDraft((draft) => ({ ...draft, groupId: groupId ?? null }))}
            />
          ) : null}
          <Select
            allowClear
            value={taskDraft.parentTaskId ?? undefined}
            options={taskOptions}
            placeholder={t('ide.team.workspace.parentTask')}
            onChange={(parentTaskId) => setTaskDraft((draft) => ({ ...draft, parentTaskId: parentTaskId ?? null }))}
          />
          <Select
            allowClear
            value={taskDraft.assigneeId ?? undefined}
            options={participantOptions}
            placeholder={t('ide.team.workspace.assignee')}
            onChange={(assigneeId) => setTaskDraft((draft) => ({ ...draft, assigneeId: assigneeId ?? null }))}
          />
          <Select
            allowClear
            value={taskDraft.pinnedAgentId ?? undefined}
            options={agentOptions}
            placeholder={t('ide.team.workspace.pinAgent')}
            onChange={(pinnedAgentId) => setTaskDraft((draft) => ({ ...draft, pinnedAgentId: pinnedAgentId ?? null }))}
          />
        </div>
      </Modal>

      <Modal
        title={t('ide.team.workspace.createGroup')}
        visible={groupModalOpen}
        confirmLoading={saving}
        okText={t('ide.team.workspace.createGroup')}
        cancelText={t('common.cancel')}
        onCancel={() => setGroupModalOpen(false)}
        onOk={() => void createGroup()}
      >
        <div className='flex flex-col gap-10px'>
          <Input value={groupName} onChange={setGroupName} placeholder={t('ide.team.workspace.groupNamePlaceholder')} />
          <Select
            allowClear
            value={parentGroupId ?? undefined}
            options={groupOptions}
            placeholder={t('ide.team.workspace.parentGroup')}
            onChange={(value) => setParentGroupId(value ?? null)}
          />
        </div>
      </Modal>
    </div>
  );
};

const GroupTree: React.FC<{
  groups: IdeTeamGroup[];
  tasks: IdeTeamTask[];
  selectedGroupId: string | null;
  parentId?: string | null;
  depth?: number;
  onSelect: (id: string) => void;
  onDelete?: (group: IdeTeamGroup) => void;
}> = ({ groups, tasks, selectedGroupId, parentId = null, depth = 0, onSelect, onDelete }) => {
  const { t } = useTranslation();
  const children = groups.filter((group) => group.parentGroupId === parentId);
  return (
    <div className='flex flex-col gap-2px'>
      {children.map((group) => (
        <React.Fragment key={group.id}>
          <div className='flex items-center gap-3px' style={{ paddingLeft: depth * 14 }}>
            <Button
              type={selectedGroupId === group.id ? 'secondary' : 'text'}
              long
              size='small'
              className='!justify-start !min-w-0'
              icon={<FolderOpen size={13} />}
              onClick={() => onSelect(group.id)}
            >
              <span className='truncate'>{group.name}</span>
              <Tag size='small' className='ml-auto'>
                {tasks.filter((task) => task.groupId === group.id).length}
              </Tag>
            </Button>
            {onDelete ? (
              <Tooltip content={t('ide.team.workspace.tasksView.delete')} mini>
                <Button
                  type='text'
                  size='mini'
                  status='danger'
                  icon={<Delete size={12} />}
                  onClick={() => onDelete(group)}
                />
              </Tooltip>
            ) : null}
          </div>
          <GroupTree
            groups={groups}
            tasks={tasks}
            selectedGroupId={selectedGroupId}
            parentId={group.id}
            depth={depth + 1}
            onSelect={onSelect}
            onDelete={onDelete}
          />
        </React.Fragment>
      ))}
    </div>
  );
};

const TaskBoard: React.FC<{
  tasks: IdeTeamTask[];
  allTasks: IdeTeamTask[];
  participants: TeamEditSnapshot['participants'];
  selectedTaskId: string | null;
  onSelect: (id: string) => void;
}> = ({ tasks, allTasks, participants, selectedTaskId, onSelect }) => {
  const { t } = useTranslation();
  return (
    <div className='grid min-w-900px grid-cols-4 gap-8px p-10px'>
      {(Object.keys(TASK_STATUS_KEYS) as IdeTeamTaskStatus[]).map((status) => {
        const statusTasks = tasks.filter((task) => task.status === status);
        return (
          <div key={status} className='min-w-0 rd-10px border border-solid border-b-1 bg-fill-1 p-8px'>
            <div className='mb-8px flex items-center gap-6px'>
              <Tag color={TASK_STATUS_COLORS[status]}>{t(TASK_STATUS_KEYS[status])}</Tag>
              <span className='ml-auto text-11px text-t-tertiary'>{statusTasks.length}</span>
            </div>
            <div className='flex flex-col gap-7px'>
              {statusTasks.map((task) => {
                const owner = participantById(participants, task.assigneeId);
                return (
                  <Button
                    key={task.id}
                    type='text'
                    long
                    className={`!h-auto !justify-start !whitespace-normal !p-9px !text-left rd-9px border border-solid ${
                      task.id === selectedTaskId ? 'border-primary bg-primary-light-1' : 'border-b-1 bg-2'
                    }`}
                    onClick={() => onSelect(task.id)}
                  >
                    <span className='block min-w-0'>
                      <span className='flex items-center gap-5px'>
                        <Tag size='small'>{shortTaskId(task)}</Tag>
                        <span className='truncate text-11px font-650 text-t-primary'>{task.title}</span>
                      </span>
                      <span className='mt-7px flex items-center gap-6px'>
                        <Avatar size={20}>{initials(owner?.label ?? '?')}</Avatar>
                        <span className='truncate text-10px text-t-tertiary'>
                          {owner?.label ?? t('ide.team.workspace.unassigned')}
                        </span>
                        <span className='ml-auto text-10px text-t-tertiary'>{taskProgress(task, allTasks)}%</span>
                      </span>
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const TaskInspector: React.FC<{
  task: IdeTeamTask | null;
  tasks: IdeTeamTask[];
  groups: IdeTeamGroup[];
  participants: TeamEditSnapshot['participants'];
  readOnly: boolean;
  onUpdate: (task: IdeTeamTask, updates: Partial<IdeTeamTask>) => Promise<void>;
  onDelete: (task: IdeTeamTask) => Promise<void>;
}> = ({ task, tasks, groups, participants, readOnly, onUpdate, onDelete }) => {
  const { t } = useTranslation();
  if (!task) {
    return (
      <aside className={styles.panel}>
        <div className={styles.panelHeader}>
          <SettingTwo size={15} />
          <span className='font-650 text-13px text-t-primary'>{t('ide.team.workspace.tasksView.details')}</span>
        </div>
        <div className={styles.emptyState}>
          <Empty description={t('ide.team.workspace.tasksView.selectTask')} />
        </div>
      </aside>
    );
  }

  const assignee = participantById(participants, task.assigneeId);
  const pinned = participantById(participants, task.pinnedAgentId);
  const children = directChildren(task.id, tasks);
  const parent = tasks.find((candidate) => candidate.id === task.parentTaskId);
  const path = groupPath(task.groupId, groups);
  const progress = taskProgress(task, tasks);
  const participantOptions = participants.map((participant) => ({
    label: participant.label,
    value: participant.agentId,
  }));
  const agentOptions = participants
    .filter((participant) => !participant.isUser)
    .map((participant) => ({ label: participant.label, value: participant.agentId }));

  return (
    <aside className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className='font-650 text-13px text-t-primary'>{t('ide.team.workspace.tasksView.details')}</span>
        <div className='flex-1' />
        <Tooltip content={t('common.delete')} mini>
          <Button
            type='text'
            size='mini'
            status='danger'
            icon={<Delete size={13} />}
            disabled={readOnly}
            onClick={() => void onDelete(task)}
          />
        </Tooltip>
      </div>
      <div className={styles.panelScroll}>
        <div className={styles.detailHero}>
          <div className='flex items-center gap-7px'>
            <Tag size='small'>{shortTaskId(task)}</Tag>
            <Tag size='small' color={TASK_STATUS_COLORS[task.status]}>
              {t(TASK_STATUS_KEYS[task.status])}
            </Tag>
          </div>
          <div className='mt-9px text-16px font-750 text-t-primary'>{task.title}</div>
          <div className='mt-6px whitespace-pre-wrap text-11px leading-18px text-t-secondary'>
            {task.description || t('ide.team.workspace.tasksView.noDescription')}
          </div>
        </div>

        <div className={styles.panelSection}>
          <InspectorRow label={t('ide.team.workspace.tasksView.status')}>
            <Select
              size='mini'
              value={task.status}
              disabled={readOnly}
              style={{ width: '100%' }}
              options={(Object.keys(TASK_STATUS_KEYS) as IdeTeamTaskStatus[]).map((status) => ({
                value: status,
                label: t(TASK_STATUS_KEYS[status]),
              }))}
              onChange={(status) => void onUpdate(task, { status: status as IdeTeamTaskStatus })}
            />
          </InspectorRow>
          <InspectorRow label={t('ide.team.workspace.tasksView.owner')}>
            <Select
              size='mini'
              allowClear
              value={task.assigneeId ?? undefined}
              disabled={readOnly}
              style={{ width: '100%' }}
              options={participantOptions}
              placeholder={t('ide.team.workspace.unassigned')}
              onChange={(assigneeId) => void onUpdate(task, { assigneeId: assigneeId ?? null })}
            />
          </InspectorRow>
          <InspectorRow label={t('ide.team.workspace.tasksView.group')}>
            <span>{path.length > 0 ? path.join(' / ') : t('ide.team.workspace.tasksView.noGroup')}</span>
          </InspectorRow>
          <InspectorRow label={t('ide.team.workspace.tasksView.parent')}>
            <span>{parent?.title ?? t('ide.team.workspace.tasksView.noParent')}</span>
          </InspectorRow>
          <InspectorRow label={t('ide.team.workspace.tasksView.updated')}>
            <span>{formatDateTime(task.updatedAt)}</span>
          </InspectorRow>
        </div>

        <div className={styles.panelSection}>
          <div className='mb-8px flex items-center gap-6px'>
            <Link size={14} className='text-primary' />
            <span className='text-11px font-650 uppercase tracking-wide text-t-tertiary'>
              {t('ide.team.workspace.tasksView.pinnedAgent')}
            </span>
          </div>
          <Select
            allowClear
            value={task.pinnedAgentId ?? undefined}
            options={agentOptions}
            disabled={readOnly}
            placeholder={t('ide.team.workspace.pinAgent')}
            onChange={(pinnedAgentId) => void onUpdate(task, { pinnedAgentId: pinnedAgentId ?? null })}
          />
          {pinned ? (
            <div className='mt-8px flex items-center gap-8px rd-9px border border-solid border-b-1 bg-fill-1 p-9px'>
              <span className='size-28px rd-9px bg-primary-light-1 flex-center text-primary font-700'>AI</span>
              <div className='min-w-0 flex-1'>
                <div className='truncate text-12px font-650 text-t-primary'>{pinned.label}</div>
                <div className='text-10px text-success'>{t('ide.team.workspace.tasksView.taskContextActive')}</div>
              </div>
            </div>
          ) : null}
        </div>

        <div className={styles.panelSection}>
          <div className='mb-8px flex items-center gap-6px'>
            <CheckOne size={14} className='text-success' />
            <span className='text-11px font-650 uppercase tracking-wide text-t-tertiary'>
              {t('ide.team.workspace.tasksView.progress')}
            </span>
            <span className='ml-auto text-11px font-650 text-t-primary'>{progress}%</span>
          </div>
          <Progress percent={progress} showText={false} />
          <div className='mt-10px flex flex-col gap-5px'>
            {children.length === 0 ? (
              <div className='text-11px text-t-tertiary'>{t('ide.team.workspace.tasksView.noSubtasks')}</div>
            ) : (
              children.map((child) => (
                <div key={child.id} className='flex items-center gap-7px text-11px'>
                  <CheckOne size={13} className={child.status === 'done' ? 'text-success' : 'text-t-tertiary'} />
                  <span className={child.status === 'done' ? 'text-t-tertiary line-through' : 'text-t-secondary'}>
                    {child.title}
                  </span>
                  <Tag size='small' color={TASK_STATUS_COLORS[child.status]} className='ml-auto'>
                    {t(TASK_STATUS_KEYS[child.status])}
                  </Tag>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={styles.panelSection}>
          <div className='mb-8px text-11px font-650 uppercase tracking-wide text-t-tertiary'>
            {t('ide.team.workspace.tasksView.accountability')}
          </div>
          <div className='flex items-center gap-8px'>
            <Avatar size={28}>{initials(assignee?.label ?? t('ide.team.workspace.unassigned'))}</Avatar>
            <div className='min-w-0'>
              <div className='truncate text-12px font-650 text-t-primary'>
                {assignee?.label ?? t('ide.team.workspace.unassigned')}
              </div>
              <div className='text-10px text-t-tertiary'>{t('ide.team.workspace.tasksView.responsibleOwner')}</div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};

const InspectorRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className='grid grid-cols-[78px_minmax(0,1fr)] items-center gap-9px py-5px text-11px'>
    <span className='text-t-tertiary'>{label}</span>
    <span className='min-w-0 text-t-primary'>{children}</span>
  </div>
);

export default TasksWorkspace;
