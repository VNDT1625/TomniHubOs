/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge, type TomnyAgenticContextBranch, type TomnyAgenticContextSnapshot } from '@/common';

const POLL_MS = 3000;

export type UseCoreAgenticContext = {
  snapshot: TomnyAgenticContextSnapshot | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  save: (customContext: string, branches: TomnyAgenticContextBranch[]) => Promise<string | null>;
};

export const useCoreAgenticContext = (conversationId: string | null, enabled: boolean): UseCoreAgenticContext => {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<TomnyAgenticContextSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);
  const refreshRequestRef = useRef<{ conversationId: string; promise: Promise<void> } | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (!conversationId || !enabled) {
      setSnapshot(null);
      setError(null);
      return Promise.resolve();
    }
    if (refreshRequestRef.current?.conversationId === conversationId) {
      return refreshRequestRef.current.promise;
    }

    setLoading(true);
    const requestedConversationId = conversationId;
    const request = (async (): Promise<void> => {
      try {
        const result = await ipcBridge.conversation.getTomnyAgenticContext.invoke({
          conversation_id: requestedConversationId,
        });
        if (!result.ok)
          throw new Error(
            t('codex.error.context_error', { context: 'Tomny CLI', defaultValue: 'Context load failed' })
          );
        if (!aliveRef.current || refreshRequestRef.current?.promise !== request) return;
        setSnapshot(result.data);
        setError(null);
      } catch (reason) {
        if (!aliveRef.current || refreshRequestRef.current?.promise !== request) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (refreshRequestRef.current?.promise === request) {
          refreshRequestRef.current = null;
          if (aliveRef.current) setLoading(false);
        }
      }
    })();

    refreshRequestRef.current = { conversationId, promise: request };
    return request;
  }, [conversationId, enabled, t]);

  const save = useCallback(
    async (customContext: string, branches: TomnyAgenticContextBranch[]): Promise<string | null> => {
      if (!conversationId || !enabled) return 'No active conversation.';
      setSaving(true);
      try {
        const result = await ipcBridge.conversation.updateTomnyAgenticContext.invoke({
          conversation_id: conversationId,
          custom_context: customContext,
          context_branches: branches,
        });
        if (result.ok === false) {
          const err = ('error' in result ? result.error : undefined) || 'Failed to update context';
          if (aliveRef.current) setError(err);
          return err;
        }
        if (aliveRef.current) {
          setSnapshot(result.data);
          setError(null);
        }
        return null;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        if (aliveRef.current) setError(message);
        return message;
      } finally {
        if (aliveRef.current) setSaving(false);
      }
    },
    [conversationId, enabled]
  );

  useEffect(() => {
    if (!conversationId || !enabled) return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [conversationId, enabled, refresh]);

  return { snapshot, loading, saving, error, refresh, save };
};

export default useCoreAgenticContext;
