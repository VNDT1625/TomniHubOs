/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ViuComponentDefinition, ViuComponentInstance, ViuId, ViuNode, ViuProjectState } from './types';

export type ViuResolvedComponentInstance = {
  component: ViuComponentDefinition;
  rootId: ViuId;
  nodes: Record<ViuId, ViuNode>;
  sourceNodeIdByResolvedId: Record<ViuId, ViuId>;
};

const clone = <T>(value: T): T => structuredClone(value);

const virtualNodeId = (instanceId: ViuId, sourceNodeId: ViuId, sourceRootId: ViuId): ViuId =>
  sourceNodeId === sourceRootId ? instanceId : `${instanceId}::${sourceNodeId}`;

/** Returns the component definition whose editable main node is the supplied node. */
export const getViuComponentForRoot = (state: ViuProjectState, rootNodeId: ViuId): ViuComponentDefinition | undefined =>
  Object.values(state.components).find((component) => component.rootNodeId === rootNodeId);

/** Resolves the variant selected by an instance, falling back to its main component. */
export const resolveViuComponentDefinition = (
  state: ViuProjectState,
  instance: ViuComponentInstance
): ViuComponentDefinition | undefined => {
  const main = state.components[instance.componentId];
  if (!main?.componentSetId) return main;
  const componentSet = state.componentSets[main.componentSetId];
  if (!componentSet) return undefined;
  const axes = Object.keys(componentSet.variantAxes);
  if (
    Object.keys(instance.variantSelection).length !== axes.length ||
    axes.some((axis) => !Object.hasOwn(instance.variantSelection, axis))
  ) {
    return undefined;
  }
  const matches = componentSet.componentIds
    .map((componentId) => state.components[componentId])
    .filter(
      (component): component is ViuComponentDefinition =>
        Boolean(component) &&
        axes.every((axis) => component.variantProperties[axis] === instance.variantSelection[axis])
    );
  return matches.length === 1 ? matches[0] : undefined;
};

/**
 * Materializes an instance into a renderer-safe virtual node tree.
 * The real instance id remains the virtual root id so selection and interactions stay stable.
 */
export const resolveViuComponentInstance = (
  state: ViuProjectState,
  instanceNodeOrId: ViuNode | ViuId
): ViuResolvedComponentInstance | undefined => {
  const instanceNode = typeof instanceNodeOrId === 'string' ? state.nodes[instanceNodeOrId] : instanceNodeOrId;
  if (!instanceNode?.componentInstance) return undefined;
  const component = resolveViuComponentDefinition(state, instanceNode.componentInstance);
  const sourceRoot = component ? state.nodes[component.rootNodeId] : undefined;
  if (!component || !sourceRoot) return undefined;

  const sourceIds: ViuId[] = [];
  const visit = (sourceId: ViuId): void => {
    const source = state.nodes[sourceId];
    if (!source) return;
    sourceIds.push(sourceId);
    source.childIds.forEach(visit);
  };
  visit(sourceRoot.id);

  const nodes: Record<ViuId, ViuNode> = {};
  const sourceNodeIdByResolvedId: Record<ViuId, ViuId> = {};
  for (const sourceId of sourceIds) {
    const source = state.nodes[sourceId]!;
    const resolvedId = virtualNodeId(instanceNode.id, sourceId, sourceRoot.id);
    const isRoot = sourceId === sourceRoot.id;
    const resolvedParentId = isRoot
      ? instanceNode.parentId
      : source.parentId
        ? virtualNodeId(instanceNode.id, source.parentId, sourceRoot.id)
        : instanceNode.id;
    nodes[resolvedId] = {
      ...clone(source),
      id: resolvedId,
      parentId: resolvedParentId,
      childIds: source.childIds.map((childId) => virtualNodeId(instanceNode.id, childId, sourceRoot.id)),
      ...(isRoot
        ? {
            version: instanceNode.version,
            name: instanceNode.name,
            localTransform: clone(instanceNode.localTransform),
            size: clone(instanceNode.size),
            positionMode: instanceNode.positionMode,
            sizing: clone(instanceNode.sizing),
            constraints: clone(instanceNode.constraints),
            style: {
              ...clone(source.style),
              ...clone(instanceNode.componentInstance?.styleOverrides ?? {}),
            },
            semantics: {
              ...clone(source.semantics),
              ...clone(instanceNode.semantics),
              label: instanceNode.semantics.label || source.semantics.label,
            },
            behaviorBindings: clone(instanceNode.behaviorBindings),
            visible: instanceNode.visible,
            locked: instanceNode.locked,
            provenance: clone(instanceNode.provenance),
          }
        : {}),
      componentInstance: undefined,
    };
    sourceNodeIdByResolvedId[resolvedId] = sourceId;
  }

  for (const property of Object.values(component.propertyDefinitions)) {
    const resolvedId = virtualNodeId(instanceNode.id, property.targetNodeId, sourceRoot.id);
    const target = nodes[resolvedId];
    if (!target) continue;
    const value = instanceNode.componentInstance.propertyValues[property.id] ?? property.defaultValue;
    if (property.type === 'text' && typeof value === 'string') {
      target.content = { ...target.content, text: value };
    }
    if (property.type === 'boolean' && typeof value === 'boolean') {
      target.visible = value;
    }
  }

  return { component, rootId: instanceNode.id, nodes, sourceNodeIdByResolvedId };
};
