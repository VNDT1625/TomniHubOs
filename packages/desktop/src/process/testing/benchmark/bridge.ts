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
  type BenchmarkSuite,
  type CancelBenchmarkRequest,
  type ListBenchmarkRunsRequest,
  type RerunBenchmarkRequest,
  type SaveBenchmarkSuiteRequest,
  type StartBenchmarkRequest,
  type StartBenchmarkResult,
} from '@/common/types/benchmark';
import { bridge } from '@office-ai/platform';
import type { BenchmarkService } from './service';

export const benchmarkChannels = {
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

/** Register the non-blocking Benchmark IPC surface. */
export const registerBenchmarkBridge = (service: BenchmarkService): (() => void) => {
  benchmarkChannels.listSuites.provider(() => service.listSuites());
  benchmarkChannels.saveSuite.provider((draft) => service.saveSuite(draft));
  benchmarkChannels.removeSuite.provider(({ suiteId }) => service.removeSuite(suiteId));
  benchmarkChannels.probeRunners.provider(() => service.probeRunners());
  benchmarkChannels.listRuns.provider((query) => service.listRuns(query));
  benchmarkChannels.start.provider((request) => service.start(request));
  benchmarkChannels.rerun.provider((request) => service.rerun(request));
  benchmarkChannels.cancel.provider(({ runId }) => service.cancel(runId));
  return service.subscribe((event) => benchmarkChannels.progress.emit(event));
};
