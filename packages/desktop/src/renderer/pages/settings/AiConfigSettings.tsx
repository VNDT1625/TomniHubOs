/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Card, Divider, InputNumber, Select, Slider, Switch } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import SettingsPageWrapper from './components/SettingsPageWrapper';

/**
 * 2.4 Cấu hình AI:
 * - Context window limit
 * - Temperature & Top-P
 * - Stream timeout
 * - Fallback model khi mất mạng
 */
const AiConfigSettings: React.FC = () => {
  const { t } = useTranslation();
  const [temperature, setTemperature] = useState<number>(0.3);
  const [contextWindow, setContextWindow] = useState<number>(32000);
  const [streamTimeout, setStreamTimeout] = useState<number>(120);
  const [fallbackModel, setFallbackModel] = useState<string>('qwen2.5-coder:7b-local');

  return (
    <SettingsPageWrapper contentClassName='max-w-960px'>
      <div className='flex flex-col gap-20px'>
        <Card title={t('settings.aiConfigSettings.inferenceParamsTitle')} bordered className='rd-12px'>
          <div className='flex flex-col gap-16px'>
            <div>
              <div className='flex justify-between text-13px mb-6px'>
                <strong className='text-t-primary'>{t('settings.aiConfigSettings.temperatureTitle')}</strong>
                <span className='text-primary font-bold'>{temperature}</span>
              </div>
              <p className='text-12px text-t-tertiary m-0 mb-8px'>{t('settings.aiConfigSettings.temperatureDesc')}</p>
              <Slider
                value={temperature}
                min={0}
                max={1}
                step={0.05}
                onChange={(val) => setTemperature(val as number)}
              />
            </div>

            <Divider className='my-4px' />

            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-13px text-t-primary'>
                  {t('settings.aiConfigSettings.contextWindowTitle')}
                </strong>
                <p className='text-12px text-t-tertiary m-0'>{t('settings.aiConfigSettings.contextWindowDesc')}</p>
              </div>
              <Select
                value={contextWindow}
                onChange={setContextWindow}
                style={{ width: 160 }}
                options={[
                  { label: '8,192 tokens', value: 8192 },
                  { label: '16,384 tokens', value: 16384 },
                  { label: `32,768 tokens (${t('settings.aiConfigSettings.recommended')})`, value: 32768 },
                  { label: '64,000 tokens', value: 64000 },
                  { label: '128,000 tokens', value: 128000 },
                ]}
              />
            </div>

            <Divider className='my-4px' />

            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-13px text-t-primary'>
                  {t('settings.aiConfigSettings.streamTimeoutTitle')}
                </strong>
                <p className='text-12px text-t-tertiary m-0'>{t('settings.aiConfigSettings.streamTimeoutDesc')}</p>
              </div>
              <div className='flex items-center gap-6px'>
                <InputNumber
                  style={{ width: 100 }}
                  value={streamTimeout}
                  min={30}
                  max={600}
                  onChange={(v) => setStreamTimeout(v || 120)}
                />
                <span className='text-11px text-t-tertiary'>{t('settings.aiConfigSettings.secondsUnit')}</span>
              </div>
            </div>
          </div>
        </Card>

        <Card title={t('settings.aiConfigSettings.resilienceTitle')} bordered className='rd-12px'>
          <div className='flex items-center justify-between'>
            <div>
              <strong className='text-13px text-t-primary'>{t('settings.aiConfigSettings.fallbackModelTitle')}</strong>
              <p className='text-12px text-t-tertiary m-0 mt-2px'>{t('settings.aiConfigSettings.fallbackModelDesc')}</p>
            </div>
            <Select
              value={fallbackModel}
              onChange={setFallbackModel}
              style={{ width: 220 }}
              options={[
                { label: 'Ollama: qwen2.5-coder:7b', value: 'qwen2.5-coder:7b-local' },
                { label: 'LM Studio: deepseek-coder', value: 'deepseek-coder-local' },
                { label: t('settings.aiConfigSettings.fallbackNone'), value: 'none' },
              ]}
            />
          </div>
        </Card>
      </div>
    </SettingsPageWrapper>
  );
};

export default AiConfigSettings;
