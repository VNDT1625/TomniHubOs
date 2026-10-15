/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds the one `ConnectionRegistry` of the application (docs/platform/repotopackage-design.md sections 9.3-9.5)
 * on top of the package manager: where an installed package lives on disk, which packages are installed, and the
 * JSON file that remembers what the person turned on (`<userData>/connections.json`).
 *
 * - The registry is usable at once; every call waits for the state file to be read first.
 * - `start()` runs after the package manager is initialized: it drops connections of packages that are gone and
 *   turns off the ones whose content changed. A failure here is logged and never stops the application.
 * - `follow()` keeps the registry in step with the package manager: installed or updated -> `syncPackage`;
 *   quarantined -> `removePackage`; uninstalled (`available`) -> `removePackage` and then `reconcile`, so each host
 *   removes what it installed for that package. Nothing is read from disk while a package is `uninstalling`: on
 *   Windows an open handle on the package folder makes the package manager's own rename fail. It never throws into
 *   the package manager.
 * - `defaultHosts` lists the per-kind hosts that exist (now `mcp`, `hook`, `extension`, `web-embed`, `service`, `rules`, `knowledge`, `cli` and `tool`); a kind
 *   without a host is recorded as unsupported with the reason, and nothing of it can be switched on.
 * - `apps` opens and stops the `web-embed` apps. It also supplies what the process runtime needs from Main: where a
 *   service's variables come from (the package secret store) and where "setup already ran" is remembered
 *   (`connection-setup-markers.json`, next to the state file). Its lifecycle evidence goes to
 *   `connection-process-evidence.jsonl`. `dispose()` stops every process an app started; call it when the app quits.
 * - `services` starts and stops `service` connections (only on the explicit Start, never at startup; the 6-program limit is
 *   shared with the web apps) and tells the Active sidebar what runs. `rules` keeps which rules are attached to which
 *   workspace and builds the rules block of the context composer; `knowledge` is the index `tomny_library_search`
 *   searches. Both are Main-internal ports (`packageContext/agentPorts.ts` registers them with the agent runtime).
 * - An extension that was on but cannot be loaded again at startup is recorded as `error` with its reason (it is
 *   turned off, so the person sees why and can enable it again).
 */

import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { ADAPTER_FILE, adapterFromManifest, readAdapterDocument } from '@/common/packages/adapter';
import type { PackageManagerService } from '@process/extensions/package-manager/PackageManagerService';
import {
  createConnectionRegistry,
  type ConnectionRegistry,
  type EnabledConnection,
  type LoadedPackage,
} from '@process/integrations/connections/core/registry';
import { missingPackageEnv } from '@process/integrations/connections/core/envValues';
import { getRuntimeProbe } from '@process/integrations/connections/core/runtimeProbe';
import { createJsonConnectionStateStore } from '@process/integrations/connections/core/state';
import type { AnyConnectionHost } from '@process/integrations/connections/core/types';
import { createAgentHost } from '@process/integrations/connections/hosts/data/agentHost';
import { createCommandHost } from '@process/integrations/connections/hosts/data/commandHost';
import { createKnowledgeHost } from '@process/integrations/connections/hosts/data/knowledgeHost';
import { createRulesHost, type RulesHostControl } from '@process/integrations/connections/hosts/data/rulesHost';
import { createSkillHost } from '@process/integrations/connections/hosts/data/skillHost';
import { createCliHosts } from '@process/integrations/connections/hosts/exec/cliHost';
import { createExtensionHost } from '@process/integrations/connections/hosts/exec/extensionHost';
import { createHookHost } from '@process/integrations/connections/hosts/exec/hookHost';
import { createMcpHost } from '@process/integrations/connections/hosts/exec/mcpHost';
import { createLauncherHost } from '@process/integrations/connections/hosts/exec/launcherHost';
import {
  createServiceHost,
  type PackageServiceProcessControl,
} from '@process/integrations/connections/hosts/exec/serviceHost';
import {
  createWebEmbedHost,
  type ProgramProbe,
  type WebEmbedProcessControl,
} from '@process/integrations/connections/hosts/exec/webEmbedHost';
import { createKnowledgeIndex, type KnowledgeIndexPort } from '@process/integrations/packageContext/knowledgeIndex';
import { createRulesService, type RulesService } from '@process/integrations/packageContext/rulesService';
import { createNodeRepoProcessPorts } from '@process/integrations/runtime/repoProcessNodePorts';
import { createNativeInstalledAppProbe } from '@process/integrations/runtime/installedAppProbe';
import { createLauncherBindings } from '@process/integrations/runtime/launcherBindings';
import {
  createServiceSlots,
  type RepoProcessPorts,
  type ServiceSlots,
} from '@process/integrations/runtime/repoProcessPorts';
import { createEvidenceFileSink, createJsonSetupMarkerStore } from '@process/integrations/runtime/repoProcessStores';
import { createPackageServiceControl, type PackageServiceControl } from '@process/integrations/runtime/packageServices';
import {
  createWebEmbedAppService,
  resolvePackageSecret,
  type WebEmbedAppService,
  type WebEmbedProcessScope,
} from '@process/integrations/runtime/webEmbedApps';
import type { PackagePersistentContributionEvidence } from '@process/resources/packageProcessRuntime/persistentContributionSupervisor';
import { getPackageSecretPort } from '@process/resources/packageSecrets/packageSecretPort';

