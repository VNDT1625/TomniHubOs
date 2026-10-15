/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Assistant } from '@/common/types/agent/assistantTypes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      String(opts?.defaultValue ?? key).replace(
        /\{\{(\w+)\}\}/gu,
        (_match, name: string) => String(opts?.[name] ?? '')
      ),
  }),
}));

import AssistantPickerButton, { isImageAvatarValue } from '@/renderer/components/agent/AssistantPickerButton';

const base = {
  name_i18n: {},
  description_i18n: {},
  enabled: true,
  sort_order: 0,
  preset_agent_type: 'tomnyagentic',
  custom_skill_names: [],
  disabled_builtin_skills: [],
  context_i18n: {},
  prompts: [],
  prompts_i18n: {},
  models: [],
} as const;

const assistants: Assistant[] = [
  {
    ...base,
    id: 'research',
    source: 'user',
    name: 'Research helper',
    description: 'Finds real-world information.',
    avatar: '🔎',
    enabled_skills: ['web-search', 'summarize'],
    enabled_plugins: ['mcp-search'],
    enabled_hooks: [],
  },
  {
    ...base,
    id: 'coder',
    source: 'builtin',
    name: 'Code helper',
    description: '',
    avatar: '',
    enabled_skills: [],
    enabled_plugins: [],
    enabled_hooks: ['a'.repeat(64)],
  },
];

const handlers = () => ({
  onSelectAssistant: vi.fn(),
  onCreateAssistant: vi.fn(),
  onClearAssistant: vi.fn(),
});

const openPanel = async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  await user.click(screen.getByTestId('guid-assistant-picker-button'));
  return user;
};

describe('AssistantPickerButton', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the label and the selected assistant name as a chip', () => {
    render(
      <AssistantPickerButton assistants={assistants} selectedAssistantId='research' localeKey='en-US' {...handlers()} />
    );
    expect(screen.getByTestId('guid-assistant-picker-button').getAttribute('aria-label')).toBe('Assistant');
    expect(screen.getByTestId('assistant-picker-chip').textContent).toBe('Research helper');
  });

  it('shows no chip when no assistant is selected', () => {
    render(<AssistantPickerButton assistants={assistants} localeKey='en-US' {...handlers()} />);
    expect(screen.queryByTestId('assistant-picker-chip')).toBeNull();
  });

  it('opens a panel of cards with counts, create and no-assistant actions', async () => {
    render(<AssistantPickerButton assistants={assistants} localeKey='en-US' {...handlers()} />);
    await openPanel();
    expect(await screen.findByTestId('assistant-picker-panel')).toBeTruthy();
    expect(screen.getByTestId('assistant-picker-card-research').textContent).toContain('Finds real-world information.');
    expect(screen.getByTestId('assistant-picker-counts-research').textContent).toBe(
      '2 skill(s)1 plugin(s)'
    );
    expect(screen.getByTestId('assistant-picker-counts-coder').textContent).toBe('1 hook(s)');
    expect(screen.getByTestId('assistant-picker-create')).toBeTruthy();
    expect(screen.getByTestId('assistant-picker-none')).toBeTruthy();
  });

  it('choosing a card applies that assistant and closes the panel', async () => {
    const h = handlers();
    render(<AssistantPickerButton assistants={assistants} localeKey='en-US' {...h} />);
    const user = await openPanel();
    await user.click(await screen.findByTestId('assistant-picker-card-coder'));
    expect(h.onSelectAssistant).toHaveBeenCalledWith('coder');
    expect(h.onCreateAssistant).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('assistant-picker-panel')).toBeNull());
  });

  it('the create card and the no-assistant card call their own handlers', async () => {
    const h = handlers();
    render(<AssistantPickerButton assistants={assistants} selectedAssistantId='coder' localeKey='en-US' {...h} />);
    let user = await openPanel();
    await user.click(await screen.findByTestId('assistant-picker-create'));
    expect(h.onCreateAssistant).toHaveBeenCalledTimes(1);

    user = await openPanel();
    await user.click(await screen.findByTestId('assistant-picker-none'));
    expect(h.onClearAssistant).toHaveBeenCalledTimes(1);
    expect(h.onSelectAssistant).not.toHaveBeenCalled();
  });

  it('treats image avatars as paths and emoji avatars as text', () => {
    expect(isImageAvatarValue('icons/robot.svg')).toBe(true);
    expect(isImageAvatarValue('https://example.test/a.png')).toBe(true);
    expect(isImageAvatarValue('🔎')).toBe(false);
  });
});
