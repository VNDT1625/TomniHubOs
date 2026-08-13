/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { ipcBridge } from '@/common';
import {
  PACKAGE_RUNTIME_NATIVE_CHANNELS,
  type PackageRuntimeCloseRequest,
  type PackageRuntimeOpenRequest,
} from '@/common/types/platform/electron';
import {
  DEFAULT_PACKAGE_CATALOG_URL,
  FIRST_PARTY_PACKAGE_CATALOG,
  FIRST_PARTY_PACKAGE_SIGNING_POLICIES,
  FIRST_PARTY_PACKAGE_TRUSTED_KEYS,
  type LinkedMicrosoftAppRecord,
} from '@/common/packages';
import {
  createPackageManagerService,
  type PackageManagerService,
  type PackageSandboxMutationLease,
} from './PackageManagerService';
import {
  createLocalPackageMutationRuntime,
  registerTrustedPackageMutationIpcBridge,
  type PackageMutationRuntime,
  type TrustedPackageMutationIpcHost,
} from './packageHttpApi';
import {
  createPackageAppGroupService,
  registerTrustedPackageAppGroupIpcBridge,
  type PackageAppGroupService,
  type TrustedPackageAppGroupIpcHost,
} from '../package-app-groups';

import {
  createCatalogActionLedger,
  createCatalogFederationBroker,
  createDurableFederatedCatalogCache,
  createMicrosoftStoreCatalogProvider,
  createMicrosoftStoreNativeRuntime,
  createTomniCatalogProvider,
  createWindowsMicrosoftStoreAdapter,
  registerTrustedMicrosoftStoreNativeIpcBridge,
  type CatalogFederationBroker,
  type MicrosoftStoreNativeRuntime,
  type TrustedMicrosoftStoreNativeIpcHost,
} from './catalog-federation';

import { createRemotePackageCatalogLoader } from './remoteCatalog';

// Native actions are fail-closed until a reviewed record is bundled into the
// trusted main-process build. Renderer payloads can only reference these IDs.
const BUNDLED_MICROSOFT_LINKED_APPS: readonly LinkedMicrosoftAppRecord[] = [];

const loadBundledMicrosoftLinkedApp = (linkedAppId: string): LinkedMicrosoftAppRecord | undefined =>
  BUNDLED_MICROSOFT_LINKED_APPS.find((record) => record.id === linkedAppId);

let singleton: PackageManagerService | undefined;
let runtimeRegistrySingleton: PackageRuntimeRegistry | undefined;

let federationSingleton: CatalogFederationBroker | undefined;
let microsoftStoreNativeSingleton: MicrosoftStoreNativeRuntime | undefined;
let unsubscribe: (() => void) | undefined;
let unsubscribeContributions: (() => void) | undefined;
let mutationSingleton: PackageMutationRuntime | undefined;
let disposeMutationIpc: (() => void) | undefined;
let disposeRuntimeIpc: (() => void) | undefined;
let disposeMicrosoftStoreNativeIpc: (() => void) | undefined;
let appGroupSingleton: PackageAppGroupService | undefined;
let disposeAppGroupIpc: (() => void) | undefined;

const resolveDevelopmentArtifactUrl = (artifactUrl: string): string => {
  if (app.isPackaged) return artifactUrl;
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (!rendererUrl) return artifactUrl;
  const filename = new URL(artifactUrl).pathname.split('/').at(-1);
  if (!filename) return artifactUrl;
  return new URL(`/api/packages/artifacts/${encodeURIComponent(filename)}`, rendererUrl).toString();
};

export type PackageRuntimeRegistry = {
  open: (ownerId: string, request: PackageRuntimeOpenRequest) => void;
  close: (ownerId: string, request: PackageRuntimeCloseRequest) => void;
  revokeOwner: (ownerId: string) => void;
  isActive: (packageId: string) => boolean;
  reserveMutation: (packageId: string) => PackageSandboxMutationLease | undefined;
};

