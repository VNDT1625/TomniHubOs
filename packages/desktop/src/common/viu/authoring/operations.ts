/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createViuNode } from '../starter';
import type {
  ViuCommand,
  ViuId,
  ViuInteraction,
  ViuInteractionAction,
  ViuInteractionTransition,
  ViuInteractionTrigger,
  ViuNode,
  ViuProjectState,
  ViuScrollBinding,
  ViuTimeline,
  ViuTimelinePatch,
} from '../types';
import { getViuBoundsInParent, multiplyViuMatrices, translateViuMatrix } from './geometry';
import { getTopLevelViuSelection, normalizeViuSelection } from './selection';
import type {
  ViuAlignment,
  ViuAuthoringBatch,
  ViuDuplicateOptions,
  ViuGroupOptions,
  ViuRect,
  ViuSelection,
} from './types';

const clone = <T>(value: T): T => structuredClone(value);

const authorableTopLevelIds = (state: ViuProjectState, nodeIds: readonly ViuId[]): ViuId[] =>
  getTopLevelViuSelection(state, normalizeViuSelection(state, nodeIds, { includeHidden: true }).nodeIds);

const requireNodes = (state: ViuProjectState, nodeIds: readonly ViuId[], minimum: number): ViuNode[] => {
  const nodes = nodeIds.map((nodeId) => state.nodes[nodeId]).filter((node): node is ViuNode => Boolean(node));
  if (nodes.length < minimum) throw new Error(`This operation requires at least ${minimum} authorable nodes.`);
  return nodes;
};

const requireSharedParent = (nodes: readonly ViuNode[]): ViuId => {
  const parentId = nodes[0]?.parentId ?? null;
  if (parentId === null || nodes.some((node) => node.parentId !== parentId)) {
    throw new Error('Selected nodes must share a non-root parent.');
  }
  return parentId;
};

