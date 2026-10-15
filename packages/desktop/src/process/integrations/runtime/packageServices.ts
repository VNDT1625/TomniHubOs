/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runs the background `service` connections (docs/platform/repotopackage-design.md sections 10.11, 13, 14 S17, 15.1).
 *
 * - Turning the connection on only approves it. A service starts when the person presses Start (`start`), never when
 *   the Hub starts: nothing in this file is called from startup, `reconcile` only stops what is no longer kept.
 * - `start` re-reads the connection from Main's own copy of the package, requires it to be on with an approval that
 *   still matches what would run, and starts the services with `RepoProcessEndpoint` under a
 *   `PersistentContributionSupervisor` bound to the exact package, version, connection and approval hash.
 * - Stopping happens on `stop`, on turning the connection off, on removing the package, on `reconcile` and on `dispose`
 *   (quit). The process runtime kills the whole process tree.
 * - `list` and `subscribe` are the state the Active sidebar (S17) reads: one entry per service connection that was
 *   started and not stopped, with the state of each of its programs. Logs come from the process runtime's ring buffer
 *   with secrets already masked. Nothing here takes a path, an address, a command or a session name from a caller.
 */

import type { ConnectionRegistry, EnabledConnection } from '@process/integrations/connections/core/registry';
import {
  createPackagePersistentContributionSupervisor,
  type PackagePersistentContributionBinding,
  type PackagePersistentContributionEvidence,
} from '@process/resources/packageProcessRuntime/persistentContributionSupervisor';
import {
  startRepoProcessEndpoint,
  type RepoProcessDependencies,
  type RepoProcessEndpoint,
  type RepoProcessServiceStatus,
} from './repoProcessEndpoint';
import {
  createServiceSlots,
  RepoProcessError,
  type RepoProcessEvent,
  type RepoProcessLogLine,
  type RepoProcessPorts,
  type RepoProcessSpec,
  type ServiceSlots,
} from './repoProcessPorts';

const PUBLISHER_ID = 'connection-host';
const CONTRIBUTION_PREFIX = 'service.';
const KEY_SEPARATOR = '\u0000';
const MAX_ERROR_LENGTH = 300;

/** The service connection a caller names; Main derives everything else. */
export type PackageServiceRef = Readonly<{ packageId: string; connectionId: string }>;

/** What the runtime knows about one running connection when it builds the ports for it. */
export type PackageServiceScope = Readonly<{
  packageId: string;
  packageVersion: string;
  connectionId: string;
  approvalHash: string;
}>;

export type PackageServiceErrorCode =
  | 'NOT_ENABLED'
  | 'NEEDS_APPROVAL'
  | 'NEEDS_INPUT'
  | 'PORT_IN_USE'
  | 'LIMIT_REACHED'
  | 'START_FAILED'
  | 'UNAVAILABLE';

/** Stable failure of `start`; `message` is a short sentence without secrets. */
export class PackageServiceError extends Error {
  readonly code: PackageServiceErrorCode;
  constructor(code: PackageServiceErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'PackageServiceError';
    this.code = code;
  }
}

export type PackageServiceState = 'starting' | 'running' | 'error';

/** One row of the Active sidebar. No path, no command, no variable value. */
export type PackageServiceStatus = Readonly<{
  packageId: string;
  connectionId: string;
  title: string;
  state: PackageServiceState;
  services: readonly RepoProcessServiceStatus[];
  /** Why it is in `error` (a failed start, or a program that gave up restarting). */
  error?: Readonly<{ code: string; message: string }>;
}>;

export type PackageServiceControl = Readonly<{
  /** The explicit user start. Resolves when every program is ready; rejects with `PackageServiceError`. */
  start: (request: PackageServiceRef) => Promise<PackageServiceStatus>;
  /** Stops the programs of a service and forgets its setup markers. Idempotent. */
  stop: (request: PackageServiceRef) => Promise<void>;
  /** Stops every running service that is not in `keep` (`${packageId}\u0000service:${connectionId}`). */
  reconcile: (keep: ReadonlySet<string>) => Promise<void>;
  /** Services that are starting, running or failed to start, in start order. */
  list: () => readonly PackageServiceStatus[];
  /** Redacted output of one program (ring buffer of the process runtime). */
  logs: (request: PackageServiceRef, serviceId: string) => readonly RepoProcessLogLine[];
  /** Called after every change of `list`. Returns the unsubscribe function. A listener that throws is ignored. */
  subscribe: (listener: (services: readonly PackageServiceStatus[]) => void) => () => void;
  /** Stops everything (the application quits). */
  dispose: () => Promise<void>;
}>;

