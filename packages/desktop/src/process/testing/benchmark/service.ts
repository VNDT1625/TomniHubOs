/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable no-await-in-loop -- Runner lanes and prompts are intentionally sequential for fair timing and session continuity. */

import type {
  BenchmarkProgressEvent,
  BenchmarkRun,
  BenchmarkRunnerConfig,
  BenchmarkRunnerDescriptor,
  BenchmarkRunnerId,
  BenchmarkSuite,
  BenchmarkTokenUsage,
  BenchmarkTurnMetrics,
  ListBenchmarkRunsRequest,
  RerunBenchmarkRequest,
  SaveBenchmarkSuiteRequest,
  StartBenchmarkRequest,
  StartBenchmarkResult,
} from '@/common/types/benchmark';
import type { ExperimentalCoreEvent, ExperimentalCoreTarget } from '@process/experimentalCore/experimentalCoreRuntime';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { benchmarkSourceFingerprint, captureBenchmarkDiff, runBenchmarkCommand } from './commandRunner';
import { probeNativeCli, runNativeCliTurn } from './cliRunner';
import type { BenchmarkStore } from './store';

const AGENT_TURN_TIMEOUT_MS = 30 * 60_000;
const TERMINAL_STATUSES = new Set<BenchmarkRun['status']>([
  'completed',
  'passed',
  'failed',
  'error',
  'cancelled',
  'interrupted',
]);

export type BenchmarkTomnyPort = {
  listTargets(): Promise<ExperimentalCoreTarget[]>;
  listModels(targetId: string, workspace: string): Promise<ExperimentalCoreTarget['models']>;
  start(input: {
    requestId: string;
    sessionId?: string;
    targetId: string;
    prompt: string;
    workspace: string;
    modelKey?: string;
    permissionMode: 'workspace-write';
    contextIdentity: {
      surface: 'ide';
      agentId: 'tomny';
      personalId: 'default';
      permissionScopes: string[];
      capabilityGrants: string[];
      availableCapabilities: string[];
    };
  }): { requestId: string; sessionId: string };
  cancel(requestId: string): Promise<boolean>;
  resolvePermission(permissionId: string, approved: boolean): Promise<boolean>;
  resolveOrchestrationProposal(proposalId: string, approved: boolean): Promise<boolean>;
  firstTokenMs(requestId: string): Promise<number | null>;
  subscribe(listener: (event: ExperimentalCoreEvent) => void): () => void;
};

export type BenchmarkServiceOptions = {
  store: BenchmarkStore;
  tomny: BenchmarkTomnyPort;
  now?: () => number;
};

const unavailableUsage = (): BenchmarkTokenUsage => ({
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  totalTokens: null,
  source: 'unavailable',
});

const sumComplete = (values: Array<number | null>): number | null => {
  if (values.some((value) => value === null)) return null;
  return (values as number[]).reduce((sum, value) => sum + value, 0);
};

const aggregateUsage = (turns: BenchmarkTurnMetrics[]): BenchmarkTokenUsage => {
  if (turns.length === 0) return unavailableUsage();
  const sources = new Set(turns.map((turn) => turn.usage.source));
  const source: BenchmarkTokenUsage['source'] = sources.has('unavailable')
    ? 'unavailable'
    : sources.size === 1 && sources.has('reported')
      ? 'reported'
      : 'estimated';
  return {
    inputTokens: sumComplete(turns.map((turn) => turn.usage.inputTokens)),
    outputTokens: sumComplete(turns.map((turn) => turn.usage.outputTokens)),
    cachedInputTokens: sumComplete(turns.map((turn) => turn.usage.cachedInputTokens)),
    totalTokens: sumComplete(turns.map((turn) => turn.usage.totalTokens)),
    source,
  };
};

const totalsFor = (turns: BenchmarkTurnMetrics[]): BenchmarkRun['totals'] => ({
  durationMs: turns.reduce((sum, turn) => sum + turn.durationMs, 0),
  firstTokenMs: turns.find((turn) => turn.firstTokenMs !== null)?.firstTokenMs ?? null,
  modelRequests: sumComplete(turns.map((turn) => turn.modelRequests)),
  toolCalls: turns.reduce((sum, turn) => sum + turn.toolCalls, 0),
  toolFailures: turns.reduce((sum, turn) => sum + turn.toolFailures, 0),
  quickTestCalls: turns.reduce((sum, turn) => sum + turn.quickTestCalls, 0),
  usage: aggregateUsage(turns),
});

