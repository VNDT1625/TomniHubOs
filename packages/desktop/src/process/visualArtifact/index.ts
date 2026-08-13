/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export type {
  AnalyzeVisualArtifactOptions,
  VisualArtifact,
  VisualArtifactBox,
  VisualArtifactColor,
  VisualArtifactCoordinateSystem,
  VisualArtifactRegion,
  VisualArtifactTextAnalyzer,
  VisualArtifactTextAnalyzerInput,
  VisualArtifactTextBlock,
} from './types';
export type { ImageSecurityScanOptions, ImageSecurityScanResult } from './imageSecurity';
export { scanImageForSensitiveText } from './imageSecurity';
export { analyzeTextWithLocalOcr, terminateLocalOcr } from './localOcr';
export {
  analyzeVisualArtifact,
  createVisualBox,
  renderVisualArtifactMockUi,
  renderVisualArtifactSemanticText,
} from './visualArtifact';
