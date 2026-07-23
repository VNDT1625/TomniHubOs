import { Avatar, Button, Empty, Input, Radio, Tag, Tooltip } from '@arco-design/web-react';
import {
  CheckOne,
  FileEditingOne,
  Link,
  Lock,
  People,
  Refresh,
  Search,
  Shield,
  Unlock,
  Attention,
} from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { USER_AGENT_ID } from '../useTeamEdit';
import type { FileLease, TeamActivity, TeamEditSnapshot } from '../teamEditClient';
import { formatDateTime, initials } from './teamWorkspaceUtils';
import styles from './TeamWorkspace.module.css';

type ActionFilter = 'all' | 'agent' | 'file' | 'conflict';

type Props = {
  snapshot: TeamEditSnapshot | null;
  activeRel: string | null;
  activeLease: FileLease | null;
  isPeer: boolean;
  relativeTime: (at: number) => string;
  onClaim: (relPath: string, intent?: string) => Promise<void>;
  onRelease: (relPath: string) => Promise<void>;
  onRefresh: () => Promise<void>;
};

const iconForActivity = (activity: TeamActivity): React.ReactNode => {
  if (activity.kind === 'conflict') return <Shield size={16} />;
  if (activity.kind === 'claim') return <Lock size={16} />;
  if (activity.kind === 'release' || activity.kind === 'expire') return <Unlock size={16} />;
  if (activity.kind === 'write') return <FileEditingOne size={16} />;
  return <People size={16} />;
};

