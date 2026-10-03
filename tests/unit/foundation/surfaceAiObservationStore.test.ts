import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createSurfaceAiObservationStore,
  type SurfaceAiObservationIdentity,
} from '@/process/resources/packageProcessRuntime/surfaceAiObservationStore';

const roots: string[] = [];

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-surface-ai-observation-'));
  roots.push(root);
  return root;
};

const identity = (): SurfaceAiObservationIdentity => ({
  accountId: 'account-1',
  runId: 'run-1',
  invocationId: 'invocation-1',
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

describe('SurfaceAiObservationStore', () => {
  it('durably records redacted progress and opaque artifact evidence only', async () => {
    const root = await createRoot();
    let now = 1_000;
    const store = createSurfaceAiObservationStore({ rootPath: root, now: () => now++ });

    await store.open(identity());
    await store.recordProgress(identity(), { sequence: 1, phase: 'writing', completed: 1, total: 2 });
    const completed = await store.recordResult(identity(), {
      sequence: 2,
      artifactRefs: ['artifact:workspace-project'],
      evidenceRefs: ['evidence:workspace-write'],
    });

    expect(completed).toMatchObject({
      state: 'completed',
      lastSequence: 2,
      progress: [{ sequence: 1, phase: 'writing', completed: 1, total: 2 }],
      result: {
        sequence: 2,
        artifactRefs: ['artifact:workspace-project'],
        evidenceRefs: ['evidence:workspace-write'],
      },
    });
    expect(await readdir(root)).toEqual([`${completed.observationKey}.json`]);
    const persisted = await readFile(path.join(root, `${completed.observationKey}.json`), 'utf8');
    expect(persisted).not.toContain('Create the requested project files');
    expect(persisted).not.toContain('lease-opaque');
    expect(persisted).not.toContain('runtime-owner');
    expect(persisted).toContain('artifact:workspace-project');
  });

  it('fails closed on replayed sequences across a restarted store and after a terminal result', async () => {
    const root = await createRoot();
    const first = createSurfaceAiObservationStore({ rootPath: root, now: () => 1_000 });
    await first.open(identity());
    await first.recordProgress(identity(), { sequence: 1, phase: 'writing', completed: 1, total: 2 });

    const restarted = createSurfaceAiObservationStore({ rootPath: root, now: () => 2_000 });
    await expect(
      restarted.recordProgress(identity(), { sequence: 1, phase: 'writing', completed: 1, total: 2 })
    ).rejects.toMatchObject({ code: 'SURFACE_AI_OBSERVATION_REPLAY' });
    await restarted.recordResult(identity(), {
      sequence: 2,
      artifactRefs: ['artifact:workspace-project'],
      evidenceRefs: [],
    });
    await expect(
      restarted.recordProgress(identity(), { sequence: 3, phase: 'late', completed: 2, total: 2 })
    ).rejects.toMatchObject({ code: 'SURFACE_AI_OBSERVATION_TERMINAL' });
  });

  it('returns only restart-terminal observations owned by the requested account', async () => {
    const root = await createRoot();
    let now = 1_000;
    const store = createSurfaceAiObservationStore({ rootPath: root, now: () => now++ });
    const owned = identity();
    const otherAccount = { ...identity(), accountId: 'account-2', invocationId: 'invocation-2' } as const;
    const completed = { ...identity(), invocationId: 'invocation-3' } as const;
    const active = { ...identity(), invocationId: 'invocation-4' } as const;

    await store.open(owned);
    await store.open(otherAccount);
    await store.open(completed);
    await store.open(active);
    await store.cancelForRestart(owned);
    await store.cancelForRestart(otherAccount);
    await store.recordResult(completed, { sequence: 1, artifactRefs: ['artifact:complete'], evidenceRefs: [] });

    await expect(store.listRestartCancelledForAccount('account-1')).resolves.toMatchObject([
      { identity: { accountId: 'account-1', invocationId: 'invocation-1' }, state: 'cancelled' },
    ]);
    await expect(store.listRestartCancelledForAccount('account-2')).resolves.toMatchObject([
      { identity: { accountId: 'account-2', invocationId: 'invocation-2' }, state: 'cancelled' },
    ]);
    await expect(store.listRestartCancelledForAccount('')).rejects.toMatchObject({
      code: 'SURFACE_AI_OBSERVATION_INPUT_INVALID',
    });
  });

  it('rejects corrupted durable state instead of treating it as recoverable progress', async () => {
    const root = await createRoot();
    const initial = createSurfaceAiObservationStore({ rootPath: root, now: () => 1_000 });
    const opened = await initial.open(identity());
    const storedPath = path.join(root, `${opened.observationKey}.json`);
    await rm(storedPath);
    await writeFile(storedPath, '{"kind":"surface-ai-observation.v1","version":1,"lastSequence":99}', 'utf8');

    const restarted = createSurfaceAiObservationStore({ rootPath: root, now: () => 2_000 });
    await expect(restarted.read(identity())).rejects.toMatchObject({ code: 'SURFACE_AI_OBSERVATION_CORRUPT' });
  });
});
