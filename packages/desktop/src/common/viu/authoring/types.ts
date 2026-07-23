/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ViuBindableProperty,
  ViuCommand,
  ViuConstraints,
  ViuEffect,
  ViuFill,
  ViuId,
  ViuImageTransform,
  ViuLayoutContainer,
  ViuNodeStyle,
  ViuStroke,
  ViuResponsiveNodeOverride,
  ViuSizing,
  ViuVariableBinding,
} from '../types';

export type ViuSelection = {
  nodeIds: readonly ViuId[];
  anchorId: ViuId | null;
};

export type ViuSelectionPolicy = {
  includeLocked?: boolean;
  includeHidden?: boolean;
};

export type ViuMarqueeMode = 'contains' | 'intersects';
export type ViuRect = { x: number; y: number; width: number; height: number };

export type ViuAlignment = 'left' | 'horizontal-center' | 'right' | 'top' | 'vertical-center' | 'bottom';
export type ViuDistributionAxis = 'horizontal' | 'vertical';
export type ViuTextAlign = 'left' | 'center' | 'right' | 'justify';
export type ViuVerticalAlign = 'top' | 'middle' | 'bottom';
export type ViuFontStyle = 'normal' | 'italic' | 'oblique';
export type ViuTextDecoration = 'none' | 'underline' | 'line-through' | 'underline line-through';
export type ViuTextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize';

export type ViuAuthoringNodeStyle = ViuNodeStyle & {
  textAlign?: ViuTextAlign;
  verticalAlign?: ViuVerticalAlign;
};

export type ViuTypographyPatch = {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: ViuFontStyle;
  lineHeight?: number;
  letterSpacing?: number;
  textDecoration?: ViuTextDecoration;
  textTransform?: ViuTextTransform;
  textAlign?: ViuTextAlign;
  verticalAlign?: ViuVerticalAlign;
};

export type ViuAppearancePatch = {
  fills?: ViuFill[];
  effects?: ViuEffect[];
  strokes?: ViuStroke[];
  color?: string;
  background?: string;
  opacity?: number;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: 'none' | 'solid' | 'dashed' | 'dotted' | 'double';
  borderRadius?: number;
  borderRadii?: [number, number, number, number];
  strokeAlignment?: 'inside' | 'center' | 'outside';
  shadow?: string;
  blur?: number;
  backdropBlur?: number;
  overflow?: 'visible' | 'hidden' | 'scroll';
};

export type ViuImageTransformPatch = Partial<Omit<ViuImageTransform, 'crop' | 'focalPoint'>> & {
  crop?: Partial<ViuImageTransform['crop']>;
  focalPoint?: Partial<ViuImageTransform['focalPoint']>;
};

export type ViuLayoutPatch = {
  layout?: Partial<ViuLayoutContainer>;
  sizing?: Partial<ViuSizing>;
  constraints?: Partial<ViuConstraints>;
  positionMode?: 'flow' | 'absolute';
  rotation?: number;
  borderRadii?: [number, number, number, number];
  strokeAlignment?: 'inside' | 'center' | 'outside';
  variableBindings?: Partial<Record<ViuBindableProperty, ViuVariableBinding | null>>;
  breakpointId?: ViuId;
  responsiveOverride?: ViuResponsiveNodeOverride;
};

export type ViuAuthoringIntent =
  | 'duplicate'
  | 'delete'
  | 'group'
  | 'ungroup'
  | 'align'
  | 'distribute'
  | 'text-content'
  | 'typography'
  | 'appearance'
  | 'image-transform'
  | 'layout'
  | 'responsive'
  | 'design-system'
  | 'precision'
  | 'vector'
  | 'component-create'
  | 'component-update'
  | 'component-instance'
  | 'component-variants'
  | 'component-property'
  | 'component-reset'
  | 'component-detach'
  | 'interaction-create'
  | 'interaction-update'
  | 'interaction-delete'
  | 'timeline-create'
  | 'timeline-update'
  | 'timeline-delete'
  | 'scroll-binding';

export type ViuAuthoringBatch = {
  intent: ViuAuthoringIntent;
  commands: readonly ViuCommand[];
  nextSelection?: ViuSelection;
};

export type ViuAuthoringIdKind = 'node' | 'interaction';
export type ViuAuthoringIdFactory = (kind: ViuAuthoringIdKind, sourceId: ViuId) => ViuId;

export type ViuDuplicateOptions = {
  idFactory: ViuAuthoringIdFactory;
  offset?: { x: number; y: number };
};

export type ViuGroupOptions = {
  groupId: ViuId;
  groupName: string;
};

export type ViuHistoryEntry = {
  transactionId: ViuId;
  summary: string;
  forwardCommands: readonly ViuCommand[];
  inverseCommands: readonly ViuCommand[];
};

export type ViuHistoryJournal = {
  past: readonly ViuHistoryEntry[];
  future: readonly ViuHistoryEntry[];
  limit: number;
};
