/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Shared serializable contracts for the Viu Visual UI workspace. */

export type ViuSourceKind = 'prompt' | 'url' | 'image';
export type ViuImproveMode = 'faithful' | 'professional' | 'creative';
export type ViuNodeKind = 'frame' | 'text' | 'image' | 'button' | 'shape' | 'runtime';
export type ViuFidelityStrategy = 'native' | 'preserved' | 'runtime' | 'raster';

export type ViuRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ViuNodeStyle = {
  fill?: string;
  backgroundImage?: string;
  backgroundPosition?: string;
  backgroundSize?: string;
  backgroundRepeat?: string;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  radius?: number;
  opacity?: number;
  borderColor?: string;
  borderWidth?: number;
  shadow?: string;
  objectFit?: 'cover' | 'contain' | 'fill';
  transform?: string;
  filter?: string;
  clipPath?: string;
  mixBlendMode?: string;
  overflow?: 'visible' | 'hidden' | 'auto';
};

export type ViuSourceTrace = {
  source: ViuSourceKind;
  url?: string;
  selector?: string;
  imagePath?: string;
  originalRect?: ViuRect;
};

export type ViuFidelity = {
  strategy: ViuFidelityStrategy;
  confidence: number;
  editableDepth: 'full' | 'properties' | 'surface';
  notes: string[];
};

export type ViuNode = {
  id: string;
  parentId: string | null;
  name: string;
  kind: ViuNodeKind;
  rect: ViuRect;
  zIndex: number;
  content: string;
  visible: boolean;
  locked: boolean;
  style: ViuNodeStyle;
  sourceTrace: ViuSourceTrace;
  fidelity: ViuFidelity;
  asset?: {
    kind: 'image' | 'video' | 'iframe';
    url: string;
    alt: string;
  };
  runtime?: {
    kind: 'canvas2d' | 'webgl' | 'webgl2' | 'webgpu' | 'unknown';
    width: number;
    height: number;
  };
};

export type ViuDesignTokens = {
  colors: string[];
  fontFamilies: string[];
  spacing: number[];
  radii: number[];
};

export type ViuInteraction = {
  id: string;
  nodeId: string;
  trigger: 'click' | 'hover' | 'focus' | 'scroll' | 'load';
  action: 'navigate' | 'state' | 'animate' | 'scrollTo';
  target: string;
};

export type ViuMotion = {
  id: string;
  nodeId: string;
  trigger: 'load' | 'scroll' | 'hover' | 'state';
  property: 'opacity' | 'transform' | 'camera' | 'custom';
  from: string;
  to: string;
  durationMs: number;
};

export type ViuDocument = {
  schemaVersion: '1';
  id: string;
  title: string;
  sourceKind: ViuSourceKind;
  sourceLabel: string;
  viewport: { width: number; height: number };
  page: { width: number; height: number; background: string };
  nodes: ViuNode[];
  tokens: ViuDesignTokens;
  interactions: ViuInteraction[];
  motion: ViuMotion[];
  limitations: string[];
  /** In-memory evidence only; removed before the project contract is persisted. */
  referencePreviewDataUrl?: string;
  createdAt: string;
};

export type ViuProject = {
  schemaVersion: '1';
  id: string;
  title: string;
  sourceKind: ViuSourceKind;
  prompt: string;
  improvedPrompt: string;
  improveMode: ViuImproveMode;
  documents: ViuDocument[];
  activeDocumentId: string;
  referencePreviewDataUrl?: string;
  referencePath?: string;
  createdAt: string;
  updatedAt: string;
};

export type ViuCreateRequest = {
  prompt: string;
  mode?: ViuImproveMode;
  viewport?: { width: number; height: number };
};

export type ViuCaptureRequest = {
  url: string;
  maxPages?: number;
  viewport?: { width: number; height: number };
};

export type ViuImageRequest = {
  path: string;
};

export type ViuPersistRequest = {
  rootPath: string;
  project: ViuProject;
};

export type ViuPersistResult = {
  path: string;
  sha256: string;
  bytes: number;
};

export type ViuResult<T> = { ok: true; data: T } | { ok: false; error: string };
