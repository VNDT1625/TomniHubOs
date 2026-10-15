/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Measures the room the extension strip may use in the shared header. The strip sits just left of the notification
 * bell, so its room is the gap between the right edge of the search box and the left edge of the bell. The bell moves
 * when the side panel opens, so the gap follows the panel without a separate rule. Without a search box or a bell in
 * the DOM (older layouts) it falls back to the header width minus the left block, the toolbar and a search reserve.
 */

/** Room kept for the search box in the fallback measure. */
export const SEARCH_RESERVE_PX = 360;
/** Space kept between the search box and the strip, and between the strip and the bell. */
const EDGE_GAP_PX = 8;

const widthOf = (root: HTMLElement, selector: string): number =>
  root.querySelector<HTMLElement>(selector)?.getBoundingClientRect().width ?? 0;

/** Spare width for the strip inside the `.app-titlebar` element that contains `header`. Never negative. */
export const measureSpareWidth = (header: HTMLElement): number => {
  const search = header.querySelector<HTMLElement>('.app-titlebar__search-container');
  const bell = header.querySelector<HTMLElement>('.app-titlebar__toolbar > .arco-badge');
  if (search !== null && bell !== null) {
    const gap = bell.getBoundingClientRect().left - search.getBoundingClientRect().right - EDGE_GAP_PX * 2;
    return Math.max(0, Math.floor(gap));
  }
  const stripWidth = widthOf(header, '[data-extension-strip]');
  const toolbarBase = widthOf(header, '.app-titlebar__toolbar') - stripWidth;
  const spare =
    header.getBoundingClientRect().width - widthOf(header, '.app-titlebar__menu') - toolbarBase - SEARCH_RESERVE_PX;
  return Math.max(0, Math.floor(spare));
};
