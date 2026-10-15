/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runs and opens the `web-embed` apps (docs/platform/repotopackage-design.md sections 10.9, 13, 15.1).
 *
 * - Turning the connection on only approves it. Nothing runs until the person opens the app, and nothing starts when
 *   the Hub starts. `launch` is the one entry: it re-reads the connection from Main's own copy of the package,
 *   requires it to be enabled with an approval that still matches what would run, and answers with the address and the
 *   origins the tab may stay on.
 * - A `url` app needs no process. A `process` app is started by `RepoProcessEndpoint` under a
 *   `PersistentContributionSupervisor`, bound to the exact package, version, connection and approval hash; an update that
 *   changes what would run no longer matches, so the old process is replaced or refused.
 * - The environment of a service comes from the package secret store, read here in Main; the setup markers are scoped
 *   to package, connection and version.
 * - Nothing here takes a path, an address, a command or a session name from a caller.
 */

import type { PackageSecretPort } from '@process/resources/packageSecrets/packageSecretPort';
import {
  createPackagePersistentContributionSupervisor,
  type PackagePersistentContributionBinding,
  type PackagePersistentContributionEvidence,
} from '@process/resources/packageProcessRuntime/persistentContributionSupervisor';
import type { ConnectionRegistry, EnabledConnection } from '@process/integrations/connections/core/registry';
import {
  WebEmbedError,
  webEmbedAllowedOrigins,
  loopbackPolicyOf,
  webEmbedStartUrl,
  webEmbedUrlProblem,
  type OpenAppRequest,
  type WebEmbedConnection,
} from '@/common/integrations/webEmbed/webEmbed';
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

/** Namespace of the supervisor slot; the package identity itself is `packageId` + `packageVersion`. */
const PUBLISHER_ID = 'connection-host';
const CONTRIBUTION_PREFIX = 'web-embed.';
const KEY_SEPARATOR = '\u0000';

/** What the runtime knows about one running connection when it builds the ports for it. */
export type WebEmbedProcessScope = Readonly<{
  packageId: string;
  packageVersion: string;
  connectionId: string;
  approvalHash: string;
}>;

/** What a caller learns from `launch`; the address and origins are Main's, never the renderer's. */
export type WebEmbedLaunch = Readonly<{
  title: string;
  url: string;
  allowedOrigins: readonly string[];
}>;

export type WebEmbedAppService = Readonly<{
  launch: (request: OpenAppRequest) => Promise<WebEmbedLaunch>;
  /** Stops the processes of an app and forgets its setup markers. Idempotent. */
  stop: (request: OpenAppRequest) => Promise<void>;
  /** Stops every running app that is not in `keep` (`${packageId}\u0000web-embed:${connectionId}`). */
  reconcile: (keep: ReadonlySet<string>) => Promise<void>;
  services: (request: OpenAppRequest) => readonly RepoProcessServiceStatus[];
  /** Redacted output of one service (ring buffer of the process runtime). */
  logs: (request: OpenAppRequest, serviceId: string) => readonly RepoProcessLogLine[];
  dispose: () => Promise<void>;
}>;

export type WebEmbedAppServiceDeps = Readonly<{
  registry: Pick<ConnectionRegistry, 'view' | 'describe' | 'enabledOfKind'>;
  /** The operating-system ports for one running connection (spawn, kill, sockets, secrets, markers). */
  portsFor: (scope: WebEmbedProcessScope) => RepoProcessPorts;
  recordEvidence: (evidence: PackagePersistentContributionEvidence) => Promise<void>;
  /** Forgets the setup markers of a connection (called when it is stopped). */
  clearSetup?: (packageId: string, connectionId: string) => Promise<void>;
  /** App-wide counter of running services (v1 limit 6). */
  slots?: ServiceSlots;
  onEvent?: (request: OpenAppRequest, event: RepoProcessEvent) => void;
  /** Timing knobs of the process runtime; tests shorten them. */
  timing?: Pick<RepoProcessDependencies, 'readyTimeoutMs' | 'stopGraceMs' | 'setupTimeoutMs' | 'pollMs' | 'restart'>;
}>;

/**
 * Reads one named value from the package secret store: a set of the package's own first, then a granted one. Returns
 * `undefined` when no set holds it or reading is refused. The value is returned to the process runtime only.
 */
export const resolvePackageSecret = async (
  port: Pick<PackageSecretPort, 'list' | 'resolve'>,
  name: string
): Promise<string | undefined> => {
  const sets = (await port.list()).filter((set) => set.fields.includes(name));
  const ordered = [...sets.filter((set) => set.origin === 'own'), ...sets.filter((set) => set.origin !== 'own')];
  for (const set of ordered) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- a few sets at most, tried in order
      const value = (await port.resolve(set.handle, [name]))[name];
      if (typeof value === 'string' && value !== '') return value;
    } catch {
      // Access refused or the set vanished: try the next one.
    }
  }
  return undefined;
};

const referenceKey = (request: OpenAppRequest): string => `${request.packageId}${KEY_SEPARATOR}${request.connectionId}`;

const failureOf = (error: unknown): WebEmbedError => {
  if (error instanceof WebEmbedError) return error;
  if (error instanceof RepoProcessError) {
    switch (error.code) {
      case 'PORT_IN_USE':
        return new WebEmbedError('PORT_IN_USE', error.message);
      case 'SERVICE_LIMIT':
        return new WebEmbedError('LIMIT_REACHED', error.message);
      case 'ENV_MISSING':
        return new WebEmbedError('NEEDS_INPUT', error.message);
      default:
        return new WebEmbedError('START_FAILED', error.message);
    }
  }
  return new WebEmbedError('UNAVAILABLE');
};

