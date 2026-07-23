import { Button, Empty, Input, List, Message, Modal, Radio, Select, Space, Tag, Tooltip } from '@arco-design/web-react';
import { CheckOne, Copy, Link, MessageOne, PlayOne, PreviewOpen } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { copyText } from '@renderer/utils/ui/clipboard';
import { ViuPresentRuntime } from '../../Viu/next/runtime';
import {
  createViuLocalTestReference,
  teamEditClient,
  type ViuPreviewFeedbackEvent,
  type ViuTeamPreviewPackage,
} from '../teamEditClient';
import { USER_AGENT_ID } from '../useTeamEdit';
import { teamCollabClient } from '../teamCollabClient';
import styles from './TeamWorkspace.module.css';

type Props = {
  rootPath: string;
  packages: readonly ViuTeamPreviewPackage[];
  readOnly: boolean;
  peer?: { baseUrl: string; token: string };
  refreshKey?: number;
  onPackageCountChange?: (count: number) => void;
  onRefresh: () => Promise<void>;
};

const FEEDBACK_KIND_KEYS = {
  comment: 'ide.team.workspace.previewView.comment',
  issue: 'ide.team.workspace.previewView.issue',
  approval: 'ide.team.workspace.previewView.approval',
  observation: 'ide.team.workspace.previewView.observation',
} as const;

