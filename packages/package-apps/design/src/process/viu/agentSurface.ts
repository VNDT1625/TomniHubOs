/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  resolveViuComponentInstance,
  validateViuProject,
  type ViuDiagnostic,
  type ViuMatrix2D,
  type ViuNode,
  type ViuNodeStyle,
  type ViuProjectState,
} from '@/common/viu';
import {
  compileViuSite,
  createViuRuntimeState,
  reduceViuRuntime,
  resolveViuNode,
  type ViuRuntimeContract,
  type ViuRuntimeEvent,
  type ViuRuntimeState,
} from '@/common/viu/runtime';

const ID_LIMIT = 100;
const QUERY_RESULT_LIMIT = 200;
const RUNTIME_EVENT_LIMIT = 64;
const CONTRACT_ENTITY_LIMIT = 1_000;
const idSchema = z.string().trim().min(1).max(256);
const finiteIntegerSchema = z.number().int().finite();
const finiteNumberSchema = z.number().finite();
const boundedJsonValueSchema = z.unknown().refine((value) => {
  try {
    const serialized = JSON.stringify(value);
    return serialized !== undefined && serialized.length <= 16_384;
  } catch {
    return false;
  }
}, 'A value must be JSON-serializable and no larger than 16 KiB.');
const nodeTypeSchema = z.enum([
  'frame',
  'group',
  'text',
  'vector',
  'image',
  'video',
  'audio',
  'control',
  'component-instance',
  'repeater',
  'model-3d',
  'runtime-surface',
  'hotspot',
]);
const sourceSchema = z.enum(['user', 'agent', 'import', 'starter']);
const qualityCodeSchema = z.enum([
  'missing-interactive-label',
  'missing-image-label',
  'missing-heading-level',
  'empty-heading',
  'skipped-heading-level',
  'low-text-contrast',
  'keyboard-inaccessible-interaction',
  'hover-only-interaction',
  'content-overflow',
  'clipped-content',
]);

export const viuQuerySchema = z
  .object({
    nodeIds: z.array(idSchema).min(1).max(ID_LIMIT).optional(),
    nodeTypes: z.array(nodeTypeSchema).min(1).max(14).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    nameMatch: z.enum(['contains', 'exact']).optional(),
    source: sourceSchema.optional(),
    descendantsOf: idSchema.optional(),
    includeDescendants: z.boolean().optional(),
    hasImageTransform: z.boolean().optional(),
    hasStructuredStrokes: z.boolean().optional(),
    hasScrollBinding: z.boolean().optional(),
    hasTimelineTrack: z.boolean().optional(),
    qualityCodes: z.array(qualityCodeSchema).min(1).max(10).optional(),
    viewportWidth: finiteNumberSchema.min(0).max(1_000_000).optional(),
    modeOverrides: z
      .record(idSchema)
      .refine((modes) => Object.keys(modes).length <= 100, 'At most 100 variable mode overrides are allowed.')
      .optional(),
    limit: finiteIntegerSchema.min(1).max(QUERY_RESULT_LIMIT).optional(),
  })
  .strict();

const runtimeMotionSchema = z
  .object({
    preset: z.enum([
      'none',
      'fade',
      'rise',
      'scale',
      'slide-left',
      'slide-right',
      'blur-in',
      'reveal',
      'smart-animate',
    ]),
    trigger: z.enum(['load', 'in-view', 'hover', 'click']),
    durationMs: finiteIntegerSchema.min(0).max(60_000),
    delayMs: finiteIntegerSchema.min(0).max(60_000).optional(),
    easing: z.enum(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'spring-soft']).optional(),
    iterationCount: finiteIntegerSchema.min(1).max(100).optional(),
  })
  .strict();

const runtimeConditionSchema = z
  .object({
    variableId: idSchema,
    operator: z.enum(['eq', 'neq', 'truthy', 'falsy', 'gt', 'gte', 'lt', 'lte']),
    value: boundedJsonValueSchema.optional(),
  })
  .strict();

const runtimeActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), targetScreenId: idSchema }).strict(),
  z.object({ type: z.literal('openOverlay'), targetNodeId: idSchema }).strict(),
  z.object({ type: z.literal('closeOverlay'), targetNodeId: idSchema.optional() }).strict(),
  z.object({ type: z.literal('scrollTo'), targetNodeId: idSchema }).strict(),
  z.object({ type: z.literal('setVariable'), variableId: idSchema, value: boundedJsonValueSchema }).strict(),
  z.object({ type: z.literal('toggleVariable'), variableId: idSchema }).strict(),
  z.object({ type: z.literal('playTimeline'), timelineId: idSchema }).strict(),
  z.object({ type: z.literal('pauseTimeline'), timelineId: idSchema }).strict(),
  z
    .object({
      type: z.literal('seekTimeline'),
      timelineId: idSchema,
      offsetMs: finiteIntegerSchema.min(0).max(3_600_000),
    })
    .strict(),
  z.object({ type: z.literal('back') }).strict(),
]);
const runtimeActionStepSchema = z
  .object({ action: runtimeActionSchema, condition: runtimeConditionSchema.optional() })
  .strict();
const runtimeTimelineTrackSchema = z
  .object({
    id: idSchema,
    nodeId: idSchema,
    property: z.enum(['x', 'y', 'opacity', 'scale', 'rotate', 'blur']),
    keyframes: z
      .array(
        z
          .object({
            offsetMs: finiteIntegerSchema.min(0).max(3_600_000),
            value: finiteNumberSchema,
            easing: z.enum(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'spring-soft']).optional(),
          })
          .strict()
      )
      .max(1_000),
  })
  .strict();

const boundedRecord = <T extends z.ZodTypeAny>(valueSchema: T, limit: number) =>
  z
    .record(valueSchema)
    .refine((record) => Object.keys(record).length <= limit, `A record cannot contain more than ${limit} entries.`);

const spacingTupleSchema = z.tuple([finiteNumberSchema, finiteNumberSchema, finiteNumberSchema, finiteNumberSchema]);
const runtimeLayoutSchema = z
  .object({
    display: z.enum(['block', 'flex', 'grid', 'none']).optional(),
    position: z.enum(['relative', 'absolute', 'sticky', 'fixed']).optional(),
    flexDirection: z.enum(['row', 'column', 'row-reverse', 'column-reverse']).optional(),
    flexWrap: z.enum(['nowrap', 'wrap']).optional(),
    alignItems: z.enum(['start', 'center', 'end', 'stretch', 'baseline']).optional(),
    justifyContent: z.enum(['start', 'center', 'end', 'space-between', 'space-around']).optional(),
    gridTemplateColumns: z.string().trim().min(1).max(512).optional(),
    gap: finiteNumberSchema.min(0).max(100_000).optional(),
    padding: spacingTupleSchema.optional(),
    margin: spacingTupleSchema.optional(),
    width: z.union([finiteNumberSchema.min(0).max(100_000), z.enum(['auto', '100%'])]).optional(),
    height: z.union([finiteNumberSchema.min(0).max(100_000), z.enum(['auto', '100%'])]).optional(),
    minHeight: finiteNumberSchema.min(0).max(100_000).optional(),
    maxWidth: finiteNumberSchema.min(0).max(100_000).optional(),
    inset: z
      .object({
        top: finiteNumberSchema.optional(),
        right: finiteNumberSchema.optional(),
        bottom: finiteNumberSchema.optional(),
        left: finiteNumberSchema.optional(),
      })
      .strict()
      .optional(),
    zIndex: finiteIntegerSchema.min(-100_000).max(100_000).optional(),
    overflow: z.enum(['visible', 'hidden', 'auto', 'scroll']).optional(),
  })
  .strict();
