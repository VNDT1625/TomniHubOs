import { useCallback, useEffect, useRef, useState } from 'react';
import type { PackageContributionState } from '@/common/packages';
import { packageClient } from '@renderer/pages/hub/packageClient';

export type IdeExtensionsClient = Pick<
  typeof packageClient,
  'contributions' | 'contributionUpdateMode' | 'onContributionsChanged' | 'waitForContributions'
>;

export type UseIdeExtensions = {
  state: PackageContributionState | null;
  loading: boolean;
  failed: boolean;
  refresh: () => Promise<void>;
};

const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 4_000;

const waitForRetry = (delayMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener('abort', finish, { once: true });
  });

export const useIdeExtensions = (client: IdeExtensionsClient = packageClient): UseIdeExtensions => {
  const [state, setState] = useState<PackageContributionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const mountedRef = useRef(false);
  const requestRef = useRef(0);
  const revisionRef = useRef(0);

  const applyState = useCallback((next: PackageContributionState): void => {
    if (!mountedRef.current || next.snapshot.revision < revisionRef.current) return;
    revisionRef.current = next.snapshot.revision;
    setState(next);
    setFailed(false);
    setLoading(false);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const request = ++requestRef.current;
    try {
      const next = await client.contributions();
      if (!mountedRef.current || request !== requestRef.current) return;
      applyState(next);
    } catch (error) {
      console.error('[IDE Extensions] Failed to load contributions:', error);
      if (!mountedRef.current || request !== requestRef.current) return;
      setFailed(true);
      setLoading(false);
    }
  }, [applyState, client]);

  useEffect(() => {
    mountedRef.current = true;
    const abortController = new AbortController();
    const unsubscribe = client.onContributionsChanged(({ revision }) => {
      if (revision > revisionRef.current) void refresh();
    });

    const watchWebContributions = async (): Promise<void> => {
      let afterRevision = revisionRef.current;
      let errorCount = 0;
      while (mountedRef.current && !abortController.signal.aborted) {
        try {
          // oxlint-disable-next-line no-await-in-loop -- Long-poll waits must stay sequential to prevent overlap.
          const result = await client.waitForContributions(afterRevision, abortController.signal);
          if (!mountedRef.current || abortController.signal.aborted) return;
          errorCount = 0;
          applyState(result.state);
          afterRevision = Math.max(afterRevision, revisionRef.current, result.state.snapshot.revision);
        } catch (error) {
          if (!mountedRef.current || abortController.signal.aborted) return;
          console.error('[IDE Extensions] Contribution watcher failed:', error);
          const delayMs = Math.min(RETRY_BASE_MS * 2 ** errorCount, RETRY_MAX_MS);
          errorCount = Math.min(errorCount + 1, 30);
          // oxlint-disable-next-line no-await-in-loop -- Retry delay serializes the next transport attempt.
          await waitForRetry(delayMs, abortController.signal);
        }
      }
    };

    if (client.contributionUpdateMode() === 'long-poll') void watchWebContributions();
    void refresh();

    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      abortController.abort();
      unsubscribe();
    };
  }, [applyState, client, refresh]);

  return { state, loading, failed, refresh };
};
