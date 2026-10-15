import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IMessageLiveImageOutput } from '@/common/chat/chatLib';
import MessageLiveImageOutput from '@/renderer/pages/conversation/Messages/components/MessageLiveImageOutput';

const readLiveImageOutput = vi.hoisted(() => vi.fn());

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { readLiveImageOutput: { invoke: readLiveImageOutput } },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const createMessage = (
  state: IMessageLiveImageOutput['content']['state'],
  extra: Partial<IMessageLiveImageOutput['content']> = {}
): IMessageLiveImageOutput => ({
  id: 'message-1',
  msg_id: 'message-1',
  type: 'image_output',
  conversation_id: 'conversation-1',
  position: 'left',
  content: {
    schemaVersion: 1,
    outputId: 'output-1',
    revision: state === 'queued' ? 1 : 2,
    conversationId: 'conversation-1',
    runId: 'run-1',
    source: 'browser-screenshot',
    state,
    ...extra,
  },
});

describe('MessageLiveImageOutput', () => {
  it.each([
    ['queued', 'Image queued'],
    ['running', 'Creating image'],
    ['finalizing', 'Verifying image'],
    ['failed', 'Image creation failed'],
    ['cancelled', 'Image creation canceled'],
  ] as const)('renders %s without requesting image bytes', (state, label) => {
    render(<MessageLiveImageOutput message={createMessage(state, state === 'failed' ? { errorCode: 'CAPTURE_FAILED' } : {})} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(readLiveImageOutput).not.toHaveBeenCalled();
  });

  it('reads the image only after Main sends a completed opaque output reference', async () => {
    readLiveImageOutput.mockResolvedValueOnce({
      dataUrl: 'data:image/png;base64,ZmFrZQ==',
      mimeType: 'image/png',
      width: 640,
      height: 480,
    });

    render(
      <MessageLiveImageOutput
        message={
          createMessage('completed', {
            revision: 3,
            image: {
              outputRef: 'outref_abcdEF0123',
              mimeType: 'image/png',
              width: 640,
              height: 480,
            },
            receiptId: 'rcpt_run-1_123',
          })
        }
      />
    );

    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,ZmFrZQ=='));
    expect(readLiveImageOutput).toHaveBeenCalledWith({
      conversation_id: 'conversation-1',
      output_id: 'output-1',
      output_ref: 'outref_abcdEF0123',
    });
  });

  it('shows a safe unavailable state when Main rejects the output', async () => {
    readLiveImageOutput.mockResolvedValueOnce(null);

    render(
      <MessageLiveImageOutput
        message={
          createMessage('completed', {
            revision: 3,
            image: {
              outputRef: 'outref_abcdEF0123',
              mimeType: 'image/png',
              width: 640,
              height: 480,
            },
            receiptId: 'rcpt_run-1_123',
          })
        }
      />
    );

    await waitFor(() => expect(screen.getByText('Image unavailable')).toBeInTheDocument());
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
