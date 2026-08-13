/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ViuImageTransform } from './graphics/image';
export type { ViuImageTransform } from './graphics/image';
import type { ViuVectorGeometry } from './graphics/vector';

export type ViuId = string;
export type ViuMatrix2D = [number, number, number, number, number, number];
export type ViuNodeType =
  | 'frame'
  | 'group'
  | 'text'
  | 'vector'
  | 'image'
  | 'video'
  | 'audio'
  | 'control'
  | 'component-instance'
  | 'repeater'
  | 'model-3d'
  | 'runtime-surface'
  | 'hotspot';

export type ViuGradientStop = { color: string; position: number };
export type ViuFill =
  | { id: ViuId; type: 'solid'; visible: boolean; opacity: number; color: string }
  | { id: ViuId; type: 'linear'; visible: boolean; opacity: number; angle: number; stops: ViuGradientStop[] }
  | {
      id: ViuId;
      type: 'radial';
      visible: boolean;
      opacity: number;
      centerX: number;
      centerY: number;
      radius: number;
      stops: ViuGradientStop[];
    };
export type ViuStroke = {
  id: ViuId;
  visible: boolean;
  opacity: number;
  color: string;
  width: number;
  alignment: 'inside' | 'center' | 'outside';
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  miterLimit: number;
  dashPattern: number[];
  dashOffset: number;
};
type ViuShadowEffect = {
  id: ViuId;
  visible: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
};
type ViuBlurEffect = { id: ViuId; visible: boolean; radius: number };
export type ViuEffect =
  | (ViuShadowEffect & { type: 'drop-shadow' })
  | (ViuShadowEffect & { type: 'inner-shadow' })
  | (ViuBlurEffect & { type: 'layer-blur' })
  | (ViuBlurEffect & { type: 'backdrop-blur' });
export type ViuNodeStyle = {
  /** Ordered structured paints; when present, these take precedence over raw background CSS. */
  fills?: ViuFill[];
  /** Ordered structured effects; when present, these take precedence over raw shadow/blur CSS. */
  effects?: ViuEffect[];
  /** Ordered, editable strokes; the last visible stroke is rendered on top. */
  strokes?: ViuStroke[];
  background?: string;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic' | 'oblique';
  lineHeight?: number;
  letterSpacing?: number;
  textDecoration?: 'none' | 'underline' | 'line-through' | 'underline line-through';
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: 'none' | 'solid' | 'dashed' | 'dotted' | 'double';
  borderRadius?: number;
  /** Corner radii in top-left, top-right, bottom-right, bottom-left order. */
  borderRadii?: [number, number, number, number];
  strokeAlignment?: 'inside' | 'center' | 'outside';
  opacity: number;
  shadow?: string;
  blur?: number;
  backdropBlur?: number;
  overflow?: 'visible' | 'hidden' | 'scroll';
};
export type ViuNodeContent = {
  text?: string;
  assetId?: ViuId;
  controlType?: 'button' | 'input' | 'select' | 'checkbox' | 'radio' | 'form';
  placeholder?: string;
};
export type ViuSemantics = {
  role: 'none' | 'region' | 'heading' | 'paragraph' | 'button' | 'link' | 'form' | 'image' | 'navigation';
  label: string;
  description?: string;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
};
export type ViuSizing = {
  horizontal: 'fixed' | 'fill' | 'hug';
  vertical: 'fixed' | 'fill' | 'hug';
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
};
export type ViuConstraints = {
  horizontal: 'left' | 'right' | 'center' | 'stretch' | 'scale';
  vertical: 'top' | 'bottom' | 'center' | 'stretch' | 'scale';
};
export type ViuLayoutContainer = {
  mode: 'none' | 'horizontal' | 'vertical' | 'grid';
  gap: number;
  padding: [number, number, number, number];
  align: 'start' | 'center' | 'end' | 'stretch';
  justify: 'start' | 'center' | 'end' | 'space-between';
  wrap?: boolean;
  columns?: number;
};
export type ViuVariableType = 'color' | 'number' | 'string' | 'boolean';
export type ViuVariableScalar = string | number | boolean;
export type ViuVariableAlias = { type: 'alias'; variableId: ViuId };
export type ViuVariableModeKind = 'light' | 'dark' | 'brand' | 'device' | 'locale' | 'custom';
export type ViuVariableMode = { id: ViuId; name: string; kind: ViuVariableModeKind };
export type ViuVariableCollection = {
  id: ViuId;
  name: string;
  defaultModeId: ViuId;
  modeIds: ViuId[];
  modes: Record<ViuId, ViuVariableMode>;
};
export type ViuVariable = {
  id: ViuId;
  name: string;
  collectionId: ViuId;
  type: ViuVariableType;
  valuesByMode: Record<ViuId, ViuVariableScalar | ViuVariableAlias>;
  description?: string;
};
export type ViuLegacyVariable = {
  id: ViuId;
  name: string;
  type: Exclude<ViuVariableType, 'color'>;
  value: unknown;
};
export type ViuBindableProperty =
  | 'style.background'
  | 'style.color'
  | 'style.borderColor'
  | 'style.borderWidth'
  | 'style.borderRadius'
  | 'style.opacity'
  | 'style.fontSize'
  | 'style.lineHeight'
  | 'style.letterSpacing'
  | 'content.text'
  | 'content.placeholder'
  | 'layout.gap'
  | 'size.width'
  | 'size.height'
  | 'visible';
