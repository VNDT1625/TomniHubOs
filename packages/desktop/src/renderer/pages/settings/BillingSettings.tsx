/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Button, Card, Divider, InputNumber, Progress, Tag } from '@arco-design/web-react';
import { Wallet } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import SettingsPageWrapper from './components/SettingsPageWrapper';

/**
 * 1.2 Billing & Usage:
 * - Gói cước (Plans)
 * - Hạn mức & Token tiêu thụ theo thời gian thực
 * - Trần chi tiêu an toàn (Spending Cap)
 */
const BillingSettings: React.FC = () => {
  const { t } = useTranslation();
  const [spendingCap, setSpendingCap] = useState<number>(30);

  return (
    <SettingsPageWrapper contentClassName='max-w-960px'>
      <div className='flex flex-col gap-20px'>
        {/* Current Plan Overview */}
        <Card bordered className='rd-12px'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-14px'>
              <div className='w-48px h-48px rd-10px bg-arcoblue-1 text-primary flex items-center justify-center text-24px'>
                <Wallet theme='outline' size={24} fill='currentColor' />
              </div>
              <div className='flex flex-col'>
                <div className='flex items-center gap-8px'>
                  <strong className='text-16px text-t-primary'>{t('settings.billingSettings.currentPlanTitle')}</strong>
                  <Tag color='arcoblue'>{t('settings.billingSettings.activeTag')}</Tag>
                </div>
                <span className='text-13px text-t-secondary'>{t('settings.billingSettings.nextRenewal')}</span>
              </div>
            </div>
            <Button type='primary'>{t('settings.billingSettings.upgradeEnterprise')}</Button>
          </div>
        </Card>

        {/* Token Consumption Gauge */}
        <Card title={t('settings.billingSettings.usageTitle')} bordered className='rd-12px'>
          <div className='flex flex-col gap-16px'>
            <div>
              <div className='flex justify-between text-13px mb-6px text-t-secondary'>
                <span>{t('settings.billingSettings.usedMonthly', { used: '2,140,500', total: '5,000,000' })}</span>
                <span className='text-primary font-bold'>42.8%</span>
              </div>
              <Progress percent={42.8} status='normal' animation />
            </div>

            <Divider className='my-4px' />

            <div className='grid grid-cols-3 gap-12px'>
              <div className='p-12px rd-8px bg-fill-2 flex flex-col'>
                <span className='text-11px text-t-tertiary'>{t('settings.billingSettings.promptTokens')}</span>
                <strong className='text-16px text-t-primary mt-4px'>1,420,100</strong>
                <small className='text-10px text-t-tertiary'>{t('settings.billingSettings.promptTokensDesc')}</small>
              </div>
              <div className='p-12px rd-8px bg-fill-2 flex flex-col'>
                <span className='text-11px text-t-tertiary'>{t('settings.billingSettings.completionTokens')}</span>
                <strong className='text-16px text-t-primary mt-4px'>720,400</strong>
                <small className='text-10px text-t-tertiary'>
                  {t('settings.billingSettings.completionTokensDesc')}
                </small>
              </div>
              <div className='p-12px rd-8px bg-fill-2 flex flex-col'>
                <span className='text-11px text-t-tertiary'>{t('settings.billingSettings.estimatedCost')}</span>
                <strong className='text-16px text-success mt-4px'>$8.42 USD</strong>
                <small className='text-10px text-t-tertiary'>{t('settings.billingSettings.estimatedCostDesc')}</small>
              </div>
            </div>
          </div>
        </Card>

        {/* Safety Spending Cap */}
        <Card title={t('settings.billingSettings.spendingCapTitle')} bordered className='rd-12px'>
          <div className='flex items-center justify-between'>
            <div>
              <strong className='text-14px text-t-primary'>{t('settings.billingSettings.spendingCapHeading')}</strong>
              <p className='text-12px text-t-tertiary m-0 mt-2px'>{t('settings.billingSettings.spendingCapDesc')}</p>
            </div>
            <div className='flex items-center gap-8px'>
              <span>{t('settings.billingSettings.spendingCapLabel')}</span>
              <InputNumber
                style={{ width: 120 }}
                value={spendingCap}
                min={5}
                max={500}
                prefix='$'
                onChange={(val) => setSpendingCap(val || 30)}
              />
            </div>
          </div>
        </Card>
      </div>
    </SettingsPageWrapper>
  );
};

export default BillingSettings;
