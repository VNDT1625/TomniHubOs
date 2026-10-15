/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/* oxlint-disable no-await-in-loop -- services start strictly one after another; polling and retries are sequential */

import { ADAPTER_PROCESS_PROGRAMS } from '@/common/packages/adapter';
import type {
  PackagePersistentContributionBinding,
  PackagePersistentContributionEndpoint,
  PackagePersistentContributionSupervisorDependencies,
} from '@process/resources/packageProcessRuntime/persistentContributionSupervisor';
import { resolveCwdInsidePackage } from './repoProcessCwd';
import { createRepoProcessLog, type RepoProcessLog } from './repoProcessLog';
import {
  RepoProcessError,
  type RepoProcessEvent,
  type RepoProcessLogLine,
  type RepoProcessPorts,
  type RepoProcessServiceSpec,
  type RepoProcessSpec,
  type RepoProcessState,
  type ServiceSlots,
  type SpawnedProcess,
} from './repoProcessPorts';

export const READY_TIMEOUT_MS = 120_000;
export const STOP_GRACE_MS = 5_000;
export const SETUP_TIMEOUT_MS = 600_000;
/** A headless program (no port) counts as started once it has stayed alive this long. */
export const HEADLESS_SETTLE_MS = 1_500;
const POLL_MS = 250;
const PROGRESS_EVERY_MS = 1_000;
const PROCESS_TOKEN = /^[A-Za-z0-9@._/:=~+,-]+$/u;
/** Variables a package may never set: they change what the runtime or the loader executes. */
const RESERVED_ENV: ReadonlySet<string> = new Set([
  'PATH',
  'PATHEXT',
  'PORT',
  'HOST',
  'NODE_OPTIONS',
  'ELECTRON_RUN_AS_NODE',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
]);

export type RepoProcessRestartPolicy = Readonly<{
  /** Restarts allowed inside `windowMs` before the service is left in `error`. */
  max: number;
  windowMs: number;
  /** Delay before the n-th restart in the window; the last value repeats. */
  backoffMs: readonly number[];
}>;

export const DEFAULT_RESTART_POLICY: RepoProcessRestartPolicy = {
  max: 3,
  windowMs: 5 * 60_000,
  backoffMs: [1_000, 2_000, 4_000],
};

export type RepoProcessDependencies = Readonly<{
  ports: RepoProcessPorts;
  /** App-wide service counter; omit only in tests. */
  slots?: ServiceSlots;
  onEvent?: (packageEvent: RepoProcessEvent) => void;
  readyTimeoutMs?: number;
  headlessSettleMs?: number;
  stopGraceMs?: number;
  setupTimeoutMs?: number;
  pollMs?: number;
  restart?: RepoProcessRestartPolicy;
}>;

export type RepoProcessServiceStatus = Readonly<{ id: string; state: RepoProcessState; restarts: number }>;

export type RepoProcessEndpoint = PackagePersistentContributionEndpoint &
  Readonly<{
    services: () => readonly RepoProcessServiceStatus[];
    logs: (serviceId: string) => readonly RepoProcessLogLine[];
  }>;

type PreparedService = {
  spec: RepoProcessServiceSpec;
  cwd: string;
  env: Record<string, string>;
  log: RepoProcessLog;
  state: RepoProcessState;
  restarts: number[];
  /** Live child, replaced on every restart. */
  child: { process: SpawnedProcess; exited: boolean } | undefined;
  slotHeld: boolean;
};

const checkTokens = (serviceId: string, argv: readonly string[]): void => {
  const program = argv[0] ?? '';
  if (!ADAPTER_PROCESS_PROGRAMS.has(program)) {
    throw new RepoProcessError('PROGRAM_FORBIDDEN', `Program is not allowed: ${program}`, serviceId);
  }
  if (!argv.every((token) => PROCESS_TOKEN.test(token))) {
    throw new RepoProcessError('PROGRAM_FORBIDDEN', 'A command argument is not a plain token', serviceId);
  }
};

