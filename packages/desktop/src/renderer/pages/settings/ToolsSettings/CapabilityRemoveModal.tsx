/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Modal } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

type CapabilityRemoveModalProps = {
  visible: boolean;
  /** Name of the item that will be removed, shown in the confirmation text. */
  name: string;
  /** Optional exact detail of what will be removed (file path, command), so the person sees the target. */
  detail?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Confirmation before removing a skill or hook. Cancel is the focused default so a stray Enter never removes anything.
 */
const CapabilityRemoveModal: React.FC<CapabilityRemoveModalProps> = ({
  visible,
  name,
  detail,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation();
  return (
    <Modal
      title={t('settings.capabilitiesTab.removeConfirmTitle', { defaultValue: 'Remove this item?' })}
      visible={visible}
      onCancel={onCancel}
      footer={
        <div className='flex justify-end gap-8px'>
          <Button autoFocus onClick={onCancel}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type='primary' status='danger' data-testid='btn-confirm-remove' onClick={onConfirm}>
            {t('common.delete', { defaultValue: 'Delete' })}
          </Button>
        </div>
      }
    >
      <p className='m-0 text-14px text-t-primary'>
        {t('settings.capabilitiesTab.removeConfirmContent', {
          name,
          defaultValue: `"${name}" will be removed. This cannot be undone.`,
        })}
      </p>
      {detail ? (
        <p className='mt-8px mb-0 text-12px text-t-tertiary font-mono break-all' data-testid='remove-target-detail'>
          {detail}
        </p>
      ) : null}
    </Modal>
  );
};

export default CapabilityRemoveModal;
