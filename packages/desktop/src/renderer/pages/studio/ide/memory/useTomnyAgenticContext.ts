/**
 * Renderer state for the exact provider-neutral context owned by Tomny CLI.
 * Non-Tomny CLI conversations must never call this hook with `enabled = true`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge, type TomnyAgenticContextBranch, type TomnyAgenticContextSnapshot } from '@/common';

const POLL_MS = 3000;

export type UseTomnyAgenticContext = {
  snapshot: TomnyAgenticContextSnapshot | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  save: (customContext: string, branches: TomnyAgenticContextBranch[]) => Promise<string | null>;
};

export const useTomnyAgenticContext = (conversationId: string | null, enabled: boolean): UseTomnyAgenticContext => {
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
    if (refreshRequestRef.current?.conversationId === conversationId) return refreshRequestRef.current.promise;

    setLoading(true);
    const requestedConversationId = conversationId;
    const request = (async (): Promise<void> => {
      try {
        const result = await ipcBridge.conversation.getTomnyAgenticContext.invoke({ conversation_id: conversationId });
        if (!result.ok) throw new Error(t('codex.error.context_error', { context: 'Tomny CLI' }));
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
    refreshRequestRef.current = { conversationId: requestedConversationId, promise: request };
    return request;
  }, [conversationId, enabled, t]);

  const save = useCallback(
    async (customContext: string, branches: TomnyAgenticContextBranch[]): Promise<string | null> => {
      if (!conversationId || !enabled) return null;
      setSaving(true);
      try {
        const result = await ipcBridge.conversation.updateTomnyAgenticContext.invoke({
          conversation_id: conversationId,
          custom_context: customContext,
          context_branches: branches,
        });
        if (!result.ok) throw new Error(t('codex.error.context_error', { context: 'Tomny CLI' }));
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
    [conversationId, enabled, t]
  );

  useEffect(() => {
    if (!conversationId || !enabled) return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [conversationId, enabled, refresh]);

  return { snapshot, loading, saving, error, refresh, save };
};
