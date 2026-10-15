/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageAcpPermission } from '@/common/chat/chatLib';
import type { AcpPermissionOption } from '@/common/types/platform/acpTypes';
import { conversation } from '@/common/adapter/ipcBridge';
import { Button, Card, Radio, Typography } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

interface MessageAcpPermissionProps {
  message: IMessageAcpPermission;
}

/**
 * Starts a fresh ACP prompt on the most permissive allow option so a plain Accept does
 * not re-prompt; reject-only prompts fall back to their first offered option.
 */
const pickDefaultOption = (options: ReadonlyArray<AcpPermissionOption | undefined>): string | null => {
  const allow =
    options.find((option) => option?.kind === 'allow_always') ??
    options.find((option) => option?.kind === 'allow_once');
  if (allow?.option_id) return allow.option_id;
  const allowLike = options.find((option) => option?.kind !== 'reject_always' && option?.kind !== 'reject_once');
  return allowLike?.option_id ?? options[0]?.option_id ?? null;
};

/**
 * Returns the option a Block button submits; reject-once is preferred so a blocked
 * request stays retryable, and text matching is a last resort for custom options.
 */
const pickRejectOption = (options: ReadonlyArray<AcpPermissionOption | undefined>): AcpPermissionOption | undefined =>
  options.find((option) => option?.kind === 'reject_once') ??
  options.find((option) => option?.kind === 'reject_always') ??
  options.find((option) => option?.name !== undefined && /reject|deny|block|cancel/i.test(option.name));
const MessageAcpPermission: React.FC<MessageAcpPermissionProps> = React.memo(({ message }) => {
  const { options = [], tool_call } = message.content || {};
  const { t } = useTranslation();

  // 基于实际数据生成显示信息
  const getToolInfo = () => {
    if (!tool_call) {
      return {
        title: t('messages.permissionRequest'),
        description: t('messages.agentRequestingPermission'),
        icon: '🔐',
      };
    }

    const displayTitle = tool_call.title || tool_call.raw_input?.description || t('messages.permissionRequest');

    // 简单的图标映射
    const kindIcons: Record<string, string> = {
      edit: '✏️',
      read: '📖',
      fetch: '🌐',
      execute: '⚡',
    };

    return {
      title: displayTitle,
      icon: kindIcons[tool_call.kind || 'execute'] || '⚡',
    };
  };
  const { title, icon } = getToolInfo();
  const [selected, setSelected] = useState<string | null>(() => pickDefaultOption(options));
  const [isResponding, setIsResponding] = useState(false);
  const [hasResponded, setHasResponded] = useState(false);

  const rejectOption = pickRejectOption(options);

  const respond = async (confirm_key: string): Promise<void> => {
    await conversation.confirmMessage.invoke({
      confirm_key,
      msg_id: message.id,
      conversation_id: message.conversation_id,
      call_id: tool_call?.tool_call_id || message.id,
    });
    setHasResponded(true);
  };

  const handleConfirm = async () => {
    if (hasResponded || !selected || isResponding) return;

    setIsResponding(true);
    try {
      await respond(selected);
    } catch (error) {
      console.error('Error confirming permission:', error);
    } finally {
      setIsResponding(false);
    }
  };

  /** Denies the request with the agent reject option; no radio selection is required. */
  const handleBlock = async () => {
    if (!rejectOption?.option_id || hasResponded || isResponding) return;

    setIsResponding(true);
    try {
      await respond(rejectOption.option_id);
    } catch (error) {
      console.error('Error blocking permission:', error);
    } finally {
      setIsResponding(false);
    }
  };

  if (!tool_call) {
    return null;
  }

  return (
    <Card
      className='mb-4'
      bordered={false}
      style={{ background: 'var(--bg-1)' }}
      data-testid='message-acp-permission-card'
    >
      <div className='space-y-4'>
        {/* Header with icon and title */}
        <div className='flex items-center space-x-2'>
          <span className='text-2xl'>{icon}</span>
          <Text className='block'>{title}</Text>
        </div>
        {(tool_call.raw_input?.command || tool_call.title) && (
          <div>
            <Text className='text-xs text-t-secondary mb-1'>{t('messages.command')}</Text>
            <code className='text-xs bg-1 p-2 rounded block text-t-primary break-all'>
              {tool_call.raw_input?.command || tool_call.title}
            </code>
          </div>
        )}
        {!hasResponded && (
          <>
            <div className='mt-10px'>{t('messages.chooseAction')}</div>
            <Radio.Group direction='vertical' size='mini' value={selected} onChange={setSelected}>
              {options && options.length > 0 ? (
                options.map((option, index) => {
                  const optionName = option?.name || `${t('messages.option')} ${index + 1}`;
                  const option_id = option?.option_id || `option_${index}`;
                  return (
                    <div key={option_id} data-testid={`message-acp-permission-option-${option_id}`}>
                      <Radio value={option_id}>{optionName}</Radio>
                    </div>
                  );
                })
              ) : (
                <Text type='secondary'>{t('messages.noOptionsAvailable')}</Text>
              )}
            </Radio.Group>
            <div className='flex justify-start pl-20px space-x-2'>
              {rejectOption && (
                <Button
                  size='mini'
                  disabled={isResponding}
                  onClick={handleBlock}
                  data-testid='message-acp-permission-block'
                >
                  {t('messages.block')}
                </Button>
              )}
              <Button
                type='primary'
                size='mini'
                disabled={!selected || isResponding}
                onClick={handleConfirm}
                data-testid='message-acp-permission-confirm'
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

export default MessageAcpPermission;
