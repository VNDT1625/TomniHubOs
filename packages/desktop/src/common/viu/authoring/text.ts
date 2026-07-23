/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ViuCommand, ViuNode, ViuProjectState } from '../types';

import { resolveViuComponentInstance } from '../components';

import { validateViuNodeStyle } from '../graphics/styles';
import { normalizeViuSelection } from './selection';
import type {
  ViuAppearancePatch,
  ViuAuthoringBatch,
  ViuAuthoringNodeStyle,
  ViuSelection,
  ViuTypographyPatch,
} from './types';

export type ViuMixedValue<T> = { kind: 'empty' } | { kind: 'mixed' } | { kind: 'value'; value: T };

export const getViuMixedValue = <T>(nodes: readonly ViuNode[], read: (node: ViuNode) => T): ViuMixedValue<T> => {
  if (nodes.length === 0) return { kind: 'empty' };
  const first = read(nodes[0]!);
  return nodes.every((node) => Object.is(read(node), first)) ? { kind: 'value', value: first } : { kind: 'mixed' };
};

export const getViuTextNodes = (state: ViuProjectState, selection: ViuSelection): ViuNode[] =>
  normalizeViuSelection(state, selection.nodeIds, { includeHidden: true })
    .nodeIds.map((nodeId) => state.nodes[nodeId])
    .filter((node): node is ViuNode => Boolean(node && (node.type === 'text' || node.type === 'control')));

export const getViuTypographyNodes = (state: ViuProjectState, selection: ViuSelection): ViuNode[] =>
  normalizeViuSelection(state, selection.nodeIds, { includeHidden: true })
    .nodeIds.map((nodeId) => state.nodes[nodeId])
    .filter((node): node is ViuNode => {
      if (!node) return false;
      if (node.type === 'text' || node.type === 'control') return true;
      const resolved = node.componentInstance ? resolveViuComponentInstance(state, node) : undefined;
      const root = resolved?.nodes[resolved.rootId];
      return root?.type === 'text' || root?.type === 'control';
    });

const requireTextNodes = (state: ViuProjectState, selection: ViuSelection): ViuNode[] => {
  const nodes = getViuTextNodes(state, selection);
  if (nodes.length === 0) throw new Error('Text authoring requires at least one text or control node.');
  return nodes;
};

const requireFiniteRange = (name: string, value: number | undefined, minimum: number, maximum: number): void => {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
};

const validateTypography = (patch: ViuTypographyPatch): void => {
  if (Object.keys(patch).length === 0) throw new Error('Typography patch cannot be empty.');
  if (patch.fontFamily !== undefined && patch.fontFamily.trim().length === 0) {
    throw new Error('Font family cannot be empty.');
  }
  requireFiniteRange('Font size', patch.fontSize, 1, 1_000);
  requireFiniteRange('Font weight', patch.fontWeight, 1, 1_000);
  requireFiniteRange('Line height', patch.lineHeight, 0.01, 100);
  requireFiniteRange('Letter spacing', patch.letterSpacing, -1_000, 1_000);
  if (patch.fontStyle !== undefined && !['normal', 'italic', 'oblique'].includes(patch.fontStyle)) {
    throw new Error('Font style is invalid.');
  }
  if (
    patch.textDecoration !== undefined &&
    !['none', 'underline', 'line-through', 'underline line-through'].includes(patch.textDecoration)
  ) {
    throw new Error('Text decoration is invalid.');
  }
  if (
    patch.textTransform !== undefined &&
    !['none', 'uppercase', 'lowercase', 'capitalize'].includes(patch.textTransform)
  ) {
    throw new Error('Text transform is invalid.');
  }
};

/** Replaces selected text/control content through full, non-destructive content patches. */
export const createTextContentViuBatch = (
  state: ViuProjectState,
  selection: ViuSelection,
  text: string
): ViuAuthoringBatch => {
  const nodes = requireTextNodes(state, selection);
  return {
    intent: 'text-content',
    commands: nodes.map(
      (node): ViuCommand => ({
        type: 'updateNode',
        nodeId: node.id,
        patch: { content: { ...node.content, text } },
      })
    ),
    nextSelection: selection,
  };
};

/** Applies typography to every selected text/control node while retaining unrelated style fields. */
export const createTypographyViuBatch = (
  state: ViuProjectState,
  selection: ViuSelection,
  patch: ViuTypographyPatch
): ViuAuthoringBatch => {
  validateTypography(patch);
  const nodes = getViuTypographyNodes(state, selection);
  if (nodes.length === 0) throw new Error('Typography authoring requires at least one text or control node.');
  return {
    intent: 'typography',
    commands: nodes.map((node): ViuCommand => {
      const style: ViuAuthoringNodeStyle = { ...(node.style as ViuAuthoringNodeStyle), ...patch };
      return {
        type: 'updateNode',
        nodeId: node.id,
        patch: node.componentInstance
          ? {
              componentInstance: {
                ...node.componentInstance,
                styleOverrides: { ...node.componentInstance.styleOverrides, ...patch },
              },
            }
          : { style },
      };
    }),
    nextSelection: selection,
  };
};

/** Applies existing appearance fields in one bulk command batch. */
export const createAppearanceViuBatch = (
  state: ViuProjectState,
  selection: ViuSelection,
  patch: ViuAppearancePatch
): ViuAuthoringBatch => {
  if (Object.keys(patch).length === 0) throw new Error('Appearance patch cannot be empty.');
  const structuredError = validateViuNodeStyle({ fills: patch.fills, effects: patch.effects }, true);
  if (structuredError) throw new Error(`Appearance ${structuredError}`);
  requireFiniteRange('Opacity', patch.opacity, 0, 1);
  requireFiniteRange('Border radius', patch.borderRadius, 0, 100_000);

  requireFiniteRange('Border width', patch.borderWidth, 0, 10_000);

  requireFiniteRange('Blur', patch.blur, 0, 200);
  requireFiniteRange('Backdrop blur', patch.backdropBlur, 0, 200);
  if (patch.borderStyle !== undefined && !['none', 'solid', 'dashed', 'dotted', 'double'].includes(patch.borderStyle)) {
    throw new Error('Border style is invalid.');
  }
  if (patch.background !== undefined && (patch.background.trim().length === 0 || patch.background.length > 10_000)) {
    throw new Error('Background must be a non-empty CSS value shorter than 10,000 characters.');
  }
  if (patch.shadow !== undefined && patch.shadow.length > 20_000) {
    throw new Error('Shadow must be shorter than 20,000 characters.');
  }
  const nodes = normalizeViuSelection(state, selection.nodeIds, { includeHidden: true }).nodeIds.map(
    (nodeId) => state.nodes[nodeId]!
  );
  if (nodes.length === 0) throw new Error('Appearance authoring requires at least one node.');
  return {
    intent: 'appearance',
    commands: nodes.map(
      (node): ViuCommand => ({
        type: 'updateNode',
        nodeId: node.id,
        patch: node.componentInstance
          ? {
              componentInstance: {
                ...node.componentInstance,
                styleOverrides: { ...node.componentInstance.styleOverrides, ...patch },
              },
            }
          : { style: { ...node.style, ...patch } },
      })
    ),
    nextSelection: selection,
  };
};
