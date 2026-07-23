/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ViuAuthoringBatch, ViuSelection } from '@/common/viu/authoring';
import type { ViuProjectState } from '@/common/viu';

export type ViuFontCatalogStatus = 'idle' | 'loading' | 'ready' | 'permission-denied' | 'unsupported' | 'error';
export type ViuFontOption = ViuAuthoringOption<string> & {
  source?: 'curated' | 'system' | 'document';
  styles?: readonly string[];
};

export type ViuComponentOption = { id: string; name: string };
export type ViuVariantAxisControl = { id: string; label: string; value: string; options: readonly string[] };
export type ViuComponentPropertyControl =
  | { id: string; label: string; type: 'text'; value: string }
  | { id: string; label: string; type: 'boolean'; value: boolean }
  | { id: string; label: string; type: 'instance-swap'; value: string; options: readonly ViuComponentOption[] };

export type ViuComponentInspectorLabels = {
  section: string;
  createComponent: string;
  createInstance: string;
  combineVariants: string;
  mainComponent: string;
  instance: string;
  variant: string;
  stateAxis: string;
  properties: string;
  resetOverrides: string;
  detachInstance: string;
  emptyProperties: string;
  missingComponent: string;
  componentSet: string;
  defaultVariant: string;
};

export type ViuComponentInspectorModel = {
  selected: boolean;
  canCreateComponent: boolean;

  canCreateComponentSet: boolean;
  definition?: { id: string; name: string; componentSetId?: string };
  instance?: { componentId: string; componentName: string; overrideCount: number };
  components: readonly ViuComponentOption[];
  variantAxes: readonly ViuVariantAxisControl[];
  properties: readonly ViuComponentPropertyControl[];
};

export type ViuComponentInspectorProps = {
  labels: ViuComponentInspectorLabels;
  model: ViuComponentInspectorModel;
  disabled?: boolean;
  onCreateComponent: () => void;
  onCreateInstance: () => void;
  onCreateComponentSet: () => void;
  onDetachInstance: () => void;
  onRenameComponent: (name: string) => void;
  onSwapComponent: (componentId: string) => void;
  onChangeVariant: (axisId: string, value: string) => void;
  onChangeProperty: (propertyId: string, value: string | boolean) => void;
  onResetOverrides: () => void;
};

export type ViuAuthoringOption<T extends string | number> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export type ViuPrototypeInspectorLabels = {
  section: string;
  bindings: string;
  addInteraction: string;
  noSelection: string;
  noFlow: string;
  trigger: string;
  click: string;
  hover: string;
  focus: string;
  submit: string;
  scroll: string;
  load: string;
  action: string;
  navigate: string;
  openOverlay: string;
  closeOverlay: string;
  back: string;
  scrollTo: string;
  setVariable: string;
  toggleVariable: string;
  playTimeline: string;
  pauseTimeline: string;
  seekTimeline: string;
  destination: string;
  value: string;
  condition: string;
  conditionNone: string;
  conditionTruthy: string;
  conditionFalsy: string;
  conditionEq: string;
  conditionNeq: string;
  conditionGt: string;
  conditionGte: string;
  conditionLt: string;
  conditionLte: string;
  addAction: string;
  moveUp: string;
  moveDown: string;
  timeline: string;
  createTimeline: string;
  addTrack: string;
  addKeyframe: string;
  loop: string;
  property: string;
  start: string;
  end: string;
  pin: string;
  parallax: string;
  scrollBinding: string;
  addScrollBinding: string;
  noTimeline: string;
  x: string;
  y: string;
  opacity: string;
  scale: string;
  rotate: string;
  blur: string;
  keyframes: string;
  position: string;
  transition: string;
  presetNone: string;
  presetFade: string;
  presetRise: string;
  presetScale: string;
  presetSlideLeft: string;
  presetSlideRight: string;
  presetBlur: string;
  presetReveal: string;
  presetSmartAnimate: string;
  duration: string;
  easing: string;
  easingLinear: string;
  easingEase: string;
  easingIn: string;
  easingOut: string;
  easingInOut: string;
  easingSpring: string;
  remove: string;
  disconnectedScreens: (count: number) => string;
};

