import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SPOTLIGHT_TARGETS,
  getSpotlightTarget,
  normalizeSpotlightQuery,
  resolveSpotlightTarget,
} from '@/common/ui/spotlightTargets';
import SpotlightOverlay, { placeBubble } from '@/renderer/components/Spotlight/SpotlightOverlay';
import { showSpotlight } from '@/renderer/components/Spotlight/spotlightBus';

describe('finding the control a request is about', () => {
  it.each([
    ['Bật chế độ Super ở đâu?', 'super'],
    ['cho tôi xem cài đặt model provider', 'settings'],
    ['Thông báo nằm đâu', 'notifications'],
    ['where is the chat pipeline', 'pipeline'],
    ['mở cửa hàng gói', 'nav-store'],
    ['đính kèm tệp', 'attach-file'],
    ['ô nhập tin nhắn', 'chat-input'],
    ['nav-home', 'nav-home'],
  ])('maps %j to %s', (request, id) => {
    expect(resolveSpotlightTarget(request)?.id).toBe(id);
  });

  it('prefers the longer, more specific alias and ignores requests it does not know', () => {
    expect(resolveSpotlightTarget('chat input')?.id).toBe('chat-input');
    expect(resolveSpotlightTarget('xyz abc')).toBeUndefined();
    expect(resolveSpotlightTarget('   ')).toBeUndefined();
  });

  it('removes accents and case so Vietnamese typing variants match', () => {
    expect(normalizeSpotlightQuery('  Đặt  Lịch!! ')).toBe('dat lich');
  });

  it('only exposes selectors written in the catalog, and every id is unique', () => {
    const ids = SPOTLIGHT_TARGETS.map((target) => target.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getSpotlightTarget('settings')?.selector).toContain('aria-label');
    expect(getSpotlightTarget('<script>')).toBeUndefined();
    // Hostile text can at most pick a catalogued entry; it never becomes a selector of its own.
    const hostile = resolveSpotlightTarget('<img src=x onerror=alert(1)>');
    expect(hostile === undefined || SPOTLIGHT_TARGETS.includes(hostile)).toBe(true);
  });
});

describe('where the coach mark sits', () => {
  const viewport = { width: 1000, height: 700 };
  it('goes under the control when there is room, and above it near the bottom edge', () => {
    const below = placeBubble({ left: 100, top: 50, width: 80, height: 30 }, viewport);
    expect(below.above).toBe(false);
    expect(below.top).toBeGreaterThan(80);
    const above = placeBubble({ left: 100, top: 640, width: 80, height: 30 }, viewport);
    expect(above.above).toBe(true);
    expect(above.top).toBeLessThan(640);
  });

  it('stays inside the window at the left and right edges', () => {
    expect(placeBubble({ left: 0, top: 10, width: 20, height: 20 }, viewport).left).toBe(8);
    expect(placeBubble({ left: 990, top: 10, width: 20, height: 20 }, viewport).left).toBe(1000 - 300 - 8);
  });
});

describe('the spotlight overlay', () => {
  let button: HTMLButtonElement;

  beforeEach(() => {
    button = document.createElement('button');
    button.setAttribute('aria-label', 'Cài đặt hệ thống');
    button.textContent = 'gear';
    document.body.append(button);
    button.getBoundingClientRect = () =>
      ({
        left: 400,
        top: 20,
        width: 36,
        height: 36,
        right: 436,
        bottom: 56,
        x: 400,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect;
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    button.remove();
  });

  const mount = () =>
    render(
      <MemoryRouter>
        <SpotlightOverlay />
      </MemoryRouter>
    );

  it('shows nothing until it is asked to point at something', () => {
    mount();
    expect(screen.queryByTestId('spotlight-overlay')).toBeNull();
  });

  it('highlights the control and explains it, without clicking anything by itself', async () => {
    const clicked = vi.fn();
    button.addEventListener('click', clicked);
    mount();
    act(() => {
      expect(showSpotlight('mở cài đặt')).toBe('settings');
    });
    expect(await screen.findByTestId('spotlight-bubble')).toBeTruthy();
    expect(screen.getByText('Cài đặt')).toBeTruthy();
    expect(screen.getByText(/Mở cài đặt hệ thống/u)).toBeTruthy();
    expect(clicked).not.toHaveBeenCalled();
  });

  it('presses the control only when the user asks it to', async () => {
    const clicked = vi.fn();
    button.addEventListener('click', clicked);
    mount();
    act(() => {
      showSpotlight('cài đặt');
    });
    fireEvent.click(await screen.findByTestId('spotlight-activate'));
    await vi.waitFor(() => expect(clicked).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('spotlight-overlay')).toBeNull();
  });

  it('closes when the user presses the control themselves, on Escape, or on the dismiss button', async () => {
    mount();
    act(() => {
      showSpotlight('cài đặt');
    });
    await screen.findByTestId('spotlight-bubble');
    fireEvent.click(button);
    await vi.waitFor(() => expect(screen.queryByTestId('spotlight-overlay')).toBeNull());

    act(() => {
      showSpotlight('cài đặt');
    });
    await screen.findByTestId('spotlight-bubble');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('spotlight-overlay')).toBeNull();

    act(() => {
      showSpotlight('cài đặt');
    });
    fireEvent.click(await screen.findByTestId('spotlight-dismiss'));
    expect(screen.queryByTestId('spotlight-overlay')).toBeNull();
  });

  it('says so when the control is not on this screen, and offers no activation', async () => {
    vi.useFakeTimers();
    try {
      mount();
      act(() => {
        showSpotlight('thông báo');
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(screen.getByText(/Chưa thấy/u)).toBeTruthy();
      expect(screen.queryByTestId('spotlight-activate')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores an id that is not in the catalog', () => {
    mount();
    act(() => {
      expect(showSpotlight('hoàn toàn không có thứ này')).toBeUndefined();
    });
    expect(screen.queryByTestId('spotlight-overlay')).toBeNull();
  });
});
