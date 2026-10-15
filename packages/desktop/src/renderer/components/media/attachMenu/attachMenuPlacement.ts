/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Horizontal placement for the attach / tools popup. Pure math so the rules can be unit-tested without a layout engine.
 * The popup must stay inside the free area: the viewport, narrowed to the Home main column when the sider or the
 * side rail is visible. When the room on one side is too small for two columns, the popup switches to a stacked layout.
 */

/** A horizontal span in CSS pixels. `left` and `right` are viewport coordinates. */
export type AttachMenuSpan = { readonly left: number; readonly right: number };

export type AttachMenuLayout = 'columns' | 'stacked';

export type AttachMenuPlacement = {
  /** Arco trigger position: `tl` grows to the right from the anchor, `tr` grows to the left. */
  readonly position: 'tl' | 'tr';
  /** Widest the popup may be, in px. Never wider than the free area on the chosen side. */
  readonly maxWidth: number;
  /** `columns` keeps the main list and the sub-list side by side; `stacked` shows one column at a time. */
  readonly layout: AttachMenuLayout;
};

/** Gap kept between the popup and the edge of the free area. */
export const ATTACH_MENU_EDGE_GUTTER = 8;
/** Widest popup, including the sub-list column. */
export const ATTACH_MENU_MAX_WIDTH = 640;
/** Minimum width of the main (category) column. */
export const ATTACH_MENU_MAIN_MIN_WIDTH = 200;
/** Minimum width of the sub-list column (names, badges and checkboxes stay readable). */
export const ATTACH_MENU_PANEL_MIN_WIDTH = 260;
/** Two columns side by side need at least this much width. */
export const ATTACH_MENU_COLUMNS_MIN_WIDTH = ATTACH_MENU_MAIN_MIN_WIDTH + ATTACH_MENU_PANEL_MIN_WIDTH;

/**
 * Free horizontal area for the popup. A pane that is absent or collapsed (width 0) is passed as `undefined`
 * and does not narrow the area. The result is never inverted.
 */
export const resolveAttachMenuArea = (input: {
  readonly viewportWidth: number;
  readonly siderRight?: number;
  readonly railLeft?: number;
}): AttachMenuSpan => {
  const left = Math.max(0, input.siderRight ?? 0);
  const right = Math.min(input.viewportWidth, input.railLeft ?? input.viewportWidth);
  return { left, right: Math.max(left, right) };
};

/**
 * Chooses the side the popup grows toward and the largest width that fits there. Ties keep the original `tl` side.
 * If even the main column does not fit, the width is floored at the free area so the popup never exceeds it.
 */
export const computeAttachMenuPlacement = (anchor: AttachMenuSpan, area: AttachMenuSpan): AttachMenuPlacement => {
  const roomToRight = area.right - ATTACH_MENU_EDGE_GUTTER - anchor.left;
  const roomToLeft = anchor.right - area.left - ATTACH_MENU_EDGE_GUTTER;
  const position: 'tl' | 'tr' = roomToRight >= roomToLeft ? 'tl' : 'tr';
  const room = Math.floor(Math.max(roomToRight, roomToLeft));
  const areaWidth = Math.max(0, area.right - area.left - 2 * ATTACH_MENU_EDGE_GUTTER);
  const floor = Math.min(ATTACH_MENU_MAIN_MIN_WIDTH, areaWidth);
  const maxWidth = Math.max(Math.min(ATTACH_MENU_MAX_WIDTH, room), floor);
  const layout: AttachMenuLayout = maxWidth >= ATTACH_MENU_COLUMNS_MIN_WIDTH ? 'columns' : 'stacked';
  return { position, maxWidth, layout };
};

/** Reads the Home side panes from the DOM. Collapsed or missing panes are ignored. Browser-only. */
/** Edge of the first visible (non-collapsed) element matching the selector, or undefined. */
const visibleEdge = (selector: string, edge: 'left' | 'right'): number | undefined => {
  for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0) return rect[edge];
  }
  return undefined;
};

export const readAttachMenuArea = (): AttachMenuSpan => {
  return resolveAttachMenuArea({
    viewportWidth: window.innerWidth,
    siderRight: visibleEdge('.hub-sider', 'right'),
    railLeft: visibleEdge('.hub-rail', 'left'),
  });
};
