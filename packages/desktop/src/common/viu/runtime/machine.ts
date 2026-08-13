/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ViuProjectState, ViuVariableAlias } from '../types';
import type {
  ViuRuntimeBreakpoint,
  ViuRuntimeCondition,
  ViuRuntimeEasing,
  ViuRuntimeEffect,
  ViuRuntimeEvent,
  ViuRuntimeMotion,
  ViuRuntimeResolvedAction,
  ViuRuntimeSmartAnimateMatch,
  ViuRuntimeState,
  ViuRuntimeTimeline,
  ViuRuntimeTimelineState,
  ViuRuntimeTraceEntry,
  ViuSitePlan,
} from './types';

const TRACE_LIMIT = 200;
const DEFAULT_ROUTE_MOTION: ViuRuntimeMotion = {
  preset: 'fade',
  trigger: 'click',
  durationMs: 280,
  easing: 'ease-out',
};

export function resolveViuRuntimeBreakpoint(plan: ViuSitePlan, width: number): ViuRuntimeBreakpoint {
  const mobileMax = plan.contract.breakpoints?.mobileMax ?? 767;
  const tabletMax = Math.max(mobileMax, plan.contract.breakpoints?.tabletMax ?? 1199);
  if (width <= mobileMax) return 'mobile';
  if (width <= tabletMax) return 'tablet';
  return 'desktop';
}

export function effectiveViuRuntimeMotion(motion: ViuRuntimeMotion, reducedMotion: boolean): ViuRuntimeMotion {
  return reducedMotion ? { ...motion, preset: 'none', durationMs: 0, delayMs: 0, iterationCount: 1 } : motion;
}

function routeMotion(plan: ViuSitePlan, reducedMotion: boolean): ViuRuntimeMotion {
  return effectiveViuRuntimeMotion(plan.contract.routeTransition ?? DEFAULT_ROUTE_MOTION, reducedMotion);
}

function isAlias(value: unknown): value is ViuVariableAlias {
  return Boolean(value && typeof value === 'object' && (value as { type?: unknown }).type === 'alias');
}

function resolveInitialVariable(project: ViuProjectState, variableId: string, visited: Set<string>): unknown {
  if (visited.has(variableId)) return undefined;
  visited.add(variableId);
  const variable = project.variables[variableId];
  if (!variable) return undefined;
  if ('value' in variable) return variable.value;
  const collection = project.variableCollections?.[variable.collectionId];
  const modeId = project.activeVariableModes?.[variable.collectionId] ?? collection?.defaultModeId;
  const value = modeId ? variable.valuesByMode[modeId] : Object.values(variable.valuesByMode)[0];
  return isAlias(value) ? resolveInitialVariable(project, value.variableId, visited) : value;
}

function initialVariables(plan: ViuSitePlan): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(plan.project.variables)
      .toSorted()
      .map((id) => [id, resolveInitialVariable(plan.project, id, new Set<string>())])
  );
}

function initialTimelines(plan: ViuSitePlan): Record<string, ViuRuntimeTimelineState> {
  return Object.fromEntries(
    Object.keys(plan.timelines)
      .toSorted()
      .map((id) => [id, { status: 'idle' as const, currentMs: 0 }])
  );
}

function smartAnimateMatches(
  plan: ViuSitePlan,
  fromScreenId: string | null,
  toScreenId: string
): ViuRuntimeSmartAnimateMatch[] {
  if (!fromScreenId) return [];
  const from = plan.smartAnimateKeysByScreen[fromScreenId] ?? {};
  const to = plan.smartAnimateKeysByScreen[toScreenId] ?? {};
  return Object.keys(from)
    .filter((key) => to[key] !== undefined)
    .toSorted()
    .map((key) => ({ key, fromNodeId: from[key]!, toNodeId: to[key]! }));
}

function routeEffect(
  plan: ViuSitePlan,
  state: ViuRuntimeState,
  route: string,
  screenId: string,
  anchorId: string,
  motion: ViuRuntimeMotion
): ViuRuntimeEffect {
  return {
    type: 'route',
    route,
    screenId,
    anchorId,
    transition: motion,
    smartAnimateMatches:
      motion.preset === 'smart-animate' ? smartAnimateMatches(plan, state.activeScreenId, screenId) : [],
  };
}

function enqueueEffect(state: ViuRuntimeState, effect: ViuRuntimeEffect): ViuRuntimeState {
  return state.pendingEffect
    ? { ...state, effectQueue: [...state.effectQueue, effect] }
    : { ...state, pendingEffect: effect };
}

