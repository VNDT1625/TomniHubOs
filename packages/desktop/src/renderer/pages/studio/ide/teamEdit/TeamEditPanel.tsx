/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Empty, Spin, Tooltip } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionWorkspace,
  CommunicationWorkspace,
  PreviewWorkspace,
  TasksWorkspace,
  TeamWorkspaceMetrics,
  TeamWorkspaceNav,
  teamWorkspaceStyles as styles,
  type TeamWorkspaceSection,
} from './components';
import type { FileLease } from './teamEditClient';
import type { UseTeamCollab } from './useTeamCollab';
import { useTeamEdit, USER_AGENT_ID } from './useTeamEdit';

type TeamEditPanelProps = {
  /** Absolute open workspace folder (null when none). */
  rootPath: string | null;
  /** Absolute path of the file open in the editor (for the manual claim button). */
  activeFile: string | null;
  /** Team-collab controller: when a `peer`, the panel reads the host's snapshot read-only. */
  collab: UseTeamCollab;
};

const relWithinRoot = (abs: string, root: string): string => {
  const normalizedPath = abs.replace(/\\/g, '/');
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
};

const useRelativeTime = (): ((at: number) => string) => {
  const { t } = useTranslation();
  return (at: number): string => {
    const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (seconds < 60) return t('ide.team.time.secondsAgo', { count: seconds });
    return t('ide.team.time.minutesAgo', { count: Math.round(seconds / 60) });
  };
};

const storedSection = (rootPath: string | null): TeamWorkspaceSection => {
  if (!rootPath) return 'tasks';
  const value = window.localStorage.getItem(`ide-team-workspace-section:${rootPath}`);
  return value === 'action' || value === 'communication' || value === 'previews' || value === 'tasks' ? value : 'tasks';
};

const TeamEditPanel: React.FC<TeamEditPanelProps> = ({ rootPath, activeFile, collab }) => {
  const { t } = useTranslation();
  const local = useTeamEdit(rootPath, t('ide.team.you'));
  const relativeTime = useRelativeTime();
  const [section, setSection] = useState<TeamWorkspaceSection>(() => storedSection(rootPath));
  const [peerPreviewCount, setPeerPreviewCount] = useState(0);
  const [peerPreviewRefreshKey, setPeerPreviewRefreshKey] = useState(0);

  const isPeer = collab.role === 'peer';
  const snapshot = isPeer ? collab.remoteSnapshot : local.snapshot;
  const loading = isPeer ? collab.remoteSnapshot === null : local.loading;
  const activeRel = useMemo(
    () => (rootPath && activeFile ? relWithinRoot(activeFile, rootPath) : null),
    [activeFile, rootPath]
  );
  const activeLease = useMemo<FileLease | null>(() => {
    if (!activeRel || !snapshot) return null;
    return snapshot.leases.find((lease) => lease.relPath === activeRel) ?? null;
  }, [activeRel, snapshot]);

  useEffect(() => {
    setSection(storedSection(rootPath));
  }, [rootPath]);

  const changeSection = (next: TeamWorkspaceSection) => {
    setSection(next);
    if (rootPath) window.localStorage.setItem(`ide-team-workspace-section:${rootPath}`, next);
  };

  if (!rootPath) {
    return (
      <div className='size-full flex-center bg-1'>
        <Empty description={t('ide.team.noFolder')} />
      </div>
    );
  }

  return (
    <div className={`${styles.workspace} size-full flex flex-col`} data-testid='ide-team-workspace'>
      <header className={`${styles.topbar} shrink-0`}>
        <div className='relative'>
          <TeamWorkspaceNav
            value={section}
            onChange={changeSection}
            taskCount={snapshot?.tasks.length ?? 0}
            previewCount={isPeer ? peerPreviewCount : local.previews.length}
            messageCount={snapshot?.messages.length ?? 0}
          />
          <div className='absolute right-12px top-7px z-2 flex items-center gap-8px'>
            {isPeer ? (
              <span className='max-w-260px truncate text-10px text-t-tertiary'>
                {t('ide.team.workspace.peerReadOnly')}
              </span>
            ) : null}
            <Tooltip content={t('ide.team.refresh')} mini>
              <Button
                type='text'
                size='mini'
                icon={<Refresh theme='outline' size={14} />}
                aria-label={t('ide.team.refresh')}
                onClick={() => {
                  if (isPeer) setPeerPreviewRefreshKey((current) => current + 1);
                  else void local.refresh();
                }}
              />
            </Tooltip>
          </div>
        </div>
        <TeamWorkspaceMetrics section={section} snapshot={snapshot} />
      </header>

      {loading && !snapshot ? (
        <div className='flex-1 flex-center'>
          <Spin />
        </div>
      ) : section === 'action' ? (
        <ActionWorkspace
          snapshot={snapshot}
          activeRel={activeRel}
          activeLease={activeLease}
          isPeer={isPeer}
          relativeTime={relativeTime}
          onClaim={(relPath, intent) => local.claim(relPath, intent)}
          onRelease={(relPath) => local.release(relPath)}
          onRefresh={local.refresh}
        />
      ) : section === 'tasks' ? (
        <TasksWorkspace rootPath={rootPath} snapshot={snapshot} readOnly={isPeer} onRefresh={local.refresh} />
      ) : section === 'previews' ? (
        <PreviewWorkspace
          rootPath={rootPath}
          packages={local.previews}
          readOnly={isPeer}
          peer={isPeer ? (collab.peer ?? undefined) : undefined}
          refreshKey={peerPreviewRefreshKey}
          onPackageCountChange={isPeer ? setPeerPreviewCount : undefined}
          onRefresh={local.refresh}
        />
      ) : (
        <CommunicationWorkspace rootPath={rootPath} snapshot={snapshot} readOnly={isPeer} onRefresh={local.refresh} />
      )}
    </div>
  );
};

export { USER_AGENT_ID };
export default TeamEditPanel;
