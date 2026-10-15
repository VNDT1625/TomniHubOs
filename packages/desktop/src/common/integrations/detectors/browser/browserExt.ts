/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `browser-ext` detector (design section 7.3). It finds Chrome extensions (Manifest V3 as a usable connection,
 * Manifest V2 recorded as unsupported), extension projects that still need a build (WXT, Plasmo,
 * `@crxjs/vite-plugin`) and userscripts, and turns each into an `extension` connection.
 *
 * Boundaries: pure, reads only `inventory.text()`, never throws, never runs a build or fetches a `@require`, and
 * never needs a token or the network. Permissions the host has no shim for (`chromeApiSupport.ts`) are listed in
 * the connection's `unsupported` and in an open item; broad site access becomes a `needs-consent` item.
 */

import type { Detector, DetectorResult, RepoInventory } from '../types';
import { detectChromeExtensions } from './chromeExtension';
import { createContext } from './support';
import { detectUserscripts } from './userscript';

export const BROWSER_EXT_DETECTOR_ID = 'browser-ext';
export const BROWSER_EXT_DETECTOR_VERSION = 1;

const detect = (inventory: RepoInventory): DetectorResult => {
  const context = createContext(inventory);
  try {
    detectChromeExtensions(context);
  } catch {
    context.openItems.push({
      kind: 'unrecognized',
      note: 'Bộ nhận diện browser-ext gặp lỗi không mong đợi khi đọc extension; phần này bị bỏ',
    });
  }
  try {
    detectUserscripts(context);
  } catch {
    context.openItems.push({
      kind: 'unrecognized',
      note: 'Bộ nhận diện browser-ext gặp lỗi không mong đợi khi đọc userscript; phần này bị bỏ',
    });
  }
  return {
    connections: context.connections,
    openItems: context.openItems,
    reasons: context.reasons,
    claimed: [...context.claimed].toSorted(),
  };
};

export const browserExt: Detector = {
  id: BROWSER_EXT_DETECTOR_ID,
  version: BROWSER_EXT_DETECTOR_VERSION,
  detect,
};
