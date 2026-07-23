/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type BenchmarkCommandResult,
  type BenchmarkRun,
  type BenchmarkRunnerConfig,
  type BenchmarkRunnerDescriptor,
  type BenchmarkRunnerId,
  type BenchmarkRunStatus,
  type BenchmarkSuite,
  type SaveBenchmarkSuiteRequest,
} from '@/common/types/benchmark';
import { Button, Collapse, Empty, Input, Message, Select, Spin, Switch, Tag, Tooltip } from '@arco-design/web-react';
import {
  AddOne,
  ChartLine,
  CheckOne,
  CloseOne,
  ExperimentOne,
  History,
  Info,
  PauseOne,
  Play,
  Refresh,
  ReplayMusic,
  Save,
  Terminal,
} from '@icon-park/react';
import WorkspaceFolderSelect from '@/renderer/components/workspace/WorkspaceFolderSelect';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { benchmarkClient } from './benchmarkClient';

const RUNNER_IDS: BenchmarkRunnerId[] = ['tomny', 'claude', 'codex'];
const ACTIVE_STATUSES = new Set<BenchmarkRunStatus>(['queued', 'preparing', 'running', 'verifying']);
const DEFAULT_VERIFICATION_TIMEOUT_MS = 300_000;
const HISTORY_LIMIT = 100;
const EM_DASH = '—';

const STATUS_CLASS: Record<BenchmarkRunStatus, string> = {
  queued: 'text-t-tertiary',
  preparing: 'text-primary',
  running: 'text-primary',
  verifying: 'text-warning',
  completed: 'text-success',
  passed: 'text-success',
  failed: 'text-danger',
  error: 'text-danger',
  cancelled: 'text-t-tertiary',
  interrupted: 'text-warning',
};

const createRunnerConfigs = (): BenchmarkRunnerConfig[] =>
  RUNNER_IDS.map((runnerId) => ({ runnerId, enabled: true, workspace: '' }));

const normalizeRunnerConfigs = (suite: BenchmarkSuite): BenchmarkRunnerConfig[] =>
  RUNNER_IDS.map((runnerId) => {
    const existing = suite.runnerConfigs.find((config) => config.runnerId === runnerId);
    return existing ? { ...existing } : { runnerId, enabled: false, workspace: '' };
  });

const upsertRun = (runs: BenchmarkRun[], run: BenchmarkRun): BenchmarkRun[] =>
  [run, ...runs.filter((candidate) => candidate.id !== run.id)].toSorted(
    (left, right) => right.createdAt - left.createdAt
  );

const formatCount = (value: number | null, locale: string): string =>
  value === null ? EM_DASH : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);

const formatDuration = (value: number | null | undefined, locale: string): string => {
  if (value === null || value === undefined) return EM_DASH;
  const unit = value < 1000 ? 'millisecond' : 'second';
  const amount = unit === 'millisecond' ? value : value / 1000;
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: unit === 'millisecond' ? 0 : 1,
  }).format(amount);
};

type MetricProps = {
  label: string;
  value: string;
};

const Metric: React.FC<MetricProps> = ({ label, value }) => (
  <div className='min-w-0 rd-8px bg-fill-1 px-10px py-8px'>
    <div className='truncate text-10px font-600 uppercase tracking-wide text-t-tertiary'>{label}</div>
    <div className='mt-3px truncate text-13px font-650 tabular-nums text-t-primary'>{value}</div>
  </div>
);

type CommandCheckTagProps = {
  label: string;
  result?: BenchmarkCommandResult;
  expectFailure: boolean;
  t: ReturnType<typeof useTranslation>['t'];
};

const CommandCheckTag: React.FC<CommandCheckTagProps> = ({ label, result, expectFailure, t }) => {
  let outcome = t('testing.benchmark.checks.notRun');
  let tone = 'text-t-tertiary';
  if (result?.timedOut) {
    outcome = t('testing.benchmark.checks.timedOut');
    tone = 'text-danger';
  } else if (result) {
    const commandPassed = result.exitCode === 0;
    if (expectFailure) {
      outcome = commandPassed
        ? t('testing.benchmark.checks.unexpectedPass')
        : t('testing.benchmark.checks.expectedFailure');
      tone = commandPassed ? 'text-danger' : 'text-success';
    } else {
      outcome = commandPassed ? t('testing.benchmark.checks.passed') : t('testing.benchmark.checks.failed');
      tone = commandPassed ? 'text-success' : 'text-danger';
    }
  }

  return (
    <Tag size='small' className={tone}>
      {label} · {outcome}
    </Tag>
  );
};

