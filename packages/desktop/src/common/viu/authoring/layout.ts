/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizeViuImageTransform, validateViuImageTransform } from '../graphics/image';
import type {
  ViuBindableProperty,
  ViuBreakpoint,
  ViuCommand,
  ViuGuide,
  ViuLayoutContainer,
  ViuProjectState,
  ViuResponsiveNodeOverride,
  ViuSnapSettings,
  ViuVariableBinding,
} from '../types';
import { withViuRotation } from '../runtime/designSystem';
import { normalizeViuSelection } from './selection';
import type { ViuAuthoringBatch, ViuImageTransformPatch, ViuLayoutPatch, ViuSelection } from './types';

const requireRange = (name: string, value: number | undefined, minimum: number, maximum: number): void => {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
};

const defaultLayout = (): ViuLayoutContainer => ({
  mode: 'none',
  gap: 0,
  padding: [0, 0, 0, 0],
  align: 'start',
  justify: 'start',
  wrap: false,
  columns: 2,
});

const validateLayoutPatch = (patch: ViuLayoutPatch): void => {
  if (Object.keys(patch).length === 0) throw new Error('Layout patch cannot be empty.');
  requireRange('Gap', patch.layout?.gap, 0, 100_000);
  for (const [index, value] of (patch.layout?.padding ?? []).entries()) {
    requireRange(`Padding ${index}`, value, 0, 100_000);
  }
  requireRange('Grid columns', patch.layout?.columns, 1, 64);
  requireRange('Minimum width', patch.sizing?.minWidth, 0, 1_000_000);
  requireRange('Maximum width', patch.sizing?.maxWidth, 0, 1_000_000);
  requireRange('Minimum height', patch.sizing?.minHeight, 0, 1_000_000);
  requireRange('Maximum height', patch.sizing?.maxHeight, 0, 1_000_000);
  requireRange('Rotation', patch.rotation, -360_000, 360_000);
  for (const [index, value] of (patch.borderRadii ?? []).entries()) {
    requireRange(`Corner radius ${index}`, value, 0, 1_000_000);
  }
};

/** Applies responsive container, sizing and constraint properties as one atomic authoring batch. */
export const createLayoutViuBatch = (
  state: ViuProjectState,
  selection: ViuSelection,
  patch: ViuLayoutPatch
): ViuAuthoringBatch => {
  validateLayoutPatch(patch);
  const nodes = normalizeViuSelection(state, selection.nodeIds, { includeHidden: true }).nodeIds.map(
    (nodeId) => state.nodes[nodeId]!
  );
  if (nodes.length === 0) throw new Error('Layout authoring requires at least one node.');

  const commands = nodes.map((node): ViuCommand => {
    const nextLayout = patch.layout ? { ...(node.layout ?? defaultLayout()), ...patch.layout } : node.layout;
    const variableBindings = { ...node.variableBindings };
    for (const [property, binding] of Object.entries(patch.variableBindings ?? {})) {
      if (binding === null) delete variableBindings[property as ViuBindableProperty];
      else if (binding) variableBindings[property as ViuBindableProperty] = binding;
    }
    return {
      type: 'updateNode',
      nodeId: node.id,
      patch: {
        ...(nextLayout ? { layout: nextLayout } : {}),
        sizing: { ...node.sizing, ...patch.sizing },
        constraints: { ...node.constraints, ...patch.constraints },
        positionMode: patch.positionMode ?? node.positionMode,
        ...(patch.rotation !== undefined
          ? { localTransform: withViuRotation(node.localTransform, patch.rotation) }
          : {}),
        ...(patch.borderRadii || patch.strokeAlignment
          ? {
              style: {
                ...node.style,
                ...(patch.borderRadii ? { borderRadii: patch.borderRadii } : {}),
                ...(patch.strokeAlignment ? { strokeAlignment: patch.strokeAlignment } : {}),
              },
            }
          : {}),
        ...(patch.variableBindings ? { variableBindings } : {}),
      },
    };
  });
  return { intent: 'layout', commands, nextSelection: selection };
};

/** Applies crop, fit, focal point, rotation and flips to selected image nodes atomically. */
export const createImageTransformViuBatch = (
  state: ViuProjectState,
  selection: ViuSelection,
  patch: ViuImageTransformPatch
): ViuAuthoringBatch => {
  if (Object.keys(patch).length === 0) throw new Error('Image transform patch cannot be empty.');
  const nodes = normalizeViuSelection(state, selection.nodeIds, { includeHidden: true }).nodeIds.map(
    (nodeId) => state.nodes[nodeId]!
  );
  if (nodes.length === 0) throw new Error('Image transform authoring requires at least one node.');
  if (nodes.some((node) => node.type !== 'image'))
    throw new Error('Image transform authoring only accepts image nodes.');
  const commands: ViuCommand[] = nodes.map((node) => {
    const next = normalizeViuImageTransform({
      ...node.imageTransform,
      ...patch,
      crop: { ...node.imageTransform?.crop, ...patch.crop },
      focalPoint: { ...node.imageTransform?.focalPoint, ...patch.focalPoint },
    });
    const error = validateViuImageTransform(next);
    if (error) throw new Error(`Image node ${node.id} ${error}`);
    return { type: 'updateNode', nodeId: node.id, patch: { imageTransform: next } };
  });
  return { intent: 'image-transform', commands, nextSelection: selection };
};

