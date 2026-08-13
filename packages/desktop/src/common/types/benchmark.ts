/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Stable IPC contract for the Settings > Testing > Benchmark surface. */
export const BENCHMARK_CHANNELS = {
  listSuites: 'benchmark.list-suites',
  saveSuite: 'benchmark.save-suite',
  removeSuite: 'benchmark.remove-suite',
  probeRunners: 'benchmark.probe-runners',
  listRuns: 'benchmark.list-runs',
  start: 'benchmark.start',
  rerun: 'benchmark.rerun',
  cancel: 'benchmark.cancel',
  progress: 'benchmark.progress',
} as const;

export const BENCHMARK_RUNNER_IDS = ['tomny', 'claude', 'codex'] as const;

export type BenchmarkRunnerId = (typeof BENCHMARK_RUNNER_IDS)[number];

export type BenchmarkRunStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'verifying'
  | 'completed'
  | 'passed'
  | 'failed'
  | 'error'
  | 'cancelled'
  | 'interrupted';

export type BenchmarkPrompt = {
  id: string;
  name: string;
  text: string;
};

export type BenchmarkRunnerConfig = {
  runnerId: BenchmarkRunnerId;
  enabled: boolean;
  /** Absolute path to an isolated copy/worktree for this runner. */
  workspace: string;
  /** Provider/model alias passed unchanged to the selected runner. */
  model?: string;
  /** Native CLI reasoning effort passed independently from the model alias. */
  reasoningEffort?: string;
};

export type BenchmarkSuite = {
  id: string;
  revision: number;
  name: string;
  prompts: BenchmarkPrompt[];
  runnerConfigs: BenchmarkRunnerConfig[];
  /** Optional acceptance command. A valid benchmark must fail before and pass after the agent. */
  verificationCommand?: string;
  verificationTimeoutMs: number;
  createdAt: number;
  updatedAt: number;
};

export type BenchmarkTokenUsageSource = 'reported' | 'estimated' | 'unavailable';

export type BenchmarkTokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  totalTokens: number | null;
  source: BenchmarkTokenUsageSource;
};

export type BenchmarkTurnMetrics = {
  promptId: string;
  promptName: string;
  startedAt: number;
  durationMs: number;
  firstTokenMs: number | null;
  /** Null when the runner does not expose a trustworthy model-request count. */
  modelRequests: number | null;
  toolCalls: number;
  toolFailures: number;
  quickTestCalls: number;
  usage: BenchmarkTokenUsage;
  response: string;
};

export type BenchmarkCommandResult = {
  command: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
};

export type BenchmarkRunSpec = {
  suiteId: string;
  suiteRevision: number;
  suiteName: string;
  prompts: BenchmarkPrompt[];
  runner: BenchmarkRunnerConfig;
  verificationCommand?: string;
  verificationTimeoutMs: number;
};

export type BenchmarkRun = {
  id: string;
  batchId: string;
  comparisonKey: string;
  supersedesRunId?: string;
  spec: BenchmarkRunSpec;
  sourceFingerprint?: string;
  status: BenchmarkRunStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  sessionId?: string;
  turns: BenchmarkTurnMetrics[];
  totals: {
    durationMs: number;
    firstTokenMs: number | null;
    modelRequests: number | null;
    toolCalls: number;
    toolFailures: number;
    quickTestCalls: number;
    usage: BenchmarkTokenUsage;
  };
  precheck?: BenchmarkCommandResult;
  verification?: BenchmarkCommandResult;
  diff?: string;
  changedFiles: string[];
  error?: string;
};

export type BenchmarkRunnerDescriptor = {
  id: BenchmarkRunnerId;
  name: string;
  kind: 'tomny-ide' | 'native-cli';
  available: boolean;
  detail?: string;
  version?: string;
  models: Array<{
    /** Stable UI choice id; may represent a model + reasoning-effort pair. */
    key: string;
    label: string;
    isDefault: boolean;
    /** Actual value passed to --model. Undefined means use the CLI default. */
    model?: string;
    reasoningEffort?: string;
  }>;
  defaultModel?: string;
};

export type SaveBenchmarkSuiteRequest = Omit<BenchmarkSuite, 'id' | 'revision' | 'createdAt' | 'updatedAt'> & {
  id?: string;
};

export type StartBenchmarkRequest = { suiteId: string; runnerIds: BenchmarkRunnerId[] };
export type StartBenchmarkResult = { batchId: string; runIds: string[] };
export type ListBenchmarkRunsRequest = { suiteId?: string; limit?: number };
export type RerunBenchmarkRequest = { runId: string };
export type CancelBenchmarkRequest = { runId: string };

export type BenchmarkProgressEvent = {
  run: BenchmarkRun;
  message?: string;
};
