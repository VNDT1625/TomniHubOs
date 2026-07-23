/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getViuComponentForRoot, resolveViuComponentDefinition, resolveViuComponentInstance } from '../components';
import { createViuNode } from '../starter';
import type {
  ViuCommand,
  ViuComponentDefinition,
  ViuComponentPropertyDefinition,
  ViuComponentPropertyValue,
  ViuId,
  ViuInteraction,
  ViuNode,
  ViuProjectState,
} from '../types';
import type { ViuAuthoringBatch, ViuAuthoringIdFactory, ViuSelection } from './types';

const clone = <T>(value: T): T => structuredClone(value);

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

const selectedNode = (state: ViuProjectState, selection: ViuSelection): ViuNode => {
  if (selection.nodeIds.length !== 1) throw new Error('Select exactly one node.');
  const node = state.nodes[selection.nodeIds[0]!];
  if (!node) throw new Error('The selected node no longer exists.');
  return node;
};

const assertFreshProjectId = (state: ViuProjectState, id: ViuId): void => {
  if (!id || state.nodes[id] || state.interactions[id] || state.components[id] || state.componentSets[id]) {
    throw new Error(`Project entity id ${id} is already in use.`);
  }
};

const exposedProperties = (
  state: ViuProjectState,
  componentId: ViuId,
  rootNodeId: ViuId
): Record<ViuId, ViuComponentPropertyDefinition> => {
  const definitions: Record<ViuId, ViuComponentPropertyDefinition> = {};
  for (const nodeId of collectSubtreeIds(state, rootNodeId)) {
    const node = state.nodes[nodeId]!;
    if (typeof node.content?.text === 'string') {
      const propertyId = `${componentId}:text:${nodeId}`;
      definitions[propertyId] = {
        id: propertyId,
        name: node.name,
        type: 'text',
        targetNodeId: nodeId,
        targetProperty: 'content.text',
        defaultValue: node.content.text,
      };
    }
    if (nodeId !== rootNodeId) {
      const propertyId = `${componentId}:visible:${nodeId}`;
      definitions[propertyId] = {
        id: propertyId,
        name: node.name,
        type: 'boolean',
        targetNodeId: nodeId,
        targetProperty: 'visible',
        defaultValue: node.visible,
      };
    }
  }
  return definitions;
};

export type ViuCreateComponentOptions = {
  componentId: ViuId;
  name: string;
};

/** Registers one selected subtree as a reusable main component. */
export const createComponentViuBatch = (
  state: ViuProjectState,
  selection: ViuSelection,
  options: ViuCreateComponentOptions
): ViuAuthoringBatch => {
  const root = selectedNode(state, selection);
  if (root.parentId === null) throw new Error('A screen root cannot become a component.');
  if (root.type === 'component-instance') throw new Error('An instance cannot become a main component.');
  if (getViuComponentForRoot(state, root.id)) throw new Error('The selected node is already a component.');
  assertFreshProjectId(state, options.componentId);
  const component: ViuComponentDefinition = {
    id: options.componentId,
    version: 1,
    name: options.name.trim() || root.name,
    rootNodeId: root.id,
    variantProperties: {},
    propertyDefinitions: exposedProperties(state, options.componentId, root.id),
  };
  return {
    intent: 'component-create',
    commands: [{ type: 'createComponent', component }],
    nextSelection: selection,
  };
};

export type ViuCreateInstanceOptions = {
  instanceId: ViuId;
  componentId?: ViuId;
  name?: string;
  offset?: { x: number; y: number };
  targetParentId?: ViuId;
  position?: { x: number; y: number };
};

/** Renames a main component through the same transactional history as canvas edits. */
export const createRenameComponentViuBatch = (
  state: ViuProjectState,
  componentId: ViuId,
  name: string
): ViuAuthoringBatch => {
  if (!state.components[componentId]) throw new Error(`Component ${componentId} does not exist.`);
  const nextName = name.trim();
  if (!nextName) throw new Error('Component name is required.');
  return {
    intent: 'component-update',
    commands: [{ type: 'updateComponent', componentId, patch: { name: nextName } }],
  };
};

