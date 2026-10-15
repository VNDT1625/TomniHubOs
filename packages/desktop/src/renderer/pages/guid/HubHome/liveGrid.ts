/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HubActivityItem } from '@/common/types/agent/hubActivity';

/**
 * Per-viewer layout of the Home live grid. `unpinged` tiles are shown but not
 * rendered live; `unfollowed` tiles stop receiving attention pings. Finished
 * work remains visible until the user explicitly dismisses its card.
 *
 * `auto` follows active count with its own fluid layout. A manual number
 * specifies the number of cards visible WITHOUT scrolling (space permitting),
 * not the number of columns or the number of agents loaded.
 */
export type LiveGridPrefs = { order: string[]; unpinged: string[]; unfollowed: string[]; slots: GridSlots };

export const GRID_SLOT_MIN = 1;
export const GRID_SLOT_MAX = 12;
export type GridSlots = 'auto' | number;
export const DEFAULT_GRID_PREFS: LiveGridPrefs = { order: [], unpinged: [], unfollowed: [], slots: 'auto' };
const MAX_REMEMBERED_IDS = 200;

/** Auto/grid helpers retained for compatibility; manual density has its own minima. */
export const TILE_MIN_WIDTH = 340;
export const TILE_MIN_HEIGHT = 220;
export const GRID_GAP_PX = 12;

/**
 * Four visual density profiles. They change typography and secondary detail,
 * but do not force a fixed number of equally-sized rows or columns.
 */
export type TileSize = 'xl' | 'lg' | 'md' | 'sm';
export type GridDensity = 'solo' | 'standard' | 'compact';
/** Three presentations for both Auto and Custom: detailed 1–2, balanced 3–6, compact 7+. */
export const gridDensityForCount = (count: number): GridDensity =>
  count <= 2 ? 'solo' : count <= 6 ? 'standard' : 'compact';

/** Density of each tile according to the preferred number of active monitors. */
export const tileSizeForCount = (count: number): TileSize =>
  count <= 1 ? 'xl' : count === 2 ? 'lg' : count <= 4 ? 'md' : 'sm';

/** Columns a tile size gets for a given stage width (always >= 1 column). */
export const columnsForSize = (size: TileSize, width: number): number => {
  if (size === 'xl') return 1;
  const columns = Math.max(1, Math.floor((width + GRID_GAP_PX) / (TILE_MIN_WIDTH + GRID_GAP_PX)));
  return Math.min(size === 'sm' ? 3 : 2, columns);
};

/** How many min-height rows fit in a stage height (at least one). */
export const rowsFittingHeight = (height: number): number =>
  Math.max(1, Math.floor((height + GRID_GAP_PX) / (TILE_MIN_HEIGHT + GRID_GAP_PX)));

export type GridLayout = {
  slots: GridSlots;
  /** Grid columns the layout resolves to. */
  columns: number;
  /** Total rows after reserving the visible manual window. */
  rows: number;
  /** Tiles viewable without scrolling; `arrangeGrid` escalates attention into it. */
  capacity: number;
  tileSize: TileSize;
  /** Rows in the on-screen window, separate from rows below the fold. */
  visibleRows: number;
  /** Height in pixels of each card row in manual mode. */
  rowHeight: number;
};

/** Resolve the user's requested on-screen window, not the total agent count.
 * The fallback on a genuinely narrow window is a smaller readable window.
 */
export const resolveGridLayout = (count: number, width: number, height: number, slots: GridSlots): GridLayout => {
  // Fewer actual agents than requested slots should get a spacious layout,
  // never 2 miniature compact tiles merely because Custom is set to 12.
  const slotLimit = slots === 'auto' ? count : Math.max(GRID_SLOT_MIN, Math.min(GRID_SLOT_MAX, Math.floor(slots)));
  const requested = Math.min(Math.max(1, count), Math.max(1, slotLimit));
  const tileSize = tileSizeForCount(slots === 'auto' ? count : requested);
  if (slots === 'auto') {
    const columns =
      tileSize === 'xl'
        ? 1
        : tileSize === 'sm' && width >= 3 * 300 + 2 * GRID_GAP_PX
          ? 3
          : width >= 2 * 300 + GRID_GAP_PX
            ? 2
            : 1;
    const capacity = columns * rowsFittingHeight(height);
    return {
      slots,
      columns,
      rows: Math.max(1, Math.ceil(count / columns)),
      capacity,
      tileSize,
      visibleRows: rowsFittingHeight(height),
      rowHeight: 0,
    };
  }

  const preferredColumns =
    requested === 1 ? 1 : requested <= 4 ? 2 : requested <= 6 ? 3 : requested <= 8 ? 4 : requested === 9 ? 3 : 4;
  // If only two cards fit, recompute using the *detailed* card minima.
  // Density drives geometry as well as content; otherwise a 142px compact
  // slot could accidentally receive the full detailed card presentation.
  let capacity = requested;
  let columns = 1;
  let minHeight = 240;
  for (let pass = 0; pass < 3; pass += 1) {
    const density = gridDensityForCount(capacity);
    const minWidth = density === 'compact' ? 176 : density === 'solo' ? 280 : 235;
    minHeight = density === 'compact' ? 142 : density === 'solo' ? 240 : 180;
    const fittingColumns = Math.max(1, Math.floor((Math.max(0, width) + GRID_GAP_PX) / (minWidth + GRID_GAP_PX)));
    columns = Math.min(preferredColumns, fittingColumns);
    const fittingRows = Math.max(1, Math.floor((Math.max(0, height) + GRID_GAP_PX) / (minHeight + GRID_GAP_PX)));
    const nextCapacity = Math.min(requested, columns * fittingRows);
    if (nextCapacity === capacity) break;
    capacity = nextCapacity;
  }
  const visibleRows = Math.max(1, Math.ceil(capacity / columns));
  const rowHeight = Math.max(
    minHeight,
    Math.floor((Math.max(0, height) - GRID_GAP_PX * (visibleRows - 1)) / visibleRows)
  );
  // When the requested count isn't a multiple of columns, the first overflow
  // item explicitly starts below the last visible row (no N+1th visible tile).
  const overflowCount = Math.max(0, count - capacity);
  const rows = visibleRows + Math.ceil(overflowCount / columns);
  return { slots, columns, rows, capacity, tileSize, visibleRows, rowHeight };
};

