/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Per-conversation Super switch. Super is a Core runtime policy: on the next
 * turn it builds one unified `tomny_*` ToolMap from all registered Surface
 * capabilities. It must not be coupled to Browser-Control (or any other
 * individual MCP server), otherwise every new surface would need UI changes.
 */

import { ipcBridge } from '@/common';
import { useCallback, useEffect, useState } from 'react';

/** @deprecated Import from `superGuidance`; retained for existing callers. */
export { BROWSER_CONTROL_MCP_NAME } from './superGuidance';

const SUPER_KEY_PREFIX = 'aionui.super.';

const loadSuper = (conversationId: string): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(`${SUPER_KEY_PREFIX}${conversationId}`) === '1';
  } catch {
    return false;
  }
};

const saveSuper = (conversationId: string, on: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    if (on) window.localStorage.setItem(`${SUPER_KEY_PREFIX}${conversationId}`, '1');
    else window.localStorage.removeItem(`${SUPER_KEY_PREFIX}${conversationId}`);
  } catch {
    // The persisted conversation flag remains authoritative.
  }
};

export type SuperStatus = 'unavailable' | 'off' | 'on' | 'pending';

export type UseSuperMode = {
  available: boolean;
  enabled: boolean;
  pending: boolean;
  error: string | null;
  toggle: (next: boolean) => Promise<boolean>;
};

export function useSuperMode(conversationId: string | undefined): UseSuperMode {
  const [enabled, setEnabled] = useState<boolean>(() => (conversationId ? loadSuper(conversationId) : false));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setEnabled(false);
      setError(null);
      return;
    }
    setEnabled(loadSuper(conversationId));
    setError(null);
    let alive = true;
    void ipcBridge.conversation.get
      .invoke({ id: conversationId })
      .then((conv) => {
        if (!alive) return;
        const extra = (conv?.extra ?? {}) as { preset_rules?: string; super_mode?: boolean };
        // The rules marker is a one-way migration path for pre-flag conversations.
        const superEnabled =
          extra.super_mode === true || extra.preset_rules?.includes('## Super capabilities (Super is ON)') === true;
        setEnabled(superEnabled);
        saveSuper(conversationId, superEnabled);
      })
      .catch(() => {
        // Keep the optimistic remembered value on a transient read error.
      });
    return () => {
      alive = false;
    };
  }, [conversationId]);

  const toggle = useCallback(
    async (next: boolean) => {
      if (!conversationId) return false;
      setPending(true);
      setError(null);
      try {
        const ok = await ipcBridge.conversation.update.invoke({
          id: conversationId,
          updates: { super_mode: next } as never,
          merge_extra: true,
        });
        if (!ok) throw new Error('The conversation could not be updated.');
        setEnabled(next);
        saveSuper(conversationId, next);
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      } finally {
        setPending(false);
      }
    },
    [conversationId]
  );

  return { available: Boolean(conversationId), enabled, pending, error, toggle };
}