/** Tracks active sandboxed-web instances without trusting renderer reference counts. */
export const createPackageRuntimeRegistry = (): PackageRuntimeRegistry => {
  const activeByPackage = new Map<string, Map<string, Set<string>>>();
  const mutationReservations = new Map<string, symbol>();

  const close = (ownerId: string, request: PackageRuntimeCloseRequest): void => {
    const owners = activeByPackage.get(request.packageId);
    const runtimes = owners?.get(ownerId);
    if (!owners || !runtimes) return;
    runtimes.delete(request.runtimeId);
    if (runtimes.size === 0) owners.delete(ownerId);
    if (owners.size === 0) activeByPackage.delete(request.packageId);
  };

  return {
    open: (ownerId, request) => {
      if (mutationReservations.has(request.packageId)) throw new Error('PACKAGE_RUNTIME_MUTATION_ACTIVE');
      const owners = activeByPackage.get(request.packageId) ?? new Map<string, Set<string>>();
      const runtimes = owners.get(ownerId) ?? new Set<string>();
      runtimes.add(request.runtimeId);
      owners.set(ownerId, runtimes);
      activeByPackage.set(request.packageId, owners);
    },
    close,
    revokeOwner: (ownerId) => {
      for (const [packageId, owners] of activeByPackage) {
        owners.delete(ownerId);
        if (owners.size === 0) activeByPackage.delete(packageId);
      }
    },
    isActive: (packageId) => (activeByPackage.get(packageId)?.size ?? 0) > 0,
    reserveMutation: (packageId) => {
      if ((activeByPackage.get(packageId)?.size ?? 0) > 0 || mutationReservations.has(packageId)) return undefined;
      const reservation = Symbol(packageId);
      mutationReservations.set(packageId, reservation);
      let released = false;
      return {
        release: () => {
          if (released) return;
          released = true;
          if (mutationReservations.get(packageId) === reservation) mutationReservations.delete(packageId);
        },
      };
    },
  };
};

const isPackageRuntimeRequest = (value: unknown): value is PackageRuntimeOpenRequest => {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request.packageId === 'string' &&
    request.packageId.length > 0 &&
    request.packageId.length <= 256 &&
    request.packageId === request.packageId.trim() &&
    typeof request.runtimeId === 'string' &&
    request.runtimeId.length > 0 &&
    request.runtimeId.length <= 128 &&
    request.runtimeId === request.runtimeId.trim()
  );
};

export type TrustedPackageRuntimeIpcHost<TSender> = {
  handle: (channel: string, handler: (sender: TSender, payload: unknown) => Promise<void>) => void;
  removeHandler: (channel: string) => void;
};

export const registerTrustedPackageRuntimeIpcBridge = <TSender>(options: {
  host: TrustedPackageRuntimeIpcHost<TSender>;
  registry: PackageRuntimeRegistry;
  verifySender: (sender: TSender) => boolean;
  identifySender: (sender: TSender) => string | undefined;
  subscribeOwnerUnavailable?: (listener: (ownerId: string) => void) => () => void;
}): (() => void) => {
  const invoke =
    (action: 'open' | 'close') =>
    async (sender: TSender, payload: unknown): Promise<void> => {
      if (!options.verifySender(sender)) throw new Error('PACKAGE_RUNTIME_BRIDGE_UNAUTHORIZED');
      if (!isPackageRuntimeRequest(payload)) throw new Error('PACKAGE_RUNTIME_REQUEST_INVALID');
      const ownerId = options.identifySender(sender);
      if (!ownerId) throw new Error('PACKAGE_RUNTIME_OWNER_UNAVAILABLE');
      options.registry[action](ownerId, payload);
    };
  options.host.handle(PACKAGE_RUNTIME_NATIVE_CHANNELS.open, invoke('open'));
  options.host.handle(PACKAGE_RUNTIME_NATIVE_CHANNELS.close, invoke('close'));
  const unsubscribeOwnerUnavailable = options.subscribeOwnerUnavailable?.((ownerId) =>
    options.registry.revokeOwner(ownerId)
  );
  return () => {
    unsubscribeOwnerUnavailable?.();
    options.host.removeHandler(PACKAGE_RUNTIME_NATIVE_CHANNELS.open);
    options.host.removeHandler(PACKAGE_RUNTIME_NATIVE_CHANNELS.close);
  };
};