const ActionWorkspace: React.FC<Props> = ({
  snapshot,
  activeRel,
  activeLease,
  isPeer,
  relativeTime,
  onClaim,
  onRelease,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const participants = snapshot?.participants ?? [];
  const leases = snapshot?.leases ?? [];
  const orderedActivity = useMemo(() => (snapshot?.activity ?? []).toReversed(), [snapshot?.activity]);
  const [filter, setFilter] = useState<ActionFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedSeq, setSelectedSeq] = useState<number | null>(orderedActivity[0]?.seq ?? null);

  useEffect(() => {
    if (selectedSeq === null && orderedActivity[0]) setSelectedSeq(orderedActivity[0].seq);
    if (selectedSeq !== null && !orderedActivity.some((activity) => activity.seq === selectedSeq)) {
      setSelectedSeq(orderedActivity[0]?.seq ?? null);
    }
  }, [orderedActivity, selectedSeq]);

  const filteredActivity = orderedActivity.filter((activity) => {
    const matchesFilter =
      filter === 'all' ||
      (filter === 'agent' && activity.kind === 'join') ||
      (filter === 'file' && ['claim', 'release', 'write', 'expire'].includes(activity.kind)) ||
      (filter === 'conflict' && activity.kind === 'conflict');
    const haystack = `${activity.agentId} ${activity.relPath ?? ''} ${activity.detail ?? ''}`.toLowerCase();
    return matchesFilter && haystack.includes(query.trim().toLowerCase());
  });

  const selected = orderedActivity.find((activity) => activity.seq === selectedSeq) ?? orderedActivity[0] ?? null;
  const selectedParticipant = selected
    ? participants.find((participant) => participant.agentId === selected.agentId)
    : undefined;
  const selectedLease = selected?.relPath ? leases.find((lease) => lease.relPath === selected.relPath) : undefined;
  const userHoldsActive = activeLease?.agentId === USER_AGENT_ID;
  const someoneElseHoldsActive = Boolean(activeLease && activeLease.agentId !== USER_AGENT_ID);

  const describe = (activity: TeamActivity): string => {
    const file = activity.relPath ?? '';
    switch (activity.kind) {
      case 'join':
        return t('ide.team.activity.join', { who: activity.agentId });
      case 'claim':
        return t('ide.team.activity.claim', { who: activity.agentId, file });
      case 'release':
        return t('ide.team.activity.release', { who: activity.agentId, file });
      case 'write':
        return t('ide.team.activity.write', { who: activity.agentId, file });
      case 'expire':
        return t('ide.team.activity.expire', { who: activity.agentId, file });
      case 'conflict':
        return t('ide.team.activity.conflict', {
          who: activity.agentId,
          file,
          holder: activity.byAgentId ?? '',
        });
    }
  };

  return (
    <div className={`${styles.body} flex-1`}>
      <div className={styles.threeColumn}>
        <aside className={styles.panel}>
          <div className={styles.panelHeader}>
            <People size={15} className='text-primary' />
            <span className='font-650 text-13px text-t-primary'>{t('ide.team.workspace.actionView.activeNow')}</span>
            <div className='flex-1' />
            <Tag size='small'>{participants.length}</Tag>
          </div>
          <div className={styles.panelScroll}>
            <div className={styles.panelSection}>
              {participants.length === 0 ? (
                <Empty description={t('ide.team.noParticipants')} />
              ) : (
                <div className='flex flex-col gap-2px'>
                  {participants.map((participant) => (
                    <div key={participant.agentId} className={styles.listItem}>
                      <Avatar size={28}>{initials(participant.label)}</Avatar>
                      <div className='min-w-0 flex-1'>
                        <div className='truncate text-12px font-600 text-t-primary'>{participant.label}</div>
                        <div className='text-10px text-t-tertiary'>
                          {participant.isUser
                            ? t('ide.team.workspace.actionView.userRole')
                            : t('ide.team.workspace.actionView.agentRole')}
                        </div>
                      </div>
                      <span className='size-7px rd-full bg-success shrink-0' aria-hidden />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.panelSection}>
              <div className='mb-8px flex items-center gap-6px'>
                <Lock size={14} className='text-t-secondary' />
                <span className='text-11px font-650 uppercase tracking-wide text-t-tertiary'>
                  {t('ide.team.workspace.actionView.heldFiles')} · {leases.length}
                </span>
              </div>
              {leases.length === 0 ? (
                <div className='text-12px text-t-tertiary'>{t('ide.team.noLeases')}</div>
              ) : (
                <div className='flex flex-col gap-4px'>
                  {leases.slice(0, 8).map((lease) => (
                    <div key={lease.relPath} className={styles.listItem}>
                      <FileEditingOne size={14} className='text-primary shrink-0' />
                      <div className='min-w-0 flex-1'>
                        <div className='truncate font-mono text-11px text-t-primary' title={lease.relPath}>
                          {lease.relPath}
                        </div>
                        <div className='truncate text-10px text-t-tertiary'>
                          {t('ide.team.heldBy', { who: lease.agentId })}
                        </div>
                      </div>
                      <Tag size='small' color='green'>
                        {t('ide.team.workspace.actionView.held')}
                      </Tag>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {activeRel && !isPeer ? (
              <div className={styles.panelSection}>
                <div className='mb-8px text-11px font-650 uppercase tracking-wide text-t-tertiary'>
                  {t('ide.team.workspace.actionView.activeFile')}
                </div>
                <div className='rd-9px border border-solid border-b-1 bg-fill-1 p-10px'>
                  <div className='truncate font-mono text-11px text-t-primary' title={activeRel}>
                    {activeRel}
                  </div>
                  <div className='mt-8px flex items-center gap-6px'>
                    {someoneElseHoldsActive ? (
                      <Tag color='red' icon={<Lock size={11} />}>
                        {t('ide.team.heldBy', { who: activeLease?.agentId ?? '' })}
                      </Tag>
                    ) : userHoldsActive ? (
                      <Button size='mini' type='outline' status='success' onClick={() => void onRelease(activeRel)}>
                        {t('ide.team.release')}
                      </Button>
                    ) : (
                      <Button
                        size='mini'
                        type='primary'
                        icon={<Lock size={12} />}
                        onClick={() => void onClaim(activeRel, t('ide.team.userIntent'))}
                      >
                        {t('ide.team.claim')}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </aside>

        <main className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className='font-650 text-13px text-t-primary'>
              {t('ide.team.workspace.actionView.activityStream')}
            </span>
            <div className='flex-1' />
            <Tooltip content={t('ide.team.refresh')} mini>
              <Button type='text' size='mini' icon={<Refresh size={14} />} onClick={() => void onRefresh()} />
            </Tooltip>
          </div>
          <div className='flex h-[48px] items-center gap-8px border-b border-b-1 px-12px'>
            <Radio.Group
              type='button'
              size='small'
              value={filter}
              onChange={(value) => setFilter(value as ActionFilter)}
            >
              <Radio value='all'>{t('ide.team.workspace.actionView.filters.all')}</Radio>
              <Radio value='agent'>{t('ide.team.workspace.actionView.filters.people')}</Radio>
              <Radio value='file'>{t('ide.team.workspace.actionView.filters.files')}</Radio>
              <Radio value='conflict'>{t('ide.team.workspace.actionView.filters.conflicts')}</Radio>
            </Radio.Group>
            <div className='flex-1' />
            <Input
              size='small'
              value={query}
              onChange={setQuery}
              prefix={<Search size={13} />}
              placeholder={t('ide.team.workspace.actionView.searchPlaceholder')}
              style={{ width: 220 }}
            />
          </div>
          <div className='h-[calc(100%-94px)] overflow-auto p-10px'>
            {filteredActivity.length === 0 ? (
              <div className={styles.emptyState}>
                <Empty description={t('ide.team.noActivity')} />
              </div>
            ) : (
              <div className='flex flex-col gap-7px'>
                {filteredActivity.map((activity) => (
                  <Button
                    key={activity.seq}
                    type='text'
                    long
                    className={`!h-auto !p-0 !text-left ${styles.activityRow} ${
                      selected?.seq === activity.seq ? styles.activityRowActive : ''
                    }`}
                    onClick={() => setSelectedSeq(activity.seq)}
                  >
                    <span
                      className={`size-32px rd-9px flex-center shrink-0 ${
                        activity.kind === 'conflict' ? 'bg-danger-light-1 text-danger' : 'bg-fill-2 text-primary'
                      }`}
                    >
                      {iconForActivity(activity)}
                    </span>
                    <span className='min-w-0'>
                      <span className='block whitespace-normal text-12px font-600 text-t-primary'>
                        {describe(activity)}
                      </span>
                      {activity.detail ? (
                        <span className='mt-3px block truncate text-11px text-t-tertiary'>{activity.detail}</span>
                      ) : null}
                    </span>
                    <span className='whitespace-nowrap text-10px text-t-tertiary'>{relativeTime(activity.at)}</span>
                  </Button>
                ))}
              </div>
            )}
          </div>
        </main>

        <aside className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className='font-650 text-13px text-t-primary'>{t('ide.team.workspace.actionView.details')}</span>
            <div className='flex-1' />
            {selected ? <Tag size='small'>{selected.kind}</Tag> : null}
          </div>
          {selected ? (
            <div className={styles.panelScroll}>
              <div className={styles.detailHero}>
                <div className='flex items-start gap-10px'>
                  <span className='size-34px rd-10px bg-fill-2 flex-center text-primary shrink-0'>
                    {iconForActivity(selected)}
                  </span>
                  <div className='min-w-0'>
                    <div className='text-13px font-700 text-t-primary'>{describe(selected)}</div>
                    <div className='mt-4px text-10px text-t-tertiary'>{formatDateTime(selected.at)}</div>
                  </div>
                </div>
              </div>
              <div className={styles.panelSection}>
                <DetailRow label={t('ide.team.workspace.actionView.actor')}>
                  <span className='inline-flex items-center gap-6px'>
                    <Avatar size={22}>{initials(selectedParticipant?.label ?? selected.agentId)}</Avatar>
                    {selectedParticipant?.label ?? selected.agentId}
                  </span>
                </DetailRow>
                <DetailRow label={t('ide.team.workspace.actionView.eventType')}>
                  <Tag size='small'>{selected.kind}</Tag>
                </DetailRow>
                {selected.relPath ? (
                  <DetailRow label={t('ide.team.workspace.actionView.file')}>
                    <span className='break-all font-mono text-11px'>{selected.relPath}</span>
                  </DetailRow>
                ) : null}
                {selected.byAgentId ? (
                  <DetailRow label={t('ide.team.workspace.actionView.holder')}>{selected.byAgentId}</DetailRow>
                ) : null}
                {selected.detail ? (
                  <DetailRow label={t('ide.team.workspace.actionView.detail')}>{selected.detail}</DetailRow>
                ) : null}
              </div>

              <div className={styles.panelSection}>
                <div className='mb-8px text-11px font-650 uppercase tracking-wide text-t-tertiary'>
                  {t('ide.team.workspace.actionView.evidence')}
                </div>
                <EvidenceRow
                  ok
                  label={t('ide.team.workspace.actionView.recordedInTimeline')}
                  icon={<CheckOne size={13} />}
                />
                <EvidenceRow
                  ok={selected.kind !== 'conflict'}
                  label={
                    selected.kind === 'conflict'
                      ? t('ide.team.workspace.actionView.writeBlockedSafely')
                      : t('ide.team.workspace.actionView.noConflict')
                  }
                  icon={selected.kind === 'conflict' ? <Shield size={13} /> : <CheckOne size={13} />}
                />
                {selectedLease ? (
                  <EvidenceRow ok label={t('ide.team.workspace.actionView.leaseActive')} icon={<Lock size={13} />} />
                ) : null}
              </div>

              <div className={styles.panelSection}>
                <div className='mb-8px text-11px font-650 uppercase tracking-wide text-t-tertiary'>
                  {t('ide.team.workspace.actionView.quickActions')}
                </div>
                <div className='flex flex-wrap gap-6px'>
                  <Button icon={<Refresh size={13} />} onClick={() => void onRefresh()}>
                    {t('ide.team.refresh')}
                  </Button>
                  {selected.relPath && selectedLease?.agentId === USER_AGENT_ID ? (
                    <Button
                      status='success'
                      icon={<Unlock size={13} />}
                      onClick={() => void onRelease(selected.relPath!)}
                    >
                      {t('ide.team.release')}
                    </Button>
                  ) : null}
                  {selected.relPath ? (
                    <Button
                      icon={<Link size={13} />}
                      onClick={() => void navigator.clipboard.writeText(selected.relPath!)}
                    >
                      {t('ide.team.workspace.actionView.copyFilePath')}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <Empty description={t('ide.team.workspace.actionView.selectActivity')} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

const DetailRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className='grid grid-cols-[96px_minmax(0,1fr)] gap-10px py-6px text-11px'>
    <span className='text-t-tertiary'>{label}</span>
    <span className='min-w-0 text-t-primary'>{children}</span>
  </div>
);

const EvidenceRow: React.FC<{ ok: boolean; label: string; icon: React.ReactNode }> = ({ ok, label, icon }) => (
  <div className='flex items-center gap-7px py-5px text-11px'>
    <span className={ok ? 'text-success' : 'text-warning'}>{icon}</span>
    <span className='text-t-secondary'>{label}</span>
    {!ok ? <Attention size={12} className='ml-auto text-warning' /> : null}
  </div>
);

export default ActionWorkspace;