export type ViuVariableBinding = { variableId: ViuId; modeId?: ViuId };
export type ViuBreakpointPreset = 'desktop' | 'tablet' | 'mobile' | 'custom';
export type ViuBreakpoint = {
  id: ViuId;
  name: string;
  preset: ViuBreakpointPreset;
  minWidth: number;
  maxWidth?: number;
};
export type ViuResponsiveNodeOverride = {
  localTransform?: ViuMatrix2D;
  size?: Partial<ViuNode['size']>;
  sizing?: Partial<ViuSizing>;
  constraints?: Partial<ViuConstraints>;
  layout?: Partial<ViuLayoutContainer>;
  style?: Partial<ViuNodeStyle>;
  content?: Partial<ViuNodeContent>;
  visible?: boolean;
};
export type ViuGuide = {
  id: ViuId;
  axis: 'horizontal' | 'vertical';
  position: number;
  locked?: boolean;
};
export type ViuSnapSettings = {
  enabled: boolean;
  pixelGrid: number;
  threshold: number;
  snapToGuides: boolean;
  snapToObjects: boolean;
};
export type ViuComponentPropertyValue = string | boolean;
export type ViuComponentPropertyDefinition =
  | {
      id: ViuId;
      name: string;
      type: 'text';
      targetNodeId: ViuId;
      targetProperty: 'content.text';
      defaultValue: string;
    }
  | {
      id: ViuId;
      name: string;
      type: 'boolean';
      targetNodeId: ViuId;
      targetProperty: 'visible';
      defaultValue: boolean;
    };
export type ViuComponentDefinition = {
  id: ViuId;
  version: number;
  name: string;
  rootNodeId: ViuId;
  componentSetId?: ViuId;
  variantProperties: Record<string, string>;
  propertyDefinitions: Record<ViuId, ViuComponentPropertyDefinition>;
};
export type ViuComponentSet = {
  id: ViuId;
  version: number;
  name: string;
  componentIds: ViuId[];
  variantAxes: Record<string, string[]>;
};
export type ViuComponentInstance = {
  componentId: ViuId;
  variantSelection: Record<string, string>;
  propertyValues: Record<ViuId, ViuComponentPropertyValue>;

  styleOverrides?: Partial<ViuNodeStyle>;
};
export type ViuNode = {
  id: ViuId;
  version: number;
  name: string;
  type: ViuNodeType;
  parentId: ViuId | null;
  childIds: ViuId[];
  localTransform: ViuMatrix2D;
  size: { width: number; height: number };
  positionMode: 'flow' | 'absolute';
  sizing: ViuSizing;
  constraints: ViuConstraints;
  layout?: ViuLayoutContainer;
  style: ViuNodeStyle;
  content?: ViuNodeContent;
  imageTransform?: ViuImageTransform;
  vector?: ViuVectorGeometry;
  componentInstance?: ViuComponentInstance;
  variableBindings?: Partial<Record<ViuBindableProperty, ViuVariableBinding>>;
  responsiveOverrides?: Record<ViuId, ViuResponsiveNodeOverride>;
  semantics: ViuSemantics;
  behaviorBindings: ViuId[];
  visible: boolean;
  locked: boolean;
  provenance: { source: 'user' | 'agent' | 'import' | 'starter'; actorId?: string };
};

