/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FileViewerRef } from '@/common/integrations/library/libraryContracts';

export const FILE_VIEWER_ROUTE = '/file-viewer';
export const LIBRARY_ROUTE = '/library';

const MAX_ID_LENGTH = 128;

/** Route of the centre file viewer for one opaque reference. The URL never carries a file path. */
export const fileViewerPath = (ref: FileViewerRef): string =>
  `${FILE_VIEWER_ROUTE}?${new URLSearchParams({ src: ref.kind, id: ref.id }).toString()}`;

/** Reads the reference back from the query string; anything malformed is no reference at all. */
export const parseFileViewerSearch = (params: URLSearchParams): FileViewerRef | null => {
  const source = params.get('src');
  const id = params.get('id');
  if (!id || id.length > MAX_ID_LENGTH) return null;
  return source === 'view' || source === 'library' ? { kind: source, id } : null;
};
