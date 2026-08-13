/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ViuDiagnostic, ViuInteractionAction, ViuProjectState } from './types';

import { validateViuImageTransform } from './graphics/image';
import { auditViuProjectQuality } from './graphics/quality';
import { validateViuNodeStyle } from './graphics/styles';
import { validateViuVectorGeometry } from './graphics/vector';
import { validateViuDesignSystem } from './runtime/designSystem';

export type ViuStructuralValidation = { valid: true } | { valid: false; message: string };

function interactionActions(interaction: ViuProjectState['interactions'][string]): readonly ViuInteractionAction[] {
  return interaction.actions?.length ? interaction.actions : [interaction.action];
}

function actionTargetExists(state: ViuProjectState, action: ViuInteractionAction): boolean {
  switch (action.type) {
    case 'navigate':
      return Boolean(state.screens[action.targetScreenId]);
    case 'openOverlay':
    case 'scrollTo':
      return Boolean(state.nodes[action.targetNodeId]);
    case 'closeOverlay':
      return action.targetNodeId ? Boolean(state.nodes[action.targetNodeId]) : true;
    case 'back':
      return true;
    case 'setVariable':
    case 'toggleVariable':
      return Boolean(state.variables[action.variableId]);
    case 'playTimeline':
    case 'pauseTimeline':
    case 'seekTimeline':
      return Boolean(state.timelines[action.timelineId]);
  }
}

const validateTimelineAndScrollStructure = (state: ViuProjectState): string | undefined => {
  for (const [timelineId, timeline] of Object.entries(state.timelines)) {
    if (timeline.id !== timelineId) return `Timeline key ${timelineId} does not match its id.`;
    if (!timeline.name.trim()) return `Timeline ${timelineId} requires a name.`;
    if (!Number.isFinite(timeline.durationMs) || timeline.durationMs <= 0 || timeline.durationMs > 3_600_000) {
      return `Timeline ${timelineId} requires a duration between 1 and 3600000 milliseconds.`;
    }
    const tracks = timeline.tracks ?? [];
    if (tracks.length > 1_000) return `Timeline ${timelineId} contains too many tracks.`;
    if (new Set(tracks.map((track) => track.id)).size !== tracks.length) {
      return `Timeline ${timelineId} contains duplicate track ids.`;
    }
    for (const track of tracks) {
      if (!track.id.trim()) return `Timeline ${timelineId} contains a track without an id.`;
      if (!state.nodes[track.nodeId]) return `Timeline ${timelineId} track ${track.id} targets a missing node.`;
      if (track.keyframes.length > 1_000) return `Timeline ${timelineId} track ${track.id} has too many keyframes.`;
      for (const keyframe of track.keyframes) {
        if (
          !Number.isFinite(keyframe.offsetMs) ||
          keyframe.offsetMs < 0 ||
          keyframe.offsetMs > timeline.durationMs ||
          !Number.isFinite(keyframe.value)
        ) {
          return `Timeline ${timelineId} track ${track.id} contains an invalid keyframe.`;
        }
      }
    }
  }

  for (const [bindingId, binding] of Object.entries(state.scrollBindings ?? {})) {
    if (binding.id !== bindingId) return `Scroll binding key ${bindingId} does not match its id.`;
    if (!state.nodes[binding.nodeId]) return `Scroll binding ${bindingId} targets a missing node.`;
    if (binding.timelineId && !state.timelines[binding.timelineId]) {
      return `Scroll binding ${bindingId} targets a missing timeline.`;
    }
    if (
      !Number.isFinite(binding.start) ||
      !Number.isFinite(binding.end) ||
      binding.start < 0 ||
      binding.end > 1 ||
      binding.start >= binding.end ||
      !Number.isFinite(binding.parallax) ||
      Math.abs(binding.parallax) > 10_000
    ) {
      return `Scroll binding ${bindingId} has invalid progress or parallax values.`;
    }
  }
  return undefined;
};

const validateInteractionValue = (
  state: ViuProjectState,
  interactionId: string,
  action: ViuInteractionAction
): string | undefined => {
  if (action.type === 'seekTimeline') {
    const timeline = state.timelines[action.timelineId];
    if (
      !Number.isFinite(action.offsetMs) ||
      action.offsetMs < 0 ||
      (timeline && action.offsetMs > timeline.durationMs)
    ) {
      return `Interaction ${interactionId} has an invalid timeline seek offset.`;
    }
  }
  if (action.type !== 'setVariable' && action.type !== 'toggleVariable') return undefined;
  const variable = state.variables[action.variableId];
  if (!variable) return undefined;
  const expected = variable.type === 'color' ? 'string' : variable.type;
  if (action.type === 'toggleVariable' && expected !== 'boolean') {
    return `Interaction ${interactionId} can only toggle a boolean variable.`;
  }
  if (action.type === 'setVariable' && typeof action.value !== expected) {
    return `Interaction ${interactionId} sets variable ${variable.id} with an incompatible value.`;
  }
  return undefined;
};

