/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Radio, Switch, Tag } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PipelineModelCallTrace, StageDecision } from '@/common/types/pipeline';
import styles from './ChatPipelineModal.module.css';
import { PipelineModelCall } from './PipelineModelCall';
import { StageIcon } from './PipelineStageList';
import { callsForStage, SECURITY_STAGE_ID, TOOL_SCHEMA_STAGE_IDS } from './pipelineUtils';
import type { PipelineEditor } from './usePipelineEditor';

type Source = 'lastRun' | 'dryRun';

type StageOutcome = Readonly<{ decision: StageDecision; durationMs: number; error?: string }>;

type Props = Readonly<{ editor: PipelineEditor }>;

/** What the selected stage is, how to set it up, and what it actually asked and got from the model. */
export const PipelineStageInspector: React.FC<Props> = ({ editor }) => {
  const { t } = useTranslation();
  const [preferred, setPreferred] = useState<Source>('lastRun');

  const stage = editor.definition?.stages.find((candidate) => candidate.id === editor.selectedId);
  const meta = stage ? editor.metaById.get(stage.stageRegistryId) : undefined;

  const source: Source = preferred === 'lastRun' && !editor.lastRun ? 'dryRun' : preferred;
  const calls: readonly PipelineModelCallTrace[] | undefined =
    source === 'lastRun' ? editor.lastRun?.modelCalls : editor.simulation?.modelCalls;

  const stageCalls = useMemo(() => (stage ? callsForStage(calls, stage.id) : []), [calls, stage]);

  const outcome: StageOutcome | undefined = useMemo(() => {
    if (!stage) return undefined;
    if (source === 'lastRun') {
      const trace = editor.lastRun?.stages.find((entry) => entry.stageId === stage.id);
      return trace ? { decision: trace.decision, durationMs: trace.durationMs, error: trace.error } : undefined;
    }
    const metric = editor.simulation?.stageMetrics.find((entry) => entry.stageId === stage.id);
    return metric ? { decision: metric.decision, durationMs: metric.durationMs, error: metric.error } : undefined;
  }, [editor.lastRun, editor.simulation, source, stage]);

  if (!stage) {
    return (
      <div className={styles.empty}>
        <span>{t('conversation.pipeline.inspector.empty')}</span>
      </div>
    );
  }

  const sharedFromName = (call: PipelineModelCallTrace): string | undefined => {
    const origin = calls?.find((candidate) => candidate.id === call.sourceCallId);
    const ref = origin ? editor.definition?.stages.find((entry) => entry.id === origin.stageId) : undefined;
    return ref ? editor.stageName(editor.metaById.get(ref.stageRegistryId), ref.stageRegistryId) : undefined;
  };

  const isSecurity = stage.stageRegistryId === SECURITY_STAGE_ID;
  const isToolSchema = TOOL_SCHEMA_STAGE_IDS.has(stage.stageRegistryId);
  const tasks = meta?.decisionTasks ?? [];
  const mode = stage.config?.['mode'] === 'block' ? 'block' : 'rewrite';
  const apply = stage.config?.['apply'] !== false;

  return (
    <div className={styles.inspector}>
      <div className={styles.inspectorHead}>
        <StageIcon name={meta?.icon} />
        <div>
          <div className={styles.inspectorName}>{editor.stageName(meta, stage.stageRegistryId)}</div>
          <div className={styles.inspectorDescription}>{editor.stageDescription(meta)}</div>
          <div className={styles.chips}>
            <Tag size='small'>{t(`conversation.pipeline.phase.${meta?.phase ?? stage.phase}`)}</Tag>
            {meta?.role === 'guard' && (
              <Tag size='small' color={meta.authorizedGuard ? 'green' : 'orange'}>
                {t('conversation.pipeline.role.guard')} ·{' '}
                {t(
                  meta.authorizedGuard
                    ? 'conversation.pipeline.role.authorized'
                    : 'conversation.pipeline.role.unverified'
                )}
              </Tag>
            )}
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('conversation.pipeline.inspector.model')}</div>
        {tasks.length === 0 ? (
          <div className={styles.hint}>{t('conversation.pipeline.inspector.noModel')}</div>
        ) : (
          <>
            <div className={styles.chips}>
              <Tag size='small' color='arcoblue'>
                {t('conversation.pipeline.inspector.modelName')}
              </Tag>
            </div>
            <div className={styles.fieldLabel}>{t('conversation.pipeline.inspector.tasks')}</div>
            <div className={styles.chips}>
              {tasks.map((task) => (
                <Tag key={task} size='small'>
                  {t(`conversation.pipeline.task.${task}`)}
                </Tag>
              ))}
            </div>
            <div className={styles.hint}>{t('conversation.pipeline.inspector.sharedCall')}</div>
          </>
        )}
      </div>

      {(isSecurity || isToolSchema) && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('conversation.pipeline.inspector.settings')}</div>
          {isSecurity && (
            <div className={styles.settingRow}>
              <span>{t('conversation.pipeline.inspector.mode')}</span>
              <Radio.Group
                type='button'
                size='small'
                value={mode}
                onChange={(value: string) => editor.setConfig(stage.id, { mode: value })}
              >
                <Radio value='rewrite'>{t('conversation.pipeline.inspector.modeRewrite')}</Radio>
                <Radio value='block'>{t('conversation.pipeline.inspector.modeBlock')}</Radio>
              </Radio.Group>
            </div>
          )}
          {isToolSchema && (
            <>
              <div className={styles.settingRow}>
                <span>{t('conversation.pipeline.inspector.apply')}</span>
                <Switch
                  size='small'
                  checked={apply}
                  aria-label={t('conversation.pipeline.inspector.apply')}
                  onChange={(checked) => editor.setConfig(stage.id, { apply: checked })}
                />
              </div>
              <div className={styles.hint}>{t('conversation.pipeline.inspector.applyHint')}</div>
            </>
          )}
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>{t('conversation.pipeline.inspector.source')}</span>
          <Radio.Group type='button' size='small' value={source} onChange={(value: Source) => setPreferred(value)}>
            <Radio value='lastRun' disabled={!editor.lastRun}>
              {t('conversation.pipeline.inspector.lastRun')}
            </Radio>
            <Radio value='dryRun'>{t('conversation.pipeline.inspector.dryRun')}</Radio>
          </Radio.Group>
        </div>

        {outcome && (
          <div className={styles.chips}>
            <Tag size='small' color={outcome.decision === 'block' ? 'red' : 'gray'}>
              {t('conversation.pipeline.inspector.decision')}: {t(`conversation.pipeline.decision.${outcome.decision}`)}
            </Tag>
            <Tag size='small'>
              {t('conversation.pipeline.inspector.latency', { ms: Math.round(outcome.durationMs) })}
            </Tag>
          </div>
        )}
        {outcome?.error && (
          <div className={styles.errorText} role='alert'>
            {t('conversation.pipeline.inspector.error')}: {outcome.error}
          </div>
        )}

        {stageCalls.length === 0 && !outcome && (
          <div className={styles.hint}>{t('conversation.pipeline.inspector.noRun')}</div>
        )}
        {stageCalls.map((call) => (
          <PipelineModelCall key={call.id} call={call} sharedFrom={sharedFromName(call)} />
        ))}
      </div>
    </div>
  );
};
