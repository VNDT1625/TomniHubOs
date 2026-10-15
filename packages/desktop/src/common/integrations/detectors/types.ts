/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Contracts of the repository detectors (docs/platform/repotopackage-design.md sections 7.1 and 7.2). A detector is a
 * pure function of a `RepoInventory`: no I/O, no model, no network. The files are data of an untrusted repository.
 */

import type { AdapterConnection, AdapterOpenItem } from '@/common/packages/adapter';

/** What a detector may look at: the file tree and the text of the small declaration files, nothing else. */
export type RepoInventory = Readonly<{
  /** Normalized repository-relative paths (forward slashes, no `..`), unique and sorted. */
  files: readonly string[];
  sizes: ReadonlyMap<string, number>;
  /** Text of a declaration file (`isDeclarationFile`), capped per file; `undefined` for every other path. */
  text: (path: string) => string | undefined;
  /** Declaration files whose text was not read because the total read budget was spent. Sorted. */
  overflow: readonly string[];
}>;

/** What one detector found. `claimed` lists the declaration files it handled, as repository-relative paths. */
export type DetectorResult = Readonly<{
  connections: readonly AdapterConnection[];
  openItems: readonly AdapterOpenItem[];
  /** Short sentences for the report. */
  reasons: readonly string[];
  claimed: readonly string[];
}>;

/**
 * `detect` is pure and must not throw; the runner still catches a throw and reports it as an open item so one broken
 * detector never hides the others. The result must not depend on the order detectors run in.
 */
export type Detector = Readonly<{
  id: string;
  version: number;
  detect: (inventory: RepoInventory) => DetectorResult;
}>;

/** The merged outcome of all detectors (design section 7.5). */
export type MergedDetection = Readonly<{
  /** Deduplicated, ids unique, sorted by `connectionKey`. */
  connections: readonly AdapterConnection[];
  openItems: readonly AdapterOpenItem[];
  reasons: readonly string[];
  /** Display label only (`pickArchetypeLabel`); it is not a `RepoArchetype`. */
  archetype: string;
}>;

/** `MergedDetection` plus the `"<id>@<version>"` entries for the document-level `detectors` list. */
export type DetectionReport = MergedDetection &
  Readonly<{
    detectors: readonly string[];
  }>;

/**
 * Hash used only to build a dedupe key for hooks. It does not need to be cryptographic: a collision would at worst
 * merge two hooks that differ, so the default is a fast 128-bit non-cryptographic hash.
 */
export type TextHash = (text: string) => string;

export type MergeOptions = Readonly<{
  hash?: TextHash;
}>;
