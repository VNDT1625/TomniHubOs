/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Card, Divider, InputNumber, Switch, Tag, Typography } from '@arco-design/web-react';
import { Shield } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import SettingsPageWrapper from './components/SettingsPageWrapper';

/**
 * 2.3 Pipeline Chat:
 * - Quản lý 4 tầng Guardrail kiểm duyệt code:
 *   1. Lọc cú pháp & Phụ thuộc tĩnh (AST & Slopsquatting check)
 *   2. Môi trường thực thi cô lập (Sandboxed Red-to-Green Testing)
 *   3. Kiểm soát độ lệch thay đổi (Diff cap & Test Immutability)
 *   4. Tự động hóa đánh giá (Dual-Model Verifier & Rollback)
 */
const PipelineChatSettings: React.FC = () => {
  const { t } = useTranslation();
  const [astCheck, setAstCheck] = useState(true);
  const [packageCheck, setPackageCheck] = useState(true);
  const [strictTypeCheck, setStrictTypeCheck] = useState(true);

  const [sandboxEnabled, setSandboxEnabled] = useState(true);
  const [redToGreen, setRedToGreen] = useState(true);

  const [diffLimit, setDiffLimit] = useState(60);
  const [testLock, setTestLock] = useState(true);

  const [dualModelReview, setDualModelReview] = useState(true);
  const [autoRollbackTries, setAutoRollbackTries] = useState(3);

  return (
    <SettingsPageWrapper contentClassName='max-w-960px'>
      <div className='flex flex-col gap-20px'>
        {/* Intro Banner */}
        <Card bordered className='rd-12px bg-fill-1'>
          <div className='flex items-center gap-14px'>
            <div className='w-44px h-44px rd-8px bg-arcoblue-1 text-primary flex items-center justify-center text-22px'>
              <Shield theme='outline' size={24} fill='currentColor' />
            </div>
            <div>
              <strong className='text-16px text-t-primary'>{t('settings.pipelineSettings.title')}</strong>
              <p className='text-12px text-t-secondary m-0 mt-2px'>{t('settings.pipelineSettings.bannerDesc')}</p>
            </div>
          </div>
        </Card>

        {/* Tầng 1: Lọc cú pháp và kiểm tra phụ thuộc tĩnh */}
        <Card title={t('settings.pipelineSettings.tier1Title')} bordered className='rd-12px'>
          <div className='flex flex-col gap-12px'>
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-13px text-t-primary'>{t('settings.pipelineSettings.astTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0'>{t('settings.pipelineSettings.astDesc')}</p>
              </div>
              <Switch checked={astCheck} onChange={setAstCheck} />
            </div>
            <Divider className='my-6px' />
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-13px text-t-primary'>{t('settings.pipelineSettings.packageTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0'>{t('settings.pipelineSettings.packageDesc')}</p>
              </div>
              <Switch checked={packageCheck} onChange={setPackageCheck} />
            </div>
            <Divider className='my-6px' />
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-13px text-t-primary'>{t('settings.pipelineSettings.strictTypeTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0'>{t('settings.pipelineSettings.strictTypeDesc')}</p>
              </div>
              <Switch checked={strictTypeCheck} onChange={setStrictTypeCheck} />
            </div>
          </div>
        </Card>

        {/* Tầng 2: Môi trường thực thi cô lập */}
        <Card title={t('settings.pipelineSettings.tier2Title')} bordered className='rd-12px'>
          <div className='flex flex-col gap-12px'>
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-13px text-t-primary'>{t('settings.pipelineSettings.sandboxTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0'>{t('settings.pipelineSettings.sandboxDesc')}</p>
              </div>
              <Switch checked={sandboxEnabled} onChange={setSandboxEnabled} />
            </div>
            <Divider className='my-6px' />
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-13px text-t-primary'>{t('settings.pipelineSettings.redToGreenTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0'>{t('settings.pipelineSettings.redToGreenDesc')}</p>
              </div>
              <Switch checked={redToGreen} onChange={setRedToGreen} />
            </div>
          </div>
        </Card>

        {/* Tầng 3: Kiểm soát độ lệch thay đổi */}
        <Card title={t('settings.pipelineSettings.tier3Title')} bordered className='rd-12px'>
          <div className='flex flex-col gap-12px'>
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-13px text-t-primary'>{t('settings.pipelineSettings.diffLimitTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0'>{t('settings.pipelineSettings.diffLimitDesc')}</p>
              </div>
              <div className='flex items-center gap-6px'>
                <span>{t('settings.pipelineSettings.diffLimitMax')}</span>
                <InputNumber
                  style={{ width: 90 }}
                  value={diffLimit}
                  min={20}
                  max={300}
                  onChange={(v) => setDiffLimit(v || 60)}
                />
                <span className='text-11px text-t-tertiary'>{t('settings.pipelineSettings.linesUnit')}</span>
              </div>
            </div>
            <Divider className='my-6px' />
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-13px text-t-primary'>{t('settings.pipelineSettings.testLockTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0'>{t('settings.pipelineSettings.testLockDesc')}</p>
              </div>
              <Switch checked={testLock} onChange={setTestLock} />
            </div>
          </div>
        </Card>

        {/* Tầng 4: Đánh giá độc lập & Rollback */}
        <Card title={t('settings.pipelineSettings.tier4Title')} bordered className='rd-12px'>
          <div className='flex flex-col gap-12px'>
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-13px text-t-primary'>{t('settings.pipelineSettings.dualModelTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0'>{t('settings.pipelineSettings.dualModelDesc')}</p>
              </div>
              <Switch checked={dualModelReview} onChange={setDualModelReview} />
            </div>
            <Divider className='my-6px' />
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-13px text-t-primary'>{t('settings.pipelineSettings.autoRollbackTitle')}</strong>
                <p className='text-12px text-t-tertiary m-0'>{t('settings.pipelineSettings.autoRollbackDesc')}</p>
              </div>
              <div className='flex items-center gap-6px'>
                <InputNumber
                  style={{ width: 80 }}
                  value={autoRollbackTries}
                  min={1}
                  max={5}
                  onChange={(v) => setAutoRollbackTries(v || 3)}
                />
                <span className='text-11px text-t-tertiary'>{t('settings.pipelineSettings.triesUnit')}</span>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </SettingsPageWrapper>
  );
};

export default PipelineChatSettings;