export const getPackageRuntimeRegistry = (): PackageRuntimeRegistry => {
  runtimeRegistrySingleton ??= createPackageRuntimeRegistry();
  return runtimeRegistrySingleton;
};

export const getPackageManagerService = (): PackageManagerService => {
  const rootDir = path.join(app.getPath('userData'), 'tomny-packages');
  singleton ??= createPackageManagerService({
    rootDir,
    appVersion: app.getVersion(),
    catalog: FIRST_PARTY_PACKAGE_CATALOG,
    trustedKeys: FIRST_PARTY_PACKAGE_TRUSTED_KEYS,
    catalogLoader: createRemotePackageCatalogLoader({
      url: process.env.TOMNI_STORE_CATALOG_URL ?? DEFAULT_PACKAGE_CATALOG_URL,
      cachePath: path.join(rootDir, 'catalog-cache.json'),
      fallbackCatalog: FIRST_PARTY_PACKAGE_CATALOG,
      trustedKeys: FIRST_PARTY_PACKAGE_TRUSTED_KEYS,

      signingPolicies: FIRST_PARTY_PACKAGE_SIGNING_POLICIES,
    }),
    resolveArtifactUrl: resolveDevelopmentArtifactUrl,
    allowLocalArtifactUrls: !app.isPackaged,
    isPackageSandboxActive: (packageId) => getPackageRuntimeRegistry().isActive(packageId),
    reservePackageSandboxMutation: (packageId) => getPackageRuntimeRegistry().reserveMutation(packageId),
  });
  return singleton;
};

const getPackageMutationRuntime = (): PackageMutationRuntime => {
  mutationSingleton ??= createLocalPackageMutationRuntime({
    service: getPackageManagerService(),
    ledgerRootDir: path.join(app.getPath('userData'), 'tomny-packages', 'catalog-action-ledger'),
  });
  return mutationSingleton;
};

const getMicrosoftStoreNativeRuntime = (): MicrosoftStoreNativeRuntime => {
  microsoftStoreNativeSingleton ??= createMicrosoftStoreNativeRuntime({
    adapter: createWindowsMicrosoftStoreAdapter(),
    loadLinkedApp: loadBundledMicrosoftLinkedApp,
    // Consent must originate from a main-owned confirmation surface. Keep the
    // production path closed until that surface is wired; renderer claims never grant it.
    confirmAction: () => false,
  });
  return microsoftStoreNativeSingleton;
};

const getPackageAppGroupService = (): PackageAppGroupService => {
  const filePath = path.join(app.getPath('userData'), 'tomny-state', 'package-app-groups.json');
  appGroupSingleton ??= createPackageAppGroupService({ filePath });
  return appGroupSingleton;
};

const isTrustedPackageMutationSender = (event: IpcMainInvokeEvent): boolean => {
  const sender = event.sender;
  if (sender.isDestroyed() || event.senderFrame !== sender.mainFrame) return false;
  const ownerWindow = BrowserWindow.fromWebContents(sender);
  if (!ownerWindow || ownerWindow.isDestroyed()) return false;

  try {
    const senderUrl = new URL(event.senderFrame.url);
    if (senderUrl.protocol === 'file:') {
      const expectedFile = path.resolve(__dirname, '../renderer/index.html');
      const actualFile = path.resolve(fileURLToPath(senderUrl));
      return process.platform === 'win32'
        ? actualFile.toLowerCase() === expectedFile.toLowerCase()
        : actualFile === expectedFile;
    }
    if (app.isPackaged) return false;
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    return Boolean(rendererUrl && senderUrl.origin === new URL(rendererUrl).origin);
  } catch {
    return false;
  }
};