const needsEye = (item: HubActivityItem): boolean => item.status === 'needs_input' || item.status === 'error';

/** Parses stored prefs defensively; anything malformed falls back to defaults. */
export const parseGridPrefs = (raw: string | null): LiveGridPrefs => {
  try {
    const value = JSON.parse(raw ?? '{}') as Partial<Record<keyof LiveGridPrefs, unknown>>;
    const ids = (list: unknown): string[] =>
      Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string').slice(0, MAX_REMEMBERED_IDS) : [];
    const slots =
      value.slots === 'auto'
        ? 'auto'
        : typeof value.slots === 'number' &&
            Number.isInteger(value.slots) &&
            value.slots >= GRID_SLOT_MIN &&
            value.slots <= GRID_SLOT_MAX
          ? value.slots
          : 'auto';
    return { order: ids(value.order), unpinged: ids(value.unpinged), unfollowed: ids(value.unfollowed), slots };
  } catch {
    return DEFAULT_GRID_PREFS;
  }
};

/** Drops ids of items that no longer exist so stored prefs never grow without bound. */
export const pruneGridPrefs = (prefs: LiveGridPrefs, items: readonly HubActivityItem[]): LiveGridPrefs => {
  const live = new Set(items.map((item) => item.id));
  const keep = (list: string[]) => list.filter((id) => live.has(id));
  return { ...prefs, order: keep(prefs.order), unpinged: keep(prefs.unpinged), unfollowed: keep(prefs.unfollowed) };
};

/** User order first; new items follow in registry order (which already puts attention first). */
export const orderItems = (items: readonly HubActivityItem[], order: readonly string[]): HubActivityItem[] => {
  const position = new Map(order.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, rank: position.get(item.id) ?? order.length + index }))
    .toSorted((left, right) => left.rank - right.rank)
    .map(({ item }) => item);
};

/** Moves `id` to where `targetId` sits (drag and drop). */
export const moveInOrder = (visible: readonly string[], id: string, targetId: string): string[] => {
  const from = visible.indexOf(id);
  const to = visible.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return [...visible];
  const next = [...visible];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
};

export type ArrangedGrid = { tiles: HubActivityItem[]; escalated: Set<string> };

/**
 * Work that needs the user (a question or a failure) but is not being watched
 * jumps to the earliest visible slot, preferring a slot whose tile is not
 * pinged. The arrangement is derived, never stored, so once the user handles it
 * the tile falls back to its own place. `visible` is the resolved readable
 * attention window (bounded by the number requested and actual stage height).
 */
export const arrangeGrid = (
  items: readonly HubActivityItem[],
  prefs: Pick<LiveGridPrefs, 'order' | 'unpinged'> & { visible: number }
): ArrangedGrid => {
  const tiles = orderItems(items, prefs.order);
  const unpinged = new Set(prefs.unpinged);
  const escalated = new Set<string>();
  const visible = Math.min(prefs.visible, tiles.length);
  for (let index = 0; index < tiles.length; index += 1) {
    const item = tiles[index]!;
    const watched = index < prefs.visible && !unpinged.has(item.id);
    if (!needsEye(item) || watched) continue;
    let target = -1;
    for (let slot = 0; slot < Math.min(visible, index); slot += 1) {
      const occupant = tiles[slot]!;
      if (!needsEye(occupant) && unpinged.has(occupant.id)) {
        target = slot;
        break;
      }
    }
    if (target < 0 && index >= prefs.visible) {
      for (let slot = 0; slot < visible; slot += 1) {
        const occupant = tiles[slot]!;
        if (!needsEye(occupant) && !escalated.has(occupant.id)) {
          target = slot;
          break;
        }
      }
    }
    if (target >= 0) {
      tiles[index] = tiles[target]!;
      tiles[target] = item;
    }
    escalated.add(item.id);
  }
  return { tiles, escalated };
};

export type PingAdvice = { limit: number; reason?: 'cpu' | 'ram' };

/** How many tiles can render live without hurting the machine, from real CPU/RAM usage. */
export const recommendedPingLimit = (cpuPercent: number | null, ramPercent: number | null): PingAdvice => {
  const cpu = cpuPercent ?? 0;
  const ram = ramPercent ?? 0;
  const reason = ram >= cpu ? 'ram' : 'cpu';
  const peak = Math.max(cpu, ram);
  if (peak >= 85) return { limit: 2, reason };
  if (peak >= 70) return { limit: 3, reason };
  return { limit: 6 };
};

/** Solo monitor only: a brief prose excerpt, not a duplicate Chat/HTML renderer. */
export const monitorResponseExcerpt = (preview?: string): string => {
  if (!preview) return '';
  const prose = preview
    .replace(/```[^\n]*\n[\s\S]*?```/g, ' ')
    .replace(/```[\s\S]*$/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#*_~`>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return prose.length > 340 ? `${prose.slice(0, 339)}…` : prose;
};

/** Short display name of a workspace path (last folder). */
export const workspaceLabel = (workspace?: string): string =>
  (workspace ?? '')
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() ?? '';
