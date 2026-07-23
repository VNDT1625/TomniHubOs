/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SaveBenchmarkSuiteRequest } from '@/common/types/benchmark';
import type { BenchmarkTomnyPort } from '@/process/testing/benchmark/service';
import { BenchmarkService } from '@/process/testing/benchmark/service';
import { BenchmarkStore } from '@/process/testing/benchmark/store';
import type { ExperimentalCoreEvent } from '@/process/experimentalCore/experimentalCoreRuntime';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const temporaryDirectories: string[] = [];

const createWorkspace = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tomny-benchmark-service-'));
  temporaryDirectories.push(directory);
  await mkdir(directory, { recursive: true });
  return directory;
};

const verificationCommand = (): string =>
  `"${process.execPath}" -e "process.exit(require('node:fs').existsSync('fixed.flag') ? 0 : 1)"`;

const suiteDraft = (workspace: string, secondPrompt = 'Fix the bug and verify it.'): SaveBenchmarkSuiteRequest => ({
  name: 'Context + fix benchmark',
  prompts: [
    { id: 'investigate', name: 'Investigate', text: 'Investigate the failure without editing.' },
    { id: 'fix', name: 'Fix', text: secondPrompt },
  ],
  runnerConfigs: [
    { runnerId: 'tomny', enabled: true, workspace, model: 'provider:model' },
    { runnerId: 'claude', enabled: false, workspace: '' },
    { runnerId: 'codex', enabled: false, workspace: '' },
  ],
  verificationCommand: verificationCommand(),
  verificationTimeoutMs: 10_000,
});

const makeTomnyPort = () => {
  const listeners = new Set<(event: ExperimentalCoreEvent) => void>();
  const starts: Parameters<BenchmarkTomnyPort['start']>[0][] = [];
  let sequence = 1;
  const emit = (input: Parameters<BenchmarkTomnyPort['start']>[0], event: Partial<ExperimentalCoreEvent>): void => {
    const complete: ExperimentalCoreEvent = {
      requestId: input.requestId,
      sessionId: input.sessionId ?? 'tomny-session',
      targetId: 'tomny',
      timestamp: Date.now(),
      sequence: sequence++,
      type: 'status',
      ...event,
    };
    for (const listener of listeners) listener(complete);
  };
  const port: BenchmarkTomnyPort = {
    listTargets: vi.fn().mockResolvedValue([
      {
        id: 'tomny',
        name: 'Tomny',
        kind: 'builtin',
        available: true,
        models: [{ key: 'provider:model', modelId: 'model', label: 'Model', isDefault: true }],
      },
    ]),
    listModels: vi.fn().mockResolvedValue([]),
    start: vi.fn((input) => {
      starts.push(input);
      const sessionId = input.sessionId ?? 'tomny-session';
      const finish = async (): Promise<void> => {
        emit({ ...input, sessionId }, { type: 'delta', text: `Answer ${starts.length}`, mode: 'replace' });
        emit(
          { ...input, sessionId },
          {
            type: 'tool-call',
            tool: starts.length === 2 ? 'ide_quick_test' : 'ide_research',
            callId: `call-${starts.length}`,
          }
        );
        if (input.prompt.includes('Fix the bug')) {
          await writeFile(path.join(input.workspace, 'fixed.flag'), 'fixed', 'utf8');
        }
        emit({ ...input, sessionId }, { type: 'completed' });
      };
      if (!input.prompt.includes('hang forever')) queueMicrotask(() => void finish());
      return { requestId: input.requestId, sessionId };
    }),
    cancel: vi.fn().mockResolvedValue(true),
    resolvePermission: vi.fn().mockResolvedValue(true),
    resolveOrchestrationProposal: vi.fn().mockResolvedValue(true),
    firstTokenMs: vi.fn().mockResolvedValue(12),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { port, starts };
};

const makeService = async (workspace: string, secondPrompt?: string) => {
  const store = new BenchmarkStore(path.join(workspace, '.tomni', 'benchmark-test', 'catalog.json'));
  const tomny = makeTomnyPort();
  const service = new BenchmarkService({ store, tomny: tomny.port });
  const suite = await service.saveSuite(suiteDraft(workspace, secondPrompt));
  return { service, store, suite, ...tomny };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }).catch(
        (error: NodeJS.ErrnoException) => {
          // Windows Defender/indexing can briefly retain a cwd handle after shell-based
          // acceptance checks. A leaked disposable temp folder must not mask service assertions.
          if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error;
        }
      )
    )
  );
});