const runtimeEffectSchema = z
  .object({
    blur: finiteNumberSchema.min(0).max(10_000).optional(),
    backdropBlur: finiteNumberSchema.min(0).max(10_000).optional(),
    brightness: finiteNumberSchema.min(0).max(100).optional(),
    contrast: finiteNumberSchema.min(0).max(100).optional(),
    saturate: finiteNumberSchema.min(0).max(100).optional(),
    blendMode: z.enum(['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'difference']).optional(),
    perspective: finiteNumberSchema.min(0).max(100_000).optional(),
    rotateX: finiteNumberSchema.min(-360_000).max(360_000).optional(),
    rotateY: finiteNumberSchema.min(-360_000).max(360_000).optional(),
    translateZ: finiteNumberSchema.min(-100_000).max(100_000).optional(),
  })
  .strict();
const runtimeNodeBaseSchema = z
  .object({
    layout: runtimeLayoutSchema.optional(),
    effects: runtimeEffectSchema.optional(),
    smartAnimateKey: z.string().trim().min(1).max(256).optional(),
    motion: runtimeMotionSchema.optional(),
  })
  .strict();
const runtimeNodeSchema = runtimeNodeBaseSchema.extend({
  responsive: z
    .object({
      mobile: runtimeNodeBaseSchema.optional(),
      tablet: runtimeNodeBaseSchema.optional(),
      desktop: runtimeNodeBaseSchema.optional(),
    })
    .strict()
    .optional(),
});

const runtimeContractSchema = z
  .object({
    schemaVersion: z.literal(1),
    defaultScreenId: idSchema.optional(),
    breakpoints: z
      .object({
        mobileMax: finiteIntegerSchema.min(1).max(10_000),
        tabletMax: finiteIntegerSchema.min(1).max(10_000),
      })
      .strict()
      .optional(),
    sections: boundedRecord(
      z
        .object({
          anchorId: z.string().trim().min(1).max(256).optional(),
          minHeight: finiteIntegerSchema.min(1).max(100_000).optional(),
          scrollSnap: z.enum(['none', 'start', 'center']).optional(),
          sticky: z.boolean().optional(),
        })
        .strict(),
      CONTRACT_ENTITY_LIMIT
    ).optional(),
    nodes: boundedRecord(runtimeNodeSchema, CONTRACT_ENTITY_LIMIT).optional(),
    interactions: boundedRecord(
      z
        .object({
          action: runtimeActionSchema.optional(),
          actions: z.array(runtimeActionStepSchema).min(1).max(32).optional(),
          condition: runtimeConditionSchema.optional(),
          transition: runtimeMotionSchema.optional(),
        })
        .strict(),
      CONTRACT_ENTITY_LIMIT
    ).optional(),
    timelines: boundedRecord(
      z
        .object({
          id: idSchema.optional(),
          name: z.string().trim().min(1).max(256),
          durationMs: finiteIntegerSchema.min(1).max(3_600_000),
          loop: z.boolean().optional(),
          tracks: z.array(runtimeTimelineTrackSchema).max(1_000),
        })
        .strict(),
      CONTRACT_ENTITY_LIMIT
    ).optional(),
    scrollBindings: boundedRecord(
      z
        .object({
          id: idSchema.optional(),
          nodeId: idSchema,
          timelineId: idSchema.optional(),
          start: finiteNumberSchema.min(0).max(1).optional(),
          end: finiteNumberSchema.min(0).max(1).optional(),
          pin: z.boolean().optional(),
          parallax: finiteNumberSchema.min(-100_000).max(100_000).optional(),
        })
        .strict(),
      CONTRACT_ENTITY_LIMIT
    ).optional(),
    routeTransition: runtimeMotionSchema.optional(),
  })
  .strict();

const runtimeEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('activateNode'),
      nodeId: idSchema,
      trigger: z.enum(['click', 'hover', 'focus', 'submit', 'scroll', 'load']).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('navigate'),
      route: z.string().trim().min(1).max(512),
      screenId: idSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal('back') }).strict(),
  z.object({ type: z.literal('closeOverlay'), nodeId: idSchema.optional() }).strict(),
  z.object({ type: z.literal('playTimeline'), timelineId: idSchema }).strict(),
  z.object({ type: z.literal('pauseTimeline'), timelineId: idSchema }).strict(),
  z
    .object({
      type: z.literal('seekTimeline'),
      timelineId: idSchema,
      offsetMs: finiteIntegerSchema.min(0).max(3_600_000),
    })
    .strict(),
  z
    .object({
      type: z.literal('tickTimeline'),
      timelineId: idSchema,
      deltaMs: finiteIntegerSchema.min(0).max(3_600_000),
    })
    .strict(),
  z
    .object({
      type: z.literal('setScrollProgress'),
      bindingId: idSchema,
      progress: finiteNumberSchema.min(0).max(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('setViewport'),
      width: finiteIntegerSchema.min(1).max(10_000),
      height: finiteIntegerSchema.min(1).max(10_000),
    })
    .strict(),
  z.object({ type: z.literal('consumeEffect') }).strict(),
]);

export const viuRuntimeScenarioSchema = z
  .object({
    width: finiteIntegerSchema.min(1).max(10_000).optional(),
    height: finiteIntegerSchema.min(1).max(10_000).optional(),
    reducedMotion: z.boolean().optional(),
    initialRoute: z.string().trim().min(1).max(512).optional(),
    contract: runtimeContractSchema.optional(),
    events: z.array(runtimeEventSchema).max(RUNTIME_EVENT_LIMIT),
  })
  .strict()
  .refine((scenario) => JSON.stringify(scenario).length <= 262_144, 'A runtime scenario cannot exceed 256 KiB.');

