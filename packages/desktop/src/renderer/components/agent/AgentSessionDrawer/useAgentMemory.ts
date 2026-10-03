/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionMemoryClient, type IdeMemoryRecordableKind } from '@/renderer/services/sessionMemoryClient';
import type { SuperMemorySnapshot } from '@process/userUnderstanding/sessionMemoryStore';

const POLL_MS = 3000;

export type UseAgentMemory = {
  snapshot: SuperMemorySnapshot | null;
  loading: boolean;
  refresh: () => Promise<void>;
  clear: () => Promise<void>;
  remember: (text: string, opts?: { kind?: IdeMemoryRecordableKind; pinned?: boolean }) => Promise<string | null>;
};

export const useAgentMemory = (sessionId: string | null, enabled: boolean): UseAgentMemory => {
  const [snapshot, setSnapshot] = useState<SuperMemorySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!sessionId) {
      setSnapshot(null);
      return;
    }
    setLoading(true);
    try {
      const res = await sessionMemoryClient.memorySnapshot(sessionId).catch((): null => null);
      if (!aliveRef.current) return;
      setSnapshot(res?.ok ? res.data : null);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [sessionId]);

  const clear = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    await sessionMemoryClient.memoryClear(sessionId).catch((): undefined => undefined);
    await refresh();
  }, [sessionId, refresh]);

  const remember = useCallback(
    async (text: string, opts?: { kind?: IdeMemoryRecordableKind; pinned?: boolean }): Promise<string | null> => {
      if (!sessionId) return 'No active session.';
      const trimmed = text.trim();
      if (!trimmed) return 'Note is empty.';
      const res = await sessionMemoryClient.memoryRemember(sessionId, trimmed, opts).catch((error) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      }));
      if (res.ok === false) return res.error;
      await refresh();
      return null;
    },
    [sessionId, refresh]
  );

  useEffect(() => {
    if (!enabled || !sessionId) return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, sessionId, refresh]);

  return { snapshot, loading, refresh, clear, remember };
};