const PACKAGE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const MAX_ADAPTER_BYTES = 2 * 1024 * 1024;
const KNOWLEDGE_READER_CACHE_MS = 1_000;

export type ConnectionRuntimeDeps = Readonly<{
  /** `<userData>/connections.json`. */
  stateFile: string;
  /** The package manager's root (`<userData>/tomny-packages`); installed packages are under `packages/<id>/<version>`. */
  packagesRoot: string;
  packages: Pick<PackageManagerService, 'status' | 'list' | 'onStateChanged'>;
  /** Hosts added to the built-in ones; a host here replaces the built-in one of the same kind. */
  hosts?: readonly AnyConnectionHost[];
  /** The built-in hosts. Defaults to every host the application ships; tests pass `[]` to run without any. */
  builtinHosts?: readonly AnyConnectionHost[];
  /** The process runtime of `web-embed` apps. Every field has a production default; tests replace them. */
  webEmbed?: Readonly<{
    /** Whether a program can run here. Defaults to the shared runtime probe (`core/runtimeProbe.ts`). */
    programProbe?: ProgramProbe;
    /** Spawn, kill, sockets, secrets and setup markers of one running app. */
    portsFor?: (scope: WebEmbedProcessScope) => RepoProcessPorts;
    recordEvidence?: (evidence: PackagePersistentContributionEvidence) => Promise<void>;
    slots?: ServiceSlots;
  }>;
  log?: (message: string, error: unknown) => void;
}>;

export type ConnectionRuntime = Readonly<{
  registry: ConnectionRegistry;
  /** Main's own read of an installed package (adapter included). Used by the read-only Store update check (S1). */
  loadPackage: (packageId: string) => Promise<LoadedPackage | undefined>;
  /**
   * Call once the package manager is initialized. Resolves in every case, with the packages that have a start-again code
   * connection waiting for the person's approval (registry.startApprovalNeeded). Nothing is asked here.
   */
  start: () => Promise<readonly string[]>;
  /** Subscribes to package state changes. Returns the unsubscribe function. */
  follow: () => () => void;
  /** Opens and stops `web-embed` apps. Main-internal: the renderer reaches it only through the Browser bridge. */
  apps: WebEmbedAppService;
  /**
   * Starts and stops `service` connections (the explicit Start, never at Hub startup) and tells the Active sidebar
   * (S17) what runs. Main-internal: a renderer reaches it only through an IPC the Integrator adds.
   */
  services: PackageServiceControl;
  /** Rules that packages offer and the workspaces they are attached to (Library, S11; the context composer reads it). */
  rules: RulesService;
  /** The searchable index of documents that `knowledge` connections brought (`tomny_library_search`). */
  knowledge: KnowledgeIndexPort;
  /** Stops every process an app or a service started. Resolves in every case. */
  dispose: () => Promise<void>;
}>;

