/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveViuComponentInstance } from '../components';

import type { ViuInteractionAction, ViuInteractionCondition, ViuProjectState } from '../types';
import type {
  ViuRuntimeActionInput,
  ViuRuntimeActionStepInput,
  ViuRuntimeCompiledInteraction,
  ViuRuntimeCondition,
  ViuRuntimeContract,
  ViuRuntimeDiagnostic,
  ViuRuntimeMotion,
  ViuRuntimeResolvedAction,
  ViuRuntimeResolvedActionStep,
  ViuRuntimeRoutePlan,
  ViuRuntimeScrollBinding,
  ViuRuntimeSectionPlan,
  ViuRuntimeTimeline,
  ViuRuntimeTimelineTrack,
  ViuSitePlan,
} from './types';

export const DEFAULT_VIU_RUNTIME_MOTION: ViuRuntimeMotion = {
  preset: 'fade',
  trigger: 'click',
  durationMs: 280,
  easing: 'ease-out',
};

const authoredTransition = (interaction: ViuProjectState['interactions'][string]): ViuRuntimeMotion | undefined =>
  interaction.transition
    ? {
        ...interaction.transition,
        trigger: interaction.trigger === 'hover' ? 'hover' : interaction.trigger === 'load' ? 'load' : 'click',
      }
    : undefined;

export const EMPTY_VIU_RUNTIME_CONTRACT: ViuRuntimeContract = { schemaVersion: 1 };