const CommandEvidence: React.FC<{
  label: string;
  result?: BenchmarkCommandResult;
  locale: string;
  t: ReturnType<typeof useTranslation>['t'];
}> = ({ label, result, locale, t }) => {
  if (!result) return null;
  return (
    <section className='rd-8px bg-fill-1 p-10px'>
      <div className='flex flex-wrap items-center justify-between gap-6px'>
        <span className='text-12px font-650 text-t-primary'>{label}</span>
        <span className='text-11px tabular-nums text-t-tertiary'>
          {t('testing.benchmark.runDetails.exitCode')}: {result.exitCode ?? EM_DASH} ·{' '}
          {formatDuration(result.durationMs, locale)}
        </span>
      </div>
      <pre className='mt-6px max-h-90px overflow-auto whitespace-pre-wrap rd-6px bg-fill-2 p-8px text-11px text-t-secondary'>
        {result.command}
      </pre>
      {result.stdout || result.stderr ? (
        <pre className='mt-6px max-h-160px overflow-auto whitespace-pre-wrap rd-6px bg-fill-2 p-8px text-11px text-t-secondary'>
          {[result.stdout, result.stderr].filter(Boolean).join('\n')}
        </pre>
      ) : null}
    </section>
  );
};

type RunCardProps = {
  run: BenchmarkRun;
  locale: string;
  rerunning: boolean;
  cancelling: boolean;
  onRerun: (runId: string) => void;
  onCancel: (runId: string) => void;
  runnerName: (runnerId: BenchmarkRunnerId) => string;
  t: ReturnType<typeof useTranslation>['t'];
};

