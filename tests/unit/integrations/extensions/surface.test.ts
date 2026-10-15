import { describe, expect, it } from 'vitest';
import {
  computeStripGeometry,
  filterForSurface,
  isVisibleOnSurface,
  normalizeSurfaces,
  parsePinnedIds,
  splitPinnedForStrip,
  togglePinnedId,
  visiblePinCount,
} from '@/common/integrations/extensions/surface';

const METRICS = { iconWidth: 28, gap: 4, toggleWidth: 32 };

describe('normalizeSurfaces (rule 4)', () => {
  it('maps a missing or non-array value to none', () => {
    expect(normalizeSurfaces(undefined)).toEqual(['none']);
    expect(normalizeSurfaces('browser')).toEqual(['none']);
    expect(normalizeSurfaces(null)).toEqual(['none']);
  });

  it('maps an empty array or only unknown surfaces to none', () => {
    expect(normalizeSurfaces([])).toEqual(['none']);
    expect(normalizeSurfaces(['chat', 'hub'])).toEqual(['none']);
    expect(normalizeSurfaces([42, null, {}])).toEqual(['none']);
  });

  it('keeps known surfaces, sorted and de-duplicated', () => {
    expect(normalizeSurfaces(['browser', 'browser'])).toEqual(['browser']);
  });

  it('lets a declared none win over other entries', () => {
    expect(normalizeSurfaces(['browser', 'none'])).toEqual(['none']);
  });
});