export type ViuQueryInput = z.infer<typeof viuQuerySchema>;
export type ViuRuntimeScenarioInput = z.infer<typeof viuRuntimeScenarioSchema>;
type QueryDiagnostic =
  | ViuDiagnostic
  | {
      code: 'node-not-found' | 'ancestor-not-found' | 'result-limit';
      severity: 'warning';
      message: string;
      entityId?: string;
    };
type AbsoluteGeometry = { matrix: ViuMatrix2D; x: number; y: number; width: number; height: number };
const round = (value: number): number => Math.round(value * 1_000) / 1_000;
const multiplyMatrix = (parent: ViuMatrix2D, local: ViuMatrix2D): ViuMatrix2D => [
  parent[0] * local[0] + parent[2] * local[1],
  parent[1] * local[0] + parent[3] * local[1],
  parent[0] * local[2] + parent[2] * local[3],
  parent[1] * local[2] + parent[3] * local[3],
  parent[0] * local[4] + parent[2] * local[5] + parent[4],
  parent[1] * local[4] + parent[3] * local[5] + parent[5],
];

const absoluteMatrixForNode = (
  project: ViuProjectState,
  nodeId: string,
  cache: Map<string, ViuMatrix2D>,
  visiting = new Set<string>()
): ViuMatrix2D => {
  const cached = cache.get(nodeId);
  if (cached) return cached;
  const node = project.nodes[nodeId];
  if (!node) return [1, 0, 0, 1, 0, 0];
  if (!node.parentId || visiting.has(nodeId)) {
    const local = [...node.localTransform] as ViuMatrix2D;
    cache.set(nodeId, local);
    return local;
  }
  visiting.add(nodeId);
  const absolute = multiplyMatrix(absoluteMatrixForNode(project, node.parentId, cache, visiting), node.localTransform);
  visiting.delete(nodeId);
  cache.set(nodeId, absolute);
  return absolute;
};

const geometryForNode = (
  project: ViuProjectState,
  node: ViuNode,
  cache: Map<string, ViuMatrix2D>
): AbsoluteGeometry => {
  const matrix = absoluteMatrixForNode(project, node.id, cache);
  const points: Array<[number, number]> = [
    [0, 0],
    [node.size.width, 0],
    [0, node.size.height],
    [node.size.width, node.size.height],
  ];
  const corners = points.map(([x, y]) => ({
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  }));
  const xValues = corners.map((corner) => corner.x);
  const yValues = corners.map((corner) => corner.y);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  return {
    matrix: matrix.map(round) as ViuMatrix2D,
    x: round(minX),
    y: round(minY),
    width: round(maxX - minX),
    height: round(maxY - minY),
  };
};

const INHERITED_STYLE_KEYS = [
  'color',
  'fontFamily',
  'fontSize',
  'fontWeight',

  'fontStyle',
  'lineHeight',
  'letterSpacing',

  'textDecoration',
  'textTransform',
] as const satisfies ReadonlyArray<keyof ViuNodeStyle>;

const computedStyleForNode = (project: ViuProjectState, node: ViuNode): ViuNodeStyle => {
  const ancestors: ViuNode[] = [];
  const visited = new Set<string>();
  let current: ViuNode | undefined = node;
  while (current && !visited.has(current.id)) {
    ancestors.unshift(current);
    visited.add(current.id);
    current = current.parentId ? project.nodes[current.parentId] : undefined;
  }
  const inherited: Partial<ViuNodeStyle> = {};
  for (const ancestor of ancestors) {
    for (const key of INHERITED_STYLE_KEYS) {
      const value = ancestor.style[key];
      if (value !== undefined) Object.assign(inherited, { [key]: value });
    }
  }
  return { ...inherited, ...node.style };
};

const descendantIds = (project: ViuProjectState, rootId: string): string[] => {
  const result: string[] = [];
  const visited = new Set<string>([rootId]);
  const stack = [...(project.nodes[rootId]?.childIds ?? [])].toReversed();
  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = project.nodes[nodeId];
    if (!node) continue;
    result.push(nodeId);
    stack.push(...node.childIds.toReversed());
  }
  return result;
};

const createScreenLookup = (project: ViuProjectState): Map<string, string> => {
  const result = new Map<string, string>();
  const walk = (nodeId: string, screenId: string, visited: Set<string>): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = project.nodes[nodeId];
    if (!node) return;
    result.set(nodeId, screenId);
    for (const childId of node.childIds) walk(childId, screenId, visited);
  };
  for (const screenId of project.screenOrder) {
    const screen = project.screens[screenId];
    if (screen) walk(screen.rootNodeId, screenId, new Set<string>());
  }
  return result;
};