function normalizeRoute(route: string): { route: string; changed: boolean } {
  const raw = route.trim();
  const withoutQuery = raw.split(/[?#]/u, 1)[0] ?? '';
  const withLeadingSlash = withoutQuery.startsWith('/') ? withoutQuery : '/' + withoutQuery;
  const collapsed = withLeadingSlash.replace(/\/{2,}/gu, '/');
  const normalized = collapsed.length > 1 ? collapsed.replace(/\/$/u, '') : collapsed;
  return { route: normalized || '/', changed: normalized !== raw };
}

function safeAnchor(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return normalized || 'section';
}

function stableScreenIds(project: ViuProjectState): string[] {
  const known = new Set<string>();
  const ordered: string[] = [];
  for (const id of project.screenOrder) {
    if (project.screens[id] && !known.has(id)) {
      known.add(id);
      ordered.push(id);
    }
  }
  for (const id of Object.keys(project.screens).toSorted()) {
    if (!known.has(id)) ordered.push(id);
  }
  return ordered;
}

function walkNodeTree(
  project: ViuProjectState,
  nodeId: string,
  screenId: string,
  nodeToScreen: Record<string, string>,
  nodesByScreen: Record<string, string[]>,
  interactionOrder: string[],
  visited: Set<string>
): void {
  if (visited.has(nodeId)) return;
  visited.add(nodeId);
  const node = project.nodes[nodeId];
  if (!node) return;
  nodeToScreen[nodeId] ??= screenId;
  const screenNodes = (nodesByScreen[screenId] ??= []);
  if (!screenNodes.includes(nodeId)) screenNodes.push(nodeId);
  for (const interactionId of node.behaviorBindings) {
    if (!interactionOrder.includes(interactionId)) interactionOrder.push(interactionId);
  }
  for (const childId of node.childIds) {
    walkNodeTree(project, childId, screenId, nodeToScreen, nodesByScreen, interactionOrder, visited);
  }
}

function normalizeTrack(
  project: ViuProjectState,
  timelineId: string,
  durationMs: number,
  track: ViuRuntimeTimelineTrack,
  diagnostics: ViuRuntimeDiagnostic[]
): ViuRuntimeTimelineTrack | undefined {
  if (!project.nodes[track.nodeId]) {
    diagnostics.push({
      code: 'invalid-timeline',
      severity: 'error',
      message: 'Timeline ' + timelineId + ' targets missing node ' + track.nodeId + '.',
      entityId: timelineId,
    });
    return undefined;
  }
  const keyframes = track.keyframes
    .filter(
      (keyframe) =>
        Number.isFinite(keyframe.offsetMs) &&
        Number.isFinite(keyframe.value) &&
        keyframe.offsetMs >= 0 &&
        keyframe.offsetMs <= durationMs
    )
    .map((keyframe) => ({ ...keyframe }))
    .toSorted((left, right) => left.offsetMs - right.offsetMs);
  if (keyframes.length === 0) {
    diagnostics.push({
      code: 'invalid-timeline',
      severity: 'warning',
      message: 'Timeline ' + timelineId + ' track ' + track.id + ' has no valid keyframes.',
      entityId: timelineId,
    });
    return undefined;
  }
  return { ...track, keyframes };
}

function compileTimelines(
  project: ViuProjectState,
  contract: ViuRuntimeContract,
  diagnostics: ViuRuntimeDiagnostic[]
): Record<string, ViuRuntimeTimeline> {
  const sourceIds = new Set([...Object.keys(project.timelines), ...Object.keys(contract.timelines ?? {})]);
  const timelines: Record<string, ViuRuntimeTimeline> = {};
  for (const id of [...sourceIds].toSorted()) {
    const authored = project.timelines[id];
    const override = contract.timelines?.[id];
    const durationMs = override?.durationMs ?? authored?.durationMs ?? 0;
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      diagnostics.push({
        code: 'invalid-timeline',
        severity: 'error',
        message: 'Timeline ' + id + ' must have a positive finite duration.',
        entityId: id,
      });
      continue;
    }
    const rawTracks = (override?.tracks ?? authored?.tracks ?? []) as ViuRuntimeTimelineTrack[];
    const tracks = rawTracks
      .map((track) => normalizeTrack(project, id, durationMs, track, diagnostics))
      .filter((track): track is ViuRuntimeTimelineTrack => Boolean(track));
    timelines[id] = {
      id,
      name: override?.name ?? authored?.name ?? id,
      durationMs,
      loop: override?.loop ?? authored?.loop ?? false,
      tracks,
    };
  }
  return timelines;
}

function compileScrollBindings(
  project: ViuProjectState,
  contract: ViuRuntimeContract,
  timelines: Record<string, ViuRuntimeTimeline>,
  diagnostics: ViuRuntimeDiagnostic[]
): Record<string, ViuRuntimeScrollBinding> {
  const result: Record<string, ViuRuntimeScrollBinding> = {};
  const sources = { ...project.scrollBindings, ...contract.scrollBindings };
  for (const [id, source] of Object.entries(sources).toSorted(([left], [right]) => left.localeCompare(right))) {
    const start = source.start ?? 0;
    const end = source.end ?? 1;
    const invalid =
      !project.nodes[source.nodeId] ||
      (source.timelineId !== undefined && !timelines[source.timelineId]) ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start >= end ||
      (source.parallax !== undefined && !Number.isFinite(source.parallax));
    if (invalid) {
      diagnostics.push({
        code: 'invalid-scroll-binding',
        severity: 'error',
        message: 'Scroll binding ' + id + ' is invalid or references a missing entity.',
        entityId: id,
      });
      continue;
    }
    result[id] = {
      id,
      nodeId: source.nodeId,
      timelineId: source.timelineId,
      start,
      end,
      pin: source.pin ?? false,
      parallax: source.parallax ?? 0,
    };
  }
  return result;
}

function resolveCondition(
  project: ViuProjectState,
  condition: ViuInteractionCondition | ViuRuntimeCondition | undefined,
  diagnostics: ViuRuntimeDiagnostic[],
  interactionId: string
): ViuRuntimeCondition | undefined {
  if (!condition) return undefined;
  if (!project.variables[condition.variableId]) {
    diagnostics.push({
      code: 'invalid-condition',
      severity: 'error',
      message: 'Interaction ' + interactionId + ' condition targets a missing variable.',
      entityId: interactionId,
    });
    return undefined;
  }
  return { ...condition };
}

function resolveAction(
  project: ViuProjectState,
  timelines: Record<string, ViuRuntimeTimeline>,
  action: ViuInteractionAction | ViuRuntimeActionInput,
  screenToRoute: Record<string, string>,
  nodeToScreen: Record<string, string>,
  anchorByScreen: Record<string, string>,
  diagnostics: ViuRuntimeDiagnostic[],
  interactionId: string
): ViuRuntimeResolvedAction | undefined {
  switch (action.type) {
    case 'navigate': {
      const target = project.screens[action.targetScreenId];
      if (!target) {
        diagnostics.push({
          code: 'missing-screen',
          severity: 'error',
          message: 'Interaction ' + interactionId + ' targets a screen that does not exist.',
          entityId: interactionId,
        });
        return undefined;
      }
      return {
        type: 'navigate',
        targetScreenId: target.id,
        targetRoute: screenToRoute[target.id]!,
        targetAnchorId: anchorByScreen[target.id]!,
      };
    }
    case 'openOverlay':
      if (!project.nodes[action.targetNodeId]) {
        diagnostics.push({
          code: 'missing-node',
          severity: 'error',
          message: 'Interaction ' + interactionId + ' targets an overlay node that does not exist.',
          entityId: interactionId,
        });
        return undefined;
      }
      return { type: 'openOverlay', targetNodeId: action.targetNodeId };
    case 'closeOverlay':
      if (action.targetNodeId && !project.nodes[action.targetNodeId]) {
        diagnostics.push({
          code: 'missing-node',
          severity: 'warning',
          message: 'Interaction ' + interactionId + ' closes an overlay node that does not exist.',
          entityId: interactionId,
        });
      }
      return { type: 'closeOverlay', targetNodeId: action.targetNodeId };
    case 'scrollTo': {
      const screenId = nodeToScreen[action.targetNodeId];
      if (!screenId) {
        diagnostics.push({
          code: 'missing-node',
          severity: 'error',
          message: 'Interaction ' + interactionId + ' targets a scroll node outside the compiled site.',
          entityId: interactionId,
        });
        return undefined;
      }
      return {
        type: 'scrollTo',
        targetNodeId: action.targetNodeId,
        targetScreenId: screenId,
        targetRoute: screenToRoute[screenId]!,
      };
    }
    case 'setVariable':
    case 'toggleVariable':
      if (!project.variables[action.variableId]) {
        diagnostics.push({
          code: 'missing-variable',
          severity: 'error',
          message: 'Interaction ' + interactionId + ' targets a variable that does not exist.',
          entityId: interactionId,
        });
        return undefined;
      }
      return action.type === 'setVariable'
        ? { type: 'setVariable', variableId: action.variableId, value: action.value }
        : { type: 'toggleVariable', variableId: action.variableId };
    case 'playTimeline':
    case 'pauseTimeline':
    case 'seekTimeline':
      if (!timelines[action.timelineId]) {
        diagnostics.push({
          code: 'missing-timeline',
          severity: 'error',
          message: 'Interaction ' + interactionId + ' targets a timeline that does not exist.',
          entityId: interactionId,
        });
        return undefined;
      }
      if (action.type === 'seekTimeline') {
        return {
          type: 'seekTimeline',
          timelineId: action.timelineId,
          offsetMs: Math.min(timelines[action.timelineId]!.durationMs, Math.max(0, action.offsetMs)),
        };
      }
      return { type: action.type, timelineId: action.timelineId };
    case 'back':
      return { type: 'back' };
  }
}

function authoredSteps(project: ViuProjectState, interactionId: string): ViuRuntimeActionStepInput[] {
  const interaction = project.interactions[interactionId]!;
  const actions = interaction.actions?.length ? interaction.actions : [interaction.action];
  return actions.map((action) => ({ action, condition: interaction.condition }));
}

function compileSteps(
  project: ViuProjectState,
  timelines: Record<string, ViuRuntimeTimeline>,
  interactionId: string,
  steps: ViuRuntimeActionStepInput[],
  screenToRoute: Record<string, string>,
  nodeToScreen: Record<string, string>,
  anchorByScreen: Record<string, string>,
  diagnostics: ViuRuntimeDiagnostic[]
): ViuRuntimeResolvedActionStep[] {
  return steps
    .map((step): ViuRuntimeResolvedActionStep | undefined => {
      const action = resolveAction(
        project,
        timelines,
        step.action,
        screenToRoute,
        nodeToScreen,
        anchorByScreen,
        diagnostics,
        interactionId
      );
      if (!action) return undefined;
      const condition = resolveCondition(project, step.condition, diagnostics, interactionId);
      if (step.condition && !condition) return undefined;
      return { action, condition };
    })
    .filter((step): step is ViuRuntimeResolvedActionStep => Boolean(step));
}

/** Compiles a normalized VIU document into a deterministic, executable website plan. */
export function compileViuSite(
  project: ViuProjectState,
  contract: ViuRuntimeContract = EMPTY_VIU_RUNTIME_CONTRACT
): ViuSitePlan {
  const diagnostics: ViuRuntimeDiagnostic[] = [];
  const routeByPath: Record<string, ViuRuntimeRoutePlan> = {};
  const routes: ViuRuntimeRoutePlan[] = [];
  const screenToRoute: Record<string, string> = {};
  const nodeToScreen: Record<string, string> = {};
  const nodesByScreen: Record<string, string[]> = {};
  const anchorByScreen: Record<string, string> = {};
  const usedAnchors = new Set<string>();
  const interactionOrder: string[] = [];
  const screenIds = stableScreenIds(project);

  for (const screenId of screenIds) {
    const screen = project.screens[screenId]!;
    const normalized = normalizeRoute(screen.route);
    if (normalized.changed) {
      diagnostics.push({
        code: 'invalid-route',
        severity: 'warning',
        message: 'Screen ' + screenId + ' route was normalized to ' + normalized.route + '.',
        entityId: screenId,
      });
    }
    screenToRoute[screenId] = normalized.route;
    const sectionContract = contract.sections?.[screenId];
    const requestedAnchor = safeAnchor(sectionContract?.anchorId ?? 'viu-' + screenId);
    let anchorId = requestedAnchor;
    let suffix = 2;
    while (usedAnchors.has(anchorId)) anchorId = requestedAnchor + '-' + suffix++;
    if (anchorId !== requestedAnchor) {
      diagnostics.push({
        code: 'duplicate-anchor',
        severity: 'warning',
        message: 'Screen ' + screenId + ' anchor was renamed to keep it unique.',
        entityId: screenId,
      });
    }
    usedAnchors.add(anchorId);
    anchorByScreen[screenId] = anchorId;
    const rootNode = project.nodes[screen.rootNodeId];

    const section: ViuRuntimeSectionPlan = {
      screenId,
      route: normalized.route,
      rootNodeId: screen.rootNodeId,
      anchorId,
      viewport: {
        name: screen.viewport.name === 'custom' ? 'desktop' : screen.viewport.name,
        width: screen.viewport.width,
        height: screen.viewport.height,
      },
      contentSize: {
        width: Math.max(screen.viewport.width, rootNode?.size.width ?? screen.viewport.width),
        height: Math.max(screen.viewport.height, rootNode?.size.height ?? screen.viewport.height),
      },
      minHeight: Math.max(1, sectionContract?.minHeight ?? screen.viewport.height),
      scrollSnap: sectionContract?.scrollSnap ?? 'none',
      sticky: sectionContract?.sticky ?? false,
    };
    let routePlan = routeByPath[normalized.route];
    if (!routePlan) {
      routePlan = { route: normalized.route, screenIds: [], sections: [] };
      routeByPath[normalized.route] = routePlan;
      routes.push(routePlan);
    }
    routePlan.screenIds.push(screenId);
    routePlan.sections.push(section);
    walkNodeTree(
      project,
      screen.rootNodeId,
      screenId,
      nodeToScreen,
      nodesByScreen,
      interactionOrder,
      new Set<string>()
    );
  }

  for (const flow of Object.values(project.flows).toSorted((left, right) => left.id.localeCompare(right.id))) {
    for (const interactionId of flow.interactionIds) {
      if (!interactionOrder.includes(interactionId)) interactionOrder.push(interactionId);
    }
  }
  for (const interactionId of Object.keys(project.interactions).toSorted()) {
    if (!interactionOrder.includes(interactionId)) interactionOrder.push(interactionId);
  }

  const timelines = compileTimelines(project, contract, diagnostics);
  const scrollBindings = compileScrollBindings(project, contract, timelines, diagnostics);
  const interactions: Record<string, ViuRuntimeCompiledInteraction> = {};
  const interactionIdsBySource: Record<string, string[]> = {};
  for (const interactionId of interactionOrder) {
    const interaction = project.interactions[interactionId];
    if (!interaction) continue;
    const override = contract.interactions?.[interactionId];
    const sourceSteps = authoredSteps(project, interactionId);
    const steps = override?.actions?.length
      ? override.actions
      : override?.action
        ? [{ action: override.action, condition: override.condition }]
        : override?.condition
          ? sourceSteps.map((step) => ({ ...step, condition: override.condition }))
          : sourceSteps;
    const actions = compileSteps(
      project,
      timelines,
      interactionId,
      steps,
      screenToRoute,
      nodeToScreen,
      anchorByScreen,
      diagnostics
    );
    if (actions.length === 0) continue;
    interactions[interactionId] = {
      id: interactionId,
      sourceNodeId: interaction.sourceNodeId,
      trigger: interaction.trigger,
      action: actions[0]!.action,
      actions,
      transition:
        override?.transition ??
        authoredTransition(interaction) ??
        contract.routeTransition ??
        DEFAULT_VIU_RUNTIME_MOTION,
    };
    (interactionIdsBySource[interaction.sourceNodeId] ??= []).push(interactionId);
  }

  for (const node of Object.values(project.nodes)) {
    if (!node.componentInstance) continue;
    const resolved = resolveViuComponentInstance(project, node);
    if (!resolved) continue;
    const inheritedIds = interactionIdsBySource[resolved.component.rootNodeId] ?? [];
    if (inheritedIds.length === 0) continue;
    const ownIds = interactionIdsBySource[node.id] ?? [];
    interactionIdsBySource[node.id] = [
      ...ownIds,
      ...inheritedIds.filter((interactionId) => !ownIds.includes(interactionId)),
    ];
  }

  const smartAnimateKeysByScreen: Record<string, Record<string, string>> = {};
  for (const [screenId, nodeIds] of Object.entries(nodesByScreen)) {
    const keys: Record<string, string> = {};
    for (const nodeId of nodeIds) {
      const key = contract.nodes?.[nodeId]?.smartAnimateKey ?? nodeId;
      keys[key] ??= nodeId;
    }
    smartAnimateKeysByScreen[screenId] = keys;
  }

  let initialScreenId =
    contract.defaultScreenId && project.screens[contract.defaultScreenId] ? contract.defaultScreenId : null;
  if (contract.defaultScreenId && !initialScreenId) {
    diagnostics.push({
      code: 'missing-screen',
      severity: 'warning',
      message: 'Default screen ' + contract.defaultScreenId + ' does not exist.',
      entityId: contract.defaultScreenId,
    });
  }
  if (!initialScreenId) {
    const firstFlow = Object.values(project.flows).toSorted((left, right) => left.id.localeCompare(right.id))[0];
    initialScreenId =
      firstFlow && project.screens[firstFlow.startScreenId] ? firstFlow.startScreenId : (screenIds[0] ?? null);
  }
  if (routes.length === 0) {
    diagnostics.push({ code: 'empty-site', severity: 'error', message: 'The VIU project has no screens to present.' });
  }
  const initialRoute = initialScreenId ? (screenToRoute[initialScreenId] ?? routes[0]?.route ?? '/') : '/';

  return {
    schemaVersion: 1,
    project,
    contract,
    routes,
    routeByPath,
    screenToRoute,
    nodeToScreen,
    nodesByScreen,
    smartAnimateKeysByScreen,
    interactions,
    interactionIdsBySource,
    timelines,
    scrollBindings,
    initialRoute,
    initialScreenId,
    diagnostics,
  };
}