export type PackageServiceControlDeps = Readonly<{
  registry: Pick<ConnectionRegistry, 'view' | 'describe' | 'enabledOfKind'>;
  /** The operating-system ports for one running connection (spawn, kill, sockets, secrets, markers). */
  portsFor: (scope: PackageServiceScope) => RepoProcessPorts;
  recordEvidence: (evidence: PackagePersistentContributionEvidence) => Promise<void>;
  /** Forgets the setup markers of a connection (called when it is stopped). */
  clearSetup?: (packageId: string, connectionId: string) => Promise<void>;
  /** App-wide counter of running services, shared with the `web-embed` apps (v1 limit 6). */
  slots?: ServiceSlots;
  /** Timing knobs of the process runtime; tests shorten them. */
  timing?: Pick<RepoProcessDependencies, 'readyTimeoutMs' | 'stopGraceMs' | 'setupTimeoutMs' | 'pollMs' | 'restart'>;
}>;

type Entry = {
  ref: PackageServiceRef;
  title: string;
  binding: PackagePersistentContributionBinding;
  endpoint?: RepoProcessEndpoint;
  phase: 'starting' | 'running' | 'failed';
  failure?: { code: string; message: string };
  /** Last error reported by a program of the endpoint (restart limit and the like). */
  lastEvent?: { code: string; message: string };
};

const keyOf = (request: PackageServiceRef): string => `${request.packageId}${KEY_SEPARATOR}${request.connectionId}`;