/** Produces a bounded, read-only semantic projection suitable for an agent. */
export function queryViuProject(project: ViuProjectState, validation: ViuDiagnostic[], query: ViuQueryInput) {
  const resolvedByNode = new Map<string, ReturnType<typeof resolveViuNode>>();
  const effectiveProject =
    query.viewportWidth === undefined
      ? project
      : (() => {
          const resolvedProject = structuredClone(project);
          resolvedProject.nodes = Object.fromEntries(
            Object.keys(project.nodes).map((nodeId) => {
              const resolved = resolveViuNode(project, nodeId, query.viewportWidth!, query.modeOverrides ?? {});
              resolvedByNode.set(nodeId, resolved);
              return [nodeId, resolved.node];
            })
          );
          return resolvedProject;
        })();
  const effectiveValidation = query.viewportWidth === undefined ? validation : validateViuProject(effectiveProject);
  const diagnostics: QueryDiagnostic[] = structuredClone(effectiveValidation);
  const requestedIds = new Set(query.nodeIds ?? []);
  for (const requestedId of requestedIds) {
    if (!project.nodes[requestedId]) {
      diagnostics.push({
        code: 'node-not-found',
        severity: 'warning',
        message: 'A requested node does not exist.',
        entityId: requestedId,
      });
    }
  }

  let allowedDescendants: Set<string> | undefined;
  if (query.descendantsOf) {
    const ancestor = project.nodes[query.descendantsOf];
    allowedDescendants = new Set(ancestor ? descendantIds(project, ancestor.id) : []);
    if (!ancestor) {
      diagnostics.push({
        code: 'ancestor-not-found',
        severity: 'warning',
        message: 'The requested descendant root does not exist.',
        entityId: query.descendantsOf,
      });
    }
  }

  const normalizedName = query.name?.toLocaleLowerCase();
  const requestedQualityCodes = new Set<string>(query.qualityCodes ?? []);
  const qualityEntityIds = new Set(
    effectiveValidation
      .filter((item) => requestedQualityCodes.size === 0 || requestedQualityCodes.has(item.code))
      .map((item) => item.entityId)
      .filter((entityId): entityId is string => Boolean(entityId))
  );
  const matches = Object.values(effectiveProject.nodes)
    .filter((node) => requestedIds.size === 0 || requestedIds.has(node.id))
    .filter((node) => !query.nodeTypes || query.nodeTypes.includes(node.type))
    .filter((node) => !query.source || node.provenance.source === query.source)
    .filter((node) => query.hasImageTransform === undefined || Boolean(node.imageTransform) === query.hasImageTransform)
    .filter(
      (node) =>
        query.hasStructuredStrokes === undefined || Boolean(node.style.strokes?.length) === query.hasStructuredStrokes
    )
    .filter(
      (node) =>
        query.hasScrollBinding === undefined ||
        Object.values(effectiveProject.scrollBindings ?? {}).some((binding) => binding.nodeId === node.id) ===
          query.hasScrollBinding
    )
    .filter(
      (node) =>
        query.hasTimelineTrack === undefined ||
        Object.values(effectiveProject.timelines).some((timeline) =>
          (timeline.tracks ?? []).some((track) => track.nodeId === node.id)
        ) === query.hasTimelineTrack
    )
    .filter((node) => !query.qualityCodes || qualityEntityIds.has(node.id))
    .filter((node) => {
      if (!normalizedName) return true;
      const candidate = node.name.toLocaleLowerCase();
      return query.nameMatch === 'exact' ? candidate === normalizedName : candidate.includes(normalizedName);
    })
    .filter((node) => !allowedDescendants || allowedDescendants.has(node.id))
    .toSorted((left, right) => left.id.localeCompare(right.id));

  const expandedIds = new Set(matches.map((node) => node.id));
  if (query.includeDescendants) {
    for (const node of matches) {
      for (const descendantId of descendantIds(project, node.id)) expandedIds.add(descendantId);
    }
  }

  const limit = query.limit ?? 50;
  const orderedIds = [...expandedIds].toSorted();
  const entityIds = orderedIds.slice(0, limit);
  const truncated = orderedIds.length > entityIds.length;
  if (truncated) {
    diagnostics.push({
      code: 'result-limit',
      severity: 'warning',
      message: `The query matched ${orderedIds.length} nodes; only the first ${entityIds.length} were returned.`,
    });
  }

  const matrixCache = new Map<string, ViuMatrix2D>();
  const nodeToScreen = createScreenLookup(effectiveProject);
  const nodes = entityIds.map((nodeId) => {
    const node = effectiveProject.nodes[nodeId]!;
    const designResolution = resolvedByNode.get(nodeId);
    const resolvedInstance = node.componentInstance ? resolveViuComponentInstance(effectiveProject, node) : undefined;
    const component = resolvedInstance?.component;
    const componentSet = component?.componentSetId
      ? effectiveProject.componentSets[component.componentSetId]
      : undefined;
    const componentInstance =
      node.componentInstance && component
        ? {
            componentId: node.componentInstance.componentId,
            resolvedComponentId: component.id,
            resolvedComponentName: component.name,
            componentSetId: componentSet?.id ?? null,
            componentSetName: componentSet?.name ?? null,
            variantSelection: { ...node.componentInstance.variantSelection },

            styleOverrides: { ...node.componentInstance.styleOverrides },
            effectiveStyle: { ...resolvedInstance.nodes[resolvedInstance.rootId]!.style },
            resolvedVariantProperties: { ...component.variantProperties },
            properties: Object.values(component.propertyDefinitions)
              .toSorted((left, right) => left.id.localeCompare(right.id))
              .map((property) => ({
                id: property.id,
                name: property.name,
                type: property.type,
                targetNodeId: property.targetNodeId,
                targetProperty: property.targetProperty,
                defaultValue: property.defaultValue,
                value: node.componentInstance!.propertyValues[property.id] ?? property.defaultValue,
                overridden: Object.hasOwn(node.componentInstance!.propertyValues, property.id),
              })),
          }
        : null;
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      parentId: node.parentId,
      childIds: [...node.childIds],
      screenId: nodeToScreen.get(node.id) ?? null,
      source: node.provenance.source,
      visible: node.visible,
      locked: node.locked,
      localGeometry: { matrix: [...node.localTransform], width: node.size.width, height: node.size.height },
      absoluteGeometry: geometryForNode(effectiveProject, node, matrixCache),
      computedStyle: computedStyleForNode(effectiveProject, node),
      semantics: { ...node.semantics },
      interactionIds: [...node.behaviorBindings],
      imageTransform: node.imageTransform ? structuredClone(node.imageTransform) : null,
      strokes: node.style.strokes ? structuredClone(node.style.strokes) : [],
      timelineTracks: Object.values(effectiveProject.timelines)
        .toSorted((left, right) => left.id.localeCompare(right.id))
        .flatMap((timeline) =>
          (timeline.tracks ?? [])
            .filter((track) => track.nodeId === node.id)
            .map((track) => ({
              timelineId: timeline.id,
              timelineName: timeline.name,
              durationMs: timeline.durationMs,
              loop: timeline.loop ?? false,
              track: structuredClone(track),
            }))
        ),
      scrollBindings: Object.values(effectiveProject.scrollBindings ?? {})
        .filter((binding) => binding.nodeId === node.id)
        .toSorted((left, right) => left.id.localeCompare(right.id))
        .map((binding) => ({
          ...structuredClone(binding),
          timeline: binding.timelineId ? structuredClone(effectiveProject.timelines[binding.timelineId] ?? null) : null,
        })),
      vector: node.vector ? structuredClone(node.vector) : null,
      qualityDiagnostics: effectiveValidation
        .filter((item) => item.entityId === node.id)
        .map((item) => structuredClone(item)),
      resolvedDesign: designResolution
        ? {
            viewportWidth: query.viewportWidth,
            modeOverrides: structuredClone(query.modeOverrides ?? {}),
            breakpoint: designResolution.breakpoint ? structuredClone(designResolution.breakpoint) : null,
            properties: structuredClone(designResolution.properties),
          }
        : null,
      componentInstance,
    };
  });

  return {
    documentId: project.projectId,
    revision: project.revision,
    entityIds,
    nodes,
    diagnostics,
    designResolution:
      query.viewportWidth === undefined
        ? null
        : { viewportWidth: query.viewportWidth, modeOverrides: structuredClone(query.modeOverrides ?? {}) },
    truncated,
  };
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)])
  );
};

