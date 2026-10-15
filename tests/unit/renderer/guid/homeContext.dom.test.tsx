import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionContextSnapshot } from '@/common';

const context = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      getSessionContext: { invoke: context.get },
      updateSessionContext: { invoke: context.update },
    },
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options && 'messages' in options) return `${key}|${options.messages}|${options.tokens}`;
      return options && 'count' in options ? `${options.count} tokens` : key;
    },
  }),
}));

import { HubSessionContext } from '@/renderer/pages/guid/HubHome/memory/HubSessionContext';

const tool = { name: 'ide_read', description: 'Read a file', input_schema: { type: 'object' }, deferred: false };

const nativeSnapshot = (): SessionContextSnapshot => ({
  conversation_id: 'c1',
  model: 'tomny-test',
  target: 'tomny',
  app: {
    custom_context: 'Answer briefly',
    context_branches: [],
    rendered_conversation_context: 'Answer briefly',
    saved_memory_context: '## Save\nPINNED-FACT',
    token_estimate: { conversation_context: 4, saved_memory: 5, total: 9 },
    minimum_next_turn_tokens: 9,
  },
  archive: { message_count: 7, token_estimate: 300 },
  inspection: {
    kind: 'native',
    snapshot: {
      model: 'tomny-test',
      system: 'SYSTEM-PROMPT-TEXT',
      messages: [],
      tools: [tool],
      core_context: {
        agent: 'Name: Tomny — AGENT-PROFILE',
        personal: '',
        control_tools: [],
        history: [],
        saved_memory: '## Save\nPINNED-FACT',
      },
      max_tokens: 0,
      thinking: null,
      custom_context: 'Answer briefly',
      context_branches: [],
      active_context_branch_ids: [],
      working_memory: {},
      full_message_count: 7,
      tool_cache: {},
      session_experience: {},
      token_estimate: { system: 5, messages: 0, tools: 10, core: 8, total: 23 },
    },
  },
});

const appOnlySnapshot = (): SessionContextSnapshot => ({
  ...nativeSnapshot(),
  target: 'claude',
  inspection: { kind: 'app-only', disclosure: 'The selected runtime may add private history.' },
});

describe('HubSessionContext (Bộ nhớ phiên)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    context.get.mockResolvedValue({ ok: true, data: nativeSnapshot() });
    context.update.mockResolvedValue({ ok: true, data: nativeSnapshot() });
  });

  it('asks for an agent and never queries Main without a conversation', () => {
    render(<HubSessionContext active />);
    expect(screen.getByText('guid.hubHome.context.selectAgent')).toBeInTheDocument();
    expect(context.get).not.toHaveBeenCalled();
  });

  it('lists every block that is sent with its token estimate and a total', async () => {
    render(<HubSessionContext sessionId='c1' active />);
    const agent = await screen.findByTestId('hub-context-section-agent');

    expect(context.get).toHaveBeenCalledWith({ conversation_id: 'c1' });
    expect(within(agent).getByText('guid.hubHome.context.section.agent')).toBeInTheDocument();
    expect(within(agent).getByText(/\d+ tokens/)).toBeInTheDocument();
    for (const id of ['system', 'agent', 'personal', 'notes', 'custom', 'branches', 'controlTools', 'tools']) {
      expect(screen.getByTestId(`hub-context-section-${id}`)).toBeInTheDocument();
    }
    expect(Number.parseInt(screen.getByTestId('hub-context-total').textContent ?? '0', 10)).toBeGreaterThan(0);
  });

  it('opens a block to read its exact text and closes it again', async () => {
    render(<HubSessionContext sessionId='c1' active />);
    const system = await screen.findByTestId('hub-context-section-system');

    expect(screen.queryByText('SYSTEM-PROMPT-TEXT')).toBeNull();
    fireEvent.click(within(system).getByRole('button'));
    expect(screen.getByText('SYSTEM-PROMPT-TEXT')).toBeInTheDocument();
    fireEvent.click(within(system).getByRole('button'));
    expect(screen.queryByText('SYSTEM-PROMPT-TEXT')).toBeNull();
  });

  it('shows the session notes that are really sent so they can be read', async () => {
    render(<HubSessionContext sessionId='c1' active />);
    const notes = await screen.findByTestId('hub-context-section-notes');
    fireEvent.click(within(notes).getByRole('button'));
    expect(screen.getByText(/PINNED-FACT/)).toBeInTheDocument();
  });

  it('keeps an empty block visible but not expandable', async () => {
    render(<HubSessionContext sessionId='c1' active />);
    const personal = await screen.findByTestId('hub-context-section-personal');
    expect(within(personal).getByRole('button')).toBeDisabled();
    expect(within(personal).getByText('guid.hubHome.context.emptySection')).toBeInTheDocument();
  });

  it('states that message history is archive-only and not sent', async () => {
    render(<HubSessionContext sessionId='c1' active />);
    const history = await screen.findByTestId('hub-context-section-history');
    expect(within(history).getByText('guid.hubHome.context.historyBadge')).toBeInTheDocument();
    expect(within(history).getByText('guid.hubHome.context.historyHint|7|300')).toBeInTheDocument();
  });

  it('shows only app-owned blocks and the runtime disclosure for another agent', async () => {
    context.get.mockResolvedValue({ ok: true, data: appOnlySnapshot() });
    render(<HubSessionContext sessionId='c1' active />);

    expect(await screen.findByText('The selected runtime may add private history.')).toBeInTheDocument();
    expect(screen.getByTestId('hub-context-section-notes')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-context-section-system')).toBeNull();
    expect(screen.queryByTestId('hub-context-section-agent')).toBeNull();
  });

  it('keeps editing the custom context behind an explicit button and saves it', async () => {
    render(<HubSessionContext sessionId='c1' active />);
    await screen.findByTestId('hub-context-section-system');
    expect(screen.queryByText('guid.hubHome.context.save')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /guid.hubHome.context.edit/ }));
    fireEvent.click(screen.getByRole('button', { name: /guid.hubHome.context.save/ }));

    await waitFor(() =>
      expect(context.update).toHaveBeenCalledWith({
        conversation_id: 'c1',
        custom_context: 'Answer briefly',
        context_branches: [],
      })
    );
  });

  it('shows a localized error and no stale blocks when loading fails', async () => {
    context.get.mockResolvedValue({ ok: false, error: 'boom' });
    render(<HubSessionContext sessionId='c1' active />);
    expect(await screen.findByRole('alert')).toHaveTextContent('guid.hubHome.context.errors.load');
    expect(screen.queryByTestId('hub-context-section-system')).toBeNull();
  });
});
