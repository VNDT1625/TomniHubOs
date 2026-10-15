/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Contracts of the centre file viewer (S12) and the Library (S11) of docs/platform/repotopackage-design.md section 14.
 *
 * No request carries a file path. The renderer names a file by an opaque reference: a view id Main issued for a file
 * the person opened from Explorer, or the id of a Library entry. Main resolves the reference, re-validates the file
 * on every read (no traversal, no symlink, bounded size) and answers with content or a stable error code. A path only
 * travels Main -> renderer, for display, in `LibraryEntrySummary.path`.
 */

export const FILE_VIEWER_CHANNELS = {
  openFromExplorer: 'hub.fileViewer.open-from-explorer',
  read: 'hub.fileViewer.read',
  openExternal: 'hub.fileViewer.open-external',
} as const;

export const LIBRARY_CHANNELS = {
  list: 'hub.library.list',
  add: 'hub.library.add',
  addFromView: 'hub.library.add-from-view',
  repick: 'hub.library.repick',
  remove: 'hub.library.remove',
} as const;

/** Stable error codes; the renderer branches on these, never on message text. */
export type HubFileErrorCode = 'INVALID_REQUEST' | 'DENIED' | 'NOT_FOUND' | 'IO_ERROR' | 'CANCELLED' | 'LIMIT_EXCEEDED';

export type HubFileResult<T> = { ok: true; data: T } | { ok: false; code: HubFileErrorCode };

/** An opaque handle to one file. `view` ids are issued by Main for an Explorer file; `library` ids are entry ids. */
export type FileViewerRef = { kind: 'view'; id: string } | { kind: 'library'; id: string };

export type FileViewerContent =
  | { kind: 'text' | 'markdown' | 'code'; text: string; language?: string; truncated: boolean }
  | { kind: 'image' | 'pdf'; mime: string; base64: string }
  | { kind: 'unsupported' }
  | { kind: 'too-large'; limitBytes: number };

export type FileViewerDocument = {
  name: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: number;
  /** False for types an operating system would execute (scripts, programs): the viewer then offers no hand-off. */
  canOpenExternal: boolean;
  content: FileViewerContent;
};

export type FileViewerNativeAPI = {
  openFromExplorer(request: {
    sessionId: string;
    relativePath: string;
  }): Promise<HubFileResult<{ viewId: string; name: string }>>;
  read(request: { ref: FileViewerRef }): Promise<HubFileResult<FileViewerDocument>>;
  openExternal(request: { ref: FileViewerRef }): Promise<HubFileResult<null>>;
};

/** One Library document. The Library stores where a file is, never a copy of it. */
export type LibraryEntrySummary = {
  id: string;
  name: string;
  /** Display only; no request accepts it back. */
  path: string;
  extension: string;
  addedAt: number;
  /** The file is no longer at `path` (moved, renamed, deleted, or replaced by a link). */
  missing: boolean;
};

export type LibraryNativeAPI = {
  list(): Promise<HubFileResult<LibraryEntrySummary[]>>;
  /** Opens the native file picker in Main; resolves with the entries that were added (empty when cancelled). */
  add(): Promise<HubFileResult<LibraryEntrySummary[]>>;
  addFromView(request: { viewId: string }): Promise<HubFileResult<LibraryEntrySummary>>;
  /** Opens the native file picker in Main and points the entry at the chosen file. */
  repick(request: { entryId: string }): Promise<HubFileResult<LibraryEntrySummary>>;
  remove(request: { entryId: string }): Promise<HubFileResult<null>>;
};
