import type { TeamTaskBindingRole, TeamTaskStatus, TeammateStatus, TTeam } from '@/common/types/team/teamTypes';
import { Card, Empty, Progress, Tag } from '@arco-design/web-react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

type StatusInfo = {
  status: TeammateStatus;
  last_message?: string;
};

const STATUS_KEYS = {
  pending: 'team.workspace.activity.agentStatus.pending',
  idle: 'team.workspace.activity.agentStatus.idle',
  active: 'team.workspace.activity.agentStatus.active',
  completed: 'team.workspace.activity.agentStatus.completed',
  failed: 'team.workspace.activity.agentStatus.failed',
} as const satisfies Record<TeammateStatus, string>;

const TASK_STATUS_KEYS = {
  draft: 'team.workspace.tasks.status.draft',
  ready: 'team.workspace.tasks.status.ready',
  running: 'team.workspace.tasks.status.running',
  blocked: 'team.workspace.tasks.status.blocked',
  review: 'team.workspace.tasks.status.review',
  needs_changes: 'team.workspace.tasks.status.needsChanges',
  done: 'team.workspace.tasks.status.done',
  cancelled: 'team.workspace.tasks.status.cancelled',
} as const satisfies Record<TeamTaskStatus, string>;

const TASK_ROLE_KEYS = {
  planner: 'team.workspace.tasks.role.planner',
  executor: 'team.workspace.tasks.role.executor',
  reviewer: 'team.workspace.tasks.role.reviewer',
  tester: 'team.workspace.tasks.role.tester',
  advisor: 'team.workspace.tasks.role.advisor',
} as const satisfies Record<TeamTaskBindingRole, string>;

const TeamActivityView: React.FC<{ team: TTeam; statusMap: Map<string, StatusInfo> }> = ({ team, statusMap }) => {
  const { t } = useTranslation();
  const tasks = team.tasks ?? [];
  const bindings = team.task_bindings ?? [];
  const completed = tasks.filter((task) => task.status === 'done').length;
  const completion = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;
  const recentTasks = useMemo(
    () => tasks.toSorted((left, right) => right.updated_at - left.updated_at).slice(0, 8),
    [tasks]
  );

  return (
    <div className='h-full overflow-y-auto bg-1 p-20px'>
      <div className='mx-auto max-w-1180px flex flex-col gap-16px'>
        <div>
          <div className='text-20px font-700 text-t-primary'>{t('team.workspace.activity.title')}</div>
          <div className='mt-4px text-13px text-t-secondary'>{t('team.workspace.activity.subtitle')}</div>
        </div>

        <div className='grid grid-cols-1 lg:grid-cols-3 gap-12px'>
          <Card
            className='lg:col-span-2 border border-solid border-[color:var(--border-base)]'
            title={t('team.workspace.activity.liveAgents')}
          >
            <div className='grid grid-cols-1 md:grid-cols-2 gap-8px'>
              {team.agents.map((agent) => {
                const live = statusMap.get(agent.slot_id) ?? { status: agent.status };
                const binding = bindings.find(
                  (candidate) => candidate.slot_id === agent.slot_id && candidate.is_primary
                );
                const task = tasks.find((candidate) => candidate.id === binding?.task_id);
                return (
                  <div
                    key={agent.slot_id}
                    className='rd-10px border border-solid border-[color:var(--border-base)] bg-2 p-12px'
                  >
                    <div className='flex items-center justify-between gap-8px'>
                      <div className='min-w-0'>
                        <div className='font-700 text-t-primary truncate'>{agent.agent_name}</div>
                      </div>
                      <Tag color={live.status === 'active' ? 'green' : live.status === 'failed' ? 'red' : undefined}>
                        {t(STATUS_KEYS[live.status])}
                      </Tag>
                    </div>
                    {task ? (
                      <div className='mt-10px rd-8px bg-1 px-9px py-7px'>
                        <div className='text-11px text-t-secondary'>{t('team.workspace.activity.boundTask')}</div>
                        <div className='mt-2px text-13px font-600 text-t-primary truncate'>{task.title}</div>
                        {binding && (
                          <div className='mt-2px text-11px text-t-secondary'>{t(TASK_ROLE_KEYS[binding.role])}</div>
                        )}
                      </div>
                    ) : (
                      <div className='mt-10px text-12px text-t-secondary'>
                        {t('team.workspace.activity.noBoundTask')}
                      </div>
                    )}
                    {live.last_message && (
                      <div className='mt-8px text-12px text-t-secondary line-clamp-2'>{live.last_message}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card
            className='border border-solid border-[color:var(--border-base)]'
            title={t('team.workspace.activity.progress')}
          >
            <div className='flex flex-col items-center gap-12px py-8px'>
              <Progress type='circle' percent={completion} width={112} />
              <div className='text-center'>
                <div className='text-13px font-600 text-t-primary'>
                  {t('team.workspace.activity.completedCount', { completed, total: tasks.length })}
                </div>
                <div className='mt-3px text-12px text-t-secondary'>
                  {t('team.workspace.activity.bindingCount', { count: bindings.length })}
                </div>
              </div>
            </div>
          </Card>
        </div>

        <Card
          className='border border-solid border-[color:var(--border-base)]'
          title={t('team.workspace.activity.recentTasks')}
        >
          {recentTasks.length === 0 ? (
            <Empty description={t('team.workspace.activity.empty')} />
          ) : (
            <div className='flex flex-col divide-y divide-[color:var(--border-base)]'>
              {recentTasks.map((task) => {
                const boundNames = bindings
                  .filter((binding) => binding.task_id === task.id)
                  .map((binding) => team.agents.find((agent) => agent.slot_id === binding.slot_id)?.agent_name)
                  .filter((name): name is string => Boolean(name));
                return (
                  <div key={task.id} className='flex flex-wrap items-center gap-8px py-9px'>
                    <div className='min-w-0 flex-1'>
                      <div className='font-600 text-t-primary truncate'>{task.title}</div>
                      <div className='mt-2px text-12px text-t-secondary truncate'>
                        {boundNames.length > 0 ? boundNames.join(', ') : t('team.workspace.activity.unassigned')}
                      </div>
                    </div>
                    <Tag>{t(TASK_STATUS_KEYS[task.status])}</Tag>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default TeamActivityView;
