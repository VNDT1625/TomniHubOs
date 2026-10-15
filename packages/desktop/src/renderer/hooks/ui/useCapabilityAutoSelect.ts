/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_CAPABILITY_MODE, readCapabilityMode, type CapabilityMode } from '@/common/config/storage';
import { useCallback, useState } from 'react';

/**
 * Per-viewer convenience only: the mode the Home composer starts new conversations with. The conversation stores its
 * own `capabilityMode`, which is what the backend reads. Storage failures fall back to the default silently.
 */
const STORAGE_KEY = 'tomny.capabilityMode';

const readStoredMode = (): CapabilityMode => {
  try {
    return readCapabilityMode(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_CAPABILITY_MODE;
  }
};

const writeStoredMode = (mode: CapabilityMode): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage can be blocked; the in-memory choice still applies to this session.
  }
};

/**
 * State of the "Auto select" option in the attach and tools menus. `autoSelect` is true when the composer should send
 * `capabilityMode: 'auto'`, which hides the manual skill, plugin and hook lists.
 */
export const useCapabilityAutoSelect = (): {
  capabilityMode: CapabilityMode;
  autoSelect: boolean;
  onToggleAutoSelect: () => void;
} => {
  const [capabilityMode, setCapabilityMode] = useState<CapabilityMode>(readStoredMode);
  const onToggleAutoSelect = useCallback(() => {
    setCapabilityMode((current) => {
      const next: CapabilityMode = current === 'auto' ? 'manual' : 'auto';
      writeStoredMode(next);
      return next;
    });
  }, []);
  return { capabilityMode, autoSelect: capabilityMode === 'auto', onToggleAutoSelect };
};