const PreviewWorkspace: React.FC<Props> = ({
  rootPath,
  packages,
  readOnly,
  peer,
  refreshKey,
  onPackageCountChange,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const [remotePackages, setRemotePackages] = useState<readonly ViuTeamPreviewPackage[]>([]);
  const visiblePackages = peer ? remotePackages : packages;
  const [selectedId, setSelectedId] = useState<string | null>(packages[0]?.packageId ?? null);
  const [opened, setOpened] = useState<ViuTeamPreviewPackage | null>(null);
  const [feedback, setFeedback] = useState<readonly ViuPreviewFeedbackEvent[]>([]);
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<'comment' | 'issue' | 'approval' | 'observation'>('comment');
  const [screenId, setScreenId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const selected = useMemo(
    () => visiblePackages.find((item) => item.packageId === selectedId) ?? visiblePackages[0] ?? null,
    [selectedId, visiblePackages]
  );

  useEffect(() => {
    if (!peer) {
      setRemotePackages([]);
      return;
    }
    void teamCollabClient
      .remotePreviews(peer.baseUrl, peer.token)
      .then((result) => {
        if (result.ok) setRemotePackages(result.data);
      })
      .catch((): undefined => undefined);
  }, [peer, refreshKey]);

  useEffect(() => {
    onPackageCountChange?.(visiblePackages.length);
  }, [onPackageCountChange, visiblePackages.length]);

  useEffect(() => {
    if (!selectedId || !visiblePackages.some((item) => item.packageId === selectedId)) {
      setSelectedId(visiblePackages[0]?.packageId ?? null);
    }
  }, [selectedId, visiblePackages]);

  useEffect(() => {
    if (!selected) {
      setFeedback([]);
      setScreenId(undefined);
      return;
    }
    setScreenId((current) =>
      current && selected.snapshot.screenIds.includes(current) ? current : selected.snapshot.startScreenId
    );
    const request = peer
      ? teamCollabClient.remotePreviewFeedback(peer.baseUrl, peer.token, selected.packageId)
      : teamEditClient.listPreviewFeedback(rootPath, selected.packageId);
    void request
      .then((result) => {
        if (result.ok) setFeedback(result.data);
      })
      .catch((): undefined => undefined);
  }, [peer, rootPath, selected]);

  const openPreview = async (): Promise<void> => {
    if (!selected) return;
    setBusy(true);
    const result = await (
      peer
        ? teamCollabClient.remotePreview(peer.baseUrl, peer.token, selected.packageId)
        : teamEditClient.getPreview(rootPath, selected.packageId, 'user-preview')
    ).catch((): null => null);
    setBusy(false);
    if (!result) {
      Message.error(t('ide.team.workspace.previewView.openError'));
      return;
    }
    if ('error' in result) {
      Message.error(result.error);
      return;
    }
    setOpened(result.data);
  };

  const copyReference = async (): Promise<void> => {
    if (!selected) return;
    await copyText(createViuLocalTestReference(selected.packageId));
    Message.success(t('ide.team.workspace.previewView.referenceCopied'));
  };

  const submitFeedback = async (): Promise<void> => {
    if (!selected || !body.trim() || (readOnly && !peer)) return;
    setBusy(true);
    const anchor = { kind, body, ...(screenId ? { screenId } : {}) };
    const result = await (
      peer
        ? teamCollabClient.remoteAppendPreviewFeedback({
            baseUrl: peer.baseUrl,
            token: peer.token,
            packageId: selected.packageId,
            feedback: anchor,
          })
        : teamEditClient.appendPreviewFeedback(rootPath, selected.packageId, {
            feedbackId: crypto.randomUUID(),
            authorId: USER_AGENT_ID,
            authorKind: 'user',
            createdAt: Date.now(),
            ...anchor,
          })
    ).catch((): null => null);
    setBusy(false);
    if (!result) {
      Message.error(t('ide.team.workspace.previewView.feedbackError'));
      return;
    }
    if ('error' in result) {
      Message.error(result.error);
      return;
    }
    setFeedback((current) => [...current, result.data]);
    setBody('');
    Message.success(t('ide.team.workspace.previewView.feedbackSaved'));
    if (!peer) await onRefresh();
  };

  return (
    <div className={styles.body}>
      <div className={styles.previewGrid}>
        <aside className={styles.panel}>
          <div className={styles.panelHeader}>
            <PreviewOpen size={15} className='text-primary' />
            <span className='font-650 text-13px text-t-primary'>{t('ide.team.workspace.previewView.packages')}</span>
            <div className='flex-1' />
            <Tag size='small'>{visiblePackages.length}</Tag>
          </div>
          <div className={styles.panelScroll}>
            {visiblePackages.length === 0 ? (
              <div className='p-18px'>
                <Empty description={t('ide.team.workspace.previewView.empty')} />
              </div>
            ) : (
              <List bordered={false}>
                {visiblePackages.map((item) => (
                  <List.Item key={item.packageId} className='!p-4px'>
                    <Button
                      long
                      type={selected?.packageId === item.packageId ? 'secondary' : 'text'}
                      className='!h-auto !justify-start !p-10px'
                      onClick={() => setSelectedId(item.packageId)}
                    >
                      <span className='min-w-0 flex-1 text-left'>
                        <span className='block truncate text-12px font-650 text-t-primary'>
                          {item.snapshot.metadata.title}
                        </span>
                        <span className='mt-3px block truncate text-10px text-t-tertiary'>
                          {t('ide.team.workspace.previewView.revision', {
                            revision: item.snapshot.projectRevision,
                            screens: item.snapshot.screenIds.length,
                          })}
                        </span>
                      </span>
                    </Button>
                  </List.Item>
                ))}
              </List>
            )}
          </div>
        </aside>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <PlayOne size={15} className='text-primary' />
            <span className='font-650 text-13px text-t-primary'>
              {selected?.snapshot.metadata.title ?? t('ide.team.workspace.previewView.details')}
            </span>
            <div className='flex-1' />
            {selected ? (
              <Space size={6}>
                <Tooltip content={t('ide.team.workspace.previewView.copyReference')} mini>
                  <Button size='mini' icon={<Copy size={13} />} onClick={() => void copyReference()}>
                    {t('ide.team.workspace.previewView.copy')}
                  </Button>
                </Tooltip>
                <Button
                  type='primary'
                  size='mini'
                  loading={busy}
                  icon={<PlayOne size={13} />}
                  onClick={() => void openPreview()}
                >
                  {t('ide.team.workspace.previewView.open')}
                </Button>
              </Space>
            ) : null}
          </div>
          <div className={styles.panelScroll}>
            {selected ? (
              <div className='p-16px'>
                <div className='flex flex-wrap items-center gap-6px'>
                  <Tag icon={<CheckOne size={12} />}>{t('ide.team.workspace.previewView.immutable')}</Tag>
                  {peer ? null : <Tag icon={<Link size={12} />}>{t('ide.team.workspace.previewView.localOnly')}</Tag>}
                  <Tag>{t('ide.team.workspace.previewView.userAndAgent')}</Tag>
                </div>
                <div className='mt-16px grid grid-cols-2 gap-10px'>
                  <div className={styles.metricCard}>
                    <div className='text-10px uppercase tracking-wide text-t-tertiary'>
                      {t('ide.team.workspace.previewView.startRoute')}
                    </div>
                    <div className='mt-4px truncate font-mono text-12px text-t-primary'>
                      {selected.snapshot.startRoute}
                    </div>
                  </div>
                  <div className={styles.metricCard}>
                    <div className='text-10px uppercase tracking-wide text-t-tertiary'>
                      {t('ide.team.workspace.previewView.digest')}
                    </div>
                    <div className='mt-4px truncate font-mono text-12px text-t-primary'>
                      {selected.snapshot.contentDigest}
                    </div>
                  </div>
                </div>
                <div className='mt-14px text-11px text-t-tertiary'>
                  {selected.snapshot.metadata.purpose || t('ide.team.workspace.previewView.noPurpose')}
                </div>
                {selected.teamTaskId ? (
                  <div className='mt-8px text-11px text-t-secondary'>
                    {t('ide.team.workspace.previewView.linkedTask', { task: selected.teamTaskId })}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className='h-full flex-center'>
                <Empty description={t('ide.team.workspace.previewView.selectPackage')} />
              </div>
            )}
          </div>
        </section>

        <aside className={styles.panel}>
          <div className={styles.panelHeader}>
            <MessageOne size={15} className='text-primary' />
            <span className='font-650 text-13px text-t-primary'>{t('ide.team.workspace.previewView.feedback')}</span>
            <div className='flex-1' />
            <Tag size='small'>{feedback.length}</Tag>
          </div>
          <div className={styles.panelScroll}>
            <div className='p-12px'>
              {selected ? (
                <>
                  <Radio.Group
                    type='button'
                    size='mini'
                    value={kind}
                    onChange={(value) => setKind(value)}
                    options={[
                      { label: t('ide.team.workspace.previewView.comment'), value: 'comment' },
                      { label: t('ide.team.workspace.previewView.issue'), value: 'issue' },
                      { label: t('ide.team.workspace.previewView.approval'), value: 'approval' },
                    ]}
                  />
                  <Select
                    className='mt-8px w-full'
                    size='small'
                    value={screenId}
                    onChange={setScreenId}
                    placeholder={t('ide.team.workspace.previewView.screenAnchor')}
                    options={selected.snapshot.screenIds.map((id) => ({
                      value: id,
                      label: selected.snapshot.project.screens[id]?.name ?? id,
                    }))}
                  />
                  <Input.TextArea
                    className='mt-8px'
                    value={body}
                    onChange={setBody}
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    disabled={readOnly && !peer}
                    placeholder={t('ide.team.workspace.previewView.feedbackPlaceholder')}
                  />
                  <Button
                    className='mt-8px'
                    type='primary'
                    long
                    loading={busy}
                    disabled={(readOnly && !peer) || !body.trim()}
                    onClick={() => void submitFeedback()}
                  >
                    {t('ide.team.workspace.previewView.sendFeedback')}
                  </Button>
                  <div className='mt-14px flex flex-col gap-6px'>
                    {feedback.map((event) => (
                      <div key={event.feedbackId} className={styles.metricCard}>
                        <div className='flex items-center gap-6px'>
                          <Tag size='small'>{t(FEEDBACK_KIND_KEYS[event.kind])}</Tag>
                          <span className='truncate text-10px text-t-tertiary'>
                            {event.screenId ?? t('ide.team.workspace.previewView.projectAnchor')}
                          </span>
                        </div>
                        <div className='mt-6px whitespace-pre-wrap text-12px text-t-primary'>{event.body}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <Empty description={t('ide.team.workspace.previewView.selectPackage')} />
              )}
            </div>
          </div>
        </aside>
      </div>

      <Modal
        visible={Boolean(opened)}
        title={opened?.snapshot.metadata.title}
        footer={null}
        className={styles.previewModal}
        onCancel={() => setOpened(null)}
        unmountOnExit
      >
        {opened ? (
          <div className='h-72vh min-h-520px overflow-hidden rd-10px border border-b-2'>
            <ViuPresentRuntime
              project={opened.snapshot.project}
              initialRoute={opened.snapshot.startRoute}
              labels={{
                back: t('ide.team.workspace.previewView.back'),
                closeOverlay: t('ide.team.workspace.previewView.closeOverlay'),
                empty: t('ide.team.workspace.previewView.previewEmpty'),
                route: t('ide.team.workspace.previewView.route'),
                exit: t('ide.team.workspace.previewView.exit'),
              }}
              onExit={() => setOpened(null)}
            />
          </div>
        ) : null}
      </Modal>
    </div>
  );
};

export default PreviewWorkspace;
