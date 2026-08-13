/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ViuCommand,
  ViuConflict,
  ViuDiagnostic,
  ViuId,
  ViuInteraction,
  ViuNode,
  ViuProjectState,
  ViuTransaction,
  ViuTransactionResult,
} from './types';
import { validateViuProject, validateViuProjectStructure } from './validation';

type CommandApplication = {
  normalized: ViuCommand;
  inverse: ViuCommand[];
  changedNodeIds: ViuId[];
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizedIndex(index: number | undefined, length: number): number {
  if (index === undefined) return length;
  return Math.max(0, Math.min(Math.trunc(index), length));
}

function assertNode(state: ViuProjectState, nodeId: ViuId): ViuNode {
  const node = state.nodes[nodeId];
  if (!node) throw new Error(`Node ${nodeId} does not exist.`);
  return node;
}

function assertCanParent(state: ViuProjectState, nodeId: ViuId, parentId: ViuId | null): void {
  if (parentId === null) {
    if (!Object.values(state.screens).some((screen) => screen.rootNodeId === nodeId)) {
      throw new Error('Only a screen root can have a null parent.');
    }
    return;
  }
  assertNode(state, parentId);
  let current: ViuId | null = parentId;
  while (current !== null) {
    if (current === nodeId) throw new Error(`Reparenting ${nodeId} below ${parentId} would create a cycle.`);
    current = state.nodes[current]?.parentId ?? null;
  }
}

function removeFromParent(state: ViuProjectState, node: ViuNode): number {
  if (node.parentId === null) return 0;
  const parent = assertNode(state, node.parentId);
  const index = parent.childIds.indexOf(node.id);
  if (index < 0) throw new Error(`Parent ${parent.id} does not contain node ${node.id}.`);
  parent.childIds.splice(index, 1);
  parent.version += 1;
  return index;
}

function addToParent(state: ViuProjectState, nodeId: ViuId, parentId: ViuId | null, index?: number): number {
  if (parentId === null) return 0;
  const parent = assertNode(state, parentId);
  const existingIndex = parent.childIds.indexOf(nodeId);
  if (existingIndex >= 0) parent.childIds.splice(existingIndex, 1);
  const targetIndex = normalizedIndex(index, parent.childIds.length);
  parent.childIds.splice(targetIndex, 0, nodeId);
  parent.version += 1;
  return targetIndex;
}

function interactionTouchesNodes(interaction: ViuInteraction, nodeIds: Set<ViuId>): boolean {
  if (nodeIds.has(interaction.sourceNodeId)) return true;
  const actions = interaction.actions?.length ? interaction.actions : [interaction.action];
  return actions.some(
    (action) =>
      (action.type === 'openOverlay' || action.type === 'scrollTo' || action.type === 'closeOverlay') &&
      Boolean(action.targetNodeId && nodeIds.has(action.targetNodeId))
  );
}

function disconnectInteraction(state: ViuProjectState, interactionId: ViuId): ViuInteraction {
  const interaction = state.interactions[interactionId];
  if (!interaction) throw new Error(`Interaction ${interactionId} does not exist.`);
  const flow = state.flows[interaction.flowId];
  if (flow) flow.interactionIds = flow.interactionIds.filter((id) => id !== interactionId);
  const source = state.nodes[interaction.sourceNodeId];
  if (source) {
    source.behaviorBindings = source.behaviorBindings.filter((id) => id !== interactionId);
    source.version += 1;
  }
  delete state.interactions[interactionId];
  return interaction;
}

function applyCommand(state: ViuProjectState, command: ViuCommand): CommandApplication {
  switch (command.type) {
    case 'insertNode': {
      if (state.nodes[command.node.id]) throw new Error(`Node ${command.node.id} already exists.`);
      assertCanParent(state, command.node.id, command.parentId);
      const node = clone({ ...command.node, parentId: command.parentId });
      state.nodes[node.id] = node;
      const index = addToParent(state, node.id, command.parentId, command.index);
      return {
        normalized: { type: 'insertNode', node: clone(node), parentId: command.parentId, index },
        inverse: [{ type: 'deleteNode', nodeId: node.id }],
        changedNodeIds: command.parentId ? [node.id, command.parentId] : [node.id],
      };
    }
    case 'updateNode': {
      const node = assertNode(state, command.nodeId);
      const inversePatch = Object.fromEntries(
        Object.keys(command.patch).map((key) => [key, clone(node[key as keyof ViuNode])])
      ) as typeof command.patch;
      const patch = clone(command.patch);
      Object.assign(node, patch);
      node.version += 1;
      return {
        normalized: { ...command, patch },
        inverse: [{ type: 'updateNode', nodeId: node.id, patch: inversePatch }],
        changedNodeIds: [node.id],
      };
    }
    case 'deleteNode': {
      const root = assertNode(state, command.nodeId);
      if (root.parentId === null) throw new Error('A screen root cannot be deleted by a node command.');
      const subtreeIds: ViuId[] = [];
      const collect = (nodeId: ViuId): void => {
        subtreeIds.push(nodeId);
        for (const childId of assertNode(state, nodeId).childIds) collect(childId);
      };
      collect(root.id);
      const deletedComponent = Object.values(state.components).find((component) =>
        subtreeIds.includes(component.rootNodeId)
      );
      if (deletedComponent) {
        throw new Error(`Component ${deletedComponent.id} must be removed before deleting its main node.`);
      }
      const deletedNodes = subtreeIds.map((nodeId) => clone(assertNode(state, nodeId)));
      const originalIndexes = new Map(
        deletedNodes.map((node) => [node.id, node.parentId ? state.nodes[node.parentId]!.childIds.indexOf(node.id) : 0])
      );
      const deletedSet = new Set(subtreeIds);
      const deletedInteractions = Object.values(state.interactions).filter((interaction) =>
        interactionTouchesNodes(interaction, deletedSet)
      );
      for (const interaction of deletedInteractions) disconnectInteraction(state, interaction.id);
      const affectedTimelines = Object.values(state.timelines)
        .filter((timeline) => timeline.tracks?.some((track) => deletedSet.has(track.nodeId)))
        .map((timeline) => clone(timeline));
      for (const timeline of affectedTimelines) {
        state.timelines[timeline.id]!.tracks = timeline.tracks?.filter((track) => !deletedSet.has(track.nodeId));
      }
      const deletedScrollBindings = Object.values(state.scrollBindings ?? {})
        .filter((binding) => deletedSet.has(binding.nodeId))
        .map((binding) => clone(binding));
      for (const binding of deletedScrollBindings) delete state.scrollBindings![binding.id];
      const parentId = root.parentId;
      removeFromParent(state, root);
      for (const nodeId of subtreeIds) delete state.nodes[nodeId];
      const restoreNodes: ViuCommand[] = deletedNodes.map((node) => ({
        type: 'insertNode',
        node,
        parentId: node.parentId,
        index: originalIndexes.get(node.id),
      }));
      return {
        normalized: command,
        inverse: [
          ...restoreNodes,
          ...affectedTimelines.map(
            (timeline): ViuCommand => ({
              type: 'updateTimeline',
              timelineId: timeline.id,
              patch: { tracks: timeline.tracks },
            })
          ),
          ...deletedScrollBindings.map((binding): ViuCommand => ({ type: 'upsertScrollBinding', binding })),
          ...deletedInteractions.map((interaction): ViuCommand => ({ type: 'connectInteraction', interaction })),
        ],
        changedNodeIds: [...subtreeIds, parentId],
      };
    }
    case 'reparentNode': {
      const node = assertNode(state, command.nodeId);
      assertCanParent(state, node.id, command.parentId);
      const oldParentId = node.parentId;
      const oldIndex = removeFromParent(state, node);
      node.parentId = command.parentId;
      const index = addToParent(state, node.id, command.parentId, command.index);
      node.version += 1;
      return {
        normalized: { ...command, index },
        inverse: [{ type: 'reparentNode', nodeId: node.id, parentId: oldParentId, index: oldIndex }],
        changedNodeIds: [
          ...new Set([node.id, oldParentId, command.parentId].filter((id): id is string => id !== null)),
        ],
      };
    }
    case 'reorderNode': {
      const node = assertNode(state, command.nodeId);
      if (node.parentId === null) throw new Error('Screen roots cannot be reordered as child nodes.');
      const parent = assertNode(state, node.parentId);
      const oldIndex = parent.childIds.indexOf(node.id);
      parent.childIds.splice(oldIndex, 1);
      const index = normalizedIndex(command.index, parent.childIds.length);
      parent.childIds.splice(index, 0, node.id);
      parent.version += 1;
      return {
        normalized: { ...command, index },
        inverse: [{ type: 'reorderNode', nodeId: node.id, index: oldIndex }],
        changedNodeIds: [node.id, parent.id],
      };
    }
    case 'createComponent': {
      const component = clone(command.component);
      if (state.components[component.id]) throw new Error(`Component ${component.id} already exists.`);
      const root = state.nodes[component.rootNodeId];
      if (!root) {
        throw new Error(`Component ${component.id} references missing root ${component.rootNodeId}.`);
      }
      if (root.parentId === null) throw new Error('A screen root cannot become a component.');
      if (Object.values(state.components).some((entry) => entry.rootNodeId === component.rootNodeId)) {
        throw new Error(`Node ${component.rootNodeId} is already a component root.`);
      }
      state.components[component.id] = component;
      return {
        normalized: { type: 'createComponent', component: clone(component) },
        inverse: [{ type: 'deleteComponent', componentId: component.id }],
        changedNodeIds: [component.rootNodeId],
      };
    }
    case 'updateComponent': {
      const component = state.components[command.componentId];
      if (!component) throw new Error(`Component ${command.componentId} does not exist.`);
      const inversePatch = Object.fromEntries(
        Object.keys(command.patch).map((key) => [key, clone(component[key as keyof typeof component])])
      ) as typeof command.patch;
      const patch = clone(command.patch);
      Object.assign(component, patch);
      component.version += 1;
      return {
        normalized: { ...command, patch },
        inverse: [{ type: 'updateComponent', componentId: component.id, patch: inversePatch }],
        changedNodeIds: [component.rootNodeId],
      };
    }
    case 'deleteComponent': {
      const component = state.components[command.componentId];
      if (!component) throw new Error(`Component ${command.componentId} does not exist.`);
      if (Object.values(state.nodes).some((node) => node.componentInstance?.componentId === component.id)) {
        throw new Error(`Component ${component.id} still has instances.`);
      }
      if (Object.values(state.componentSets).some((componentSet) => componentSet.componentIds.includes(component.id))) {
        throw new Error(`Component ${component.id} still belongs to a component set.`);
      }
      delete state.components[component.id];
      return {
        normalized: command,
        inverse: [{ type: 'createComponent', component: clone(component) }],
        changedNodeIds: [component.rootNodeId],
      };
    }
    case 'createComponentSet': {
      const componentSet = clone(command.componentSet);

      if (componentSet.componentIds.length < 2) {
        throw new Error('A component set requires at least two components.');
      }
      if (state.componentSets[componentSet.id]) {
        throw new Error(`Component set ${componentSet.id} already exists.`);
      }
      for (const componentId of componentSet.componentIds) {
        if (!state.components[componentId]) {
          throw new Error(`Component set ${componentSet.id} references missing component ${componentId}.`);
        }
      }
      state.componentSets[componentSet.id] = componentSet;
      return {
        normalized: { type: 'createComponentSet', componentSet: clone(componentSet) },
        inverse: [{ type: 'deleteComponentSet', componentSetId: componentSet.id }],
        changedNodeIds: componentSet.componentIds.map((componentId) => state.components[componentId]!.rootNodeId),
      };
    }
    case 'updateComponentSet': {
      const componentSet = state.componentSets[command.componentSetId];
      if (!componentSet) throw new Error(`Component set ${command.componentSetId} does not exist.`);
      const inversePatch = Object.fromEntries(
        Object.keys(command.patch).map((key) => [key, clone(componentSet[key as keyof typeof componentSet])])
      ) as typeof command.patch;
      const patch = clone(command.patch);
      Object.assign(componentSet, patch);
      componentSet.version += 1;
      return {
        normalized: { ...command, patch },
        inverse: [{ type: 'updateComponentSet', componentSetId: componentSet.id, patch: inversePatch }],
        changedNodeIds: componentSet.componentIds
          .map((componentId) => state.components[componentId]?.rootNodeId)
          .filter((nodeId): nodeId is ViuId => Boolean(nodeId)),
      };
    }
    case 'deleteComponentSet': {
      const componentSet = state.componentSets[command.componentSetId];
      if (!componentSet) throw new Error(`Component set ${command.componentSetId} does not exist.`);
      if (Object.values(state.components).some((component) => component.componentSetId === componentSet.id)) {
        throw new Error(`Component set ${componentSet.id} is still assigned to components.`);
      }
      delete state.componentSets[componentSet.id];
      return {
        normalized: command,
        inverse: [{ type: 'createComponentSet', componentSet: clone(componentSet) }],
        changedNodeIds: componentSet.componentIds
          .map((componentId) => state.components[componentId]?.rootNodeId)
          .filter((nodeId): nodeId is ViuId => Boolean(nodeId)),
      };
    }
    case 'upsertVariableCollection': {
      const collection = clone(command.collection);
      const previous = state.variableCollections?.[collection.id];
      state.variableCollections = { ...state.variableCollections, [collection.id]: collection };
      return {
        normalized: { type: 'upsertVariableCollection', collection: clone(collection) },
        inverse: previous
          ? [{ type: 'upsertVariableCollection', collection: clone(previous) }]
          : [{ type: 'deleteVariableCollection', collectionId: collection.id }],
        changedNodeIds: [],
      };
    }
    case 'deleteVariableCollection': {
      const collection = state.variableCollections?.[command.collectionId];
      if (!collection) throw new Error(`Variable collection ${command.collectionId} does not exist.`);
      if (
        Object.values(state.variables).some(
          (variable) => 'collectionId' in variable && variable.collectionId === collection.id
        )
      ) {
        throw new Error(`Variable collection ${collection.id} still contains variables.`);
      }
      delete state.variableCollections![collection.id];
      const previousModeId = state.activeVariableModes?.[collection.id] ?? null;
      if (state.activeVariableModes) delete state.activeVariableModes[collection.id];
      return {
        normalized: command,
        inverse: [
          { type: 'upsertVariableCollection', collection: clone(collection) },
          ...(previousModeId
            ? [{ type: 'setVariableMode' as const, collectionId: collection.id, modeId: previousModeId }]
            : []),
        ],
        changedNodeIds: [],
      };
    }
    case 'upsertVariable': {
      const variable = clone(command.variable);
      const previous = state.variables[variable.id];
      state.variables[variable.id] = variable;
      return {
        normalized: { type: 'upsertVariable', variable: clone(variable) },
        inverse:
          previous && 'collectionId' in previous
            ? [{ type: 'upsertVariable', variable: clone(previous) }]
            : [{ type: 'deleteVariable', variableId: variable.id }],
        changedNodeIds: Object.values(state.nodes)
          .filter((node) =>
            Object.values(node.variableBindings ?? {}).some((binding) => binding?.variableId === variable.id)
          )
          .map((node) => node.id),
      };
    }
    case 'deleteVariable': {
      const variable = state.variables[command.variableId];
      if (!variable || !('collectionId' in variable)) {
        throw new Error(`Variable ${command.variableId} does not exist or must be normalized first.`);
      }
      delete state.variables[command.variableId];
      return {
        normalized: command,
        inverse: [{ type: 'upsertVariable', variable: clone(variable) }],
        changedNodeIds: Object.values(state.nodes)
          .filter((node) =>
            Object.values(node.variableBindings ?? {}).some((binding) => binding?.variableId === variable.id)
          )
          .map((node) => node.id),
      };
    }
    case 'setVariableMode': {
      const collection = state.variableCollections?.[command.collectionId];
      if (!collection) throw new Error(`Variable collection ${command.collectionId} does not exist.`);
      if (command.modeId !== null && !collection.modes[command.modeId]) {
        throw new Error(`Mode ${command.modeId} does not belong to collection ${collection.id}.`);
      }
      const previousModeId = state.activeVariableModes?.[collection.id] ?? null;
      state.activeVariableModes = { ...state.activeVariableModes };
      if (command.modeId === null) delete state.activeVariableModes[collection.id];
      else state.activeVariableModes[collection.id] = command.modeId;
      const variableIds = new Set(
        Object.values(state.variables)
          .filter((variable) => 'collectionId' in variable && variable.collectionId === collection.id)
          .map((variable) => variable.id)
      );
      return {
        normalized: command,
        inverse: [{ type: 'setVariableMode', collectionId: collection.id, modeId: previousModeId }],
        changedNodeIds: Object.values(state.nodes)
          .filter((node) =>
            Object.values(node.variableBindings ?? {}).some((binding) => binding && variableIds.has(binding.variableId))
          )
          .map((node) => node.id),
      };
    }
    case 'upsertBreakpoint': {
      const breakpoint = clone(command.breakpoint);
      const previous = state.breakpoints?.[breakpoint.id];
      state.breakpoints = { ...state.breakpoints, [breakpoint.id]: breakpoint };
      return {
        normalized: { type: 'upsertBreakpoint', breakpoint: clone(breakpoint) },
        inverse: previous
          ? [{ type: 'upsertBreakpoint', breakpoint: clone(previous) }]
          : [{ type: 'deleteBreakpoint', breakpointId: breakpoint.id }],
        changedNodeIds: Object.values(state.nodes)
          .filter((node) => Boolean(node.responsiveOverrides?.[breakpoint.id]))
          .map((node) => node.id),
      };
    }
    case 'deleteBreakpoint': {
      const breakpoint = state.breakpoints?.[command.breakpointId];
      if (!breakpoint) throw new Error(`Breakpoint ${command.breakpointId} does not exist.`);
      if (Object.values(state.nodes).some((node) => node.responsiveOverrides?.[breakpoint.id])) {
        throw new Error(`Breakpoint ${breakpoint.id} still has node overrides.`);
      }
      delete state.breakpoints![breakpoint.id];
      return {
        normalized: command,
        inverse: [{ type: 'upsertBreakpoint', breakpoint: clone(breakpoint) }],
        changedNodeIds: [],
      };
    }
    case 'setGuides': {
      const previous = clone(state.guides ?? []);
      state.guides = clone(command.guides);
      return {
        normalized: { type: 'setGuides', guides: clone(command.guides) },
        inverse: [{ type: 'setGuides', guides: previous }],
        changedNodeIds: [],
      };
    }
    case 'setSnapSettings': {
      const previous = state.snapSettings ? clone(state.snapSettings) : null;
      state.snapSettings = command.settings ? clone(command.settings) : undefined;
      return {
        normalized: { type: 'setSnapSettings', settings: command.settings ? clone(command.settings) : null },
        inverse: [{ type: 'setSnapSettings', settings: previous }],
        changedNodeIds: [],
      };
    }
    case 'createTimeline': {
      const timeline = clone(command.timeline);
      if (state.timelines[timeline.id]) throw new Error(`Timeline ${timeline.id} already exists.`);
      state.timelines[timeline.id] = timeline;
      return {
        normalized: { type: 'createTimeline', timeline: clone(timeline) },
        inverse: [{ type: 'deleteTimeline', timelineId: timeline.id }],
        changedNodeIds: [...new Set((timeline.tracks ?? []).map((track) => track.nodeId))],
      };
    }
    case 'updateTimeline': {
      const timeline = state.timelines[command.timelineId];
      if (!timeline) throw new Error(`Timeline ${command.timelineId} does not exist.`);
      const previousNodeIds = (timeline.tracks ?? []).map((track) => track.nodeId);
      const inversePatch = Object.fromEntries(
        Object.keys(command.patch).map((key) => [key, clone(timeline[key as keyof typeof timeline])])
      ) as typeof command.patch;
      const patch = clone(command.patch);
      Object.assign(timeline, patch, { id: timeline.id });
      return {
        normalized: { type: 'updateTimeline', timelineId: timeline.id, patch },
        inverse: [{ type: 'updateTimeline', timelineId: timeline.id, patch: inversePatch }],
        changedNodeIds: [...new Set([...previousNodeIds, ...(timeline.tracks ?? []).map((track) => track.nodeId)])],
      };
    }
    case 'deleteTimeline': {
      const timeline = state.timelines[command.timelineId];
      if (!timeline) throw new Error(`Timeline ${command.timelineId} does not exist.`);
      const usedByInteraction = Object.values(state.interactions).some((interaction) => {
        const actions = interaction.actions?.length ? interaction.actions : [interaction.action];
        return actions.some(
          (action) =>
            (action.type === 'playTimeline' || action.type === 'pauseTimeline' || action.type === 'seekTimeline') &&
            action.timelineId === timeline.id
        );
      });
      if (usedByInteraction) throw new Error(`Timeline ${timeline.id} is still used by an interaction.`);
      if (Object.values(state.scrollBindings ?? {}).some((binding) => binding.timelineId === timeline.id)) {
        throw new Error(`Timeline ${timeline.id} is still used by a scroll binding.`);
      }
      delete state.timelines[timeline.id];
      return {
        normalized: command,
        inverse: [{ type: 'createTimeline', timeline: clone(timeline) }],
        changedNodeIds: [...new Set((timeline.tracks ?? []).map((track) => track.nodeId))],
      };
    }
    case 'upsertScrollBinding': {
      const binding = clone(command.binding);
      const previous = state.scrollBindings?.[binding.id];
      state.scrollBindings = { ...state.scrollBindings, [binding.id]: binding };
      return {
        normalized: { type: 'upsertScrollBinding', binding: clone(binding) },
        inverse: previous
          ? [{ type: 'upsertScrollBinding', binding: clone(previous) }]
          : [{ type: 'deleteScrollBinding', bindingId: binding.id }],
        changedNodeIds: [...new Set([binding.nodeId, ...(previous ? [previous.nodeId] : [])])],
      };
    }
    case 'deleteScrollBinding': {
      const binding = state.scrollBindings?.[command.bindingId];
      if (!binding) throw new Error(`Scroll binding ${command.bindingId} does not exist.`);
      delete state.scrollBindings![binding.id];
      return {
        normalized: command,
        inverse: [{ type: 'upsertScrollBinding', binding: clone(binding) }],
        changedNodeIds: [binding.nodeId],
      };
    }

    case 'connectInteraction': {
      const interaction = command.interaction;
      if (state.interactions[interaction.id]) throw new Error(`Interaction ${interaction.id} already exists.`);
      const source = assertNode(state, interaction.sourceNodeId);
      const flow = state.flows[interaction.flowId];
      if (!flow) throw new Error(`Flow ${interaction.flowId} does not exist.`);
      state.interactions[interaction.id] = clone(interaction);
      if (!flow.interactionIds.includes(interaction.id)) flow.interactionIds.push(interaction.id);
      if (!source.behaviorBindings.includes(interaction.id)) source.behaviorBindings.push(interaction.id);
      source.version += 1;
      return {
        normalized: { type: 'connectInteraction', interaction: clone(interaction) },
        inverse: [{ type: 'disconnectInteraction', interactionId: interaction.id }],
        changedNodeIds: [source.id],
      };
    }
    case 'disconnectInteraction': {
      const interaction = disconnectInteraction(state, command.interactionId);
      return {
        normalized: command,
        inverse: [{ type: 'connectInteraction', interaction }],
        changedNodeIds: [interaction.sourceNodeId],
      };
    }
  }
}

function rejectedResult(
  state: ViuProjectState,
  conflict: ViuConflict,
  diagnostics: ViuDiagnostic[] = validateViuProject(state)
): ViuTransactionResult {
  return {
    accepted: false,
    state,
    revision: state.revision,
    normalizedCommands: [],
    inverseCommands: [],
    diagnostics,
    changedNodeIds: [],
    conflict,
  };
}

/** Applies a transaction atomically and returns a candidate state plus undo commands. */
export function applyViuTransaction(state: ViuProjectState, transaction: ViuTransaction): ViuTransactionResult {
  if (transaction.documentId !== state.projectId) {
    return rejectedResult(state, { kind: 'command', message: 'Transaction document does not match the VIU project.' });
  }
  if (transaction.baseRevision !== state.revision) {
    return rejectedResult(state, {
      kind: 'revision',
      message: `Expected revision ${state.revision}, received ${transaction.baseRevision}.`,
      expected: state.revision,
      actual: transaction.baseRevision,
    });
  }
  for (const precondition of transaction.preconditions ?? []) {
    const actual = state.nodes[precondition.nodeId]?.version;
    if (actual !== precondition.expectedVersion) {
      return rejectedResult(state, {
        kind: 'precondition',
        message: `Node ${precondition.nodeId} changed before the transaction could be applied.`,
        expected: precondition.expectedVersion,
        actual,
      });
    }
  }

  const candidate = clone(state);
  const normalizedCommands: ViuCommand[] = [];
  let inverseCommands: ViuCommand[] = [];
  const changedNodeIds = new Set<ViuId>();
  try {
    for (const command of transaction.commands) {
      const applied = applyCommand(candidate, command);
      normalizedCommands.push(applied.normalized);
      inverseCommands.unshift(...applied.inverse);
      applied.changedNodeIds.forEach((id) => changedNodeIds.add(id));
    }
  } catch (error) {
    return rejectedResult(state, {
      kind: 'command',
      message: error instanceof Error ? error.message : 'VIU command failed.',
    });
  }
  const structural = validateViuProjectStructure(candidate);
  if ('message' in structural) {
    return rejectedResult(state, { kind: 'validation', message: structural.message }, validateViuProject(candidate));
  }

  if (transaction.mode === 'commit') candidate.revision += 1;
  return {
    accepted: true,
    state: candidate,
    revision: candidate.revision,
    normalizedCommands,
    inverseCommands,
    diagnostics: validateViuProject(candidate),
    changedNodeIds: [...changedNodeIds],
  };
}
