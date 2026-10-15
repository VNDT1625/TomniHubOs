/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { commonFields, connectionId, packagePath, title, type Shaped } from '../primitives';

/** Standard base64 (no URL-safe alphabet, no whitespace). */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** One surface name: lower-case words only, so a manifest cannot smuggle a path or a sentence into the field. */
const SURFACE_NAME = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * `extension`: a browser extension or userscript. The fields record what it asks for so the user can consent before
 * it is switched on; `unsupported` lists Chrome APIs the host has no shim for. `publicKey` (SPKI, base64) only
 * keeps the extension id stable; it carries no trust.
 */
export const buildExtensionConnection = (shaped: Shaped) =>
  shaped({
    kind: z.literal('extension'),
    id: connectionId,
    title,
    format: z.enum(['chrome-mv3', 'chrome-mv2', 'userscript']),
    /** A folder for a Chrome extension, a file for a userscript. */
    root: packagePath,
    version: z.string().min(1).max(64).optional(),
    permissions: z.array(z.string().min(1).max(100)).max(100),
    hostPermissions: z.array(z.string().min(1).max(500)).max(100),
    matches: z.array(z.string().min(1).max(500)).max(100).optional(),
    unsupported: z.array(z.string().min(1).max(100)).max(100),
    needsBuild: z.boolean().optional(),
    /**
     * Header surfaces the extension shows on (for example `browser`). Missing or unknown names mean `none`, every
     * surface; the reader keeps unknown names and maps them to `none` (common/integrations/extensions/surface.ts).
     */
    surfaces: z.array(z.string().regex(SURFACE_NAME)).max(8).optional(),
    publicKey: z.string().min(1).max(1000).regex(BASE64).optional(),
    ...commonFields,
  });