const registerProductionPackageMutationIpc = (runtime: PackageMutationRuntime): (() => void) => {
  const ownerUnavailableListeners = new Set<(ownerId: string) => void>();
  const trackedSenders = new Map<number, { sender: WebContents; onDestroyed: () => void }>();
  const host: TrustedPackageMutationIpcHost<IpcMainInvokeEvent> = {
    handle: (channel, handler) => {
      ipcMain.handle(channel, (event, payload: unknown) => handler(event, payload));
    },
    removeHandler: (channel) => ipcMain.removeHandler(channel),
  };
  const identifySender = (event: IpcMainInvokeEvent): string | undefined => {
    const sender = event.sender;
    if (sender.isDestroyed()) return undefined;
    const ownerId = `electron:${sender.id}`;
    if (!trackedSenders.has(sender.id)) {
      const onDestroyed = (): void => {
        trackedSenders.delete(sender.id);
        for (const listener of ownerUnavailableListeners) listener(ownerId);
      };
      trackedSenders.set(sender.id, { sender, onDestroyed });
      sender.once('destroyed', onDestroyed);
    }
    return ownerId;
  };

  const disposeTrustedBridge = registerTrustedPackageMutationIpcBridge({
    host,
    runtime,
    verifySender: isTrustedPackageMutationSender,
    identifySender,
    subscribeOwnerUnavailable: (listener) => {
      ownerUnavailableListeners.add(listener);
      return () => ownerUnavailableListeners.delete(listener);
    },
  });

  return () => {
    disposeTrustedBridge();
    for (const { sender, onDestroyed } of trackedSenders.values()) {
      sender.removeListener('destroyed', onDestroyed);
    }
    trackedSenders.clear();
    ownerUnavailableListeners.clear();
  };
};

const registerProductionMicrosoftStoreNativeIpc = (runtime: MicrosoftStoreNativeRuntime): (() => void) => {
  const ownerUnavailableListeners = new Set<(ownerId: string) => void>();
  const trackedSenders = new Map<number, { sender: WebContents; ownerId: string; onDestroyed: () => void }>();
  const host: TrustedMicrosoftStoreNativeIpcHost<IpcMainInvokeEvent> = {
    handle: (channel, handler) => {
      ipcMain.handle(channel, (event, payload: unknown) => handler(event, payload));
    },
    removeHandler: (channel) => ipcMain.removeHandler(channel),
  };
  const identifySender = (event: IpcMainInvokeEvent): string | undefined => {
    const sender = event.sender;
    if (sender.isDestroyed()) return undefined;
    const ownerId = `electron:${sender.id}`;
    if (!trackedSenders.has(sender.id)) {
      const onDestroyed = (): void => {
        trackedSenders.delete(sender.id);
        for (const listener of ownerUnavailableListeners) listener(ownerId);
      };
      trackedSenders.set(sender.id, { sender, ownerId, onDestroyed });
      sender.once('destroyed', onDestroyed);
    }
    return ownerId;
  };
  const disposeTrustedBridge = registerTrustedMicrosoftStoreNativeIpcBridge({
    host,
    runtime,
    verifySender: isTrustedPackageMutationSender,
    identifySender,
    subscribeOwnerUnavailable: (listener) => {
      ownerUnavailableListeners.add(listener);
      return () => ownerUnavailableListeners.delete(listener);
    },
  });
  return () => {
    disposeTrustedBridge();
    for (const { sender, ownerId, onDestroyed } of trackedSenders.values()) {
      sender.removeListener('destroyed', onDestroyed);
      runtime.revokeOwner(ownerId);
    }
    trackedSenders.clear();
    ownerUnavailableListeners.clear();
  };
};

type TrackedPackageRuntimeSender = {
  sender: WebContents;
  ownerId: string;
  onUnavailable: () => void;
  onDidStartNavigation: (...args: unknown[]) => void;
};

const detachPackageRuntimeSender = (tracked: TrackedPackageRuntimeSender): void => {
  tracked.sender.removeListener('destroyed', tracked.onUnavailable);
  tracked.sender.removeListener('render-process-gone', tracked.onUnavailable);
  tracked.sender.removeListener('did-start-navigation', tracked.onDidStartNavigation);
};

