/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Modal, Spin, Tooltip } from '@arco-design/web-react';
import { CheckOne, CloseOne, Connection } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ChatPipelineModal.module.css';
import { PipelineStageInspector } from './PipelineStageInspector';
import { PipelineStageList } from './PipelineStageList';
import { usePipelineEditor } from './usePipelineEditor';

export type ChatPipelineModalProps = {
  visible: boolean;
  onClose: () => void;
  conversationId?: string;
  onPipelineUpdated?: (activeCount: number) => void;
};

/**
 * The chat pipeline as a rectangular pop-up: the ordered stages on the left, and on the right the
 * selected stage with its settings and the exact input and output of its model calls.
 */
export const ChatPipelineModal: React.FC<ChatPipelineModalProps> = ({
  visible,
  onClose,
  conversationId,
  onPipelineUpdated,
}) => {
  const { t } = useTranslation();
  const editor = usePipelineEditor({ visible, conversationId, onPipelineUpdated });

  const handleSave = async (): Promise<void> => {
    if (await editor.save()) onClose();
  };

  const health = editor.simulating ? (
    <span className={styles.health}>
      <Spin size={12} />
      {t('conversation.pipeline.health.checking')}
    </span>
  ) : editor.simulation?.success ? (
    <span className={`${styles.health} ${styles.healthOk}`}>
      <CheckOne theme='filled' size='14' fill='currentColor' />
      {t('conversation.pipeline.health.ok')} ·{' '}
      {t('conversation.pipeline.inspector.latency', { ms: Math.round(editor.simulation.totalDurationMs) })}
    </span>
  ) : editor.simulation ? (
    <Tooltip content={editor.simulation.errorMessage}>
      <span className={`${styles.health} ${styles.healthBad}`}>
        <CloseOne theme='filled' size='14' fill='currentColor' />
        {t('conversation.pipeline.health.failed')}
      </span>
    </Tooltip>
  ) : null;

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      unmountOnExit
      autoFocus={false}
      maskClosable={false}
      style={{ width: 'min(1040px, calc(100vw - 32px))' }}
      title={
        <span className='inline-flex items-center gap-8px'>
          <Connection theme='outline' size='18' fill='currentColor' />
          {t('conversation.pipeline.title')}
        </span>
      }
      footer={
        <div className='flex items-center justify-between w-full'>
          <Button type='secondary' onClick={editor.reset}>
            {t('conversation.pipeline.actions.reset')}
          </Button>
          <div className='flex items-center gap-8px'>
            <Button onClick={onClose}>{t('conversation.pipeline.actions.cancel')}</Button>
            <Button type='primary' loading={editor.saving} onClick={() => void handleSave()}>
              {t('conversation.pipeline.actions.save')}
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.modalBody}>
        <div className={styles.header}>{health}</div>
        <Spin loading={editor.loading} style={{ display: 'block' }}>
          <div className={styles.layout}>
            <PipelineStageList editor={editor} />
            <PipelineStageInspector editor={editor} />
          </div>
        </Spin>
      </div>
    </Modal>
  );
};
