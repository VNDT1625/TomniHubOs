/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { PipelineModelCallTrace } from '@/common/types/pipeline';
import styles from './ChatPipelineModal.module.css';
import { formatAnswer } from './pipelineUtils';

type Props = Readonly<{
  call: PipelineModelCallTrace;
  /** For a call served from the shared pass: the name of the stage that actually ran the model. */
  sharedFrom?: string;
}>;

/** One request to the decision model, with the exact (masked) text it received and what it answered. */
export const PipelineModelCall: React.FC<Props> = ({ call, sharedFrom }) => {
  const { t } = useTranslation();
  const answers = Object.entries(call.answers);

  return (
    <div className={styles.callCard}>
      <div className={styles.callHead}>
        <div className={styles.chips}>
          {call.taskIds.map((task) => (
            <Tag key={task} size='small' color='arcoblue'>
              {t(`conversation.pipeline.task.${task}`)}
            </Tag>
          ))}
          <Tag size='small'>{t('conversation.pipeline.inspector.questions', { count: call.questionKeys.length })}</Tag>
        </div>
        {call.cacheHit ? (
          <Tag size='small' color='green'>
            {t('conversation.pipeline.inspector.sharedWith', { stage: sharedFrom ?? call.sourceCallId ?? '' })}
          </Tag>
        ) : (
          <Tag size='small'>{t('conversation.pipeline.inspector.latency', { ms: Math.round(call.latencyMs) })}</Tag>
        )}
      </div>

      <div className={styles.fieldLabel}>
        {t('conversation.pipeline.inspector.input')} · {t('conversation.pipeline.inspector.masked')}
      </div>
      <pre className={styles.code}>{call.input}</pre>

      <div className={styles.fieldLabel}>{t('conversation.pipeline.inspector.output')}</div>
      {call.error ? (
        <div className={styles.errorText} role='alert'>
          {t('conversation.pipeline.inspector.error')}:{' '}
          {call.errorCode ? t(`conversation.pipeline.inspector.errorCode.${call.errorCode}`) : call.error}
        </div>
      ) : (
        <div className={styles.answers}>
          {answers.map(([key, answer]) => (
            <React.Fragment key={key}>
              <span className={styles.answerKey}>{key}</span>
              <span className={styles.answerValue}>{formatAnswer(answer)}</span>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