export type ViuCanvasPage = { id: ViuId; name: string; screenIds: ViuId[] };
export type ViuScreen = {
  id: ViuId;
  name: string;
  route: string;
  canvasPageId: ViuId;
  rootNodeId: ViuId;
  required: boolean;
  viewport: { name: 'desktop' | 'tablet' | 'mobile' | 'custom'; width: number; height: number };
};
export type ViuInteractionTrigger = 'click' | 'hover' | 'focus' | 'submit' | 'scroll' | 'load';
export type ViuInteractionTransition = {
  preset: 'none' | 'fade' | 'rise' | 'scale' | 'slide-left' | 'slide-right' | 'blur-in' | 'reveal' | 'smart-animate';
  durationMs: number;
  easing: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'spring-soft';
};
export type ViuInteractionAction =
  | { type: 'navigate'; targetScreenId: ViuId }
  | { type: 'openOverlay'; targetNodeId: ViuId }
  | { type: 'scrollTo'; targetNodeId: ViuId }
  | { type: 'closeOverlay'; targetNodeId?: ViuId }
  | { type: 'back' }
  | { type: 'setVariable'; variableId: ViuId; value: unknown }
  | { type: 'toggleVariable'; variableId: ViuId }
  | { type: 'playTimeline'; timelineId: ViuId }
  | { type: 'pauseTimeline'; timelineId: ViuId }
  | { type: 'seekTimeline'; timelineId: ViuId; offsetMs: number };
export type ViuInteractionCondition = {
  variableId: ViuId;
  operator: 'eq' | 'neq' | 'truthy' | 'falsy' | 'gt' | 'gte' | 'lt' | 'lte';
  value?: unknown;
};
export type ViuInteraction = {
  id: ViuId;
  version: number;
  flowId: ViuId;
  sourceNodeId: ViuId;
  trigger: ViuInteractionTrigger;
  action: ViuInteractionAction;
  /** Ordered actions; `action` remains the backward-compatible first-action fallback. */
  actions?: ViuInteractionAction[];
  condition?: ViuInteractionCondition;
  transition?: ViuInteractionTransition;
};
export type ViuFlow = {
  id: ViuId;
  name: string;
  startScreenId: ViuId;
  requiredScreenIds: ViuId[];
  interactionIds: ViuId[];
};
export type ViuTokenRegistry = {
  colors: Record<ViuId, string>;
  typography: Record<ViuId, { fontFamily: string; fontSize: number; fontWeight: number; lineHeight: number }>;
  spacing: Record<ViuId, number>;
  radii: Record<ViuId, number>;
};

export type ViuTimelineKeyframe = {
  offsetMs: number;
  value: number;
  easing?: ViuInteractionTransition['easing'];
};
export type ViuTimelineTrack = {
  id: ViuId;
  nodeId: ViuId;
  property: 'x' | 'y' | 'opacity' | 'scale' | 'rotate' | 'blur';
  keyframes: ViuTimelineKeyframe[];
};
export type ViuTimeline = {
  id: ViuId;
  name: string;
  durationMs: number;
  loop?: boolean;
  tracks?: ViuTimelineTrack[];
};
export type ViuTimelinePatch = Partial<Omit<ViuTimeline, 'id'>>;
export type ViuScrollBinding = {
  id: ViuId;
  nodeId: ViuId;
  timelineId?: ViuId;
  start: number;
  end: number;
  pin: boolean;
  parallax: number;
};

export type ViuProjectState = {
  schemaVersion: 2 | 3;
  projectId: ViuId;
  title: string;
  revision: number;
  canvasPages: Record<ViuId, ViuCanvasPage>;
  pageOrder: ViuId[];
  screens: Record<ViuId, ViuScreen>;
  screenOrder: ViuId[];
  nodes: Record<ViuId, ViuNode>;
  components: Record<ViuId, ViuComponentDefinition>;
  componentSets: Record<ViuId, ViuComponentSet>;
  tokens: ViuTokenRegistry;
  variables: Record<ViuId, ViuVariable | ViuLegacyVariable>;
  variableCollections?: Record<ViuId, ViuVariableCollection>;
  activeVariableModes?: Record<ViuId, ViuId>;
  breakpoints?: Record<ViuId, ViuBreakpoint>;
  guides?: ViuGuide[];
  snapSettings?: ViuSnapSettings;
  flows: Record<ViuId, ViuFlow>;
  interactions: Record<ViuId, ViuInteraction>;
  timelines: Record<ViuId, ViuTimeline>;
  scrollBindings?: Record<ViuId, ViuScrollBinding>;
  assets: Record<ViuId, { id: ViuId; displayName: string; kind: 'image' | 'video' | 'audio' | 'font' | 'model-3d' }>;
  dataSources: Record<ViuId, { id: ViuId; name: string; rows: unknown[] }>;
  scenarios: Record<ViuId, { id: ViuId; name: string; flowId: ViuId }>;
};