const short = (text: string): string =>
  text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH - 1)}…` : text;

const failureOf = (error: unknown): PackageServiceError => {
  if (error instanceof PackageServiceError) return error;
  if (error instanceof RepoProcessError) {
    switch (error.code) {
      case 'PORT_IN_USE':
        return new PackageServiceError('PORT_IN_USE', error.message);
      case 'SERVICE_LIMIT':
        return new PackageServiceError('LIMIT_REACHED', error.message);
      case 'ENV_MISSING':
        return new PackageServiceError('NEEDS_INPUT', error.message);
      default:
        return new PackageServiceError('START_FAILED', error.message);
    }
  }
  return new PackageServiceError('UNAVAILABLE');
};

export const createPackageServiceControl = (deps: PackageServiceControlDeps): PackageServiceControl => {
  const slots = deps.slots ?? createServiceSlots();
  const entries = new Map<string, Entry>();
  const listeners = new Set<(services: readonly PackageServiceStatus[]) => void>();
  /** The real reason a start failed: the supervisor only reports a generic code. */
  const failures = new Map<string, unknown>();

  const statusOf = (entry: Entry): PackageServiceStatus => {
    const services = entry.endpoint?.services() ?? [];
    const broken = services.some((service) => service.state === 'error');
    const everyReady = services.length > 0 && services.every((service) => service.state === 'ready');
    const state: PackageServiceState =
      entry.phase === 'failed' || broken ? 'error' : entry.phase === 'running' && everyReady ? 'running' : 'starting';
    const error = entry.failure ?? (broken ? entry.lastEvent : undefined);
    return {
      packageId: entry.ref.packageId,
      connectionId: entry.ref.connectionId,
      title: entry.title,
      state,
      services,
      ...(error === undefined ? {} : { error }),
    };
  };

  const list = (): readonly PackageServiceStatus[] => [...entries.values()].map(statusOf);

  const changed = (): void => {
    if (listeners.size === 0) return;
    const snapshot = list();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        // A broken subscriber must never affect the services.
      }
    }
  };

  const findEnabled = async (request: PackageServiceRef): Promise<EnabledConnection> => {
    const key = `service:${request.connectionId}`;
    const found = (await deps.registry.enabledOfKind('service')).find(
      (candidate) => candidate.packageId === request.packageId && candidate.key === key
    );
    if (found === undefined) throw new PackageServiceError('NOT_ENABLED');
    return found;
  };

  /** The approval hash the person gave, only when what would run today still hashes to it. */
  const approvedHash = async (found: EnabledConnection): Promise<string> => {
    const view = (await deps.registry.view(found.packageId)).find((candidate) => candidate.key === found.key);
    const approved = view?.state.approvalHash;
    if (view === undefined || !view.state.enabled || approved === undefined)
      throw new PackageServiceError('NOT_ENABLED');
    const current = await deps.registry.describe(found.packageId, found.key);
    if (current.approvalHash !== approved) throw new PackageServiceError('NEEDS_APPROVAL');
    return approved;
  };

  const requestOf = (binding: PackagePersistentContributionBinding): PackageServiceRef | undefined =>
    binding.contributionId.startsWith(CONTRIBUTION_PREFIX)
      ? { packageId: binding.surface.packageId, connectionId: binding.contributionId.slice(CONTRIBUTION_PREFIX.length) }
      : undefined;

  /** The programs of the exact connection that was bound, read from Main's own copy of the package. */
  const specOf = async (request: PackageServiceRef, approvalHash: string): Promise<RepoProcessSpec | undefined> => {
    const found = await findEnabled(request);
    const connection = found.connection;
    if (connection.kind !== 'service') return undefined;
    return {
      packageDirectory: found.context.packageDirectory,
      approvalHash,
      services: connection.process.services.map((service) => ({
        id: service.id,
        cwd: service.cwd,
        setup: service.setup,
        start: service.start,
        ready: service.ready === undefined ? undefined : { port: service.ready.port },
        env: service.env?.map((item) => ({ name: item.name, required: item.required })),
      })),
    };
  };

  const onEvent = (request: PackageServiceRef, event: RepoProcessEvent): void => {
    const entry = entries.get(keyOf(request));
    if (entry !== undefined && event.state === 'error') {
      entry.lastEvent = { code: event.code ?? 'ERROR', message: short(event.message ?? 'The program stopped.') };
    }
    changed();
  };

  const supervisor = createPackagePersistentContributionSupervisor({
    isBindingActive: async (binding) => {
      const request = requestOf(binding);
      if (request === undefined) return false;
      try {
        const found = await findEnabled(request);
        const hash = await approvedHash(found);
        return found.packageVersion === binding.surface.packageVersion && hash === binding.artifactIntegrity;
      } catch {
        return false;
      }
    },
    createEndpoint: async (binding, signal) => {
      const request = requestOf(binding);
      if (request === undefined) return undefined;
      const key = keyOf(request);
      try {
        const spec = await specOf(request, binding.artifactIntegrity);
        if (spec === undefined) return undefined;
        const endpoint = await startRepoProcessEndpoint(
          {
            ports: deps.portsFor({
              packageId: binding.surface.packageId,
              packageVersion: binding.surface.packageVersion,
              connectionId: request.connectionId,
              approvalHash: binding.artifactIntegrity,
            }),
            slots,
            ...deps.timing,
            onEvent: (event) => onEvent(request, event),
          },
          spec,
          signal
        );
        const entry = entries.get(key);
        if (entry !== undefined) entry.endpoint = endpoint;
        return endpoint;
      } catch (error) {
        failures.set(key, error);
        throw error;
      }
    },
    recordEvidence: deps.recordEvidence,
  });

  /** Stops one service and forgets that it ran. Keeps nothing for a service the person stopped. */
  const halt = async (request: PackageServiceRef): Promise<void> => {
    const key = keyOf(request);
    const entry = entries.get(key);
    entries.delete(key);
    if (entry !== undefined) await supervisor.invalidate(entry.binding.surface, entry.binding.contributionId);
    changed();
  };

  const start = async (request: PackageServiceRef): Promise<PackageServiceStatus> => {
    const key = keyOf(request);
    try {
      const found = await findEnabled(request);
      const approvalHash = await approvedHash(found);
      const connection = found.connection;
      if (connection.kind !== 'service') throw new PackageServiceError('UNAVAILABLE');

      const existing = entries.get(key);
      // A program that gave up restarting, or a start that failed, is dead for good: start over.
      if (existing !== undefined && (existing.phase === 'failed' || statusOf(existing).state === 'error')) {
        await halt(request);
      }
      const binding: PackagePersistentContributionBinding = {
        surface: { packageId: found.packageId, packageVersion: found.packageVersion, publisherId: PUBLISHER_ID },
        contributionId: `${CONTRIBUTION_PREFIX}${request.connectionId}`,
        artifactIntegrity: approvalHash,
      };
      const entry: Entry = entries.get(key) ?? { ref: request, title: connection.title, binding, phase: 'starting' };
      entry.binding = binding;
      entries.set(key, entry);
      failures.delete(key);
      changed();
      try {
        await supervisor.activate(binding);
      } catch (error) {
        const cause = failures.get(key) ?? error;
        failures.delete(key);
        const failed = failureOf(cause);
        // Keep the row so the Active sidebar can say why it did not start; `stop` removes it.
        entry.phase = 'failed';
        entry.failure = { code: failed.code, message: short(failed.message) };
        delete entry.endpoint;
        changed();
        throw cause;
      }
      entry.phase = 'running';
      delete entry.failure;
      changed();
      return statusOf(entry);
    } catch (error) {
      throw failureOf(error);
    }
  };

  return {
    start,
    stop: async (request) => {
      await halt(request);
      try {
        await deps.clearSetup?.(request.packageId, request.connectionId);
      } catch {
        // A marker that cannot be cleared only means setup is skipped next time; never fail a switch-off for it.
      }
    },
    reconcile: async (keep) => {
      for (const entry of entries.values()) {
        if (!keep.has(`${entry.ref.packageId}${KEY_SEPARATOR}service:${entry.ref.connectionId}`)) {
          // oxlint-disable-next-line no-await-in-loop -- stop one service at a time
          await halt(entry.ref);
        }
      }
    },
    list,
    logs: (request, serviceId) => entries.get(keyOf(request))?.endpoint?.logs(serviceId) ?? [],
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: async () => {
      entries.clear();
      await supervisor.dispose();
      changed();
    },
  };
};
