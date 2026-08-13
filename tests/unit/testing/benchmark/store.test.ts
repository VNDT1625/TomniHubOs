/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BenchmarkRun, SaveBenchmarkSuiteRequest } from '@/common/types/benchmark';
import { BenchmarkStore } from '@/process/testing/benchmark/store';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

const makeStore = async (): Promise<{ directory: string; filePath: string; store: BenchmarkStore }> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tomny-benchmark-store-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'catalog.json');
  return { directory, filePath, store: new BenchmarkStore(filePath) };
};

const suiteDraft = (name: string): SaveBenchmarkSuiteRequest => ({
  name,
  prompts: [
    { id: 'p1', name: 'Investigate', text: 'Investigate the bug without editing.' },
    { id: 'p2', name: 'Fix', text: 'Fix and verify the bug.' },
  ],
  runnerConfigs: [{ runnerId: 'tomny', enabled: true, workspace: 'C:/repo-tomny', model: 'model-a' }],
  verificationCommand: 'bun test',
  verificationTimeoutMs: 60_000,
});

const queuedRun = (suiteId: string): BenchmarkRun => ({
  id: 'run-1',
  batchId: 'batch-1',
  comparisonKey: 'comparison',
  spec: {
    suiteId,
    suiteRevision: 1,
    suiteName: 'Suite',
    prompts: suiteDraft('Suite').prompts,
    runner: suiteDraft('Suite').runnerConfigs[0],
    verificationCommand: 'bun test',
    verificationTimeoutMs: 60_000,
  },
  status: 'running',
  createdAt: 1,
  startedAt: 2,
  turns: [],
  totals: {
    durationMs: 0,
    firstTokenMs: null,
    modelRequests: 0,
    toolCalls: 0,
    toolFailures: 0,
    quickTestCalls: 0,
    usage: {
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      totalTokens: null,
      source: 'unavailable',
    },
  },
  changedFiles: [],
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('BenchmarkStore', () => {
  it('serializes concurrent suite mutations without losing either suite', async () => {
    const { store } = await makeStore();

    await Promise.all([store.saveSuite(suiteDraft('First')), store.saveSuite(suiteDraft('Second'))]);

    expect((await store.listSuites()).map((suite) => suite.name).toSorted()).toEqual(['First', 'Second']);
  });

  it('increments the revision while preserving the original creation time', async () => {
    const { store } = await makeStore();
    const first = await store.saveSuite(suiteDraft('Original'));

    const updated = await store.saveSuite({ ...suiteDraft('Updated'), id: first.id });

    expect(updated.revision).toBe(2);
    expect(updated.createdAt).toBe(first.createdAt);
    expect((await store.listSuites())[0]?.name).toBe('Updated');
  });

  it('marks an in-flight run interrupted after a process restart', async () => {
    const { filePath, store } = await makeStore();
    const suite = await store.saveSuite(suiteDraft('Crash recovery'));
    await store.saveRun(queuedRun(suite.id));

    const reloaded = new BenchmarkStore(filePath);
    const [run] = await reloaded.listRuns();

    expect(run.status).toBe('interrupted');
    expect(run.error).toContain('exited before');
  });

  it('preserves invalid data as a recovery file and starts with an empty catalog', async () => {
    const { directory, filePath, store } = await makeStore();
    await store.listSuites();
    await writeFile(filePath, '{broken json', 'utf8');

    const recovered = new BenchmarkStore(filePath);

    expect(await recovered.listSuites()).toEqual([]);
    const files = await import('node:fs/promises').then(({ readdir }) => readdir(directory));
    expect(files.some((file) => file.startsWith('catalog.json.corrupt-'))).toBe(true);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({ version: 1, suites: [], runs: [] });
  });

  it('rejects a suite that cannot exercise context across two prompts', async () => {
    const { store } = await makeStore();

    await expect(
      store.saveSuite({ ...suiteDraft('Too short'), prompts: [{ id: 'p1', name: 'Only', text: 'One prompt' }] })
    ).rejects.toThrow('at least two');
  });
});
