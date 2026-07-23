import { Badge, Radio } from '@arco-design/web-react';
import { Communication, History, ListView } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

export type TeamWorkspaceSection = 'activity' | 'tasks' | 'communication';

type Props = {
  value: TeamWorkspaceSection;
  onChange: (value: TeamWorkspaceSection) => void;
  taskCount: number;
  runningCount: number;
};

const TeamWorkspaceNav: React.FC<Props> = ({ value, onChange, taskCount, runningCount }) => {
  const { t } = useTranslation();
  return (
    <div className='h-44px shrink-0 border-x border-t border-solid border-[color:var(--border-base)] bg-1 px-10px flex items-center justify-between gap-10px'>
      <Radio.Group type='button' value={value} onChange={onChange}>
        <Radio value='activity'>
          <span className='inline-flex items-center gap-6px'>
            <History theme='outline' size='14' />
            {t('team.workspace.nav.activity')}
            {runningCount > 0 && <Badge count={runningCount} dot />}
          </span>
        </Radio>
        <Radio value='tasks'>
          <span className='inline-flex items-center gap-6px'>
            <ListView theme='outline' size='14' />
            {t('team.workspace.nav.tasks')}
            {taskCount > 0 && <Badge count={taskCount} maxCount={99} />}
          </span>
        </Radio>
        <Radio value='communication'>
          <span className='inline-flex items-center gap-6px'>
            <Communication theme='outline' size='14' />
            {t('team.workspace.nav.communication')}
          </span>
        </Radio>
      </Radio.Group>
      <span className='hidden md:inline text-11px uppercase tracking-0.08em text-t-secondary'>
        {t('team.workspace.nav.caption')}
      </span>
    </div>
  );
};

export default TeamWorkspaceNav;
