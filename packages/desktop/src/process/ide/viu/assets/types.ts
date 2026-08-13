/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export type ViuLocalAssetKind = 'image' | 'video' | 'model';

/** Renderer-safe metadata. It intentionally never contains a filesystem path. */
export type ViuLocalAssetRef = {
  id: string;
  protocolUrl: string;
  displayName: string;
  extension: string;
  mimeType: string;
  kind: ViuLocalAssetKind;
  sizeBytes: number;
  modifiedAtMs: number;
  metadataSha256: string;
  missing: boolean;
};

export type ViuLocalAssetInput = {
  /** An absolute path explicitly selected or pasted by the user. */
  path: string;
  /** An absolute file or directory path explicitly granted by the user. */
  grantPath: string;
  /** Declared MIME type. It must agree with the allow-listed extension. */
  mimeType: string;
};

export type ViuLocalAssetStat = {
  size: number;
  mtimeMs: number;
  dev?: number;
  ino?: number;
  isFile: () => boolean;
  isDirectory: () => boolean;
};

export type ViuLocalAssetIo = {
  realpath: (path: string) => Promise<string>;
  stat: (path: string) => Promise<ViuLocalAssetStat>;
};

export type ViuLocalAssetErrorCode =
  | 'INVALID_PATH'
  | 'GRANT_NOT_FOUND'
  | 'INVALID_GRANT'
  | 'ASSET_NOT_FOUND'
  | 'ASSET_MISSING'
  | 'NOT_A_FILE'
  | 'GRANT_ESCAPE'
  | 'GRANT_CHANGED'
  | 'DISALLOWED_EXTENSION'
  | 'DISALLOWED_MIME'
  | 'MIME_MISMATCH'
  | 'ASSET_ALREADY_GRANTED'
  | 'UNKNOWN_ASSET'
  | 'IO_ERROR';

export class ViuLocalAssetError extends Error {
  public constructor(
    public readonly code: ViuLocalAssetErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ViuLocalAssetError';
  }
}
