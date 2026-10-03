import { Avatar } from '@arco-design/web-react';
import { CheckOne, Communication, FileEditingOne, ListView, People, PlayOne, Shield, Time } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TeamEditSnapshot } from '@package-apps/ide/renderer/teamEdit/teamEditClient';
import type { TeamWorkspaceSection } from '@package-apps/ide/renderer/teamEdit/components/TeamWorkspaceNav';
import { initials } from '@package-apps/ide/renderer/teamEdit/components/teamWorkspaceUtils';
import styles from '@package-apps/ide/renderer/teamEdit/components/TeamWorkspace.module.css';

type Props = {
  section: TeamWorkspaceSection;
  snapshot: TeamEditSnapshot | null;
};

type Metric = {
  key: string;
  label: string;
  value: string | number;
  hint: string;
  icon: React.ReactNode;
};

const TeamWorkspaceMetrics: React.FC<Props> = ({ section, snapshot }) => {
  const { t } = useTranslation();
  if (section === 'previews') return null;
  const participants = snapshot?.participants ?? [];
  const tasks = snapshot?.tasks ?? [];
  const activity = snapshot?.activity ?? [];
  const messages = snapshot?.messages ?? [];
  const agents = participants.filter((participant) => !participant.isUser);
  const openTasks = tasks.filter((task) => task.status !== 'done');
  const doneTasks = tasks.filter((task) => task.status === 'done');
  const completion = tasks.length === 0 ? 0 : Math.round((doneTasks.length / tasks.length) * 100);
  const conflicts = activity.filter((item) => item.kind === 'conflict').length;
  const reviewTasks = tasks.filter((task) => task.status === 'review').length;
  const taskThreads = new Set(messages.map((message) => message.taskId).filter(Boolean)).size;

  const metrics: Metric[] =
    section === 'action'
      ? [
          {
            key: 'online',
            label: t('ide.team.workspace.metrics.online'),
            value: participants.length,
            hint: t('ide.team.workspace.metrics.liveNow'),
            icon: <People size={16} />,
          },
          {
            key: 'runs',
            label: t('ide.team.workspace.metrics.activeRuns'),
            value: agents.length,
            hint: t('ide.team.workspace.metrics.agentSessions'),
            icon: <PlayOne size={16} />,
          },
          {
            key: 'files',
            label: t('ide.team.workspace.metrics.heldFiles'),
            value: snapshot?.leases.length ?? 0,
            hint: t('ide.team.workspace.metrics.protectedEdits'),
            icon: <FileEditingOne size={16} />,
          },
          {
            key: 'reviews',
            label: t('ide.team.workspace.metrics.reviewQueue'),
            value: reviewTasks,
            hint: t('ide.team.workspace.metrics.awaitingReview'),
            icon: <Time size={16} />,
          },
          {
            key: 'conflicts',
            label: t('ide.team.workspace.metrics.conflictsAvoided'),
            value: conflicts,
            hint: t('ide.team.workspace.metrics.guardedWrites'),
            icon: <Shield size={16} />,
          },
        ]
      : section === 'tasks'
        ? [
            {
              key: 'members',
              label: t('ide.team.workspace.metrics.members'),
              value: participants.length,
              hint: t('ide.team.workspace.metrics.workspaceMembers'),
              icon: <People size={16} />,
            },
            {
              key: 'agents',
              label: t('ide.team.workspace.metrics.activeAgents'),
              value: agents.length,
              hint: t('ide.team.workspace.metrics.availableAgents'),
              icon: <PlayOne size={16} />,
            },
            {
              key: 'open',
              label: t('ide.team.workspace.metrics.openTasks'),
              value: openTasks.length,
              hint: t('ide.team.workspace.metrics.requiresAttention'),
              icon: <ListView size={16} />,
            },
            {
              key: 'completion',
              label: t('ide.team.workspace.metrics.completion'),
              value: `${completion}%`,
              hint: t('ide.team.workspace.metrics.doneTasks', { count: doneTasks.length }),
              icon: <CheckOne size={16} />,
            },
            {
              key: 'groups',
              label: t('ide.team.workspace.metrics.groups'),
              value: snapshot?.groups.length ?? 0,
              hint: t('ide.team.workspace.metrics.organizationLayers'),
              icon: <People size={16} />,
            },
          ]
        : [
            {
              key: 'channels',
              label: t('ide.team.workspace.metrics.channels'),
              value: Math.max(1, (snapshot?.groups.length ?? 0) + 1),
              hint: t('ide.team.workspace.metrics.activeChannels'),
              icon: <Communication size={16} />,
            },
            {
              key: 'messages',
              label: t('ide.team.workspace.metrics.messages'),
              value: messages.length,
              hint: t('ide.team.workspace.metrics.workspaceMessages'),
              icon: <Communication size={16} />,
            },
            {
              key: 'mentions',
              label: t('ide.team.workspace.metrics.mentions'),
              value: messages.filter((message) => message.body.includes('@')).length,
              hint: t('ide.team.workspace.metrics.needsReply'),
              icon: <People size={16} />,
            },
            {
              key: 'threads',
              label: t('ide.team.workspace.metrics.taskThreads'),
              value: taskThreads,
              hint: t('ide.team.workspace.metrics.linkedDiscussions'),
              icon: <ListView size={16} />,
            },
            {
              key: 'notifications',
              label: t('ide.team.workspace.metrics.notifications'),
              value: activity.length,
              hint: t('ide.team.workspace.metrics.systemEvents'),
              icon: <Time size={16} />,
            },
          ];

  return (
    <div className={styles.metrics}>
      {metrics.map((metric) => (
        <div key={metric.key} className={styles.metricCard}>
          <div className='flex items-start gap-9px'>
            <span className='size-30px rd-8px bg-fill-2 flex-center text-primary shrink-0'>{metric.icon}</span>
            <div className='min-w-0'>
              <div className='text-11px text-t-tertiary truncate'>{metric.label}</div>
              <div className='mt-1px flex items-baseline gap-7px'>
                <span className='text-20px font-700 text-t-primary'>{metric.value}</span>
                <span className='text-10px text-t-tertiary truncate'>{metric.hint}</span>
              </div>
            </div>
          </div>
        </div>
      ))}
      <div className={`${styles.metricCard} flex items-center justify-between gap-8px`}>
        <div className='min-w-0'>
          <div className='text-11px text-t-tertiary'>{t('ide.team.workspace.metrics.activePeople')}</div>
          <div className='mt-5px flex -space-x-5px'>
            {participants.slice(0, 6).map((participant) => (
              <Avatar key={participant.agentId} size={24} className='border border-solid border-bg-1'>
                {initials(participant.label)}
              </Avatar>
            ))}
            {participants.length > 6 ? <Avatar size={24}>+{participants.length - 6}</Avatar> : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeamWorkspaceMetrics;