describe('BenchmarkService', () => {
  it('keeps both prompts in one Tomny IDE session and accepts only a verified fix', async () => {
    const workspace = await createWorkspace();
    const { service, store, suite, starts } = await makeService(workspace);

    const started = await service.start({ suiteId: suite.id, runnerIds: ['tomny'] });
    await vi.waitFor(
      async () => {
        expect((await store.getRun(started.runIds[0]))?.status).toBe('passed');
      },
      { timeout: 15_000, interval: 50 }
    );
    const run = await store.getRun(started.runIds[0]);

    expect(starts).toHaveLength(2);
    expect(starts[0]).toMatchObject({ targetId: 'tomny', permissionMode: 'workspace-write' });
    expect(starts[0].contextIdentity).toMatchObject({ surface: 'ide', capabilityGrants: ['surface.ide'] });
    expect(starts[1].sessionId).toBe('tomny-session');
    expect(run?.precheck?.exitCode).not.toBe(0);
    expect(run?.verification?.exitCode).toBe(0);
    expect(run?.totals.quickTestCalls).toBe(1);
    expect(run?.totals.usage.source).toBe('unavailable');
  });

  it('creates a one-run rerun without replacing the previous result', async () => {
    const workspace = await createWorkspace();
    const { service, store, suite } = await makeService(workspace);
    const first = await service.start({ suiteId: suite.id, runnerIds: ['tomny'] });
    await vi.waitFor(async () => expect((await store.getRun(first.runIds[0]))?.status).toBe('passed'), {
      timeout: 15_000,
      interval: 50,
    });
    await rm(path.join(workspace, 'fixed.flag'));

    const rerun = await service.rerun({ runId: first.runIds[0] });
    await vi.waitFor(async () => expect((await store.getRun(rerun.runIds[0]))?.status).toBe('passed'), {
      timeout: 15_000,
      interval: 50,
    });
    const runs = await store.listRuns(suite.id);

    expect(rerun.runIds).toHaveLength(1);
    expect(rerun.runIds[0]).not.toBe(first.runIds[0]);
    expect(runs).toHaveLength(2);
    expect(runs.find((run) => run.id === rerun.runIds[0])?.supersedesRunId).toBe(first.runIds[0]);
  }, 30_000);

  it('cancels an active agent turn and records a terminal cancellation', async () => {
    const workspace = await createWorkspace();
    const { service, store, suite, port } = await makeService(workspace, 'hang forever');
    const started = await service.start({ suiteId: suite.id, runnerIds: ['tomny'] });
    await vi.waitFor(async () => expect((await store.getRun(started.runIds[0]))?.status).toBe('running'), {
      timeout: 15_000,
      interval: 50,
    });

    await expect(service.cancel(started.runIds[0])).resolves.toBe(true);
    await vi.waitFor(async () => expect((await store.getRun(started.runIds[0]))?.status).toBe('cancelled'), {
      timeout: 15_000,
      interval: 50,
    });

    expect(port.cancel).toHaveBeenCalledOnce();
  });

  it('rejects shared runner workspaces before either agent can edit them', async () => {
    const workspace = await createWorkspace();
    const { service, suite } = await makeService(workspace);
    await service.saveSuite({
      ...suiteDraft(workspace),
      id: suite.id,
      runnerConfigs: [
        { runnerId: 'tomny', enabled: true, workspace },
        { runnerId: 'claude', enabled: true, workspace },
      ],
    });

    await expect(service.start({ suiteId: suite.id, runnerIds: ['tomny', 'claude'] })).rejects.toThrow(
      'own workspace copy'
    );
  });

  it('locks a canonical workspace across overlapping benchmark batches', async () => {
    const workspace = await createWorkspace();
    const { service, store, suite } = await makeService(workspace, 'hang forever');
    const first = await service.start({ suiteId: suite.id, runnerIds: ['tomny'] });
    await vi.waitFor(async () => expect((await store.getRun(first.runIds[0]))?.status).toBe('running'), {
      timeout: 15_000,
      interval: 50,
    });

    await expect(service.start({ suiteId: suite.id, runnerIds: ['tomny'] })).rejects.toThrow('active benchmark run');
    await service.cancel(first.runIds[0]);
    await vi.waitFor(async () => expect((await store.getRun(first.runIds[0]))?.status).toBe('cancelled'), {
      timeout: 15_000,
      interval: 50,
    });
  });
});