const RunCard: React.FC<RunCardProps> = ({ run, locale, rerunning, cancelling, onRerun, onCancel, runnerName, t }) => {
  const active = ACTIVE_STATUSES.has(run.status);
  const duration = run.durationMs ?? (active ? null : run.totals.durationMs);
  const usage = run.totals.usage;

  return (
    <article className='rd-12px border border-border-base bg-fill-0 p-14px' data-testid={`benchmark-run-${run.id}`}>
      <div className='flex flex-wrap items-start justify-between gap-10px'>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-8px'>
            <span className='text-14px font-650 text-t-primary'>{runnerName(run.spec.runner.runnerId)}</span>
            <Tag size='small' className={STATUS_CLASS[run.status]}>
              {t(`testing.benchmark.status.${run.status}`)}
            </Tag>
            {run.supersedesRunId ? <Tag size='small'>{t('testing.benchmark.history.rerunBadge')}</Tag> : null}
          </div>
          <div className='mt-3px text-11px text-t-tertiary'>
            {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(run.createdAt)}
          </div>
        </div>

        <div className='flex items-center gap-8px'>
          {active ? (
            <Button
              size='small'
              status='danger'
              loading={cancelling}
              icon={<PauseOne theme='outline' size='14' />}
              onClick={() => onCancel(run.id)}
              data-testid={`benchmark-cancel-${run.id}`}
            >
              {t('testing.benchmark.actions.cancelRun')}
            </Button>
          ) : (
            <Button
              size='small'
              loading={rerunning}
              icon={<ReplayMusic theme='outline' size='14' />}
              onClick={() => onRerun(run.id)}
              data-testid={`benchmark-rerun-${run.id}`}
            >
              {t('testing.benchmark.actions.rerun')}
            </Button>
          )}
        </div>
      </div>

      <div className='mt-12px grid grid-cols-2 gap-6px md:grid-cols-4'>
        <Metric label={t('testing.benchmark.metrics.duration')} value={formatDuration(duration, locale)} />
        <Metric label={t('testing.benchmark.metrics.ttft')} value={formatDuration(run.totals.firstTokenMs, locale)} />
        <Metric
          label={t('testing.benchmark.runMetrics.modelRequests')}
          value={formatCount(run.totals.modelRequests, locale)}
        />
        <Metric label={t('testing.benchmark.runMetrics.toolCalls')} value={formatCount(run.totals.toolCalls, locale)} />
        <Metric
          label={t('testing.benchmark.runMetrics.toolFailures')}
          value={formatCount(run.totals.toolFailures, locale)}
        />
        <Metric
          label={t('testing.benchmark.runMetrics.quickTestCalls')}
          value={formatCount(run.totals.quickTestCalls, locale)}
        />
        <Metric label={t('testing.benchmark.metrics.inputTokens')} value={formatCount(usage.inputTokens, locale)} />
        <Metric label={t('testing.benchmark.metrics.outputTokens')} value={formatCount(usage.outputTokens, locale)} />
        <Metric
          label={t('testing.benchmark.metrics.cachedTokens')}
          value={formatCount(usage.cachedInputTokens, locale)}
        />
        <Metric label={t('testing.benchmark.metrics.totalTokens')} value={formatCount(usage.totalTokens, locale)} />
      </div>

      <div className='mt-8px flex flex-wrap items-center gap-6px'>
        <CommandCheckTag label={t('testing.benchmark.checks.precheck')} result={run.precheck} expectFailure t={t} />
        <CommandCheckTag
          label={t('testing.benchmark.checks.postVerification')}
          result={run.verification}
          expectFailure={false}
          t={t}
        />
      </div>

      <div className='mt-8px flex flex-wrap items-center justify-between gap-8px text-11px text-t-tertiary'>
        <span>
          {t('testing.benchmark.metrics.provenance')} · {t(`testing.benchmark.provenance.${usage.source}`)}
        </span>
        {run.changedFiles.length > 0 ? (
          <span>{t('testing.benchmark.history.changedFiles', { count: run.changedFiles.length })}</span>
        ) : null}
      </div>

      <Collapse bordered={false} lazyload className='mt-10px'>
        <Collapse.Item name={`details-${run.id}`} header={t('testing.benchmark.runDetails.details')}>
          <div className='flex flex-col gap-10px'>
            <section className='grid grid-cols-1 gap-6px rd-8px bg-fill-1 p-10px text-11px text-t-secondary md:grid-cols-2'>
              <span>
                <strong>{t('testing.benchmark.runDetails.batchId')}:</strong> {run.batchId}
              </span>
              <span>
                <strong>{t('testing.benchmark.runDetails.comparisonKey')}:</strong> {run.comparisonKey}
              </span>
              <span>
                <strong>{t('testing.benchmark.runDetails.suiteRevision')}:</strong> {run.spec.suiteRevision}
              </span>
              <span>
                <strong>{t('testing.benchmark.runners.modelLabel')}:</strong>{' '}
                {run.spec.runner.model || t('testing.benchmark.runners.modelPlaceholder')}
                {run.spec.runner.reasoningEffort ? ` (${run.spec.runner.reasoningEffort})` : ''}
              </span>
              <span className='break-all'>
                <strong>{t('testing.benchmark.runners.workspaceLabel')}:</strong> {run.spec.runner.workspace}
              </span>
              <span className='break-all'>
                <strong>{t('testing.benchmark.runDetails.sourceFingerprint')}:</strong>{' '}
                {run.sourceFingerprint || EM_DASH}
              </span>
              <span className='break-all md:col-span-2'>
                <strong>{t('testing.benchmark.runDetails.sessionId')}:</strong> {run.sessionId || EM_DASH}
              </span>
            </section>

            {run.turns.length === 0 ? (
              <span className='text-12px text-t-tertiary'>{t('testing.benchmark.runDetails.turnsEmpty')}</span>
            ) : (
              run.turns.map((turn, index) => (
                <section key={`${turn.promptId}-${index}`} className='rd-8px bg-fill-1 p-10px'>
                  <div className='text-12px font-650 text-t-primary'>
                    {index + 1}. {turn.promptName}
                  </div>
                  <div className='mt-6px text-10px font-600 uppercase tracking-wide text-t-tertiary'>
                    {t('testing.benchmark.runDetails.response')}
                  </div>
                  <div className='mt-4px max-h-180px overflow-auto whitespace-pre-wrap text-12px leading-18px text-t-secondary'>
                    {turn.response || EM_DASH}
                  </div>
                </section>
              ))
            )}

            <CommandEvidence
              label={t('testing.benchmark.checks.precheck')}
              result={run.precheck}
              locale={locale}
              t={t}
            />
            <CommandEvidence
              label={t('testing.benchmark.checks.postVerification')}
              result={run.verification}
              locale={locale}
              t={t}
            />

            {run.changedFiles.length > 0 ? (
              <section>
                <div className='mb-6px text-11px font-600 text-t-secondary'>
                  {t('testing.benchmark.runDetails.changedFilesTitle')}
                </div>
                <div className='flex flex-wrap gap-5px'>
                  {run.changedFiles.map((file) => (
                    <Tag key={file} size='small'>
                      {file}
                    </Tag>
                  ))}
                </div>
              </section>
            ) : null}

            {run.diff ? (
              <section>
                <div className='mb-6px text-11px font-600 text-t-secondary'>
                  {t('testing.benchmark.runDetails.diffTitle')}
                </div>
                <pre className='max-h-300px overflow-auto whitespace-pre rd-8px bg-fill-1 p-10px text-11px text-t-secondary'>
                  {run.diff}
                </pre>
              </section>
            ) : null}

            {run.error ? (
              <section>
                <div className='mb-5px text-11px font-600 text-danger'>
                  {t('testing.benchmark.runDetails.errorTitle')}
                </div>
                <div className='rd-8px bg-danger-light-1 px-10px py-8px text-12px text-danger'>{run.error}</div>
              </section>
            ) : null}
          </div>
        </Collapse.Item>
      </Collapse>
    </article>
  );
};

