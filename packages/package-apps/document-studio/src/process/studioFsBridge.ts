/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Studio binary-write IPC bridge.
 *
 * The tomnycore `/api/fs/write` endpoint persists its `data` field as literal
 * UTF-8 text — it does NOT base64-decode — so writing a binary file (a `.docx`
 * ZIP, an image, …) through it corrupts the bytes. Editing + saving a Word
 * document therefore needs a binary-safe write that the Rust backend does not
 * provide.
 *
 * This Main-process bridge fills that gap: it accepts a path + base64 payload
 * and writes the **decoded bytes** straight to disk with Node `fs`. It is the
 * same pattern the other Tomny native bridges use (Electron `bridge`
 * helper, not an HTTP route). Desktop-only — in WebUI mode the renderer is
 * remote, so binary editing is a desktop feature.
 *
 * The global bootstrap calls {@link registerStudioFsBridge} once; this module
 * does not wire itself in (mirrors `companyBridge.ts`). Process boundary:
 * Main-process (Node.js) module. No DOM APIs.
 */

import { bridge } from '@office-ai/platform';
import { promises as fs } from 'node:fs';

/** IPC channel names for the Studio fs surface (renderer-safe contract). */
export const STUDIO_FS_CHANNELS = {
  writeBinary: 'studio.write-binary',
  readBinary: 'studio.read-binary',
} as const;

/** Request for {@link STUDIO_FS_CHANNELS.writeBinary}. */
export type WriteBinaryRequest = {
  /** Absolute path of the file to (over)write. */
  path: string;
  /** Base64-encoded file content (may include a `data:...;base64,` prefix). */
  base64: string;
};

/** Request for {@link STUDIO_FS_CHANNELS.readBinary}. */
export type ReadBinaryRequest = {
  /** Absolute path of the file to read. */
  path: string;
};

/**
 * Result envelope — always resolves (never rejects) so the renderer can branch
 * on `ok` instead of hanging on a swallowed rejection.
 */
export type StudioFsResult = { ok: true } | { ok: false; error: string };

/** Result of a binary read: base64 bytes on success. */
export type StudioReadResult = { ok: true; base64: string } | { ok: false; error: string };

/**
 * The renderer-controlled binary writer has no actor/origin, path-capability,
 * consent, Trust admission, limit, or durable Run receipt boundary. Keep its
 * stable channel and request metadata for compatibility, but deny it before a
 * payload is decoded, a directory is created, or a file can be modified.
 */
export const STUDIO_BINARY_WRITE_GOVERNANCE_REQUIRED =
  'Studio binary writing is disabled until the governed Main file-operation seam is available.';

/** Typed Studio fs channels. Exported for bootstrap registration wiring. */
export const studioFsChannels = {
  writeBinary: bridge.buildProvider<StudioFsResult, WriteBinaryRequest>(STUDIO_FS_CHANNELS.writeBinary),
  readBinary: bridge.buildProvider<StudioReadResult, ReadBinaryRequest>(STUDIO_FS_CHANNELS.readBinary),
};

/**
 * Register the Studio binary read/write handlers. Idempotent (re-registration
 * replaces the bound handler). Intended to be called once during bootstrap.
 */
export function registerStudioFsBridge(): void {
  studioFsChannels.writeBinary.provider(() => Promise.reject(new Error(STUDIO_BINARY_WRITE_GOVERNANCE_REQUIRED)));

  // Read raw bytes by path → base64. This is the reliable byte-exact read used by
  // the formatted viewers (docx-preview, …); it avoids any renderer-side base64
  // round-trip that could corrupt a ZIP (the JSZip "end of central directory"
  // error). Mirrors how Edit mode reads the file straight from disk.
  studioFsChannels.readBinary.provider(async (req): Promise<StudioReadResult> => {
    try {
      if (!req.path || req.path.trim().length === 0) {
        throw new Error('A file path is required.');
      }
      const buffer = await fs.readFile(req.path);
      return { ok: true, base64: buffer.toString('base64') };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[StudioFsBridge] readBinary failed:', error);
      return { ok: false, error: message };
    }
  });
}
