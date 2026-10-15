/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { measureSpareWidth } from '@/renderer/components/layout/Titlebar/extensions/stripGap';

const rect = (left: number, right: number): DOMRect =>
  ({ left, right, width: right - left, top: 0, bottom: 32, height: 32, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;

const header = (searchRight: number, bellLeft: number): HTMLElement => {
  const root = document.createElement('div');
  root.innerHTML =
    '<div class="app-titlebar__search-container"></div><div class="app-titlebar__toolbar"><span class="arco-badge"></span></div>';
  const search = root.querySelector('.app-titlebar__search-container') as HTMLElement;
  const bell = root.querySelector('.arco-badge') as HTMLElement;
  search.getBoundingClientRect = () => rect(140, searchRight);
  bell.getBoundingClientRect = () => rect(bellLeft, bellLeft + 32);
  return root;
};

describe('measureSpareWidth', () => {
  it('is the gap between the search box and the bell, less the edge room', () => {
    expect(measureSpareWidth(header(583, 1408))).toBe(1408 - 583 - 16);
  });

  it('shrinks when the bell moves left with the side panel', () => {
    expect(measureSpareWidth(header(583, 900))).toBeLessThan(measureSpareWidth(header(583, 1408)));
  });

  it('never goes negative', () => {
    expect(measureSpareWidth(header(900, 905))).toBe(0);
  });
});
