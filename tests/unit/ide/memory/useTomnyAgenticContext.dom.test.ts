import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getContext, translate, updateContext } = vi.hoisted(() => ({
  getContext: vi.fn(),
  translate: vi.fn((key: string): string => key),
  updateContext: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      getTomnyAgenticContext: { invoke: getContext },
      updateTomnyAgenticContext: { invoke: updateContext },
    },
  },
}));

import { useTomnyAgenticContext } from '@package-apps/ide/renderer/memory/useTomnyAgenticContext';
import TomnyAgenticContextPanel from '@package-apps/ide/renderer/memory/TomnyAgenticContextPanel';

const snapshot = {
  model: 'test-model',
  system: '',
  messages: [],
  tools: [],
  max_tokens: 4096,
  thinking: null,
  custom_context: '',
  context_branches: [],
  active_context_branch_ids: [],
  working_memory: {},
  full_message_count: 0,
  tool_cache: {},
  session_experience: {},
  core_context: { agent: '', personal: '', control_tools: [], history: [] },
  token_estimate: { system: 0, messages: 0, tools: 0, core: 0, total: 0 },
};

describe('useTomnyAgenticContext', () => {
  beforeEach(() => {
    getContext.mockReset().mockResolvedValue({ ok: true, data: snapshot });
    updateContext.mockReset().mockResolvedValue({ ok: true, data: snapshot });
  });

  it('stops loading when the main process reports a context failure', async () => {
    getContext.mockResolvedValueOnce({ ok: false, error: 'context-unavailable' });

    const { result, unmount } = renderHook(() => useTomnyAgenticContext('conversation-1', true));

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.loading).toBe(false);
    expect(result.current.snapshot).toBeNull();
    unmount();
  });

  it('persists custom context and context branches in one atomic request', async () => {
    const { result, unmount } = renderHook(() => useTomnyAgenticContext('conversation-1', true));
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    const branches = [{ id: 'mcp-web', title: 'MCP web', summary: 'integration', content: 'rules' }];
    await act(async () => {
      await result.current.save('concise', branches);
    });

    expect(updateContext).toHaveBeenCalledWith({
      conversation_id: 'conversation-1',
      custom_context: 'concise',
      context_branches: branches,
    });
    unmount();
  });

  it('renders Core context as explicit agent, personal, control-tool, and history branches', async () => {
    getContext.mockResolvedValueOnce({
      ok: true,
      data: {
        ...snapshot,
        core_context: {
          agent: 'Name: Tomny\nRole: project agent',
          personal: 'Preferred language: Vietnamese',
          control_tools: [
            {
              name: 'StartAction',
              description: 'Start one concrete action.',
              input_schema: { type: 'object', properties: { goal: { type: 'string' } } },
              deferred: false,
            },
          ],
          history: [
            { role: 'user', text: 'Inspect the Core context.', timestamp: 1 },
            { role: 'assistant', text: 'The Core context is separated.', timestamp: 2 },
          ],
        },
      },
    });

    render(createElement(TomnyAgenticContextPanel, { conversationId: 'conversation-1', active: true }));

    fireEvent.click(await screen.findByText('ide.memory.context.coreContext'));
    expect(await screen.findByText('ide.memory.context.coreAgent')).toBeInTheDocument();
    expect(screen.getByText('ide.memory.context.corePersonal')).toBeInTheDocument();
    expect(screen.getByText('ide.memory.context.coreControlTools')).toBeInTheDocument();
    expect(screen.getByText('ide.memory.context.coreHistory')).toBeInTheDocument();
    expect(screen.getByText(/Name: Tomny/)).toBeInTheDocument();
    expect(screen.getByText(/Preferred language: Vietnamese/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('ide.memory.context.coreControlTools'));
    fireEvent.click(await screen.findByText('StartAction'));
    expect(await screen.findByText('Start one concrete action.')).toBeInTheDocument();
    expect(screen.getByText('ide.memory.context.coreToolSchema')).toBeInTheDocument();

    fireEvent.click(screen.getByText('ide.memory.context.coreHistory'));
    expect(await screen.findByText('Inspect the Core context.')).toBeInTheDocument();
    expect(screen.getByText('The Core context is separated.')).toBeInTheDocument();
  });

  it('shows the ToolMap capability summary and loaded schema names explicitly', async () => {
    getContext.mockResolvedValueOnce({
      ok: true,
      data: {
        ...snapshot,
        tool_cache: {
          ide_search: {
            name: 'ide_search',
            description: 'Search repository content.',
            input_schema: { type: 'object', required: ['rootPath', 'query'] },
            deferred: false,
          },
          ide_read_file: {
            name: 'ide_read_file',
            description: 'Read one repository file.',
            input_schema: { type: 'object', required: ['rootPath', 'filePath'] },
            deferred: false,
          },
        },
        session_experience: {
          capability_summary: 'Available surface capabilities: repository search and file reading.',
        },
      },
    });

    render(createElement(TomnyAgenticContextPanel, { conversationId: 'conversation-1', active: true }));

    expect(await screen.findByText('ide.memory.context.toolMapSummary')).toBeInTheDocument();
    expect(screen.getByText(/Available surface capabilities: repository search/)).toBeInTheDocument();
    expect(screen.getByText('ide_search')).toBeInTheDocument();
    expect(screen.getByText('ide_read_file')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ide_search'));
    expect(await screen.findByText(/Search repository content/)).toBeInTheDocument();
    expect(screen.getByText(/rootPath/)).toBeInTheDocument();
  });
});
