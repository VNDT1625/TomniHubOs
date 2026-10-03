/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Message } from '@arco-design/web-react';
import { Brain, Right } from '@icon-park/react';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

type ModelConnectionCardProps = {
  query: string;
  onDismiss?: () => void;
};

/**
 * ModelConnectionCard - Displayed when a reasoning task requires a model but none are configured
 *
 * This card appears inline in the chat when:
 * - User sends a reasoning/planning/coding query
 * - Laya Decision Engine determines an LLM is needed
 * - No models are currently connected
 *
 * Provides quick navigation to Settings → Model to configure a provider
 */
export const ModelConnectionCard: React.FC<ModelConnectionCardProps> = ({ query, onDismiss }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleConnectModel = useCallback(() => {
    navigate('/settings/model');
    onDismiss?.();
  }, [navigate, onDismiss]);

  return (
    <Card
      className='my-12px max-w-600px mx-auto'
      bordered
      style={{
        borderColor: 'var(--color-border-2)',
        backgroundColor: 'var(--color-fill-1)',
      }}
    >
      <div className='flex items-start gap-12px'>
        <div className='flex-shrink-0 mt-2px'>
          <Brain theme='outline' size='20' fill='var(--color-text-2)' />
        </div>
        <div className='flex-1'>
          <div className='text-14px font-medium text-t-primary mb-8px'>
            {t('conversation.modelConnection.title', { defaultValue: 'Model Required for This Task' })}
          </div>
          <div className='text-13px text-t-secondary mb-12px leading-relaxed'>
            {t('conversation.modelConnection.description', {
              defaultValue:
                'This request requires an AI model for reasoning or planning. Please connect a model (OpenAI, Claude, Gemini, etc.) to continue.',
            })}
          </div>
          <div className='flex gap-8px'>
            <Button type='primary' size='small' onClick={handleConnectModel} icon={<Right />}>
              {t('conversation.modelConnection.connect', { defaultValue: 'Connect Model' })}
            </Button>
            {onDismiss && (
              <Button size='small' onClick={onDismiss}>
                {t('common.dismiss', { defaultValue: 'Dismiss' })}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};