/** Inserts an instance without copying its source subtree, optionally into another authorable container. */
export const createComponentInstanceViuBatch = (
  state: ViuProjectState,
  selection: ViuSelection,
  options: ViuCreateInstanceOptions
): ViuAuthoringBatch => {
  const selected = selectedNode(state, selection);
  const component =
    (options.componentId ? state.components[options.componentId] : undefined) ??
    getViuComponentForRoot(state, selected.id);
  if (!component) throw new Error('The selected node is not a main component.');
  const source = state.nodes[component.rootNodeId];
  if (!source || source.parentId === null) throw new Error('The component source is not authorable.');
  assertFreshProjectId(state, options.instanceId);
  const targetParentId = options.targetParentId ?? source.parentId;
  const targetParent = state.nodes[targetParentId];
  if (!targetParent) throw new Error(`Target parent ${targetParentId} does not exist.`);
  if (targetParent.type === 'component-instance')
    throw new Error('A component instance cannot contain authored children.');
  const offset = options.offset ?? { x: 24, y: 24 };
  const position = options.position ?? {
    x: source.localTransform[4] + offset.x,
    y: source.localTransform[5] + offset.y,
  };
  const instance = createViuNode({
    id: options.instanceId,
    name: options.name?.trim() || `${component.name} instance`,
    type: 'component-instance',
    parentId: targetParentId,
    x: position.x,
    y: position.y,
    width: source.size.width,
    height: source.size.height,
    semantics: clone(source.semantics),
  });
  instance.sizing = clone(source.sizing);
  instance.constraints = clone(source.constraints);
  instance.positionMode = options.targetParentId
    ? targetParent.layout && targetParent.layout.mode !== 'none'
      ? 'flow'
      : 'absolute'
    : source.positionMode;

  instance.componentInstance = {
    componentId: component.id,
    variantSelection: clone(component.variantProperties),
    propertyValues: {},
    styleOverrides: {},
  };
  const index = options.targetParentId
    ? targetParent.childIds.length
    : (targetParent.childIds.indexOf(source.id) ?? -1) + 1;
  return {
    intent: 'component-instance',
    commands: [{ type: 'insertNode', node: instance, parentId: targetParentId, index }],
    nextSelection: { nodeIds: [instance.id], anchorId: instance.id },
  };
};

export type ViuCreateComponentSetOptions = {
  componentSetId: ViuId;
  name: string;
  axisName?: string;
};

/** Combines selected main components into one variant set with a deterministic first axis. */
export const createComponentSetViuBatch = (
  state: ViuProjectState,
  selection: ViuSelection,
  options: ViuCreateComponentSetOptions
): ViuAuthoringBatch => {
  const components = selection.nodeIds
    .map((nodeId) => getViuComponentForRoot(state, nodeId))
    .filter((component): component is ViuComponentDefinition => Boolean(component));
  if (components.length < 2 || components.length !== selection.nodeIds.length) {
    throw new Error('Select at least two main components.');
  }
  if (new Set(components.map((component) => component.id)).size !== components.length) {
    throw new Error('The component selection contains duplicates.');
  }
  if (components.some((component) => component.componentSetId)) {
    throw new Error('A selected component already belongs to a variant set.');
  }
  assertFreshProjectId(state, options.componentSetId);
  const axisName = options.axisName?.trim() || 'State';
  const usedValues = new Map<string, number>();
  const values = components.map((component) => {
    const count = (usedValues.get(component.name) ?? 0) + 1;
    usedValues.set(component.name, count);
    return count === 1 ? component.name : `${component.name} ${count}`;
  });
  const commands: ViuCommand[] = [
    {
      type: 'createComponentSet',
      componentSet: {
        id: options.componentSetId,
        version: 1,
        name: options.name.trim() || axisName,
        componentIds: components.map((component) => component.id),
        variantAxes: { [axisName]: values },
      },
    },
    ...components.map(
      (component, index): ViuCommand => ({
        type: 'updateComponent',
        componentId: component.id,
        patch: {
          componentSetId: options.componentSetId,
          variantProperties: {
            ...component.variantProperties,
            [axisName]: values[index]!,
          },
        },
      })
    ),
  ];
  return { intent: 'component-variants', commands, nextSelection: selection };
};