const registerProductionPackageRuntimeIpc = (registry: PackageRuntimeRegistry): (() => void) => {
  const ownerUnavailableListeners = new Set<(ownerId: string) => void>();
  const trackedSenders = new Map<number, TrackedPackageRuntimeSender>();
  const identifySender = (event: IpcMainInvokeEvent): string | undefined => {
    const sender = event.sender;
    if (sender.isDestroyed()) return undefined;
    const ownerId = `electron:${sender.id}`;
    if (!trackedSenders.has(sender.id)) {
      const onUnavailable = (): void => {
        const tracked = trackedSenders.get(sender.id);
        if (!tracked || tracked.ownerId !== ownerId) return;
        detachPackageRuntimeSender(tracked);
        trackedSenders.delete(sender.id);
        for (const listener of ownerUnavailableListeners) listener(ownerId);
      };
      const onDidStartNavigation = (...args: unknown[]): void => {
        const isInPlace = args[2];
        const isMainFrame = args[3];
        if (isMainFrame === true && isInPlace === false) onUnavailable();
      };
      const tracked = { sender, ownerId, onUnavailable, onDidStartNavigation };
      trackedSenders.set(sender.id, tracked);
      sender.once('destroyed', onUnavailable);
      sender.once('render-process-gone', onUnavailable);
      sender.on('did-start-navigation', onDidStartNavigation);
    }
    return ownerId;
  };
  const disposeTrustedBridge = registerTrustedPackageRuntimeIpcBridge({
    host: {
      handle: (channel, handler) => ipcMain.handle(channel, (event, payload: unknown) => handler(event, payload)),
      removeHandler: (channel) => ipcMain.removeHandler(channel),
    },
    registry,
    verifySender: isTrustedPackageMutationSender,
    identifySender,
    subscribeOwnerUnavailable: (listener) => {
      ownerUnavailableListeners.add(listener);
      return () => ownerUnavailableListeners.delete(listener);
    },
  });
  return () => {
    disposeTrustedBridge();
    for (const tracked of trackedSenders.values()) {
      detachPackageRuntimeSender(tracked);
      registry.revokeOwner(tracked.ownerId);
    }
    trackedSenders.clear();
    ownerUnavailableListeners.clear();
  };
};

const registerProductionPackageAppGroupIpc = (): (() => void) => {
  const host: TrustedPackageAppGroupIpcHost<IpcMainInvokeEvent> = {
    handle: (channel, handler) => {
      ipcMain.handle(channel, (event, payload: unknown) => handler(event, payload));
    },
    removeHandler: (channel) => ipcMain.removeHandler(channel),
  };
  return registerTrustedPackageAppGroupIpcBridge({
    host,
    service: getPackageAppGroupService(),
    verifySender: isTrustedPackageMutationSender,
  });
};

export const getCatalogFederationBroker = (): CatalogFederationBroker => {
  const service = getPackageManagerService();
  const providers = [createTomniCatalogProvider(service)];
  if (process.platform === 'win32') {
    providers.push(createMicrosoftStoreCatalogProvider(createWindowsMicrosoftStoreAdapter()));
  }
  federationSingleton ??= createCatalogFederationBroker({
    providers,
    linkedApps: BUNDLED_MICROSOFT_LINKED_APPS,
    cache: createDurableFederatedCatalogCache({
      rootDir: path.join(app.getPath('userData'), 'tomny-packages', 'federated-catalog-cache'),
    }),
    ledger: createCatalogActionLedger({
      rootDir: path.join(app.getPath('userData'), 'tomny-packages', 'catalog-action-ledger'),
    }),
    authorize: () => false,
  });
  return federationSingleton;
};

