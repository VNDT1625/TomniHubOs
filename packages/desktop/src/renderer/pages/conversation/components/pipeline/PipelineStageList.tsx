/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Select, Switch, Tag, Tooltip } from '@arco-design/web-react';
import { Book, Brain, Connection, Copy, Delete, Down, FileCode, Lightning, Shield, Up } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ChatPipelineModal.module.css';
import type { PipelineEditor } from './usePipelineEditor';

export const StageIcon: React.FC<{ name?: string }> = ({ name }) => {
  const common = { theme: 'outline' as const, size: '18', fill: 'currentColor' };
  switch (name) {
    case 'Shield':
      return <Shield {...common} />;
    case 'Brain':
      return <Brain {...common} />;
    case 'Book':
      return <Book {...common} />;
    case 'Wrench':
    case 'Lightning':
      return <Lightning {...common} />;
    case 'FileCode':
      return <FileCode {...common} />;
    default:
      return <Connection {...common} />;
  }
};

type Props = Readonly<{ editor: PipelineEditor }>;

export const PipelineStageList: React.FC<Props> = ({ editor }) => {
  const { t } = useTranslation();
  const stages = editor.definition?.stages ?? [];

  return (
    <div className={styles.listColumn}>
      <div className={styles.listHeader}>
        <span className={styles.listTitle}>{t('conversation.pipeline.stagesTitle')}</span>
        <Tag size='small'>{t('conversation.pipeline.stageCount', { count: stages.length })}</Tag>
      </div>

      <div className={styles.list} role='list'>
        {stages.length === 0 && <div className={styles.hint}>{t('conversation.pipeline.emptyStages')}</div>}
        {stages.map((stage, index) => {
          const meta = editor.metaById.get(stage.stageRegistryId);
          const name = editor.stageName(meta, stage.stageRegistryId);
          const phase = meta?.phase ?? stage.phase;
          const selected = stage.id === editor.selectedId;
          const rowClass = [styles.row, selected ? styles.rowActive : '', stage.enabled ? '' : styles.rowOff]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={stage.id}
              role='listitem'
              tabIndex={0}
              aria-current={selected}
              className={rowClass}
              onClick={() => editor.select(stage.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  editor.select(stage.id);
                }
              }}
            >
              <span className={styles.index}>{index + 1}</span>
              <div className={styles.rowBody}>
                <div className={styles.rowTitle}>
                  <StageIcon name={meta?.icon} />
                  <span className={styles.rowTitleText}>{name}</span>
                </div>
                <div className={styles.rowMeta}>
                  {t(`conversation.pipeline.phase.${phase}`)}
                  {meta?.role === 'guard' &&
                    ` · ${t(meta.authorizedGuard ? 'conversation.pipeline.role.authorized' : 'conversation.pipeline.role.unverified')}`}
                </div>
              </div>
              <div className={styles.rowActions} onClick={(event) => event.stopPropagation()}>
                <Tooltip content={t('conversation.pipeline.moveUp')}>
                  <Button
                    size='mini'
                    type='text'
                    aria-label={t('conversation.pipeline.moveUp')}
                    disabled={index === 0}
                    icon={<Up theme='outline' size='14' fill='currentColor' />}
                    onClick={() => editor.move(index, -1)}
                  />
                </Tooltip>
                <Tooltip content={t('conversation.pipeline.moveDown')}>
                  <Button
                    size='mini'
                    type='text'
                    aria-label={t('conversation.pipeline.moveDown')}
                    disabled={index === stages.length - 1}
                    icon={<Down theme='outline' size='14' fill='currentColor' />}
                    onClick={() => editor.move(index, 1)}
                  />
                </Tooltip>
                <Tooltip content={t('conversation.pipeline.duplicate')}>
                  <Button
                    size='mini'
                    type='text'
                    aria-label={t('conversation.pipeline.duplicate')}
                    icon={<Copy theme='outline' size='14' fill='currentColor' />}
                    onClick={() => editor.duplicate(index)}
                  />
                </Tooltip>
                <Tooltip content={t('conversation.pipeline.remove')}>
                  <Button
                    size='mini'
                    type='text'
                    status='danger'
                    aria-label={t('conversation.pipeline.remove')}
                    icon={<Delete theme='outline' size='14' fill='currentColor' />}
                    onClick={() => editor.remove(index)}
                  />
                </Tooltip>
                <Tooltip content={t('conversation.pipeline.enable')}>
                  <Switch
                    size='small'
                    checked={stage.enabled}
                    aria-label={t('conversation.pipeline.enable')}
                    onChange={(checked) => editor.toggle(stage.id, checked)}
                  />
                </Tooltip>
              </div>
            </div>
          );
        })}
      </div>

      {editor.warnings.length > 0 && (
        <div className={styles.warnings} role='note'>
          <div className={styles.warningsTitle}>{t('conversation.pipeline.warnings.title')}</div>
          {editor.warnings.map((warning) => (
            <div
              key={warning.kind === 'noGuard' ? 'noGuard' : `retrieve-${warning.stageId}`}
              className={styles.warningLine}
            >
              {warning.kind === 'noGuard'
                ? t('conversation.pipeline.warnings.noGuard')
                : t('conversation.pipeline.warnings.unguardedRetrieve', {
                    stage: editor.stageName(editor.metaById.get(warning.registryId), warning.registryId),
                  })}
            </div>
          ))}
        </div>
      )}

      <div className={styles.addBar}>
        <Select
          allowClear={false}
          value=''
          placeholder={t('conversation.pipeline.addStagePlaceholder')}
          aria-label={t('conversation.pipeline.addStage')}
          onChange={(value: string) => {
            const meta = editor.metaById.get(value);
            if (meta) editor.add(meta);
          }}
        >
          {editor.available.map((meta) => (
            <Select.Option key={meta.id} value={meta.id}>
              {editor.stageName(meta, meta.id)}
            </Select.Option>
          ))}
        </Select>
      </div>
    </div>
  );
};
