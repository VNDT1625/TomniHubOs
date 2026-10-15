import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubActivitySnapshot } from '@/common/types/agent/hubActivity';
import { useHubActivity } from '@/renderer/pages/guid/HubHome/useHubActivity';

const channels = vi.hoisted(() => ({
  snapshot: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  stop: vi.fn(),
  respond: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('@/common/types/agent/hubActivity', () => ({
  hubActivityChannels: {
    snapshot: { invoke: channels.snapshot },
    changed: { on: channels.subscribe },
    stop: { invoke: channels.stop },
    respond: { invoke: channels.respond },
    dismiss: { invoke: channels.dismiss },
  },
}));

const snapshot = (id: string): HubActivitySnapshot => ({
  generatedAt: 1,
  items: [
    {
      id,
      sourceId: id,
      kind: 'agent',
      title: id,
      status: 'running',
      startedAt: 1,
      updatedAt: 1,
      steps: [],
      canStop: true,
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  channels.subscribe.mockReturnValue(channels.unsubscribe);
});
afterEach(cleanup);

describe('Home activity subscription', () => {
  it('does not overwrite a live push with the older initial snapshot', async () => {
    let finish!: (value: HubActivitySnapshot) => void;
    channels.snapshot.mockReturnValue(
      new Promise<HubActivitySnapshot>((resolve) => {
        finish = resolve;
      })
    );
    const { result } = renderHook(useHubActivity);
    const receive = channels.subscribe.mock.calls[0][0] as (value: HubActivitySnapshot) => void;
    act(() => receive(snapshot('new')));
    await act(async () => finish(snapshot('old')));
    expect(result.current.items[0].id).toBe('new');
    expect(result.current.ready).toBe(true);
  });

  it('loads the initial snapshot and forwards exact action identifiers', async () => {
    channels.snapshot.mockResolvedValue(snapshot('a'));
    channels.stop.mockResolvedValue(true);
    channels.respond.mockResolvedValue(true);
    channels.dismiss.mockResolvedValue(true);
    const { result, unmount } = renderHook(useHubActivity);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.items[0].id).toBe('a');
    await result.current.stop('a');
    await result.current.respond('a', 'permission', 'cancel');
    await result.current.dismiss('a');
    expect(channels.stop).toHaveBeenCalledWith({ id: 'a' });
    expect(channels.respond).toHaveBeenCalledWith({ id: 'a', prompt_id: 'permission', value: 'cancel' });
    expect(channels.dismiss).toHaveBeenCalledWith({ id: 'a' });
    unmount();
    expect(channels.unsubscribe).toHaveBeenCalledOnce();
  });

  it('feeds a live Home preview from complete activity output and can replay it when opened', async () => {
    channels.snapshot.mockResolvedValue(snapshot('agent:page'));
    const received: Array<{ sourceId: string; blocks: string[]; pending: boolean }> = [];
    const onUpdate = (event: Event) => received.push((event as CustomEvent<(typeof received)[number]>).detail);
    window.addEventListener('preview.source-update', onUpdate);
    const { unmount } = renderHook(useHubActivity);
    try {
      await act(async () => {
        await Promise.resolve();
      });
      const push = channels.subscribe.mock.calls[0][0] as (value: HubActivitySnapshot) => void;
      const html = '<div>' + 'a'.repeat(12000);
      act(() =>
        push({
          ...snapshot('agent:page'),
          items: [{ ...snapshot('agent:page').items[0], preview: '```html\n' + html }],
        })
      );
      expect(received.at(-1)).toEqual({
        sourceId: 'agent:page',
        blocks: [html],
        pending: true,
      });
      act(() =>
        window.dispatchEvent(
          new CustomEvent('preview.open', {
            detail: { metadata: { sourceId: 'agent:page' } },
          })
        )
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(received.at(-1)?.blocks[0]).toBe(html);
      act(() =>
        push({
          ...snapshot('agent:page'),
          items: [{ ...snapshot('agent:page').items[0], status: 'done', preview: '```html\n' + html + '</div>\n```' }],
        })
      );
      expect(received.at(-1)?.pending).toBe(false);
      expect(received.at(-1)?.blocks[0]).toContain('</div>');
    } finally {
      unmount();
      window.removeEventListener('preview.source-update', onUpdate);
    }
  });

  it('ignores a snapshot completing after unmount', async () => {
    let finish!: (value: HubActivitySnapshot) => void;
    channels.snapshot.mockReturnValue(
      new Promise<HubActivitySnapshot>((resolve) => {
        finish = resolve;
      })
    );
    const { result, unmount } = renderHook(useHubActivity);
    unmount();
    await act(async () => finish(snapshot('gone')));
    expect(result.current.items).toEqual([]);
    expect(channels.unsubscribe).toHaveBeenCalledOnce();
  });
});