export const registerPackageManagerBridge = (): void => {
  const service = getPackageManagerService();
  const federation = getCatalogFederationBroker();
  const mutation = getPackageMutationRuntime();
  let initializationError: unknown;
  const ready = service
    .initialize()
    .then(async (): Promise<void> => {
      await mutation.recoverPendingActions();
    })
    .catch((error: unknown): void => {
      initializationError = error;
      console.error('[PackagePlatform] Initialization failed:', error);
    });
  const ensureReady = async (): Promise<void> => {
    await ready;
    if (initializationError) throw initializationError;
  };
  const readyMutation: PackageMutationRuntime = {
    requestConsent: async (request) => {
      await ensureReady();
      return mutation.requestConsent(request);
    },
    preparePermissionConsent: async (request) => {
      await ensureReady();
      return mutation.preparePermissionConsent(request);
    },
    approvePermissionConsent: async (request) => {
      await ensureReady();
      return mutation.approvePermissionConsent(request);
    },
    execute: async (request) => {
      await ensureReady();
      return mutation.execute(request);
    },
    recoverPendingActions: async () => {
      await ensureReady();
      return mutation.recoverPendingActions();
    },
    revokeOwner: (ownerId) => mutation.revokeOwner(ownerId),
  };
  disposeMutationIpc?.();
  disposeMutationIpc = registerProductionPackageMutationIpc(readyMutation);
  disposeRuntimeIpc?.();
  disposeRuntimeIpc = registerProductionPackageRuntimeIpc(getPackageRuntimeRegistry());
  disposeMicrosoftStoreNativeIpc?.();
  disposeMicrosoftStoreNativeIpc = registerProductionMicrosoftStoreNativeIpc(getMicrosoftStoreNativeRuntime());
  disposeAppGroupIpc?.();
  disposeAppGroupIpc = registerProductionPackageAppGroupIpc();

  ipcBridge.packagePlatform.refresh.provider(async () => {
    await ensureReady();
    return service.refreshCatalog();
  });

  ipcBridge.packagePlatform.list.provider(async (filter) => {
    await ensureReady();
    return service.list(filter);
  });
  ipcBridge.packagePlatform.search.provider(async (request) => {
    await ensureReady();
    return service.search(request);
  });
  ipcBridge.packagePlatform.federatedSearch.provider(async (request) => {
    await ensureReady();
    return federation.search(request);
  });
  ipcBridge.packagePlatform.status.provider(async ({ id }) => {
    await ensureReady();
    return service.status(id);
  });
  ipcBridge.packagePlatform.install.provider(async () => {
    throw new Error('PACKAGE_MUTATION_TRUSTED_CHANNEL_REQUIRED');
  });
  ipcBridge.packagePlatform.uninstall.provider(async () => {
    throw new Error('PACKAGE_MUTATION_TRUSTED_CHANNEL_REQUIRED');
  });
  ipcBridge.packagePlatform.contributions.provider(async () => {
    await ensureReady();
    return service.contributions();
  });
  ipcBridge.packagePlatform.readAsset.provider(async ({ id, path: assetPath }) => {
    await ensureReady();
    return service.readAsset(id, assetPath);
  });

  unsubscribe?.();
  unsubscribeContributions?.();
  unsubscribe = service.onStateChanged((event) => ipcBridge.packagePlatform.stateChanged.emit(event));
  unsubscribeContributions = service.onContributionsChanged((event) =>
    ipcBridge.packagePlatform.contributionsChanged.emit(event)
  );
};

export const disposePackageManagerBridge = (): void => {
  disposeMutationIpc?.();
  disposeRuntimeIpc?.();
  disposeMicrosoftStoreNativeIpc?.();
  disposeAppGroupIpc?.();
  unsubscribe?.();
  unsubscribeContributions?.();
  disposeMutationIpc = undefined;
  disposeRuntimeIpc = undefined;
  disposeMicrosoftStoreNativeIpc = undefined;
  disposeAppGroupIpc = undefined;
  unsubscribe = undefined;
  unsubscribeContributions = undefined;
};

export const __resetPackageManagerBridgeForTests = (): void => {
  disposePackageManagerBridge();
  singleton = undefined;
  runtimeRegistrySingleton = undefined;
  mutationSingleton = undefined;
  appGroupSingleton = undefined;

  federationSingleton = undefined;
  microsoftStoreNativeSingleton = undefined;
};
