import { HubSessionMemory } from '@/renderer/pages/guid/HubHome/memory/HubSessionMemory';
import { useHomeMemory } from '@/renderer/pages/guid/HubHome/memory/useHomeMemory';
import { sessionMemoryClient, type IdeMemoryResult } from '@/renderer/services/sessionMemoryClient';
import type { SuperMemorySnapshot } from '@process/userUnderstanding/sessionMemoryStore';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/services/sessionMemoryClient', () => ({
  sessionMemoryClient: {
    memorySnapshot: vi.fn(),
    memoryClear: vi.fn(),
    memoryRemember: vi.fn(),
    memoryForget: vi.fn(),
  },
}));
const fixture = (sessionId = 'conversation-a'): SuperMemorySnapshot => ({
  sessionId,
  items: [
    {
      id: 'm1',
      text: 'Use strict TypeScript',
      kind: 'decision',
      pinned: true,
      createdAt: 1,
      tokens: 4,
      accessCount: 0,
      lastAccessedAt: 1,
    },
    {
      id: 'm2',
      text: 'Review the renderer',
      kind: 'todo',
      pinned: false,
      createdAt: 2,
      tokens: 4,
      accessCount: 0,
      lastAccessedAt: 2,
    },
    {
      id: 's1',
      text: 'Summary of earlier tasks',
      kind: 'summary',
      pinned: false,
      createdAt: 3,
      tokens: 5,
      accessCount: 0,
      lastAccessedAt: 3,
    },
  ],
  secretKeys: ['PRIVATE_KEY_NEVER_DISPLAY'],
  tokensUsed: 13,
  tokenBudget: 100,
  compactions: 1,
  deduped: 0,
  recalls: 0,
  lastCompactedAt: 3,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionMemoryClient.memorySnapshot).mockImplementation(async (id) => ({ ok: true, data: fixture(id) }));
  vi.mocked(sessionMemoryClient.memoryClear).mockResolvedValue({ ok: true, data: true });
  vi.mocked(sessionMemoryClient.memoryForget).mockResolvedValue({ ok: true, data: true });
  vi.mocked(sessionMemoryClient.memoryRemember).mockResolvedValue({
    ok: true,
    data: {
      item: fixture().items[0],
      deduped: false,
      truncated: false,
      compacted: false,
      tokensUsed: 13,
      tokenBudget: 100,
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Home Session Memory', () => {
  it('does not create pre-session notes or request memory without an actual conversation', () => {
    render(<HubSessionMemory active />);
    expect(screen.getByText('guid.hubHome.memory.selectAgent')).toBeTruthy();
    expect(sessionMemoryClient.memorySnapshot).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('lists and searches notes, includes summaries, and never renders secret key names', async () => {
    render(<HubSessionMemory sessionId='conversation-a' sessionName='Agent A' active />);
    await screen.findByText('Use strict TypeScript');
    expect(screen.getByText('Summary of earlier tasks')).toBeTruthy();
    expect(screen.queryByText('PRIVATE_KEY_NEVER_DISPLAY')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'guid.hubHome.memory.search' }), {
      target: { value: 'typescript' },
    });
    expect(screen.queryByText('Review the renderer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /guid.hubHome.memory.kind.decision/ }));
    expect(screen.getByText('guid.hubHome.memory.itemTokens')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'guid.hubHome.memory.filter' }), {
      target: { value: 'todo' },
    });
    expect(screen.getByText('guid.hubHome.memory.noMatches')).toBeTruthy();
  });

  it('records a categorized pinned note only after an explicit submit', async () => {
    render(<HubSessionMemory sessionId='conversation-a' active />);
    await screen.findByText('Use strict TypeScript');
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.memory.add' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'guid.hubHome.memory.note' }), {
      target: { value: ' A user note ' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'guid.hubHome.memory.category' }), {
      target: { value: 'fact' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'guid.hubHome.memory.pin' }));
    expect(sessionMemoryClient.memoryRemember).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.memory.remember' }));
    await waitFor(() =>
      expect(sessionMemoryClient.memoryRemember).toHaveBeenCalledWith('conversation-a', 'A user note', {
        kind: 'fact',
        pinned: true,
      })
    );
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'guid.hubHome.memory.note' })).toBeNull());
  });

  it('clears drafts, query and expanded selection when changing agents', async () => {
    const { rerender } = render(<HubSessionMemory sessionId='conversation-a' active />);
    await screen.findByText('Use strict TypeScript');
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.memory.add' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'guid.hubHome.memory.note' }), {
      target: { value: 'Private draft A' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'guid.hubHome.memory.search' }), {
      target: { value: 'typescript' },
    });
    rerender(<HubSessionMemory sessionId='conversation-b' active />);
    await waitFor(() => expect(sessionMemoryClient.memorySnapshot).toHaveBeenCalledWith('conversation-b'));
    expect(screen.queryByDisplayValue('Private draft A')).toBeNull();
    expect((screen.getByRole('textbox', { name: 'guid.hubHome.memory.search' }) as HTMLInputElement).value).toBe('');
  });

  it('discards a late snapshot from the previously selected agent', async () => {
    const old = deferred<IdeMemoryResult<SuperMemorySnapshot>>();
    vi.mocked(sessionMemoryClient.memorySnapshot).mockImplementation((id) =>
      id === 'conversation-a' ? old.promise : Promise.resolve({ ok: true, data: fixture(id) })
    );
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useHomeMemory(id, true), {
      initialProps: { id: 'conversation-a' as string | null },
    });
    rerender({ id: 'conversation-b' });
    await waitFor(() => expect(result.current.snapshot?.sessionId).toBe('conversation-b'));
    await act(async () => {
      old.resolve({ ok: true, data: fixture('conversation-a') });
    });
    expect(result.current.snapshot?.sessionId).toBe('conversation-b');
    rerender({ id: null });
    expect(result.current.snapshot).toBeNull();
  });

  it('rejects a snapshot whose identity does not match and hides backend error payloads', async () => {
    vi.mocked(sessionMemoryClient.memorySnapshot).mockResolvedValue({ ok: true, data: fixture('wrong-agent') });
    const { result } = renderHook(() => useHomeMemory('conversation-a', true));
    await waitFor(() => expect(result.current.error).toBe('load'));
    expect(result.current.snapshot).toBeNull();
    vi.mocked(sessionMemoryClient.memorySnapshot).mockResolvedValue({ ok: false, error: 'private server diagnostics' });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBe('load');
  });

  it('polls only while the tab is active and never overlaps snapshot requests', async () => {
    vi.useFakeTimers();
    const delayed = deferred<IdeMemoryResult<SuperMemorySnapshot>>();
    vi.mocked(sessionMemoryClient.memorySnapshot).mockReturnValue(delayed.promise);
    const { rerender } = renderHook(({ active }) => useHomeMemory('conversation-a', active), {
      initialProps: { active: true },
    });
    await act(async () => {
      vi.advanceTimersByTime(9000);
    });
    expect(sessionMemoryClient.memorySnapshot).toHaveBeenCalledTimes(1);
    rerender({ active: false });
    await act(async () => {
      delayed.resolve({ ok: true, data: fixture() });
      vi.advanceTimersByTime(9000);
    });
    expect(sessionMemoryClient.memorySnapshot).toHaveBeenCalledTimes(1);
    rerender({ active: true });
    expect(sessionMemoryClient.memorySnapshot).toHaveBeenCalledTimes(2);
  });

  it('does not migrate a late mutation result or its draft into another session', async () => {
    const pending = deferred<Awaited<ReturnType<typeof sessionMemoryClient.memoryRemember>>>();
    vi.mocked(sessionMemoryClient.memoryRemember).mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(({ id }) => useHomeMemory(id, true), {
      initialProps: { id: 'conversation-a' },
    });
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    let saving!: Promise<boolean>;
    act(() => {
      saving = result.current.remember('Note A', 'note', true);
    });
    rerender({ id: 'conversation-b' });
    await waitFor(() => expect(result.current.snapshot?.sessionId).toBe('conversation-b'));
    await act(async () => {
      pending.resolve({ ok: false, error: 'private server error' });
      expect(await saving).toBe(false);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it('makes clear user-triggered, reports failure and does not erase cached notes on cancellation', async () => {
    render(<HubSessionMemory sessionId='conversation-a' active />);
    await screen.findByText('Use strict TypeScript');
    expect(sessionMemoryClient.memoryClear).not.toHaveBeenCalled();
    vi.mocked(sessionMemoryClient.memoryClear).mockResolvedValue({ ok: false, error: 'CANCELLED' });
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.memory.clear' }));
    await waitFor(() => expect(sessionMemoryClient.memoryClear).toHaveBeenCalledWith('conversation-a'));
    expect(screen.getByText('Use strict TypeScript')).toBeTruthy();
    vi.mocked(sessionMemoryClient.memoryClear).mockResolvedValue({ ok: false, error: 'raw native private error' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'guid.hubHome.memory.clear' }).hasAttribute('disabled')).toBe(false)
    );
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.memory.clear' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'guid.hubHome.memory.errors.clear');
  });

  it('keeps a draft and shows no error when the native save confirmation is cancelled', async () => {
    vi.mocked(sessionMemoryClient.memoryRemember).mockResolvedValue({ ok: false, error: 'CANCELLED' });
    render(<HubSessionMemory sessionId='conversation-a' active />);
    await screen.findByText('Use strict TypeScript');
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.memory.add' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'guid.hubHome.memory.note' }), {
      target: { value: 'Keep this draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.memory.remember' }));
    await waitFor(() => expect(sessionMemoryClient.memoryRemember).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'guid.hubHome.memory.remember' }).hasAttribute('disabled')).toBe(false)
    );
    expect(screen.getByDisplayValue('Keep this draft')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('invalidates a stale in-flight poll before a successful note write', async () => {
    const old = deferred<IdeMemoryResult<SuperMemorySnapshot>>();
    const updated = fixture();
    updated.items = [{ ...updated.items[0], text: 'Updated after save' }];
    vi.mocked(sessionMemoryClient.memorySnapshot)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue({ ok: true, data: updated });
    const { result } = renderHook(() => useHomeMemory('conversation-a', true));
    await act(async () => {
      expect(await result.current.remember('Updated after save', 'note', false)).toBe(true);
    });
    expect(result.current.snapshot?.items[0].text).toBe('Updated after save');
    await act(async () => {
      old.resolve({ ok: true, data: fixture() });
    });
    expect(result.current.snapshot?.items[0].text).toBe('Updated after save');
  });

  it('does not overlap user mutations while native confirmation is pending', async () => {
    const pending = deferred<Awaited<ReturnType<typeof sessionMemoryClient.memoryRemember>>>();
    vi.mocked(sessionMemoryClient.memoryRemember).mockReturnValue(pending.promise);
    const { result } = renderHook(() => useHomeMemory('conversation-a', true));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    let first!: Promise<boolean>;
    act(() => {
      first = result.current.remember('Note one', 'note', false);
    });
    await act(async () => {
      expect(await result.current.clear()).toBe(false);
    });
    expect(sessionMemoryClient.memoryClear).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve({ ok: false, error: 'CANCELLED' });
      await first;
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('prevents empty, oversized and inactive note writes', async () => {
    const { result, rerender } = renderHook(({ active }) => useHomeMemory('conversation-a', active), {
      initialProps: { active: true },
    });
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    await act(async () => {
      expect(await result.current.remember(' ', 'note', false)).toBe(false);
      expect(await result.current.remember('x'.repeat(12001), 'note', false)).toBe(false);
    });
    rerender({ active: false });
    await act(async () => {
      expect(await result.current.remember('valid', 'note', false)).toBe(false);
    });
    expect(sessionMemoryClient.memoryRemember).not.toHaveBeenCalled();
  });
});

describe('Home Session Memory forget', () => {
  it('forgets only the opened item through the Core channel and refreshes the list', async () => {
    render(<HubSessionMemory sessionId='conversation-a' active />);
    fireEvent.click(await screen.findByText('Review the renderer'));
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.memory.forget' }));

    await waitFor(() => expect(sessionMemoryClient.memoryForget).toHaveBeenCalledWith('conversation-a', 'm2'));
    await waitFor(() => expect(vi.mocked(sessionMemoryClient.memorySnapshot).mock.calls.length).toBeGreaterThan(1));
  });

  it('shows the forget error and keeps the list when Main refuses', async () => {
    vi.mocked(sessionMemoryClient.memoryForget).mockResolvedValue({ ok: false, error: 'IO_ERROR' });
    render(<HubSessionMemory sessionId='conversation-a' active />);
    fireEvent.click(await screen.findByText('Review the renderer'));
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.memory.forget' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('guid.hubHome.memory.errors.forget');
    expect(screen.getByText('Use strict TypeScript')).toBeInTheDocument();
  });

  it('stays quiet when the native approval is cancelled', async () => {
    vi.mocked(sessionMemoryClient.memoryForget).mockResolvedValue({ ok: false, error: 'CANCELLED' });
    render(<HubSessionMemory sessionId='conversation-a' active />);
    fireEvent.click(await screen.findByText('Review the renderer'));
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.memory.forget' }));

    await waitFor(() => expect(sessionMemoryClient.memoryForget).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
