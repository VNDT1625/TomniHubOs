import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigProvider } from '@arco-design/web-react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mocks = vi.hoisted(() => ({
  sessions: vi.fn(),
  overview: vi.fn(),
  snapshot: vi.fn(),
  inspect: vi.fn(),
  worklog: vi.fn(),
  stop: vi.fn(),
  send: vi.fn(),
  updateQueue: vi.fn(),
  removeQueue: vi.fn(),
  reorderQueue: vi.fn(),
  setConcurrencyPolicy: vi.fn(),
}));

vi.mock('@/renderer/services/agentMeshClient', () => ({
  agentMeshClient: mocks,
}));

import { ChatDockHost } from '@/renderer/pages/conversation/components/ChatDock';
import AgentMeshInlineCard from '@/renderer/pages/conversation/components/superWatch/AgentMeshInlineCard';

const overview = {
  sessionId: 'core-session:team:conversation-1:run-1',
  agents: [
    { agentId: 'leader', status: 'idle', stuck: false, queuedMessages: 0 },
    {
      agentId: 'worker',
      parentAgentId: 'leader',
      status: 'working',
      stuck: false,
      objective: 'Review the patch',
      currentAction: { name: 'Reading tests', detail: 'Inspecting the edge cases.' },
      queuedMessages: 0,
    },
  ],
  tokenUsage: { spentTokens: 10, reservedTokens: 5 },
};

const snapshot = {
  sessionId: overview.sessionId,
  agents: [{ agentId: 'leader' }, { agentId: 'worker', parentAgentId: 'leader' }],
  inspections: [
    { agent: { agentId: 'leader' }, status: 'idle', actionHistory: [], queue: [], stuck: false },
    {
      agent: { agentId: 'worker', parentAgentId: 'leader' },
      task: { taskId: 'task-1', agentId: 'worker', objective: 'Review the patch' },
      status: 'working',
      actionHistory: [],
      queue: [],
      stuck: false,
    },
  ],
  tasks: [],
  messages: [],
  tokenUsage: { spentTokens: 10, reservedTokens: 5 },
};

const renderCard = () =>
  render(
    <ConfigProvider>
      <ChatDockHost>
        <AgentMeshInlineCard conversationId='conversation-1' />
      </ChatDockHost>
    </ConfigProvider>
  );

beforeEach(() => {
  localStorage.clear();
  mocks.sessions.mockResolvedValue([overview.sessionId]);
  mocks.overview.mockResolvedValue({ ok: true, data: overview });
  mocks.snapshot.mockResolvedValue({ ok: true, data: snapshot });
  mocks.inspect.mockResolvedValue({ ok: true, data: snapshot.inspections[1] });
  mocks.worklog.mockResolvedValue({ ok: true, data: [] });
  mocks.stop.mockResolvedValue({ ok: true, data: undefined });
  mocks.send.mockResolvedValue({ ok: true, data: undefined });
  mocks.updateQueue.mockResolvedValue({ ok: true, data: undefined });
  mocks.removeQueue.mockResolvedValue({ ok: true, data: undefined });
  mocks.reorderQueue.mockResolvedValue({ ok: true, data: [] });
  mocks.setConcurrencyPolicy.mockResolvedValue({
    ok: true,
    data: { configuredMaxConcurrent: 4, minimum: 1, maximum: 8 },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AgentMeshInlineCard', () => {
  it('stays invisible when the conversation has no mesh session', async () => {
    mocks.sessions.mockResolvedValue([]);
    renderCard();

    await waitFor(() => expect(mocks.sessions).toHaveBeenCalled());
    expect(screen.queryByTestId('agent-mesh-clip')).not.toBeInTheDocument();
  });

  it('selects only the newest Team session that belongs to this conversation', async () => {
    mocks.sessions.mockResolvedValue([
      'core:team:other-conversation:run-1',
      'core:team:conversation-1:run-old',
      'core:team:conversation-1:run-new',
    ]);
    renderCard();

    expect(await screen.findByTestId('agent-mesh-clip')).toBeInTheDocument();
    expect(mocks.overview).toHaveBeenCalledWith('core:team:conversation-1:run-new');
    expect(mocks.overview).not.toHaveBeenCalledWith('core:team:other-conversation:run-1');
  });

  it('opens a lightweight overview and only loads heavy detail after Control', async () => {
    renderCard();

    fireEvent.click(await screen.findByTestId('agent-mesh-clip'));
    expect(await screen.findByText('Review the patch')).toBeInTheDocument();
    expect(screen.getByText('Reading tests')).toBeInTheDocument();
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.worklog).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('agent-mesh-control-button'));
    await waitFor(() =>
      expect(mocks.inspect).toHaveBeenCalledWith({
        sessionId: overview.sessionId,
        agentId: 'worker',
      })
    );
    expect(await screen.findByTestId('agent-mesh-control-panel')).toBeInTheDocument();
  });

  it('identifies the owning agent on every worklog step', async () => {
    mocks.worklog.mockResolvedValue({
      ok: true,
      data: [
        {
          sequence: 1,
          timestamp: Date.now(),
          agentId: 'worker',
          taskId: 'task-1',
          kind: 'action',
          summary: 'Reading repository files',
        },
      ],
    });
    renderCard();

    fireEvent.click(await screen.findByTestId('agent-mesh-clip'));
    fireEvent.click(screen.getByTestId('agent-mesh-control-button'));

    expect(await screen.findByText('worker · action')).toBeInTheDocument();
    expect(screen.getByText('Reading repository files')).toBeInTheDocument();
  });

  it('lets the leader interrupt the active worker task from Control mode', async () => {
    renderCard();
    fireEvent.click(await screen.findByTestId('agent-mesh-clip'));
    fireEvent.click(screen.getByTestId('agent-mesh-control-button'));
    fireEvent.click(await screen.findByText('ide.agentMesh.stopNow'));

    await waitFor(() =>
      expect(mocks.stop).toHaveBeenCalledWith({
        sessionId: overview.sessionId,
        actorId: 'leader',
        taskId: 'task-1',
        mode: 'interrupt',
      })
    );
  });

  it('queues a direct user message only after Control mode is opened', async () => {
    renderCard();
    fireEvent.click(await screen.findByTestId('agent-mesh-clip'));
    fireEvent.click(screen.getByTestId('agent-mesh-control-button'));
    const composer = await screen.findByRole('textbox');
    fireEvent.change(composer, { target: { value: 'Please verify the edge case.' } });
    fireEvent.click(screen.getByText('common.send'));

    await waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith({
        sessionId: overview.sessionId,
        fromAgentId: 'user',
        toAgentId: 'worker',
        kind: 'question',
        content: 'Please verify the edge case.',
        delivery: 'enqueue-after-task',
      })
    );
  });

  it('uses four by default and lets Control persist a different concurrency cap', async () => {
    renderCard();
    await waitFor(() => expect(mocks.setConcurrencyPolicy).toHaveBeenCalledWith(4));

    fireEvent.click(await screen.findByTestId('agent-mesh-clip'));
    fireEvent.click(screen.getByTestId('agent-mesh-control-button'));
    const input = await screen.findByRole('spinbutton');
    fireEvent.change(input, { target: { value: '6' } });

    await waitFor(() => expect(mocks.setConcurrencyPolicy).toHaveBeenCalledWith(6));
    expect(localStorage.getItem('tomny.chat.team.maxConcurrent')).toBe('6');
  });
});
