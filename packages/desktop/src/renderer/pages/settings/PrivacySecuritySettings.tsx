/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Card, Divider, Input, Switch, Tag, Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import SettingsPageWrapper from './components/SettingsPageWrapper';

/**
 * 3.5 Privacy & Security (Bảo mật Hệ thống):
 * - Hộp cát thực thi (Sandbox Mode / YOLO Mode)
 * - Giám sát mạng Egress (Whitelist domain kết nối)
 * - Che giấu dữ liệu nhạy cảm (Secret Masking)
 * - Nhật ký kiểm toán (Audit Trail)
 */
const PrivacySecuritySettings: React.FC = () => {
  const { t } = useTranslation();
  const [yoloMode, setYoloMode] = useState(false);
  const [secretMasking, setSecretMasking] = useState(true);
  const [egressStrict, setEgressStrict] = useState(true);

  return (
    <SettingsPageWrapper contentClassName='max-w-960px'>
      <div className='flex flex-col gap-20px'>
        <Card title={t('settings.privacySecuritySettings.sandboxTitle')} bordered className='rd-12px'>
          <div className='flex flex-col gap-12px'>
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-13px text-t-primary'>
                  {t('settings.privacySecuritySettings.yoloModeTitle')}
                </strong>
                <p className='text-12px text-t-tertiary m-0'>{t('settings.privacySecuritySettings.yoloModeDesc')}</p>
                {yoloMode && (
                  <Tag color='red' size='small' className='mt-4px'>
                    {t('settings.privacySecuritySettings.yoloWarning')}
                  </Tag>
                )}
              </div>
              <Switch checked={yoloMode} onChange={setYoloMode} />
            </div>
            <Divider className='my-6px' />
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-13px text-t-primary'>
                  {t('settings.privacySecuritySettings.secretMaskingTitle')}
                </strong>
                <p className='text-12px text-t-tertiary m-0'>
                  {t('settings.privacySecuritySettings.secretMaskingDesc')}
                </p>
              </div>
              <Switch checked={secretMasking} onChange={setSecretMasking} />
            </div>
          </div>
        </Card>

        <Card title={t('settings.privacySecuritySettings.egressTitle')} bordered className='rd-12px'>
          <div className='flex flex-col gap-12px'>
            <div className='flex items-center justify-between'>
              <div>
                <strong className='text-13px text-t-primary'>
                  {t('settings.privacySecuritySettings.egressStrictTitle')}
                </strong>
                <p className='text-12px text-t-tertiary m-0'>
                  {t('settings.privacySecuritySettings.egressStrictDesc')}
                </p>
              </div>
              <Switch checked={egressStrict} onChange={setEgressStrict} />
            </div>
            <div className='p-12px rd-8px bg-fill-2 mt-4px'>
              <span className='text-12px font-bold text-t-secondary block mb-8px'>
                {t('settings.privacySecuritySettings.allowedDomains')}
              </span>
              <div className='flex flex-wrap gap-6px'>
                <Tag color='green'>api.openai.com</Tag>
                <Tag color='green'>api.anthropic.com</Tag>
                <Tag color='green'>github.com</Tag>
                <Tag color='green'>*.supabase.co</Tag>
                <Tag color='arcoblue'>127.0.0.1 ({t('settings.privacySecuritySettings.loopback')})</Tag>
                <Tag color='arcoblue'>localhost</Tag>
              </div>
            </div>
          </div>
        </Card>

        <Card title={t('settings.privacySecuritySettings.auditTitle')} bordered className='rd-12px'>
          <div className='flex items-center justify-between'>
            <div>
              <strong className='text-13px text-t-primary'>{t('settings.privacySecuritySettings.auditTitle')}</strong>
              <p className='text-12px text-t-tertiary m-0 mt-2px'>{t('settings.privacySecuritySettings.auditDesc')}</p>
            </div>
            <Button type='secondary'>{t('settings.privacySecuritySettings.viewAuditLog')}</Button>
          </div>
        </Card>
      </div>
    </SettingsPageWrapper>
  );
};

export default PrivacySecuritySettings;
