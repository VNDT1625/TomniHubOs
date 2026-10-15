/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Shown on a settings page whose controls are not connected to anything yet. The controls are disabled as
 * well, so nobody is led to believe that a switch protects or changes something when it does not.
 */
const NotActiveNotice: React.FC<{ detail: string }> = ({ detail }) => {
  const { t } = useTranslation();
  return (
    <Alert
      type='warning'
      data-testid='settings-not-active'
      title={t('settings.notActive.title')}
      content={detail}
      className='rd-12px'
    />
  );
};

export default NotActiveNotice;
