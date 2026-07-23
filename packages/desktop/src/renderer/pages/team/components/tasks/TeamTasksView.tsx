import { ipcBridge } from '@/common';
import type {
  TeamTask,
  TeamTaskBindingRole,
  TeamTaskInput,
  TeamTaskPriority,
  TeamTaskScope,
  TeamTaskStatus,
  TeamWorkspaceGroup,
  TeamWorkspaceGroupInput,
  TTeam,
} from '@/common/types/team/teamTypes';
import {
  Button,
  Card,
  Empty,
  Input,
  Message,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
} from '@arco-design/web-react';
import { Delete, Edit, Link, Plus, Unlink } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSWRConfig } from 'swr';
import {
  actorKey,
  actorLabel,
  groupDepth,
  orderedGroups,
  orderedTasks,
  parseActorKey,
  taskDepth,
} from './taskViewUtils';

const { TextArea } = Input;
const { Text } = Typography;
const Option = Select.Option;

type TaskFilter = 'mine' | 'group' | 'all';

type TaskDraft = {
  id?: string;
  title: string;
  description: string;
  scope: TeamTaskScope;
  groupId: string | null;
  parentTaskId: string | null;
  assigneeKey: string;
  sharedKeys: string[];
  status: TeamTaskStatus;
  priority: TeamTaskPriority;
  acceptanceText: string;
  contextText: string;
};

type GroupDraft = {
  id?: string;
  name: string;
  parentGroupId: string | null;
  memberIds: string[];
};

type PinDraft = {
  taskId: string;
  slotId: string;
  role: TeamTaskBindingRole;
};

const STATUS_KEYS = {
  draft: 'team.workspace.tasks.status.draft',
  ready: 'team.workspace.tasks.status.ready',
  running: 'team.workspace.tasks.status.running',
  blocked: 'team.workspace.tasks.status.blocked',
  review: 'team.workspace.tasks.status.review',
  needs_changes: 'team.workspace.tasks.status.needsChanges',
  done: 'team.workspace.tasks.status.done',
  cancelled: 'team.workspace.tasks.status.cancelled',
} as const satisfies Record<TeamTaskStatus, string>;

const PRIORITY_KEYS = {
  low: 'team.workspace.tasks.priority.low',
  medium: 'team.workspace.tasks.priority.medium',
  high: 'team.workspace.tasks.priority.high',
  critical: 'team.workspace.tasks.priority.critical',
} as const satisfies Record<TeamTaskPriority, string>;

const ROLE_KEYS = {
  planner: 'team.workspace.tasks.role.planner',
  executor: 'team.workspace.tasks.role.executor',
  reviewer: 'team.workspace.tasks.role.reviewer',
  tester: 'team.workspace.tasks.role.tester',
  advisor: 'team.workspace.tasks.role.advisor',
} as const satisfies Record<TeamTaskBindingRole, string>;

const SCOPE_KEYS = {
  personal: 'team.workspace.tasks.scope.personal',
  group: 'team.workspace.tasks.scope.group',
} as const satisfies Record<TeamTaskScope, string>;

const STATUSES = Object.keys(STATUS_KEYS) as TeamTaskStatus[];
const PRIORITIES = Object.keys(PRIORITY_KEYS) as TeamTaskPriority[];
const BINDING_ROLES = Object.keys(ROLE_KEYS) as TeamTaskBindingRole[];

const emptyTaskDraft = (): TaskDraft => ({
  title: '',
  description: '',
  scope: 'personal',
  groupId: null,
  parentTaskId: null,
  assigneeKey: '',
  sharedKeys: [],
  status: 'draft',
  priority: 'medium',
  acceptanceText: '',
  contextText: '',
});

const draftFromTask = (task: TeamTask): TaskDraft => ({
  id: task.id,
  title: task.title,
  description: task.description,
  scope: task.scope,
  groupId: task.group_id,
  parentTaskId: task.parent_task_id,
  assigneeKey: task.assignee ? actorKey(task.assignee) : '',
  sharedKeys: task.shared_with.map(actorKey),
  status: task.status,
  priority: task.priority,
  acceptanceText: task.acceptance_criteria.join('\n'),
  contextText: task.context_hints.join('\n'),
});