export function createViuRuntimeState(
  plan: ViuSitePlan,
  options: { width?: number; height?: number; reducedMotion?: boolean; initialRoute?: string } = {}
): ViuRuntimeState {
  const width = Math.max(1, options.width ?? 1440);
  const height = Math.max(1, options.height ?? 900);
  const requestedRoute = options.initialRoute;
  const currentRoute = requestedRoute && plan.routeByPath[requestedRoute] ? requestedRoute : plan.initialRoute;
  const routePlan = plan.routeByPath[currentRoute];
  const initialScreenId =
    currentRoute === plan.initialRoute && routePlan?.screenIds.includes(plan.initialScreenId ?? '')
      ? plan.initialScreenId
      : (routePlan?.screenIds[0] ?? null);
  const initialSection = routePlan?.sections.find((section) => section.screenId === initialScreenId);
  const reducedMotion = options.reducedMotion ?? false;
  const initialEffect =
    initialScreenId && initialSection
      ? routeEffect(
          plan,
          {
            activeScreenId: null,
          } as ViuRuntimeState,
          currentRoute,
          initialScreenId,
          initialSection.anchorId,
          routeMotion(plan, reducedMotion)
        )
      : null;
  return {
    currentRoute,
    activeScreenId: initialScreenId,
    history: [],
    overlayNodeIds: [],
    variables: initialVariables(plan),
    timelines: initialTimelines(plan),
    scrollProgress: {},
    viewport: { width, height, breakpoint: resolveViuRuntimeBreakpoint(plan, width) },
    reducedMotion,
    pendingEffect: initialEffect,
    effectQueue: [],
    trace: [],
    sequence: 0,
  };
}

function appendTrace(
  state: ViuRuntimeState,
  entry: Omit<ViuRuntimeTraceEntry, 'sequence' | 'routeBefore'> & { routeBefore?: string }
): ViuRuntimeState {
  const nextSequence = state.sequence + 1;
  const traceEntry: ViuRuntimeTraceEntry = {
    ...entry,
    sequence: nextSequence,
    routeBefore: entry.routeBefore ?? state.currentRoute,
  };
  return {
    ...state,
    sequence: nextSequence,
    trace: [...state.trace, traceEntry].slice(-TRACE_LIMIT),
  };
}

function ignored(state: ViuRuntimeState, event: string, reason: string, sourceNodeId?: string): ViuRuntimeState {
  return appendTrace(state, {
    event,
    status: 'ignored',
    routeAfter: state.currentRoute,
    reason,
    sourceNodeId,
  });
}

export function evaluateViuRuntimeCondition(
  condition: ViuRuntimeCondition | undefined,
  variables: Readonly<Record<string, unknown>>
): boolean {
  if (!condition) return true;
  const current = variables[condition.variableId];
  switch (condition.operator) {
    case 'eq':
      return Object.is(current, condition.value);
    case 'neq':
      return !Object.is(current, condition.value);
    case 'truthy':
      return Boolean(current);
    case 'falsy':
      return !current;
    case 'gt':
      return typeof current === 'number' && typeof condition.value === 'number' && current > condition.value;
    case 'gte':
      return typeof current === 'number' && typeof condition.value === 'number' && current >= condition.value;
    case 'lt':
      return typeof current === 'number' && typeof condition.value === 'number' && current < condition.value;
    case 'lte':
      return typeof current === 'number' && typeof condition.value === 'number' && current <= condition.value;
  }
}

function setTimeline(
  plan: ViuSitePlan,
  state: ViuRuntimeState,
  timelineId: string,
  command: 'play' | 'pause' | 'seek',
  requestedMs?: number,
  transition: ViuRuntimeMotion = DEFAULT_ROUTE_MOTION
): ViuRuntimeState {
  const timeline = plan.timelines[timelineId];
  const current = state.timelines[timelineId];
  if (!timeline || !current) return state;
  let nextTimeline: ViuRuntimeTimelineState;
  if (command === 'play') {
    nextTimeline = state.reducedMotion
      ? { status: 'finished', currentMs: timeline.durationMs }
      : {
          status: 'playing',
          currentMs: current.status === 'finished' ? 0 : current.currentMs,
        };
  } else if (command === 'pause') {
    nextTimeline = { ...current, status: current.status === 'playing' ? 'paused' : current.status };
  } else {
    const currentMs = Math.min(timeline.durationMs, Math.max(0, requestedMs ?? 0));
    nextTimeline = {
      status: currentMs >= timeline.durationMs ? 'finished' : current.status === 'playing' ? 'playing' : 'paused',
      currentMs,
    };
  }
  const next = {
    ...state,
    timelines: { ...state.timelines, [timelineId]: nextTimeline },
  };
  return enqueueEffect(next, {
    type: 'timeline',
    timelineId,
    command,
    currentMs: nextTimeline.currentMs,
    transition: effectiveViuRuntimeMotion(transition, state.reducedMotion),
  });
}

