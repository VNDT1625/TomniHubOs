/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { HubActivityItem, HubActivityStatus } from '@/common/types/agent/hubActivity';
import {
  arrangeGrid,
  columnsForSize,
  GRID_SLOT_MAX,
  gridDensityForCount,
  moveInOrder,
  monitorResponseExcerpt,
  orderItems,
  parseGridPrefs,
  pruneGridPrefs,
  recommendedPingLimit,
  resolveGridLayout,
  rowsFittingHeight,
  tileSizeForCount,
  workspaceLabel,
} from '@/renderer/pages/guid/HubHome/liveGrid';

const item = (id: string, status: HubActivityStatus = 'running'): HubActivityItem => ({
  id,
  kind: 'agent',
  sourceId: id,
  title: id,
  status,
  startedAt: 1,
  updatedAt: 1,
  steps: [],
  canStop: true,
});

const ids = (items: readonly HubActivityItem[]) => items.map((entry) => entry.id);

describe('Home live grid layout', () => {
  it('parses stored prefs defensively', () => {
    expect(parseGridPrefs(null)).toEqual({ order: [], unpinged: [], unfollowed: [], slots: 'auto' });
    expect(parseGridPrefs('not json')).toEqual({ order: [], unpinged: [], unfollowed: [], slots: 'auto' });
    expect(parseGridPrefs('{"order":["a",1],"unpinged":"x","slots":6}')).toEqual({
      order: ['a'],
      unpinged: [],
      unfollowed: [],
      slots: 6,
    });
    expect(parseGridPrefs('{"slots":"auto"}').slots).toBe('auto');
    expect(parseGridPrefs('{"slots":99}').slots).toBe('auto');
    expect(
      parseGridPrefs(JSON.stringify({ order: Array.from({ length: 500 }, (_, i) => `i${i}`) })).order
    ).toHaveLength(200);
  });

  it('prunes ids of work that no longer exists', () => {
    const pruned = pruneGridPrefs({ order: ['a', 'gone'], unpinged: ['gone'], unfollowed: ['a'], slots: 6 }, [
      item('a'),
    ]);
    expect(pruned).toEqual({ order: ['a'], unpinged: [], unfollowed: ['a'], slots: 6 });
  });

  it('keeps the user order and appends new work in registry order', () => {
    expect(ids(orderItems([item('a'), item('b'), item('c')], ['c', 'a']))).toEqual(['c', 'a', 'b']);
  });

  it('moves a tile onto the slot it was dropped on', () => {
    expect(moveInOrder(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveInOrder(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(moveInOrder(['a', 'b'], 'a', 'missing')).toEqual(['a', 'b']);
  });

  it('leaves watched work needing attention where it is', () => {
    const { tiles, escalated } = arrangeGrid([item('a'), item('b', 'needs_input')], {
      order: [],
      unpinged: [],
      visible: 4,
    });
    expect(ids(tiles)).toEqual(['a', 'b']);
    expect(escalated.size).toBe(0);
  });

  it('escalates an unpinged question into the first unwatched visible slot', () => {
    const { tiles, escalated } = arrangeGrid([item('a'), item('b'), item('c', 'needs_input')], {
      order: [],
      unpinged: ['b', 'c'],
      visible: 4,
    });
    expect(ids(tiles)).toEqual(['a', 'c', 'b']);
    expect([...escalated]).toEqual(['c']);
  });

  it('pulls an off-screen failure into view, never displacing other attention', () => {
    const items = [item('a', 'needs_input'), item('b'), item('c'), item('d'), item('e', 'error')];
    const { tiles, escalated } = arrangeGrid(items, { order: [], unpinged: [], visible: 4 });
    expect(ids(tiles).slice(0, 4)).toEqual(['a', 'e', 'c', 'd']);
    expect(escalated.has('e')).toBe(true);
  });

  it('recommends fewer live previews as CPU or RAM climbs', () => {
    expect(recommendedPingLimit(null, null)).toEqual({ limit: 6 });
    expect(recommendedPingLimit(40, 60)).toEqual({ limit: 6 });
    expect(recommendedPingLimit(72, 10)).toEqual({ limit: 3, reason: 'cpu' });
    expect(recommendedPingLimit(20, 90)).toEqual({ limit: 2, reason: 'ram' });
  });

  it('uses a more spacious card density when fewer agents are selected', () => {
    expect(tileSizeForCount(0)).toBe('xl');
    expect(tileSizeForCount(1)).toBe('xl');
    expect(tileSizeForCount(2)).toBe('lg');
    expect(tileSizeForCount(3)).toBe('md');
    expect(tileSizeForCount(4)).toBe('md');
    expect(tileSizeForCount(5)).toBe('sm');
    expect(tileSizeForCount(12)).toBe('sm');
  });

  it('derives columns from the tile size and stage width', () => {
    expect(columnsForSize('xl', 2000)).toBe(1);
    expect(columnsForSize('lg', 1200)).toBe(2);
    expect(columnsForSize('lg', 400)).toBe(1);
    expect(columnsForSize('md', 1200)).toBe(2);
    expect(columnsForSize('sm', 1400)).toBe(3);
    expect(columnsForSize('sm', 700)).toBe(2);
  });

  it('fits at least one row however small the stage is', () => {
    expect(rowsFittingHeight(0)).toBe(1);
    expect(rowsFittingHeight(179)).toBe(1);
    expect(rowsFittingHeight(372)).toBe(1);
    expect(rowsFittingHeight(800)).toBe(3);
  });

  it('auto mode chooses readable columns while surplus agents scroll', () => {
    const solo = resolveGridLayout(1, 1400, 700, 'auto');
    expect(solo).toMatchObject({ columns: 1, rows: 1, capacity: 3, tileSize: 'xl' });

    const pair = resolveGridLayout(2, 1400, 700, 'auto');
    expect(pair).toMatchObject({ columns: 2, rows: 1, capacity: 6, tileSize: 'lg' });

    // Five agents on a stage one row tall: the last two scroll into view.
    const crowded = resolveGridLayout(5, 1400, 180, 'auto');
    expect(crowded.tileSize).toBe('sm');
    expect(crowded.columns).toBe(3);
    expect(crowded.capacity).toBe(3);
  });

  it('manual numbers mean the number of cards in the viewport, never the total agent count', () => {
    const stage = { width: 960, height: 640 };
    const layout = (slots: number) => resolveGridLayout(20, stage.width, stage.height, slots);
    expect(layout(1)).toMatchObject({ columns: 1, visibleRows: 1, capacity: 1, rows: 20 });
    expect(layout(2)).toMatchObject({ columns: 2, visibleRows: 1, capacity: 2 });
    expect(layout(4)).toMatchObject({ columns: 2, visibleRows: 2, capacity: 4 });
    expect(layout(5)).toMatchObject({ columns: 3, visibleRows: 2, capacity: 5 });
    expect(layout(6)).toMatchObject({ columns: 3, visibleRows: 2, capacity: 6 });
    expect(layout(8)).toMatchObject({ columns: 4, visibleRows: 2, capacity: 8 });
    expect(layout(9)).toMatchObject({ columns: 3, visibleRows: 3, capacity: 9 });
    expect(layout(12)).toMatchObject({ columns: 4, visibleRows: 3, capacity: 12 });
    expect(layout(5).rowHeight * 2 + 12).toBeLessThanOrEqual(stage.height);
    expect(layout(12).rowHeight * 3 + 24).toBeLessThanOrEqual(stage.height);
  });

  it('caps manual monitoring at 12 cards, adapting the visible window when width/height is insufficient', () => {
    expect(GRID_SLOT_MAX).toBe(12);
    // A narrow viewport cannot expose 12 compact tiles; as its real capacity
    // crosses into balanced/detailed range it must reserve readable geometry.
    expect(resolveGridLayout(15, 700, 440, 12)).toMatchObject({
      columns: 2,
      visibleRows: 2,
      capacity: 4,
      rowHeight: 214,
    });
    expect(resolveGridLayout(15, 360, 440, 12)).toMatchObject({
      columns: 1,
      visibleRows: 1,
      capacity: 1,
      rowHeight: 440,
    });
    expect(resolveGridLayout(15, 310, 200, 12)).toMatchObject({ columns: 1, capacity: 1 });
    expect(resolveGridLayout(20, 960, 640, 33).capacity).toBe(12);
    expect(parseGridPrefs('{"slots":12}').slots).toBe(12);
    expect(parseGridPrefs('{"slots":13}').slots).toBe('auto');
    expect(parseGridPrefs('{"slots":32}').slots).toBe('auto');
    expect(parseGridPrefs('{"slots":1.5}').slots).toBe('auto');
    expect(gridDensityForCount(1)).toBe('solo');
    expect(gridDensityForCount(2)).toBe('solo');
    expect(gridDensityForCount(3)).toBe('standard');
    expect(gridDensityForCount(6)).toBe('standard');
    expect(gridDensityForCount(7)).toBe('compact');
    expect(gridDensityForCount(12)).toBe('compact');
    // Requesting many slots doesn't shrink a session list of only two agents.
    expect(resolveGridLayout(2, 960, 640, 12)).toMatchObject({ columns: 2, visibleRows: 1, capacity: 2 });
    expect(resolveGridLayout(1, 960, 640, 12)).toMatchObject({ columns: 1, visibleRows: 1, capacity: 1 });
  });

  it('shows a bounded prose-only excerpt in solo cards, without dumping HTML into Home', () => {
    expect(monitorResponseExcerpt('Here is the page.\n```html\n<div>Ignore markup</div>\n```\nIt is ready.')).toBe(
      'Here is the page. It is ready.'
    );
    expect(monitorResponseExcerpt('x'.repeat(600)).length).toBe(340);
    expect(monitorResponseExcerpt(undefined)).toBe('');
  });

  it('labels a workspace by its last folder', () => {
    expect(workspaceLabel('C:/work/acme/')).toBe('acme');
    expect(workspaceLabel('/home/me/site')).toBe('site');
    expect(workspaceLabel(undefined)).toBe('');
  });
});
