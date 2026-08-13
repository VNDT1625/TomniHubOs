/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ViuId, ViuProjectState } from '../types';

export type ViuRuntimeBreakpoint = 'mobile' | 'tablet' | 'desktop';
export type ViuRuntimeMotionPreset =
  | 'none'
  | 'fade'
  | 'rise'
  | 'scale'
  | 'slide-left'
  | 'slide-right'
  | 'blur-in'
  | 'reveal'
  | 'smart-animate';
export type ViuRuntimeMotionTrigger = 'load' | 'in-view' | 'hover' | 'click';
export type ViuRuntimeEasing = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'spring-soft';

export type ViuRuntimeMotion = {
  preset: ViuRuntimeMotionPreset;
  trigger: ViuRuntimeMotionTrigger;
  durationMs: number;
  delayMs?: number;
  easing?: ViuRuntimeEasing;
  iterationCount?: number;
};

/** A serializable, deliberately bounded subset of CSS. It never accepts executable code. */
export type ViuRuntimeLayoutStyle = {
  display?: 'block' | 'flex' | 'grid' | 'none';
  position?: 'relative' | 'absolute' | 'sticky' | 'fixed';
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  flexWrap?: 'nowrap' | 'wrap';
  alignItems?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  justifyContent?: 'start' | 'center' | 'end' | 'space-between' | 'space-around';
  gridTemplateColumns?: string;
  gap?: number;
  padding?: [number, number, number, number];
  margin?: [number, number, number, number];
  width?: number | 'auto' | '100%';
  height?: number | 'auto' | '100%';
  minHeight?: number;
  maxWidth?: number;
  inset?: { top?: number; right?: number; bottom?: number; left?: number };
  zIndex?: number;
  overflow?: 'visible' | 'hidden' | 'auto' | 'scroll';
};

export type ViuRuntimeEffectStyle = {
  blur?: number;
  backdropBlur?: number;
  brightness?: number;
  contrast?: number;
  saturate?: number;
  blendMode?: 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'difference';
  perspective?: number;
  rotateX?: number;
  rotateY?: number;
  translateZ?: number;
};

export type ViuRuntimeNodeContract = {
  layout?: ViuRuntimeLayoutStyle;
  effects?: ViuRuntimeEffectStyle;
  motion?: ViuRuntimeMotion;
  smartAnimateKey?: string;
  responsive?: Partial<Record<ViuRuntimeBreakpoint, Omit<ViuRuntimeNodeContract, 'responsive'>>>;
};

export type ViuRuntimeConditionOperator = 'eq' | 'neq' | 'truthy' | 'falsy' | 'gt' | 'gte' | 'lt' | 'lte';
export type ViuRuntimeCondition = {
  variableId: ViuId;
  operator: ViuRuntimeConditionOperator;
  value?: unknown;
};

export type ViuRuntimeActionInput =
  | { type: 'navigate'; targetScreenId: ViuId }
  | { type: 'openOverlay'; targetNodeId: ViuId }
  | { type: 'closeOverlay'; targetNodeId?: ViuId }
  | { type: 'scrollTo'; targetNodeId: ViuId }
  | { type: 'setVariable'; variableId: ViuId; value: unknown }
  | { type: 'toggleVariable'; variableId: ViuId }
  | { type: 'playTimeline'; timelineId: ViuId }
  | { type: 'pauseTimeline'; timelineId: ViuId }
  | { type: 'seekTimeline'; timelineId: ViuId; offsetMs: number }
  | { type: 'back' };

export type ViuRuntimeActionStepInput = {
  action: ViuRuntimeActionInput;
  condition?: ViuRuntimeCondition;
};

export type ViuRuntimeInteractionContract = {
  action?: ViuRuntimeActionInput;
  actions?: ViuRuntimeActionStepInput[];
  condition?: ViuRuntimeCondition;
  transition?: ViuRuntimeMotion;
};

export type ViuRuntimeSectionContract = {
  anchorId?: string;
  minHeight?: number;
  scrollSnap?: 'none' | 'start' | 'center';
  sticky?: boolean;
};