const draftFromGroup = (group: TeamWorkspaceGroup): GroupDraft => ({
  id: group.id,
  name: group.name,
  parentGroupId: group.parent_group_id,
  memberIds: group.member_ids,
});

const splitLines = (value: string): string[] =>
  value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);

const TeamTasksView: React.FC<{ team: TTeam }> = ({ team }) => {
  const { t } = useTranslation();
  const { mutate } = useSWRConfig();
  const groups = team.groups ?? [];
  const tasks = team.tasks ?? [];
  const bindings = team.task_bindings ?? [];
  const [filter, setFilter] = useState<TaskFilter>('mine');
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [pinDraft, setPinDraft] = useState<PinDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const orderedGroupList = useMemo(() => orderedGroups(groups), [groups]);
  const orderedTaskList = useMemo(() => orderedTasks(tasks), [tasks]);
  const visibleTasks = useMemo(() => {
    if (filter === 'all') return orderedTaskList;
    if (filter === 'group') return orderedTaskList.filter((task) => task.scope === 'group');
    return orderedTaskList.filter(
      (task) =>
        task.scope === 'personal' ||
        (task.assignee?.kind === 'user' && task.assignee.id === team.user_id) ||
        (task.owner.kind === 'user' && task.owner.id === team.user_id)
    );
  }, [filter, orderedTaskList, team.user_id]);

  const actorOptions = useMemo(
    () => [
      { key: `user:${team.user_id}`, label: t('team.workspace.tasks.currentUser') },
      ...team.agents.map((agent) => ({ key: `agent:${agent.slot_id}`, label: agent.agent_name })),
      ...groups.map((group) => ({ key: `group:${group.id}`, label: group.name })),
    ],
    [groups, t, team.agents, team.user_id]
  );

  const applyTeam = async (next: TTeam) => {
    await mutate(`team/${team.id}`, next, false);
  };

  const saveTask = async () => {
    if (!taskDraft) return;
    if (!taskDraft.title.trim()) {
      Message.warning(t('team.workspace.tasks.validation.title'));
      return;
    }
    if (taskDraft.scope === 'group' && !taskDraft.groupId) {
      Message.warning(t('team.workspace.tasks.validation.group'));
      return;
    }
    setSaving(true);
    try {
      const groupOwner =
        taskDraft.scope === 'group' && taskDraft.groupId ? { kind: 'group' as const, id: taskDraft.groupId } : null;
      const input: TeamTaskInput = {
        ...(taskDraft.id ? { id: taskDraft.id } : {}),
        title: taskDraft.title.trim(),
        description: taskDraft.description.trim(),
        scope: taskDraft.scope,
        group_id: taskDraft.scope === 'group' ? taskDraft.groupId : null,
        parent_task_id: taskDraft.parentTaskId,
        creator_id: team.user_id,
        owner: groupOwner ?? { kind: 'user', id: team.user_id },
        assignee: taskDraft.assigneeKey ? parseActorKey(taskDraft.assigneeKey) : null,
        shared_with: taskDraft.sharedKeys
          .map(parseActorKey)
          .filter((actor): actor is NonNullable<typeof actor> => actor != null),
        reviewer_ids: [],
        acceptance_criteria: splitLines(taskDraft.acceptanceText),
        context_hints: splitLines(taskDraft.contextText),
        status: taskDraft.status,
        priority: taskDraft.priority,
      };
      const next = await ipcBridge.team.saveTask.invoke({ team_id: team.id, task: input });
      await applyTeam(next);
      setTaskDraft(null);
      Message.success(t('common.saveSuccess'));
    } catch (error) {
      Message.error(String(error));
    } finally {
      setSaving(false);
    }
  };

  const saveGroup = async () => {
    if (!groupDraft) return;
    if (!groupDraft.name.trim()) {
      Message.warning(t('team.workspace.tasks.validation.groupName'));
      return;
    }
    setSaving(true);
    try {
      const input: TeamWorkspaceGroupInput = {
        ...(groupDraft.id ? { id: groupDraft.id } : {}),
        name: groupDraft.name.trim(),
        parent_group_id: groupDraft.parentGroupId,
        member_ids: groupDraft.memberIds,
      };
      const next = await ipcBridge.team.saveGroup.invoke({ team_id: team.id, group: input });
      await applyTeam(next);
      setGroupDraft(null);
      Message.success(t('common.saveSuccess'));
    } catch (error) {
      Message.error(String(error));
    } finally {
      setSaving(false);
    }
  };

  const removeTask = async (taskId: string) => {
    try {
      const next = await ipcBridge.team.removeTask.invoke({ team_id: team.id, task_id: taskId });
      await applyTeam(next);
      Message.success(t('common.deleteSuccess'));
    } catch (error) {
      Message.error(String(error));
    }
  };

  const removeGroup = async (groupId: string) => {
    try {
      const next = await ipcBridge.team.removeGroup.invoke({ team_id: team.id, group_id: groupId });
      await applyTeam(next);
      Message.success(t('common.deleteSuccess'));
    } catch (error) {
      Message.error(String(error));
    }
  };

  const updateStatus = async (task: TeamTask, status: TeamTaskStatus) => {
    const { created_at: _createdAt, updated_at: _updatedAt, ...taskInput } = task;
    const input: TeamTaskInput = { ...taskInput, status };
    try {
      const next = await ipcBridge.team.saveTask.invoke({ team_id: team.id, task: input });
      await applyTeam(next);
    } catch (error) {
      Message.error(String(error));
    }
  };

  const pinTask = async () => {
    if (!pinDraft?.slotId) {
      Message.warning(t('team.workspace.tasks.validation.agent'));
      return;
    }
    setSaving(true);
    try {
      const next = await ipcBridge.team.bindTask.invoke({
        team_id: team.id,
        task_id: pinDraft.taskId,
        slot_id: pinDraft.slotId,
        role: pinDraft.role,
        is_primary: true,
      });
      await applyTeam(next);
      setPinDraft(null);
      Message.success(t('team.workspace.tasks.pin.success'));
    } catch (error) {
      Message.error(String(error));
    } finally {
      setSaving(false);
    }
  };

  const unpinTask = async (slotId: string, taskId: string) => {
    try {
      const next = await ipcBridge.team.unbindTask.invoke({ team_id: team.id, slot_id: slotId, task_id: taskId });
      await applyTeam(next);
      Message.success(t('team.workspace.tasks.pin.removed'));
    } catch (error) {
      Message.error(String(error));
    }
  };

  const openChildTask = (parent: TeamTask) => {
    setTaskDraft({
      ...emptyTaskDraft(),
      scope: parent.scope,
      groupId: parent.group_id,
      parentTaskId: parent.id,
      priority: parent.priority,
    });
  };

  return (
    <div className='h-full overflow-y-auto bg-1 p-20px'>
      <div className='mx-auto max-w-1180px flex flex-col gap-16px'>
        <div className='flex flex-wrap items-start justify-between gap-12px'>
          <div>
            <div className='text-20px font-700 text-t-primary'>{t('team.workspace.tasks.title')}</div>
            <div className='mt-4px text-13px text-t-secondary'>{t('team.workspace.tasks.subtitle')}</div>
          </div>
          <Space wrap>
            <Button
              icon={<Plus theme='outline' />}
              onClick={() => setGroupDraft({ name: '', parentGroupId: null, memberIds: [] })}
            >
              {t('team.workspace.tasks.newGroup')}
            </Button>
            <Button type='primary' icon={<Plus theme='outline' />} onClick={() => setTaskDraft(emptyTaskDraft())}>
              {t('team.workspace.tasks.newTask')}
            </Button>
          </Space>
        </div>

        <div className='grid grid-cols-2 md:grid-cols-4 gap-10px'>
          {[
            [t('team.workspace.tasks.summary.total'), tasks.length],
            [t('team.workspace.tasks.summary.running'), tasks.filter((task) => task.status === 'running').length],
            [t('team.workspace.tasks.summary.review'), tasks.filter((task) => task.status === 'review').length],
            [t('team.workspace.tasks.summary.bound'), bindings.length],
          ].map(([label, value]) => (
            <Card key={String(label)} size='small' className='border border-solid border-[color:var(--border-base)]'>
              <div className='text-11px uppercase tracking-0.08em text-t-secondary'>{label}</div>
              <div className='mt-4px text-22px font-700 text-t-primary'>{value}</div>
            </Card>
          ))}
        </div>

        <Card
          className='border border-solid border-[color:var(--border-base)]'
          title={t('team.workspace.tasks.groupsTitle')}
        >
          {orderedGroupList.length === 0 ? (
            <Empty description={t('team.workspace.tasks.groupsEmpty')} />
          ) : (
            <div className='flex flex-col gap-6px'>
              {orderedGroupList.map((group) => {
                const depth = groupDepth(group, groups);
                const taskCount = tasks.filter((task) => task.group_id === group.id).length;
                return (
                  <div
                    key={group.id}
                    className='flex items-center gap-8px rd-8px border border-solid border-[color:var(--border-base)] px-10px py-8px bg-2'
                    style={{ marginLeft: depth * 18 }}
                  >
                    <div className='min-w-0 flex-1'>
                      <div className='font-600 text-t-primary truncate'>{group.name}</div>
                      <div className='text-12px text-t-secondary'>
                        {t('team.workspace.tasks.groupMeta', { members: group.member_ids.length, tasks: taskCount })}
                      </div>
                    </div>
                    <Button
                      size='mini'
                      type='text'
                      icon={<Plus theme='outline' />}
                      onClick={() => setGroupDraft({ name: '', parentGroupId: group.id, memberIds: [] })}
                    />
                    <Button
                      size='mini'
                      type='text'
                      icon={<Edit theme='outline' />}
                      onClick={() => setGroupDraft(draftFromGroup(group))}
                    />
                    <Popconfirm
                      title={t('team.workspace.tasks.confirmDeleteGroup')}
                      onOk={() => void removeGroup(group.id)}
                    >
                      <Button size='mini' type='text' status='danger' icon={<Delete theme='outline' />} />
                    </Popconfirm>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div className='flex flex-wrap items-center justify-between gap-10px'>
          <Radio.Group type='button' value={filter} onChange={setFilter}>
            <Radio value='mine'>{t('team.workspace.tasks.filters.mine')}</Radio>
            <Radio value='group'>{t('team.workspace.tasks.filters.group')}</Radio>
            <Radio value='all'>{t('team.workspace.tasks.filters.all')}</Radio>
          </Radio.Group>
          <Text type='secondary'>{t('team.workspace.tasks.visibleCount', { count: visibleTasks.length })}</Text>
        </div>

        {visibleTasks.length === 0 ? (
          <Card className='border border-solid border-[color:var(--border-base)]'>
            <Empty description={t('team.workspace.tasks.empty')} />
          </Card>
        ) : (
          <div className='flex flex-col gap-8px'>
            {visibleTasks.map((task) => {
              const depth = taskDepth(task, tasks);
              const taskBindings = bindings.filter((binding) => binding.task_id === task.id);
              const group = groups.find((candidate) => candidate.id === task.group_id);
              return (
                <Card
                  key={task.id}
                  className='border border-solid border-[color:var(--border-base)] overflow-visible'
                  style={{ marginLeft: Math.min(depth, 4) * 18 }}
                >
                  <div className='flex flex-col gap-10px'>
                    <div className='flex flex-wrap items-start justify-between gap-10px'>
                      <div className='min-w-0 flex-1'>
                        <div className='flex flex-wrap items-center gap-6px'>
                          <span className='font-700 text-15px text-t-primary'>{task.title}</span>
                          <Tag size='small'>{t(STATUS_KEYS[task.status])}</Tag>
                          <Tag size='small' color={task.priority === 'critical' ? 'red' : undefined}>
                            {t(PRIORITY_KEYS[task.priority])}
                          </Tag>
                          <Tag size='small'>{t(SCOPE_KEYS[task.scope])}</Tag>
                        </div>
                        {task.description && (
                          <div className='mt-6px text-13px leading-20px text-t-secondary'>{task.description}</div>
                        )}
                      </div>
                      <Space wrap>
                        <Select
                          size='mini'
                          value={task.status}
                          style={{ width: 130 }}
                          onChange={(status) => void updateStatus(task, status)}
                        >
                          {STATUSES.map((status) => (
                            <Option key={status} value={status}>
                              {t(STATUS_KEYS[status])}
                            </Option>
                          ))}
                        </Select>
                        <Button size='mini' icon={<Plus theme='outline' />} onClick={() => openChildTask(task)}>
                          {t('team.workspace.tasks.childTask')}
                        </Button>
                        <Button
                          size='mini'
                          icon={<Link theme='outline' />}
                          onClick={() => setPinDraft({ taskId: task.id, slotId: '', role: 'executor' })}
                        >
                          {t('team.workspace.tasks.pin.action')}
                        </Button>
                        <Button
                          size='mini'
                          type='text'
                          icon={<Edit theme='outline' />}
                          onClick={() => setTaskDraft(draftFromTask(task))}
                        />
                        <Popconfirm
                          title={t('team.workspace.tasks.confirmDeleteTask')}
                          onOk={() => void removeTask(task.id)}
                        >
                          <Button size='mini' type='text' status='danger' icon={<Delete theme='outline' />} />
                        </Popconfirm>
                      </Space>
                    </div>

                    <div className='flex flex-wrap gap-x-18px gap-y-4px text-12px text-t-secondary'>
                      <span>
                        {t('team.workspace.tasks.meta.owner')}:{' '}
                        {actorLabel(team, task.owner, t('team.workspace.tasks.currentUser'))}
                      </span>
                      <span>
                        {t('team.workspace.tasks.meta.assignee')}:{' '}
                        {actorLabel(team, task.assignee, t('team.workspace.tasks.currentUser'))}
                      </span>
                      {group && (
                        <span>
                          {t('team.workspace.tasks.meta.group')}: {group.name}
                        </span>
                      )}
                      <span>
                        {t('team.workspace.tasks.meta.criteria')}: {task.acceptance_criteria.length}
                      </span>
                    </div>

                    {task.acceptance_criteria.length > 0 && (
                      <div className='rd-8px bg-2 px-10px py-8px'>
                        <div className='mb-4px text-11px font-600 uppercase tracking-0.06em text-t-secondary'>
                          {t('team.workspace.tasks.acceptanceCriteria')}
                        </div>
                        <div className='flex flex-col gap-3px text-12px text-t-primary'>
                          {task.acceptance_criteria.map((criterion) => (
                            <div key={criterion}>• {criterion}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    {taskBindings.length > 0 && (
                      <div className='flex flex-wrap items-center gap-6px'>
                        <span className='text-12px text-t-secondary'>{t('team.workspace.tasks.pin.boundAgents')}</span>
                        {taskBindings.map((binding) => {
                          const agent = team.agents.find((candidate) => candidate.slot_id === binding.slot_id);
                          return (
                            <Tag
                              key={binding.id}
                              closable
                              icon={<Link theme='outline' />}
                              onClose={() => void unpinTask(binding.slot_id, task.id)}
                            >
                              {agent?.agent_name ?? binding.slot_id} · {t(ROLE_KEYS[binding.role])}
                            </Tag>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        visible={taskDraft != null}
        title={taskDraft?.id ? t('team.workspace.tasks.editTask') : t('team.workspace.tasks.newTask')}
        onCancel={() => setTaskDraft(null)}
        onOk={() => void saveTask()}
        confirmLoading={saving}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        style={{ width: 720 }}
      >
        {taskDraft && (
          <div className='grid grid-cols-1 md:grid-cols-2 gap-12px'>
            <div className='md:col-span-2'>
              <div className='mb-4px text-12px text-t-secondary'>{t('team.workspace.tasks.fields.title')}</div>
              <Input value={taskDraft.title} onChange={(title) => setTaskDraft({ ...taskDraft, title })} />
            </div>
            <div className='md:col-span-2'>
              <div className='mb-4px text-12px text-t-secondary'>{t('team.workspace.tasks.fields.description')}</div>
              <TextArea
                autoSize={{ minRows: 3, maxRows: 7 }}
                value={taskDraft.description}
                onChange={(description) => setTaskDraft({ ...taskDraft, description })}
              />
            </div>
            <div>
              <div className='mb-4px text-12px text-t-secondary'>{t('team.workspace.tasks.fields.scope')}</div>
              <Select
                value={taskDraft.scope}
                onChange={(scope) =>
                  setTaskDraft({ ...taskDraft, scope, groupId: scope === 'personal' ? null : taskDraft.groupId })
                }
              >
                <Option value='personal'>{t('team.workspace.tasks.scope.personal')}</Option>
                <Option value='group'>{t('team.workspace.tasks.scope.group')}</Option>
              </Select>
            </div>
            <div>
              <div className='mb-4px text-12px text-t-secondary'>{t('team.workspace.tasks.fields.group')}</div>
              <Select
                allowClear
                disabled={taskDraft.scope !== 'group'}
                value={taskDraft.groupId ?? undefined}
                onChange={(groupId) => setTaskDraft({ ...taskDraft, groupId: groupId ?? null })}
              >
                {orderedGroupList.map((group) => (
                  <Option key={group.id} value={group.id}>
                    {'· '.repeat(groupDepth(group, groups))}
                    {group.name}
                  </Option>
                ))}
              </Select>
            </div>
            <div>
              <div className='mb-4px text-12px text-t-secondary'>{t('team.workspace.tasks.fields.parentTask')}</div>
              <Select
                allowClear
                value={taskDraft.parentTaskId ?? undefined}
                onChange={(parentTaskId) => setTaskDraft({ ...taskDraft, parentTaskId: parentTaskId ?? null })}
              >
                {tasks
                  .filter((task) => task.id !== taskDraft.id)
                  .map((task) => (
                    <Option key={task.id} value={task.id}>
                      {task.title}
                    </Option>
                  ))}
              </Select>
            </div>
            <div>
              <div className='mb-4px text-12px text-t-secondary'>{t('team.workspace.tasks.fields.assignee')}</div>
              <Select
                allowClear
                value={taskDraft.assigneeKey || undefined}
                onChange={(assigneeKey) => setTaskDraft({ ...taskDraft, assigneeKey: assigneeKey ?? '' })}
              >
                {actorOptions.map((option) => (
                  <Option key={option.key} value={option.key}>
                    {option.label}
                  </Option>
                ))}
              </Select>
            </div>
            <div>
              <div className='mb-4px text-12px text-t-secondary'>{t('team.workspace.tasks.fields.status')}</div>
              <Select value={taskDraft.status} onChange={(status) => setTaskDraft({ ...taskDraft, status })}>
                {STATUSES.map((status) => (
                  <Option key={status} value={status}>
                    {t(STATUS_KEYS[status])}
                  </Option>
                ))}
              </Select>
            </div>
            <div>
              <div className='mb-4px text-12px text-t-secondary'>{t('team.workspace.tasks.fields.priority')}</div>
              <Select value={taskDraft.priority} onChange={(priority) => setTaskDraft({ ...taskDraft, priority })}>
                {PRIORITIES.map((priority) => (
                  <Option key={priority} value={priority}>
                    {t(PRIORITY_KEYS[priority])}
                  </Option>
                ))}
              </Select>
            </div>
            <div className='md:col-span-2'>
              <div className='mb-4px text-12px text-t-secondary'>{t('team.workspace.tasks.fields.sharedWith')}</div>
              <Select
                mode='multiple'
                allowClear
                value={taskDraft.sharedKeys}
                onChange={(sharedKeys) => setTaskDraft({ ...taskDraft, sharedKeys })}
              >
                {actorOptions.map((option) => (
                  <Option key={option.key} value={option.key}>
                    {option.label}
                  </Option>
                ))}
              </Select>
            </div>
            <div className='md:col-span-2'>
              <div className='mb-4px text-12px text-t-secondary'>{t('team.workspace.tasks.fields.acceptance')}</div>
              <TextArea
                autoSize={{ minRows: 3, maxRows: 7 }}
                value={taskDraft.acceptanceText}
                placeholder={t('team.workspace.tasks.fields.acceptancePlaceholder')}
                onChange={(acceptanceText) => setTaskDraft({ ...taskDraft, acceptanceText })}
              />
            </div>
            <div className='md:col-span-2'>
              <div className='mb-4px text-12px text-t-secondary'>{t('team.workspace.tasks.fields.context')}</div>
              <TextArea
                autoSize={{ minRows: 2, maxRows: 5 }}
                value={taskDraft.contextText}
                placeholder={t('team.workspace.tasks.fields.contextPlaceholder')}
                onChange={(contextText) => setTaskDraft({ ...taskDraft, contextText })}
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        visible={groupDraft != null}
        title={groupDraft?.id ? t('team.workspace.tasks.editGroup') : t('team.workspace.tasks.newGroup')}
        onCancel={() => setGroupDraft(null)}
        onOk={() => void saveGroup()}
        confirmLoading={saving}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        style={{ width: 520 }}
      >
        {groupDraft && (
          <div className='flex flex-col gap-12px'>
            <div>
              <div className='mb-4px text-12px text-t-secondary'>{t('team.workspace.tasks.fields.groupName')}</div>
              <Input value={groupDraft.name} onChange={(name) => setGroupDraft({ ...groupDraft, name })} />
            </div>
            <div>
              <div className='mb-4px text-12px text-t-secondary'>{t('team.workspace.tasks.fields.parentGroup')}</div>
              <Select
                allowClear
                value={groupDraft.parentGroupId ?? undefined}
                onChange={(parentGroupId) => setGroupDraft({ ...groupDraft, parentGroupId: parentGroupId ?? null })}
              >
                {orderedGroupList
                  .filter((group) => group.id !== groupDraft.id)
                  .map((group) => (
                    <Option key={group.id} value={group.id}>
                      {'· '.repeat(groupDepth(group, groups))}
                      {group.name}
                    </Option>
                  ))}
              </Select>
            </div>
            <div>
              <div className='mb-4px text-12px text-t-secondary'>{t('team.workspace.tasks.fields.members')}</div>
              <Select
                mode='multiple'
                allowClear
                value={groupDraft.memberIds}
                onChange={(memberIds) => setGroupDraft({ ...groupDraft, memberIds })}
              >
                <Option value={team.user_id}>{t('team.workspace.tasks.currentUser')}</Option>
                {team.agents.map((agent) => (
                  <Option key={agent.slot_id} value={agent.slot_id}>
                    {agent.agent_name}
                  </Option>
                ))}
              </Select>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        visible={pinDraft != null}
        title={t('team.workspace.tasks.pin.title')}
        onCancel={() => setPinDraft(null)}
        onOk={() => void pinTask()}
        confirmLoading={saving}
        okText={t('team.workspace.tasks.pin.action')}
        cancelText={t('common.cancel')}
        style={{ width: 520 }}
      >
        {pinDraft && (
          <div className='flex flex-col gap-12px'>
            <div className='rd-8px bg-2 px-10px py-8px text-13px text-t-secondary'>
              {t('team.workspace.tasks.pin.description')}
            </div>
            <div>
              <div className='mb-4px text-12px text-t-secondary'>{t('team.workspace.tasks.pin.agent')}</div>
              <Select value={pinDraft.slotId || undefined} onChange={(slotId) => setPinDraft({ ...pinDraft, slotId })}>
                {team.agents.map((agent) => (
                  <Option key={agent.slot_id} value={agent.slot_id}>
                    {agent.agent_name}
                  </Option>
                ))}
              </Select>
            </div>
            <div>
              <div className='mb-4px text-12px text-t-secondary'>{t('team.workspace.tasks.pin.role')}</div>
              <Select value={pinDraft.role} onChange={(role) => setPinDraft({ ...pinDraft, role })}>
                {BINDING_ROLES.map((role) => (
                  <Option key={role} value={role}>
                    {t(ROLE_KEYS[role])}
                  </Option>
                ))}
              </Select>
            </div>
            <div className='flex items-center gap-6px text-12px text-t-secondary'>
              <Unlink theme='outline' />
              {t('team.workspace.tasks.pin.replacesPrimary')}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default TeamTasksView;
