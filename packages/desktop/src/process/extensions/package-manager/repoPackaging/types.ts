/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AdapterDocument, PackageManifest, RepoClassificationResult } from '../../../../common/packages';

/** Stable failure codes; callers branch on these and never parse the message. */
export type RepoPackagingErrorCode =
  | 'SOURCE_INVALID'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_OUTSIDE_WORKSPACE'
  | 'SOURCE_HOST_NOT_ALLOWED'
  | 'GIT_UNAVAILABLE'
  | 'CLONE_FAILED'
  | 'CLONE_TIMEOUT'
  | 'TOO_MANY_FILES'
  | 'PAYLOAD_TOO_LARGE'
  | 'DISK_SPACE_LOW'
  | 'EMPTY_REPOSITORY'
  | 'NOT_RUNNABLE'
  | 'MCP_AMBIGUOUS'
  | 'MANIFEST_INVALID'
  | 'SIGNING_KEY_INVALID'
  | 'VERIFY_FAILED'
  | 'CANCELLED';

/** A failure whose message is safe to show to the user and whose `details` carry structured context. */
export class RepoPackagingError extends Error {
  public readonly code: RepoPackagingErrorCode;
  public readonly details: Readonly<Record<string, unknown>> | undefined;

  public constructor(code: RepoPackagingErrorCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = 'RepoPackagingError';
    this.code = code;
    this.details = details;
  }
}

export type PackagingStage =
  | 'resolve'
  | 'fetch'
  | 'scan'
  | 'classify'
  | 'screen'
  | 'build'
  | 'sign'
  | 'write'
  | 'verify';

/** A real progress event: it is emitted when the stage starts and again when it finishes. */
export type RepoPackagingProgress = Readonly<{
  stage: PackagingStage;
  status: 'started' | 'done';
  detail?: string;
}>;

export type ExcludeReason =
  | 'secret-name'
  | 'secret-content'
  | 'build-output'
  | 'vcs-or-tooling'
  | 'lockfile'
  | 'too-large'
  | 'unsafe-path'
  | 'symlink'
  | 'output-directory'
  | 'outside-payload';

export type ExcludedFile = Readonly<{ path: string; reason: ExcludeReason; detail?: string }>;

export type PackagingWarningCode =
  | 'SECRET_IN_SOURCE'
  | 'LIFECYCLE_SCRIPT'
  | 'EXECUTABLE_CONTENT'
  | 'OBFUSCATED_CODE'
  | 'ABSOLUTE_ASSET_PATHS'
  | 'MCP_OTHER_PACKAGES'
  | 'DISK_SPACE_UNKNOWN';

export type PackagingWarning = Readonly<{ code: PackagingWarningCode; message: string; path?: string }>;

export type RepoSourceInfo = Readonly<{
  kind: 'local' | 'git';
  /** Human-readable origin: the resolved folder or the canonical clone URL. */
  display: string;
  ref?: string;
  /** Commit that was packaged (git sources only). */
  commit?: string;
  subdirectory?: string;
}>;

/** Where a package came from, so it can be updated later (design doc section 6.3). */
export type RepoProvenance = Readonly<{
  kind: 'git' | 'local' | 'url';
  /** Canonical clone URL for Git sources; never set for local folders. */
  url?: string;
  /** Full commit hash (40 hex characters) that was packaged, when it could be read. */
  commit?: string;
  ref?: string;
  subdirectory?: string;
  /** ISO 8601 time at which the package was built. */
  packagedAt: string;
}>;

/**
 * `maxFileBytes` is the only cap of the streaming packager. `maxFiles` and `maxPayloadBytes` are honoured
 * only by the legacy in-memory path (`streamingPackager: false`) and by callers that pass them explicitly.
 */
export type RepoPackagingLimits = Readonly<{
  maxFiles?: number;
  maxPayloadBytes?: number;
  maxFileBytes: number;
  cloneTimeoutMs: number;
}>;

export type RepoSigningOptions =
  | Readonly<{ privateKeyPem: string; keyId: string }>
  | Readonly<{
      /** Directory holding the persistent local key; it is created on first use. */
      keyDirectory: string;
      protect?: (plain: Buffer) => Buffer;
      unprotect?: (cipher: Buffer) => Buffer;
    }>;

export type RepoToPackageOptions = Readonly<{
  /**
   * A folder (relative paths resolve against `workspaceRoot`) or an `https` Git URL on an allowed host.
   * An empty value means the workspace root.
   */
  source: string;
  /** Local sources must stay inside this folder unless `allowLocalOutsideWorkspace` is set. */
  workspaceRoot?: string;
  /** Explicit opt-out used by the command line, where the caller is the user. */
  allowLocalOutsideWorkspace?: boolean;
  /** Where the `.tomny` file is written. It must outlive any temporary clone. */
  outputDirectory: string;
  /** Branch or tag for Git sources. */
  ref?: string;
  /** Package only this folder of the repository. */
  subdirectory?: string;
  packageId?: string;
  name?: string;
  publisherId?: string;
  version?: string;
  signing: RepoSigningOptions;
  allowedGitHosts?: readonly string[];
  limits?: Partial<RepoPackagingLimits>;
  /**
   * Internal flag, `true` by default: stream the archive to disk one file at a time. `false` selects the
   * legacy in-memory writer (with the old file-count and size caps) and exists until the wave 1 e2e passes.
   */
  streamingPackager?: boolean;
  /** Reads the free bytes of the drive holding a folder; replaceable so tests can simulate a full drive. */
  freeSpaceBytes?: (directory: string) => Promise<number>;
  signal?: AbortSignal;
  onProgress?: (event: RepoPackagingProgress) => void;
}>;

export type RepoToPackageResult = Readonly<{
  artifactPath: string;
  manifest: PackageManifest;
  classification: RepoClassificationResult;
  archiveBytes: number;
  keyId: string;
  /** Public half of the signing key, so the signature can be checked later. */
  publicKeyPem: string;
  keyFingerprint: string;
  includedFileCount: number;
  /** Files left out for a reason the user should see one by one (secrets, oversized, unsafe, symlinks). */
  excluded: readonly ExcludedFile[];
  /** How many files were left out per reason, including the reasons that are not listed individually. */
  excludedCounts: Readonly<Partial<Record<ExcludeReason, number>>>;
  warnings: readonly PackagingWarning[];
  /** True only after the written archive was re-read and its integrity and signature were checked. */
  verified: boolean;
  source: RepoSourceInfo;
  /**
   * Origin of the packaged files. It is also written into adapter.json (`provenance`) when the package has one.
   */
  provenance: RepoProvenance;
  /** The adapter written into the package, for archetypes packaged with the repository under source/ and for repositories whose detectors found connections. */
  adapter?: AdapterDocument;
}>;