const runSpec = (suite: BenchmarkSuite, runner: BenchmarkRunnerConfig): BenchmarkRun['spec'] => ({
  suiteId: suite.id,
  suiteRevision: suite.revision,
  suiteName: suite.name,
  prompts: structuredClone(suite.prompts),
  runner: structuredClone(runner),
  verificationCommand: suite.verificationCommand,
  verificationTimeoutMs: suite.verificationTimeoutMs,
});

const createQueuedRun = (
  suite: BenchmarkSuite,
  runner: BenchmarkRunnerConfig,
  batchId: string,
  now: number,
  supersedesRunId?: string
): BenchmarkRun => ({
  id: crypto.randomUUID(),
  batchId,
  comparisonKey: `${suite.id}:${suite.revision}`,
  ...(supersedesRunId ? { supersedesRunId } : {}),
  spec: runSpec(suite, runner),
  status: 'queued',
  createdAt: now,
  turns: [],
  totals: totalsFor([]),
  changedFiles: [],
});

/** Orchestrates fair, sequential multi-runner benchmark campaigns. */
export class BenchmarkService {
  private readonly store: BenchmarkStore;
  private readonly tomny: BenchmarkTomnyPort;
  private readonly now: () => number;
  private readonly listeners = new Set<(event: BenchmarkProgressEvent) => void>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly activeRuns = new Map<string, BenchmarkRun>();
  private readonly workspaceOwners = new Map<string, string>();
  private readonly runWorkspaceKeys = new Map<string, string>();

  public constructor(options: BenchmarkServiceOptions) {
    this.store = options.store;
    this.tomny = options.tomny;
    this.now = options.now ?? Date.now;
  }

  public subscribe(listener: (event: BenchmarkProgressEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(run: BenchmarkRun, message?: string): void {
    const event = { run: structuredClone(run), ...(message ? { message } : {}) };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[Benchmark] Progress listener failed:', error);
      }
    }
  }

