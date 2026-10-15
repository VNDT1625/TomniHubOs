import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionMemoryClient, type IdeMemoryRecordableKind } from '@/renderer/services/sessionMemoryClient';
import type { SessionMemorySnapshot } from '@/common/types/platform/sessionMemory';

type MemoryState = {
  sessionId: string | null;
  snapshot: SessionMemorySnapshot | null;
  loading: boolean;
  busy: boolean;
  error: 'load' | 'save' | 'clear' | 'forget' | null;
};

const initialState = (sessionId: string | null): MemoryState => ({
  sessionId,
  snapshot: null,
  loading: false,
  busy: false,
  error: null,
});

/** Requests are scoped to the selected conversation; late responses never replace another agent's memory. */
export const useHomeMemory = (sessionId: string | null, active: boolean) => {
  const [state, setState] = useState<MemoryState>(() => initialState(sessionId));
  const scope = useRef({ sessionId, active, version: 0 });
  if (scope.current.sessionId !== sessionId || scope.current.active !== active) {
    scope.current = { sessionId, active, version: scope.current.version + 1 };
  }
  const alive = useRef(true);
  const pending = useRef<number | null>(null);
  const mutating = useRef<number | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      scope.current.version += 1;
    };
  }, []);

  const refresh = useCallback(async (afterMutation = false): Promise<void> => {
    const current = scope.current;
    if (
      !current.active ||
      !current.sessionId ||
      pending.current === current.version ||
      (!afterMutation && mutating.current === current.version)
    )
      return;
    const version = current.version;
    const id = current.sessionId;
    const valid = () => alive.current && scope.current.version === version;
    pending.current = version;
    setState((old) => ({ ...(old.sessionId === id ? old : initialState(id)), loading: true, error: null }));
    try {
      const result = await sessionMemoryClient.memorySnapshot(id);
      if (!valid()) return;
      if (!result.ok || result.data.sessionId !== id) {
        setState((old) => ({ ...old, snapshot: null, error: 'load' }));
        return;
      }
      setState((old) => ({ ...old, snapshot: result.data, error: null }));
    } catch {
      if (valid()) setState((old) => ({ ...old, snapshot: null, error: 'load' }));
    } finally {
      if (pending.current === version) pending.current = null;
      if (valid()) setState((old) => ({ ...old, loading: false }));
    }
  }, []);

  useEffect(() => {
    setState(initialState(sessionId));
    if (!active || !sessionId) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [sessionId, active, refresh]);

  const mutate = useCallback(
    async (
      operation: 'save' | 'clear' | 'forget',
      text?: string,
      kind?: IdeMemoryRecordableKind,
      pinned?: boolean
    ): Promise<boolean> => {
      const current = scope.current;
      if (!current.active || !current.sessionId || mutating.current === current.version) return false;
      // Invalidate an older poll before applying a user-confirmed mutation.
      const version = ++scope.current.version;
      const id = current.sessionId;
      const valid = () => alive.current && scope.current.version === version;
      mutating.current = version;
      setState((old) => ({
        ...(old.sessionId === id ? old : initialState(id)),
        loading: false,
        busy: true,
        error: null,
      }));
      try {
        const result =
          operation === 'clear'
            ? await sessionMemoryClient.memoryClear(id)
            : operation === 'forget'
              ? await sessionMemoryClient.memoryForget(id, text ?? '')
              : await sessionMemoryClient.memoryRemember(id, text?.trim() ?? '', { kind, pinned });
        if (!valid()) return false;
        if (result.ok === false) {
          if (result.error !== 'CANCELLED') setState((old) => ({ ...old, error: operation }));
          return false;
        }
        if ((operation === 'clear' || operation === 'forget') && result.data === false) return false;
        await refresh(true);
        return valid();
      } catch {
        if (valid()) setState((old) => ({ ...old, error: operation }));
        return false;
      } finally {
        if (mutating.current === version) mutating.current = null;
        if (valid()) setState((old) => ({ ...old, busy: false }));
      }
    },
    [refresh]
  );

  const remember = useCallback(
    (text: string, kind: IdeMemoryRecordableKind, pinned: boolean): Promise<boolean> => {
      if (!text.trim() || text.length > 12000) return Promise.resolve(false);
      return mutate('save', text, kind, pinned);
    },
    [mutate]
  );
  const clear = useCallback(() => mutate('clear'), [mutate]);
  const forget = useCallback((itemId: string) => mutate('forget', itemId), [mutate]);

  return {
    ...(state.sessionId === sessionId && active ? state : initialState(sessionId)),
    refresh,
    remember,
    clear,
    forget,
  };
};