const requireInstance = (state: ViuProjectState, nodeId: ViuId): ViuNode => {
  const node = state.nodes[nodeId];
  if (!node?.componentInstance) throw new Error(`Node ${nodeId} is not a component instance.`);
  return node;
};

/** Applies one typed component property override to an instance. */
export const createInstancePropertyViuBatch = (
  state: ViuProjectState,
  nodeId: ViuId,
  propertyId: ViuId,
  value: ViuComponentPropertyValue
): ViuAuthoringBatch => {
  const node = requireInstance(state, nodeId);
  const component = resolveViuComponentDefinition(state, node.componentInstance!);
  const property = component?.propertyDefinitions[propertyId];
  if (!property) throw new Error(`Component property ${propertyId} does not exist.`);
  if (
    (property.type === 'text' && typeof value !== 'string') ||
    (property.type === 'boolean' && typeof value !== 'boolean')
  ) {
    throw new Error(`Component property ${propertyId} received the wrong value type.`);
  }
  return {
    intent: 'component-property',
    commands: [
      {
        type: 'updateNode',
        nodeId,
        patch: {
          componentInstance: {
            ...clone(node.componentInstance!),
            propertyValues: {
              ...clone(node.componentInstance!.propertyValues),
              [propertyId]: value,
            },
          },
        },
      },
    ],
  };
};

/** Switches one variant axis and drops property overrides invalid for the selected variant. */
export const createInstanceVariantViuBatch = (
  state: ViuProjectState,
  nodeId: ViuId,
  axis: string,
  value: string
): ViuAuthoringBatch => {
  const node = requireInstance(state, nodeId);
  const main = state.components[node.componentInstance!.componentId];
  const componentSet = main?.componentSetId ? state.componentSets[main.componentSetId] : undefined;
  if (!componentSet?.variantAxes[axis]?.includes(value)) {
    throw new Error(`Variant ${axis}=${value} does not exist.`);
  }
  const nextInstance = {
    ...clone(node.componentInstance!),
    variantSelection: { ...clone(node.componentInstance!.variantSelection), [axis]: value },
  };
  const selectedComponent = resolveViuComponentDefinition(state, nextInstance);
  nextInstance.propertyValues = Object.fromEntries(
    Object.entries(nextInstance.propertyValues).filter(([propertyId]) =>
      Boolean(selectedComponent?.propertyDefinitions[propertyId])
    )
  );
  return {
    intent: 'component-variants',
    commands: [{ type: 'updateNode', nodeId, patch: { componentInstance: nextInstance } }],
  };
};

/** Swaps an instance to another main component while preserving compatible overrides. */
export const createSwapInstanceViuBatch = (
  state: ViuProjectState,
  nodeId: ViuId,
  componentId: ViuId
): ViuAuthoringBatch => {
  const node = requireInstance(state, nodeId);
  const target = state.components[componentId];
  if (!target) throw new Error(`Component ${componentId} does not exist.`);
  const propertyValues = Object.fromEntries(
    Object.entries(node.componentInstance!.propertyValues).filter(([propertyId, value]) => {
      const property = target.propertyDefinitions[propertyId];
      return (
        property &&
        ((property.type === 'text' && typeof value === 'string') ||
          (property.type === 'boolean' && typeof value === 'boolean'))
      );
    })
  );
  return {
    intent: 'component-instance',
    commands: [
      {
        type: 'updateNode',
        nodeId,
        patch: {
          componentInstance: {
            componentId: target.id,
            variantSelection: clone(target.variantProperties),
            propertyValues,
            styleOverrides: clone(node.componentInstance!.styleOverrides ?? {}),
          },
        },
      },
    ],
  };
};

/** Restores the instance to its main variant and clears every property override. */
export const createResetInstanceOverridesViuBatch = (state: ViuProjectState, nodeId: ViuId): ViuAuthoringBatch => {
  const node = requireInstance(state, nodeId);
  const main = state.components[node.componentInstance!.componentId];
  if (!main) throw new Error('The main component is missing.');
  return {
    intent: 'component-reset',
    commands: [
      {
        type: 'updateNode',
        nodeId,
        patch: {
          componentInstance: {
            componentId: main.id,
            variantSelection: clone(main.variantProperties),
            propertyValues: {},
            styleOverrides: {},
          },
        },
      },
    ],
  };
};