/** The hosts the application ships. Add a kind here when its host exists (design section 18.5). */
const defaultHosts = (
  onExtensionLoadError: (packageId: string, connectionId: string, reason: string) => Promise<void>,
  webEmbed: Readonly<{ programProbe?: ProgramProbe; control: WebEmbedProcessControl }>,
  enabledHooks: () => Promise<readonly EnabledConnection[]>,
  service: Readonly<{ programProbe?: ProgramProbe; control: PackageServiceProcessControl }>,
  data: Readonly<{
    knowledge: KnowledgeIndexPort;
    enabledKnowledge: () => Promise<readonly EnabledConnection[]>;
    rules: RulesHostControl;
  }>
): readonly AnyConnectionHost[] => [
  createMcpHost(),
  createLauncherHost(),
  // Registers the package's hooks in the Hub hook registry; the registry (not the host) decides when one runs.
  createHookHost({ enabledHooks }),
  createExtensionHost({ onLoadError: onExtensionLoadError }),
  createWebEmbedHost({
    control: webEmbed.control,
    // The shared runtime probe (60 second cache, readable reasons) unless the caller supplies its own.
    programProbe: webEmbed.programProbe ?? ((program) => getRuntimeProbe().programProbe(program)),
  }),
  // Approval only; the program starts when the person presses Start (`services`), never with the Hub.
  createServiceHost({
    control: service.control,
    programProbe: service.programProbe ?? ((program) => getRuntimeProbe().programProbe(program)),
  }),
  // Data kinds: nothing runs. Package-owned skills and assistants cannot overwrite user content.
  createSkillHost({
    catalog: async () =>
      (await import('@process/resources/nativePlatform/capabilityBridge')).createNativeSkillCatalog(),
  }),
  createAgentHost({
    catalog: async () => (await import('@process/resources/agentCatalogBridge')).getNativeAssistantCatalog(),
  }),
  createCommandHost(),
  createRulesHost({ control: data.rules }),
  createKnowledgeHost({ library: data.knowledge, enabledKnowledge: data.enabledKnowledge }),
  ...createCliHosts(),
];

const isMissing = (error: unknown): boolean => (error as { code?: string }).code === 'ENOENT';

/** Setup markers of a service live apart from those of a web app: their connection ids may be equal. */
const serviceMarkerId = (connectionId: string): string => `service:${connectionId}`;

/** A setup belongs to one extracted folder: package, connection and version (the version is appended). */
const setupScope = (packageId: string, connectionId: string): string => `${packageId}|${connectionId}|`;