/** Stores one sparse breakpoint override per selected node. */
export const createResponsiveViuBatch = (
  state: ViuProjectState,
  selection: ViuSelection,
  breakpointId: string,
  override: ViuResponsiveNodeOverride
): ViuAuthoringBatch => {
  if (!state.breakpoints?.[breakpointId]) throw new Error(`Breakpoint ${breakpointId} does not exist.`);
  if (Object.keys(override).length === 0) throw new Error('Responsive override cannot be empty.');
  const nodes = normalizeViuSelection(state, selection.nodeIds, { includeHidden: true }).nodeIds.map(
    (nodeId) => state.nodes[nodeId]!
  );
  if (nodes.length === 0) throw new Error('Responsive authoring requires at least one node.');
  const commands: ViuCommand[] = nodes.map((node) => ({
    type: 'updateNode',
    nodeId: node.id,
    patch: {
      responsiveOverrides: {
        ...node.responsiveOverrides,
        [breakpointId]: {
          ...node.responsiveOverrides?.[breakpointId],
          ...override,
          ...(override.size ? { size: { ...node.responsiveOverrides?.[breakpointId]?.size, ...override.size } } : {}),
          ...(override.sizing
            ? { sizing: { ...node.responsiveOverrides?.[breakpointId]?.sizing, ...override.sizing } }
            : {}),
          ...(override.constraints
            ? {
                constraints: {
                  ...node.responsiveOverrides?.[breakpointId]?.constraints,
                  ...override.constraints,
                },
              }
            : {}),
          ...(override.layout
            ? { layout: { ...node.responsiveOverrides?.[breakpointId]?.layout, ...override.layout } }
            : {}),
          ...(override.style
            ? { style: { ...node.responsiveOverrides?.[breakpointId]?.style, ...override.style } }
            : {}),
          ...(override.content
            ? { content: { ...node.responsiveOverrides?.[breakpointId]?.content, ...override.content } }
            : {}),
        },
      },
    },
  }));
  return { intent: 'responsive', commands, nextSelection: selection };
};

/** Binds or unbinds one typed property across the selected nodes. */
export const createVariableBindingViuBatch = (
  state: ViuProjectState,
  selection: ViuSelection,
  property: ViuBindableProperty,
  binding: ViuVariableBinding | null
): ViuAuthoringBatch => createLayoutViuBatch(state, selection, { variableBindings: { [property]: binding } });

export const createVariableModeViuBatch = (
  state: ViuProjectState,
  collectionId: string,
  modeId: string | null
): ViuAuthoringBatch => {
  const collection = state.variableCollections?.[collectionId];
  if (!collection) throw new Error(`Variable collection ${collectionId} does not exist.`);
  if (modeId !== null && !collection.modes[modeId]) {
    throw new Error(`Mode ${modeId} does not belong to collection ${collectionId}.`);
  }
  return {
    intent: 'design-system',
    commands: [{ type: 'setVariableMode', collectionId, modeId }],
  };
};

export const createBreakpointViuBatch = (breakpoint: ViuBreakpoint): ViuAuthoringBatch => {
  if (!breakpoint.id.trim() || !breakpoint.name.trim()) throw new Error('Breakpoint id and name are required.');
  if (
    !Number.isFinite(breakpoint.minWidth) ||
    breakpoint.minWidth < 0 ||
    (breakpoint.maxWidth !== undefined &&
      (!Number.isFinite(breakpoint.maxWidth) || breakpoint.maxWidth < breakpoint.minWidth))
  ) {
    throw new Error(`Breakpoint ${breakpoint.id} has an invalid width range.`);
  }
  return { intent: 'responsive', commands: [{ type: 'upsertBreakpoint', breakpoint }] };
};

export const createDeleteBreakpointViuBatch = (state: ViuProjectState, breakpointId: string): ViuAuthoringBatch => {
  if (!state.breakpoints?.[breakpointId]) throw new Error(`Breakpoint ${breakpointId} does not exist.`);
  if (Object.values(state.nodes).some((node) => node.responsiveOverrides?.[breakpointId])) {
    throw new Error(`Breakpoint ${breakpointId} still has node overrides.`);
  }
  return { intent: 'responsive', commands: [{ type: 'deleteBreakpoint', breakpointId }] };
};

export const createSnapSettingsViuBatch = (settings: ViuSnapSettings | null): ViuAuthoringBatch => {
  if (
    settings &&
    (!Number.isFinite(settings.pixelGrid) ||
      settings.pixelGrid < 0 ||
      !Number.isFinite(settings.threshold) ||
      settings.threshold < 0)
  ) {
    throw new Error('Snap settings require non-negative finite pixel grid and threshold values.');
  }
  return {
    intent: 'precision',
    commands: [{ type: 'setSnapSettings', settings }],
  };
};

export const createGuidesViuBatch = (guides: ViuGuide[]): ViuAuthoringBatch => {
  const ids = new Set<string>();
  for (const guide of guides) {
    if (!guide.id.trim()) throw new Error('Guide id is required.');
    if (ids.has(guide.id)) throw new Error(`Guide ${guide.id} is duplicated.`);
    ids.add(guide.id);
    if (!Number.isFinite(guide.position)) throw new Error(`Guide ${guide.id} position must be finite.`);
  }
  return { intent: 'precision', commands: [{ type: 'setGuides', guides }] };
};
