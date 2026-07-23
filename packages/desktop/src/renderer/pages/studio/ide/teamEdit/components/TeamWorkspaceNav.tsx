import { Tabs } from '@arco-design/web-react';
import { Communication, ListView, PreviewOpen, Time } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './TeamWorkspace.module.css';

export type TeamWorkspaceSection = 'action' | 'tasks' | 'previews' | 'communication';

type Props = {
  value: TeamWorkspaceSection;
  onChange: (value: TeamWorkspaceSection) => void;
  taskCount: number;
  previewCount: number;
  messageCount: number;
};

const TeamWorkspaceNav: React.FC<Props> = ({ value, onChange, taskCount, previewCount, messageCount }) => {
  const { t } = useTranslation();
  return (
    <Tabs
      activeTab={value}
      onChange={(key) => onChange(key as TeamWorkspaceSection)}
      className={styles.tabs}
      destroyOnHide={false}
    >
      <Tabs.TabPane
        key='action'
        title={
          <span className='inline-flex items-center gap-6px'>
            <Time theme='outline' size={15} />
            {t('ide.team.workspace.action')}
          </span>
        }
      />
      <Tabs.TabPane
        key='tasks'
        title={
          <span className='inline-flex items-center gap-6px'>
            <ListView theme='outline' size={15} />
            {t('ide.team.workspace.tasks')}
            {taskCount > 0 ? <span className='text-10px text-t-tertiary'>· {taskCount}</span> : null}
          </span>
        }
      />
      <Tabs.TabPane
        key='previews'
        title={
          <span className='inline-flex items-center gap-6px'>
            <PreviewOpen theme='outline' size={15} />
            {t('ide.team.workspace.previews')}
            {previewCount > 0 ? <span className='text-10px text-t-tertiary'>· {previewCount}</span> : null}
          </span>
        }
      />
      <Tabs.TabPane
        key='communication'
        title={
          <span className='inline-flex items-center gap-6px'>
            <Communication theme='outline' size={15} />
            {t('ide.team.workspace.communication')}
            {messageCount > 0 ? <span className='text-10px text-t-tertiary'>· {messageCount}</span> : null}
          </span>
        }
      />
    </Tabs>
  );
};

export default TeamWorkspaceNav;