const publicRuntimeState = (state: ViuRuntimeState) => ({
  currentRoute: state.currentRoute,
  activeScreenId: state.activeScreenId,
  history: state.history,
  overlayNodeIds: state.overlayNodeIds,
  variables: state.variables,
  timelines: state.timelines,
  scrollProgress: state.scrollProgress,
  viewport: state.viewport,
  reducedMotion: state.reducedMotion,
  pendingEffect: state.pendingEffect,
  effectQueue: state.effectQueue,
  sequence: state.sequence,
});

/** Executes a deterministic, DOM-free runtime scenario against a project clone. */
export function runViuRuntimeScenario(project: ViuProjectState, scenario: ViuRuntimeScenarioInput) {
  const plan = compileViuSite(structuredClone(project), scenario.contract as ViuRuntimeContract | undefined);
  let state = createViuRuntimeState(plan, {
    width: scenario.width,
    height: scenario.height,
    reducedMotion: scenario.reducedMotion,
    initialRoute: scenario.initialRoute,
  });
  for (const event of scenario.events as ViuRuntimeEvent[]) state = reduceViuRuntime(plan, state, event);

  const finalState = publicRuntimeState(state);
  const digestPayload = {
    documentId: project.projectId,
    revision: project.revision,
    input: scenario,
    finalState,
    trace: state.trace,
  };
  const traceDigest = createHash('sha256')
    .update(JSON.stringify(canonicalize(digestPayload)))
    .digest('hex');
  return {
    documentId: project.projectId,
    revision: project.revision,
    plan: {
      initialRoute: plan.initialRoute,
      initialScreenId: plan.initialScreenId,
      routes: plan.routes.map((route) => ({
        route: route.route,
        screenIds: route.screenIds,
        sections: route.sections.map((section) => ({
          screenId: section.screenId,
          rootNodeId: section.rootNodeId,
          anchorId: section.anchorId,
        })),
      })),
      diagnostics: plan.diagnostics,
    },
    eventCount: scenario.events.length,
    finalState,
    trace: state.trace,
    traceDigest: `sha256:${traceDigest}`,
  };
}