export type ViuDetachInstanceOptions = {
  idFactory: ViuAuthoringIdFactory;
};

/** Replaces a virtual instance with independent real nodes while preserving its visual result. */
export const createDetachInstanceViuBatch = (
  state: ViuProjectState,
  nodeId: ViuId,
  options: ViuDetachInstanceOptions
): ViuAuthoringBatch => {
  const instance = requireInstance(state, nodeId);
  if (instance.parentId === null) throw new Error('A root instance cannot be detached.');
  const resolved = resolveViuComponentInstance(state, instance);
  if (!resolved) throw new Error('The component source is missing.');
  const resolvedIds: ViuId[] = [];
  const visit = (resolvedId: ViuId): void => {
    const node = resolved.nodes[resolvedId];
    if (!node) return;
    resolvedIds.push(resolvedId);
    node.childIds.forEach(visit);
  };
  visit(resolved.rootId);

  const generated = new Set<ViuId>();
  const nodeIdMap = new Map<ViuId, ViuId>();
  for (const resolvedId of resolvedIds) {
    const sourceId = resolved.sourceNodeIdByResolvedId[resolvedId]!;
    const targetId = options.idFactory('node', sourceId);
    if (
      generated.has(targetId) ||
      state.nodes[targetId] ||
      state.interactions[targetId] ||
      state.components[targetId] ||
      state.componentSets[targetId]
    ) {
      throw new Error(`Authoring ID factory produced duplicate id ${targetId}.`);
    }
    generated.add(targetId);
    nodeIdMap.set(resolvedId, targetId);
  }
  const rootTargetId = nodeIdMap.get(resolved.rootId)!;
  const parent = state.nodes[instance.parentId];
  const rootIndex = parent?.childIds.indexOf(instance.id) ?? 0;
  const commands: ViuCommand[] = [{ type: 'deleteNode', nodeId: instance.id }];
  for (const resolvedId of resolvedIds) {
    const source = resolved.nodes[resolvedId]!;
    const isRoot = resolvedId === resolved.rootId;
    const targetId = nodeIdMap.get(resolvedId)!;
    const targetParentId = isRoot
      ? instance.parentId
      : source.parentId
        ? nodeIdMap.get(source.parentId)!
        : rootTargetId;
    const target: ViuNode = {
      ...clone(source),
      id: targetId,
      version: 1,
      name: isRoot ? resolved.component.name : source.name,
      parentId: targetParentId,
      childIds: [],
      componentInstance: undefined,
      behaviorBindings: [],
    };
    commands.push({
      type: 'insertNode',
      node: target,
      parentId: targetParentId,
      index: isRoot ? rootIndex : undefined,
    });
  }

  const interactions = Object.values(state.interactions).filter(
    (interaction) =>
      interaction.sourceNodeId === instance.id ||
      ((interaction.action.type === 'openOverlay' || interaction.action.type === 'scrollTo') &&
        interaction.action.targetNodeId === instance.id)
  );
  for (const source of interactions) {
    const sourceMoves = source.sourceNodeId === instance.id;
    const interactionId = sourceMoves ? options.idFactory('interaction', source.id) : source.id;
    if (
      sourceMoves &&
      (generated.has(interactionId) || state.interactions[interactionId] || state.nodes[interactionId])
    ) {
      throw new Error(`Authoring ID factory produced duplicate id ${interactionId}.`);
    }
    if (sourceMoves) generated.add(interactionId);
    const interaction: ViuInteraction = {
      ...clone(source),
      id: interactionId,
      version: sourceMoves ? 1 : source.version + 1,
      sourceNodeId: sourceMoves ? rootTargetId : source.sourceNodeId,
      action:
        (source.action.type === 'openOverlay' || source.action.type === 'scrollTo') &&
        source.action.targetNodeId === instance.id
          ? { ...source.action, targetNodeId: rootTargetId }
          : clone(source.action),
    };
    commands.push({ type: 'connectInteraction', interaction });
  }
  return {
    intent: 'component-detach',
    commands,
    nextSelection: { nodeIds: [rootTargetId], anchorId: rootTargetId },
  };
};