function validateNodeGraph(state: ViuProjectState): string | undefined {
  const rootIds = new Set(Object.values(state.screens).map((screen) => screen.rootNodeId));
  for (const [nodeId, node] of Object.entries(state.nodes)) {
    if (node.id !== nodeId) return `Node map key ${nodeId} does not match node id ${node.id}.`;
    const styleError = validateViuNodeStyle(node.style);
    if (styleError) return `Node ${nodeId} ${styleError}`;
    if (node.imageTransform) {
      if (node.type !== 'image') return `Node ${nodeId} has image framing data but is not an image.`;
      const imageError = validateViuImageTransform(node.imageTransform);
      if (imageError) return `Image node ${nodeId} ${imageError}`;
    }
    if (node.type === 'vector') {
      if (!node.vector) return `Vector node ${nodeId} is missing editable geometry.`;
      const vectorError = validateViuVectorGeometry(node.vector);
      if (vectorError) return `Vector node ${nodeId} ${vectorError}`;
    } else if (node.vector) {
      return `Node ${nodeId} cannot carry vector geometry when its type is ${node.type}.`;
    }
    const overrideError = node.componentInstance?.styleOverrides
      ? validateViuNodeStyle(node.componentInstance.styleOverrides, true)
      : undefined;
    if (overrideError) return `Component instance ${nodeId} ${overrideError}`;
    if (new Set(node.childIds).size !== node.childIds.length) return `Node ${nodeId} contains duplicate children.`;
    if (node.parentId === nodeId) return `Node ${nodeId} cannot parent itself.`;
    if (node.parentId === null && !rootIds.has(nodeId)) return `Node ${nodeId} is an unowned root.`;
    if (node.parentId !== null) {
      const parent = state.nodes[node.parentId];
      if (!parent) return `Node ${nodeId} references missing parent ${node.parentId}.`;
      if (!parent.childIds.includes(nodeId)) return `Parent ${node.parentId} does not contain child ${nodeId}.`;
    }
    for (const childId of node.childIds) {
      const child = state.nodes[childId];
      if (!child) return `Node ${nodeId} references missing child ${childId}.`;
      if (child.parentId !== nodeId) return `Child ${childId} does not reference parent ${nodeId}.`;
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return false;
    if (visited.has(nodeId)) return true;
    visiting.add(nodeId);
    for (const childId of state.nodes[nodeId]?.childIds ?? []) {
      if (!visit(childId)) return false;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return true;
  };
  for (const nodeId of Object.keys(state.nodes)) {
    if (!visit(nodeId)) return `Node graph contains a cycle at ${nodeId}.`;
  }
  return undefined;
}

function validateComponents(state: ViuProjectState): string | undefined {
  const rootOwners = new Map<string, string>();
  for (const [componentId, component] of Object.entries(state.components)) {
    if (component.id !== componentId) {
      return `Component key ${componentId} does not match component id ${component.id}.`;
    }
    const root = state.nodes[component.rootNodeId];
    if (!root) return `Component ${componentId} references missing root ${component.rootNodeId}.`;
    if (root.parentId === null) return `Component ${componentId} cannot use a screen root as its main node.`;
    if (root.type === 'component-instance') {
      return `Component ${componentId} cannot use an instance as its main node.`;
    }
    const existingOwner = rootOwners.get(component.rootNodeId);
    if (existingOwner) {
      return `Components ${existingOwner} and ${componentId} share root ${component.rootNodeId}.`;
    }
    rootOwners.set(component.rootNodeId, componentId);

    const subtreeIds = new Set<string>();
    const pending = [component.rootNodeId];
    while (pending.length > 0) {
      const nodeId = pending.pop();
      if (!nodeId || subtreeIds.has(nodeId)) continue;
      subtreeIds.add(nodeId);
      pending.push(...(state.nodes[nodeId]?.childIds ?? []));
    }
    for (const [propertyId, property] of Object.entries(component.propertyDefinitions)) {
      if (property.id !== propertyId) {
        return `Component property key ${propertyId} does not match property id ${property.id}.`;
      }
      if (!subtreeIds.has(property.targetNodeId)) {
        return `Component property ${propertyId} targets a node outside component ${componentId}.`;
      }
      if (property.type === 'text' && typeof property.defaultValue !== 'string') {
        return `Component property ${propertyId} requires a string default.`;
      }
      if (property.type === 'boolean' && typeof property.defaultValue !== 'boolean') {
        return `Component property ${propertyId} requires a boolean default.`;
      }
    }
  }

  for (const [componentSetId, componentSet] of Object.entries(state.componentSets)) {
    if (componentSet.id !== componentSetId) {
      return `Component set key ${componentSetId} does not match its id.`;
    }
    if (componentSet.componentIds.length < 2) {
      return `Component set ${componentSetId} requires at least two components.`;
    }
    if (new Set(componentSet.componentIds).size !== componentSet.componentIds.length) {
      return `Component set ${componentSetId} contains duplicate components.`;
    }
    const axes = Object.keys(componentSet.variantAxes).toSorted();
    for (const [axis, values] of Object.entries(componentSet.variantAxes)) {
      if (!axis.trim() || values.length === 0 || new Set(values).size !== values.length) {
        return `Component set ${componentSetId} has an invalid variant axis.`;
      }
    }
    const variantTuples = new Map<string, string>();
    for (const componentId of componentSet.componentIds) {
      const component = state.components[componentId];
      if (!component) return `Component set ${componentSetId} references missing component ${componentId}.`;
      if (component.componentSetId !== componentSetId) {
        return `Component ${componentId} is not linked back to set ${componentSetId}.`;
      }
      const componentAxes = Object.keys(component.variantProperties);
      const missingAxis = axes.find((axis) => !Object.hasOwn(component.variantProperties, axis));
      if (missingAxis) return `Component ${componentId} is missing variant axis ${missingAxis}.`;
      const extraAxis = componentAxes.find((axis) => !Object.hasOwn(componentSet.variantAxes, axis));
      if (extraAxis) return `Component ${componentId} uses invalid variant axis ${extraAxis}.`;
      for (const axis of axes) {
        const value = component.variantProperties[axis]!;
        if (!componentSet.variantAxes[axis]!.includes(value)) {
          return `Component ${componentId} uses invalid variant ${axis}=${value}.`;
        }
      }
      const tuple = JSON.stringify(axes.map((axis) => component.variantProperties[axis]));
      const duplicate = variantTuples.get(tuple);
      if (duplicate) {
        return `Components ${duplicate} and ${componentId} use a duplicate variant combination.`;
      }
      variantTuples.set(tuple, componentId);
    }
    for (const [axis, values] of Object.entries(componentSet.variantAxes)) {
      for (const value of values) {
        if (
          !componentSet.componentIds.some(
            (componentId) => state.components[componentId]?.variantProperties[axis] === value
          )
        ) {
          return `Variant ${axis}=${value} in component set ${componentSetId} does not resolve to a component.`;
        }
      }
    }
  }

  for (const component of Object.values(state.components)) {
    if (!component.componentSetId) continue;
    const componentSet = state.componentSets[component.componentSetId];
    if (!componentSet?.componentIds.includes(component.id)) {
      return `Component ${component.id} references missing set ${component.componentSetId}.`;
    }
  }

  for (const node of Object.values(state.nodes)) {
    const instance = node.componentInstance;
    if (node.type === 'component-instance' && !instance) {
      return `Component instance node ${node.id} has no component reference.`;
    }
    if (!instance) continue;
    if (node.type !== 'component-instance') {
      return `Node ${node.id} has instance data but is not a component instance.`;
    }
    if (node.childIds.length > 0) return `Component instance ${node.id} cannot own real child nodes.`;
    const main = state.components[instance.componentId];
    if (!main) return `Component instance ${node.id} references missing component ${instance.componentId}.`;
    const componentSet = main.componentSetId ? state.componentSets[main.componentSetId] : undefined;
    let selectedComponent = main;
    if (componentSet) {
      const axes = Object.keys(componentSet.variantAxes);
      const missingAxis = axes.find((axis) => !Object.hasOwn(instance.variantSelection, axis));
      if (missingAxis) return `Component instance ${node.id} is missing variant axis ${missingAxis}.`;
      const extraAxis = Object.keys(instance.variantSelection).find(
        (axis) => !Object.hasOwn(componentSet.variantAxes, axis)
      );
      if (extraAxis) return `Component instance ${node.id} selects invalid variant axis ${extraAxis}.`;
      for (const axis of axes) {
        const value = instance.variantSelection[axis]!;
        if (!componentSet.variantAxes[axis]!.includes(value)) {
          return `Component instance ${node.id} selects invalid variant ${axis}=${value}.`;
        }
      }
      const matches = componentSet.componentIds
        .map((componentId) => state.components[componentId])
        .filter(
          (component) =>
            component && axes.every((axis) => component.variantProperties[axis] === instance.variantSelection[axis])
        );
      if (matches.length !== 1) {
        return `Component instance ${node.id} variant selection does not resolve to exactly one component.`;
      }
      selectedComponent = matches[0]!;
    } else if (Object.keys(instance.variantSelection).length > 0) {
      return `Component instance ${node.id} selects variants without a component set.`;
    }
    for (const [propertyId, value] of Object.entries(instance.propertyValues)) {
      const property = selectedComponent.propertyDefinitions[propertyId];
      if (!property) return `Component instance ${node.id} overrides unknown property ${propertyId}.`;
      if (property.type === 'text' && typeof value !== 'string') {
        return `Component instance ${node.id} requires a string value for ${propertyId}.`;
      }
      if (property.type === 'boolean' && typeof value !== 'boolean') {
        return `Component instance ${node.id} requires a boolean value for ${propertyId}.`;
      }
    }
  }
  return undefined;
}

/** Checks invariants that must hold before a candidate transaction can be accepted. */
export function validateViuProjectStructure(state: ViuProjectState): ViuStructuralValidation {
  if (state.schemaVersion !== 2 && state.schemaVersion !== 3) {
    return { valid: false, message: 'VIU document must use schema version 2 or 3.' };
  }
  if (!state.projectId.trim()) return { valid: false, message: 'Project id is required.' };

  for (const [pageId, page] of Object.entries(state.canvasPages)) {
    if (page.id !== pageId) return { valid: false, message: `Canvas page key ${pageId} does not match its id.` };
    for (const screenId of page.screenIds) {
      if (!state.screens[screenId]) {
        return { valid: false, message: `Canvas page ${pageId} references missing screen ${screenId}.` };
      }
    }
  }
  for (const [screenId, screen] of Object.entries(state.screens)) {
    if (screen.id !== screenId) return { valid: false, message: `Screen key ${screenId} does not match its id.` };
    if (!state.canvasPages[screen.canvasPageId]) {
      return { valid: false, message: `Screen ${screenId} has no canvas page.` };
    }
    if (!state.nodes[screen.rootNodeId]) return { valid: false, message: `Screen ${screenId} has no root node.` };
    if (state.nodes[screen.rootNodeId]?.parentId !== null) {
      return { valid: false, message: `Screen root ${screen.rootNodeId} must not have a parent.` };
    }
  }
  const nodeError = validateNodeGraph(state);
  if (nodeError) return { valid: false, message: nodeError };
  const componentError = validateComponents(state);
  if (componentError) return { valid: false, message: componentError };
  const designSystemError = validateViuDesignSystem(state)[0];
  if (designSystemError) return { valid: false, message: designSystemError };
  const motionError = validateTimelineAndScrollStructure(state);
  if (motionError) return { valid: false, message: motionError };

  for (const [flowId, flow] of Object.entries(state.flows)) {
    if (flow.id !== flowId) return { valid: false, message: `Flow key ${flowId} does not match its id.` };
    if (new Set(flow.interactionIds).size !== flow.interactionIds.length) {
      return { valid: false, message: `Flow ${flowId} contains duplicate interactions.` };
    }
  }
  for (const [interactionId, interaction] of Object.entries(state.interactions)) {
    if (interaction.id !== interactionId) {
      return { valid: false, message: `Interaction key ${interactionId} does not match its id.` };
    }
    if (!state.nodes[interaction.sourceNodeId]) {
      return { valid: false, message: `Interaction ${interactionId} has no source node.` };
    }
    const flow = state.flows[interaction.flowId];
    if (!flow?.interactionIds.includes(interactionId)) {
      return { valid: false, message: `Interaction ${interactionId} is not registered in flow ${interaction.flowId}.` };
    }
    if (!state.nodes[interaction.sourceNodeId]?.behaviorBindings.includes(interactionId)) {
      return { valid: false, message: `Interaction ${interactionId} is not bound to its source node.` };
    }
    const actions = interactionActions(interaction);
    if (actions.length === 0 || actions.length > 32) {
      return { valid: false, message: `Interaction ${interactionId} requires between 1 and 32 actions.` };
    }
    if (actions.some((action) => !actionTargetExists(state, action))) {
      return { valid: false, message: `Interaction ${interactionId} has a missing action target.` };
    }
    const valueError = actions.map((action) => validateInteractionValue(state, interactionId, action)).find(Boolean);
    if (valueError) return { valid: false, message: valueError };
    if (interaction.condition && !state.variables[interaction.condition.variableId]) {
      return { valid: false, message: `Interaction ${interactionId} has a missing condition variable.` };
    }
    if (interaction.condition) {
      const variable = state.variables[interaction.condition.variableId];
      const comparison = new Set(['gt', 'gte', 'lt', 'lte']).has(interaction.condition.operator);
      if (
        comparison &&
        (variable?.type !== 'number' ||
          typeof interaction.condition.value !== 'number' ||
          !Number.isFinite(interaction.condition.value))
      ) {
        return { valid: false, message: `Interaction ${interactionId} requires a finite numeric comparison value.` };
      }
    }
    if (
      interaction.transition &&
      (!Number.isFinite(interaction.transition.durationMs) || interaction.transition.durationMs < 0)
    ) {
      return { valid: false, message: `Interaction ${interactionId} has an invalid transition duration.` };
    }
  }
  return { valid: true };
}

function targetScreenId(action: ViuInteractionAction): string | undefined {
  return action.type === 'navigate' ? action.targetScreenId : undefined;
}

/** Returns non-destructive product-flow diagnostics for editor and agent review. */
export function validateViuProject(state: ViuProjectState): ViuDiagnostic[] {
  const actionDiagnostics = Object.values(state.interactions).flatMap((interaction) =>
    interactionActions(interaction).flatMap((action, actionIndex) =>
      actionTargetExists(state, action)
        ? []
        : [
            {
              code: 'missing-interaction-target' as const,
              severity: 'error' as const,
              message: `Interaction ${interaction.id} action ${actionIndex + 1} (${action.type}) points to a missing target.`,
              entityId: interaction.id,
              flowId: interaction.flowId,
              actionIndex,
            },
          ]
    )
  );
  const structural = validateViuProjectStructure(state);
  if ('message' in structural) {
    return [{ code: 'invalid-document', severity: 'error', message: structural.message }, ...actionDiagnostics];
  }

  const diagnostics: ViuDiagnostic[] = [...actionDiagnostics];
  const reachableScreenIds = new Set<string>();

  for (const flow of Object.values(state.flows)) {
    if (!state.screens[flow.startScreenId]) {
      diagnostics.push({
        code: 'missing-flow-start',
        severity: 'error',
        message: `Flow ${flow.id} points to missing start screen ${flow.startScreenId}.`,
        entityId: flow.startScreenId,
        flowId: flow.id,
      });
      continue;
    }
    const reachable = new Set([flow.startScreenId]);
    const queue = [flow.startScreenId];
    while (queue.length > 0) {
      const screenId = queue.shift();
      const rootId = screenId ? state.screens[screenId]?.rootNodeId : undefined;
      if (!rootId) continue;
      const screenNodeIds = new Set<string>();
      const pendingNodes = [rootId];
      while (pendingNodes.length > 0) {
        const nodeId = pendingNodes.pop();
        if (!nodeId || screenNodeIds.has(nodeId)) continue;
        screenNodeIds.add(nodeId);
        pendingNodes.push(...(state.nodes[nodeId]?.childIds ?? []));
      }
      for (const interactionId of flow.interactionIds) {
        const interaction = state.interactions[interactionId];
        if (!interaction || !screenNodeIds.has(interaction.sourceNodeId)) continue;
        for (const action of interactionActions(interaction)) {
          const target = targetScreenId(action);
          if (target && state.screens[target] && !reachable.has(target)) {
            reachable.add(target);
            queue.push(target);
          }
        }
      }
    }
    reachable.forEach((screenId) => reachableScreenIds.add(screenId));
    const requiredIds = new Set([
      ...flow.requiredScreenIds,
      ...Object.values(state.screens)
        .filter((screen) => screen.required)
        .map((screen) => screen.id),
    ]);
    for (const requiredId of requiredIds) {
      if (!reachable.has(requiredId)) {
        diagnostics.push({
          code: 'unreachable-required-screen',
          severity: 'warning',
          message: `Required screen ${requiredId} is unreachable from flow ${flow.id}.`,
          entityId: requiredId,
          flowId: flow.id,
        });
      }
    }
  }
  for (const screen of Object.values(state.screens)) {
    if (reachableScreenIds.has(screen.id)) continue;
    diagnostics.push({
      code: 'orphan-screen',
      severity: 'warning',
      message: `Screen ${screen.id} is not reachable from any prototype flow.`,
      entityId: screen.id,
    });
  }
  diagnostics.push(...auditViuProjectQuality(state));
  return diagnostics;
}