describe('surface visibility (rules 3 and 4)', () => {
  it('shows a browser-only extension on browser and nowhere else', () => {
    const entry = { surfaces: ['browser'] };
    expect(isVisibleOnSurface(entry, 'browser')).toBe(true);
    expect(isVisibleOnSurface(entry, 'hub')).toBe(false);
  });

  it('shows a none extension on every surface', () => {
    const entry = { surfaces: ['none'] };
    expect(isVisibleOnSurface(entry, 'browser')).toBe(true);
    expect(isVisibleOnSurface(entry, 'hub')).toBe(true);
  });

  it('filters a list to the entries of one surface, keeping order', () => {
    const entries = [
      { id: 'a', surfaces: ['browser'] },
      { id: 'b', surfaces: ['none'] },
      { id: 'c', surfaces: ['browser'] },
    ];
    expect(filterForSurface(entries, 'browser').map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(filterForSurface(entries, 'hub').map((entry) => entry.id)).toEqual(['b']);
  });
});

describe('visiblePinCount (rule 1)', () => {
  it('gives 0 when there are no pins', () => {
    expect(visiblePinCount(1000, 0, METRICS)).toBe(0);
  });

  it('gives 0 when the width fits only the 🧩 button', () => {
    expect(visiblePinCount(32, 5, METRICS)).toBe(0);
    expect(visiblePinCount(40, 5, METRICS)).toBe(0);
  });

  it('gives 1 when the width fits exactly one icon after the button', () => {
    // 32 (button) + 28 (one icon) = 60
    expect(visiblePinCount(60, 5, METRICS)).toBe(1);
    expect(visiblePinCount(59, 5, METRICS)).toBe(0);
  });

  it('counts gaps between icons', () => {
    // 32 + 28 + 4 + 28 = 92 for two icons
    expect(visiblePinCount(92, 5, METRICS)).toBe(2);
    expect(visiblePinCount(91, 5, METRICS)).toBe(1);
  });

  it('never returns more than the number of pins', () => {
    expect(visiblePinCount(10_000, 3, METRICS)).toBe(3);
  });

  it('gives 0 for bad numbers instead of guessing', () => {
    expect(visiblePinCount(Number.NaN, 3, METRICS)).toBe(0);
    expect(visiblePinCount(500, Number.NaN, METRICS)).toBe(0);
    expect(visiblePinCount(500, 3, { ...METRICS, iconWidth: 0 })).toBe(0);
    expect(visiblePinCount(500, 3, { ...METRICS, iconWidth: Number.POSITIVE_INFINITY })).toBe(0);
  });
});

describe('computeStripGeometry (rule 2)', () => {
  const base = { gapWidth: 400, sidePanelOpen: false, sidePanelWidth: 320, pinnedCount: 10, ...METRICS };

  it('uses the whole gap when the side panel is closed', () => {
    const geometry = computeStripGeometry(base);
    expect(geometry.width).toBe(400);
    // (400 - 32 + 4) / 32 = 11.6 -> 11, clamped to 10 pins
    expect(geometry.visibleCount).toBe(10);
    expect(geometry.overflowCount).toBe(0);
  });

  it('shrinks the strip and moves icons into the overflow when the side panel opens', () => {
    const geometry = computeStripGeometry({ ...base, sidePanelOpen: true });
    expect(geometry.width).toBe(80);
    expect(geometry.visibleCount).toBe(1);
    expect(geometry.overflowCount).toBe(9);
  });

  it('ignores the side panel width while it is closed', () => {
    expect(computeStripGeometry({ ...base, sidePanelWidth: 9999 }).width).toBe(400);
  });

  it('keeps the 🧩 button when the gap is narrower than the button', () => {
    const geometry = computeStripGeometry({ ...base, gapWidth: 10, sidePanelOpen: true });
    expect(geometry.width).toBe(METRICS.toggleWidth);
    expect(geometry.visibleCount).toBe(0);
    expect(geometry.overflowCount).toBe(10);
  });

  it('keeps the 🧩 button when the gap is zero or negative', () => {
    expect(computeStripGeometry({ ...base, gapWidth: 0 }).width).toBe(METRICS.toggleWidth);
    expect(computeStripGeometry({ ...base, gapWidth: -50 }).width).toBe(METRICS.toggleWidth);
  });

  it('reports no overflow when there are no pins', () => {
    const geometry = computeStripGeometry({ ...base, pinnedCount: 0 });
    expect(geometry.visibleCount).toBe(0);
    expect(geometry.overflowCount).toBe(0);
  });
});

describe('pin storage helpers', () => {
  it('reads a JSON array of unique strings', () => {
    expect(parsePinnedIds('["a","b","a",""]')).toEqual(['a', 'b']);
    expect(parsePinnedIds(['x', 'y'])).toEqual(['x', 'y']);
  });

  it('drops corrupt or non-array values', () => {
    expect(parsePinnedIds('not json')).toEqual([]);
    expect(parsePinnedIds('{"a":1}')).toEqual([]);
    expect(parsePinnedIds(null)).toEqual([]);
    expect(parsePinnedIds([1, 2, 'ok'])).toEqual(['ok']);
  });

  it('toggles an id in and out, keeping the order of the others', () => {
    expect(togglePinnedId(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(togglePinnedId(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });
});

describe('splitPinnedForStrip (rule 1)', () => {
  const entries = [
    { id: 'one', surfaces: ['browser'] },
    { id: 'two', surfaces: ['none'] },
    { id: 'three', surfaces: ['hub'] },
    { id: 'four', surfaces: ['browser'] },
  ];

  it('follows the pin order and puts the extra pins in the overflow', () => {
    const split = splitPinnedForStrip(entries, ['four', 'two', 'one'], 'browser', 2);
    expect(split.inline.map((entry) => entry.id)).toEqual(['four', 'two']);
    expect(split.overflow.map((entry) => entry.id)).toEqual(['one']);
  });

  it('leaves out pins that do not show on this surface or no longer exist', () => {
    const split = splitPinnedForStrip(entries, ['three', 'gone', 'one'], 'browser', 5);
    expect(split.inline.map((entry) => entry.id)).toEqual(['one']);
    expect(split.overflow).toEqual([]);
  });

  it('with no visible room everything pinned goes to the overflow', () => {
    const split = splitPinnedForStrip(entries, ['one', 'two'], 'browser', 0);
    expect(split.inline).toEqual([]);
    expect(split.overflow.map((entry) => entry.id)).toEqual(['one', 'two']);
  });
});