export type ViuNodePatch = Partial<Omit<ViuNode, 'id' | 'version' | 'parentId' | 'childIds'>>;
export type ViuComponentPatch = Partial<Omit<ViuComponentDefinition, 'id' | 'version' | 'rootNodeId'>>;
export type ViuComponentSetPatch = Partial<Omit<ViuComponentSet, 'id' | 'version'>>;
export type ViuCommand =
  | { type: 'insertNode'; node: ViuNode; parentId: ViuId | null; index?: number }
  | { type: 'updateNode'; nodeId: ViuId; patch: ViuNodePatch }
  | { type: 'deleteNode'; nodeId: ViuId }
  | { type: 'reparentNode'; nodeId: ViuId; parentId: ViuId | null; index?: number }
  | { type: 'reorderNode'; nodeId: ViuId; index: number }
  | { type: 'createComponent'; component: ViuComponentDefinition }
  | { type: 'updateComponent'; componentId: ViuId; patch: ViuComponentPatch }
  | { type: 'deleteComponent'; componentId: ViuId }
  | { type: 'createComponentSet'; componentSet: ViuComponentSet }
  | { type: 'updateComponentSet'; componentSetId: ViuId; patch: ViuComponentSetPatch }
  | { type: 'deleteComponentSet'; componentSetId: ViuId }
  | { type: 'upsertVariableCollection'; collection: ViuVariableCollection }
  | { type: 'deleteVariableCollection'; collectionId: ViuId }
  | { type: 'upsertVariable'; variable: ViuVariable }
  | { type: 'deleteVariable'; variableId: ViuId }
  | { type: 'setVariableMode'; collectionId: ViuId; modeId: ViuId | null }
  | { type: 'upsertBreakpoint'; breakpoint: ViuBreakpoint }
  | { type: 'deleteBreakpoint'; breakpointId: ViuId }
  | { type: 'setGuides'; guides: ViuGuide[] }
  | { type: 'setSnapSettings'; settings: ViuSnapSettings | null }
  | { type: 'createTimeline'; timeline: ViuTimeline }
  | { type: 'updateTimeline'; timelineId: ViuId; patch: ViuTimelinePatch }
  | { type: 'deleteTimeline'; timelineId: ViuId }
  | { type: 'upsertScrollBinding'; binding: ViuScrollBinding }
  | { type: 'deleteScrollBinding'; bindingId: ViuId }
  | { type: 'connectInteraction'; interaction: ViuInteraction }
  | { type: 'disconnectInteraction'; interactionId: ViuId };
export type ViuTransaction = {
  transactionId: ViuId;
  documentId: ViuId;
  baseRevision: number;
  actor: { id: ViuId; kind: 'user' | 'agent' | 'system' };
  origin: 'canvas' | 'inspector' | 'agent-tool' | 'import' | 'code-sync';
  commands: ViuCommand[];
  preconditions?: Array<{ nodeId: ViuId; expectedVersion: number }>;
  mode: 'preview' | 'commit';
  idempotencyKey?: string;
  summary: string;
};
export type ViuDiagnostic = {
  code:
    | 'invalid-document'
    | 'missing-interaction-target'
    | 'missing-flow-start'
    | 'unreachable-required-screen'
    | 'orphan-screen'
    | 'missing-interactive-label'
    | 'missing-image-label'
    | 'missing-heading-level'
    | 'empty-heading'
    | 'skipped-heading-level'
    | 'low-text-contrast'
    | 'keyboard-inaccessible-interaction'
    | 'hover-only-interaction'
    | 'content-overflow'
    | 'clipped-content';
  severity: 'error' | 'warning';
  message: string;
  entityId?: ViuId;
  flowId?: ViuId;
  actionIndex?: number;
};
export type ViuConflict = {
  kind: 'revision' | 'precondition' | 'command' | 'validation';
  message: string;
  expected?: number;
  actual?: number;
};
export type ViuTransactionResult = {
  accepted: boolean;
  state: ViuProjectState;
  revision: number;
  normalizedCommands: ViuCommand[];
  inverseCommands: ViuCommand[];
  diagnostics: ViuDiagnostic[];
  changedNodeIds: ViuId[];
  conflict?: ViuConflict;
};
export type CreateViuNodeInput = {
  id: ViuId;
  name: string;
  type: ViuNodeType;
  parentId?: ViuId | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  vector?: ViuVectorGeometry;
  style?: Partial<ViuNodeStyle>;
  semantics?: Partial<ViuSemantics>;
  provenance?: ViuNode['provenance'];
};
