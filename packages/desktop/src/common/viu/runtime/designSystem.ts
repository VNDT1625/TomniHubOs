/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ViuBindableProperty,
  ViuBreakpoint,
  ViuId,
  ViuLegacyVariable,
  ViuMatrix2D,
  ViuNode,
  ViuProjectState,
  ViuVariable,
  ViuVariableAlias,
  ViuVariableScalar,
  ViuVariableType,
} from '../types';

export const VIU_DEFAULT_BREAKPOINTS: Record<ViuId, ViuBreakpoint> = {
  desktop: { id: 'desktop', name: 'Desktop', preset: 'desktop', minWidth: 1024 },
  tablet: { id: 'tablet', name: 'Tablet', preset: 'tablet', minWidth: 768, maxWidth: 1023 },
  mobile: { id: 'mobile', name: 'Mobile', preset: 'mobile', minWidth: 0, maxWidth: 767 },
};

export const VIU_DEFAULT_SNAP_SETTINGS = {
  enabled: true,
  pixelGrid: 1,
  threshold: 6,
  snapToGuides: true,
  snapToObjects: true,
} as const;

const LEGACY_COLLECTION_ID = 'viu-legacy-variables';
const LEGACY_MODE_ID = 'viu-mode-default';

export type ViuVariableResolution = {
  variableId: ViuId;
  modeId: ViuId;
  type: ViuVariableType;
  value: ViuVariableScalar;
  aliasPath: ViuId[];
};

export type ViuResolvedProperty = {
  property: ViuBindableProperty;
  source: 'base' | 'breakpoint' | 'variable';
  value: unknown;
  breakpointId?: ViuId;
  variableId?: ViuId;
  modeId?: ViuId;
};

export type ViuResolvedNode = {
  node: ViuNode;
  breakpoint: ViuBreakpoint | null;
  properties: ViuResolvedProperty[];
};

export type ViuSnapCandidate = { axis: 'x' | 'y'; position: number; source: 'grid' | 'guide' | 'object'; id?: ViuId };
export type ViuSnapResult = { x: number; y: number; matches: ViuSnapCandidate[] };

const isAlias = (value: unknown): value is ViuVariableAlias =>
  Boolean(value && typeof value === 'object' && (value as { type?: unknown }).type === 'alias');

export const isViuVariable = (variable: ViuVariable | ViuLegacyVariable): variable is ViuVariable =>
  'collectionId' in variable && 'valuesByMode' in variable;

