/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ViuId, ViuProjectState } from '../types';
import { getViuWorldBounds, isViuDescendantOf, normalizeViuRect, viuRectContains, viuRectsIntersect } from './geometry';
import type { ViuMarqueeMode, ViuRect, ViuSelection, ViuSelectionPolicy } from './types';

const canSelect = (state: ViuProjectState, nodeId: ViuId, policy: ViuSelectionPolicy): boolean => {
  const node = state.nodes[nodeId];
  if (!node) return false;
  if (!policy.includeHidden && !node.visible) return false;
  if (!policy.includeLocked && node.locked) return false;
  return true;
};

export const normalizeViuSelection = (
  state: ViuProjectState,
  nodeIds: readonly ViuId[],
  policy: ViuSelectionPolicy = {}
): ViuSelection => {
  const uniqueIds = [...new Set(nodeIds)].filter((nodeId) => canSelect(state, nodeId, policy));
  return { nodeIds: uniqueIds, anchorId: uniqueIds.at(-1) ?? null };
};

export const replaceViuSelection = (
  state: ViuProjectState,
  nodeIds: readonly ViuId[],
  policy?: ViuSelectionPolicy
): ViuSelection => normalizeViuSelection(state, nodeIds, policy);

export const toggleViuSelectionNode = (
  state: ViuProjectState,
  selection: ViuSelection,
  nodeId: ViuId,
  policy: ViuSelectionPolicy = {}
): ViuSelection => {
  if (!canSelect(state, nodeId, policy)) return selection;
  const nextIds = selection.nodeIds.includes(nodeId)
    ? selection.nodeIds.filter((selectedId) => selectedId !== nodeId)
    : [...selection.nodeIds, nodeId];
  return { nodeIds: nextIds, anchorId: nextIds.at(-1) ?? null };
};

export const getTopLevelViuSelection = (state: ViuProjectState, nodeIds: readonly ViuId[]): ViuId[] => {
  const selected = new Set(nodeIds.filter((nodeId) => Boolean(state.nodes[nodeId])));
  return [...selected].filter((nodeId) => {
    let parentId = state.nodes[nodeId]?.parentId ?? null;
    const visited = new Set<ViuId>();
    while (parentId !== null) {
      if (selected.has(parentId)) return false;
      if (visited.has(parentId)) return false;
      visited.add(parentId);
      parentId = state.nodes[parentId]?.parentId ?? null;
    }
    return true;
  });
};

type ViuMarqueeSelectionOptions = {
  mode?: ViuMarqueeMode;
  scopeId?: ViuId;
  includeNested?: boolean;
  policy?: ViuSelectionPolicy;
};

export const createViuMarqueeSelection = (
  state: ViuProjectState,
  marquee: ViuRect,
  options: ViuMarqueeSelectionOptions = {}
): ViuSelection => {
  const normalizedMarquee = normalizeViuRect(marquee);
  const mode = options.mode ?? 'intersects';
  const policy = options.policy ?? {};
  const matches = Object.values(state.nodes)
    .filter((node) => node.parentId !== null)
    .filter((node) => {
      if (!options.scopeId) return true;
      if (options.includeNested) return isViuDescendantOf(state, node.id, options.scopeId);
      return node.parentId === options.scopeId;
    })
    .filter((node) => canSelect(state, node.id, policy))
    .filter((node) => {
      const bounds = getViuWorldBounds(state, node.id);
      return mode === 'contains'
        ? viuRectContains(normalizedMarquee, bounds)
        : viuRectsIntersect(normalizedMarquee, bounds);
    })
    .map((node) => node.id);
  return normalizeViuSelection(state, matches, policy);
};