export type ViuLayoutInspectorLabels = {
  section: string;
  mode: string;
  none: string;
  horizontal: string;
  vertical: string;
  grid: string;
  gap: string;
  padding: string;
  top: string;
  right: string;
  bottom: string;
  left: string;
  alignment: string;
  distribution: string;
  start: string;
  center: string;
  end: string;
  stretch: string;
  spaceBetween: string;
  wrap: string;
  columns: string;
  childSizing: string;
  position: string;
  flow: string;
  absolute: string;
  width: string;
  height: string;
  fixed: string;
  fill: string;
  hug: string;
  minWidth: string;
  maxWidth: string;
  minHeight: string;
  maxHeight: string;
  constraints: string;
  designSystem: string;
  activeMode: string;
  responsive: string;
  breakpoint: string;
  base: string;
  computed: string;
  backgroundToken: string;
  gapToken: string;
  noVariable: string;
  rotation: string;
  cornerRadii: string;
  strokeAlignment: string;
  strokeInside: string;
  strokeCenter: string;
  strokeOutside: string;
  snapping: string;
  guideCount: (count: number) => string;
  pixelGrid: string;
  snapThreshold: string;
  snapToGuides: string;
  snapToObjects: string;
  addHorizontalGuide: string;
  addVerticalGuide: string;
  removeGuide: string;
  responsiveVisible: string;
};
export type ViuTypographyInspectorLabels = {
  section: string;
  fontFamily: string;
  loadSystemFonts: string;
  loadingSystemFonts: string;
  systemFontsCount: (count: number) => string;
  fontAccessDenied: string;
  fontUnsupported: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  styleNormal: string;
  styleItalic: string;
  styleOblique: string;
  lineHeight: string;
  letterSpacing: string;
  decoration: string;
  underline: string;
  strikethrough: string;
  letterCase: string;
  caseOriginal: string;
  caseUppercase: string;
  caseLowercase: string;
  caseCapitalize: string;
  horizontalAlignment: string;
  verticalAlignment: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  alignJustify: string;
  alignTop: string;
  alignMiddle: string;
  alignBottom: string;
};

export type ViuVectorInspectorLabels = {
  section: string;
  pathData: string;
  invalidPath: string;
  closed: string;
  fillRule: string;
  nonzero: string;
  evenodd: string;
  strokeCap: string;
  strokeJoin: string;
  miterLimit: string;
  butt: string;
  round: string;
  square: string;
  miter: string;
  bevel: string;
  anchors: string;
  addAnchor: string;
  removeAnchor: string;
  removeHandle: string;
  pointType: string;
  corner: string;
  smooth: string;
  symmetric: string;
  handleIn: string;
  handleOut: string;
  x: string;
  y: string;
};

export type ViuAuthoringInspectorLabels = {
  title: string;
  selectionCount: (count: number) => string;
  mixed: string;
  text: {
    section: string;
    content: string;
    placeholder: string;
  };
  typography: ViuTypographyInspectorLabels;
  vector: ViuVectorInspectorLabels;

  component: ViuComponentInspectorLabels;
  prototype: ViuPrototypeInspectorLabels;

  layout: ViuLayoutInspectorLabels;
  image?: {
    section: string;
    fit: string;
    fitCover: string;
    fitContain: string;
    fitFill: string;
    fitNone: string;
    fitScaleDown: string;
    crop: string;
    focalPoint: string;
    rotation: string;
    flipHorizontal: string;
    flipVertical: string;
    reset: string;
  };
  stroke?: {
    section: string;
    add: string;
    remove: string;
    visible: string;
    color: string;
    width: string;
    alignment: string;
    inside: string;
    center: string;
    outside: string;
    cap: string;
    butt: string;
    round: string;
    square: string;
    join: string;
    miter: string;
    bevel: string;
    miterLimit: string;
    dashPattern: string;
    dashOffset: string;
  };
  quality?: {
    section: string;
    issueCount: (count: number) => string;
    noIssues: string;
    error: string;
    warning: string;
    issue: (code: string, entityId?: string) => string;
  };
  appearance: {
    section: string;
    fillStack: string;
    effectStack: string;
    addFill: string;
    addEffect: string;
    moveUp: string;
    moveDown: string;
    remove: string;
    visible: string;
    legacyFallback: string;
    effectDropShadow: string;
    effectInnerShadow: string;
    effectLayerBlur: string;
    effectBackdropBlur: string;
    radialCenterX: string;
    radialCenterY: string;
    radialRadius: string;
    textColor: string;
    background: string;
    fillType: string;
    fillSolid: string;
    fillLinear: string;
    fillRadial: string;
    fillStart: string;
    fillEnd: string;
    gradientAngle: string;
    cssValue: string;
    borderColor: string;
    borderWidth: string;
    borderStyle: string;
    borderNone: string;
    borderSolid: string;
    borderDashed: string;
    borderDotted: string;
    borderDouble: string;
    overflow: string;
    overflowVisible: string;
    overflowHidden: string;
    overflowScroll: string;
    opacity: string;
    radius: string;
    shadow: string;
    shadowPlaceholder: string;
    shadowX: string;
    shadowY: string;
    shadowBlur: string;
    shadowSpread: string;
    shadowColor: string;
    layerBlur: string;
    backdropBlur: string;
  };
  units: {
    pixels: string;
    percent: string;
  };
};

export type ViuAuthoringInspectorProps = {
  project: ViuProjectState;
  selection: ViuSelection;
  labels: ViuAuthoringInspectorLabels;
  fontOptions: readonly ViuFontOption[];
  fontWeightOptions: readonly ViuAuthoringOption<number>[];
  fontCatalog?: {
    status: ViuFontCatalogStatus;
    systemFontCount: number;
    onLoad: () => void;
  };
  onCommit: (batch: ViuAuthoringBatch) => void;
  disabled?: boolean;
  className?: string;
};