const variableValueMatchesType = (type: ViuVariableType, value: unknown): value is ViuVariableScalar => {
  if (type === 'color' || type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === 'boolean';
};

const legacyVariableType = (variable: ViuLegacyVariable): ViuVariableType => {
  if (
    variable.type === 'string' &&
    typeof variable.value === 'string' &&
    /^#|rgb|hsl|oklch|var\(/i.test(variable.value)
  ) {
    return 'color';
  }
  return variable.type;
};

/** Upgrades legacy VIU v2 design-system fields without mutating the input. */
export function normalizeViuDesignSystem(project: ViuProjectState): ViuProjectState {
  const normalized = structuredClone(project);
  const legacyVariables = Object.values(normalized.variables).filter(
    (variable): variable is ViuLegacyVariable => !isViuVariable(variable)
  );
  const collections = { ...normalized.variableCollections };

  if (legacyVariables.length > 0 && !collections[LEGACY_COLLECTION_ID]) {
    collections[LEGACY_COLLECTION_ID] = {
      id: LEGACY_COLLECTION_ID,
      name: 'Legacy variables',
      defaultModeId: LEGACY_MODE_ID,
      modeIds: [LEGACY_MODE_ID],
      modes: {
        [LEGACY_MODE_ID]: { id: LEGACY_MODE_ID, name: 'Default', kind: 'custom' },
      },
    };
  }

  normalized.variables = Object.fromEntries(
    Object.values(normalized.variables).map((variable) => {
      if (isViuVariable(variable)) return [variable.id, variable];
      const scalar =
        typeof variable.value === 'string' || typeof variable.value === 'number' || typeof variable.value === 'boolean'
          ? variable.value
          : String(variable.value ?? '');
      const next: ViuVariable = {
        id: variable.id,
        name: variable.name,
        collectionId: LEGACY_COLLECTION_ID,
        type: legacyVariableType(variable),
        valuesByMode: { [LEGACY_MODE_ID]: scalar },
      };
      return [next.id, next];
    })
  );
  normalized.schemaVersion = 3;
  normalized.variableCollections = collections;
  normalized.activeVariableModes = { ...normalized.activeVariableModes };
  normalized.breakpoints = structuredClone(normalized.breakpoints ?? VIU_DEFAULT_BREAKPOINTS);
  normalized.guides = structuredClone(normalized.guides ?? []);
  normalized.snapSettings = { ...VIU_DEFAULT_SNAP_SETTINGS, ...normalized.snapSettings };
  return normalized;
}

const modeForVariable = (project: ViuProjectState, variable: ViuVariable, requestedModeId?: ViuId): ViuId => {
  const collection = project.variableCollections?.[variable.collectionId];
  if (!collection) throw new Error(`Variable ${variable.id} references missing collection ${variable.collectionId}.`);
  const modeId = requestedModeId ?? project.activeVariableModes?.[collection.id] ?? collection.defaultModeId;
  if (!collection.modes[modeId]) throw new Error(`Mode ${modeId} does not belong to collection ${collection.id}.`);
  return modeId;
};

/** Resolves a typed variable and its alias chain deterministically for the active collection modes. */
export function resolveViuVariable(
  project: ViuProjectState,
  variableId: ViuId,
  requestedModeId?: ViuId,
  stack: ViuId[] = []
): ViuVariableResolution {
  const raw = project.variables[variableId];
  if (!raw) throw new Error(`Variable ${variableId} does not exist.`);
  if (!isViuVariable(raw))
    return resolveViuVariable(normalizeViuDesignSystem(project), variableId, requestedModeId, stack);
  if (stack.includes(variableId)) throw new Error(`Variable alias cycle: ${[...stack, variableId].join(' -> ')}.`);

  const modeId = modeForVariable(project, raw, requestedModeId);
  const collection = project.variableCollections![raw.collectionId]!;
  const value = raw.valuesByMode[modeId] ?? raw.valuesByMode[collection.defaultModeId];
  if (value === undefined)
    throw new Error(`Variable ${variableId} has no value for mode ${modeId} or its default mode.`);
  if (isAlias(value)) {
    const targetRaw = project.variables[value.variableId];
    const targetModeId =
      targetRaw && isViuVariable(targetRaw) && targetRaw.collectionId === raw.collectionId ? modeId : undefined;
    const target = resolveViuVariable(project, value.variableId, targetModeId, [...stack, variableId]);
    if (target.type !== raw.type) {
      throw new Error(`Variable ${variableId} cannot alias ${target.variableId} because their types differ.`);
    }
    return { ...target, variableId, modeId, aliasPath: [variableId, ...target.aliasPath] };
  }
  if (!variableValueMatchesType(raw.type, value)) {
    throw new Error(`Variable ${variableId} contains an invalid ${raw.type} value in mode ${modeId}.`);
  }
  return { variableId, modeId, type: raw.type, value, aliasPath: [variableId] };
}

const expectedTypeForProperty = (property: ViuBindableProperty): ViuVariableType => {
  if (property === 'style.background' || property === 'style.color' || property === 'style.borderColor') {
    return 'color';
  }
  if (property === 'content.text' || property === 'content.placeholder') return 'string';
  if (property === 'visible') return 'boolean';
  return 'number';
};

const applyProperty = (node: ViuNode, property: ViuBindableProperty, value: ViuVariableScalar): void => {
  const [scope, key] = property.split('.') as [string, string | undefined];
  if (scope === 'style' && key) {
    Object.assign(node.style, { [key]: value });
    return;
  }
  if (scope === 'content' && key) {
    node.content = { ...node.content, [key]: value };
    return;
  }
  if (scope === 'layout' && key) {
    node.layout = {
      mode: 'none',
      gap: 0,
      padding: [0, 0, 0, 0],
      align: 'start',
      justify: 'start',
      wrap: false,
      columns: 2,
      ...node.layout,
      [key]: value,
    };
    return;
  }
  if (scope === 'size' && key) {
    Object.assign(node.size, { [key]: value });
    return;
  }
  if (scope === 'visible') node.visible = Boolean(value);
};

export function selectViuBreakpoint(project: ViuProjectState, viewportWidth: number): ViuBreakpoint | null {
  if (!Number.isFinite(viewportWidth) || viewportWidth < 0) throw new Error('Viewport width must be non-negative.');
  return (
    Object.values(project.breakpoints ?? VIU_DEFAULT_BREAKPOINTS)
      .filter(
        (breakpoint) => viewportWidth >= breakpoint.minWidth && viewportWidth <= (breakpoint.maxWidth ?? Infinity)
      )
      .toSorted((left, right) => right.minWidth - left.minWidth || left.id.localeCompare(right.id))[0] ?? null
  );
}

/** Applies the sparse breakpoint override, then variable bindings, with an inspector-ready provenance trace. */
export function resolveViuNode(
  project: ViuProjectState,
  nodeId: ViuId,
  viewportWidth: number,
  modeOverrides: Record<ViuId, ViuId> = {}
): ViuResolvedNode {
  const normalized = normalizeViuDesignSystem(project);
  normalized.activeVariableModes = { ...normalized.activeVariableModes, ...modeOverrides };
  const source = normalized.nodes[nodeId];
  if (!source) throw new Error(`Node ${nodeId} does not exist.`);
  const node = structuredClone(source);
  const breakpoint = selectViuBreakpoint(normalized, viewportWidth);
  const override = breakpoint ? source.responsiveOverrides?.[breakpoint.id] : undefined;
  const properties: ViuResolvedProperty[] = [];

  if (override) {
    if (override.localTransform) node.localTransform = [...override.localTransform];
    if (override.size) node.size = { ...node.size, ...override.size };
    if (override.sizing) node.sizing = { ...node.sizing, ...override.sizing };
    if (override.constraints) node.constraints = { ...node.constraints, ...override.constraints };
    if (override.layout) {
      node.layout = {
        mode: 'none',
        gap: 0,
        padding: [0, 0, 0, 0],
        align: 'start',
        justify: 'start',
        wrap: false,
        columns: 2,
        ...node.layout,
        ...override.layout,
      };
    }
    if (override.style) node.style = { ...node.style, ...override.style };
    if (override.content) node.content = { ...node.content, ...override.content };
    if (override.visible !== undefined) node.visible = override.visible;
    for (const property of Object.keys(override)) {
      properties.push({
        property: property as ViuBindableProperty,
        source: 'breakpoint',
        value: override[property as keyof typeof override],
        breakpointId: breakpoint!.id,
      });
    }
  }

  for (const [property, binding] of Object.entries(source.variableBindings ?? {})) {
    if (!binding) continue;
    const target = property as ViuBindableProperty;
    const resolved = resolveViuVariable(normalized, binding.variableId, binding.modeId);
    const expected = expectedTypeForProperty(target);
    if (resolved.type !== expected) {
      throw new Error(
        `Property ${target} requires ${expected}, but variable ${binding.variableId} is ${resolved.type}.`
      );
    }
    applyProperty(node, target, resolved.value);
    properties.push({
      property: target,
      source: 'variable',
      value: resolved.value,
      variableId: binding.variableId,
      modeId: resolved.modeId,
    });
  }

  return { node, breakpoint, properties };
}

/** Returns all design-system structural errors, including alias cycles and incompatible bindings. */
export function validateViuDesignSystem(project: ViuProjectState): string[] {
  const normalized = normalizeViuDesignSystem(project);
  const errors: string[] = [];
  for (const [variableKey, variable] of Object.entries(project.variables)) {
    if (variable.id !== variableKey) errors.push(`Variable key ${variableKey} does not match its id ${variable.id}.`);
  }
  const finiteNonNegative = (value: unknown): boolean =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;

  for (const [collectionKey, collection] of Object.entries(normalized.variableCollections ?? {})) {
    if (collection.id !== collectionKey) {
      errors.push(`Variable collection key ${collectionKey} does not match its id ${collection.id}.`);
    }
    if (new Set(collection.modeIds).size !== collection.modeIds.length) {
      errors.push(`Collection ${collection.id} contains duplicate mode ids.`);
    }
    if (!collection.modeIds.includes(collection.defaultModeId) || !collection.modes[collection.defaultModeId]) {
      errors.push(`Collection ${collection.id} has a missing default mode.`);
    }
    for (const modeId of collection.modeIds) {
      const mode = collection.modes[modeId];
      if (!mode) errors.push(`Collection ${collection.id} references missing mode ${modeId}.`);
      else if (mode.id !== modeId) errors.push(`Mode key ${modeId} does not match its id ${mode.id}.`);
    }
    for (const modeId of Object.keys(collection.modes)) {
      if (!collection.modeIds.includes(modeId)) {
        errors.push(`Collection ${collection.id} has unregistered mode ${modeId}.`);
      }
    }
  }

  for (const [collectionId, modeId] of Object.entries(normalized.activeVariableModes ?? {})) {
    const collection = normalized.variableCollections?.[collectionId];
    if (!collection) errors.push(`Active mode references missing collection ${collectionId}.`);
    else if (!collection.modes[modeId])
      errors.push(`Active mode ${modeId} does not belong to collection ${collectionId}.`);
  }

  for (const [variableKey, variable] of Object.entries(normalized.variables)) {
    if (variable.id !== variableKey) errors.push(`Variable key ${variableKey} does not match its id ${variable.id}.`);
    if (!isViuVariable(variable)) continue;
    const collection = normalized.variableCollections?.[variable.collectionId];
    if (!collection) {
      errors.push(`Variable ${variable.id} references missing collection ${variable.collectionId}.`);
      continue;
    }
    for (const modeId of Object.keys(variable.valuesByMode)) {
      if (!collection.modes[modeId]) {
        errors.push(`Variable ${variable.id} contains a value for unknown mode ${modeId}.`);
      }
    }
    try {
      resolveViuVariable(normalized, variable.id);
      for (const modeId of Object.keys(variable.valuesByMode)) {
        if (collection.modes[modeId]) resolveViuVariable(normalized, variable.id, modeId);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Variable ${variable.id} is invalid.`);
    }
  }

  for (const [breakpointKey, breakpoint] of Object.entries(normalized.breakpoints ?? {})) {
    if (breakpoint.id !== breakpointKey) {
      errors.push(`Breakpoint key ${breakpointKey} does not match its id ${breakpoint.id}.`);
    }
    if (
      !finiteNonNegative(breakpoint.minWidth) ||
      (breakpoint.maxWidth !== undefined &&
        (!finiteNonNegative(breakpoint.maxWidth) || breakpoint.maxWidth < breakpoint.minWidth))
    ) {
      errors.push(`Breakpoint ${breakpoint.id} has an invalid width range.`);
    }
  }

  const guideIds = new Set<ViuId>();
  for (const guide of normalized.guides ?? []) {
    if (!guide.id.trim()) errors.push('Guide id is required.');
    if (guideIds.has(guide.id)) errors.push(`Guide ${guide.id} is duplicated.`);
    guideIds.add(guide.id);
    if (guide.axis !== 'horizontal' && guide.axis !== 'vertical') {
      errors.push(`Guide ${guide.id} has an invalid axis.`);
    }
    if (!Number.isFinite(guide.position)) errors.push(`Guide ${guide.id} has an invalid position.`);
  }
  const snap = normalized.snapSettings!;
  if (!finiteNonNegative(snap.pixelGrid) || !finiteNonNegative(snap.threshold)) {
    errors.push('Snap settings require non-negative finite pixel grid and threshold values.');
  }

  for (const node of Object.values(normalized.nodes)) {
    for (const [property, binding] of Object.entries(node.variableBindings ?? {})) {
      if (!binding) continue;
      try {
        const resolved = resolveViuVariable(normalized, binding.variableId, binding.modeId);
        const expected = expectedTypeForProperty(property as ViuBindableProperty);
        if (resolved.type !== expected) {
          errors.push(`Node ${node.id} binding ${property} requires ${expected}, received ${resolved.type}.`);
        }
      } catch (error) {
        errors.push(`Node ${node.id}: ${error instanceof Error ? error.message : 'invalid variable binding'}`);
      }
    }
    for (const [breakpointId, override] of Object.entries(node.responsiveOverrides ?? {})) {
      if (!normalized.breakpoints?.[breakpointId]) {
        errors.push(`Node ${node.id} references missing breakpoint ${breakpointId}.`);
      }
      if (Object.keys(override).length === 0) {
        errors.push(`Node ${node.id} has an empty override for breakpoint ${breakpointId}.`);
      }
      if (override.localTransform && override.localTransform.some((value) => !Number.isFinite(value))) {
        errors.push(`Node ${node.id} has an invalid transform override for breakpoint ${breakpointId}.`);
      }
      if (override.size && Object.values(override.size).some((value) => !finiteNonNegative(value))) {
        errors.push(`Node ${node.id} has an invalid size override for breakpoint ${breakpointId}.`);
      }
      if (
        override.layout &&
        ((override.layout.gap !== undefined && !finiteNonNegative(override.layout.gap)) ||
          (override.layout.columns !== undefined &&
            (!Number.isInteger(override.layout.columns) || override.layout.columns < 1)) ||
          override.layout.padding?.some((value) => !finiteNonNegative(value)))
      ) {
        errors.push(`Node ${node.id} has an invalid layout override for breakpoint ${breakpointId}.`);
      }
      if (
        override.style &&
        ((override.style.opacity !== undefined &&
          (!Number.isFinite(override.style.opacity) || override.style.opacity < 0 || override.style.opacity > 1)) ||
          (override.style.borderRadii !== undefined &&
            override.style.borderRadii.some((value) => !finiteNonNegative(value))))
      ) {
        errors.push(`Node ${node.id} has an invalid style override for breakpoint ${breakpointId}.`);
      }
    }
  }
  return [...new Set(errors)];
}

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Replaces matrix rotation while preserving scale magnitudes, translation and reflection. */
export function withViuRotation(matrix: ViuMatrix2D, degrees: number): ViuMatrix2D {
  if (!Number.isFinite(degrees)) throw new Error('Rotation must be finite.');
  const scaleX = Math.hypot(matrix[0], matrix[1]) || 1;
  const scaleY = Math.hypot(matrix[2], matrix[3]) || 1;
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  const reflectedScaleY = determinant < 0 ? -scaleY : scaleY;
  const angle = radians(degrees);
  return [
    Math.cos(angle) * scaleX,
    Math.sin(angle) * scaleX,
    -Math.sin(angle) * reflectedScaleY,
    Math.cos(angle) * reflectedScaleY,
    matrix[4],
    matrix[5],
  ];
}

export const getViuRotation = (matrix: ViuMatrix2D): number => {
  const value = (Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI;
  return Math.round(value * 1_000) / 1_000;
};

/** Snaps a point to the closest enabled grid, guide or object coordinate on each axis. */
export function snapViuPoint(
  project: ViuProjectState,
  point: { x: number; y: number },
  objectCoordinates: { x?: number[]; y?: number[] } = {}
): ViuSnapResult {
  const settings = { ...VIU_DEFAULT_SNAP_SETTINGS, ...project.snapSettings };
  if (!settings.enabled) return { ...point, matches: [] };
  const candidates: ViuSnapCandidate[] = [];
  if (settings.pixelGrid > 0) {
    candidates.push({
      axis: 'x',
      position: Math.round(point.x / settings.pixelGrid) * settings.pixelGrid,
      source: 'grid',
    });
    candidates.push({
      axis: 'y',
      position: Math.round(point.y / settings.pixelGrid) * settings.pixelGrid,
      source: 'grid',
    });
  }
  if (settings.snapToGuides) {
    for (const guide of project.guides ?? []) {
      candidates.push({
        axis: guide.axis === 'vertical' ? 'x' : 'y',
        position: guide.position,
        source: 'guide',
        id: guide.id,
      });
    }
  }
  if (settings.snapToObjects) {
    for (const position of objectCoordinates.x ?? []) candidates.push({ axis: 'x', position, source: 'object' });
    for (const position of objectCoordinates.y ?? []) candidates.push({ axis: 'y', position, source: 'object' });
  }
  const sourcePriority: Record<ViuSnapCandidate['source'], number> = { guide: 0, object: 1, grid: 2 };
  const closest = (axis: 'x' | 'y', value: number): ViuSnapCandidate | undefined =>
    candidates
      .filter((candidate) => candidate.axis === axis && Math.abs(candidate.position - value) <= settings.threshold)
      .toSorted(
        (left, right) =>
          Number(left.source === 'grid') - Number(right.source === 'grid') ||
          Math.abs(left.position - value) - Math.abs(right.position - value) ||
          sourcePriority[left.source] - sourcePriority[right.source] ||
          left.position - right.position
      )[0];
  const x = closest('x', point.x);
  const y = closest('y', point.y);
  return {
    x: x?.position ?? point.x,
    y: y?.position ?? point.y,
    matches: [x, y].filter(Boolean) as ViuSnapCandidate[],
  };
}
