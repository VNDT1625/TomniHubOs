/**
 * Renderer state for the exact provider-neutral context owned by AionRS.
 * Non-AionRS conversations must never call this hook with `enabled = true`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge, type AionrsContextBranch, type AionrsContextSnapshot } from '@/common';

const POLL_MS = 3000;

export type UseAionrsContext = {
  snapshot: AionrsContextSnapshot | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  save: (customContext: string, branches: AionrsContextBranch[]) => Promise<string | null>;
};

export const useAionrsContext = (conversationId: string | null, enabled: boolean): UseAionrsContext => {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<AionrsContextSnapshot | null>(null);
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
        const result = await ipcBridge.conversation.getAionrsContext.invoke({ conversation_id: conversationId });
        if (!result.ok) throw new Error(t('codex.error.context_error', { context: 'AionRS' }));
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
    async (customContext: string, branches: AionrsContextBranch[]): Promise<string | null> => {
      if (!conversationId || !enabled) return null;
      setSaving(true);
      try {
        const result = await ipcBridge.conversation.updateAionrsContext.invoke({
          conversation_id: conversationId,
          custom_context: customContext,
          context_branches: branches,
        });
        if (!result.ok) throw new Error(t('codex.error.context_error', { context: 'AionRS' }));
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
