import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReelsPlayerView } from '@/renderer/pages/social/reels/ReelsPlayerView';
import type { UnifiedReel } from '@/common/types/social';

const state = vi.hoisted(() => ({
  activeIndex: 0,
  setActiveIndex: vi.fn(),
  next: vi.fn(),
  prev: vi.fn(),
  togglePlay: vi.fn(),
  toggleMute: vi.fn(),
}));
const reels: UnifiedReel[] = Array.from({ length: 100 }, (_, index) => ({
  id: `reel-${index}`,
  platform: 'youtube' as const,
  accountId: 'account',
  originVideoId: String(index),
  author: { name: 'Creator', handle: 'creator', avatarUrl: '' },
  caption: `Reel ${index}`,
  videoStreamUrl: `https://example.org/video-${index}.mp4`,
  thumbnailUrl: '',
  durationMs: 6000,
  createdAt: index,
  fetchedAt: index,
  isViewed: false,
  stats: { likesCount: 0, commentsCount: 0, sharesCount: 0 },
  userState: { hasLiked: false },
  permalink: 'https://youtube.com/shorts/123',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'guid.hubHome.socialWeb.reelPlaybackError': 'Video unavailable',
        'guid.hubHome.socialWeb.reelSkip': 'Skip video',
        'guid.hubHome.socialWeb.reelOpenOriginal': 'Open original',
      })[key as 'guid.hubHome.socialWeb.reelPlaybackError'] ?? key,
  }),
}));

vi.mock('@/renderer/pages/social/hooks/useReelsQueue', () => ({
  useReelsQueue: () => ({
    reels,
    activeIndex: state.activeIndex,
    setActiveIndex: state.setActiveIndex,
    isPlaying: true,
    isMuted: true,
    loading: false,
    error: null,
    togglePlay: state.togglePlay,
    toggleMute: state.toggleMute,
    nextReel: state.next,
    prevReel: state.prev,
  }),
}));

describe('Social Reels 100-item player lifecycle', () => {
  let visible: DocumentVisibilityState;
  beforeEach(() => {
    state.activeIndex = 0;
    for (const fn of [state.setActiveIndex, state.next, state.prev, state.togglePlay, state.toggleMute]) fn.mockReset();
    visible = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.stubGlobal('scrollTo', vi.fn());
    Element.prototype.scrollTo = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('mounts no more than 3 video players even with 100 queued reels', () => {
    const { container, rerender, unmount } = render(<ReelsPlayerView />);
    expect(container.querySelectorAll('video').length).toBeLessThanOrEqual(3);
    state.activeIndex = 50;
    rerender(<ReelsPlayerView />);
    expect(container.querySelectorAll('video')).toHaveLength(3);
    state.activeIndex = 99;
    rerender(<ReelsPlayerView />);
    expect(container.querySelectorAll('video').length).toBeLessThanOrEqual(3);
    unmount();
    expect(container.querySelectorAll('video')).toHaveLength(0);
  });

  it('shows an actionable error and skip button when the current video cannot load', () => {
    const { container } = render(<ReelsPlayerView />);
    const player = container.querySelector('video');
    expect(player).not.toBeNull();
    fireEvent.error(player!);
    expect(screen.getByRole('alert')).toHaveTextContent('Video unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Skip video' }));
    expect(state.next).toHaveBeenCalledOnce();
    expect(state.togglePlay).not.toHaveBeenCalled();
  });

  it('does not steal typing keys and pauses videos when the document is hidden', () => {
    const { container, unmount } = render(<ReelsPlayerView />);
    const input = document.createElement('input');
    container.append(input);
    fireEvent.keyDown(input, { code: 'Space', key: ' ' });
    fireEvent.keyDown(input, { code: 'ArrowDown', key: 'ArrowDown' });
    expect(state.togglePlay).not.toHaveBeenCalled();
    expect(state.next).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    fireEvent.keyDown(window, { code: 'ArrowDown', key: 'ArrowDown' });
    expect(state.togglePlay).toHaveBeenCalledOnce();
    expect(state.next).toHaveBeenCalledOnce();
    visible = 'hidden';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    unmount();
  });
});
