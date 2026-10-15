/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Assistant } from '@/common/types/agent/assistantTypes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      String(opts?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/gu, (_m, name: string) => String(opts?.[name] ?? '')),
  }),
}));

import { AssistantCard } from '@/renderer/components/agent/AssistantCard';

const assistant: Assistant = {
  id: 'research',
  source: 'user',
  name: 'Research helper with a very long name that must wrap onto two lines',
  name_i18n: {},
  description: 'Finds real-world information quickly.',
  description_i18n: {},
  enabled: true,
  sort_order: 0,
  preset_agent_type: 'tomnyagentic',
  enabled_skills: ['web-search', 'summarize'],
  custom_skill_names: [],
  disabled_builtin_skills: [],
  enabled_plugins: ['mcp-search'],
  enabled_hooks: ['a'.repeat(64)],
  default_tools: ['mcp-search::find', 'mcp-search::open', 'mcp-search::close'],
  context_i18n: {},
  prompts: [],
  prompts_i18n: {},
  models: [],
};

describe('AssistantCard', () => {
  afterEach(() => cleanup());

  it('shows the full name, the description and a chip per item kind', () => {
    render(
      <AssistantCard
        assistant={assistant}
        localeKey='en-US'
        testId='card'
        countsTestId='card-counts'
        avatarEmoji='X'
        onClick={vi.fn()}
      />
    );
    expect(screen.getByText(assistant.name)).toHaveClass('assistant-card__name');
    expect(screen.getByText('Finds real-world information quickly.')).toBeTruthy();
    const chips = screen.getByTestId('card-counts');
    expect(chips).toHaveTextContent('2 skill(s)');
    expect(chips).toHaveTextContent('1 plugin(s)');
    expect(chips).toHaveTextContent('1 hook(s)');
    expect(chips).toHaveTextContent('Tool có sẵn 3');
  });

  it('marks the selected card with aria-pressed and a check, and reports clicks', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { container, rerender } = render(
      <AssistantCard assistant={assistant} localeKey='en-US' testId='card' countsTestId='c' onClick={onClick} />
    );
    expect(screen.getByTestId('card')).toHaveAttribute('aria-pressed', 'false');
    expect(container.querySelector('.assistant-card__check')).toBeNull();
    await user.click(screen.getByTestId('card'));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <AssistantCard assistant={assistant} localeKey='en-US' selected testId='card' countsTestId='c' onClick={onClick} />
    );
    expect(screen.getByTestId('card')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('card')).toHaveClass('assistant-card--selected');
    expect(container.querySelector('.assistant-card__check')).not.toBeNull();
  });
});
