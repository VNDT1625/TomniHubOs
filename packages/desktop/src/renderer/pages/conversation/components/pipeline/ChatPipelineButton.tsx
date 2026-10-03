/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Tooltip, Badge } from '@arco-design/web-react';
import { Connection } from '@icon-park/react';
import { iconColors } from '@/renderer/styles/colors';

export type ChatPipelineButtonProps = {
  activeCount: number;
  onClick: () => void;
};

export const ChatPipelineButton: React.FC<ChatPipelineButtonProps> = ({ activeCount, onClick }) => {
  return (
    <Tooltip content={`Chat Pipeline Flow: ${activeCount} chặng kích hoạt (Kéo-Thả tùy biến)`}>
      <Badge count={activeCount} offset={[-2, 2]}>
        <Button
          size='mini'
          type='secondary'
          onClick={onClick}
          icon={<Connection theme='outline' size='14' fill={iconColors.primary} strokeWidth={2} />}
          className='mr-2'
        >
          Pipeline
        </Button>
      </Badge>
    </Tooltip>
  );
};
