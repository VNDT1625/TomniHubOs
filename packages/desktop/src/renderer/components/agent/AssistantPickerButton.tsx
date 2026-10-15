/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Assistant } from '@/common/types/agent/assistantTypes';
import { Button, Popover, Tooltip } from '@arco-design/web-react';
import { Close, Plus, Robot } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AssistantCard, isImageAvatarValue } from './AssistantCard';

export { isImageAvatarValue } from './AssistantCard';

export type AssistantPickerButtonProps = {
  assistants: Assistant[];
  /** Id of the assistant applied to the chat, or undefined when none is used. */
  selectedAssistantId?: string;
  localeKey: string;
  onSelectAssistant: (assistantId: string) => void;
  onCreateAssistant: () => void;
  onClearAssistant: () => void;
};

/**
 * Assistant picker of the chat composer. The panel is a grid of assistant cards with a prominent dashed "create" card
 * and a quiet "no assistant" text button. Picking a card or an action closes the panel.
 */
const AssistantPickerButton: React.FC<AssistantPickerButtonProps> = ({
  assistants,
  selectedAssistantId,
  localeKey,
  onSelectAssistant,
  onCreateAssistant,
  onClearAssistant,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = t('guid.assistantPickerButton', { defaultValue: 'Assistant' });
  const selected = selectedAssistantId ? assistants.find((item) => item.id === selectedAssistantId) : undefined;
  const selectedName = selected ? selected.name_i18n?.[localeKey] || selected.name : undefined;
  const visible = assistants.filter((item) => item.enabled !== false);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  const panel = (
    <div className='assistant-picker' data-testid='assistant-picker-panel'>
      <div className='assistant-picker__title'>
        {t('guid.assistantPickerTitle', { defaultValue: 'Choose an assistant' })}
      </div>
      <div className='assistant-picker__grid'>
        {visible.map((assistant) => {
          const avatar = assistant.avatar?.trim() ?? '';
          const image = avatar && isImageAvatarValue(avatar) ? avatar : undefined;
          return (
            <AssistantCard
              key={assistant.id}
              assistant={assistant}
              localeKey={localeKey}
              selected={assistant.id === selectedAssistantId}
              testId={`assistant-picker-card-${assistant.id}`}
              countsTestId={`assistant-picker-counts-${assistant.id}`}
              avatarImage={image}
              avatarEmoji={avatar && !image ? avatar : undefined}
              onClick={() => choose(() => onSelectAssistant(assistant.id))}
            />
          );
        })}
        <button
          type='button'
          data-testid='assistant-picker-create'
          className='assistant-card assistant-card--add'
          onClick={() => choose(onCreateAssistant)}
        >
          <Plus theme='outline' size={20} />
          <span>{t('guid.assistantPickerCreate', { defaultValue: 'Create assistant' })}</span>
        </button>
      </div>
      <button
        type='button'
        data-testid='assistant-picker-none'
        className='assistant-picker__none'
        onClick={() => choose(onClearAssistant)}
      >
        <Close theme='outline' size={12} /> {t('guid.assistantPickerNone', { defaultValue: 'No assistant' })}
      </button>
    </div>
  );

  return (
    <Tooltip content={label}>
      <span className='inline-flex items-center'>
        <Popover trigger='click' position='top' popupVisible={open} onVisibleChange={setOpen} content={panel}>
          <Button
            type='text'
            size='small'
            className='flex items-center gap-4px'
            data-testid='guid-assistant-picker-button'
            aria-label={label}
            aria-haspopup='dialog'
            aria-expanded={open}
            icon={<Robot theme='outline' size='15' fill='currentColor' />}
          >
            {selectedName && (
              <span
                className='max-w-[96px] truncate text-11px px-6px rd-10px bg-fill-2'
                data-testid='assistant-picker-chip'
              >
                {selectedName}
              </span>
            )}
          </Button>
        </Popover>
      </span>
    </Tooltip>
  );
};

export default AssistantPickerButton;
