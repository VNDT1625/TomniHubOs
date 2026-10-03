/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Button, Card, Checkbox, Input, Message, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { Lock, Key, Notes } from '@icon-park/react';
import { iconColors } from '@/renderer/styles/colors';

const { Text } = Typography;

export interface InChatSecretFormProps {
  serviceName?: string;
  requestId?: string;
  onSubmit: (secretData: { secretValue: string; purposeNote: string; rememberCausalContext: boolean }) => Promise<void>;
  onCancel?: () => void;
}

export const InChatSecretForm: React.FC<InChatSecretFormProps> = ({
  serviceName = 'Dịch vụ / API',
  requestId,
  onSubmit,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [secretValue, setSecretValue] = useState('');
  const [purposeNote, setPurposeNote] = useState('');
  const [rememberCausalContext, setRememberCausalContext] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!secretValue.trim()) {
      Message.warning(t('messages.secret.emptyError', { defaultValue: 'Vui lòng nhập secret / token' }));
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        secretValue: secretValue.trim(),
        purposeNote: purposeNote.trim(),
        rememberCausalContext,
      });
      setSubmitted(true);
      Message.success(
        t('messages.secret.saveSuccess', {
          defaultValue: 'Đã lưu secret an toàn và ghi nhớ ngữ cảnh nhân quả!',
        })
      );
    } catch (err) {
      console.error('Failed to submit secret:', err);
      Message.error(t('messages.secret.saveFailed', { defaultValue: 'Lỗi khi lưu secret' }));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div
        className='p-12px rd-12px b-1 b-solid flex items-center gap-8px'
        style={{
          backgroundColor: 'var(--color-success-light-1)',
          borderColor: 'rgb(var(--success-3))',
        }}
        data-testid='in-chat-secret-success'
      >
        <Lock theme='filled' size='18' fill='rgb(var(--success-6))' />
        <div>
          <div className='text-13px font-600' style={{ color: 'rgb(var(--success-6))' }}>
            {t('messages.secret.securedTitle', { defaultValue: 'Secret đã được mã hóa an toàn' })}
          </div>
          {purposeNote && (
            <div className='text-12px text-t-secondary mt-2px'>
              Mục đích: <span className='font-500 text-t-primary'>{purposeNote}</span> (Laya đã ghi nhớ ngữ cảnh)
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card
      className='mb-4 rd-16px b-1 b-solid'
      style={{
        background: 'var(--bg-1)',
        borderColor: 'var(--color-border-2)',
      }}
      data-testid='in-chat-secret-form'
    >
      <div className='flex flex-col gap-12px'>
        <div className='flex items-center gap-8px'>
          <div className='w-32px h-32px rd-8px bg-aou-2 flex items-center justify-center flex-shrink-0'>
            <Lock theme='outline' size='18' fill={iconColors.secondary} />
          </div>
          <div>
            <div className='text-14px font-650 text-t-primary'>
              {t('messages.secret.title', { defaultValue: `Yêu cầu xác thực: ${serviceName}` })}
            </div>
            <div className='text-12px text-t-secondary'>
              {t('messages.secret.desc', {
                defaultValue: 'Secret được mã hóa một chiều tại Main process và không bao giờ lộ ra LLM.',
              })}
            </div>
          </div>
        </div>

        {/* Secret / Token input */}
        <div className='flex flex-col gap-4px'>
          <label className='text-12px font-600 text-t-primary flex items-center gap-4px'>
            <Key theme='outline' size='14' />
            {t('messages.secret.tokenLabel', { defaultValue: 'API Key / Token / Mật khẩu' })}
          </label>
          <Input.Password
            value={secretValue}
            onChange={setSecretValue}
            placeholder={t('messages.secret.tokenPlaceholder', { defaultValue: 'Nhập secret...' })}
            className='rd-8px'
          />
        </div>

        {/* Purpose context note */}
        <div className='flex flex-col gap-4px'>
          <label className='text-12px font-600 text-t-primary flex items-center gap-4px'>
            <Notes theme='outline' size='14' />
            {t('messages.secret.purposeLabel', { defaultValue: 'Ghi chú mục đích (Causal Context)' })}
          </label>
          <Input
            value={purposeNote}
            onChange={setPurposeNote}
            placeholder={t('messages.secret.purposePlaceholder', {
              defaultValue: 'VD: Dùng cho tài khoản Facebook bán hàng, không dùng cho cá nhân',
            })}
            className='rd-8px'
          />
        </div>

        {/* Laya causal intelligence checkbox */}
        <div className='pt-2px'>
          <Checkbox
            checked={rememberCausalContext}
            onChange={setRememberCausalContext}
            className='text-12px text-t-secondary'
          >
            {t('messages.secret.rememberContext', {
              defaultValue: 'Laya tự động chọn secret này khi thực hiện các tác vụ phù hợp với mục đích trên',
            })}
          </Checkbox>
        </div>

        {/* Action Buttons */}
        <div className='flex items-center justify-end gap-8px pt-4px'>
          {onCancel && (
            <Button size='small' type='secondary' onClick={onCancel} disabled={isSubmitting}>
              {t('common.cancel', { defaultValue: 'Hủy' })}
            </Button>
          )}
          <Button
            size='small'
            type='primary'
            loading={isSubmitting}
            onClick={handleSubmit}
            data-testid='in-chat-secret-submit'
          >
            {t('messages.secret.confirmButton', { defaultValue: 'Lưu an toàn & Tiếp tục' })}
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default InChatSecretForm;
