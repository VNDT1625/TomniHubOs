import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  remove: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('@arco-design/web-react', () => ({
  Modal: { confirm: mocks.confirm },
  Message: { success: mocks.success, error: mocks.error },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`),
  }),
}));
vi.mock('@/common', () => ({ ipcBridge: { conversation: { remove: { invoke: mocks.remove } } } }));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: mocks.emit } }));

import { useDeleteChat, useDeleteChats } from '@/renderer/pages/guid/HubHome/useDeleteChat';

const setup = (path = '/guid') => {
  const goHome = vi.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  );
  const { result } = renderHook(() => useDeleteChat(goHome), { wrapper });
  return { goHome, request: result.current };
};

const confirmOk = async (): Promise<void> => {
  const config = mocks.confirm.mock.calls.at(-1)?.[0] as { onOk: () => Promise<void> };
  await act(async () => {
    await config.onOk();
  });
};

describe('useDeleteChat', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.remove.mockResolvedValue(true);
  });

  it('asks for confirmation with the existing history texts and deletes nothing yet', () => {
    const { request } = setup();
    request('c1');
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.confirm.mock.calls[0][0]).toMatchObject({
      title: 'conversation.history.deleteTitle',
      content: 'conversation.history.deleteConfirm',
      okText: 'conversation.history.confirmDelete',
      cancelText: 'conversation.history.cancelDelete',
    });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('removes the chat and tells the rest of the app once confirmed', async () => {
    const { request, goHome } = setup('/guid');
    request('c1');
    await confirmOk();
    expect(mocks.remove).toHaveBeenCalledWith({ id: 'c1' });
    expect(mocks.emit).toHaveBeenCalledWith('conversation.deleted', 'c1');
    expect(mocks.emit).toHaveBeenCalledWith('chat.history.refresh');
    expect(mocks.success).toHaveBeenCalledWith('conversation.history.deleteSuccess');
    expect(goHome).not.toHaveBeenCalled();
  });

  it('goes home when the deleted chat is the one on screen', async () => {
    const { request, goHome } = setup('/conversation/c1');
    request('c1');
    await confirmOk();
    expect(goHome).toHaveBeenCalledTimes(1);
  });

  it('stays put when another chat is on screen', async () => {
    const { request, goHome } = setup('/conversation/other');
    request('c1');
    await confirmOk();
    expect(goHome).not.toHaveBeenCalled();
  });

  it('reports a failed delete and announces nothing', async () => {
    mocks.remove.mockResolvedValue(false);
    const { request } = setup();
    request('c1');
    await confirmOk();
    expect(mocks.error).toHaveBeenCalledWith('conversation.history.deleteFailed');
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('reports an error instead of throwing when the delete call rejects', async () => {
    mocks.remove.mockRejectedValue(new Error('db locked'));
    const { request } = setup();
    request('c1');
    await expect(confirmOk()).resolves.toBeUndefined();
    expect(mocks.error).toHaveBeenCalledWith('conversation.history.deleteFailed');
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

describe('useDeleteChats', () => {
  const setupMany = (path = '/guid') => {
    const goHome = vi.fn();
    const done = vi.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    );
    const { result } = renderHook(() => useDeleteChats(goHome), { wrapper });
    return { goHome, done, request: result.current };
  };

  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.remove.mockResolvedValue(true);
  });

  it('confirms with the batch texts and the number of chats, and deletes nothing yet', () => {
    const { request, done } = setupMany();
    request(['a', 'b', 'c'], done);
    expect(mocks.confirm.mock.calls[0][0]).toMatchObject({
      title: 'conversation.history.batchDelete',
      content: 'conversation.history.batchDeleteConfirm:3',
      okText: 'conversation.history.confirmDelete',
      cancelText: 'conversation.history.cancelDelete',
    });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });

  it('does nothing for an empty selection', () => {
    const { request, done } = setupMany();
    request([], done);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('removes every chat, announces each, reports the count and finishes', async () => {
    const { request, done } = setupMany();
    request(['a', 'b'], done);
    await confirmOk();
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(mocks.emit).toHaveBeenCalledWith('conversation.deleted', 'a');
    expect(mocks.emit).toHaveBeenCalledWith('conversation.deleted', 'b');
    expect(mocks.emit).toHaveBeenCalledWith('chat.history.refresh');
    expect(mocks.success).toHaveBeenCalledWith('conversation.history.batchDeleteSuccess:2');
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('reports only the chats that were really removed when some fail', async () => {
    mocks.remove.mockImplementation(async ({ id }: { id: string }) => id !== 'b');
    const { request, done } = setupMany();
    request(['a', 'b', 'c'], done);
    await confirmOk();
    expect(mocks.emit).not.toHaveBeenCalledWith('conversation.deleted', 'b');
    expect(mocks.success).toHaveBeenCalledWith('conversation.history.batchDeleteSuccess:2');
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('reports an error when nothing could be removed', async () => {
    mocks.remove.mockResolvedValue(false);
    const { request, done } = setupMany();
    request(['a', 'b'], done);
    await confirmOk();
    expect(mocks.error).toHaveBeenCalledWith('conversation.history.deleteFailed');
    expect(mocks.success).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the delete call rejects, and still finishes', async () => {
    mocks.remove.mockRejectedValue(new Error('db locked'));
    const { request, done } = setupMany();
    request(['a'], done);
    await expect(confirmOk()).resolves.toBeUndefined();
    expect(mocks.error).toHaveBeenCalledWith('conversation.history.deleteFailed');
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('goes home when the chat on screen is among the deleted ones', async () => {
    const { request, goHome, done } = setupMany('/conversation/b');
    request(['a', 'b'], done);
    await confirmOk();
    expect(goHome).toHaveBeenCalledTimes(1);
  });

  it('stays put when the chat on screen is not deleted', async () => {
    const { request, goHome, done } = setupMany('/conversation/zzz');
    request(['a', 'b'], done);
    await confirmOk();
    expect(goHome).not.toHaveBeenCalled();
  });
});
