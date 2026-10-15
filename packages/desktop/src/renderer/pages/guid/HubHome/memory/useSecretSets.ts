import { useCallback, useEffect, useRef, useState } from 'react';
import type { SecretRequestView, SecretSetInput, SecretSetView } from '@/common/types/platform/sessionSecrets';
import type { SecretSetsApi } from '@/renderer/services/secretSetsClient';

/** A revealed value disappears on its own; the person asked to see it, not to keep it on screen. */
export const REVEAL_VISIBLE_MS = 30_000;

export type SecretFailure = false | 'keychain' | 'failed';
export type SecretOutcome = { ok: true } | { ok: false; cancelled: boolean };

export const revealKey = (handle: string, field: string): string => `${handle}\u0000${field}`;

const failureFor = (code: string): SecretFailure => (code === 'KEYCHAIN_UNAVAILABLE' ? 'keychain' : 'failed');

/**
 * The secret sets of one scope. `api` must be stable for as long as the scope is the same; a different `api`
 * starts from nothing, drops late replies for the previous one and forgets every revealed value.
 */
export const useSecretSets = (api: SecretSetsApi | null, active: boolean) => {
  const [sets, setSets] = useState<SecretSetView[]>([]);
  const [requests, setRequests] = useState<SecretRequestView[]>([]);
  const [keychainAvailable, setKeychainAvailable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SecretFailure>(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<string | null>(null);
  const current = useRef(api);
  current.current = api;
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const hideAll = useCallback((): void => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setRevealed({});
    setRevealing(null);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!api) return;
    setLoading(true);
    setError(false);
    try {
      const result = await api.list();
      if (current.current !== api) return;
      if (result.ok === false) {
        setError('failed');
        return;
      }
      setSets(result.data.sets);
      setRequests(result.data.requests);
      setKeychainAvailable(result.data.keychainAvailable);
    } catch {
      if (current.current === api) setError('failed');
    } finally {
      if (current.current === api) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    hideAll();
    setSets([]);
    setRequests([]);
    setError(false);
    setBusy(false);
    return hideAll;
  }, [hideAll, api]);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  /** Runs one mutation, then reloads. A cancelled native approval is not an error. */
  const mutate = useCallback(
    async (
      run: (scope: SecretSetsApi) => Promise<{ ok: true } | { ok: false; error: string }>
    ): Promise<SecretOutcome> => {
      const scope = current.current;
      if (!scope) return { ok: false, cancelled: false };
      setBusy(true);
      setError(false);
      try {
        const result = await run(scope);
        if (current.current !== scope) return { ok: false, cancelled: false };
        if (result.ok === false) {
          if (result.error !== 'CANCELLED') setError(failureFor(result.error));
          return { ok: false, cancelled: result.error === 'CANCELLED' };
        }
        await refresh();
        return { ok: true };
      } catch {
        if (current.current === scope) setError('failed');
        return { ok: false, cancelled: false };
      } finally {
        if (current.current === scope) setBusy(false);
      }
    },
    [refresh]
  );

  const save = useCallback(
    (set: SecretSetInput) =>
      mutate(async (scope) => {
        const result = await scope.save(set);
        return result.ok ? { ok: true } : result;
      }),
    [mutate]
  );
  const remove = useCallback(
    (handle: string) =>
      mutate(async (scope) => {
        const result = await scope.remove(handle);
        return result.ok ? { ok: true } : result;
      }),
    [mutate]
  );
  const dismissRequest = useCallback(
    (requestId: string) =>
      mutate(async (scope) => {
        const result = await scope.dismissRequest(requestId);
        return result.ok ? { ok: true } : result;
      }),
    [mutate]
  );

  const forget = useCallback((key: string): void => {
    clearTimeout(timers.current.get(key));
    timers.current.delete(key);
    setRevealed((value) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)));
  }, []);

  /** Shows a value after native approval, or hides it again when it is already visible. */
  const toggleReveal = useCallback(
    async (handle: string, field: string): Promise<void> => {
      const scope = current.current;
      if (!scope) return;
      const key = revealKey(handle, field);
      if (timers.current.has(key)) {
        forget(key);
        return;
      }
      setRevealing(key);
      setError(false);
      try {
        const result = await scope.reveal(handle, field);
        if (current.current !== scope) return;
        if (result.ok === false) {
          if (result.error !== 'CANCELLED') setError('failed');
          return;
        }
        setRevealed((value) => ({ ...value, [key]: result.data }));
        timers.current.set(
          key,
          setTimeout(() => forget(key), REVEAL_VISIBLE_MS)
        );
      } catch {
        if (current.current === scope) setError('failed');
      } finally {
        if (current.current === scope) setRevealing(null);
      }
    },
    [forget]
  );

  return {
    sets,
    requests,
    keychainAvailable,
    loading,
    busy,
    error,
    revealed,
    revealing,
    refresh,
    save,
    remove,
    dismissRequest,
    toggleReveal,
  };
};
