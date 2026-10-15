/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Spin, Tag } from '@arco-design/web-react';
import { Shield } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { ChatPipelineDefinition, ChatStageMetadata } from '@/common/types/pipeline';
import { ChatPipelineModal } from '@/renderer/pages/conversation/components/pipeline/ChatPipelineModal';
import { builtinStageTextKey } from '@/renderer/pages/conversation/components/pipeline/pipelineUtils';
import NotActiveNotice from './components/NotActiveNotice';
import SettingsPageWrapper from './components/SettingsPageWrapper';

import MediaModelDefaults from './components/media/MediaModelDefaults';

type PlannedRow = { title: string; description: string };

/** Code guardrails that are designed but not connected to chat yet; shown read-only. */
const PLANNED: Array<{ title: string; rows: PlannedRow[] }> = [
  {
    title: 'tier1Title',
    rows: [
      { title: 'astTitle', description: 'astDesc' },
      { title: 'packageTitle', description: 'packageDesc' },
      { title: 'strictTypeTitle', description: 'strictTypeDesc' },
    ],
  },
  {
    title: 'tier2Title',
    rows: [
      { title: 'sandboxTitle', description: 'sandboxDesc' },
      { title: 'redToGreenTitle', description: 'redToGreenDesc' },
    ],
  },
  {
    title: 'tier3Title',
    rows: [
      { title: 'diffLimitTitle', description: 'diffLimitDesc' },
      { title: 'testLockTitle', description: 'testLockDesc' },
    ],
  },
  {
    title: 'tier4Title',
    rows: [
      { title: 'dualModelTitle', description: 'dualModelDesc' },
      { title: 'autoRollbackTitle', description: 'autoRollbackDesc' },
    ],
  },
];

/**
 * Saved default pipeline configuration, editable with the chat's shared editor.
 * Configured stages are not evidence that every phase is wired into execution.
 */
const PipelineChatSettings: React.FC = () => {
  const { t } = useTranslation();
  const [definition, setDefinition] = useState<ChatPipelineDefinition | null>(null);
  const [available, setAvailable] = useState<ChatStageMetadata[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stages, loaded] = await Promise.all([
        ipcBridge.conversation.getPipelineAvailableStages.invoke(),
        ipcBridge.conversation.getPipelineDefinition.invoke({}),
      ]);
      setAvailable([...stages]);
      setDefinition(loaded);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stageName = (registryId: string): string => {
    const key = builtinStageTextKey(registryId);
    if (key) return t(`conversation.pipeline.stageName.${key}`);
    return available.find((meta) => meta.id === registryId)?.displayName ?? registryId;
  };

  const p = (key: string) => t(`settings.pipelineSettings.${key}`);

  return (
    <SettingsPageWrapper contentClassName='max-w-960px'>
      <div className='flex flex-col gap-20px'>
        <Card bordered className='rd-12px bg-fill-1'>
          <div className='flex items-center gap-14px'>
            <div className='w-44px h-44px rd-8px bg-arcoblue-1 text-primary flex items-center justify-center text-22px'>
              <Shield theme='outline' size={24} fill='currentColor' />
            </div>
            <div>
              <strong className='text-16px text-t-primary'>{p('title')}</strong>
              <p className='text-12px text-t-secondary m-0 mt-2px'>{p('perConversationHint')}</p>
            </div>
          </div>
        </Card>

        <Card
          title={p('defaultChainTitle')}
          bordered
          className='rd-12px'
          extra={
            <Button
              size='small'
              type='primary'
              disabled={!definition || failed || loading}
              onClick={() => setEditing(true)}
            >
              {p('editDefault')}
            </Button>
          }
        >
          {failed ? (
            <div className='flex items-center justify-between gap-12px' role='alert'>
              <p className='text-12px text-t-secondary m-0'>{p('loadFailed')}</p>
              <Button size='small' loading={loading} disabled={loading} onClick={() => void load()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : !definition ? (
            <Spin />
          ) : (
            <div className='flex flex-col gap-8px' data-testid='pipeline-default-chain'>
              {!definition.enabled && <p className='text-12px text-t-tertiary m-0'>{p('chainOff')}</p>}
              {(['pre_model', 'post_model'] as const).map((group) => {
                const stages = definition.stages
                  .map((stage, index) => ({ stage, index }))
                  .filter(({ stage }) =>
                    group === 'post_model' ? stage.phase === 'post_model' : stage.phase !== 'post_model'
                  );
                if (stages.length === 0) return null;
                return (
                  <section
                    key={group}
                    aria-labelledby={'pipeline-settings-' + group}
                    className='flex flex-col gap-8px py-8px'
                  >
                    <h3 id={'pipeline-settings-' + group} className='text-12px text-t-secondary m-0'>
                      {t(`conversation.pipeline.phase.${group}`)} · {t('conversation.pipeline.inspector.settings')}
                    </h3>
                    {stages.map(({ stage, index }) => (
                      <div key={stage.id} className='flex items-center justify-between gap-12px'>
                        <span className='text-13px text-t-primary break-words min-w-0'>
                          {index + 1}. {stageName(stage.stageRegistryId)}
                          <span className='text-12px text-t-tertiary'>
                            {' '}
                            · {t(`conversation.pipeline.phase.${stage.phase}`)}
                          </span>
                        </span>
                        <Tag size='small' color={stage.enabled ? 'green' : 'gray'}>
                          {stage.enabled ? p('stageOn') : p('stageOff')}
                        </Tag>
                      </div>
                    ))}
                  </section>
                );
              })}
              {definition.stages.length === 0 && (
                <p className='text-12px text-t-tertiary m-0'>{t('conversation.pipeline.emptyStages')}</p>
              )}
            </div>
          )}
        </Card>

        <Card bordered className='rd-12px'>
          <MediaModelDefaults />
        </Card>


        <details className='rd-12px bg-fill-1 p-16px'>
          <summary className='cursor-pointer text-13px text-t-secondary'>{p('plannedNotice')}</summary>
          <div className='flex flex-col gap-16px mt-12px'>
            <NotActiveNotice detail={p('plannedNotice')} />
            {PLANNED.map((tier) => (
              <section key={tier.title} className='flex flex-col gap-8px'>
                <h3 className='text-13px text-t-primary m-0'>{p(tier.title)}</h3>
                {tier.rows.map((row) => (
                  <div key={row.title}>
                    <strong className='text-12px text-t-secondary'>{p(row.title)}</strong>
                    <p className='text-12px text-t-tertiary m-0'>{p(row.description)}</p>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </details>
      </div>
      <ChatPipelineModal
        visible={editing}
        onClose={() => setEditing(false)}
        onPipelineUpdated={() => {
          void load();
        }}
      />
    </SettingsPageWrapper>
  );
};

export default PipelineChatSettings;