const Benchmark: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en-US';
  const runLoadToken = useRef(0);

  const [suites, setSuites] = useState<BenchmarkSuite[]>([]);
  const [selectedSuiteId, setSelectedSuiteId] = useState('');
  const [suiteName, setSuiteName] = useState('');
  const [promptIds, setPromptIds] = useState<[string, string]>(['prompt-1', 'prompt-2']);
  const [promptOne, setPromptOne] = useState('');
  const [promptTwo, setPromptTwo] = useState('');
  const [verificationCommand, setVerificationCommand] = useState('');
  const [verificationTimeoutMs, setVerificationTimeoutMs] = useState(DEFAULT_VERIFICATION_TIMEOUT_MS);
  const [runnerConfigs, setRunnerConfigs] = useState<BenchmarkRunnerConfig[]>(createRunnerConfigs);
  const [runnerDescriptors, setRunnerDescriptors] = useState<BenchmarkRunnerDescriptor[]>([]);
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [runsLoading, setRunsLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [rerunningId, setRerunningId] = useState('');
  const [cancellingId, setCancellingId] = useState('');
  const [loadError, setLoadError] = useState('');

  const descriptorById = useMemo(
    () => new Map(runnerDescriptors.map((descriptor) => [descriptor.id, descriptor])),
    [runnerDescriptors]
  );

  const suiteOptions = useMemo(() => suites.map((suite) => ({ value: suite.id, label: suite.name })), [suites]);

  const runnerName = useCallback(
    (runnerId: BenchmarkRunnerId): string => t(`testing.benchmark.runner.${runnerId}`),
    [t]
  );

  const applySuite = useCallback((suite: BenchmarkSuite): void => {
    setSelectedSuiteId(suite.id);
    setSuiteName(suite.name);
    setPromptIds([suite.prompts[0]?.id ?? 'prompt-1', suite.prompts[1]?.id ?? 'prompt-2']);
    setPromptOne(suite.prompts[0]?.text ?? '');
    setPromptTwo(suite.prompts[1]?.text ?? '');
    setVerificationCommand(suite.verificationCommand ?? '');
    setVerificationTimeoutMs(suite.verificationTimeoutMs || DEFAULT_VERIFICATION_TIMEOUT_MS);
    setRunnerConfigs(normalizeRunnerConfigs(suite));
  }, []);

  const loadRuns = useCallback(
    async (suiteId: string): Promise<void> => {
      const token = ++runLoadToken.current;
      if (!suiteId) {
        setRuns([]);
        return;
      }
      setRunsLoading(true);
      try {
        const next = await benchmarkClient.listRuns({ suiteId, limit: HISTORY_LIMIT });
        if (runLoadToken.current === token) setRuns(next);
      } catch (error) {
        console.error('[Benchmark] Failed to load run history:', error);
        if (runLoadToken.current === token) setLoadError(t('testing.benchmark.errors.loadRuns'));
      } finally {
        if (runLoadToken.current === token) setRunsLoading(false);
      }
    },
    [t]
  );

  const probeRunners = useCallback(
    async (notify: boolean): Promise<void> => {
      setProbing(true);
      try {
        const descriptors = await benchmarkClient.probeRunners();
        setRunnerDescriptors(descriptors);
        const unavailable = new Set(
          descriptors.filter((descriptor) => !descriptor.available).map((descriptor) => descriptor.id)
        );
        const descriptorMap = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
        setRunnerConfigs((previous) =>
          previous.map((config) => {
            if (unavailable.has(config.runnerId)) return { ...config, enabled: false };
            if (config.model || config.reasoningEffort) return config;
            const defaultChoice = descriptorMap.get(config.runnerId)?.models.find((choice) => choice.isDefault);
            return defaultChoice
              ? {
                  ...config,
                  model: defaultChoice.model,
                  reasoningEffort: defaultChoice.reasoningEffort,
                }
              : config;
          })
        );
        if (notify) Message.success(t('testing.benchmark.messages.probeComplete'));
      } catch (error) {
        console.error('[Benchmark] Failed to probe runners:', error);
        if (notify) Message.error(t('testing.benchmark.errors.probe'));
      } finally {
        setProbing(false);
      }
    },
    [t]
  );

  useEffect(() => {
    let disposed = false;
    setInitialLoading(true);
    setLoadError('');
    void benchmarkClient
      .listSuites()
      .then((next) => {
        if (disposed) return;
        setSuites(next);
        const first = next[0];
        if (first) {
          applySuite(first);
          void loadRuns(first.id);
        }
      })
      .catch((error: unknown) => {
        console.error('[Benchmark] Failed to load suites:', error);
        if (!disposed) setLoadError(t('testing.benchmark.errors.loadSuites'));
      })
      .finally(() => {
        if (!disposed) setInitialLoading(false);
      });
    void probeRunners(false);
    return () => {
      disposed = true;
    };
  }, [applySuite, loadRuns, probeRunners, t]);

  useEffect(
    () =>
      benchmarkClient.onProgress(({ run }) => {
        if (run.spec.suiteId !== selectedSuiteId) return;
        setRuns((previous) => upsertRun(previous, run));
      }),
    [selectedSuiteId]
  );

  const patchRunner = (runnerId: BenchmarkRunnerId, patch: Partial<BenchmarkRunnerConfig>): void => {
    setRunnerConfigs((previous) =>
      previous.map((config) => (config.runnerId === runnerId ? { ...config, ...patch, runnerId } : config))
    );
  };

  const resetDraft = (): void => {
    runLoadToken.current += 1;
    setSelectedSuiteId('');
    setSuiteName('');
    setPromptIds(['prompt-1', 'prompt-2']);
    setPromptOne('');
    setPromptTwo('');
    setVerificationCommand('');
    setVerificationTimeoutMs(DEFAULT_VERIFICATION_TIMEOUT_MS);
    setRunnerConfigs(createRunnerConfigs());
    setRuns([]);
    setLoadError('');
  };

  const selectSuite = (suiteId: string): void => {
    const suite = suites.find((candidate) => candidate.id === suiteId);
    if (!suite) return;
    setLoadError('');
    applySuite(suite);
    void loadRuns(suite.id);
  };

  const validateDraft = (requireRunner: boolean): BenchmarkRunnerId[] | null => {
    if (!suiteName.trim() || !promptOne.trim() || !promptTwo.trim()) {
      Message.warning(t('testing.benchmark.errors.requiredFields'));
      return null;
    }
    const runnerIds = runnerConfigs.filter((config) => config.enabled).map((config) => config.runnerId);
    if (requireRunner && runnerIds.length === 0) {
      Message.warning(t('testing.benchmark.errors.selectRunner'));
      return null;
    }
    const unavailableRunner = runnerIds.find((runnerId) => descriptorById.get(runnerId)?.available === false);
    if (requireRunner && unavailableRunner) {
      Message.warning(t('testing.benchmark.errors.runnerUnavailable', { runner: runnerName(unavailableRunner) }));
      return null;
    }
    const missingWorkspace = runnerConfigs.some((config) => config.enabled && !config.workspace.trim());
    if (missingWorkspace) {
      Message.warning(t('testing.benchmark.errors.workspaceRequired'));
      return null;
    }
    return runnerIds;
  };

  const buildSaveRequest = (): SaveBenchmarkSuiteRequest => ({
    id: selectedSuiteId || undefined,
    name: suiteName.trim(),
    prompts: [
      {
        id: promptIds[0],
        name: t('testing.benchmark.prompts.firstName'),
        text: promptOne.trim(),
      },
      {
        id: promptIds[1],
        name: t('testing.benchmark.prompts.secondName'),
        text: promptTwo.trim(),
      },
    ],
    runnerConfigs: runnerConfigs.map((config) => {
      const defaultChoice = descriptorById.get(config.runnerId)?.models.find((choice) => choice.isDefault);
      return {
        ...config,
        workspace: config.workspace.trim(),
        model: config.model?.trim() || defaultChoice?.model,
        reasoningEffort: config.reasoningEffort?.trim() || defaultChoice?.reasoningEffort,
      };
    }),
    verificationCommand: verificationCommand.trim() || undefined,
    verificationTimeoutMs,
  });

  const persistDraft = async (requireRunner: boolean): Promise<BenchmarkSuite | null> => {
    if (validateDraft(requireRunner) === null) return null;
    try {
      const saved = await benchmarkClient.saveSuite(buildSaveRequest());
      setSuites((previous) => [saved, ...previous.filter((suite) => suite.id !== saved.id)]);
      applySuite(saved);
      return saved;
    } catch (error) {
      console.error('[Benchmark] Failed to save suite:', error);
      Message.error(t('testing.benchmark.errors.save'));
      return null;
    }
  };

  const saveSuite = async (): Promise<void> => {
    setSaving(true);
    const saved = await persistDraft(false);
    setSaving(false);
    if (saved) Message.success(t('testing.benchmark.messages.saved'));
  };

  const startSelected = async (): Promise<void> => {
    const runnerIds = validateDraft(true);
    if (!runnerIds) return;
    setStarting(true);
    try {
      const saved = await persistDraft(true);
      if (!saved) return;
      await benchmarkClient.start({ suiteId: saved.id, runnerIds });
      Message.success(t('testing.benchmark.messages.started', { count: runnerIds.length }));
      await loadRuns(saved.id);
    } catch (error) {
      console.error('[Benchmark] Failed to start runs:', error);
      Message.error(t('testing.benchmark.errors.start'));
    } finally {
      setStarting(false);
    }
  };

  const rerunOne = async (runId: string): Promise<void> => {
    setRerunningId(runId);
    try {
      await benchmarkClient.rerun(runId);
      Message.success(t('testing.benchmark.messages.rerunStarted'));
      if (selectedSuiteId) await loadRuns(selectedSuiteId);
    } catch (error) {
      console.error('[Benchmark] Failed to rerun:', error);
      Message.error(`${t('testing.benchmark.errors.rerun')} ${error instanceof Error ? error.message : ''}`.trim());
    } finally {
      setRerunningId('');
    }
  };

  const cancelOne = async (runId: string): Promise<void> => {
    setCancellingId(runId);
    try {
      const cancelled = await benchmarkClient.cancel(runId);
      if (!cancelled) throw new Error(t('testing.benchmark.errors.cancelNotActive'));
      Message.success(t('testing.benchmark.messages.cancelled'));
      if (selectedSuiteId) await loadRuns(selectedSuiteId);
    } catch (error) {
      console.error('[Benchmark] Failed to cancel run:', error);
      Message.error(t('testing.benchmark.errors.cancel'));
    } finally {
      setCancellingId('');
    }
  };

  return (
    <div className='h-full min-h-0 overflow-auto pr-4px'>
      <Spin loading={initialLoading} className='w-full'>
        <div className='flex flex-col gap-14px pb-20px'>
          <header className='rd-14px border border-border-base bg-fill-1 p-18px'>
            <div className='flex flex-wrap items-start justify-between gap-14px'>
              <div className='flex min-w-0 items-start gap-12px'>
                <span className='size-40px shrink-0 flex-center rd-10px bg-primary-light-1 text-primary'>
                  <ExperimentOne theme='outline' size='21' />
                </span>
                <div className='min-w-0'>
                  <div className='flex flex-wrap items-center gap-8px'>
                    <h2 className='m-0 text-20px font-700 text-t-primary'>{t('testing.benchmark.title')}</h2>
                    <Tag size='small' className='text-primary'>
                      {t('testing.benchmark.liveContract')}
                    </Tag>
                  </div>
                  <p className='m-0 mt-4px max-w-720px text-13px leading-20px text-t-secondary'>
                    {t('testing.benchmark.subtitle')}
                  </p>
                </div>
              </div>

              <div className='flex flex-wrap items-center gap-8px'>
                <Button icon={<AddOne theme='outline' size='14' />} onClick={resetDraft}>
                  {t('testing.benchmark.actions.newSuite')}
                </Button>
                <Button
                  loading={probing}
                  icon={<Refresh theme='outline' size='14' />}
                  onClick={() => void probeRunners(true)}
                >
                  {t('testing.benchmark.actions.probe')}
                </Button>
              </div>
            </div>
          </header>

          {loadError ? (
            <div
              className='flex items-center justify-between gap-12px rd-10px border border-border-base bg-warning-light-1 px-14px py-10px text-12px text-warning'
              role='status'
            >
              <span>{loadError}</span>
              <Button size='mini' icon={<Refresh theme='outline' size='12' />} onClick={() => window.location.reload()}>
                {t('testing.benchmark.actions.retry')}
              </Button>
            </div>
          ) : null}

          <section className='rd-12px border border-border-base bg-fill-0 p-16px'>
            <div className='mb-14px flex flex-wrap items-center justify-between gap-12px'>
              <div>
                <h3 className='m-0 text-15px font-650 text-t-primary'>{t('testing.benchmark.suite.title')}</h3>
                <p className='m-0 mt-3px text-12px text-t-tertiary'>{t('testing.benchmark.suite.hint')}</p>
              </div>
              <Select
                className='w-260px'
                value={selectedSuiteId || undefined}
                options={suiteOptions}
                placeholder={t('testing.benchmark.suite.selectPlaceholder')}
                onChange={(value) => {
                  if (typeof value === 'string') selectSuite(value);
                }}
                aria-label={t('testing.benchmark.suite.selectLabel')}
              />
            </div>

            <div className='grid grid-cols-1 gap-12px lg:grid-cols-2'>
              <label className='flex min-w-0 flex-col gap-6px lg:col-span-2'>
                <span className='text-12px font-600 text-t-secondary'>{t('testing.benchmark.suite.nameLabel')}</span>
                <Input
                  value={suiteName}
                  onChange={setSuiteName}
                  placeholder={t('testing.benchmark.suite.namePlaceholder')}
                  aria-label={t('testing.benchmark.suite.nameLabel')}
                />
              </label>

              <label className='flex min-w-0 flex-col gap-6px'>
                <span className='text-12px font-600 text-t-secondary'>{t('testing.benchmark.prompts.firstLabel')}</span>
                <Input.TextArea
                  value={promptOne}
                  onChange={setPromptOne}
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  placeholder={t('testing.benchmark.prompts.firstPlaceholder')}
                  aria-label={t('testing.benchmark.prompts.firstLabel')}
                  data-testid='benchmark-prompt-1'
                />
              </label>

              <label className='flex min-w-0 flex-col gap-6px'>
                <span className='text-12px font-600 text-t-secondary'>
                  {t('testing.benchmark.prompts.secondLabel')}
                </span>
                <Input.TextArea
                  value={promptTwo}
                  onChange={setPromptTwo}
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  placeholder={t('testing.benchmark.prompts.secondPlaceholder')}
                  aria-label={t('testing.benchmark.prompts.secondLabel')}
                  data-testid='benchmark-prompt-2'
                />
              </label>

              <label className='flex min-w-0 flex-col gap-6px lg:col-span-2'>
                <span className='flex items-center gap-6px text-12px font-600 text-t-secondary'>
                  <Terminal theme='outline' size='13' />
                  {t('testing.benchmark.verification.label')}
                </span>
                <Input
                  value={verificationCommand}
                  onChange={setVerificationCommand}
                  placeholder={t('testing.benchmark.verification.placeholder')}
                  aria-label={t('testing.benchmark.verification.label')}
                />
                <span className='text-11px leading-17px text-t-tertiary'>
                  {t('testing.benchmark.verification.hint')}
                </span>
              </label>
            </div>
          </section>

          <section className='rd-12px border border-border-base bg-fill-0 p-16px'>
            <div className='mb-12px flex items-center justify-between gap-12px'>
              <div>
                <h3 className='m-0 text-15px font-650 text-t-primary'>{t('testing.benchmark.runners.title')}</h3>
                <p className='m-0 mt-3px text-12px text-t-tertiary'>{t('testing.benchmark.runners.hint')}</p>
              </div>
              <span className='text-11px text-t-tertiary'>
                {t('testing.benchmark.runners.selectedCount', {
                  count: runnerConfigs.filter((config) => config.enabled).length,
                })}
              </span>
            </div>

            <div className='grid grid-cols-1 gap-10px xl:grid-cols-3'>
              {RUNNER_IDS.map((runnerId) => {
                const config = runnerConfigs.find((candidate) => candidate.runnerId === runnerId);
                if (!config) return null;
                const descriptor = descriptorById.get(runnerId);
                const selectedModelChoice = descriptor?.models.find(
                  (choice) => choice.model === config.model && choice.reasoningEffort === config.reasoningEffort
                );
                const modelOptions =
                  descriptor?.models.map((model) => ({ value: model.key, label: model.label })) ?? [];
                const legacyModelValue =
                  config.model || config.reasoningEffort
                    ? `legacy::${config.model ?? 'default'}::${config.reasoningEffort ?? ''}`
                    : undefined;
                if (legacyModelValue && !selectedModelChoice) {
                  modelOptions.unshift({
                    value: legacyModelValue,
                    label: `${config.model || t('testing.benchmark.runners.modelPlaceholder')}${
                      config.reasoningEffort ? ` (${config.reasoningEffort})` : ''
                    }`,
                  });
                }
                const defaultModelLabel = descriptor?.models.find((choice) => choice.isDefault)?.label;

                return (
                  <article
                    key={runnerId}
                    className={`rd-10px border p-12px transition-colors ${
                      config.enabled ? 'border-primary bg-primary-light-1' : 'border-border-base bg-fill-1'
                    }`}
                    data-testid={`benchmark-runner-${runnerId}`}
                  >
                    <div className='flex items-start justify-between gap-10px'>
                      <div className='min-w-0'>
                        <div className='flex items-center gap-7px'>
                          <span className='truncate text-14px font-650 text-t-primary'>{runnerName(runnerId)}</span>
                          {descriptor ? (
                            <Tag
                              size='small'
                              className={descriptor.available ? 'text-success' : 'text-danger'}
                              icon={
                                descriptor.available ? (
                                  <CheckOne theme='outline' size='11' />
                                ) : (
                                  <CloseOne theme='outline' size='11' />
                                )
                              }
                            >
                              {descriptor.available
                                ? t('testing.benchmark.runners.available')
                                : t('testing.benchmark.runners.unavailable')}
                            </Tag>
                          ) : (
                            <Tag size='small'>{t('testing.benchmark.runners.notProbed')}</Tag>
                          )}
                          {descriptor?.detail ? (
                            <Tooltip content={descriptor.detail}>
                              <span
                                className='flex-center text-t-tertiary'
                                aria-label={t('testing.benchmark.runners.detail')}
                              >
                                <Info theme='outline' size='13' />
                              </span>
                            </Tooltip>
                          ) : null}
                        </div>
                        <p className='m-0 mt-3px text-11px text-t-tertiary'>
                          {t(`testing.benchmark.runnerDescription.${runnerId}`)}
                        </p>
                      </div>
                      <Switch
                        size='small'
                        checked={config.enabled}
                        disabled={descriptor?.available === false}
                        onChange={(enabled) => patchRunner(runnerId, { enabled })}
                        aria-label={t('testing.benchmark.runners.enabledLabel', { runner: runnerName(runnerId) })}
                        data-testid={`benchmark-runner-toggle-${runnerId}`}
                      />
                    </div>

                    <div className='mt-12px flex flex-col gap-9px'>
                      <label className='flex min-w-0 flex-col gap-5px'>
                        <span className='text-11px font-600 text-t-secondary'>
                          {t('testing.benchmark.runners.modelLabel')}
                        </span>
                        <Select
                          size='small'
                          showSearch
                          allowClear
                          value={selectedModelChoice?.key ?? legacyModelValue}
                          options={modelOptions}
                          placeholder={defaultModelLabel || t('testing.benchmark.runners.modelPlaceholder')}
                          onChange={(value) => {
                            const choice = descriptor?.models.find((model) => model.key === value);
                            patchRunner(runnerId, {
                              model: choice?.model,
                              reasoningEffort: choice?.reasoningEffort,
                            });
                          }}
                          aria-label={t('testing.benchmark.runners.modelAriaLabel', { runner: runnerName(runnerId) })}
                        />
                      </label>

                      <label className='flex min-w-0 flex-col gap-5px'>
                        <span className='text-11px font-600 text-t-secondary'>
                          {t('testing.benchmark.runners.workspaceLabel')}
                        </span>
                        <WorkspaceFolderSelect
                          value={config.workspace}
                          onChange={(workspace) => patchRunner(runnerId, { workspace })}
                          placeholder={t('testing.benchmark.runners.workspacePlaceholder')}
                          input_placeholder={t('testing.benchmark.runners.workspacePlaceholder')}
                          recentLabel={t('testing.core.recentWorkspaces')}
                          chooseDifferentLabel={t('testing.core.chooseWorkspace')}
                          recentStorageKey={`tomny:benchmark:recent-workspaces:${runnerId}`}
                          triggerTestId={`benchmark-workspace-${runnerId}`}
                          menuTestId={`benchmark-workspace-menu-${runnerId}`}
                        />
                      </label>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className='mt-14px flex flex-wrap justify-end gap-8px border-t border-border-base pt-14px'>
              <Button
                loading={saving}
                disabled={starting}
                icon={<Save theme='outline' size='14' />}
                onClick={() => void saveSuite()}
                data-testid='benchmark-save'
              >
                {t('testing.benchmark.actions.save')}
              </Button>
              <Button
                type='primary'
                loading={starting}
                disabled={saving}
                icon={<Play theme='outline' size='14' />}
                onClick={() => void startSelected()}
                data-testid='benchmark-start'
              >
                {t('testing.benchmark.actions.startSelected')}
              </Button>
            </div>
          </section>

          <section className='rd-12px border border-border-base bg-fill-0 p-16px'>
            <div className='mb-12px flex flex-wrap items-center justify-between gap-10px'>
              <div className='flex items-start gap-9px'>
                <span className='mt-1px text-primary'>
                  <History theme='outline' size='17' />
                </span>
                <div>
                  <h3 className='m-0 text-15px font-650 text-t-primary'>{t('testing.benchmark.history.title')}</h3>
                  <p className='m-0 mt-3px text-12px text-t-tertiary'>{t('testing.benchmark.history.hint')}</p>
                </div>
              </div>
              <Button
                size='small'
                loading={runsLoading}
                disabled={!selectedSuiteId}
                icon={<Refresh theme='outline' size='13' />}
                onClick={() => void loadRuns(selectedSuiteId)}
              >
                {t('testing.benchmark.actions.refreshHistory')}
              </Button>
            </div>

            <div className='mb-10px grid grid-cols-2 gap-6px md:grid-cols-5'>
              <div className='flex items-center gap-6px text-11px text-t-tertiary md:col-span-5'>
                <ChartLine theme='outline' size='13' />
                <span>{t('testing.benchmark.metrics.hint')}</span>
              </div>
            </div>

            {runsLoading && runs.length === 0 ? (
              <div className='flex-center py-36px'>
                <Spin />
              </div>
            ) : runs.length === 0 ? (
              <Empty description={t('testing.benchmark.history.empty')} />
            ) : (
              <div className='grid grid-cols-1 gap-10px 2xl:grid-cols-2' aria-live='polite'>
                {runs.map((run) => (
                  <RunCard
                    key={run.id}
                    run={run}
                    locale={locale}
                    rerunning={rerunningId === run.id}
                    cancelling={cancellingId === run.id}
                    onRerun={(runId) => void rerunOne(runId)}
                    onCancel={(runId) => void cancelOne(runId)}
                    runnerName={runnerName}
                    t={t}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </Spin>
    </div>
  );
};

export default Benchmark;
