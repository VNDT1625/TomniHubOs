/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure rules of the shared header extension strip (docs/platform/repotopackage-design.md section 12.5). Nothing here
 * touches the DOM, IPC or storage; the renderer measures widths and reads pins, then calls these functions.
 *
 * Rules:
 * 1. Visible pinned icons come from the width left after the 🧩 button; pinned icons that do not fit only appear in
 *    the popup.
 * 2. The strip width follows the gap between the search box and the side panel. An open side panel shrinks it. The
 *    🧩 button always stays, so the strip is never narrower than the button.
 * 3. An extension declares `surfaces`; its icon and popup entry show only on a matching surface.
 * 4. No declaration, or no known surface, means `none`, which shows on every surface.
 */

/** Value meaning "every surface". */
export const SURFACE_NONE = 'none';

/** Surfaces the header knows about. An extension naming any other surface is treated as `none` (rule 4). */
export const KNOWN_SURFACES: readonly string[] = ['browser'];

/** localStorage key of the pinned list, per machine. Read and written only through `parsePinnedIds`. */
export const PIN_STORAGE_KEY = 'tomny:extension-strip-pins';

const MAX_PINNED = 200;

/** Minimal shape the rules need from an extension entry. */
export type SurfaceScoped = Readonly<{ surfaces: readonly string[] }>;

/**
 * Normalises a raw `surfaces` value (from the adapter or from storage) into a sorted, de-duplicated list of known
 * surfaces. Anything missing, not an array, or with no known surface yields `['none']` (rule 4). A declared `none`
 * wins over the other entries because it already means every surface.
 */
export const normalizeSurfaces = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [SURFACE_NONE];
  const found = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    if (item === SURFACE_NONE) return [SURFACE_NONE];
    if (KNOWN_SURFACES.includes(item)) found.add(item);
  }
  return found.size === 0 ? [SURFACE_NONE] : [...found].toSorted();
};

/** True when the entry shows on `surface` (rules 3 and 4). */
export const isVisibleOnSurface = (entry: SurfaceScoped, surface: string): boolean =>
  entry.surfaces.includes(SURFACE_NONE) || entry.surfaces.includes(surface);

/** The entries that show on `surface`, in their original order. */
export const filterForSurface = <T extends SurfaceScoped>(entries: readonly T[], surface: string): T[] =>
  entries.filter((entry) => isVisibleOnSurface(entry, surface));

const finiteOr = (value: number, fallback: number): number => (Number.isFinite(value) ? value : fallback);

export type PinMetrics = Readonly<{
  /** Width of one pinned icon button, in pixels. */
  iconWidth: number;
  /** Space between two neighbouring icons, in pixels. */
  gap: number;
  /** Width of the 🧩 button, in pixels. */
  toggleWidth: number;
}>;

/**
 * How many pinned icons fit in `availableWidth` after the 🧩 button (rule 1). The result is clamped to
 * `[0, pinnedCount]`. Zero pins give 0. When the width fits only the button, the result is 0; when it fits exactly one
 * icon, the result is 1. Bad numbers (NaN, negative, infinite icon width) give 0 rather than a guess.
 */
export const visiblePinCount = (availableWidth: number, pinnedCount: number, metrics: PinMetrics): number => {
  const count = Math.max(0, Math.floor(finiteOr(pinnedCount, 0)));
  const iconWidth = finiteOr(metrics.iconWidth, 0);
  if (count === 0 || iconWidth <= 0) return 0;
  const gap = Math.max(0, finiteOr(metrics.gap, 0));
  const room = finiteOr(availableWidth, 0) - Math.max(0, finiteOr(metrics.toggleWidth, 0));
  if (room < iconWidth) return 0;
  // k icons need k * iconWidth + (k - 1) * gap pixels, so k = floor((room + gap) / (iconWidth + gap)).
  const fit = Math.floor((room + gap) / (iconWidth + gap));
  return Math.min(count, Math.max(0, fit));
};

export type StripGeometryInput = Readonly<{
  /** Free space between the search box and the header's right block, before any side panel is taken into account. */
  gapWidth: number;
  sidePanelOpen: boolean;
  /** Width the open side panel takes from that space. Ignored while it is closed. */
  sidePanelWidth: number;
  pinnedCount: number;
}> &
  PinMetrics;

export type StripGeometry = Readonly<{
  /** Width the strip may use. Never smaller than the 🧩 button. */
  width: number;
  /** Pinned icons drawn in the strip. */
  visibleCount: number;
  /** Pinned icons that only appear in the popup. */
  overflowCount: number;
}>;

/**
 * The strip's width and how many pinned icons it shows (rules 1 and 2). An open side panel subtracts its width from
 * the gap, so the icons shift left as it opens. The width is never below the 🧩 button, so that button always stays.
 */
export const computeStripGeometry = (input: StripGeometryInput): StripGeometry => {
  const gap = Math.max(0, finiteOr(input.gapWidth, 0));
  const panel = input.sidePanelOpen ? Math.max(0, finiteOr(input.sidePanelWidth, 0)) : 0;
  const available = Math.max(0, Math.floor(gap - panel));
  const toggleWidth = Math.max(0, finiteOr(input.toggleWidth, 0));
  const visibleCount = visiblePinCount(available, input.pinnedCount, input);
  return {
    width: Math.max(available, toggleWidth),
    visibleCount,
    overflowCount: Math.max(0, Math.floor(finiteOr(input.pinnedCount, 0)) - visibleCount),
  };
};

/**
 * Reads the stored pin list. Anything that is not a JSON array of strings is dropped; duplicates are removed and the
 * list is capped. A missing or corrupt value gives an empty list.
 */
export const parsePinnedIds = (raw: unknown): string[] => {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === 'string' && item !== '' && item.length <= 300) seen.add(item);
    if (seen.size >= MAX_PINNED) break;
  }
  return [...seen];
};

/** Adds `id` to the pin list when absent, or removes it when present. Order of the other ids is kept. */
export const togglePinnedId = (pinnedIds: readonly string[], id: string): string[] =>
  pinnedIds.includes(id) ? pinnedIds.filter((item) => item !== id) : [...pinnedIds, id].slice(0, MAX_PINNED);

export type StripEntry = SurfaceScoped & Readonly<{ id: string }>;

/**
 * Splits the pinned entries that show on `surface` into the ones drawn in the strip and the overflow for the popup
 * (rule 1). Order follows the pin list. Pinned ids that no longer exist, or that do not show on this surface, are
 * left out. Unpinned entries are never returned here.
 */
export const splitPinnedForStrip = <T extends StripEntry>(
  entries: readonly T[],
  pinnedIds: readonly string[],
  surface: string,
  visibleCount: number
): Readonly<{ inline: T[]; overflow: T[] }> => {
  const byId = new Map(filterForSurface(entries, surface).map((entry) => [entry.id, entry] as const));
  const pinned: T[] = [];
  for (const id of pinnedIds) {
    const entry = byId.get(id);
    if (entry) pinned.push(entry);
  }
  const keep = Math.max(0, Math.floor(finiteOr(visibleCount, 0)));
  return { inline: pinned.slice(0, keep), overflow: pinned.slice(keep) };
};
