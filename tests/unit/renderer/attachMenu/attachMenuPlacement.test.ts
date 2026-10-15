/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  ATTACH_MENU_MAX_WIDTH,
  computeAttachMenuPlacement,
  resolveAttachMenuArea,
} from '@/renderer/components/media/attachMenu/attachMenuPlacement';

describe('resolveAttachMenuArea', () => {
  it('uses the whole viewport when no side pane is visible', () => {
    expect(resolveAttachMenuArea({ viewportWidth: 1280 })).toEqual({ left: 0, right: 1280 });
  });

  it('starts after the sider and stops at the side rail', () => {
    expect(resolveAttachMenuArea({ viewportWidth: 1600, siderRight: 232, railLeft: 1200 })).toEqual({
      left: 232,
      right: 1200,
    });
  });

  it('never returns an inverted area', () => {
    expect(resolveAttachMenuArea({ viewportWidth: 300, siderRight: 400 })).toEqual({ left: 400, right: 400 });
  });
});

describe('computeAttachMenuPlacement', () => {
  const area = { left: 232, right: 1200 };

  it('keeps the original upward-left placement when there is room to the right', () => {
    const placement = computeAttachMenuPlacement({ left: 260, right: 290 }, area);
    expect(placement).toEqual({ position: 'tl', maxWidth: ATTACH_MENU_MAX_WIDTH, layout: 'columns' });
  });

  it('grows to the left when the anchor sits against the side rail, so the popup never reaches under it', () => {
    const placement = computeAttachMenuPlacement({ left: 1130, right: 1160 }, area);
    expect(placement.position).toBe('tr');
    expect(placement.maxWidth).toBe(ATTACH_MENU_MAX_WIDTH);
    expect(placement.layout).toBe('columns');
  });

  it('caps the width at the room left on the chosen side', () => {
    // Area 0..500 with the anchor on the right: room to the left is 392px after the gutter.
    const placement = computeAttachMenuPlacement({ left: 480, right: 500 }, { left: 0, right: 500 });
    expect(placement).toEqual({ position: 'tr', maxWidth: 492, layout: 'columns' });
  });

  it('switches to the stacked layout when two columns cannot fit', () => {
    const placement = computeAttachMenuPlacement({ left: 380, right: 400 }, { left: 0, right: 400 });
    expect(placement).toEqual({ position: 'tr', maxWidth: 392, layout: 'stacked' });
  });

  it('never exceeds a very narrow free area even when the main column does not fit', () => {
    const placement = computeAttachMenuPlacement({ left: 140, right: 150 }, { left: 0, right: 150 });
    expect(placement.layout).toBe('stacked');
    expect(placement.maxWidth).toBe(142);
  });

  it('keeps the original side on a tie', () => {
    const placement = computeAttachMenuPlacement({ left: 400, right: 420 }, { left: 0, right: 820 });
    expect(placement.position).toBe('tl');
  });
});
