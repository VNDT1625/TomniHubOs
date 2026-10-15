import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import SpotlightBlock, { parseSpotlightRequest } from '@/renderer/components/Markdown/SpotlightBlock';
import { runGuideCommand } from '@/renderer/components/Spotlight/spotlightBus';
import { emitter } from '@/renderer/utils/emitter';

const heard: Array<{ targetId: string; note?: string }> = [];
const listener = (request: { targetId: string; note?: string }): void => void heard.push(request);

afterEach(() => {
  emitter.off('ui.spotlight', listener);
  heard.length = 0;
});

describe('a spotlight block in a message', () => {
  it('reads an id, free text, or JSON, and rejects what it cannot use', () => {
    expect(parseSpotlightRequest('settings')).toEqual({ query: 'settings' });
    expect(parseSpotlightRequest('{"target":"super","note":"Bật ở đây"}')).toEqual({
      query: 'super',
      note: 'Bật ở đây',
    });
    expect(parseSpotlightRequest('{"target": 3}')).toBeUndefined();
    expect(parseSpotlightRequest('{not json')).toBeUndefined();
    expect(parseSpotlightRequest('   ')).toBeUndefined();
  });

  it('highlights nothing until the user presses the button', () => {
    emitter.on('ui.spotlight', listener);
    render(<SpotlightBlock source='{"target":"chế độ super","note":"Gạt công tắc này"}' />);
    expect(heard).toEqual([]);
    fireEvent.click(screen.getByTestId('spotlight-block'));
    expect(heard).toEqual([{ targetId: 'super', note: 'Gạt công tắc này' }]);
  });

  it('shows a plain notice, and no button, for a place the app has no guide for', () => {
    render(<SpotlightBlock source='một chỗ không tồn tại' />);
    expect(screen.queryByTestId('spotlight-block')).toBeNull();
    expect(screen.getByTestId('spotlight-block-unknown')).toBeTruthy();
  });
});

describe('the /guide command', () => {
  it('points at the control and tells the caller not to send the message', () => {
    emitter.on('ui.spotlight', listener);
    expect(runGuideCommand('/guide thông báo')).toEqual({ handled: true, found: true });
    expect(heard).toEqual([{ targetId: 'notifications' }]);
  });

  it('is handled, but reported as not found, with no description or an unknown one', () => {
    expect(runGuideCommand('/guide')).toEqual({ handled: true, found: false });
    expect(runGuideCommand('  /GUIDE   ')).toEqual({ handled: true, found: false });
    expect(runGuideCommand('/guide xyz không biết')).toEqual({ handled: true, found: false });
  });

  it('leaves every other message alone', () => {
    expect(runGuideCommand('hello')).toEqual({ handled: false });
    expect(runGuideCommand('/guides settings')).toEqual({ handled: false });
    expect(runGuideCommand('xem /guide settings')).toEqual({ handled: false });
  });
});
