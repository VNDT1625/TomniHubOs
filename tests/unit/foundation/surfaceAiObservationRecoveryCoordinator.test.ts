import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createSurfaceAiObservationRecoveryCoordinator } from '@/process/resources/packageProcessRuntime/surfaceAiObservationRecoveryCoordinator';
import {
  createSurfaceAiObservationStore,
  type SurfaceAiObservationIdentity,
} from '@/process/resources/packageProcessRuntime/surfaceAiObservationStore';

const roots: string[] = [];

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-surface-ai-recovery-'));
  roots.push(root);
  return root;
};

const identity = (invocationId: string): SurfaceAiObservationIdentity => ({
  accountId: 'account-1',
  runId: `run-${invocationId}`,
  invocationId,
  operationId: 'workspace.write-files',
  surface: {
    packageId: 'com.tomni.workspace',
    packageVersion: '1.0.0',
    publisherId: 'com.tomni',
  },
  artifactIntegrity: `sha256-${'a'.repeat(64)}`,
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })));
});

describe('SurfaceAiObservationRecoveryCoordinator', () => {
  it('terminalizes durable active observations once after restart without replaying an invocation', async () => {
    const root = await createRoot();
    const beforeRestart = createSurfaceAiObservationStore({ rootPath: root, now: () => 1_000 });
    const first = identity('invocation-1');
    const second = identity('invocation-2');
    await beforeRestart.open(first);
    await beforeRestart.recordProgress(first, { sequence: 1, phase: 'writing', completed: 1, total: 2 });
    await beforeRestart.open(second);

    const afterRestart = createSurfaceAiObservationStore({ rootPath: root, now: () => 2_000 });
    let terminalizationWrites = 0;
    const coordinator = createSurfaceAiObservationRecoveryCoordinator({
      listActive: afterRestart.listActive,
      listRestartCancelledForAccount: afterRestart.listRestartCancelledForAccount,
      cancelForRestart: async (observation) => {
        terminalizationWrites += 1;
        return await afterRestart.cancelForRestart(observation);
      },
    });

    const [firstRecovery, duplicateRecovery] = await Promise.all([
      coordinator.recoverAfterRestart(),
      coordinator.recoverAfterRestart(),
    ]);

    expect(terminalizationWrites).toBe(2);
    expect(firstRecovery).toEqual(duplicateRecovery);
    const recoveredByInvocation = Object.fromEntries(
      firstRecovery.map((observation) => [observation.identity.invocationId, observation])
    );
    expect(recoveredByInvocation['invocation-1']).toMatchObject({
      state: 'cancelled',
      lastSequence: 2,
      cancellation: { reason: 'restart-recovery', sequence: 2 },
    });
    expect(recoveredByInvocation['invocation-2']).toMatchObject({
      state: 'cancelled',
      lastSequence: 1,
      cancellation: { reason: 'restart-recovery', sequence: 1 },
    });
    expect(await afterRestart.listActive()).toEqual([]);
    await expect(coordinator.listRestartCancelledForAccount('account-1')).resolves.toEqual(firstRecovery);
    await expect(
      afterRestart.recordProgress(first, { sequence: 2, phase: 'late', completed: 2, total: 2 })
    ).rejects.toMatchObject({ code: 'SURFACE_AI_OBSERVATION_TERMINAL' });
  });
});