const unionRects = (rects: readonly ViuRect[]): ViuRect => {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

const mapInteractionAction = (
  action: ViuInteractionAction,
  nodeIdMap: ReadonlyMap<ViuId, ViuId>
): ViuInteractionAction => {
  if (action.type === 'openOverlay' || action.type === 'scrollTo') {
    return { ...action, targetNodeId: nodeIdMap.get(action.targetNodeId) ?? action.targetNodeId };
  }
  return clone(action);
};

const collectSubtreeIds = (state: ViuProjectState, rootId: ViuId): ViuId[] => {
  const result: ViuId[] = [];
  const visit = (nodeId: ViuId): void => {
    const node = state.nodes[nodeId];
    if (!node) throw new Error(`Node ${nodeId} does not exist.`);
    result.push(nodeId);
    node.childIds.forEach(visit);
  };
  visit(rootId);
  return result;
};

const assertFreshId = (state: ViuProjectState, generated: Set<ViuId>, id: ViuId): void => {
  if (!id || state.nodes[id] || state.interactions[id] || generated.has(id)) {
    throw new Error(`Authoring ID factory produced a duplicate or invalid ID: ${id}.`);
  }
  generated.add(id);
};

/** Creates a deep, interaction-aware duplicate command batch without mutating the project. */
export const createDuplicateViuBatch = (
  state: ViuProjectState,
  selection: ViuSelection,
  options: ViuDuplicateOptions
): ViuAuthoringBatch => {
  const rootIds = authorableTopLevelIds(state, selection.nodeIds);
  const roots = requireNodes(state, rootIds, 1);
  if (roots.some((node) => node.parentId === null)) throw new Error('Screen roots cannot be duplicated as nodes.');

  const subtreeIds = roots.flatMap((root) => collectSubtreeIds(state, root.id));
  const generatedIds = new Set<ViuId>();
  const nodeIdMap = new Map<ViuId, ViuId>();
  for (const sourceId of subtreeIds) {
    const targetId = options.idFactory('node', sourceId);
    assertFreshId(state, generatedIds, targetId);
    nodeIdMap.set(sourceId, targetId);
  }

  const offset = options.offset ?? { x: 16, y: 16 };
  const rootSet = new Set(rootIds);
  const maxSelectedIndexByParent = new Map<ViuId, number>();
  for (const root of roots) {
    const parent = state.nodes[root.parentId!];
    const sourceIndex = parent?.childIds.indexOf(root.id) ?? -1;
    maxSelectedIndexByParent.set(
      root.parentId!,
      Math.max(maxSelectedIndexByParent.get(root.parentId!) ?? -1, sourceIndex)
    );
  }
  const rootOffsetByParent = new Map<ViuId, number>();
  const commands: ViuCommand[] = [];

  for (const sourceId of subtreeIds) {
    const source = state.nodes[sourceId]!;
    const targetId = nodeIdMap.get(sourceId)!;
    const isRoot = rootSet.has(sourceId);
    const targetParentId = isRoot ? source.parentId : nodeIdMap.get(source.parentId!)!;
    const targetNode: ViuNode = {
      ...clone(source),
      id: targetId,
      version: 1,
      parentId: targetParentId,
      childIds: [],
      behaviorBindings: [],
      localTransform: isRoot
        ? translateViuMatrix(source.localTransform, offset.x, offset.y)
        : clone(source.localTransform),
    };
    let index: number | undefined;
    if (isRoot) {
      const parentId = source.parentId!;
      const rootOffset = rootOffsetByParent.get(parentId) ?? 0;
      index = (maxSelectedIndexByParent.get(parentId) ?? -1) + 1 + rootOffset;
      rootOffsetByParent.set(parentId, rootOffset + 1);
    } else {
      index = state.nodes[source.parentId!]?.childIds.indexOf(source.id);
    }
    commands.push({ type: 'insertNode', node: targetNode, parentId: targetParentId, index });
  }

  const duplicatedInteractions = Object.values(state.interactions).filter((interaction) =>
    nodeIdMap.has(interaction.sourceNodeId)
  );
  for (const source of duplicatedInteractions) {
    const targetId = options.idFactory('interaction', source.id);
    assertFreshId(state, generatedIds, targetId);
    const interaction: ViuInteraction = {
      ...clone(source),
      id: targetId,
      version: 1,
      sourceNodeId: nodeIdMap.get(source.sourceNodeId)!,
      action: mapInteractionAction(source.action, nodeIdMap),
    };
    commands.push({ type: 'connectInteraction', interaction });
  }

  return {
    intent: 'duplicate',
    commands,
    nextSelection: {
      nodeIds: rootIds.map((rootId) => nodeIdMap.get(rootId)!),
      anchorId: selection.anchorId ? (nodeIdMap.get(selection.anchorId) ?? null) : null,
    },
  };
};

/** Creates one atomic delete batch, removing only top-level selected subtrees. */
export const createDeleteViuBatch = (state: ViuProjectState, selection: ViuSelection): ViuAuthoringBatch => {
  const nodeIds = authorableTopLevelIds(state, selection.nodeIds);
  const nodes = requireNodes(state, nodeIds, 1);
  if (nodes.some((node) => node.parentId === null))
    throw new Error('Screen roots require a screen-level delete operation.');
  return {
    intent: 'delete',
    commands: nodeIds.map((nodeId): ViuCommand => ({ type: 'deleteNode', nodeId })),
    nextSelection: { nodeIds: [], anchorId: null },
  };
};

/** Wraps selected siblings in a geometry-preserving group. */
export const createGroupViuBatch = (
  state: ViuProjectState,
  selection: ViuSelection,
  options: ViuGroupOptions
): ViuAuthoringBatch => {
  if (state.nodes[options.groupId]) throw new Error(`Group ID ${options.groupId} already exists.`);
  const nodeIds = authorableTopLevelIds(state, selection.nodeIds);
  const nodes = requireNodes(state, nodeIds, 1);
  const parentId = requireSharedParent(nodes);
  const parent = state.nodes[parentId]!;
  const orderedIds = parent.childIds.filter((nodeId) => nodeIds.includes(nodeId));
  const bounds = unionRects(orderedIds.map((nodeId) => getViuBoundsInParent(state.nodes[nodeId]!)));
  const insertionIndex = Math.min(...orderedIds.map((nodeId) => parent.childIds.indexOf(nodeId)));
  const group = createViuNode({
    id: options.groupId,
    name: options.groupName,
    type: 'group',
    parentId,
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  });
  const commands: ViuCommand[] = [{ type: 'insertNode', node: group, parentId, index: insertionIndex }];
  for (const [index, nodeId] of orderedIds.entries()) {
    const node = state.nodes[nodeId]!;
    commands.push({
      type: 'updateNode',
      nodeId,
      patch: { localTransform: translateViuMatrix(node.localTransform, -bounds.x, -bounds.y) },
    });
    commands.push({ type: 'reparentNode', nodeId, parentId: group.id, index });
  }
  return {
    intent: 'group',
    commands,
    nextSelection: { nodeIds: [group.id], anchorId: group.id },
  };
};

/** Releases one selected group while preserving each child's geometry and order. */
export const createUngroupViuBatch = (state: ViuProjectState, selection: ViuSelection): ViuAuthoringBatch => {
  const nodeIds = authorableTopLevelIds(state, selection.nodeIds);
  const groups = requireNodes(state, nodeIds, 1);
  if (groups.length !== 1 || groups[0]!.type !== 'group' || groups[0]!.parentId === null) {
    throw new Error('Ungroup requires exactly one non-root group.');
  }
  const group = groups[0]!;
  const parentId = group.parentId!;
  const groupIndex = state.nodes[parentId]!.childIds.indexOf(group.id);
  const commands: ViuCommand[] = [];
  for (const [index, childId] of group.childIds.entries()) {
    const child = state.nodes[childId]!;
    commands.push({
      type: 'updateNode',
      nodeId: childId,
      patch: { localTransform: multiplyViuMatrices(group.localTransform, child.localTransform) },
    });
    commands.push({ type: 'reparentNode', nodeId: childId, parentId, index: groupIndex + index });
  }
  commands.push({ type: 'deleteNode', nodeId: group.id });
  return {
    intent: 'ungroup',
    commands,
    nextSelection: { nodeIds: [...group.childIds], anchorId: group.childIds.at(-1) ?? null },
  };
};

const alignmentTarget = (rect: ViuRect, alignment: ViuAlignment): number => {
  switch (alignment) {
    case 'left':
      return rect.x;
    case 'horizontal-center':
      return rect.x + rect.width / 2;
    case 'right':
      return rect.x + rect.width;
    case 'top':
      return rect.y;
    case 'vertical-center':
      return rect.y + rect.height / 2;
    case 'bottom':
      return rect.y + rect.height;
  }
};

/** Aligns selected siblings to their union or to an explicit key object. */
export const createAlignViuBatch = (
  state: ViuProjectState,
  selection: ViuSelection,
  alignment: ViuAlignment,
  referenceNodeId?: ViuId
): ViuAuthoringBatch => {
  const nodeIds = authorableTopLevelIds(state, selection.nodeIds);
  const nodes = requireNodes(state, nodeIds, 2);
  requireSharedParent(nodes);
  const boundsById = new Map(nodes.map((node) => [node.id, getViuBoundsInParent(node)]));
  const reference = referenceNodeId ? boundsById.get(referenceNodeId) : undefined;
  if (referenceNodeId && !reference) throw new Error('The alignment reference must be selected.');
  const targetRect = reference ?? unionRects([...boundsById.values()]);
  const target = alignmentTarget(targetRect, alignment);
  const horizontal = alignment === 'left' || alignment === 'horizontal-center' || alignment === 'right';
  const commands = nodes.flatMap((node): ViuCommand[] => {
    const bounds = boundsById.get(node.id)!;
    const delta = target - alignmentTarget(bounds, alignment);
    if (Math.abs(delta) < Number.EPSILON) return [];
    return [
      {
        type: 'updateNode',
        nodeId: node.id,
        patch: {
          localTransform: translateViuMatrix(node.localTransform, horizontal ? delta : 0, horizontal ? 0 : delta),
        },
      },
    ];
  });
  return { intent: 'align', commands, nextSelection: selection };
};

/** Distributes three or more selected siblings with equal edge-to-edge spacing. */
export const createDistributeViuBatch = (
  state: ViuProjectState,
  selection: ViuSelection,
  axis: 'horizontal' | 'vertical'
): ViuAuthoringBatch => {
  const nodeIds = authorableTopLevelIds(state, selection.nodeIds);
  const nodes = requireNodes(state, nodeIds, 3);
  requireSharedParent(nodes);
  const withBounds = nodes
    .map((node) => ({ node, bounds: getViuBoundsInParent(node) }))
    .toSorted((left, right) =>
      axis === 'horizontal' ? left.bounds.x - right.bounds.x : left.bounds.y - right.bounds.y
    );
  const start = axis === 'horizontal' ? withBounds[0]!.bounds.x : withBounds[0]!.bounds.y;
  const final = withBounds.at(-1)!.bounds;
  const end = axis === 'horizontal' ? final.x + final.width : final.y + final.height;
  const totalSize = withBounds.reduce(
    (sum, item) => sum + (axis === 'horizontal' ? item.bounds.width : item.bounds.height),
    0
  );
  const gap = (end - start - totalSize) / (withBounds.length - 1);
  let cursor = start;
  const commands: ViuCommand[] = [];
  for (const [index, item] of withBounds.entries()) {
    const current = axis === 'horizontal' ? item.bounds.x : item.bounds.y;
    if (index > 0 && index < withBounds.length - 1) {
      const delta = cursor - current;
      commands.push({
        type: 'updateNode',
        nodeId: item.node.id,
        patch: {
          localTransform: translateViuMatrix(
            item.node.localTransform,
            axis === 'horizontal' ? delta : 0,
            axis === 'vertical' ? delta : 0
          ),
        },
      });
    }
    cursor += (axis === 'horizontal' ? item.bounds.width : item.bounds.height) + gap;
  }
  return { intent: 'distribute', commands, nextSelection: selection };
};

type ViuInteractionAuthoringInput = {
  id: ViuId;
  flowId: ViuId;
  sourceNodeId: ViuId;
  trigger: ViuInteractionTrigger;
  action: ViuInteractionAction;
  actions?: ViuInteractionAction[];
  condition?: ViuInteraction['condition'];
  transition: ViuInteractionTransition;
};

type ViuInteractionAuthoringPatch = Partial<Omit<ViuInteractionAuthoringInput, 'id' | 'sourceNodeId'>>;

const validateInteractionAction = (
  state: ViuProjectState,
  interactionId: ViuId,
  action: ViuInteractionAction
): void => {
  if (action.type === 'navigate' && !state.screens[action.targetScreenId]) {
    throw new Error(`Target screen ${action.targetScreenId} does not exist.`);
  }
  if (
    (action.type === 'openOverlay' || action.type === 'scrollTo' || action.type === 'closeOverlay') &&
    action.targetNodeId &&
    !state.nodes[action.targetNodeId]
  ) {
    throw new Error(`Target node ${action.targetNodeId} does not exist.`);
  }
  if ((action.type === 'setVariable' || action.type === 'toggleVariable') && !state.variables[action.variableId]) {
    throw new Error(`Variable ${action.variableId} does not exist for interaction ${interactionId}.`);
  }
  if (
    (action.type === 'playTimeline' || action.type === 'pauseTimeline' || action.type === 'seekTimeline') &&
    !state.timelines[action.timelineId]
  ) {
    throw new Error(`Timeline ${action.timelineId} does not exist for interaction ${interactionId}.`);
  }
  if (action.type === 'seekTimeline' && (!Number.isFinite(action.offsetMs) || action.offsetMs < 0)) {
    throw new Error('Timeline seek offset must be a finite non-negative number.');
  }
};

const validateInteractionDraft = (state: ViuProjectState, interaction: ViuInteraction): void => {
  const source = state.nodes[interaction.sourceNodeId];
  if (!source) throw new Error(`Interaction source ${interaction.sourceNodeId} does not exist.`);
  if (source.locked) throw new Error(`Interaction source ${interaction.sourceNodeId} is locked.`);
  if (!state.flows[interaction.flowId]) throw new Error(`Flow ${interaction.flowId} does not exist.`);

  const actions = interaction.actions?.length ? interaction.actions : [interaction.action];
  if (actions.length > 32) throw new Error('An interaction cannot contain more than 32 ordered actions.');
  actions.forEach((action) => validateInteractionAction(state, interaction.id, action));
  if (interaction.condition && !state.variables[interaction.condition.variableId]) {
    throw new Error(`Condition variable ${interaction.condition.variableId} does not exist.`);
  }
  if (
    interaction.transition &&
    (!Number.isFinite(interaction.transition.durationMs) || interaction.transition.durationMs < 0)
  ) {
    throw new Error('Interaction transition duration must be a finite non-negative number.');
  }
};

/** Creates a prototype binding while preserving the selection and command-only authoring contract. */
export const createInteractionViuBatch = (
  state: ViuProjectState,
  input: ViuInteractionAuthoringInput
): ViuAuthoringBatch => {
  if (!input.id || state.interactions[input.id] || state.nodes[input.id]) {
    throw new Error(`Interaction ${input.id} already exists or has an invalid ID.`);
  }
  const interaction: ViuInteraction = { ...clone(input), version: 1 };
  if (interaction.actions?.length) interaction.action = clone(interaction.actions[0]!);
  validateInteractionDraft(state, interaction);
  return {
    intent: 'interaction-create',
    commands: [{ type: 'connectInteraction', interaction }],
    nextSelection: { nodeIds: [input.sourceNodeId], anchorId: input.sourceNodeId },
  };
};

/** Replaces one binding atomically so trigger, destination, and transition stay in sync. */
export const createUpdateInteractionViuBatch = (
  state: ViuProjectState,
  interactionId: ViuId,
  patch: ViuInteractionAuthoringPatch
): ViuAuthoringBatch => {
  const current = state.interactions[interactionId];
  if (!current) throw new Error(`Interaction ${interactionId} does not exist.`);
  const interaction: ViuInteraction = {
    ...clone(current),
    ...clone(patch),
    id: current.id,
    sourceNodeId: current.sourceNodeId,
    version: current.version + 1,
  };
  if (interaction.actions?.length) interaction.action = clone(interaction.actions[0]!);
  validateInteractionDraft(state, interaction);
  return {
    intent: 'interaction-update',
    commands: [
      { type: 'disconnectInteraction', interactionId },
      { type: 'connectInteraction', interaction },
    ],
    nextSelection: { nodeIds: [current.sourceNodeId], anchorId: current.sourceNodeId },
  };
};

/** Removes one prototype binding without deleting its source or destination. */
export const createDeleteInteractionViuBatch = (state: ViuProjectState, interactionId: ViuId): ViuAuthoringBatch => {
  const interaction = state.interactions[interactionId];
  if (!interaction) throw new Error(`Interaction ${interactionId} does not exist.`);
  return {
    intent: 'interaction-delete',
    commands: [{ type: 'disconnectInteraction', interactionId }],
    nextSelection: { nodeIds: [interaction.sourceNodeId], anchorId: interaction.sourceNodeId },
  };
};

const assertTimelineDraft = (state: ViuProjectState, timeline: ViuTimeline): void => {
  if (!timeline.id || !timeline.name.trim()) throw new Error('Timeline ID and name are required.');
  if (!Number.isFinite(timeline.durationMs) || timeline.durationMs < 1 || timeline.durationMs > 3_600_000) {
    throw new Error('Timeline duration must be between 1 and 3,600,000 milliseconds.');
  }
  const trackIds = new Set<ViuId>();
  for (const track of timeline.tracks ?? []) {
    if (!track.id || trackIds.has(track.id)) throw new Error(`Timeline ${timeline.id} has an invalid track ID.`);
    trackIds.add(track.id);
    if (!state.nodes[track.nodeId]) throw new Error(`Timeline track ${track.id} references a missing node.`);
    for (const keyframe of track.keyframes) {
      if (
        !Number.isFinite(keyframe.offsetMs) ||
        keyframe.offsetMs < 0 ||
        keyframe.offsetMs > timeline.durationMs ||
        !Number.isFinite(keyframe.value)
      ) {
        throw new Error(`Timeline track ${track.id} contains an invalid keyframe.`);
      }
    }
  }
};

/** Creates an authored timeline through the same atomic command path used by undo and agents. */
export const createTimelineViuBatch = (state: ViuProjectState, timeline: ViuTimeline): ViuAuthoringBatch => {
  if (state.timelines[timeline.id]) throw new Error(`Timeline ${timeline.id} already exists.`);
  assertTimelineDraft(state, timeline);
  return {
    intent: 'timeline-create',
    commands: [{ type: 'createTimeline', timeline: clone(timeline) }],
  };
};

/** Updates timeline metadata, tracks, or keyframes without mutating the live project. */
export const createUpdateTimelineViuBatch = (
  state: ViuProjectState,
  timelineId: ViuId,
  patch: ViuTimelinePatch
): ViuAuthoringBatch => {
  const current = state.timelines[timelineId];
  if (!current) throw new Error(`Timeline ${timelineId} does not exist.`);
  const timeline: ViuTimeline = { ...clone(current), ...clone(patch), id: timelineId };
  assertTimelineDraft(state, timeline);
  return {
    intent: 'timeline-update',
    commands: [{ type: 'updateTimeline', timelineId, patch: clone(patch) }],
  };
};

/** Deletes an unreferenced authored timeline. Reference checks remain authoritative in the command layer. */
export const createDeleteTimelineViuBatch = (state: ViuProjectState, timelineId: ViuId): ViuAuthoringBatch => {
  if (!state.timelines[timelineId]) throw new Error(`Timeline ${timelineId} does not exist.`);
  return {
    intent: 'timeline-delete',
    commands: [{ type: 'deleteTimeline', timelineId }],
  };
};

/** Creates or replaces one authored scroll range, pin, parallax, and optional timeline binding. */
export const createUpsertScrollBindingViuBatch = (
  state: ViuProjectState,
  binding: ViuScrollBinding
): ViuAuthoringBatch => {
  if (!binding.id || !state.nodes[binding.nodeId]) throw new Error('Scroll binding requires an existing target node.');
  if (binding.timelineId && !state.timelines[binding.timelineId]) {
    throw new Error(`Scroll binding references missing timeline ${binding.timelineId}.`);
  }
  if (
    !Number.isFinite(binding.start) ||
    !Number.isFinite(binding.end) ||
    binding.start < 0 ||
    binding.start >= binding.end ||
    binding.end > 1 ||
    !Number.isFinite(binding.parallax)
  ) {
    throw new Error('Scroll binding range or parallax value is invalid.');
  }
  return {
    intent: 'scroll-binding',
    commands: [{ type: 'upsertScrollBinding', binding: clone(binding) }],
    nextSelection: { nodeIds: [binding.nodeId], anchorId: binding.nodeId },
  };
};

/** Removes one authored scroll binding while preserving its target node and timeline. */
export const createDeleteScrollBindingViuBatch = (state: ViuProjectState, bindingId: ViuId): ViuAuthoringBatch => {
  const binding = state.scrollBindings?.[bindingId];
  if (!binding) throw new Error(`Scroll binding ${bindingId} does not exist.`);
  return {
    intent: 'scroll-binding',
    commands: [{ type: 'deleteScrollBinding', bindingId }],
    nextSelection: { nodeIds: [binding.nodeId], anchorId: binding.nodeId },
  };
};
