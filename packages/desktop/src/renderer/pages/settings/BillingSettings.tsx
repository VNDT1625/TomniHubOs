/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card, InputNumber } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import NotActiveNotice from './components/NotActiveNotice';
import SettingsPageWrapper from './components/SettingsPageWrapper';

/**
 * Billing & usage: Tomny does not count tokens or cost yet, so this page shows what is planned without
 * numbers. Model providers bill the user directly.
 */
const BillingSettings: React.FC = () => {
  const { t } = useTranslation();
  const tiles = [
    { label: 'settings.billingSettings.promptTokens', hint: 'settings.billingSettings.promptTokensDesc' },
    { label: 'settings.billingSettings.completionTokens', hint: 'settings.billingSettings.completionTokensDesc' },
    { label: 'settings.billingSettings.estimatedCost', hint: 'settings.billingSettings.estimatedCostDesc' },
  ] as const;

  return (
    <SettingsPageWrapper contentClassName='max-w-960px'>
      <div className='flex flex-col gap-20px'>
        <NotActiveNotice detail={t('settings.notActive.billing')} />

        <Card title={t('settings.billingSettings.usageTitle')} bordered className='rd-12px'>
          <div className='grid grid-cols-1 md:grid-cols-3 gap-12px'>
            {tiles.map((tile) => (
              <div key={tile.label} className='p-12px rd-8px bg-fill-2 flex flex-col'>
                <span className='text-11px text-t-tertiary'>{t(tile.label)}</span>
                <strong className='text-16px text-t-tertiary mt-4px'>—</strong>
                <small className='text-10px text-t-tertiary'>{t(tile.hint)}</small>
              </div>
            ))}
          </div>
        </Card>

        <Card title={t('settings.billingSettings.spendingCapTitle')} bordered className='rd-12px'>
          <div className='flex flex-wrap items-center justify-between gap-12px'>
            <div>
              <strong className='text-14px text-t-primary'>{t('settings.billingSettings.spendingCapHeading')}</strong>
              <p className='text-12px text-t-tertiary m-0 mt-2px'>{t('settings.billingSettings.spendingCapDesc')}</p>
            </div>
            <div className='flex items-center gap-8px'>
              <span>{t('settings.billingSettings.spendingCapLabel')}</span>
              <InputNumber style={{ width: 120 }} prefix='$' disabled />
            </div>
          </div>
        </Card>
      </div>
    </SettingsPageWrapper>
  );
};

export default BillingSettings;