function applyAction(
  plan: ViuSitePlan,
  state: ViuRuntimeState,
  action: ViuRuntimeResolvedAction,
  transition: ViuRuntimeMotion
): ViuRuntimeState {
  const motion = effectiveViuRuntimeMotion(transition, state.reducedMotion);
  switch (action.type) {
    case 'navigate': {
      const routeChanged = action.targetRoute !== state.currentRoute;
      const effect = routeEffect(plan, state, action.targetRoute, action.targetScreenId, action.targetAnchorId, motion);
      const next: ViuRuntimeState = {
        ...state,
        currentRoute: action.targetRoute,
        activeScreenId: action.targetScreenId,
        history: routeChanged
          ? [...state.history, { route: state.currentRoute, screenId: state.activeScreenId }]
          : state.history,
        overlayNodeIds: [],
      };
      return enqueueEffect(next, effect);
    }
    case 'openOverlay': {
      const next = {
        ...state,
        overlayNodeIds: state.overlayNodeIds.includes(action.targetNodeId)
          ? state.overlayNodeIds
          : [...state.overlayNodeIds, action.targetNodeId],
      };
      return enqueueEffect(next, { type: 'overlay', nodeId: action.targetNodeId, transition: motion });
    }
    case 'closeOverlay':
      return {
        ...state,
        overlayNodeIds: action.targetNodeId
          ? state.overlayNodeIds.filter((id) => id !== action.targetNodeId)
          : state.overlayNodeIds.slice(0, -1),
      };
    case 'scrollTo': {
      const routeChanged = action.targetRoute !== state.currentRoute;
      const next: ViuRuntimeState = {
        ...state,
        currentRoute: action.targetRoute,
        activeScreenId: action.targetScreenId,
        history: routeChanged
          ? [...state.history, { route: state.currentRoute, screenId: state.activeScreenId }]
          : state.history,
      };
      return enqueueEffect(next, {
        type: 'scroll',
        nodeId: action.targetNodeId,
        screenId: action.targetScreenId,
        transition: motion,
      });
    }
    case 'setVariable':
      return { ...state, variables: { ...state.variables, [action.variableId]: action.value } };
    case 'toggleVariable':
      return {
        ...state,
        variables: { ...state.variables, [action.variableId]: !state.variables[action.variableId] },
      };
    case 'playTimeline':
      return setTimeline(plan, state, action.timelineId, 'play', undefined, motion);
    case 'pauseTimeline':
      return setTimeline(plan, state, action.timelineId, 'pause', undefined, motion);
    case 'seekTimeline':
      return setTimeline(plan, state, action.timelineId, 'seek', action.offsetMs, motion);
    case 'back':
      return applyBack(plan, state, motion);
  }
}

function applyBack(plan: ViuSitePlan, state: ViuRuntimeState, motion: ViuRuntimeMotion): ViuRuntimeState {
  if (state.overlayNodeIds.length > 0) {
    return { ...state, overlayNodeIds: state.overlayNodeIds.slice(0, -1) };
  }
  const previous = state.history.at(-1);
  if (!previous || !plan.routeByPath[previous.route]) return state;
  const screenId = previous.screenId ?? plan.routeByPath[previous.route]!.screenIds[0]!;
  const section = plan.routeByPath[previous.route]!.sections.find((item) => item.screenId === screenId);
  const effect = routeEffect(plan, state, previous.route, screenId, section?.anchorId ?? 'viu-' + screenId, motion);
  return enqueueEffect(
    {
      ...state,
      currentRoute: previous.route,
      activeScreenId: screenId,
      history: state.history.slice(0, -1),
    },
    effect
  );
}

function tickTimeline(plan: ViuSitePlan, state: ViuRuntimeState, timelineId: string, deltaMs: number): ViuRuntimeState {
  const timeline = plan.timelines[timelineId];
  const current = state.timelines[timelineId];
  if (!timeline || !current || current.status !== 'playing') return state;
  const safeDelta = Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0);
  const raw = current.currentMs + safeDelta;
  const looped = timeline.loop && timeline.durationMs > 0;
  const currentMs = looped ? raw % timeline.durationMs : Math.min(timeline.durationMs, raw);
  const status = !looped && currentMs >= timeline.durationMs ? 'finished' : 'playing';
  return {
    ...state,
    timelines: { ...state.timelines, [timelineId]: { status, currentMs } },
  };
}