export type ViuRuntimeTimelineProperty = 'x' | 'y' | 'opacity' | 'scale' | 'rotate' | 'blur';
export type ViuRuntimeTimelineKeyframe = {
  offsetMs: number;
  value: number;
  easing?: ViuRuntimeEasing;
};
export type ViuRuntimeTimelineTrack = {
  id: ViuId;
  nodeId: ViuId;
  property: ViuRuntimeTimelineProperty;
  keyframes: ViuRuntimeTimelineKeyframe[];
};
export type ViuRuntimeTimeline = {
  id: ViuId;
  name: string;
  durationMs: number;
  loop?: boolean;
  tracks: ViuRuntimeTimelineTrack[];
};

export type ViuRuntimeScrollBinding = {
  id: ViuId;
  nodeId: ViuId;
  timelineId?: ViuId;
  start?: number;
  end?: number;
  pin?: boolean;
  parallax?: number;
};

export type ViuRuntimeContract = {
  schemaVersion: 1;
  defaultScreenId?: ViuId;
  breakpoints?: { mobileMax: number; tabletMax: number };
  sections?: Record<ViuId, ViuRuntimeSectionContract>;
  nodes?: Record<ViuId, ViuRuntimeNodeContract>;
  interactions?: Record<ViuId, ViuRuntimeInteractionContract>;
  timelines?: Record<ViuId, Omit<ViuRuntimeTimeline, 'id'> & { id?: ViuId }>;
  scrollBindings?: Record<ViuId, Omit<ViuRuntimeScrollBinding, 'id'> & { id?: ViuId }>;
  routeTransition?: ViuRuntimeMotion;
};

export type ViuRuntimeResolvedAction =
  | { type: 'navigate'; targetScreenId: ViuId; targetRoute: string; targetAnchorId: string }
  | { type: 'openOverlay'; targetNodeId: ViuId }
  | { type: 'closeOverlay'; targetNodeId?: ViuId }
  | { type: 'scrollTo'; targetNodeId: ViuId; targetScreenId: ViuId; targetRoute: string }
  | { type: 'setVariable'; variableId: ViuId; value: unknown }
  | { type: 'toggleVariable'; variableId: ViuId }
  | { type: 'playTimeline'; timelineId: ViuId }
  | { type: 'pauseTimeline'; timelineId: ViuId }
  | { type: 'seekTimeline'; timelineId: ViuId; offsetMs: number }
  | { type: 'back' };

export type ViuRuntimeResolvedActionStep = {
  action: ViuRuntimeResolvedAction;
  condition?: ViuRuntimeCondition;
};

export type ViuRuntimeCompiledInteraction = {
  id: ViuId;
  sourceNodeId: ViuId;
  trigger: 'click' | 'hover' | 'focus' | 'submit' | 'scroll' | 'load';
  /** Legacy first action retained for existing consumers. */
  action: ViuRuntimeResolvedAction;
  actions: ViuRuntimeResolvedActionStep[];
  transition: ViuRuntimeMotion;
};

export type ViuRuntimeSectionPlan = {
  screenId: ViuId;
  route: string;
  rootNodeId: ViuId;
  anchorId: string;
  viewport: { name: 'desktop' | 'tablet' | 'mobile'; width: number; height: number };
  /** Rendered frame bounds. These may exceed the viewport for long-form pages. */
  contentSize: { width: number; height: number };
  minHeight: number;
  scrollSnap: 'none' | 'start' | 'center';
  sticky: boolean;
};

export type ViuRuntimeRoutePlan = {
  route: string;
  screenIds: ViuId[];
  sections: ViuRuntimeSectionPlan[];
};

export type ViuRuntimeSmartAnimateMatch = {
  key: string;
  fromNodeId: ViuId;
  toNodeId: ViuId;
};

