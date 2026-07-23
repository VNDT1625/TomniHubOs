/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BenchmarkRun, BenchmarkSuite } from '@/common/types/benchmark';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const translateMock = vi.hoisted(
  () => (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`)
);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translateMock,
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  }),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  };
});

const clientMocks = vi.hoisted(() => ({
  listSuites: vi.fn(),
  saveSuite: vi.fn(),
  removeSuite: vi.fn(),
  probeRunners: vi.fn(),
  listRuns: vi.fn(),
  start: vi.fn(),
  rerun: vi.fn(),
  cancel: vi.fn(),
  onProgress: vi.fn(() => () => undefined),
}));

vi.mock('@/renderer/pages/testing/Benchmark/benchmarkClient', () => ({ benchmarkClient: clientMocks }));

import Benchmark from '@/renderer/pages/testing/Benchmark';

const suite: BenchmarkSuite = {
  id: 'suite-1',
  revision: 1,
  name: 'Auth repair',
  prompts: [
    { id: 'prompt-1', name: 'Implement', text: 'Fix auth' },
    { id: 'prompt-2', name: 'Review', text: 'Review and test' },
  ],
  runnerConfigs: [
    { runnerId: 'tomny', enabled: true, model: 'model-a', workspace: 'C:/work/tomny' },
    { runnerId: 'claude', enabled: true, model: 'model-b', workspace: 'C:/work/claude' },
    { runnerId: 'codex', enabled: true, model: 'model-c', workspace: 'C:/work/codex' },
  ],
  verificationCommand: 'bun test',
  verificationTimeoutMs: 300_000,
  createdAt: 1,
  updatedAt: 2,
};

const run: BenchmarkRun = {
  id: 'run-1',
  batchId: 'batch-1',
  comparisonKey: 'comparison-1',
  spec: {
    suiteId: suite.id,
    suiteRevision: suite.revision,
    suiteName: suite.name,
    prompts: suite.prompts,
    runner: suite.runnerConfigs[0],
    verificationCommand: suite.verificationCommand,
    verificationTimeoutMs: suite.verificationTimeoutMs,
  },
  status: 'passed',
  createdAt: 10,
  startedAt: 11,
  finishedAt: 20,
  durationMs: 9,
  turns: [
    {
      promptId: 'prompt-1',
      promptName: 'Implement',
      startedAt: 11,
      durationMs: 4,
      firstTokenMs: null,
      modelRequests: 1,
      toolCalls: 2,
      toolFailures: 0,
      quickTestCalls: 1,
      usage: {
        inputTokens: null,
        outputTokens: 20,
        cachedInputTokens: null,
        totalTokens: null,
        source: 'reported',
      },
      response: 'Implemented the fix.',
    },
  ],
  totals: {
    durationMs: 9,
    firstTokenMs: null,
    modelRequests: 1,
    toolCalls: 2,
    toolFailures: 0,
    quickTestCalls: 1,
    usage: {
      inputTokens: null,
      outputTokens: 20,
      cachedInputTokens: null,
      totalTokens: null,
      source: 'reported',
    },
  },
  precheck: { command: 'bun test', exitCode: 1, durationMs: 2, timedOut: false, stdout: '', stderr: '' },
  verification: { command: 'bun test', exitCode: 0, durationMs: 2, timedOut: false, stdout: '', stderr: '' },
  changedFiles: ['src/auth.ts'],
};

beforeEach(() => {
  vi.clearAllMocks();
  clientMocks.listSuites.mockResolvedValue([suite]);
  clientMocks.listRuns.mockResolvedValue([run]);
  clientMocks.probeRunners.mockResolvedValue([]);
  clientMocks.saveSuite.mockResolvedValue(suite);
  clientMocks.start.mockResolvedValue({ batchId: 'batch-2', runIds: ['run-2'] });
  clientMocks.rerun.mockResolvedValue({ batchId: 'batch-3', runIds: ['run-3'] });
  clientMocks.cancel.mockResolvedValue(true);
  clientMocks.onProgress.mockReturnValue(() => undefined);
});

describe('Benchmark', () => {
  it('keeps two prompts fixed and preserves unknown token metrics as an em dash', async () => {
    const { container } = render(<Benchmark />);

    await screen.findByTestId('benchmark-run-run-1');
    expect(container.querySelectorAll('textarea')).toHaveLength(2);
    expect(screen.getByTestId('benchmark-prompt-1')).toBeTruthy();
    expect(screen.getByTestId('benchmark-prompt-2')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('reruns only the selected history row without starting the suite', async () => {
    render(<Benchmark />);

    fireEvent.click(await screen.findByTestId('benchmark-rerun-run-1'));
    await waitFor(() => expect(clientMocks.rerun).toHaveBeenCalledTimes(1));
    expect(clientMocks.rerun).toHaveBeenCalledWith('run-1');
    expect(clientMocks.start).not.toHaveBeenCalled();
  });

  it('shows the exact reasoning effort in persisted run evidence', async () => {
    clientMocks.listRuns.mockResolvedValueOnce([
      {
        ...run,
        spec: {
          ...run.spec,
          runner: { ...run.spec.runner, model: 'gpt-5.6-sol', reasoningEffort: 'high' },
        },
      },
    ]);
    render(<Benchmark />);

    await screen.findByTestId('benchmark-run-run-1');
    fireEvent.click(screen.getByText('testing.benchmark.runDetails.details'));
    expect(await screen.findByText('gpt-5.6-sol (high)')).toBeTruthy();
  });

  it('pins the discovered default model and effort when saving a suite', async () => {
    const suiteWithCliDefault = {
      ...suite,
      runnerConfigs: [
        suite.runnerConfigs[0],
        { ...suite.runnerConfigs[1], model: undefined, reasoningEffort: undefined },
        suite.runnerConfigs[2],
      ],
    };
    clientMocks.listSuites.mockResolvedValueOnce([suiteWithCliDefault]);
    clientMocks.probeRunners.mockResolvedValueOnce([
      {
        id: 'claude',
        name: 'Claude CLI',
        kind: 'native-cli',
        available: true,
        models: [
          {
            key: 'default::max',
            label: 'Default → cx/gpt-5.6-luna (max)',
            isDefault: true,
            model: 'cx/gpt-5.6-luna',
            reasoningEffort: 'max',
          },
        ],
      },
    ]);
    render(<Benchmark />);

    await waitFor(() => expect(clientMocks.probeRunners).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('benchmark-save'));
    await waitFor(() => expect(clientMocks.saveSuite).toHaveBeenCalledTimes(1));
    const request = clientMocks.saveSuite.mock.calls[0][0] as BenchmarkSuite;
    expect(request.runnerConfigs.find((config) => config.runnerId === 'claude')).toMatchObject({
      model: 'cx/gpt-5.6-luna',
      reasoningEffort: 'max',
    });
  });

  it('shows a localized failure state when persisted suites cannot load', async () => {
    clientMocks.listSuites.mockRejectedValueOnce(new Error('offline'));
    render(<Benchmark />);

    expect(await screen.findByText('testing.benchmark.errors.loadSuites')).toBeTruthy();
  });
});
