import type { SurfaceAiObservationSnapshot, SurfaceAiObservationStore } from './surfaceAiObservationStore';

export type SurfaceAiObservationRecoveryCoordinator = Readonly<{
  /**
   * Terminalizes only records found active in durable storage. It deliberately
   * has no runtime, package, renderer, or transport dependency, so recovery
   * cannot reconstruct or replay a prior invocation.
   */
  recoverAfterRestart: () => Promise<readonly SurfaceAiObservationSnapshot[]>;
  /**
   * Read-only, Main-only recovery evidence for one authenticated account. It
   * exposes only records terminalized by restart recovery and cannot replay an
   * invocation or inspect another account's observation.
   */
  listRestartCancelledForAccount: (accountId: string) => Promise<readonly SurfaceAiObservationSnapshot[]>;
}>;

export type SurfaceAiObservationRecoveryCoordinatorDeps = Readonly<
  Pick<SurfaceAiObservationStore, 'listActive' | 'cancelForRestart' | 'listRestartCancelledForAccount'>
>;

/** Main-only restart recovery for the C4 redacted observation journal. */
export const createSurfaceAiObservationRecoveryCoordinator = (
  observationStore: SurfaceAiObservationRecoveryCoordinatorDeps
): SurfaceAiObservationRecoveryCoordinator => {
  let recovery: Promise<readonly SurfaceAiObservationSnapshot[]> | undefined;

  const recoverAfterRestart = async (): Promise<readonly SurfaceAiObservationSnapshot[]> => {
    if (recovery !== undefined) return await recovery;
    recovery = (async () => {
      const active = await observationStore.listActive();
      const cancelled: SurfaceAiObservationSnapshot[] = [];
      for (const observation of active) {
        const terminal = await observationStore.cancelForRestart(observation.identity);
        if (terminal !== undefined) cancelled.push(terminal);
      }
      return Object.freeze(cancelled);
    })();
    return await recovery;
  };

  return Object.freeze({
    recoverAfterRestart,
    listRestartCancelledForAccount: async (accountId) =>
      await observationStore.listRestartCancelledForAccount(accountId),
  });
};