export type ViuRuntimeDiagnostic = {
  code:
    | 'empty-site'
    | 'invalid-route'
    | 'duplicate-anchor'
    | 'missing-node'
    | 'missing-screen'
    | 'missing-variable'
    | 'missing-timeline'
    | 'invalid-condition'
    | 'invalid-timeline'
    | 'invalid-scroll-binding';
  severity: 'error' | 'warning';
  message: string;
  entityId?: ViuId;
};

export type ViuSitePlan = {
  schemaVersion: 1;
  project: ViuProjectState;
  contract: ViuRuntimeContract;
  routes: ViuRuntimeRoutePlan[];
  routeByPath: Record<string, ViuRuntimeRoutePlan>;
  screenToRoute: Record<ViuId, string>;
  nodeToScreen: Record<ViuId, ViuId>;
  nodesByScreen: Record<ViuId, ViuId[]>;
  smartAnimateKeysByScreen: Record<ViuId, Record<string, ViuId>>;
  interactions: Record<ViuId, ViuRuntimeCompiledInteraction>;
  interactionIdsBySource: Record<ViuId, ViuId[]>;
  timelines: Record<ViuId, ViuRuntimeTimeline>;
  scrollBindings: Record<ViuId, ViuRuntimeScrollBinding>;
  initialRoute: string;
  initialScreenId: ViuId | null;
  diagnostics: ViuRuntimeDiagnostic[];
};

export type ViuRuntimeViewport = {
  width: number;
  height: number;
  breakpoint: ViuRuntimeBreakpoint;
};

export type ViuRuntimeEffect =
  | {
      type: 'route';
      route: string;
      screenId: ViuId;
      anchorId: string;
      transition: ViuRuntimeMotion;
      smartAnimateMatches: ViuRuntimeSmartAnimateMatch[];
    }
  | { type: 'scroll'; nodeId: ViuId; screenId: ViuId; transition: ViuRuntimeMotion }
  | { type: 'overlay'; nodeId: ViuId; transition: ViuRuntimeMotion }
  | {
      type: 'timeline';
      timelineId: ViuId;
      command: 'play' | 'pause' | 'seek';
      currentMs: number;
      transition: ViuRuntimeMotion;
    };

export type ViuRuntimeTraceEntry = {
  sequence: number;
  event: string;
  status: 'applied' | 'ignored';
  routeBefore: string;
  routeAfter: string;
  sourceNodeId?: ViuId;
  interactionId?: ViuId;
  actionType?: ViuRuntimeResolvedAction['type'];
  actionTypes?: ViuRuntimeResolvedAction['type'][];
  reason?: string;
};

export type ViuRuntimeTimelineState = {
  status: 'idle' | 'playing' | 'paused' | 'finished';
  currentMs: number;
};

export type ViuRuntimeState = {
  currentRoute: string;
  activeScreenId: ViuId | null;
  history: Array<{ route: string; screenId: ViuId | null }>;
  overlayNodeIds: ViuId[];
  variables: Record<ViuId, unknown>;
  timelines: Record<ViuId, ViuRuntimeTimelineState>;
  scrollProgress: Record<ViuId, number>;
  viewport: ViuRuntimeViewport;
  reducedMotion: boolean;
  pendingEffect: ViuRuntimeEffect | null;

  effectQueue: ViuRuntimeEffect[];
  trace: ViuRuntimeTraceEntry[];
  sequence: number;
};

export type ViuRuntimeEvent =
  | { type: 'activateNode'; nodeId: ViuId; trigger?: ViuRuntimeCompiledInteraction['trigger'] }
  | { type: 'navigate'; route: string; screenId?: ViuId }
  | { type: 'back' }
  | { type: 'closeOverlay'; nodeId?: ViuId }
  | { type: 'playTimeline'; timelineId: ViuId }
  | { type: 'pauseTimeline'; timelineId: ViuId }
  | { type: 'seekTimeline'; timelineId: ViuId; offsetMs: number }
  | { type: 'tickTimeline'; timelineId: ViuId; deltaMs: number }
  | { type: 'setScrollProgress'; bindingId: ViuId; progress: number }
  | { type: 'setViewport'; width: number; height: number }
  | { type: 'consumeEffect' };
