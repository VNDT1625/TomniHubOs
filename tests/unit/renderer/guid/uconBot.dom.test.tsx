import type { HubActivityItem, HubActivityStatus } from '@/common/types/agent/hubActivity';
import {
  UconBot,
  uconBotRoleFromActivity,
  uconBotStateFromActivity,
  uconBotTaskGlyphFromActivity,
} from '@/renderer/components/agents/UconBot';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const item = (status: HubActivityStatus, kind: HubActivityItem['kind'] = 'agent'): HubActivityItem => ({
  id: 'agent:bot-1',
  sourceId: 'bot-1',
  kind,
  title: 'Agent 1',
  status,
  startedAt: 1,
  updatedAt: 1,
  steps: [],
  canStop: true,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('UCON Bot Canvas visual language', () => {
  it('uses published activity status instead of text-based guesses', () => {
    const running = item('running');
    expect(uconBotStateFromActivity(running)).toBe('thinking');
    expect(
      uconBotTaskGlyphFromActivity({
        ...running,
        task: 'Write </> source code',
        steps: [{ id: '1', state: 'running', label: 'Coding' }],
      })
    ).toBeUndefined();
    expect(uconBotTaskGlyphFromActivity(item('running', 'app'))).toBe('app');
    expect(uconBotTaskGlyphFromActivity(item('running', 'team'))).toBe('nodes');
    expect(uconBotStateFromActivity({ ...running, task: 'search files now' })).toBe('thinking');
    expect(
      uconBotStateFromActivity({
        ...running,
        steps: [{ id: 'step1', label: 'Reading file', state: 'running' }],
      })
    ).toBe('working');
    expect(uconBotStateFromActivity(item('running', 'app'))).toBe('working');
    expect(uconBotStateFromActivity(item('needs_input'))).toBe('needs_input');
    expect(uconBotStateFromActivity(item('done'))).toBe('success');
    expect(uconBotStateFromActivity(item('error'))).toBe('error');
    expect(uconBotStateFromActivity(item('stopped'))).toBe('sleep');
  });

  it('shares the same visual system across agent, team, schedule and app', () => {
    expect(uconBotRoleFromActivity(item('running', 'agent'))).toBe('primary');
    expect(uconBotRoleFromActivity(item('running', 'team'))).toBe('team');
    expect(uconBotRoleFromActivity(item('running', 'schedule'))).toBe('schedule');
    expect(uconBotRoleFromActivity(item('running', 'app'))).toBe('app');
  });

  it('binds brand identity to the CLI, not the active model, and preserves manual UCON overrides', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { rerender } = render(<UconBot state='working' label='Claude CLI' cliAgentId='claude' />);
    expect(screen.getByRole('img').parentElement).toHaveAttribute('data-cli-skin', 'claude');
    rerender(<UconBot state='working' label='Claude CLI' cliAgentId='claude' avatar='ucon:core' />);
    expect(screen.getByRole('img').parentElement).not.toHaveAttribute('data-cli-skin');
    rerender(<UconBot state='working' label='Grok' cliAgentId='grok' avatar='uconcli:grok' />);
    expect(screen.getByRole('img').parentElement).toHaveAttribute('data-cli-skin', 'grok');
    rerender(<UconBot state='working' label='Tomny' cliAgentId='tomny' />);
    expect(screen.getByRole('img').parentElement).not.toHaveAttribute('data-cli-skin');
  });

  it('is an accessible canvas avatar and preserves its visual state and size', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<UconBot state='working' role='team' size='mini' label='Team, working' />);
    expect(screen.getByRole('img', { name: 'Team, working' }).tagName).toBe('CANVAS');
    const wrapper = screen.getByRole('img').parentElement;
    expect(wrapper).toHaveAttribute('data-state', 'working');
    expect(wrapper).toHaveAttribute('data-role', 'team');
    expect(wrapper).toHaveClass('ucon-bot--mini');
  });
});
