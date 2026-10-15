import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SlashCommandItem } from '@/common/chat/slash/types';
import { MAX_VISIBLE_SLASH_COMMANDS, useSlashCommandController } from '@/renderer/hooks/chat/useSlashCommandController';

const commands: SlashCommandItem[] = [
  ...Array.from({ length: 500 }, (_, i) => ({
    name: `plugin-command-${i}`,
    description: 'provider command',
    kind: 'template' as const,
    source: 'acp' as const,
    selectionBehavior: 'insert' as const,
  })),
  {
    name: 'compact',
    description: 'Builtin near the end of the provider list',
    kind: 'template',
    source: 'acp',
    selectionBehavior: 'insert',
  },
];

describe('large native ACP slash catalogs', () => {
  it('only renders a bounded menu for a slash with no search term', () => {
    const { result } = renderHook(() => useSlashCommandController({ input: '/', commands }));
    expect(result.current.filteredCommands).toHaveLength(MAX_VISIBLE_SLASH_COMMANDS);
  });

  it('can still find a command after the first 128 entries by its prefix', () => {
    const { result } = renderHook(() => useSlashCommandController({ input: '/compact', commands }));
    expect(result.current.filteredCommands.map((entry) => entry.name)).toEqual(['compact']);
  });

  it('clamps selection when a live provider update shrinks the catalog', async () => {
    const { result, rerender } = renderHook(
      ({ items }) => useSlashCommandController({ input: '/', commands: items }),
      { initialProps: { items: commands } }
    );
    act(() => result.current.setActiveIndex(65));
    rerender({ items: commands.slice(0, 2) });
    await waitFor(() => expect(result.current.activeIndex).toBe(1));
  });

  it('never renders more than the UI limit for a very broad prefix', () => {
    const { result } = renderHook(() => useSlashCommandController({ input: '/plugin', commands }));
    expect(result.current.filteredCommands).toHaveLength(MAX_VISIBLE_SLASH_COMMANDS);
  });
});
