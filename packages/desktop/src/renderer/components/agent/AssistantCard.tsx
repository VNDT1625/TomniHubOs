/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { countAssistantItems } from '@/common/types/agent/assistant/assistantSessionSelection';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { Check, Robot } from '@icon-park/react';
import React from 'react';
import { parseUconAvatar } from '@/renderer/components/agents/uconBotConfig';
import { parsePackageAvatar } from '@/renderer/components/agents/uconPackageSkins';
import { UconBot } from '@/renderer/components/agents/UconBot';
import { parseUconCliAvatar } from '@/renderer/components/agents/uconCliSkins';
import { useTranslation } from 'react-i18next';

/** True when an avatar value is an image address rather than an emoji or a label. */
export const isImageAvatarValue = (value: string): boolean =>
  /\.(svg|png|jpe?g|webp|gif)$/iu.test(value) || /^(https?:|file:|data:|\/)/iu.test(value);

export type AssistantCardProps = {
  assistant: Assistant;
  /** Locale key used for names and descriptions (for example `vi-VN`). */
  localeKey: string;
  selected?: boolean;
  testId: string;
  countsTestId: string;
  /** Image address already resolved by the page; wins over the emoji. */
  avatarImage?: string;
  /** Emoji or short text avatar. */
  avatarEmoji?: string;
  onClick: () => void;
};

/**
 * One assistant as a card: avatar on a tinted tile, the name (two lines allowed, never cut to "..." on one line), a
 * one-line description, and chips for what the assistant brings. Selected state is an accent border and a check.
 */
export const AssistantCard: React.FC<AssistantCardProps> = ({
  assistant,
  localeKey,
  selected = false,
  testId,
  countsTestId,
  avatarImage,
  avatarEmoji,
  onClick,
}) => {
  const { t } = useTranslation();
  const name = assistant.name_i18n?.[localeKey] || assistant.name;
  const description = assistant.description_i18n?.[localeKey] || assistant.description || '';
  const counts = countAssistantItems(assistant);
  const uconChoice =
    parseUconAvatar(assistant.avatar) || parsePackageAvatar(assistant.avatar) || parseUconCliAvatar(assistant.avatar);
  const chips: string[] = [];
  if (counts.skills > 0)
    chips.push(t('guid.assistantChipSkills', { count: counts.skills, defaultValue: '{{count}} skill(s)' }));
  if (counts.plugins > 0)
    chips.push(t('guid.assistantChipPlugins', { count: counts.plugins, defaultValue: '{{count}} plugin(s)' }));
  if (counts.hooks > 0)
    chips.push(t('guid.assistantChipHooks', { count: counts.hooks, defaultValue: '{{count}} hook(s)' }));
  if (counts.tools > 0)
    chips.push(t('guid.assistantChipTools', { count: counts.tools, defaultValue: 'Tool có sẵn {{count}}' }));
  return (
    <button
      type='button'
      data-testid={testId}
      aria-pressed={selected}
      className={`assistant-card ${selected ? 'assistant-card--selected' : ''}`}
      onClick={onClick}
    >
      <span className='assistant-card__head'>
        <span className='assistant-card__avatar' aria-hidden='true'>
          {uconChoice ? (
            <UconBot
              state='idle'
              avatar={assistant.avatar}
                            cliAgentId={assistant.preset_agent_type}
              placement='assistant'
              identity={assistant.id}
              size='mini'
              label={name}
            />
          ) : avatarImage ? (
            <img src={avatarImage} alt='' />
          ) : avatarEmoji ? (
            <span>{avatarEmoji}</span>
          ) : (
            <Robot theme='outline' size={20} />
          )}
        </span>
        <span className='assistant-card__name'>{name}</span>
        {selected ? (
          <span className='assistant-card__check' aria-hidden='true'>
            <Check theme='outline' size={12} strokeWidth={4} />
          </span>
        ) : null}
      </span>
      {description ? <span className='assistant-card__desc'>{description}</span> : null}
      {chips.length > 0 ? (
        <span className='assistant-card__chips' data-testid={countsTestId}>
          {chips.map((chip) => (
            <span key={chip} className='assistant-card__chip'>
              {chip}
            </span>
          ))}
        </span>
      ) : null}
    </button>
  );
};
