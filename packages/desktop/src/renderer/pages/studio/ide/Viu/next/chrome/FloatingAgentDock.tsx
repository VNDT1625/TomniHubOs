/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Input, Tooltip } from '@arco-design/web-react';
import { CloseSmall, Robot, Send } from '@icon-park/react';
import React, { useState } from 'react';
import styles from '../ViuNextCanvas.module.css';
import type { ViuNextLabels } from '../types';

type FloatingAgentDockProps = {
  labels: ViuNextLabels['agent'];
  onRequest?: (prompt: string) => void;
};

const FloatingAgentDock: React.FC<FloatingAgentDockProps> = ({ labels, onRequest }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const send = (): void => {
    const prompt = draft.trim();
    if (!prompt || !onRequest) return;
    onRequest(prompt);
    setDraft('');
  };

  if (!open) {
    return (
      <Tooltip content={labels.title} position='lt'>
        <Button
          type='primary'
          shape='circle'
          className={styles.agentLauncher}
          aria-label={labels.title}
          data-testid='viu-next-agent-launcher'
          icon={<Robot theme='outline' size={18} />}
          onClick={() => setOpen(true)}
        />
      </Tooltip>
    );
  }

  return (
    <div className={styles.agentDock} data-testid='viu-next-agent-dock'>
      <span className={styles.agentMark}>
        <Robot theme='outline' size={17} />
      </span>
      <div className={styles.agentComposer}>
        <div className={styles.agentTitle}>{labels.title}</div>
        <Input
          size='small'
          value={draft}
          placeholder={labels.placeholder}
          onChange={setDraft}
          onPressEnter={send}
          autoFocus
        />
      </div>
      <Button
        type='primary'
        shape='circle'
        aria-label={labels.send}
        disabled={!onRequest || !draft.trim()}
        icon={<Send size={14} />}
        onClick={send}
      />
      <Button
        type='text'
        shape='circle'
        className={styles.agentClose}
        aria-label={labels.title}
        data-testid='viu-next-agent-close'
        icon={<CloseSmall size={14} />}
        onClick={() => setOpen(false)}
      />
    </div>
  );
};

export default FloatingAgentDock;
