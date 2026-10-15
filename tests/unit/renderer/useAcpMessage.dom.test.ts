/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAcpMessage } from '@/renderer/pages/conversation/platforms/acp/useAcpMessage';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';

const { addOrUpdateMessageMock, responseStreamOnMock, responseStreamHandlerRef, commandUpdatesRef } = vi.hoisted(() => ({
  addOrUpdateMessageMock: vi.fn(),
  responseStreamOnMock: vi.fn(),
    responseStreamHandlerRef: {
    current: undefined as ((message: IResponseMessage) => void) | undefined,
  },
  commandUpdatesRef: {
    current: undefined as ((event: { conversation_id: string; catalog: { status: 'available' | 'unsupported' | 'unavailable'; commands: { name: string; description: string }[] } }) => void) | undefined,
  },
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useAddOrUpdateMessage: () => addOrUpdateMessageMock,
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      responseStream: {
        on: responseStreamOnMock.mockImplementation((handler: (message: IResponseMessage) => void) => {
          responseStreamHandlerRef.current = handler;
          return vi.fn();
        }),
      },
    },
    conversation: {
      warmup: {
        invoke: vi.fn().mockResolvedValue(undefined),
      },
            getSlashCommands: {
        invoke: vi.fn().mockResolvedValue([]),
      },
            getCliCommands: {
        invoke: vi.fn().mockResolvedValue({ status: 'unsupported', commands: [] }),
      },
      cliCommandsUpdated: {
        on: vi.fn((handler) => {
          commandUpdatesRef.current = handler;
          return vi.fn();
        }),
      },
    },
    systemSettings: {
      languageChanged: {
        on: vi.fn(),
      },
      changeLanguage: {
        invoke: vi.fn().mockResolvedValue(undefined),
      },
    },
  },
}));

describe('useAcpMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
        responseStreamHandlerRef.current = undefined;
    commandUpdatesRef.current = undefined;
  });

    it('loads native ACP commands into the chat without relying on the legacy HTTP catalog', async () => {
    const { ipcBridge } = await import('@/common');
    vi.mocked(ipcBridge.conversation.getCliCommands.invoke).mockResolvedValue({
      status: 'available',
      commands: [{ name: 'compact', description: 'Compact provider context' }],
    });
    vi.mocked(getConversationOrNull).mockResolvedValue(null);

    const { result } = renderHook(() => useAcpMessage('conv-1'));

    await waitFor(() => {
      expect(result.current.slashCommands).toEqual([
        {
                              name: 'compact',
          description: 'Compact provider context',
          kind: 'template',
          source: 'acp',
          selectionBehavior: 'insert',
        },
      ]);
    });
    expect(ipcBridge.conversation.getCliCommands.invoke).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
    expect(ipcBridge.conversation.getSlashCommands.invoke).not.toHaveBeenCalled();
  });

      it('applies Main-pushed live command replacements, ignores other chats and clears on empty updates', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    const { result } = renderHook(() => useAcpMessage('conv-1', { skipWarmup: true }));
    act(() => {
      commandUpdatesRef.current?.({ conversation_id: 'elsewhere', catalog: { status: 'available', commands: [{ name: 'foreign', description: '' }] } });
      commandUpdatesRef.current?.({ conversation_id: 'conv-1', catalog: { status: 'available', commands: [{ name: 'review', description: 'Review workspace' }] } });
    });
    expect(result.current.slashCommands.map((item) => item.name)).toEqual(['review']);
    act(() => {
      commandUpdatesRef.current?.({ conversation_id: 'conv-1', catalog: { status: 'available', commands: [] } });
    });
    expect(result.current.slashCommands).toEqual([]);
  });

  it('accepts updated commands pushed by the ACP provider during an active session', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    const { result } = renderHook(() => useAcpMessage('conv-1', { skipWarmup: true }));

    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'available_commands',
        conversation_id: 'conv-1',
        msg_id: 'commands-updated',
        data: {
          commands: [
            { name: 'compact', description: 'Compact the active CLI context' },
            { name: 'project:review', description: 'Review workspace' },
          ],
        },
      });
    });

    expect(result.current.slashCommands.map((item) => item.name)).toEqual(['compact', 'project:review']);
    expect(result.current.slashCommands.every((item) => item.source === 'acp')).toBe(true);
  });

    it('shows Codex skills as provider-owned slash shortcuts instead of ACP TUI commands', async () => {
    const { ipcBridge } = await import('@/common');
    vi.mocked(ipcBridge.conversation.getCliCommands.invoke).mockResolvedValue({
      status: 'available',
      origin: 'codex-app-server',
      commands: [{ name: 'skill:code-review', description: 'Codex skill: Review code' }],
    });
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    const { result } = renderHook(() => useAcpMessage('codex-chat'));
    await waitFor(() => {
      expect(result.current.slashCommands).toEqual([{
        name: 'skill:code-review',
        description: 'Codex skill: Review code',
        source: 'codex',
        kind: 'template',
        selectionBehavior: 'insert',
      }]);
    });
  });

  it('completes hydration when the conversation lookup fails', async () => {
    vi.mocked(getConversationOrNull).mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useAcpMessage('conv-1'));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);
  });

  it('emits a synthetic thinking done update on finish when the stream never sends one', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);

    const now = Date.now();
    renderHook(() => useAcpMessage('conv-1'));

    expect(responseStreamHandlerRef.current).toBeTypeOf('function');

    responseStreamHandlerRef.current?.({
      type: 'request_trace',
      data: {
        timestamp: now - 4200,
        backend: 'claude',
        model_id: 'model-1',
      },
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
    });

    responseStreamHandlerRef.current?.({
      type: 'thinking',
      data: {
        content: 'alpha',
        status: 'thinking',
      },
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
    });

    responseStreamHandlerRef.current?.({
      type: 'finish',
      data: null,
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
    });

    expect(addOrUpdateMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'thinking',
        msg_id: 'msg-1',
        conversation_id: 'conv-1',
        content: expect.objectContaining({
          status: 'done',
          duration: expect.any(Number),
        }),
      })
    );
  });

  it('completes thinking as soon as the first non-thinking message arrives', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);

    renderHook(() => useAcpMessage('conv-1'));

    responseStreamHandlerRef.current?.({
      type: 'thinking',
      data: {
        content: 'alpha',
        status: 'thinking',
      },
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
      created_at: 1_000,
    });

    responseStreamHandlerRef.current?.({
      type: 'text',
      data: 'beta',
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
      created_at: 4_200,
    });

    expect(addOrUpdateMessageMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'thinking',
        msg_id: 'msg-1',
        content: expect.objectContaining({
          status: 'thinking',
        }),
      })
    );
    expect(addOrUpdateMessageMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'thinking',
        msg_id: 'msg-1',
        content: expect.objectContaining({
          status: 'done',
          duration: 3200,
        }),
      })
    );
    expect(addOrUpdateMessageMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: 'text',
        msg_id: 'msg-1',
      })
    );
  });
});
