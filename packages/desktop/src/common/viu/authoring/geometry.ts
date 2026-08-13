/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ViuId, ViuMatrix2D, ViuNode, ViuProjectState } from '../types';
import type { ViuRect } from './types';

export const multiplyViuMatrices = (left: ViuMatrix2D, right: ViuMatrix2D): ViuMatrix2D => {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
};

export const translateViuMatrix = (matrix: ViuMatrix2D, x: number, y: number): ViuMatrix2D => [
  matrix[0],
  matrix[1],
  matrix[2],
  matrix[3],
  matrix[4] + x,
  matrix[5] + y,
];

const transformPoint = (matrix: ViuMatrix2D, x: number, y: number): { x: number; y: number } => ({
  x: matrix[0] * x + matrix[2] * y + matrix[4],
  y: matrix[1] * x + matrix[3] * y + matrix[5],
});

export const getViuBoundsInParent = (node: ViuNode): ViuRect => {
  const points = [
    transformPoint(node.localTransform, 0, 0),
    transformPoint(node.localTransform, node.size.width, 0),
    transformPoint(node.localTransform, 0, node.size.height),
    transformPoint(node.localTransform, node.size.width, node.size.height),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

export const getViuWorldMatrix = (state: ViuProjectState, nodeId: ViuId): ViuMatrix2D => {
  const visited = new Set<ViuId>();
  const visit = (currentId: ViuId): ViuMatrix2D => {
    if (visited.has(currentId)) throw new Error(`Node ${currentId} has a cyclic parent chain.`);
    visited.add(currentId);
    const node = state.nodes[currentId];
    if (!node) throw new Error(`Node ${currentId} does not exist.`);
    if (node.parentId === null) return node.localTransform;
    return multiplyViuMatrices(visit(node.parentId), node.localTransform);
  };
  return visit(nodeId);
};

export const getViuWorldBounds = (state: ViuProjectState, nodeId: ViuId): ViuRect => {
  const node = state.nodes[nodeId];
  if (!node) throw new Error(`Node ${nodeId} does not exist.`);
  const worldNode = { ...node, localTransform: getViuWorldMatrix(state, nodeId) };
  return getViuBoundsInParent(worldNode);
};

export const normalizeViuRect = (rect: ViuRect): ViuRect => ({
  x: rect.width < 0 ? rect.x + rect.width : rect.x,
  y: rect.height < 0 ? rect.y + rect.height : rect.y,
  width: Math.abs(rect.width),
  height: Math.abs(rect.height),
});

export const viuRectContains = (outer: ViuRect, inner: ViuRect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

export const viuRectsIntersect = (left: ViuRect, right: ViuRect): boolean =>
  left.x <= right.x + right.width &&
  left.x + left.width >= right.x &&
  left.y <= right.y + right.height &&
  left.y + left.height >= right.y;

export const isViuDescendantOf = (state: ViuProjectState, nodeId: ViuId, ancestorId: ViuId): boolean => {
  let current = state.nodes[nodeId]?.parentId ?? null;
  const visited = new Set<ViuId>();
  while (current !== null) {
    if (current === ancestorId) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    current = state.nodes[current]?.parentId ?? null;
  }
  return false;
};
