import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider, Message } from '@arco-design/web-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageOrchestrationProposal } from '@/common/chat/chatLib';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      resolveNativeOrchestrationProposal: { invoke: mocks.resolve },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import MessageOrchestrationProposal from '@/renderer/pages/conversation/Messages/MessageOrchestrationProposal';

const message: IMessageOrchestrationProposal = {
  id: 'message-1',
  msg_id: 'proposal-1',
  type: 'orchestration_proposal',
  position: 'left',
  conversation_id: 'conversation-1',
  created_at: 1,
  status: 'pending',
  content: {
    id: 'proposal-1',
    proposal_id: 'proposal-1',
    proposal: {
      kind: 'team',
      name: 'Delivery Team',
      reason: 'Implementation and verification can run independently.',
      parallelism: 2,
      estimatedTokens: 3000,
      roles: [
        { id: 'build', name: 'Builder', responsibility: 'Implement the change', dependsOn: [] },
        { id: 'verify', name: 'Verifier', responsibility: 'Review the result', dependsOn: ['build'] },
      ],
    },
  },
};

const renderProposal = () =>
  render(
    <ConfigProvider>
      <MessageOrchestrationProposal message={message} />
    </ConfigProvider>
  );

beforeEach(() => {
  mocks.resolve.mockReset();
  mocks.resolve.mockResolvedValue(true);
  vi.spyOn(Message, 'error').mockImplementation(() => undefined as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MessageOrchestrationProposal', () => {
  it('shows the concrete agents before creating the Team and approves through the dedicated channel', async () => {
    renderProposal();

    expect(screen.getByText('Builder')).toBeInTheDocument();
    expect(screen.getByText('Verifier')).toBeInTheDocument();
    fireEvent.click(screen.getByText('messages.confirm'));

    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledWith({ proposal_id: 'proposal-1', approved: true }));
    expect(await screen.findByText('messages.responseSentSuccessfully')).toBeInTheDocument();
  });

  it('keeps the decision controls available when the proposal is already stale', async () => {
    mocks.resolve.mockResolvedValue(false);
    renderProposal();
    fireEvent.click(screen.getByText('messages.confirm'));

    await waitFor(() => expect(mocks.resolve).toHaveBeenCalled());
    expect(screen.getByText('messages.confirm')).toBeInTheDocument();
  });
});