export function getViuCapabilities(project: ViuProjectState) {
  return {
    schemaVersion: 1,
    documentId: project.projectId,
    revision: project.revision,
    authoritativeEngine: 'viuV2SessionService',
    stateParity: {
      sharedAuthoritativeDocument: true,
      userMutationPath: ['VIU canvas or inspector', 'viuClient.commitV2', 'ide.viu.v2.commit', 'viuV2SessionService'],
      agentMutationPath: ['viu_commit_transaction', 'viuV2SessionService'],
      concurrency: 'optimistic revision plus optional node-version preconditions',
    },
    agentTools: [
      'viu_inspect',
      'viu_query',
      'viu_preview_transaction',
      'viu_commit_transaction',
      'viu_validate',
      'viu_run_runtime_scenario',
      'viu_get_capabilities',
      'viu_create_frame_plan',
      'viu_get_frame_plan',
      'viu_claim_frame',
      'viu_submit_frame_contribution',
      'viu_review_frame_plan',
      'viu_commit_frame_plan',
    ],
    componentAuthoring: {
      commands: [
        'createComponent',
        'updateComponent',
        'deleteComponent',
        'createComponentSet',
        'updateComponentSet',
        'deleteComponentSet',
      ],
      instanceBinding: 'insertNode or updateNode with strict componentInstance metadata',
      rendererParity: 'Design and Present use the same resolveViuComponentInstance materialization',
    },
    designSystem: {
      operations: [
        'upsertVariableCollection',
        'deleteVariableCollection',
        'upsertVariable',
        'deleteVariable',
        'setVariableMode',
        'bindVariable',
        'resolveVariable',
        'upsertBreakpoint',
        'deleteBreakpoint',
        'setResponsiveOverride',
        'setGuides',
        'setSnapSettings',
        'resolveNodeAtViewport',
        'snapPoint',
      ],
      variables: ['color', 'number', 'string', 'boolean'],
      validation: ['alias-cycle', 'alias-type', 'collection-mode', 'binding-mode', 'breakpoint-range'],
      responsive: 'sparse overrides resolved against custom breakpoint ranges with property provenance',
      snapping: ['pixel-grid', 'horizontal-guide', 'vertical-guide', 'object-edge', 'object-center'],
      userAgentParity: 'inspector batches and agent transactions use the same authoritative commands and resolvers',
    },
    prototypeMotion: {
      authoringCommands: [
        'createTimeline',
        'updateTimeline',
        'deleteTimeline',
        'upsertScrollBinding',
        'deleteScrollBinding',
      ],
      triggers: ['click', 'hover', 'focus', 'submit', 'scroll', 'load'],
      actions: [
        'navigate',
        'openOverlay',
        'closeOverlay',
        'back',
        'scrollTo',
        'setVariable',
        'toggleVariable',
        'playTimeline',
        'pauseTimeline',
        'seekTimeline',
      ],
      conditions: ['eq', 'neq', 'truthy', 'falsy', 'gt', 'gte', 'lt', 'lte'],
      orderedActions: 32,
      timelines: ['play', 'pause', 'seek', 'tick', 'loop', 'scroll-scrub'],
      motion: ['smart-animate', 'scroll-progress', 'pin', 'parallax', 'reduced-motion'],
      rendererParity: 'Present and agent scenarios compile the same project, contract, state machine, and trace',
    },
    imageAuthoring: {
      fit: ['cover', 'contain', 'fill', 'none', 'scale-down'],
      framing: ['normalized-crop', 'focal-point', 'rotation', 'horizontal-flip', 'vertical-flip'],
      mutation: 'updateNode.imageTransform through the authoritative transaction path',
      rendererParity: 'Design and Present compile the same image transform model',
    },
    accessibilityDesignLint: {
      checks: qualityCodeSchema.options,
      querySelectors: ['qualityCodes', 'hasImageTransform', 'hasStructuredStrokes'],
      rendererParity: 'Inspector and agent queries consume the same canonical project diagnostics',
    },
    propertyStack: {
      fills: ['solid', 'linear', 'radial'],
      effects: ['drop-shadow', 'inner-shadow', 'layer-blur', 'backdrop-blur'],
      strokes: ['alignment', 'cap', 'join', 'miter-limit', 'dash-pattern', 'dash-offset'],
      operations: ['add', 'remove', 'reorder', 'toggle-visibility', 'update'],
      fallback: 'raw background/shadow/blur values remain lossless when structured stacks are absent',
      rendererParity: 'Design and Present compile the same ordered paint/effect model',
    },
    vectorAuthoring: {
      geometry: 'strict SVG path plus editable anchors and relative Bézier handles',
      commands: ['insertNode', 'updateNode'],
      styles: ['nonzero', 'evenodd', 'butt', 'round', 'square', 'miter', 'bevel'],
      rendererParity: 'Design and Present use the same native SVG renderer and structured fill stack',
    },
    query: {
      selectors: [
        'nodeIds',
        'nodeTypes',
        'name',
        'source',
        'descendantsOf',
        'includeDescendants',
        'hasImageTransform',
        'hasStructuredStrokes',
        'hasScrollBinding',
        'hasTimelineTrack',
        'qualityCodes',
        'viewportWidth',
        'modeOverrides',
      ],
      projection: [
        'entity IDs',
        'absolute geometry',
        'computed style',
        'semantics',
        'interactions',
        'timeline tracks and scroll bindings',
        'resolved responsive and variable-mode provenance',
        'component, variant, and effective property values',
        'diagnostics',
      ],
      readOnly: true,
    },
    frameWorkflow: {
      assignment: 'one agent per screen with a Team-compatible advisory lease and optional Team task binding',
      contribution: 'strictly frame-scoped transaction stored without mutating the authoritative project',
      review: 'deterministic clone merge with per-assignment reports, rollback, and full-site diagnostics',
      commit: 'complete reviewed plans publish atomically through the authoritative VIU session',
    },
    runtimeScenario: {
      events: [
        'activateNode',
        'navigate',
        'back',
        'closeOverlay',
        'playTimeline',
        'pauseTimeline',
        'seekTimeline',
        'tickTimeline',
        'setScrollProgress',
        'setViewport',
        'consumeEffect',
      ],
      outputs: [
        'route and screen state',
        'overlay and variables state',
        'timeline and scroll-linked state',
        'queued effects',
        'trace',
        'SHA-256 trace digest',
      ],
      execution: 'deterministic, serializable, DOM-free, and eval-free',
      readOnly: true,
    },
    limits: {
      transactionCommands: 500,
      transactionPreconditions: 1_000,
      queryNodeIds: ID_LIMIT,
      queryResults: QUERY_RESULT_LIMIT,
      runtimeEvents: RUNTIME_EVENT_LIMIT,
      runtimeContractEntitiesPerMap: CONTRACT_ENTITY_LIMIT,
    },
    limitations: [
      'Agent queries return a bounded semantic projection, not a raster screenshot or browser-computed CSS.',
      'Runtime scenarios do not execute arbitrary JavaScript, DOM APIs, network requests, or local files.',
      'Visual pixel fidelity still requires renderer preview or screenshot evidence outside this tool surface.',
    ],
  };
}
