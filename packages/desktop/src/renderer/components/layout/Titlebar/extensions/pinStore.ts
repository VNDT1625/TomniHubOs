/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pins that an earlier build kept in this browser's storage. Main keeps pins now; this only reads what is left over so
 * the hook can move it. Every access is wrapped: a blocked storage just means nothing to move.
 */

import { PIN_STORAGE_KEY, parsePinnedIds } from '@/common/integrations/extensions/surface';

export const readLegacyPins = (): string[] => {
  try {
    return parsePinnedIds(window.localStorage.getItem(PIN_STORAGE_KEY));
  } catch {
    return [];
  }
};

/** Keeps the ids still waiting to be moved; an empty list removes the key. */
export const writeLegacyPins = (ids: readonly string[]): void => {
  try {
    if (ids.length === 0) window.localStorage.removeItem(PIN_STORAGE_KEY);
    else window.localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage is unavailable; nothing else to clean up.
  }
};
