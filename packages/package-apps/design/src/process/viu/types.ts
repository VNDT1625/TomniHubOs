/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Main keeps filesystem-backed provenance separate from the serializable package display contract. */
import type {
  ViuCaptureRequest as SharedViuCaptureRequest,
  ViuCreateRequest as SharedViuCreateRequest,
  ViuDesignTokens,
  ViuDocument as SharedViuDocument,
  ViuFidelity,
  ViuFidelityStrategy,
  ViuImproveMode,
  ViuInteraction,
  ViuMotion,
  ViuNode as SharedViuNode,
  ViuNodeKind,
  ViuNodeStyle,
  ViuProject as SharedViuProject,
  ViuRect,
  ViuResult as SharedViuResult,
  ViuSourceKind,
  ViuSourceTrace as SharedViuSourceTrace,
} from '@/common/viu/legacyDisplay';

export type {
  ViuDesignTokens,
  ViuFidelity,
  ViuFidelityStrategy,
  ViuImproveMode,
  ViuInteraction,
  ViuMotion,
  ViuNodeKind,
  ViuNodeStyle,
  ViuRect,
  ViuSourceKind,
};

/** Main-only source evidence is never part of the package display model. */
export type ViuSourceTrace = SharedViuSourceTrace & { imagePath?: string };
export type ViuNode = Omit<SharedViuNode, 'sourceTrace'> & { sourceTrace: ViuSourceTrace };
export type ViuDocument = Omit<SharedViuDocument, 'nodes'> & { nodes: ViuNode[] };
export type ViuProject = Omit<SharedViuProject, 'documents'> & { documents: ViuDocument[]; referencePath?: string };

export type ViuCreateRequest = SharedViuCreateRequest;
export type ViuCaptureRequest = SharedViuCaptureRequest;
export type ViuImageRequest = { path: string };
export type ViuPersistRequest = { rootPath: string; project: ViuProject };
export type ViuPersistResult = { path: string; sha256: string; bytes: number };
export type ViuResult<T> = SharedViuResult<T>;
