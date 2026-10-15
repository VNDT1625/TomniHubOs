/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Hub "Active" sessions for Document Studio: one per kept-alive open file. */

import type { LiveSession } from '@/common/liveSessions/model';

export const DOCUMENT_STUDIO_APP_ID = 'com.tomni.document-studio';

/** Studio keeps no per-file saving/dirty state in the renderer, so open files are idle. */
export const buildStudioLiveSessions = (openFiles: readonly string[]): LiveSession[] => {
  const seen = new Set<string>();
  const sessions: LiveSession[] = [];
  for (const filePath of openFiles) {
    if (typeof filePath !== 'string' || !filePath || seen.has(filePath)) continue;
    seen.add(filePath);
    const cut = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf(String.fromCharCode(92)));
    const title = cut >= 0 ? filePath.slice(cut + 1) : filePath;
    const dir = cut > 0 ? filePath.slice(0, cut) : undefined;
    sessions.push({ id: filePath, title: title || filePath, status: 'idle', ...(dir ? { detail: dir.slice(-80) } : {}) });
  }
  return sessions;
};
