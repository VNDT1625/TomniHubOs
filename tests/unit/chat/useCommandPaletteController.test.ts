/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCommandPaletteController } from '../../../packages/desktop/src/renderer/hooks/chat/useCommandPaletteController';

describe('useCommandPaletteController', () => {
  it('is closed when input has no trigger', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useCommandPaletteController({
        input: 'Hello world',
        caretPosition: 5,
        onSelect,
      })
    );

    expect(result.current.isOpen).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it('opens and lists slash commands when typing /', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useCommandPaletteController({
        input: '/go',
        caretPosition: 3,
        onSelect,
      })
    );

    expect(result.current.isOpen).toBe(true);
    expect(result.current.menuTitle).toBe('Slash Commands & Modes');
    expect(result.current.items.some((i) => i.key === 'goal')).toBe(true);
  });

  it('opens and lists pipeline packages when typing *', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useCommandPaletteController({
        input: 'Hãy dùng *vis',
        caretPosition: 13,
        onSelect,
      })
    );

    expect(result.current.isOpen).toBe(true);
    expect(result.current.menuTitle).toBe('Chat Pipeline Packages');
    expect(result.current.items.some((i) => i.key === 'visual-learning')).toBe(true);
  });

  it('replaces token and calls onSelect when selecting an item', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useCommandPaletteController({
        input: 'Hãy dùng *vis để học',
        caretPosition: 13,
        onSelect,
      })
    );

    const item = result.current.items.find((i) => i.key === 'visual-learning')!;
    act(() => {
      result.current.selectItem(item);
    });

    expect(onSelect).toHaveBeenCalledWith('Hãy dùng *visual-learning  để học', 'Hãy dùng *visual-learning '.length);
  });

  it('navigates with ArrowDown and ArrowUp', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useCommandPaletteController({
        input: '#',
        caretPosition: 1,
        onSelect,
      })
    );

    expect(result.current.activeIndex).toBe(0);

    act(() => {
      result.current.onKeyDown({
        key: 'ArrowDown',
        preventDefault: vi.fn(),
      } as any);
    });

    expect(result.current.activeIndex).toBe(1);

    act(() => {
      result.current.onKeyDown({
        key: 'ArrowUp',
        preventDefault: vi.fn(),
      } as any);
    });

    expect(result.current.activeIndex).toBe(0);
  });
});