/** Declared order, adjusted so every `dependsOn` service comes first. Unknown names and cycles are refused. */
const orderServices = (services: readonly RepoProcessServiceSpec[]): readonly RepoProcessServiceSpec[] => {
  const ids = new Set(services.map((service) => service.id));
  if (ids.size !== services.length) throw new RepoProcessError('SPEC_INVALID', 'Duplicate service id');
  const ports = services.flatMap((service) => (service.ready === undefined ? [] : [service.ready.port]));
  if (new Set(ports).size !== ports.length) {
    throw new RepoProcessError('SPEC_INVALID', 'Two services declare the same port');
  }
  const ordered: RepoProcessServiceSpec[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (service: RepoProcessServiceSpec): void => {
    if (done.has(service.id)) return;
    if (visiting.has(service.id)) throw new RepoProcessError('SPEC_INVALID', 'dependsOn has a cycle', service.id);
    visiting.add(service.id);
    for (const name of service.dependsOn ?? []) {
      const dependency = services.find((candidate) => candidate.id === name);
      if (dependency === undefined)
        throw new RepoProcessError('SPEC_INVALID', `Unknown dependency ${name}`, service.id);
      visit(dependency);
    }
    visiting.delete(service.id);
    done.add(service.id);
    ordered.push(service);
  };
  for (const service of services) visit(service);
  return ordered;
};

/**
 * Starts every service of a package in dependency order, waits for each ready port, and returns an endpoint whose
 * `stop()` kills every process tree. Runs inside Main only. Rejects (after cleaning up) when any service cannot
 * start; the supervisor then records the failure.
 */
export const startRepoProcessEndpoint = async (
  deps: RepoProcessDependencies,
  spec: RepoProcessSpec,
  signal?: AbortSignal
): Promise<RepoProcessEndpoint> => {
  const { ports } = deps;
  const readyTimeoutMs = deps.readyTimeoutMs ?? READY_TIMEOUT_MS;
  const headlessSettleMs = deps.headlessSettleMs ?? HEADLESS_SETTLE_MS;
  const stopGraceMs = deps.stopGraceMs ?? STOP_GRACE_MS;
  const setupTimeoutMs = deps.setupTimeoutMs ?? SETUP_TIMEOUT_MS;
  const pollMs = deps.pollMs ?? POLL_MS;
  const policy = deps.restart ?? DEFAULT_RESTART_POLICY;
  const control = new AbortController();
  let stopping = false;
  let stopPromise: Promise<void> | undefined;

  const emit = (service: PreparedService, state: RepoProcessState, extra: Partial<RepoProcessEvent> = {}): void => {
    service.state = state;
    deps.onEvent?.({ serviceId: service.spec.id, state, ...extra });
  };

  const order = orderServices(spec.services);
  // Validate everything before anything runs or any slot is taken.
  const prepared: PreparedService[] = [];
  for (const serviceSpec of order) {
    checkTokens(serviceSpec.id, serviceSpec.start);
    for (const command of serviceSpec.setup ?? []) checkTokens(serviceSpec.id, command);
    for (const variable of serviceSpec.env ?? []) {
      if (RESERVED_ENV.has(variable.name.toUpperCase())) {
        throw new RepoProcessError('ENV_FORBIDDEN', `Variable is reserved: ${variable.name}`, serviceSpec.id);
      }
    }
    prepared.push({
      spec: serviceSpec,
      cwd: await resolveCwdInsidePackage(spec.packageDirectory, serviceSpec.cwd, serviceSpec.id),
      env: {},
      log: createRepoProcessLog(ports.clock.now),
      state: 'stopped',
      restarts: [],
      child: undefined,
      slotHeld: false,
    });
  }

  if (deps.slots !== undefined && !deps.slots.acquire(prepared.length)) {
    throw new RepoProcessError('SERVICE_LIMIT', 'Too many services are running; stop one first');
  }
  for (const service of prepared) service.slotHeld = deps.slots !== undefined;
  const releaseSlot = (service: PreparedService): void => {
    if (service.slotHeld) {
      service.slotHeld = false;
      deps.slots?.release(1);
    }
  };

  const buildEnv = async (service: PreparedService): Promise<void> => {
    const env: Record<string, string> = { ...ports.baseEnv() };
    for (const variable of service.spec.env ?? []) {
      const value = await ports.resolveSecret(variable.name);
      if (value === undefined || value === '') {
        if (variable.required) {
          throw new RepoProcessError('ENV_MISSING', `Missing value for ${variable.name}`, service.spec.id);
        }
        continue;
      }
      service.log.addSecret(value);
      env[variable.name] = value;
    }
    if (service.spec.ready !== undefined) env['PORT'] = String(service.spec.ready.port);
    env['HOST'] = '127.0.0.1';
    service.env = env;
  };

  const launch = (service: PreparedService, argv: readonly string[]): SpawnedProcess => {
    const [program = '', ...args] = argv;
    const isNode = program === 'node';
    const spawned = ports.spawn({
      command: isNode ? ports.nodeExecutable : program,
      args,
      cwd: service.cwd,
      env: isNode ? { ...service.env, ELECTRON_RUN_AS_NODE: '1' } : service.env,
    });
    spawned.onOutput((stream, chunk) => service.log.append(stream, chunk));
    return spawned;
  };

  const killChild = async (service: PreparedService): Promise<void> => {
    const child = service.child;
    service.child = undefined;
    if (child !== undefined && child.process.pid !== undefined) {
      await ports.killTree(child.process.pid, stopGraceMs);
    }
    service.log.flush();
  };

  const runSetup = async (service: PreparedService): Promise<void> => {
    const commands = service.spec.setup ?? [];
    if (commands.length === 0) return;
    const key = `${spec.approvalHash}:${service.spec.id}`;
    if (await ports.setupMarkers.has(key)) return;
    for (const argv of commands) {
      const child = launch(service, argv);
      const exit = new Promise<number | null>((resolve) => child.onExit(resolve));
      const timeout = ports.clock
        .sleep(setupTimeoutMs, control.signal)
        .then((): 'timeout' => 'timeout')
        .catch((): 'aborted' => 'aborted');
      const result = await Promise.race([exit, timeout]);
      if (result !== 0) {
        if (child.pid !== undefined) await ports.killTree(child.pid, stopGraceMs);
        service.log.flush();
        throw new RepoProcessError(
          result === 'aborted' ? 'ABORTED' : 'SETUP_FAILED',
          result === 'timeout' ? 'Setup timed out' : `Setup command failed: ${argv.join(' ')}`,
          service.spec.id
        );
      }
    }
    service.log.flush();
    await ports.setupMarkers.mark(key);
  };

  const assertPortFree = async (service: PreparedService): Promise<void> => {
    const port = service.spec.ready?.port;
    if (port === undefined || !(await ports.isPortOpen(port))) return;
    const owner = await ports.describePortOwner?.(port);
    throw new RepoProcessError(
      'PORT_IN_USE',
      `Port ${port} is already in use${owner === undefined ? '' : ` by ${owner}`}`,
      service.spec.id
    );
  };

  const waitReady = async (service: PreparedService): Promise<void> => {
    const startedAt = ports.clock.now();
    let lastProgress = -PROGRESS_EVERY_MS;
    for (;;) {
      if (stopping) throw new RepoProcessError('ABORTED', 'Stopped while starting', service.spec.id);
      if (service.child === undefined || service.child.exited) {
        service.log.flush();
        throw new RepoProcessError('EXITED_BEFORE_READY', 'The process exited before it was ready', service.spec.id);
      }
      const port = service.spec.ready?.port;
      if (port === undefined)
        throw new RepoProcessError('SPEC_INVALID', 'Program has no port to wait for', service.spec.id);
      if (await ports.isPortOpen(port)) return;
      const waited = ports.clock.now() - startedAt;
      if (waited >= readyTimeoutMs) {
        throw new RepoProcessError(
          'READY_TIMEOUT',
          `Port ${port} did not open in ${Math.round(readyTimeoutMs / 1000)}s`,
          service.spec.id
        );
      }
      if (waited - lastProgress >= PROGRESS_EVERY_MS) {
        lastProgress = waited;
        emit(service, 'waiting', { waitedMs: waited });
      }
      try {
        await ports.clock.sleep(pollMs, control.signal);
      } catch {
        throw new RepoProcessError('ABORTED', 'Stopped while starting', service.spec.id);
      }
    }
  };

  /** A headless program has no port: it is started once it stayed alive for the settle window; an exit fails the start. */
  const waitHeadless = async (service: PreparedService): Promise<void> => {
    try {
      await ports.clock.sleep(headlessSettleMs, control.signal);
    } catch {
      throw new RepoProcessError('ABORTED', 'Stopped while starting', service.spec.id);
    }
    if (stopping) throw new RepoProcessError('ABORTED', 'Stopped while starting', service.spec.id);
    if (service.child === undefined || service.child.exited) {
      service.log.flush();
      throw new RepoProcessError('EXITED_BEFORE_READY', 'The process exited before it was ready', service.spec.id);
    }
  };

  /** One start attempt: free-port check, spawn, ready gate. On failure the child is killed and the error thrown. */
  const startOnce = async (service: PreparedService): Promise<void> => {
    emit(service, 'starting');
    if (service.spec.ready !== undefined) await assertPortFree(service);
    const spawned = launch(service, service.spec.start);
    const child = { process: spawned, exited: false };
    service.child = child;
    spawned.onExit(() => {
      child.exited = true;
      service.log.flush();
      if (stopping || service.child !== child || service.state !== 'ready') return;
      service.child = undefined;
      void recoverService(service);
    });
    if (stopping) {
      await killChild(service);
      throw new RepoProcessError('ABORTED', 'Stopped while starting', service.spec.id);
    }
    try {
      if (service.spec.ready === undefined) await waitHeadless(service);
      else await waitReady(service);
    } catch (error) {
      await killChild(service);
      throw error;
    }
    emit(service, 'ready');
  };

  /** A ready service died: wait with backoff and start again, at most `policy.max` times per window. */
  const recoverService = async (service: PreparedService): Promise<void> => {
    // The orphaned descendants of the crashed process may still hold the port; nothing more to kill by pid here.
    for (;;) {
      if (stopping) return;
      const now = ports.clock.now();
      service.restarts = service.restarts.filter((at) => now - at < policy.windowMs);
      if (service.restarts.length >= policy.max) {
        releaseSlot(service);
        emit(service, 'error', {
          code: 'RESTART_LIMIT',
          message: `Crashed more than ${policy.max} times in ${Math.round(policy.windowMs / 60_000)} minutes`,
        });
        return;
      }
      const delay = policy.backoffMs[Math.min(service.restarts.length, policy.backoffMs.length - 1)] ?? 0;
      service.restarts.push(now);
      emit(service, 'restarting');
      try {
        await ports.clock.sleep(delay, control.signal);
      } catch {
        return;
      }
      if (stopping) return;
      try {
        await startOnce(service);
        return;
      } catch (error) {
        if (stopping) return;
        service.log.append('stderr', `restart failed: ${error instanceof Error ? error.message : 'unknown'}\n`);
      }
    }
  };

  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      stopping = true;
      control.abort();
      for (const service of prepared.toReversed()) {
        await killChild(service);
        releaseSlot(service);
        if (service.state !== 'stopped') emit(service, 'stopped');
      }
    })();
    return stopPromise;
  };

  const onAbort = (): void => {
    void stop();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    if (signal?.aborted === true) throw new RepoProcessError('ABORTED', 'Aborted before start');
    for (const service of prepared) {
      await buildEnv(service);
      await runSetup(service);
      await startOnce(service);
    }
  } catch (error) {
    await stop();
    if (error instanceof RepoProcessError && error.serviceId !== undefined) {
      const failed = prepared.find((service) => service.spec.id === error.serviceId);
      if (failed !== undefined)
        deps.onEvent?.({ serviceId: failed.spec.id, state: 'error', code: error.code, message: error.message });
    }
    throw error;
  }

  return {
    stop,
    services: () =>
      prepared.map((service) => ({ id: service.spec.id, state: service.state, restarts: service.restarts.length })),
    logs: (serviceId) => prepared.find((service) => service.spec.id === serviceId)?.log.lines() ?? [],
  };
};

/**
 * Adapter for `createPackagePersistentContributionSupervisor`: `resolveSpec` is Main-owned and returns the services
 * of the exact bound connection (or `undefined` when there is nothing to run).
 */
export const createRepoProcessEndpointFactory =
  (
    deps: RepoProcessDependencies,
    resolveSpec: (binding: PackagePersistentContributionBinding) => Promise<RepoProcessSpec | undefined>
  ): PackagePersistentContributionSupervisorDependencies['createEndpoint'] =>
  async (binding, signal) => {
    const spec = await resolveSpec(binding);
    if (spec === undefined) return undefined;
    return startRepoProcessEndpoint(deps, spec, signal);
  };
