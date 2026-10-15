/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessagePermission } from '@/common/chat/chatLib';
import { ipcBridge } from '@/common';
import { Button, Card, Message, Radio, Typography } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

interface MessagePermissionProps {
  message: IMessagePermission;
}

const actionIcons: Record<string, string> = {
  exec: '⚡',
  edit: '✏️',
  info: '📖',
  mcp: '🔌',
};

/**
 * Starts a fresh prompt on the allow-always option when one exists so a plain Accept
 * becomes a persistent grant that does not re-prompt; deny options are the last resort.
 */
const pickDefaultOption = (options: ReadonlyArray<{ value: unknown }>): string | null => {
  const values = options.map((option) => String(option.value));
  if (values.includes('proceed_always')) return 'proceed_always';
  if (values.includes('proceed_once')) return 'proceed_once';
  return values.find((value) => value !== 'cancel') ?? values[0] ?? null;
};
const MessagePermission: React.FC<MessagePermissionProps> = React.memo(({ message }) => {
  const { t } = useTranslation();
  const {
    options = [],
    description,
    title,
    action,
    call_id,
    command_type,
    native_core_permission_id,
  } = message.content || {};

  const [selected, setSelected] = useState<string | null>(() => pickDefaultOption(options));
  const [isResponding, setIsResponding] = useState(false);
  const [hasResponded, setHasResponded] = useState(false);

  const icon = actionIcons[action || ''] || '🔐';
  const displayTitle = title || description || t('messages.permissionRequest');

  const handleConfirm = async () => {
    if (hasResponded || !selected) return;

    setIsResponding(true);
    try {
      const always_allow = selected === 'proceed_always';
      if (native_core_permission_id) {
        const resolved = await ipcBridge.conversation.resolveNativePermission.invoke({
          permission_id: native_core_permission_id,
          approved: selected !== 'cancel',
          lifetime: always_allow ? 'persistent' : 'allow-once',
        });
        if (!resolved) throw new Error('The permission request is no longer active.');
      } else {
        await ipcBridge.conversation.confirmation.confirm.invoke({
          conversation_id: message.conversation_id,
          call_id,
          msg_id: message.msg_id || '',
          data: { value: selected },
          always_allow,
        });
      }
      setHasResponded(true);
    } catch (error) {
      console.error('Error confirming permission:', error);
      Message.error(t('ide.agentMesh.actionFailed'));
    } finally {
      setIsResponding(false);
    }
  };

  /** Denies the pending request immediately; a radio selection is not required to block. */
  const handleBlock = async () => {
    if (hasResponded || isResponding) return;

    setIsResponding(true);
    try {
      if (native_core_permission_id) {
        const resolved = await ipcBridge.conversation.resolveNativePermission.invoke({
          permission_id: native_core_permission_id,
          approved: false,
        });
        if (!resolved) throw new Error('The permission request is no longer active.');
      } else {
        await ipcBridge.conversation.confirmation.confirm.invoke({
          conversation_id: message.conversation_id,
          call_id,
          msg_id: message.msg_id || '',
          data: { value: 'cancel' },
          always_allow: false,
        });
      }
      setHasResponded(true);
    } catch (error) {
      console.error('Error blocking permission:', error);
      Message.error(t('ide.agentMesh.actionFailed'));
    } finally {
      setIsResponding(false);
    }
  };

  return (
    <Card className='mb-4' bordered={false} style={{ background: 'var(--bg-1)' }} data-testid='message-permission-card'>
      <div className='space-y-4'>
        <div className='flex items-center space-x-2'>
          <span className='text-2xl'>{icon}</span>
          <Text className='block'>{displayTitle}</Text>
        </div>
        {command_type && (
          <div>
            <Text className='text-xs text-t-secondary mb-1'>{t('messages.command')}</Text>
            <code className='text-xs bg-1 p-2 rounded block text-t-primary break-all'>{command_type}</code>
          </div>
        )}
        {description && description !== displayTitle && (
          <div>
            <Text className='text-xs text-t-secondary'>{description}</Text>
          </div>
        )}
        {!hasResponded && (
          <>
            <div className='mt-10px'>{t('messages.chooseAction')}</div>
            <Radio.Group direction='vertical' size='mini' value={selected} onChange={setSelected}>
              {options.length > 0 ? (
                options.map((option, index) => (
                  <div
                    key={String(option.value) || `option_${index}`}
                    data-testid={`message-permission-option-${String(option.value) || `option_${index}`}`}
                  >
                    <Radio value={String(option.value)}>
                      {t(option.label, { ...option.params, defaultValue: option.label })}
                    </Radio>
                  </div>
                ))
              ) : (
                <Text type='secondary'>{t('messages.noOptionsAvailable')}</Text>
              )}
            </Radio.Group>
            <div className='flex justify-start pl-20px space-x-2'>
              <Button size='mini' disabled={isResponding} onClick={handleBlock} data-testid='message-permission-block'>
                {t('messages.block')}
              </Button>
              <Button
                type='primary'
                size='mini'
                disabled={!selected || isResponding}
                onClick={handleConfirm}
                data-testid='message-permission-confirm'
              >
                {isResponding ? t('messages.processing') : t('messages.accept')}
              </Button>
            </div>
          </>
        )}
        {hasResponded && (
          <div
            className='mt-10px p-2 rounded-md border'
            style={{ backgroundColor: 'var(--color-success-light-1)', borderColor: 'rgb(var(--success-3))' }}
          >
            <Text className='text-sm' style={{ color: 'rgb(var(--success-6))' }}>
              ✓ {t('messages.responseSentSuccessfully')}
            </Text>
          </div>
        )}
      </div>
    </Card>
  );
});

export default MessagePermission;