export const createWebEmbedAppService = (deps: WebEmbedAppServiceDeps): WebEmbedAppService => {
  const slots = deps.slots ?? createServiceSlots();
  /** Bound when a launch begins, so `stop` also reaches a start that has not finished. */
  const bindings = new Map<string, PackagePersistentContributionBinding>();
  const endpoints = new Map<string, RepoProcessEndpoint>();
  /** The real reason a start failed: the supervisor only reports a generic code. */
  const failures = new Map<string, unknown>();

  const requestOf = (binding: PackagePersistentContributionBinding): OpenAppRequest | undefined =>
    binding.contributionId.startsWith(CONTRIBUTION_PREFIX)
      ? {
          packageId: binding.surface.packageId,
          connectionId: binding.contributionId.slice(CONTRIBUTION_PREFIX.length),
        }
      : undefined;

  const findEnabled = async (request: OpenAppRequest): Promise<EnabledConnection> => {
    const key = `web-embed:${request.connectionId}`;
    const found = (await deps.registry.enabledOfKind('web-embed')).find(
      (candidate) => candidate.packageId === request.packageId && candidate.key === key
    );
    if (found === undefined) throw new WebEmbedError('NOT_ENABLED');
    return found;
  };

  /** The approval hash the person gave, only when what would run today still hashes to it. */
  const approvedHash = async (found: EnabledConnection): Promise<string> => {
    const view = (await deps.registry.view(found.packageId)).find((candidate) => candidate.key === found.key);
    const approved = view?.state.approvalHash;
    if (view === undefined || !view.state.enabled || approved === undefined) throw new WebEmbedError('NOT_ENABLED');
    const current = await deps.registry.describe(found.packageId, found.key);
    if (current.approvalHash !== approved) throw new WebEmbedError('NEEDS_APPROVAL');
    return approved;
  };

  /** The services of the exact connection that was bound, read from Main's own copy of the package. */
  const specOf = async (request: OpenAppRequest, approvalHash: string): Promise<RepoProcessSpec | undefined> => {
    const found = await findEnabled(request);
    const connection = found.connection as WebEmbedConnection;
    if (connection.process === undefined) return undefined;
    return {
      packageDirectory: found.context.packageDirectory,
      approvalHash,
      services: connection.process.services.map((service) => ({
        id: service.id,
        cwd: service.cwd,
        setup: service.setup,
        start: service.start,
        ready: { port: service.ready.port },
        env: service.env?.map((item) => ({ name: item.name, required: item.required })),
      })),
    };
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
      const key = referenceKey(request);
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
            onEvent: (event) => deps.onEvent?.(request, event),
          },
          spec,
          signal
        );
        endpoints.set(key, endpoint);
        return endpoint;
      } catch (error) {
        failures.set(key, error);
        throw error;
      }
    },
    recordEvidence: deps.recordEvidence,
  });

  const halt = async (request: OpenAppRequest): Promise<void> => {
    const key = referenceKey(request);
    const binding = bindings.get(key);
    bindings.delete(key);
    endpoints.delete(key);
    if (binding !== undefined) await supervisor.invalidate(binding.surface, binding.contributionId);
  };

  const launch = async (request: OpenAppRequest): Promise<WebEmbedLaunch> => {
    try {
      const found = await findEnabled(request);
      const approvalHash = await approvedHash(found);
      const connection = found.connection as WebEmbedConnection;
      const url = webEmbedStartUrl(connection);
      if (url === undefined) throw new WebEmbedError('UNAVAILABLE');
      if (connection.process === undefined) {
        // A url app is checked again at open time, not only when the connection was turned on.
        const problem = webEmbedUrlProblem(url, loopbackPolicyOf(found.context));
        if (problem !== undefined) throw new WebEmbedError('START_FAILED', problem);
      }
      const result: WebEmbedLaunch = {
        title: connection.title,
        url,
        allowedOrigins: webEmbedAllowedOrigins(connection),
      };
      if (connection.process === undefined) return result;

      const key = referenceKey(request);
      // A service that gave up restarting is dead for good; start over instead of showing a dead page.
      if (
        endpoints
          .get(key)
          ?.services()
          .some((service) => service.state === 'error') === true
      )
        await halt(request);
      const binding: PackagePersistentContributionBinding = {
        surface: { packageId: found.packageId, packageVersion: found.packageVersion, publisherId: PUBLISHER_ID },
        contributionId: `${CONTRIBUTION_PREFIX}${request.connectionId}`,
        artifactIntegrity: approvalHash,
      };
      bindings.set(key, binding);
      failures.delete(key);
      try {
        await supervisor.activate(binding);
      } catch (error) {
        const cause = failures.get(key) ?? error;
        failures.delete(key);
        bindings.delete(key);
        endpoints.delete(key);
        throw cause;
      }
      return result;
    } catch (error) {
      throw failureOf(error);
    }
  };

  return {
    launch,
    stop: async (request) => {
      await halt(request);
      try {
        await deps.clearSetup?.(request.packageId, request.connectionId);
      } catch {
        // A marker that cannot be cleared only means setup is skipped next time; never fail a switch-off for it.
      }
    },
    reconcile: async (keep) => {
      for (const binding of bindings.values()) {
        const request = requestOf(binding);
        if (request === undefined) continue;
        if (!keep.has(`${request.packageId}${KEY_SEPARATOR}web-embed:${request.connectionId}`)) {
          // oxlint-disable-next-line no-await-in-loop -- stop one app at a time
          await halt(request);
        }
      }
    },
    services: (request) => endpoints.get(referenceKey(request))?.services() ?? [],
    logs: (request, serviceId) => endpoints.get(referenceKey(request))?.logs(serviceId) ?? [],
    dispose: async () => {
      bindings.clear();
      endpoints.clear();
      await supervisor.dispose();
    },
  };
};