  private async workspaceKey(workspace: string): Promise<string> {
    const resolved = await realpath(path.resolve(workspace));
    if (!(await stat(resolved)).isDirectory()) throw new Error('Runner workspace is not a directory.');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  private reserveRuns(runs: BenchmarkRun[], workspaceKeys: string[]): void {
    for (const key of workspaceKeys) {
      if (this.workspaceOwners.has(key)) {
        throw new Error('This workspace already has an active benchmark run. Wait for it to finish or cancel it.');
      }
    }
    runs.forEach((run, index) => {
      const key = workspaceKeys[index];
      this.workspaceOwners.set(key, run.id);
      this.runWorkspaceKeys.set(run.id, key);
      this.controllers.set(run.id, new AbortController());
      this.activeRuns.set(run.id, run);
    });
  }

  private releaseRun(runId: string): void {
    const key = this.runWorkspaceKeys.get(runId);
    if (key && this.workspaceOwners.get(key) === runId) this.workspaceOwners.delete(key);
    this.runWorkspaceKeys.delete(runId);
    this.controllers.delete(runId);
    this.activeRuns.delete(runId);
  }

  private async assertRunnerAvailable(runnerId: BenchmarkRunnerId): Promise<void> {
    if (runnerId === 'tomny') {
      const target = (await this.tomny.listTargets()).find((candidate) => candidate.id === 'tomny');
      if (!target?.available) throw new Error('Tomny IDE runtime is unavailable.');
      return;
    }
    const probe = await probeNativeCli(runnerId);
    if (!probe.available) throw new Error(`${runnerId === 'claude' ? 'Claude CLI' : 'Codex CLI'} is unavailable.`);
  }

  private async persist(run: BenchmarkRun, message?: string): Promise<void> {
    await this.store.saveRun(run);
    this.emit(run, message);
  }

  public listSuites(): Promise<BenchmarkSuite[]> {
    return this.store.listSuites();
  }

  public saveSuite(draft: SaveBenchmarkSuiteRequest): Promise<BenchmarkSuite> {
    return this.store.saveSuite(draft);
  }

  public removeSuite(suiteId: string): Promise<boolean> {
    return this.store.removeSuite(suiteId);
  }

  public listRuns(query: ListBenchmarkRunsRequest = {}): Promise<BenchmarkRun[]> {
    return this.store.listRuns(query.suiteId, query.limit);
  }

  public async probeRunners(): Promise<BenchmarkRunnerDescriptor[]> {
    const [targets, claude, codex] = await Promise.all([
      this.tomny.listTargets().catch((): ExperimentalCoreTarget[] => []),
      probeNativeCli('claude'),
      probeNativeCli('codex'),
    ]);
    const tomny = targets.find((target) => target.id === 'tomny');
    return [
      {
        id: 'tomny',
        name: 'Tomny IDE',
        kind: 'tomny-ide',
        available: Boolean(tomny?.available),
        detail: tomny?.detail,
        models:
          tomny?.models.map((model) => ({
            key: model.key,
            label: model.label,
            isDefault: model.isDefault,
            model: model.key,
          })) ?? [],
        defaultModel: tomny?.defaultModelKey,
      },
      {
        id: 'claude',
        name: 'Claude CLI',
        kind: 'native-cli',
        available: claude.available,
        detail: claude.detail,
        version: claude.version,
        models: claude.models,
        defaultModel: claude.defaultModel,
      },
      {
        id: 'codex',
        name: 'Codex CLI',
        kind: 'native-cli',
        available: codex.available,
        detail: codex.detail,
        version: codex.version,
        models: codex.models,
        defaultModel: codex.defaultModel,
      },
    ];
  }

  public async start(request: StartBenchmarkRequest): Promise<StartBenchmarkResult> {
    const suite = await this.store.getSuite(request.suiteId);
    if (!suite) throw new Error('Benchmark suite not found.');
    const selected = [...new Set(request.runnerIds)].map((runnerId) => {
      const runner = suite.runnerConfigs.find((candidate) => candidate.runnerId === runnerId && candidate.enabled);
      if (!runner) throw new Error(`Runner ${runnerId} is not enabled in this suite.`);
      if (!runner.workspace.trim()) throw new Error(`Select an isolated workspace for ${runnerId}.`);
      return runner;
    });
    if (selected.length === 0) throw new Error('Select at least one benchmark runner.');
    const workspaceKeys = await Promise.all(selected.map((runner) => this.workspaceKey(runner.workspace)));
    if (new Set(workspaceKeys).size !== workspaceKeys.length) {
      throw new Error('Each selected runner needs its own workspace copy so agents cannot overwrite each other.');
    }
    await Promise.all(selected.map((runner) => this.assertRunnerAvailable(runner.runnerId)));

    const batchId = crypto.randomUUID();
    const runs = selected.map((runner) => createQueuedRun(suite, runner, batchId, this.now()));
    this.reserveRuns(runs, workspaceKeys);
    try {
      await Promise.all(runs.map((run) => this.persist(run, 'Queued')));
    } catch (error) {
      runs.forEach((run) => this.releaseRun(run.id));
      throw error;
    }
    void this.executeBatch(runs);
    return { batchId, runIds: runs.map((run) => run.id) };
  }

  public async rerun(request: RerunBenchmarkRequest): Promise<StartBenchmarkResult> {
    const source = await this.store.getRun(request.runId);
    if (!source) throw new Error('Benchmark run not found.');
    const suite: BenchmarkSuite = {
      id: source.spec.suiteId,
      revision: source.spec.suiteRevision,
      name: source.spec.suiteName,
      prompts: source.spec.prompts,
      runnerConfigs: [source.spec.runner],
      verificationCommand: source.spec.verificationCommand,
      verificationTimeoutMs: source.spec.verificationTimeoutMs,
      createdAt: source.createdAt,
      updatedAt: source.createdAt,
    };
    const workspaceKey = await this.workspaceKey(source.spec.runner.workspace);
    await this.assertRunnerAvailable(source.spec.runner.runnerId);
    if (source.sourceFingerprint) {
      const currentFingerprint = await benchmarkSourceFingerprint(source.spec.runner.workspace);
      if (currentFingerprint !== source.sourceFingerprint) {
        throw new Error('Restore this isolated workspace to its original benchmark baseline before rerunning it.');
      }
    }
    const batchId = crypto.randomUUID();
    const run = createQueuedRun(suite, source.spec.runner, batchId, this.now(), source.id);
    this.reserveRuns([run], [workspaceKey]);
    try {
      await this.persist(run, 'Queued rerun');
    } catch (error) {
      this.releaseRun(run.id);
      throw error;
    }
    void this.executeBatch([run]);
    return { batchId, runIds: [run.id] };
  }

  public async cancel(runId: string): Promise<boolean> {
    const controller = this.controllers.get(runId);
    if (!controller) return false;
    controller.abort();
    const run = this.activeRuns.get(runId);
    if (run?.status === 'queued') {
      run.status = 'cancelled';
      run.finishedAt = this.now();
      run.durationMs = 0;
      this.releaseRun(runId);
      await this.persist(run, 'Finished');
    }
    return true;
  }

  private async executeBatch(runs: BenchmarkRun[]): Promise<void> {
    // Sequential execution avoids CPU/disk contention distorting wall-clock comparisons.
    for (const run of runs) {
      if (TERMINAL_STATUSES.has(run.status)) {
        this.releaseRun(run.id);
        continue;
      }
      try {
        await this.executeRun(run);
      } catch (error) {
        // Persistence failures are already terminal for this run, but must not
        // strand the remaining runners in the same campaign.
        console.error('[Benchmark] Run finalization failed:', error);
      }
    }
  }

  private async executeRun(run: BenchmarkRun): Promise<void> {
    const controller = this.controllers.get(run.id) ?? new AbortController();
    this.controllers.set(run.id, controller);
    this.activeRuns.set(run.id, run);
    const startedAt = this.now();
    let agentPhaseStarted = false;
    try {
      const workspace = path.resolve(run.spec.runner.workspace);
      if (!(await stat(workspace)).isDirectory()) throw new Error('Runner workspace is not a directory.');
      run.status = 'preparing';
      run.startedAt = startedAt;
      run.sourceFingerprint = await benchmarkSourceFingerprint(workspace, controller.signal);
      run.comparisonKey = `${run.spec.suiteId}:${run.spec.suiteRevision}:${run.sourceFingerprint}`;
      await this.persist(run, 'Preparing workspace');

      if (run.spec.verificationCommand) {
        run.precheck = await runBenchmarkCommand(
          run.spec.verificationCommand,
          workspace,
          run.spec.verificationTimeoutMs,
          controller.signal
        );
        if (controller.signal.aborted) throw new DOMException('Benchmark cancelled.', 'AbortError');
        if (run.precheck.timedOut) throw new Error('The pre-fix verification command timed out.');
        if (run.precheck.exitCode === 0) {
          throw new Error('The pre-fix verification already passes, so this workspace does not reproduce the bug.');
        }
      }

      run.status = 'running';
      agentPhaseStarted = true;
      await this.persist(run, 'Agent running');
      let sessionId: string | undefined;
      for (const prompt of run.spec.prompts) {
        if (controller.signal.aborted) throw new DOMException('Benchmark cancelled.', 'AbortError');
        const turn =
          run.spec.runner.runnerId === 'tomny'
            ? await this.runTomnyTurn(run, prompt, sessionId, controller.signal)
            : await runNativeCliTurn({
                runnerId: run.spec.runner.runnerId,
                workspace,
                prompt: prompt.text,
                model: run.spec.runner.model,
                reasoningEffort: run.spec.runner.reasoningEffort,
                previousSessionId: sessionId,
                signal: controller.signal,
                timeoutMs: AGENT_TURN_TIMEOUT_MS,
              });
        sessionId = turn.sessionId;
        run.sessionId = sessionId;
        run.turns.push({
          promptId: prompt.id,
          promptName: prompt.name,
          startedAt: turn.startedAt,
          durationMs: turn.durationMs,
          firstTokenMs: turn.firstTokenMs,
          modelRequests: turn.modelRequests,
          toolCalls: turn.toolCalls,
          toolFailures: turn.toolFailures,
          quickTestCalls: 'quickTestCalls' in turn && typeof turn.quickTestCalls === 'number' ? turn.quickTestCalls : 0,
          usage: turn.usage,
          response: turn.response,
        });
        run.totals = totalsFor(run.turns);
        await this.persist(run, `${prompt.name} completed`);
      }

      const captured = await captureBenchmarkDiff(workspace, controller.signal);
      run.diff = captured.diff;
      run.changedFiles = captured.changedFiles;
      if (run.spec.verificationCommand) {
        run.status = 'verifying';
        await this.persist(run, 'Running acceptance check');
        run.verification = await runBenchmarkCommand(
          run.spec.verificationCommand,
          workspace,
          run.spec.verificationTimeoutMs,
          controller.signal
        );
        if (controller.signal.aborted) throw new DOMException('Benchmark cancelled.', 'AbortError');
        run.status = run.verification.exitCode === 0 && !run.verification.timedOut ? 'passed' : 'failed';
      } else {
        run.status = 'completed';
      }
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
      if (cancelled) {
        run.status = 'cancelled';
        run.error = undefined;
      } else {
        run.status = 'error';
        run.error = error instanceof Error ? error.message : String(error);
        // An agent can exit after applying a valid patch. Preserve that evidence
        // and still run the acceptance check instead of discarding the outcome.
        if (agentPhaseStarted) {
          const captured = await captureBenchmarkDiff(path.resolve(run.spec.runner.workspace));
          run.diff = captured.diff;
          run.changedFiles = captured.changedFiles;
          if (run.spec.verificationCommand && run.verification === undefined) {
            run.status = 'verifying';
            await this.persist(run, 'Running acceptance check after agent error');
            run.verification = await runBenchmarkCommand(
              run.spec.verificationCommand,
              path.resolve(run.spec.runner.workspace),
              run.spec.verificationTimeoutMs
            );
            if (run.verification.exitCode === 0 && !run.verification.timedOut) run.status = 'passed';
            else run.status = 'error';
          }
        }
      }
    } finally {
      run.finishedAt = this.now();
      run.durationMs = Math.max(0, run.finishedAt - startedAt);
      run.totals = totalsFor(run.turns);
      await this.persist(run, TERMINAL_STATUSES.has(run.status) ? 'Finished' : undefined);
      this.releaseRun(run.id);
    }
  }

  private runTomnyTurn(
    run: BenchmarkRun,
    prompt: BenchmarkRun['spec']['prompts'][number],
    previousSessionId: string | undefined,
    signal: AbortSignal
  ): Promise<{
    sessionId: string;
    response: string;
    startedAt: number;
    durationMs: number;
    firstTokenMs: number | null;
    modelRequests: number | null;
    toolCalls: number;
    toolFailures: number;
    quickTestCalls: number;
    usage: BenchmarkTokenUsage;
  }> {
    const requestId = crypto.randomUUID();
    const startedAt = this.now();
    let response = '';
    let firstTokenAt: number | undefined;
    let toolFailures = 0;
    let quickTestCalls = 0;
    const toolCalls = new Set<string>();
    return new Promise((resolve, reject) => {
      let settled = false;
      let sessionId = previousSessionId ?? '';
      const finish = (error?: Error, telemetryFirstTokenMs?: number | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else
          resolve({
            sessionId,
            response,
            startedAt,
            durationMs: this.now() - startedAt,
            firstTokenMs: telemetryFirstTokenMs ?? (firstTokenAt === undefined ? null : firstTokenAt - startedAt),
            modelRequests: null,
            toolCalls: toolCalls.size,
            toolFailures,
            quickTestCalls,
            // The current Tomny core does not expose provider usage. Reporting a
            // visible-text estimate here would make Tomny look artificially cheap.
            usage: unavailableUsage(),
          });
      };
      const abort = (): void => {
        void this.tomny.cancel(requestId);
        finish(new DOMException('Benchmark cancelled.', 'AbortError'));
      };
      const unsubscribe = this.tomny.subscribe((event) => {
        if (event.requestId !== requestId) return;
        sessionId = event.sessionId;
        if (event.type === 'delta' && event.text) {
          firstTokenAt ??= this.now();
          response = event.mode === 'replace' ? event.text : response + event.text;
        } else if (event.type === 'tool-call') {
          const callKey = event.callId ?? `${event.tool ?? 'tool'}:${event.sequence}`;
          if (!toolCalls.has(callKey) && /(?:^|_)(?:ide_)?quick_test(?:_|$)/iu.test(event.tool ?? '')) {
            quickTestCalls += 1;
          }
          toolCalls.add(callKey);
        } else if (event.type === 'tool-result' && event.outcome === 'error') {
          toolFailures += 1;
        } else if (event.type === 'permission' && event.permissionId) {
          void this.tomny.resolvePermission(event.permissionId, true);
        } else if (event.type === 'orchestration-proposal' && event.orchestrationProposalId) {
          // A single-runner benchmark must not silently expand into a Team/Company.
          void this.tomny.resolveOrchestrationProposal(event.orchestrationProposalId, false);
        } else if (event.type === 'completed') {
          void this.tomny.firstTokenMs(requestId).then(
            (value) => finish(undefined, value),
            () => finish()
          );
        } else if (event.type === 'cancelled') finish(new DOMException('Benchmark cancelled.', 'AbortError'));
        else if (event.type === 'error') finish(new Error(event.text || 'Tomny benchmark turn failed.'));
      });
      const timer = setTimeout(() => {
        void this.tomny.cancel(requestId);
        finish(new Error('Tomny benchmark turn timed out.'));
      }, AGENT_TURN_TIMEOUT_MS);
      signal.addEventListener('abort', abort, { once: true });
      const started = this.tomny.start({
        requestId,
        sessionId: previousSessionId,
        targetId: 'tomny',
        prompt: prompt.text,
        workspace: run.spec.runner.workspace,
        modelKey: run.spec.runner.model,
        permissionMode: 'workspace-write',
        contextIdentity: {
          surface: 'ide',
          agentId: 'tomny',
          personalId: 'default',
          permissionScopes: ['workspace.read', 'workspace.write'],
          capabilityGrants: ['surface.ide'],
          availableCapabilities: ['surface.ide'],
        },
      });
      sessionId = started.sessionId;
      if (signal.aborted) abort();
    });
  }
}