function easingProgress(easing: ViuRuntimeEasing | undefined, progress: number): number {
  const value = Math.min(1, Math.max(0, progress));
  switch (easing) {
    case 'ease-in':
      return value * value;
    case 'ease-out':
      return 1 - (1 - value) * (1 - value);
    case 'ease':
    case 'ease-in-out':
      return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
    case 'spring-soft':
      return value === 1 ? 1 : 1 - Math.exp(-6 * value) * Math.cos(8 * value);
    default:
      return value;
  }
}

function sampleTimeline(timeline: ViuRuntimeTimeline, trackId: string, currentMs: number): number | undefined {
  const track = timeline.tracks.find((item) => item.id === trackId);
  if (!track || track.keyframes.length === 0) return undefined;
  const first = track.keyframes[0]!;
  const last = track.keyframes.at(-1)!;
  if (currentMs <= first.offsetMs) return first.value;
  if (currentMs >= last.offsetMs) return last.value;
  const rightIndex = track.keyframes.findIndex((keyframe) => keyframe.offsetMs >= currentMs);
  const right = track.keyframes[rightIndex]!;
  const left = track.keyframes[rightIndex - 1]!;
  const span = Math.max(1, right.offsetMs - left.offsetMs);
  const progress = easingProgress(right.easing, (currentMs - left.offsetMs) / span);
  return left.value + (right.value - left.value) * progress;
}

export type ViuRuntimeNodeMotionValues = {
  x?: number;
  y?: number;
  opacity?: number;
  scale?: number;
  rotate?: number;
  blur?: number;
  parallaxY?: number;
  pinned?: boolean;
  scrollProgress?: number;
};

export function resolveViuRuntimeNodeMotion(
  plan: ViuSitePlan,
  state: ViuRuntimeState,
  nodeId: string
): ViuRuntimeNodeMotionValues {
  const values: ViuRuntimeNodeMotionValues = {};
  for (const timeline of Object.values(plan.timelines)) {
    const current = state.timelines[timeline.id]?.currentMs ?? 0;
    for (const track of timeline.tracks) {
      if (track.nodeId !== nodeId) continue;
      const value = sampleTimeline(timeline, track.id, current);
      if (value !== undefined) values[track.property] = value;
    }
  }
  for (const binding of Object.values(plan.scrollBindings)) {
    if (binding.nodeId !== nodeId) continue;
    const progress = state.scrollProgress[binding.id] ?? 0;
    values.scrollProgress = progress;
    values.pinned = Boolean(binding.pin);
    if (binding.parallax) values.parallaxY = binding.parallax * (progress - 0.5);
  }
  return values;
}

