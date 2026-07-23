/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BENCHMARK_CHANNELS,
  type BenchmarkProgressEvent,
  type BenchmarkRun,
  type BenchmarkRunnerDescriptor,
  type BenchmarkRunnerId,
  type BenchmarkSuite,
  type CancelBenchmarkRequest,
  type ListBenchmarkRunsRequest,
  type RerunBenchmarkRequest,
  type SaveBenchmarkSuiteRequest,
  type StartBenchmarkRequest,
  type StartBenchmarkResult,
} from '@/common/types/benchmark';
import { bridge } from '@office-ai/platform';

const CALL_TIMEOUT_MS = 10_000;

const channels = {
  listSuites: bridge.buildProvider<BenchmarkSuite[], void>(BENCHMARK_CHANNELS.listSuites),
  saveSuite: bridge.buildProvider<BenchmarkSuite, SaveBenchmarkSuiteRequest>(BENCHMARK_CHANNELS.saveSuite),
  removeSuite: bridge.buildProvider<boolean, { suiteId: string }>(BENCHMARK_CHANNELS.removeSuite),
  probeRunners: bridge.buildProvider<BenchmarkRunnerDescriptor[], void>(BENCHMARK_CHANNELS.probeRunners),
  listRuns: bridge.buildProvider<BenchmarkRun[], ListBenchmarkRunsRequest>(BENCHMARK_CHANNELS.listRuns),
  start: bridge.buildProvider<StartBenchmarkResult, StartBenchmarkRequest>(BENCHMARK_CHANNELS.start),
  rerun: bridge.buildProvider<StartBenchmarkResult, RerunBenchmarkRequest>(BENCHMARK_CHANNELS.rerun),
  cancel: bridge.buildProvider<boolean, CancelBenchmarkRequest>(BENCHMARK_CHANNELS.cancel),
  progress: bridge.buildEmitter<BenchmarkProgressEvent>(BENCHMARK_CHANNELS.progress),
};

const withTimeout = <T>(promise: Promise<T>, label: string, timeoutMs = CALL_TIMEOUT_MS): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`Benchmark bridge did not respond: ${label}`)), timeoutMs)
    ),
  ]);

/** Renderer-only IPC facade for persisted benchmark suites and runs. */
export const benchmarkClient = {
  listSuites: (): Promise<BenchmarkSuite[]> => withTimeout(channels.listSuites.invoke(), 'listSuites'),
  saveSuite: (request: SaveBenchmarkSuiteRequest): Promise<BenchmarkSuite> =>
    withTimeout(channels.saveSuite.invoke(request), 'saveSuite'),
  removeSuite: (suiteId: string): Promise<boolean> =>
    withTimeout(channels.removeSuite.invoke({ suiteId }), 'removeSuite'),
  probeRunners: (): Promise<BenchmarkRunnerDescriptor[]> =>
    withTimeout(channels.probeRunners.invoke(), 'probeRunners', 30_000),
  listRuns: (request: ListBenchmarkRunsRequest = {}): Promise<BenchmarkRun[]> =>
    withTimeout(channels.listRuns.invoke(request), 'listRuns'),
  start: (request: StartBenchmarkRequest): Promise<StartBenchmarkResult> =>
    withTimeout(channels.start.invoke(request), 'start', 30_000),
  rerun: (runId: string): Promise<StartBenchmarkResult> =>
    withTimeout(channels.rerun.invoke({ runId }), 'rerun', 30_000),
  cancel: (runId: string): Promise<boolean> => withTimeout(channels.cancel.invoke({ runId }), 'cancel'),
  onProgress: (listener: (event: BenchmarkProgressEvent) => void): (() => void) => channels.progress.on(listener),
};

export type { BenchmarkRunnerId };
