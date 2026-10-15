/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import type { SiteAccessMode } from '@/common/integrations/extensions/siteAccess';
import type { ExtensionStripItem, ExtensionStripNativeAPI } from '@/common/integrations/extensions/stripContract';
import { readLegacyPins, writeLegacyPins } from './pinStore';

const stripApi = (): ExtensionStripNativeAPI | undefined => window.electronAPI?.extensionStrip;

type ActionOutcome = Readonly<{ ok: boolean; error?: string }>;

export type ExtensionStripData = Readonly<{
  items: ExtensionStripItem[];
  pinnedIds: string[];
  /** True when the last list request failed; the strip then shows no extensions. */
  failed: boolean;
  /** True when the last change was refused or failed (a cancelled uninstall does not count). */
  actionFailed: boolean;
  refresh: () => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  setSiteAccess: (id: string, mode: SiteAccessMode) => Promise<void>;
  allowSite: (id: string) => Promise<void>;
  uninstall: (packageId: string) => Promise<void>;
}>;

/**
 * The extensions the strip shows, with their pins, site access and icons. Everything is read from and written to Main;
 * the renderer names only ids and choices. Without the desktop bridge the list is empty.
 */
export const useExtensionStrip = (): ExtensionStripData => {
  const [items, setItems] = useState<ExtensionStripItem[]>([]);
  const [failed, setFailed] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const api = stripApi();
    if (!api) {
      setItems([]);
      return;
    }
    try {
      const result = await api.list({});
      if (result.ok) {
        setItems(result.data);
        setFailed(false);
      } else {
        setItems([]);
        setFailed(true);
      }
    } catch {
      setItems([]);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Pins from an earlier build move to Main once: an id that is loaded now is pinned there and dropped from storage.
  useEffect(() => {
    const legacy = readLegacyPins();
    const api = stripApi();
    if (legacy.length === 0 || !api || items.length === 0) return;
    const loaded = new Set(items.map((item) => item.id));
    const waiting = legacy.filter((id) => !loaded.has(id));
    const toMove = legacy.filter((id) => loaded.has(id) && !items.some((item) => item.id === id && item.pinned));
    writeLegacyPins(waiting);
    if (toMove.length === 0) return;
    void Promise.all(toMove.map((id) => api.setPinned({ id, pinned: true }))).then(
      () => refresh(),
      (): undefined => undefined
    );
  }, [items, refresh]);

  const run = useCallback(
    async (call: (api: ExtensionStripNativeAPI) => Promise<ActionOutcome>): Promise<void> => {
      const api = stripApi();
      if (!api) return;
      try {
        const outcome = await call(api);
        setActionFailed(!outcome.ok && outcome.error !== 'CANCELLED');
      } catch {
        setActionFailed(true);
      }
      await refresh();
    },
    [refresh]
  );

  const togglePin = useCallback(
    async (id: string): Promise<void> => {
      const item = items.find((entry) => entry.id === id);
      if (!item) return;
      await run((api) => api.setPinned({ id, pinned: !item.pinned }));
    },
    [items, run]
  );

  const setSiteAccess = useCallback(
    (id: string, mode: SiteAccessMode): Promise<void> => run((api) => api.setSiteAccess({ id, mode })),
    [run]
  );

  const allowSite = useCallback((id: string): Promise<void> => run((api) => api.allowSite({ id })), [run]);

  const uninstall = useCallback(
    (packageId: string): Promise<void> => run((api) => api.uninstall({ packageId })),
    [run]
  );

  return {
    items,
    pinnedIds: items.filter((item) => item.pinned).map((item) => item.id),
    failed,
    actionFailed,
    refresh,
    togglePin,
    setSiteAccess,
    allowSite,
    uninstall,
  };
};