/** Advances the website interpreter by one serializable event and records an auditable trace. */
export function reduceViuRuntime(plan: ViuSitePlan, state: ViuRuntimeState, event: ViuRuntimeEvent): ViuRuntimeState {
  if (event.type === 'consumeEffect') {
    return {
      ...state,
      pendingEffect: state.effectQueue[0] ?? null,
      effectQueue: state.effectQueue.slice(1),
    };
  }

  if (event.type === 'setViewport') {
    const width = Math.max(1, event.width);
    const height = Math.max(1, event.height);
    const next = {
      ...state,
      viewport: { width, height, breakpoint: resolveViuRuntimeBreakpoint(plan, width) },
    };
    return appendTrace(next, {
      event: event.type,
      status: 'applied',
      routeBefore: state.currentRoute,
      routeAfter: next.currentRoute,
    });
  }

  if (event.type === 'playTimeline' || event.type === 'pauseTimeline' || event.type === 'seekTimeline') {
    if (!plan.timelines[event.timelineId]) return ignored(state, event.type, 'timeline-not-found');
    const command = event.type === 'playTimeline' ? 'play' : event.type === 'pauseTimeline' ? 'pause' : 'seek';
    const next = setTimeline(
      plan,
      state,
      event.timelineId,
      command,
      event.type === 'seekTimeline' ? event.offsetMs : undefined
    );
    return appendTrace(next, {
      event: event.type,
      status: 'applied',
      routeBefore: state.currentRoute,
      routeAfter: next.currentRoute,
      actionType: event.type,
    });
  }

  if (event.type === 'tickTimeline') {
    const current = state.timelines[event.timelineId];
    if (!current) return ignored(state, event.type, 'timeline-not-found');
    if (current.status !== 'playing') return ignored(state, event.type, 'timeline-not-playing');
    const next = tickTimeline(plan, state, event.timelineId, event.deltaMs);
    return appendTrace(next, {
      event: event.type,
      status: 'applied',
      routeBefore: state.currentRoute,
      routeAfter: next.currentRoute,
    });
  }

  if (event.type === 'setScrollProgress') {
    const binding = plan.scrollBindings[event.bindingId];
    if (!binding) return ignored(state, event.type, 'scroll-binding-not-found');
    const absolute = Math.min(1, Math.max(0, Number.isFinite(event.progress) ? event.progress : 0));
    const start = binding.start ?? 0;
    const end = binding.end ?? 1;
    const progress = Math.min(1, Math.max(0, (absolute - start) / (end - start)));
    let next: ViuRuntimeState = {
      ...state,
      scrollProgress: { ...state.scrollProgress, [binding.id]: progress },
    };
    if (binding.timelineId) {
      const timeline = plan.timelines[binding.timelineId]!;
      next = {
        ...next,
        timelines: {
          ...next.timelines,
          [timeline.id]: { status: 'paused', currentMs: timeline.durationMs * progress },
        },
      };
    }
    return appendTrace(next, {
      event: event.type,
      status: 'applied',
      routeBefore: state.currentRoute,
      routeAfter: next.currentRoute,
    });
  }

  if (event.type === 'navigate') {
    const route = plan.routeByPath[event.route];
    if (!route) return ignored(state, event.type, 'route-not-found');
    const screenId = event.screenId && route.screenIds.includes(event.screenId) ? event.screenId : route.screenIds[0]!;
    const section = route.sections.find((item) => item.screenId === screenId)!;
    const routeChanged = route.route !== state.currentRoute;
    const motion = routeMotion(plan, state.reducedMotion);
    const effect = routeEffect(plan, state, route.route, screenId, section.anchorId, motion);
    const next = enqueueEffect(
      {
        ...state,
        currentRoute: route.route,
        activeScreenId: screenId,
        overlayNodeIds: [],
        history: routeChanged
          ? [...state.history, { route: state.currentRoute, screenId: state.activeScreenId }]
          : state.history,
      },
      effect
    );
    return appendTrace(next, {
      event: event.type,
      status: 'applied',
      routeBefore: state.currentRoute,
      routeAfter: next.currentRoute,
      actionType: 'navigate',
    });
  }

  if (event.type === 'back') {
    const motion = routeMotion(plan, state.reducedMotion);
    const next = applyBack(plan, state, motion);
    if (next === state) return ignored(state, event.type, 'history-empty');
    return appendTrace(next, {
      event: event.type,
      status: 'applied',
      routeBefore: state.currentRoute,
      routeAfter: next.currentRoute,
      actionType: 'back',
    });
  }

  if (event.type === 'closeOverlay') {
    if (state.overlayNodeIds.length === 0) return ignored(state, event.type, 'overlay-empty');
    const next: ViuRuntimeState = {
      ...state,
      overlayNodeIds: event.nodeId
        ? state.overlayNodeIds.filter((id) => id !== event.nodeId)
        : state.overlayNodeIds.slice(0, -1),
    };
    return appendTrace(next, {
      event: event.type,
      status: 'applied',
      routeBefore: state.currentRoute,
      routeAfter: next.currentRoute,
      actionType: 'closeOverlay',
    });
  }

  const trigger = event.trigger ?? 'click';
  const interactionId = plan.interactionIdsBySource[event.nodeId]?.find(
    (id) => plan.interactions[id]?.trigger === trigger
  );
  if (!interactionId) return ignored(state, event.type, 'interaction-not-found', event.nodeId);
  const interaction = plan.interactions[interactionId]!;
  let next: ViuRuntimeState = { ...state, pendingEffect: null, effectQueue: [] };
  const actionTypes: ViuRuntimeResolvedAction['type'][] = [];
  for (const step of interaction.actions) {
    if (!evaluateViuRuntimeCondition(step.condition, next.variables)) continue;
    next = applyAction(plan, next, step.action, interaction.transition);
    actionTypes.push(step.action.type);
  }
  if (actionTypes.length === 0) return ignored(state, event.type, 'condition-false', event.nodeId);
  return appendTrace(next, {
    event: event.type,
    status: 'applied',
    routeBefore: state.currentRoute,
    routeAfter: next.currentRoute,
    sourceNodeId: event.nodeId,
    interactionId,
    actionType: actionTypes[0],
    actionTypes,
  });
}