export const createConnectionRuntime = (deps: ConnectionRuntimeDeps): ConnectionRuntime => {
  const log = deps.log ?? ((message: string, error: unknown) => console.error(`[Connections] ${message}`, error));
  const store = createJsonConnectionStateStore(deps.stateFile);
  // A store that cannot be read behaves as an empty one (fails closed), so readiness never rejects.
  const stateReady = store.initialize().catch((error: unknown) => log('Could not read connection state.', error));

  /** Reads the adapter of an installed package from Main's own copy; never from a path a caller supplies. */
  const loadPackage = async (packageId: string): Promise<LoadedPackage | undefined> => {
    if (!PACKAGE_ID.test(packageId)) return undefined;
    let listing: Awaited<ReturnType<PackageManagerService['status']>>;
    try {
      listing = await deps.packages.status(packageId);
    } catch {
      return undefined;
    }
    const version = listing.installedVersion;
    if (!version || !SAFE_VERSION.test(version) || listing.state !== 'installed') return undefined;
    const root = await realpath(path.join(deps.packagesRoot, 'packages')).catch((): undefined => undefined);
    if (root === undefined) return undefined;
    const packageDirectory = path.join(root, packageId, version);
    const resolved = await realpath(packageDirectory).catch((): undefined => undefined);
    if (resolved === undefined || path.relative(root, resolved).startsWith('..')) return undefined;

    let adapter: LoadedPackage['adapter'];
    const adapterPath = path.join(resolved, ...ADAPTER_FILE.split('/'));
    try {
      const info = await stat(adapterPath);
      if (!info.isFile() || info.size > MAX_ADAPTER_BYTES) {
        adapter = readAdapterDocument(null).document;
      } else {
        let raw: unknown = null;
        try {
          raw = JSON.parse(await readFile(adapterPath, 'utf8'));
        } catch {
          raw = null;
        }
        adapter = readAdapterDocument(raw, { trust: listing.trust }).document;
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
      // A package built before the standard layout: its MCP contributions become connections.
      adapter = adapterFromManifest(listing.installedManifest ?? listing.manifest);
    }
    // `listing.trust` is the catalog entry's tier; the installed record's tier is the one that counts.
    return {
      packageId,
      packageVersion: version,
      packageDirectory: resolved,
      adapter,
      ...(listing.installedTrust === undefined ? {} : { trust: listing.installedTrust }),
    };
  };

  const listInstalledPackageIds = async (): Promise<readonly string[]> =>
    (await deps.packages.list({ installedOnly: true })).map((listing) => listing.manifest.id);

  /** Preserve a linked executable when its connection is simply off, but remove it on package uninstall. */
  const pruneLauncherBindings = async (): Promise<void> => {
    const keep = new Set<string>();
    for (const packageId of await listInstalledPackageIds()) {
      // oxlint-disable-next-line no-await-in-loop -- only installed packages; fail closed without erasing user links
      const loaded = await loadPackage(packageId);
      if (!loaded) return;
      for (const connection of loaded.adapter.connections) {
        if (connection.kind === 'launcher') keep.add(`${packageId}:launcher:${connection.id}`);
      }
    }
    const bindings = createLauncherBindings(
      path.join(path.dirname(deps.stateFile), 'launcher-bindings.json'),
      createNativeInstalledAppProbe()
    );
    await bindings.reconcile(keep);
  };

  /** Startup reload of an enabled extension failed: record it as an error (and off) so the reason is shown. */
  const recordExtensionLoadError = async (packageId: string, connectionId: string, reason: string): Promise<void> => {
    await stateReady;
    const connectionKey = `extension:${connectionId}`;
    const current = store.get(packageId, connectionKey);
    if (!current) return;
    await store.save({
      packageId,
      packageVersion: current.packageVersion,
      connectionKey,
      enabled: false,
      status: 'error',
      ...(current.autoStart === true ? { autoStart: true } : {}),
      lastError: reason.slice(0, 500),
    });
  };

  // The host stops apps through the service, and the service reads the registry the host belongs to: bound after both exist.
  let webEmbedApps: WebEmbedAppService | undefined;
  const webEmbedControl: WebEmbedProcessControl = {
    stop: (request) => webEmbedApps?.stop(request) ?? Promise.resolve(),
    reconcile: (keep) => webEmbedApps?.reconcile(keep) ?? Promise.resolve(),
  };
  let packageServices: PackageServiceControl | undefined;
  const serviceControl: PackageServiceProcessControl = {
    stop: (request) => packageServices?.stop(request) ?? Promise.resolve(),
    reconcile: (keep) => packageServices?.reconcile(keep) ?? Promise.resolve(),
  };
  /** One counter for apps and services together: the v1 limit of 6 programs is app-wide. */
  const slots = deps.webEmbed?.slots ?? createServiceSlots();
  const dataDirectory = path.dirname(deps.stateFile);
  // Both read the registry that is built below, but only when called, never while it is being built.
  const lazyRegistry: Pick<ConnectionRegistry, 'view' | 'enabledOfKind'> = {
    view: (packageId) => registry.view(packageId),
    enabledOfKind: (kind) => registry.enabledOfKind(kind),
  };
  const rules = createRulesService({
    registry: lazyRegistry,
    file: path.join(dataDirectory, 'rules-attachments.json'),
  });
  /** One search reads many documents of the same connections: the list of what is on is reused for a moment. */
  let enabledKnowledgeCache: Readonly<{ at: number; items: Promise<readonly EnabledConnection[]> }> | undefined;
  const enabledKnowledge = (): Promise<readonly EnabledConnection[]> => {
    const at = Date.now();
    if (enabledKnowledgeCache === undefined || at - enabledKnowledgeCache.at > KNOWLEDGE_READER_CACHE_MS) {
      enabledKnowledgeCache = { at, items: registry.enabledOfKind('knowledge') };
    }
    return enabledKnowledgeCache.items;
  };
  const knowledge = createKnowledgeIndex({
    file: path.join(dataDirectory, 'knowledge-index.json'),
    // The registry's guarded reader (no traversal, no symlink out of the package), and only a path the connection lists.
    readText: async (owner, documentPath) => {
      const found = (await enabledKnowledge()).find(
        (item) => item.packageId === owner.packageId && item.key === `knowledge:${owner.collectionId}`
      );
      if (
        found === undefined ||
        found.connection.kind !== 'knowledge' ||
        !found.connection.paths.includes(documentPath)
      ) {
        return undefined;
      }
      return (await found.context.readPackageFile(documentPath)).toString('utf8');
    },
  });
  const setupMarkers = createJsonSetupMarkerStore(path.join(dataDirectory, 'connection-setup-markers.json'));

  const inner = createConnectionRegistry({
    store,
    hosts: [
      ...(
        deps.builtinHosts ??
        defaultHosts(
          recordExtensionLoadError,
          {
            control: webEmbedControl,
            ...(deps.webEmbed?.programProbe === undefined ? {} : { programProbe: deps.webEmbed.programProbe }),
          },
          () => registry.enabledOfKind('hook'),
          {
            control: serviceControl,
            ...(deps.webEmbed?.programProbe === undefined ? {} : { programProbe: deps.webEmbed.programProbe }),
          },
          {
            knowledge,
            enabledKnowledge: () => registry.enabledOfKind('knowledge'),
            rules: { prune: () => rules.prune() },
          }
        )
      ).filter((host) => !(deps.hosts ?? []).some((other) => other.kind === host.kind)),
      ...(deps.hosts ?? []),
    ],
    loadPackage,
    listInstalledPackageIds,
    missingRequiredEnv: (packageId, names) => missingPackageEnv(getPackageSecretPort(packageId), names),
  });

  /** Every public call first waits for the state file. */
  const registry: ConnectionRegistry = {
    syncPackage: async (packageId) => {
      await stateReady;
      return inner.syncPackage(packageId);
    },
    view: async (packageId) => {
      await stateReady;
      return inner.view(packageId);
    },
    describe: async (packageId, key) => {
      await stateReady;
      return inner.describe(packageId, key);
    },
    enable: async (packageId, key, approvalHash) => {
      await stateReady;
      return inner.enable(packageId, key, approvalHash);
    },
    disable: async (packageId, key) => {
      await stateReady;
      return inner.disable(packageId, key);
    },
    removePackage: async (packageId) => {
      await stateReady;
      return inner.removePackage(packageId);
    },
    enabledOfKind: async (kind) => {
      await stateReady;
      return inner.enabledOfKind(kind);
    },
    setAutoStart: async (packageId, key, value) => {
      await stateReady;
      return inner.setAutoStart(packageId, key, value);
    },
    startApprovalNeeded: async () => {
      await stateReady;
      return inner.startApprovalNeeded();
    },
    reconcile: async () => {
      await stateReady;
      return inner.reconcile();
    },
  };

  const apps = createWebEmbedAppService({
    registry,
    portsFor:
      deps.webEmbed?.portsFor ??
      ((scope) =>
        createNodeRepoProcessPorts({
          resolveSecret: (name) => resolvePackageSecret(getPackageSecretPort(scope.packageId), name),
          setupMarkers: setupMarkers.scoped(
            `${setupScope(scope.packageId, scope.connectionId)}${scope.packageVersion}|`
          ),
        })),
    recordEvidence:
      deps.webEmbed?.recordEvidence ??
      createEvidenceFileSink(path.join(dataDirectory, 'connection-process-evidence.jsonl')),
    clearSetup: (packageId, connectionId) => setupMarkers.clear(setupScope(packageId, connectionId)),
    slots,
  });
  webEmbedApps = apps;

  const services = createPackageServiceControl({
    registry,
    portsFor:
      deps.webEmbed?.portsFor ??
      ((scope) =>
        createNodeRepoProcessPorts({
          resolveSecret: (name) => resolvePackageSecret(getPackageSecretPort(scope.packageId), name),
          setupMarkers: setupMarkers.scoped(
            `${setupScope(scope.packageId, serviceMarkerId(scope.connectionId))}${scope.packageVersion}|`
          ),
        })),
    recordEvidence:
      deps.webEmbed?.recordEvidence ??
      createEvidenceFileSink(path.join(dataDirectory, 'connection-process-evidence.jsonl')),
    clearSetup: (packageId, connectionId) => setupMarkers.clear(setupScope(packageId, serviceMarkerId(connectionId))),
    slots,
  });
  packageServices = services;

  return {
    registry,
    loadPackage,
    apps,
    services,
    rules,
    knowledge,
    dispose: async () => {
      try {
        await apps.dispose();
      } catch (error) {
        log('Stopping the web apps failed.', error);
      }
      try {
        await services.dispose();
      } catch (error) {
        log('Stopping the services failed.', error);
      }
    },
    start: async () => {
      try {
        await registry.reconcile();
        await pruneLauncherBindings();
      } catch (error) {
        log('Startup reconcile failed.', error);
      }
      return registry.startApprovalNeeded().catch((): readonly string[] => []);
    },
    follow: () =>
      deps.packages.onStateChanged((event) => {
        const task =
          event.state === 'installed'
            ? registry.syncPackage(event.id)
            : event.state === 'quarantined'
              ? registry.removePackage(event.id)
              : event.state === 'available'
                ? registry
                    .removePackage(event.id)
                    .then(() => registry.reconcile())
                    .then(() => pruneLauncherBindings())
                : undefined;
        void task?.catch((error: unknown) => log(`Could not update connections of ${event.id}.`, error));
      }),
  };
};
