/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BenchmarkRun, BenchmarkSuite, SaveBenchmarkSuiteRequest } from '@/common/types/benchmark';
import { BENCHMARK_RUNNER_IDS } from '@/common/types/benchmark';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const STORE_VERSION = 1;
const MAX_PERSISTED_RUNS = 100;
const ACTIVE_STATUSES = new Set<BenchmarkRun['status']>(['queued', 'preparing', 'running', 'verifying']);
const RUNNER_IDS = new Set<string>(BENCHMARK_RUNNER_IDS);

type BenchmarkSnapshot = {
  version: typeof STORE_VERSION;
  suites: BenchmarkSuite[];
  runs: BenchmarkRun[];
};

const emptySnapshot = (): BenchmarkSnapshot => ({ version: STORE_VERSION, suites: [], runs: [] });

const requiredText = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

const normalizeSuiteDraft = (draft: SaveBenchmarkSuiteRequest): SaveBenchmarkSuiteRequest => {
  const prompts = draft.prompts
    .map((prompt, index) => ({
      id: prompt.id.trim() || `prompt-${index + 1}`,
      name: prompt.name.trim() || `Prompt ${index + 1}`,
      text: prompt.text.trim(),
    }))
    .filter((prompt) => prompt.text.length > 0);
  if (prompts.length < 2) throw new Error('A benchmark suite requires at least two non-empty prompts.');
  if (new Set(prompts.map((prompt) => prompt.id)).size !== prompts.length) {
    throw new Error('Benchmark prompt IDs must be unique.');
  }

  const runnerConfigs = draft.runnerConfigs.map((runner) => ({
    ...runner,
    workspace: runner.workspace.trim(),
    model: runner.model?.trim() || undefined,
    reasoningEffort: runner.reasoningEffort?.trim() || undefined,
  }));
  if (new Set(runnerConfigs.map((runner) => runner.runnerId)).size !== runnerConfigs.length) {
    throw new Error('A benchmark suite cannot contain duplicate runners.');
  }
  if (runnerConfigs.some((runner) => !RUNNER_IDS.has(runner.runnerId))) {
    throw new Error('A benchmark suite contains an unsupported runner.');
  }
  if (!Number.isFinite(draft.verificationTimeoutMs)) {
    throw new Error('Verification timeout must be a finite number.');
  }

  return {
    ...draft,
    name: requiredText(draft.name, 'Suite name'),
    prompts,
    runnerConfigs,
    verificationCommand: draft.verificationCommand?.trim() || undefined,
    verificationTimeoutMs: Math.min(30 * 60_000, Math.max(1_000, Math.trunc(draft.verificationTimeoutMs))),
  };
};

/** Durable, atomic catalog for benchmark suites and immutable run history. */
export class BenchmarkStore {
  private snapshot = emptySnapshot();
  private readonly ready: Promise<void>;
  private mutation = Promise.resolve();

  public constructor(private readonly filePath: string) {
    this.ready = this.initialize();
  }

  private async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<BenchmarkSnapshot>;
      if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.suites) || !Array.isArray(parsed.runs)) {
        throw new Error('Unsupported benchmark store schema.');
      }
      this.snapshot = {
        version: STORE_VERSION,
        suites: parsed.suites,
        // oxlint-disable-next-line no-map-spread -- Recovery must not mutate objects deserialized from the snapshot.
        runs: parsed.runs.map((run) =>
          ACTIVE_STATUSES.has(run.status)
            ? {
                ...run,
                status: 'interrupted',
                finishedAt: Date.now(),
                error: run.error ?? 'The app exited before this benchmark run completed.',
              }
            : run
        ),
      };
      if (this.snapshot.runs.some((run) => run.status === 'interrupted' && run.finishedAt !== undefined)) {
        await this.persist();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const recoveryPath = `${this.filePath}.corrupt-${Date.now()}`;
        await rename(this.filePath, recoveryPath).catch((): void => undefined);
      }
      this.snapshot = emptySnapshot();
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation);
    this.mutation = result.then(
      (): void => undefined,
      (): void => undefined
    );
    return result;
  }

  public async listSuites(): Promise<BenchmarkSuite[]> {
    await this.ready;
    return structuredClone(this.snapshot.suites).toSorted((left, right) => right.updatedAt - left.updatedAt);
  }

  public async getSuite(id: string): Promise<BenchmarkSuite | undefined> {
    await this.ready;
    const suite = this.snapshot.suites.find((candidate) => candidate.id === id);
    return suite ? structuredClone(suite) : undefined;
  }

  public async saveSuite(draft: SaveBenchmarkSuiteRequest): Promise<BenchmarkSuite> {
    await this.ready;
    return this.enqueue(async () => {
      const normalized = normalizeSuiteDraft(draft);
      const now = Date.now();
      const existing = normalized.id
        ? this.snapshot.suites.find((candidate) => candidate.id === normalized.id)
        : undefined;
      const suite: BenchmarkSuite = {
        ...normalized,
        id: existing?.id ?? normalized.id?.trim() ?? crypto.randomUUID(),
        revision: (existing?.revision ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const index = this.snapshot.suites.findIndex((candidate) => candidate.id === suite.id);
      if (index >= 0) this.snapshot.suites[index] = suite;
      else this.snapshot.suites.push(suite);
      await this.persist();
      return structuredClone(suite);
    });
  }

  public async removeSuite(id: string): Promise<boolean> {
    await this.ready;
    return this.enqueue(async () => {
      const previousLength = this.snapshot.suites.length;
      this.snapshot.suites = this.snapshot.suites.filter((suite) => suite.id !== id);
      if (this.snapshot.suites.length === previousLength) return false;
      await this.persist();
      return true;
    });
  }

  public async listRuns(suiteId?: string, limit = 100): Promise<BenchmarkRun[]> {
    await this.ready;
    return structuredClone(this.snapshot.runs)
      .filter((run) => !suiteId || run.spec.suiteId === suiteId)
      .toSorted((left, right) => right.createdAt - left.createdAt)
      .slice(0, Math.min(500, Math.max(1, Math.trunc(limit))));
  }

  public async getRun(id: string): Promise<BenchmarkRun | undefined> {
    await this.ready;
    const run = this.snapshot.runs.find((candidate) => candidate.id === id);
    return run ? structuredClone(run) : undefined;
  }

  public async saveRun(run: BenchmarkRun): Promise<BenchmarkRun> {
    await this.ready;
    return this.enqueue(async () => {
      const copy = structuredClone(run);
      const index = this.snapshot.runs.findIndex((candidate) => candidate.id === copy.id);
      if (index >= 0) this.snapshot.runs[index] = copy;
      else this.snapshot.runs.push(copy);
      if (this.snapshot.runs.length > MAX_PERSISTED_RUNS) {
        this.snapshot.runs = this.snapshot.runs
          .toSorted((left, right) => right.createdAt - left.createdAt)
          .slice(0, MAX_PERSISTED_RUNS);
      }
      await this.persist();
      return structuredClone(copy);
    });
  }
}
