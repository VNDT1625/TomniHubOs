/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Badge, Button, Tooltip } from '@arco-design/web-react';
import { Connection } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

export type ChatPipelineButtonProps = {
  activeCount: number;
  onClick: () => void;
};

export const ChatPipelineButton: React.FC<ChatPipelineButtonProps> = ({ activeCount, onClick }) => {
  const { t } = useTranslation();
  return (
    <Tooltip content={t('conversation.pipeline.buttonTooltip', { count: activeCount })}>
      <Badge count={activeCount} offset={[-2, 2]}>
        <Button
          size='mini'
          type='secondary'
          onClick={onClick}
          data-spotlight-id='pipeline'
          icon={<Connection theme='outline' size='14' fill='currentColor' strokeWidth={2} />}
          className='mr-2'
        >
          {t('conversation.pipeline.button')}
        </Button>
      </Badge>
    </Tooltip>
  );
};
