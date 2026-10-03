/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */
/* oxlint-disable no-await-in-loop -- publisher staging requires ordered durable chunks. */

import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, type FileHandle } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  type IpcMainInvokeEvent,
  type MessagePortMain,
  type WebContents,
} from 'electron';
import { ipcBridge } from '@/common';
import { getPlatformServices } from '@/common/platform';
import {
  applyViuTransaction,
  createPremiumStarterProject,
  validateViuProject,
  type ViuProjectState,
  type ViuTransaction,
  type ViuTransactionResult,
} from '@/common/viu';
import {
  PACKAGE_CAPABILITY_NATIVE_CHANNELS,
  PACKAGE_RUNTIME_NATIVE_CHANNELS,
  PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS,
  PACKAGE_SURFACE_AI_RUNTIME_NATIVE_CHANNELS,
  type PackageSurfaceAiAccessChallengeDisplay,
  type PackageSurfaceAiAccessChallengeRequest,
  type PackageSurfaceAiAccessConsentListResult,
  type PackageSurfaceAiAccessConsentResult,
  type PackageRuntimeCloseRequest,
  PUBLISHER_SUBMISSION_NATIVE_CHANNELS,
  type PublisherSubmissionNativeReceipt,
  type PublisherSubmissionNativeResult,
  type PublisherSubmissionPickAndSubmitRequest,
  type PackageRuntimeOpenRequest,
  type PackageSurfaceAiRuntimePortBinding,
  type PackageSurfaceAiRuntimePortBindingClaim,
  type PackageSurfaceAiRuntimePortHandoff,
  type PackageSurfaceAiRuntimePortHandoffRequest,
} from '@/common/types/platform/electron';
import {
  DEFAULT_PACKAGE_CATALOG_URL,
  excludeDefaultSurfaceCatalogEntries,
  FIRST_PARTY_PACKAGE_CATALOG,
  FIRST_PARTY_PACKAGE_SIGNING_POLICIES,
  FIRST_PARTY_PACKAGE_TRUSTED_KEYS,
  type PackageCapabilityLease,
  type PackageCapabilityLeaseRequest,
  type PackageCapabilityResult,
  type PackageCapabilitySyscall,
  type LinkedMicrosoftAppRecord,
  type PackageListing,
  type PackageCatalogEntry,
  parsePackageManifest,
} from '@/common/packages';
import {
  createPackageCapabilityBroker,
  type PackageCapabilityBroker,
} from '@process/resources/packageCapability/broker';
import {
  createJsonSurfaceAiAccessConsentAuthority,
  createSurfaceAiAccessBroker,
  createSurfaceAiAccessConsentChallengeAuthority,
  createSurfaceAiOperationDispatcher,
  SurfaceAiAccessBrokerError,
  type ActiveLocalSurface,
  type SurfaceAiAccessConsent,
  type SurfaceAiAccessConsentAuthority,
  type SurfaceAiAccessConsentChallengeAuthority,
  type SurfaceAiOperationDispatcher,
} from '@process/resources/packageCapability/surfaceAiAccessBroker';
import {
  createSurfaceAiRuntimeTransportRegistry,
  type SurfaceAiRuntimeTransportBinding,
  type SurfaceAiRuntimeTransportEndpoint,
  type SurfaceAiRuntimeTransportRegistry,
} from '@process/resources/packageCapability/surfaceAiRuntimeTransport';
import type { SurfaceAiObservationStore } from '@process/resources/packageProcessRuntime/surfaceAiObservationStore';
import type { RunKernel } from '@process/foundation/runKernel';

import type { SurfaceAiActionReadiness } from '@process/resources/packageCapability/goalCapability/surfaceAiActionReadiness';
import type { C4LocalSurfaceAiTrust } from '@process/resources/packageCapability/goalCapability/surfaceAiActionTrust';
import {
  createPackageManagerService,
  type PackageManagerService,
  type PackageSandboxMutationLease,
} from './PackageManagerService';
import { packageArtifactManifestsMatch } from './artifactSecurity';
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
import { createStagedTomnyArtifactVerifier } from './packageDownloader';
import {
  createPublisherSubmissionBoundary,
  PublisherSubmissionBoundaryError,
  type PublisherSubmissionBoundary,
} from './publisherSubmissionBoundary';
import { decideAutomatedPackageReview } from './catalog-federation/validation';
import {
  PublisherArtifactStagingStore,
  type StagedPublisherArtifact,
} from '@/process/services/database/publisherArtifactStagingStore';
import { PublisherSubmissionStore } from '@/process/services/database/publisherSubmissionStore';
import { createPublisherAuthority } from '@/process/services/security/accountSession/publisherAuthority';
import type { AccountSessionService } from '@/process/services/security/accountSession/accountSessionService';
import { systemEgressAuthority } from '@/process/services/security/systemEgressAuthority';

import {
  activatePetPackageRuntime,
  deactivatePetPackageRuntime,
} from '@process/resources/packageProcessRuntime/petPackageRuntime';
import {
  createFixedPackageActivationLifecycle,
  type FixedPackageActivationLifecycle,
} from '@process/resources/packageProcessRuntime/fixedPackageActivationLifecycle';

import {
  createDesignViuContributionManager,
  DESIGN_VIU_PACKAGE_ID,
  type DesignViuContributionManager,
} from '@process/resources/packageProcessRuntime/designViuContributionManager';
import {
  createDesignViuMcpRuntime,
  createDesignViuPackageActivationLifecycle,
  type DesignViuMcpRuntime,
  type DesignViuPackageActivationLifecycle,
} from '@process/resources/packageProcessRuntime/designViuMcpRuntime';
import { createDesignViuNativeIpcLifecycle } from '@process/resources/packageProcessRuntime/designViuNativeBridge';
type DesignViuSessionService = Readonly<{
  inspect: (workspaceKey: string) => ViuProjectState;
  previewTransaction: (workspaceKey: string, transaction: ViuTransaction) => ViuTransactionResult;
  commitTransaction: (workspaceKey: string, transaction: ViuTransaction) => ViuTransactionResult;
  validate: (
    workspaceKey: string
  ) => Readonly<{ valid: boolean; revision: number; diagnostics: ReturnType<typeof validateViuProject> }>;
}>;

const cloneDesignViuState = <T>(value: T): T => structuredClone(value);

/**
 * Fixed Main-owned session seam for the signed Design contribution. This is a
 * package contract host, not an IDE implementation dependency, and it only
 * retains account/sender-scoped opaque keys supplied by the native bridge.
 */
const createDesignViuSessionService = (): DesignViuSessionService => {
  const sessions = new Map<string, ViuProjectState>();
  const readOrCreate = (workspaceKey: string): ViuProjectState => {
    const key = workspaceKey.trim();
    if (!key || key.includes('\0') || key.length > 2_048) throw new Error('A valid opaque workspace key is required.');
    const existing = sessions.get(key);
    if (existing) return existing;
    const created = createPremiumStarterProject();
    const diagnostics = validateViuProject(created);
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      throw new Error('The Design VIU starter project failed validation.');
    }
    const state = cloneDesignViuState(created);
    sessions.set(key, state);
    return state;
  };
  const transact = (workspaceKey: string, transaction: ViuTransaction, commit: boolean): ViuTransactionResult => {
    const current = readOrCreate(workspaceKey);
    const output = applyViuTransaction(current, transaction);
    if (!output.accepted) return cloneDesignViuState(output);
    const diagnostics = validateViuProject(output.state);
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      return {
        ...output,
        accepted: false,
        state: cloneDesignViuState(current),
        revision: current.revision,
        diagnostics,
        conflict: output.conflict ?? {
          kind: 'validation',
          message: 'The transaction produced an invalid VIU document.',
        },
      };
    }
    if (commit) sessions.set(workspaceKey.trim(), cloneDesignViuState(output.state));
    return cloneDesignViuState(output);
  };
  return Object.freeze({
    inspect: (workspaceKey) => cloneDesignViuState(readOrCreate(workspaceKey)),
    previewTransaction: (workspaceKey, transaction) => transact(workspaceKey, transaction, false),
    commitTransaction: (workspaceKey, transaction) => transact(workspaceKey, transaction, true),
    validate: (workspaceKey) => {
      const state = readOrCreate(workspaceKey);
      const diagnostics = validateViuProject(state);
      return Object.freeze({
        valid: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
        revision: state.revision,
        diagnostics,
      });
    },
  });
};

let designViuSessionServiceSingleton: DesignViuSessionService | undefined;
const getDesignViuSessionService = (): DesignViuSessionService =>
  (designViuSessionServiceSingleton ??= createDesignViuSessionService());

// Native actions are fail-closed until a reviewed record is bundled into the
// trusted main-process build. Renderer payloads can only reference these IDs.
const BUNDLED_MICROSOFT_LINKED_APPS: readonly LinkedMicrosoftAppRecord[] = [];

const loadBundledMicrosoftLinkedApp = (linkedAppId: string): LinkedMicrosoftAppRecord | undefined =>
  BUNDLED_MICROSOFT_LINKED_APPS.find((record) => record.id === linkedAppId);

let singleton: PackageManagerService | undefined;
let runtimeRegistrySingleton: PackageRuntimeRegistry | undefined;
let capabilityBrokerSingleton: PackageCapabilityBroker | undefined;
let surfaceAiRuntimeTransportRegistrySingleton: SurfaceAiRuntimeTransportRegistry | undefined;
let surfaceAiAccessConsentAuthoritySingleton: SurfaceAiAccessConsentAuthority | undefined;
let designViuContributionManagerSingleton: DesignViuContributionManager | undefined;
let designViuMcpRuntimeSingleton: DesignViuMcpRuntime | undefined;
let disposeDesignViuNativeIpc: (() => void) | undefined;
let designViuPackageActivationLifecycle: DesignViuPackageActivationLifecycle | undefined;

let petPackageActivationLifecycle: FixedPackageActivationLifecycle | undefined;

let federationSingleton: CatalogFederationBroker | undefined;
let microsoftStoreNativeSingleton: MicrosoftStoreNativeRuntime | undefined;
let unsubscribe: (() => void) | undefined;
let unsubscribeContributions: (() => void) | undefined;
let mutationSingleton: PackageMutationRuntime | undefined;
let disposeMutationIpc: (() => void) | undefined;
let disposeRuntimeIpc: (() => void) | undefined;
let disposeSurfaceAiRuntimePortHandoffIpc: (() => void) | undefined;
let disposeSurfaceAiAccessIpc: (() => void) | undefined;
let disposeCapabilityIpc: (() => void) | undefined;
let disposeMicrosoftStoreNativeIpc: (() => void) | undefined;
let appGroupSingleton: PackageAppGroupService | undefined;
let disposeAppGroupIpc: (() => void) | undefined;

let publisherArtifactStagingStoreSingleton: PublisherArtifactStagingStore | undefined;
let publisherSubmissionStoreSingleton: PublisherSubmissionStore | undefined;
let publisherSubmissionBoundarySingleton: PublisherSubmissionBoundary | undefined;
let publisherSubmissionAccountSession: AccountSessionService | undefined;
let disposePublisherSubmissionIpc: (() => void) | undefined;
let requireAuthenticatedPackageAccount: () => void = () => {};

export type PackageManagerBridgeOptions = Readonly<{
  /** Main-window accessor used only by the fixed Browser package host. */
  getMainWindow?: () => BrowserWindow | null | undefined;
  /** Main-owned Account authority; renderer identity is never accepted here. */
  requireAuthenticatedAccount?: () => void;
  /** Secret-bearing Account session remains in Main and is required for publisher authority. */
  accountSession?: AccountSessionService;
  /**
   * Release-owned C4 local pilot switch. Omission fails closed; no renderer,
   * catalog, package, or model input can enable Surface AI access.
   */
  c4LocalSurfaceAiEnabled?: () => boolean;
}>;

const LOCAL_DEV_PACKAGE_METADATA = 'first-party-package-metadata.dev.json';
const LOCAL_DEV_PACKAGE_KEY_ID = 'tomni-store-dev-local';
const LOCAL_DEV_PACKAGE_IDS = new Set(['com.tomni.company', 'com.tomni.knowledge', 'com.tomni.pet']);
const LOCAL_DEV_ARTIFACT_NAME = /^[a-z0-9.-]+\.tomni-package\.json$/;

type LocalDevelopmentPackageMetadata = Readonly<{
  keyId: string;
  publicKey: string;
  packages: readonly Readonly<{ artifactUrl: string; manifest: unknown }>[];
}>;

/**
 * Admits only Company, Knowledge, and Pet development fixtures when local
 * artifacts are explicitly enabled. This catalog is never available to packaged builds and
 * its key is a protected-namespace anchor only in that local unpackaged process, never in production.
 */
export const loadLocalDevelopmentPackageCatalog = ():
  | Readonly<{
      catalog: readonly PackageCatalogEntry[];
      trustedKeys: Readonly<Record<string, string>>;
    }>
  | undefined => {
  if (!useLocalDevelopmentStoreArtifacts()) return undefined;
  try {
    const raw = JSON.parse(
      readFileSync(path.join(process.cwd(), 'store-artifacts', LOCAL_DEV_PACKAGE_METADATA), 'utf8')
    ) as LocalDevelopmentPackageMetadata | undefined;
    if (
      !raw ||
      raw.keyId !== LOCAL_DEV_PACKAGE_KEY_ID ||
      typeof raw.publicKey !== 'string' ||
      !Array.isArray(raw.packages) ||
      raw.packages.length === 0
    ) {
      throw new Error('Invalid local development package metadata.');
    }
    const catalog = raw.packages
      .filter(({ manifest }) => {
        if (typeof manifest !== 'object' || manifest === null) return false;
        const packageId = (manifest as { id?: unknown }).id;
        return typeof packageId === 'string' && LOCAL_DEV_PACKAGE_IDS.has(packageId);
      })
      .map(({ artifactUrl, manifest }) => {
        const parsedManifest = parsePackageManifest(manifest);
        if (
          !LOCAL_DEV_PACKAGE_IDS.has(parsedManifest.id) ||
          parsedManifest.publisherId !== 'com.tomni' ||
          parsedManifest.artifact?.signature.keyId !== LOCAL_DEV_PACKAGE_KEY_ID ||
          !LOCAL_DEV_ARTIFACT_NAME.test(artifactUrl)
        ) {
          throw new Error('Local development metadata contains an unadmitted package.');
        }
        return Object.freeze({
          delivery: 'downloaded-package' as const,
          trust: 'signed-first-party' as const,
          artifactUrl: new URL(artifactUrl, 'https://tomni.local.dev/').toString(),
          manifest: parsedManifest,
        });
      });
    if (catalog.length === 0) throw new Error('Local development metadata contains no admitted package.');
    return Object.freeze({ catalog, trustedKeys: Object.freeze({ [raw.keyId]: raw.publicKey }) });
  } catch (error) {
    console.warn('[PackagePlatform] Local development catalog unavailable:', error);
    return undefined;
  }
};
/** Local Store artifacts are an explicit offline developer fixture, never the default delivery path. */
const useLocalDevelopmentStoreArtifacts = (): boolean =>
  !app.isPackaged && process.env.TOMNI_STORE_LOCAL_ARTIFACTS === '1';

const resolveDevelopmentArtifactUrl = (artifactUrl: string): string => {
  if (!useLocalDevelopmentStoreArtifacts()) return artifactUrl;
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (!rendererUrl) return artifactUrl;
  const filename = new URL(artifactUrl).pathname.split('/').at(-1);
  if (!filename) return artifactUrl;
  return new URL(`/api/packages/artifacts/${encodeURIComponent(filename)}`, rendererUrl).toString();
};

export type PackageRuntimeBinding = Readonly<PackageRuntimeOpenRequest & { ownerId: string }>;

export type PackageRuntimeRegistry = {
  open: (ownerId: string, request: PackageRuntimeOpenRequest) => void;
  close: (ownerId: string, request: PackageRuntimeCloseRequest) => void;
  revokeOwner: (ownerId: string) => void;
  /** Emergency Store revocation: invalidates every active runtime for one Package App. */
  revokePackage: (packageId: string) => void;
  isActive: (packageId: string) => boolean;
  isRuntimeActive: (packageId: string, runtimeId: string) => boolean;
  /**
   * C4 transports must bind an invocation to the exact renderer owner that opened
   * the sandbox runtime; a package/runtime match alone is insufficient authority.
   */
  ownsRuntime: (ownerId: string, packageId: string, runtimeId: string) => boolean;
  /** Returns the exact Main-owned Surface binding for a live sandbox runtime. */
  getRuntimeBinding: (ownerId: string, packageId: string, runtimeId: string) => PackageRuntimeBinding | undefined;
  /** Main-only enumeration for a fresh C4 coordinator; it is never exposed over IPC. */
  listRuntimeBindings: (packageId: string) => readonly PackageRuntimeBinding[];
  /** Emits a Main-owned invalidation before a runtime identity is discarded. */
  onInvalidated: (
    listener: (
      event: Readonly<{
        packageId: string;
        runtimeId: string;
        ownerId: string;
        reason: 'runtime-closed' | 'owner-unavailable' | 'package-revoked';
      }>
    ) => void
  ) => () => void;
  reserveMutation: (packageId: string) => PackageSandboxMutationLease | undefined;
};

/** Tracks active sandboxed-web instances without trusting renderer reference counts. */
export const createPackageRuntimeRegistry = (): PackageRuntimeRegistry => {
  const activeByPackage = new Map<string, Map<string, Map<string, PackageRuntimeBinding>>>();
  const mutationReservations = new Map<string, symbol>();
  const invalidationListeners = new Set<Parameters<PackageRuntimeRegistry['onInvalidated']>[0]>();

  const emitInvalidated = (
    packageId: string,
    runtimeId: string,
    ownerId: string,
    reason: 'runtime-closed' | 'owner-unavailable' | 'package-revoked'
  ): void => {
    const event = Object.freeze({ packageId, runtimeId, ownerId, reason });
    for (const listener of invalidationListeners) {
      try {
        listener(event);
      } catch {
        console.error('[PackagePlatform] Runtime invalidation listener failed.');
      }
    }
  };

  const close = (ownerId: string, request: PackageRuntimeCloseRequest): void => {
    const owners = activeByPackage.get(request.packageId);
    const runtimes = owners?.get(ownerId);
    if (!owners || !runtimes) return;
    if (!runtimes.delete(request.runtimeId)) return;
    emitInvalidated(request.packageId, request.runtimeId, ownerId, 'runtime-closed');
    if (runtimes.size === 0) owners.delete(ownerId);
    if (owners.size === 0) activeByPackage.delete(request.packageId);
  };

  return {
    open: (ownerId, request) => {
      if (mutationReservations.has(request.packageId)) throw new Error('PACKAGE_RUNTIME_MUTATION_ACTIVE');
      const owners = activeByPackage.get(request.packageId) ?? new Map<string, Map<string, PackageRuntimeBinding>>();
      if (
        [...owners.entries()].some(
          ([existingOwnerId, runtimes]) => existingOwnerId !== ownerId && runtimes.has(request.runtimeId)
        )
      ) {
        throw new Error('PACKAGE_RUNTIME_ID_CONFLICT');
      }
      const runtimes = owners.get(ownerId) ?? new Map<string, PackageRuntimeBinding>();
      const existing = runtimes.get(request.runtimeId);
      if (
        existing &&
        (existing.packageVersion !== request.packageVersion ||
          existing.publisherId !== request.publisherId ||
          existing.moduleId !== request.moduleId)
      ) {
        throw new Error('PACKAGE_RUNTIME_IDENTITY_CONFLICT');
      }
      runtimes.set(request.runtimeId, Object.freeze({ ...request, ownerId }));
      owners.set(ownerId, runtimes);
      activeByPackage.set(request.packageId, owners);
    },
    close,
    revokeOwner: (ownerId) => {
      for (const [packageId, owners] of activeByPackage) {
        const runtimes = owners.get(ownerId);
        for (const runtimeId of runtimes?.keys() ?? []) {
          emitInvalidated(packageId, runtimeId, ownerId, 'owner-unavailable');
        }
        owners.delete(ownerId);
        if (owners.size === 0) activeByPackage.delete(packageId);
      }
    },
    revokePackage: (packageId) => {
      for (const [ownerId, runtimes] of activeByPackage.get(packageId) ?? []) {
        for (const runtimeId of runtimes.keys()) emitInvalidated(packageId, runtimeId, ownerId, 'package-revoked');
      }
      activeByPackage.delete(packageId);
      mutationReservations.delete(packageId);
    },
    isActive: (packageId) => (activeByPackage.get(packageId)?.size ?? 0) > 0,
    isRuntimeActive: (packageId, runtimeId) => {
      const owners = activeByPackage.get(packageId);
      return Boolean(owners && [...owners.values()].some((runtimes) => runtimes.has(runtimeId)));
    },
    ownsRuntime: (ownerId, packageId, runtimeId) =>
      activeByPackage.get(packageId)?.get(ownerId)?.has(runtimeId) === true,
    getRuntimeBinding: (ownerId, packageId, runtimeId) => {
      const binding = activeByPackage.get(packageId)?.get(ownerId)?.get(runtimeId);
      return binding ? structuredClone(binding) : undefined;
    },
    listRuntimeBindings: (packageId) => {
      const bindings: PackageRuntimeBinding[] = [];
      for (const runtimes of activeByPackage.get(packageId)?.values() ?? []) {
        for (const binding of runtimes.values()) bindings.push(structuredClone(binding));
      }
      return bindings.toSorted((left, right) =>
        left.ownerId === right.ownerId
          ? left.runtimeId.localeCompare(right.runtimeId)
          : left.ownerId.localeCompare(right.ownerId)
      );
    },
    onInvalidated: (listener) => {
      invalidationListeners.add(listener);
      return () => invalidationListeners.delete(listener);
    },
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

const isRuntimeIdentifier = (value: unknown, maxLength: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maxLength && value === value.trim();

const isPackageRuntimeOpenRequest = (value: unknown): value is PackageRuntimeOpenRequest => {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  return (
    isRuntimeIdentifier(request.packageId, 256) &&
    isRuntimeIdentifier(request.runtimeId, 128) &&
    isRuntimeIdentifier(request.packageVersion, 64) &&
    isRuntimeIdentifier(request.publisherId, 256) &&
    isRuntimeIdentifier(request.moduleId, 256)
  );
};

const isPackageRuntimeCloseRequest = (value: unknown): value is PackageRuntimeCloseRequest => {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  return isRuntimeIdentifier(request.packageId, 256) && isRuntimeIdentifier(request.runtimeId, 128);
};

export type PackageRuntimeOpenVerifier = (request: PackageRuntimeOpenRequest) => Promise<void>;

/**
 * Fails closed unless Main can prove the renderer's Surface identity maps to the
 * currently installed, reviewed, enabled Package App contribution. This does not
 * grant any package capability or AI access.
 */
export const verifyInstalledPackageSurfaceRuntime = async (
  service: Pick<PackageManagerService, 'status' | 'contributions'>,
  request: PackageRuntimeOpenRequest
): Promise<void> => {
  const listing = await service.status(request.packageId);
  const manifest = listing.state === 'installed' && listing.enabled ? listing.installedManifest : undefined;
  if (
    !manifest ||
    listing.installedVersion !== manifest.version ||
    manifest.id !== request.packageId ||
    manifest.version !== request.packageVersion ||
    manifest.publisherId !== request.publisherId
  ) {
    throw new Error('PACKAGE_RUNTIME_SURFACE_INACTIVE');
  }
  if (listing.installedTrust !== 'signed-first-party' && listing.installedTrust !== 'signed-store') {
    throw new Error('PACKAGE_RUNTIME_SURFACE_UNSIGNED');
  }
  if (!manifest.artifact || !listing.installedPublicationReview) {
    throw new Error('PACKAGE_RUNTIME_SURFACE_UNREVIEWED');
  }
  if (listing.revoked && packageArtifactManifestsMatch(listing.manifest, manifest)) {
    throw new Error('PACKAGE_RUNTIME_SURFACE_REVOKED');
  }
  const module = manifest.modules.find((candidate) => candidate.id === request.moduleId);
  if (module?.runtime !== 'sandboxed-web' || typeof module.entrypoint !== 'string') {
    throw new Error('PACKAGE_RUNTIME_SURFACE_MODULE_INVALID');
  }
  const matchingSurfaceContributions = (await service.contributions()).snapshot.apps.filter(
    (contribution) =>
      contribution.packageId === manifest.id &&
      contribution.packageVersion === manifest.version &&
      contribution.moduleId === module.id
  );
  if (matchingSurfaceContributions.length !== 1) {
    throw new Error('PACKAGE_RUNTIME_SURFACE_UNREGISTERED');
  }
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
  verifyOpen?: PackageRuntimeOpenVerifier;
  subscribeOwnerUnavailable?: (listener: (ownerId: string) => void) => () => void;
}): (() => void) => {
  const invoke =
    (action: 'open' | 'close') =>
    async (sender: TSender, payload: unknown): Promise<void> => {
      if (!options.verifySender(sender)) throw new Error('PACKAGE_RUNTIME_BRIDGE_UNAUTHORIZED');
      const ownerId = options.identifySender(sender);
      if (!ownerId) throw new Error('PACKAGE_RUNTIME_OWNER_UNAVAILABLE');
      if (action === 'open') {
        if (!isPackageRuntimeOpenRequest(payload)) throw new Error('PACKAGE_RUNTIME_REQUEST_INVALID');
        await options.verifyOpen?.(payload);
        options.registry.open(ownerId, payload);
        return;
      }
      if (!isPackageRuntimeCloseRequest(payload)) throw new Error('PACKAGE_RUNTIME_REQUEST_INVALID');
      options.registry.close(ownerId, payload);
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

/** Main-owned registry: Package Apps never obtain this authority directly. */
export const getSurfaceAiRuntimeTransportRegistry = (): SurfaceAiRuntimeTransportRegistry => {
  surfaceAiRuntimeTransportRegistrySingleton ??= createSurfaceAiRuntimeTransportRegistry();
  return surfaceAiRuntimeTransportRegistrySingleton;
};

const HANDOFF_IDENTIFIER = /^[A-Za-z0-9._:@/-]+$/;
const HANDOFF_INTEGRITY = /^sha256-[a-f0-9]{64}$/;

const isHandoffIdentifier = (value: unknown, maximumLength = 256): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maximumLength && HANDOFF_IDENTIFIER.test(value);

const isSurfaceAiPortBindingClaim = (value: unknown): value is PackageSurfaceAiRuntimePortBindingClaim => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const claim = value as Record<string, unknown>;
  return (
    isHandoffIdentifier(claim.packageId) &&
    isHandoffIdentifier(claim.packageVersion, 64) &&
    isHandoffIdentifier(claim.publisherId) &&
    isHandoffIdentifier(claim.runtimeId, 128) &&
    isHandoffIdentifier(claim.moduleId) &&
    typeof claim.artifactIntegrity === 'string' &&
    HANDOFF_INTEGRITY.test(claim.artifactIntegrity)
  );
};

const isSurfaceAiPortHandoffRequest = (value: unknown): value is PackageSurfaceAiRuntimePortHandoffRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return isHandoffIdentifier(request.requestId, 128) && isSurfaceAiPortBindingClaim(request.binding);
};

const isSurfaceAiAccessChallengeRequest = (value: unknown): value is PackageSurfaceAiAccessChallengeRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    Object.keys(request).length === 2 &&
    isHandoffIdentifier(request.packageId) &&
    isHandoffIdentifier(request.operationId)
  );
};

const isSurfaceAiAccessConfirmationRequest = (
  value: unknown
): value is Readonly<{ challengeId: string; approved: boolean }> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    Object.keys(request).length === 2 &&
    isHandoffIdentifier(request.challengeId, 128) &&
    typeof request.approved === 'boolean'
  );
};

const isSurfaceAiAccessRevocationRequest = (value: unknown): value is Readonly<{ consentId: string }> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return Object.keys(request).length === 1 && isHandoffIdentifier(request.consentId, 128);
};

const isSurfaceAiAccessListRequest = (value: unknown): value is Readonly<{ packageId: string }> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return Object.keys(request).length === 1 && isHandoffIdentifier(request.packageId);
};

const toSurfaceAiChallengeDisplay = (
  challenge: ReturnType<SurfaceAiAccessConsentChallengeAuthority['issue']>
): PackageSurfaceAiAccessChallengeDisplay =>
  Object.freeze({
    challengeId: challenge.challengeId,
    packageId: challenge.surface.packageId,
    packageVersion: challenge.surface.packageVersion,
    publisherId: challenge.surface.publisherId,
    operationId: challenge.operation.id,
    capability: challenge.operation.capability,
    dataClasses: Object.freeze([...challenge.operation.dataClasses]),
    destinationIds: Object.freeze([...challenge.operation.destinationIds]),
    secretUse: challenge.secretUse,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
  });

type SurfaceAiAccessConsentRuntime = Readonly<{
  requestChallenge: (
    ownerId: string,
    accountId: string,
    request: PackageSurfaceAiAccessChallengeRequest
  ) => Promise<PackageSurfaceAiAccessChallengeDisplay>;
  confirmChallenge: (
    ownerId: string,
    accountId: string,
    request: Readonly<{ challengeId: string; approved: boolean }>
  ) => Promise<Readonly<{ approved: boolean; consentId?: string; expiresAt?: string }>>;
  revokeConsent: (accountId: string, consentId: string) => Promise<boolean>;
  listConsents: (
    accountId: string,
    packageId: string
  ) => Promise<
    readonly { consentId: string; packageId: string; packageVersion: string; operationId: string; expiresAt: string }[]
  >;
}>;

export type TrustedSurfaceAiAccessIpcHost<TSender> = Readonly<{
  handle: (
    channel: string,
    handler: (
      sender: TSender,
      payload: unknown
    ) => Promise<PackageSurfaceAiAccessConsentResult | PackageSurfaceAiAccessConsentListResult>
  ) => void;
  removeHandler: (channel: string) => void;
}>;

const surfaceAiAccessErrorResult = (error: unknown): PackageSurfaceAiAccessConsentResult => {
  if (error instanceof SurfaceAiAccessBrokerError) {
    switch (error.code) {
      case 'SURFACE_AI_ACCESS_SURFACE_UNAVAILABLE':
        return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_SURFACE_UNAVAILABLE' };
      case 'SURFACE_AI_ACCESS_OPERATION_UNDECLARED':
        return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_OPERATION_UNDECLARED' };
      case 'SURFACE_AI_ACCESS_CHALLENGE_EXPIRED':
        return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_CHALLENGE_EXPIRED' };
      case 'SURFACE_AI_ACCESS_CHALLENGE_INVALID':
        return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_CHALLENGE_INVALID' };
      case 'SURFACE_AI_ACCESS_CONSENT_UNAVAILABLE':
        return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_CONSENT_UNAVAILABLE' };
      default:
        return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_REQUEST_INVALID' };
    }
  }
  return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_CONSENT_UNAVAILABLE' };
};

/**
 * Main-only consent IPC. It has no operation invoke channel: a challenge only
 * records a bounded user grant for a reviewed installed Surface declaration.
 */
export const registerTrustedSurfaceAiAccessIpcBridge = <TSender>(options: {
  host: TrustedSurfaceAiAccessIpcHost<TSender>;
  verifySender: (sender: TSender) => boolean;
  identifyOwner: (sender: TSender) => string | undefined;
  requireAuthenticatedAccount: () => Readonly<{ accountId: string }>;
  runtime: SurfaceAiAccessConsentRuntime;
}): (() => void) => {
  options.host.handle(PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS.requestChallenge, async (sender, payload) => {
    if (!options.verifySender(sender)) return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_SENDER_UNTRUSTED' };
    let account: Readonly<{ accountId: string }>;
    try {
      account = options.requireAuthenticatedAccount();
    } catch {
      return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_ACCOUNT_REQUIRED' };
    }
    const ownerId = options.identifyOwner(sender);
    const request = isSurfaceAiAccessChallengeRequest(payload) ? payload : undefined;
    if (!ownerId || !request) return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_REQUEST_INVALID' };
    try {
      return { ok: true, challenge: await options.runtime.requestChallenge(ownerId, account.accountId, request) };
    } catch (error) {
      return surfaceAiAccessErrorResult(error);
    }
  });
  options.host.handle(PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS.confirmChallenge, async (sender, payload) => {
    if (!options.verifySender(sender)) return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_SENDER_UNTRUSTED' };
    let account: Readonly<{ accountId: string }>;
    try {
      account = options.requireAuthenticatedAccount();
    } catch {
      return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_ACCOUNT_REQUIRED' };
    }
    const ownerId = options.identifyOwner(sender);
    const request = isSurfaceAiAccessConfirmationRequest(payload) ? payload : undefined;
    if (!ownerId || !request) return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_REQUEST_INVALID' };
    try {
      return { ok: true, ...(await options.runtime.confirmChallenge(ownerId, account.accountId, request)) };
    } catch (error) {
      return surfaceAiAccessErrorResult(error);
    }
  });
  options.host.handle(PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS.revokeConsent, async (sender, payload) => {
    if (!options.verifySender(sender)) return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_SENDER_UNTRUSTED' };
    let account: Readonly<{ accountId: string }>;
    try {
      account = options.requireAuthenticatedAccount();
    } catch {
      return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_ACCOUNT_REQUIRED' };
    }
    const request = isSurfaceAiAccessRevocationRequest(payload) ? payload : undefined;
    if (!request) return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_REQUEST_INVALID' };
    try {
      return { ok: true, revoked: await options.runtime.revokeConsent(account.accountId, request.consentId) };
    } catch (error) {
      return surfaceAiAccessErrorResult(error);
    }
  });
  options.host.handle(PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS.listConsents, async (sender, payload) => {
    if (!options.verifySender(sender)) return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_SENDER_UNTRUSTED' };
    let account: Readonly<{ accountId: string }>;
    try {
      account = options.requireAuthenticatedAccount();
    } catch {
      return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_ACCOUNT_REQUIRED' };
    }
    const request = isSurfaceAiAccessListRequest(payload) ? payload : undefined;
    if (!request) return { ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_REQUEST_INVALID' };
    try {
      const consents = await options.runtime.listConsents(account.accountId, request.packageId);
      return { ok: true, consents };
    } catch (error) {
      return surfaceAiAccessErrorResult(error);
    }
  });
  return () => {
    options.host.removeHandler(PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS.requestChallenge);
    options.host.removeHandler(PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS.confirmChallenge);
    options.host.removeHandler(PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS.revokeConsent);
    options.host.removeHandler(PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS.listConsents);
  };
};

/** Adapts Electron's Main-only port to the narrow C4 transport endpoint contract. */
export const createElectronSurfaceAiRuntimeTransportEndpoint = (
  port: Pick<MessagePortMain, 'postMessage' | 'close' | 'start' | 'on' | 'once' | 'removeListener'>
): SurfaceAiRuntimeTransportEndpoint => {
  port.start();
  return Object.freeze({
    postMessage: (message: unknown): void => port.postMessage(message),
    close: (): void => port.close(),
    onMessage: (listener: (message: unknown) => void): (() => void) => {
      const handler = (event: { data: unknown }): void => listener(event.data);
      port.on('message', handler);
      return () => port.removeListener('message', handler);
    },
    onClose: (listener: () => void): (() => void) => {
      port.once('close', listener);
      return () => port.removeListener('close', listener);
    },
  });
};

export type TrustedSurfaceAiRuntimePortHandoffIpcHost<TSender> = {
  handle: (channel: string, handler: (sender: TSender, payload: unknown) => Promise<void>) => void;
  removeHandler: (channel: string) => void;
};

export type SurfaceAiRuntimePortHandoffChannel<TPort> = Readonly<{ port1: TPort; port2: TPort }>;

/**
 * Registers only the host-initiated port handoff. It cannot invoke an operation,
 * and it closes both authority records if exact binding or delivery fails.
 */
export const registerTrustedSurfaceAiRuntimePortHandoffIpcBridge = <TSender, TPort>(options: {
  host: TrustedSurfaceAiRuntimePortHandoffIpcHost<TSender>;
  transportRegistry: SurfaceAiRuntimeTransportRegistry;
  verifySender: (sender: TSender) => boolean;
  resolveBinding: (
    sender: TSender,
    claim: PackageSurfaceAiRuntimePortBindingClaim
  ) => Promise<PackageSurfaceAiRuntimePortBinding | undefined>;
  createChannel: () => SurfaceAiRuntimePortHandoffChannel<TPort>;
  toEndpoint: (port: TPort) => SurfaceAiRuntimeTransportEndpoint;
  closePort: (port: TPort) => void;
  deliverPort: (sender: TSender, handoff: Omit<PackageSurfaceAiRuntimePortHandoff, 'port'>, port: TPort) => void;
  createConnectionId: () => string;
}): (() => void) => {
  options.host.handle(PACKAGE_SURFACE_AI_RUNTIME_NATIVE_CHANNELS.requestPortHandoff, async (sender, payload) => {
    if (!options.verifySender(sender)) throw new Error('PACKAGE_SURFACE_AI_PORT_HANDOFF_UNAUTHORIZED');
    if (!isSurfaceAiPortHandoffRequest(payload)) throw new Error('PACKAGE_SURFACE_AI_PORT_HANDOFF_REQUEST_INVALID');
    const binding = await options.resolveBinding(sender, payload.binding);
    if (!binding) throw new Error('PACKAGE_SURFACE_AI_PORT_HANDOFF_RUNTIME_UNAVAILABLE');
    const connectionId = options.createConnectionId();
    if (!isHandoffIdentifier(connectionId, 128)) throw new Error('PACKAGE_SURFACE_AI_PORT_HANDOFF_CONNECTION_INVALID');

    const channel = options.createChannel();
    let registered = false;
    try {
      options.transportRegistry.register(binding, options.toEndpoint(channel.port1));
      registered = true;
      options.deliverPort(
        sender,
        Object.freeze({ requestId: payload.requestId, connectionId, binding: Object.freeze(binding) }),
        channel.port2
      );
    } catch (error) {
      if (registered) {
        options.transportRegistry.invalidate({ ownerId: binding.ownerId, runtimeId: binding.runtimeId });
      } else {
        try {
          options.closePort(channel.port1);
        } finally {
          options.closePort(channel.port2);
        }
      }
      throw error;
    }
  });
  return () => options.host.removeHandler(PACKAGE_SURFACE_AI_RUNTIME_NATIVE_CHANNELS.requestPortHandoff);
};

/** Resolves a renderer claim only from Main-owned runtime and installed-artifact state. */
export const resolveVerifiedSurfaceAiRuntimePortBinding = async (
  service: Pick<PackageManagerService, 'status' | 'contributions'>,
  runtimeRegistry: PackageRuntimeRegistry,
  ownerId: string,
  claim: PackageSurfaceAiRuntimePortBindingClaim
): Promise<PackageSurfaceAiRuntimePortBinding | undefined> => {
  const runtime = runtimeRegistry.getRuntimeBinding(ownerId, claim.packageId, claim.runtimeId);
  if (
    !runtime ||
    runtime.packageVersion !== claim.packageVersion ||
    runtime.publisherId !== claim.publisherId ||
    runtime.moduleId !== claim.moduleId
  ) {
    return undefined;
  }
  try {
    await verifyInstalledPackageSurfaceRuntime(service, runtime);
    const listing = await service.status(claim.packageId);
    const manifest = listing.state === 'installed' && listing.enabled ? listing.installedManifest : undefined;
    const artifactIntegrity = manifest?.artifact?.integrity;
    if (!manifest || artifactIntegrity !== claim.artifactIntegrity) return undefined;
    return Object.freeze({
      surface: Object.freeze({
        packageId: manifest.id,
        packageVersion: manifest.version,
        publisherId: manifest.publisherId,
      }),
      ownerId,
      runtimeId: runtime.runtimeId,
      moduleId: runtime.moduleId,
      artifactIntegrity,
    });
  } catch {
    return undefined;
  }
};

/**
 * Re-checks every live sandbox runtime against the current installed Store
 * artifact before a Main-only C4 planner may choose one. Renderer claims are
 * deliberately not accepted at this boundary.
 */
export const listVerifiedSurfaceAiRuntimeBindings = async (
  service: Pick<PackageManagerService, 'status' | 'contributions'>,
  runtimeRegistry: PackageRuntimeRegistry,
  packageId: string
): Promise<readonly SurfaceAiRuntimeTransportBinding[]> => {
  const runtimes = runtimeRegistry.listRuntimeBindings(packageId);
  const verified = await Promise.all(
    runtimes.map(async (runtime) => {
      try {
        await verifyInstalledPackageSurfaceRuntime(service, runtime);
        const listing = await service.status(runtime.packageId);
        const manifest = listing.state === 'installed' && listing.enabled ? listing.installedManifest : undefined;
        const artifactIntegrity = manifest?.artifact?.integrity;
        if (
          !manifest ||
          !artifactIntegrity ||
          manifest.id !== runtime.packageId ||
          manifest.version !== runtime.packageVersion ||
          manifest.publisherId !== runtime.publisherId
        ) {
          return undefined;
        }
        return Object.freeze({
          surface: Object.freeze({
            packageId: manifest.id,
            packageVersion: manifest.version,
            publisherId: manifest.publisherId,
          }),
          ownerId: runtime.ownerId,
          runtimeId: runtime.runtimeId,
          moduleId: runtime.moduleId,
          artifactIntegrity,
        });
      } catch {
        return undefined;
      }
    })
  );
  return Object.freeze(
    verified.filter((binding): binding is SurfaceAiRuntimeTransportBinding => binding !== undefined)
  );
};

const getPackageCapabilityBroker = (): PackageCapabilityBroker => {
  capabilityBrokerSingleton ??= createPackageCapabilityBroker({
    isPackageActive: (packageId) => getPackageRuntimeRegistry().isActive(packageId),
  });
  return capabilityBrokerSingleton;
};

const isCapabilityLeaseRequest = (value: unknown): value is PackageCapabilityLeaseRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    request.version === 1 &&
    typeof request.packageId === 'string' &&
    typeof request.runtimeId === 'string' &&
    request.capability === 'host.runtime.info'
  );
};

const isCapabilitySyscall = (value: unknown): value is PackageCapabilitySyscall => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    request.version === 1 &&
    typeof request.leaseId === 'string' &&
    typeof request.packageId === 'string' &&
    typeof request.runtimeId === 'string' &&
    request.name === 'host.runtime.info'
  );
};

const isCapabilityCancelRequest = (
  value: unknown
): value is Pick<PackageCapabilityLease, 'leaseId' | 'packageId' | 'runtimeId'> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request.leaseId === 'string' &&
    typeof request.packageId === 'string' &&
    typeof request.runtimeId === 'string'
  );
};

/**
 * Keeps catalog-admitted publisher keys ephemeral and separate from the
 * application-pinned keys. The returned record is intentionally mutated in
 * place because PackageManagerService retains this reference for download and
 * startup recovery verification.
 */
export const createVerifiedStorePublisherKeySet = (
  pinnedFirstPartyKeys: Readonly<Record<string, string>>
): Readonly<{
  trustedKeys: Record<string, string>;
  replaceVerifiedStorePublisherKeys: (keys: Readonly<Record<string, string>>) => void;
}> => {
  const trustedKeys: Record<string, string> = { ...pinnedFirstPartyKeys };
  const admittedStoreKeyIds = new Set<string>();
  const replaceVerifiedStorePublisherKeys = (keys: Readonly<Record<string, string>>): void => {
    for (const keyId of admittedStoreKeyIds) delete trustedKeys[keyId];
    admittedStoreKeyIds.clear();
    for (const [keyId, publicKey] of Object.entries(keys)) {
      if (keyId in pinnedFirstPartyKeys) {
        throw new Error('Store publisher key collides with a pinned first-party key.');
      }
      trustedKeys[keyId] = publicKey;
      admittedStoreKeyIds.add(keyId);
    }
  };
  return Object.freeze({ trustedKeys, replaceVerifiedStorePublisherKeys });
};

export const getPackageManagerService = (): PackageManagerService => {
  const rootDir = path.join(app.getPath('userData'), 'tomny-packages');
  const localDevelopmentCatalog = loadLocalDevelopmentPackageCatalog();
  const catalog = excludeDefaultSurfaceCatalogEntries(localDevelopmentCatalog?.catalog ?? FIRST_PARTY_PACKAGE_CATALOG);
  const verifiedStorePublisherKeySet = createVerifiedStorePublisherKeySet(FIRST_PARTY_PACKAGE_TRUSTED_KEYS);
  const firstPartyTrustedKeys = localDevelopmentCatalog
    ? { ...FIRST_PARTY_PACKAGE_TRUSTED_KEYS, ...localDevelopmentCatalog.trustedKeys }
    : FIRST_PARTY_PACKAGE_TRUSTED_KEYS;
  if (localDevelopmentCatalog)
    Object.assign(verifiedStorePublisherKeySet.trustedKeys, localDevelopmentCatalog.trustedKeys);
  const remoteCatalogLoader = localDevelopmentCatalog
    ? undefined
    : createRemotePackageCatalogLoader({
        url: process.env.TOMNI_STORE_CATALOG_URL ?? DEFAULT_PACKAGE_CATALOG_URL,
        cachePath: path.join(rootDir, 'catalog-cache.json'),
        fallbackCatalog: catalog,
        trustedKeys: FIRST_PARTY_PACKAGE_TRUSTED_KEYS,
        signingPolicies: FIRST_PARTY_PACKAGE_SIGNING_POLICIES,
        onVerifiedStorePublisherKeys: verifiedStorePublisherKeySet.replaceVerifiedStorePublisherKeys,
        egressAuthority: systemEgressAuthority,
        isPackaged: app.isPackaged,
      });
  singleton ??= createPackageManagerService({
    rootDir,
    appVersion: app.getVersion(),
    catalog,
    trustedKeys: verifiedStorePublisherKeySet.trustedKeys,
    firstPartyTrustedKeys,
    ...(remoteCatalogLoader
      ? { catalogLoader: async () => excludeDefaultSurfaceCatalogEntries(await remoteCatalogLoader()) }
      : {}),
    resolveArtifactUrl: resolveDevelopmentArtifactUrl,
    allowLocalArtifactUrls: useLocalDevelopmentStoreArtifacts(),
    isPackageSandboxActive: (packageId) => getPackageRuntimeRegistry().isActive(packageId),
    reservePackageSandboxMutation: (packageId) => getPackageRuntimeRegistry().reserveMutation(packageId),
    revokePackageSandbox: (packageId) => getPackageRuntimeRegistry().revokePackage(packageId),
    quiescePackageRuntime: async (packageId) => {
      if (packageId === DESIGN_VIU_PACKAGE_ID) {
        await designViuMcpRuntimeSingleton?.quiesce(packageId);
      } else if (packageId === 'com.tomni.pet') {
        await petPackageActivationLifecycle?.quiesce();
      }
    },
    resumePackageRuntime: async (packageId) => {
      if (packageId === DESIGN_VIU_PACKAGE_ID) {
        await designViuMcpRuntimeSingleton?.reconcile();
      } else if (packageId === 'com.tomni.pet') {
        await petPackageActivationLifecycle?.resume();
      }
    },
  });
  return singleton;
};

/**
 * Main-only Design admission. It exposes a fixed reviewed-host object only;
 * package manifests cannot select code, paths, arguments, or an MCP tool.
 */
export const getDesignViuContributionManager = (): DesignViuContributionManager => {
  designViuContributionManagerSingleton ??= createDesignViuContributionManager({
    packages: getPackageManagerService(),
  });
  return designViuContributionManagerSingleton;
};

/** Fixed Design VIU MCP host. It is tied only to the verified manager state. */
export const getDesignViuMcpRuntime = (): DesignViuMcpRuntime => {
  designViuMcpRuntimeSingleton ??= createDesignViuMcpRuntime({
    manager: getDesignViuContributionManager(),
    acquireRuntimeEntry: (packageId, assetPath) =>
      getPackageManagerService().acquireVerifiedRuntimeEntry(packageId, assetPath),
    workerFactory: getPlatformServices().worker,
  });
  return designViuMcpRuntimeSingleton;
};

/**
 * Creates the reviewed Design runtime only after the signed package is already
 * installed and enabled. A clean base retains no Design manager, MCP worker,
 * native channel, or session service.
 */
const activateInstalledDesignViu = async (service: Pick<PackageManagerService, 'status'>): Promise<void> => {
  const listing = await service.status(DESIGN_VIU_PACKAGE_ID);
  if (listing.state !== 'installed' || !listing.enabled) return;
  await getDesignViuContributionManager().initialize();
  await getDesignViuMcpRuntime().initialize();
  disposeDesignViuNativeIpc ??= registerProductionDesignViuNativeIpc();
};

const getSurfaceAiAccessConsentAuthority = (): SurfaceAiAccessConsentAuthority => {
  const filePath = path.join(app.getPath('userData'), 'tomny-state', 'surface-ai-access-consents.json');
  surfaceAiAccessConsentAuthoritySingleton ??= createJsonSurfaceAiAccessConsentAuthority({ filePath });
  return surfaceAiAccessConsentAuthoritySingleton;
};

/** C4 intentionally starts without secret injection; that requires its own opaque lease authority. */
const LOCAL_SURFACE_AI_CONSENT_LIMITS = Object.freeze({ maxEstimatedCostMB: 32, maxSteps: 12 });

const createProductionSurfaceAiAccessConsentRuntime = (
  service: Pick<PackageManagerService, 'status'>
): SurfaceAiAccessConsentRuntime => {
  const authority = getSurfaceAiAccessConsentAuthority();
  const activeSurfaces = new Map<string, ActiveLocalSurface>();
  const challengePackages = new Map<string, string>();
  const initialized = authority.initialize();
  const refreshActiveSurface = async (packageId: string): Promise<void> => {
    const listing = await service.status(packageId);
    const manifest = listing.state === 'installed' && listing.enabled ? listing.installedManifest : undefined;
    const active =
      manifest !== undefined &&
      listing.installedTrust !== undefined &&
      listing.installedPublicationReview !== undefined &&
      listing.revoked !== true;
    if (!active) {
      activeSurfaces.delete(packageId);
      return;
    }
    activeSurfaces.set(
      packageId,
      Object.freeze({
        identity: Object.freeze({
          packageId: manifest.id,
          packageVersion: manifest.version,
          publisherId: manifest.publisherId,
        }),
        manifest: Object.freeze({ aiAccess: structuredClone(manifest.aiAccess) }),
        approvedForAiAccess: true,
        revoked: false,
      })
    );
  };
  const challenges = createSurfaceAiAccessConsentChallengeAuthority({
    consentAuthority: authority,
    resolveActiveLocalSurface: (packageId) => activeSurfaces.get(packageId),
  });
  return Object.freeze({
    requestChallenge: async (ownerId, accountId, request) => {
      await initialized;
      await refreshActiveSurface(request.packageId);
      const challenge = challenges.issue({
        ownerId,
        accountId,
        packageId: request.packageId,
        operationId: request.operationId,
        secretUse: false,
        limits: LOCAL_SURFACE_AI_CONSENT_LIMITS,
      });
      challengePackages.set(challenge.challengeId, request.packageId);
      return toSurfaceAiChallengeDisplay(challenge);
    },
    confirmChallenge: async (ownerId, accountId, request) => {
      await initialized;
      const packageId = challengePackages.get(request.challengeId);
      if (!packageId) throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CHALLENGE_INVALID');
      await refreshActiveSurface(packageId);
      try {
        const result = await challenges.confirm({
          ownerId,
          challengeId: request.challengeId,
          approved: request.approved,
        });
        if (!result.approved) return Object.freeze({ approved: false });
        if (!result.consent || result.consent.accountId !== accountId) {
          throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CHALLENGE_INVALID');
        }
        return Object.freeze({
          approved: true,
          consentId: result.consent.consentId,
          expiresAt: new Date(result.consent.expiresAt).toISOString(),
        });
      } finally {
        challengePackages.delete(request.challengeId);
      }
    },
    revokeConsent: async (accountId, consentId) => {
      await initialized;
      const consent = authority.get(consentId);
      if (!consent || consent.accountId !== accountId) return false;
      return authority.revoke(consentId);
    },
    listConsents: async (accountId, packageId) => {
      await initialized;
      await refreshActiveSurface(packageId);
      return authority
        .listForAccount(accountId)
        .filter(
          (consent) =>
            consent.surface.packageId === packageId && consent.revokedAt === undefined && consent.expiresAt > Date.now()
        )
        .map((consent) =>
          Object.freeze({
            consentId: consent.consentId,
            packageId: consent.surface.packageId,
            packageVersion: consent.surface.packageVersion,
            operationId: consent.operationId,
            expiresAt: new Date(consent.expiresAt).toISOString(),
          })
        );
    },
  });
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

const PUBLISHER_ARCHIVE_MAX_BYTES = 200 * 1024 * 1024;
const PUBLISHER_ARCHIVE_CHUNK_BYTES = 1024 * 1024;
const PUBLISHER_SUBMISSION_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,200}$/;

export type PublisherSubmissionIpcHost<Event> = Readonly<{
  handle(channel: string, handler: (event: Event, payload: unknown) => Promise<PublisherSubmissionNativeResult>): void;
  removeHandler(channel: string): void;
}>;

export type TrustedPublisherSubmissionIpcBridgeOptions<Event> = Readonly<{
  host: PublisherSubmissionIpcHost<Event>;
  verifySender(event: Event): boolean;
  requireAuthenticatedAccount(): void;
  isAvailable(): boolean;
  chooseArchive(event: Event): Promise<Readonly<{ cancelled: boolean; filePath?: string }>>;
  submit(input: Readonly<{ idempotencyKey: string; filePath: string }>): Promise<PublisherSubmissionNativeReceipt>;
}>;

const isPublisherSubmissionRequest = (value: unknown): value is PublisherSubmissionPickAndSubmitRequest => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 1 &&
    typeof candidate.idempotencyKey === 'string' &&
    PUBLISHER_SUBMISSION_IDEMPOTENCY_KEY.test(candidate.idempotencyKey)
  );
};

/**
 * Sender-aware narrow IPC registration. The only value crossing from renderer
 * is an idempotency key; file location, archive contents and publisher identity
 * are acquired and retained in the Main process.
 */
export const registerTrustedPublisherSubmissionIpcBridge = <Event>(
  options: TrustedPublisherSubmissionIpcBridgeOptions<Event>
): (() => void) => {
  options.host.handle(PUBLISHER_SUBMISSION_NATIVE_CHANNELS.pickAndSubmit, async (event, payload) => {
    if (!isPublisherSubmissionRequest(payload)) {
      return { ok: false, code: 'PUBLISHER_SUBMISSION_REQUEST_INVALID' };
    }
    if (!options.verifySender(event)) {
      return { ok: false, code: 'PUBLISHER_SUBMISSION_SENDER_UNTRUSTED' };
    }
    try {
      options.requireAuthenticatedAccount();
    } catch {
      return { ok: false, code: 'PUBLISHER_SUBMISSION_ACCOUNT_REQUIRED' };
    }
    if (!options.isAvailable()) {
      return { ok: false, code: 'PUBLISHER_SUBMISSION_UNAVAILABLE' };
    }

    let selection: Readonly<{ cancelled: boolean; filePath?: string }>;
    try {
      selection = await options.chooseArchive(event);
    } catch {
      return { ok: false, code: 'PUBLISHER_SUBMISSION_FAILED' };
    }
    if (selection.cancelled) return { ok: false, code: 'PUBLISHER_SUBMISSION_CANCELLED' };
    if (typeof selection.filePath !== 'string' || selection.filePath.length === 0) {
      return { ok: false, code: 'PUBLISHER_SUBMISSION_FAILED' };
    }

    try {
      return {
        ok: true,
        receipt: await options.submit({ idempotencyKey: payload.idempotencyKey, filePath: selection.filePath }),
      };
    } catch {
      return { ok: false, code: 'PUBLISHER_SUBMISSION_FAILED' };
    }
  });
  return () => options.host.removeHandler(PUBLISHER_SUBMISSION_NATIVE_CHANNELS.pickAndSubmit);
};

type PublisherSubmissionRuntime = Readonly<{
  boundary: PublisherSubmissionBoundary;
  staging: PublisherArtifactStagingStore;
  resolvePrincipal: () => ReturnType<ReturnType<typeof createPublisherAuthority>['requirePublisherPrincipal']>;
}>;

const getPublisherSubmissionRuntime = (): PublisherSubmissionRuntime | undefined => {
  const endpoint = process.env.TOMNI_PUBLISHER_AUTHORITY_URL?.trim();
  const accountSession = publisherSubmissionAccountSession;
  if (!endpoint || accountSession === undefined) return undefined;
  try {
    const authority = createPublisherAuthority({ endpoint, accountSession });
    const submissionStore = (publisherSubmissionStoreSingleton ??= new PublisherSubmissionStore({
      rootDir: path.join(app.getPath('userData'), 'tomny-packages', 'publisher-submissions'),
    }));
    const staging = (publisherArtifactStagingStoreSingleton ??= new PublisherArtifactStagingStore({
      rootDir: path.join(app.getPath('userData'), 'tomny-packages', 'publisher-artifact-staging'),
      isArtifactReferenced: async (artifact) =>
        (await submissionStore.list()).some(
          (submission) =>
            submission.publisherId === artifact.publisherId &&
            submission.archiveFingerprint === artifact.artifactFingerprint
        ),
    }));
    publisherSubmissionBoundarySingleton ??= createPublisherSubmissionBoundary({
      resolvePrincipal: () => authority.requirePublisherPrincipal(),
      verifyAndStage: createStagedTomnyArtifactVerifier((input) => staging.read(input)),
      automatedReviewer: ({ manifest, inspection, priorApprovalFingerprint }) =>
        decideAutomatedPackageReview({ manifest, inspection, priorApprovalFingerprint }),
      submissionStore,
    });
    return {
      boundary: publisherSubmissionBoundarySingleton,
      staging,
      resolvePrincipal: () => authority.requirePublisherPrincipal(),
    };
  } catch {
    return undefined;
  }
};

const closeFileQuietly = async (handle: FileHandle | undefined): Promise<void> => {
  await handle?.close().catch((): undefined => undefined);
};

const cancelPublisherUploadQuietly = async (
  runtime: PublisherSubmissionRuntime,
  principal: Awaited<ReturnType<PublisherSubmissionRuntime['resolvePrincipal']>> | undefined,
  sessionId: string | undefined
): Promise<void> => {
  if (principal === undefined || sessionId === undefined) return;
  await runtime.staging
    .cancelUpload({ publisherId: principal.publisherId, subjectId: principal.subjectId, sessionId })
    .catch((): undefined => undefined);
};

const publisherDiscardReason = (error: unknown): 'verification-failed' | 'submission-creation-failed' =>
  error instanceof PublisherSubmissionBoundaryError &&
  (error.code === 'PUBLISHER_SUBMISSION_ARTIFACT_INVALID' || error.code === 'PUBLISHER_SUBMISSION_ARTIFACT_REJECTED')
    ? 'verification-failed'
    : 'submission-creation-failed';

/** Renderer IPC remains opaque; a durable submission reference blocks deletion in the staging store. */
const discardSealedPublisherArtifactQuietly = async (
  runtime: PublisherSubmissionRuntime,
  principal: Awaited<ReturnType<PublisherSubmissionRuntime['resolvePrincipal']>> | undefined,
  artifact: StagedPublisherArtifact | undefined,
  error: unknown
): Promise<void> => {
  if (principal === undefined || artifact === undefined) return;
  await runtime.staging
    .discardSealedArtifact({
      publisherId: principal.publisherId,
      subjectId: principal.subjectId,
      artifactId: artifact.artifactId,
      artifactFingerprint: artifact.artifactFingerprint,
      reason: publisherDiscardReason(error),
    })
    .catch((): undefined => undefined);
};

const submitPickedTomnyArchive = async (
  input: Readonly<{ idempotencyKey: string; filePath: string }>
): Promise<PublisherSubmissionNativeReceipt> => {
  const runtime = getPublisherSubmissionRuntime();
  if (runtime === undefined || path.extname(input.filePath).toLowerCase() !== '.tomny') {
    throw new Error('PUBLISHER_SUBMISSION_UNAVAILABLE');
  }

  let handle: FileHandle | undefined;
  let principal: Awaited<ReturnType<PublisherSubmissionRuntime['resolvePrincipal']>> | undefined;
  let uploadSessionId: string | undefined;
  let sealedArtifact: StagedPublisherArtifact | undefined;
  let submissionCreated = false;
  try {
    handle = await open(input.filePath, 'r');
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > PUBLISHER_ARCHIVE_MAX_BYTES) {
      throw new Error('PUBLISHER_SUBMISSION_ARCHIVE_INVALID');
    }

    principal = await runtime.resolvePrincipal();
    const artifactId = randomUUID();
    const upload = await runtime.staging.beginUpload({
      publisherId: principal.publisherId,
      subjectId: principal.subjectId,
      artifactId,
      idempotencyKey: input.idempotencyKey,
      declaredByteLength: metadata.size,
    });
    uploadSessionId = upload.sessionId;

    const archiveHash = createHash('sha256');
    let offset = 0;
    while (offset < metadata.size) {
      const buffer = Buffer.allocUnsafe(Math.min(PUBLISHER_ARCHIVE_CHUNK_BYTES, metadata.size - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, offset);
      if (bytesRead <= 0) throw new Error('PUBLISHER_SUBMISSION_ARCHIVE_READ_FAILED');
      const chunk = buffer.subarray(0, bytesRead);
      archiveHash.update(chunk);
      await runtime.staging.appendUploadChunk({
        publisherId: principal.publisherId,
        subjectId: principal.subjectId,
        sessionId: uploadSessionId,
        offset,
        bytes: chunk,
        chunkFingerprint: `sha256-${createHash('sha256').update(chunk).digest('hex')}`,
      });
      offset += bytesRead;
    }
    sealedArtifact = await runtime.staging.sealUpload({
      publisherId: principal.publisherId,
      subjectId: principal.subjectId,
      sessionId: uploadSessionId,
      artifactFingerprint: `sha256-${archiveHash.digest('hex')}`,
    });

    const receipt = await runtime.boundary.submit({ idempotencyKey: input.idempotencyKey, artifactId });
    submissionCreated = true;
    return {
      submissionId: receipt.submissionId,
      packageId: receipt.packageId,
      version: receipt.version,
      status: receipt.status,
      review: receipt.review,
      submittedAt: receipt.submittedAt,
    };
  } catch (error) {
    if (sealedArtifact === undefined) {
      await cancelPublisherUploadQuietly(runtime, principal, uploadSessionId);
    } else if (!submissionCreated) {
      await discardSealedPublisherArtifactQuietly(runtime, principal, sealedArtifact, error);
    }
    throw error;
  } finally {
    await closeFileQuietly(handle);
  }
};

const isTrustedTopLevelPackageSender = (event: IpcMainInvokeEvent): boolean => {
  const sender = event.sender;
  if (sender.isDestroyed() || event.senderFrame !== sender.mainFrame) return false;
  const ownerWindow = BrowserWindow.fromWebContents(sender);
  if (!ownerWindow || ownerWindow.isDestroyed()) return false;

  try {
    const senderUrl = new URL(event.senderFrame.url);
    const trustedOrigin =
      senderUrl.protocol === 'file:'
        ? (() => {
            const expectedFile = path.resolve(__dirname, '../renderer/index.html');
            const actualFile = path.resolve(fileURLToPath(senderUrl));
            return process.platform === 'win32'
              ? actualFile.toLowerCase() === expectedFile.toLowerCase()
              : actualFile === expectedFile;
          })()
        : !app.isPackaged &&
          Boolean(
            process.env.ELECTRON_RENDERER_URL && senderUrl.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
          );
    return trustedOrigin;
  } catch {
    return false;
  }
};

const isTrustedPackageMutationSender = (event: IpcMainInvokeEvent): boolean => {
  if (!isTrustedTopLevelPackageSender(event)) return false;
  try {
    requireAuthenticatedPackageAccount();
    return true;
  } catch {
    return false;
  }
};

const registerProductionDesignViuNativeIpc = (): (() => void) =>
  createDesignViuNativeIpcLifecycle<IpcMainInvokeEvent>({
    host: {
      handle: (channel, handler) => ipcMain.handle(channel, (event, payload: unknown) => handler(event, payload)),
      removeHandler: (channel) => ipcMain.removeHandler(channel),
    },
    manager: getDesignViuContributionManager(),
    verifySender: isTrustedTopLevelPackageSender,
    ownerId: (event) => (event.sender.isDestroyed() ? undefined : `electron:${event.sender.id}`),
    requireAccount: () => {
      const account = publisherSubmissionAccountSession?.requireOnlineSession();
      if (!account) throw new Error('ACCOUNT_SESSION_ONLINE_REQUIRED');
      return { accountId: account.accountId };
    },
    createSessions: getDesignViuSessionService,
  });

const registerProductionPublisherSubmissionIpc = (): (() => void) =>
  registerTrustedPublisherSubmissionIpcBridge<IpcMainInvokeEvent>({
    host: {
      handle: (channel, handler) => ipcMain.handle(channel, (event, payload: unknown) => handler(event, payload)),
      removeHandler: (channel) => ipcMain.removeHandler(channel),
    },
    verifySender: isTrustedTopLevelPackageSender,
    requireAuthenticatedAccount: requireAuthenticatedPackageAccount,
    isAvailable: () => getPublisherSubmissionRuntime() !== undefined,
    chooseArchive: async (event) => {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      if (!ownerWindow || ownerWindow.isDestroyed()) throw new Error('PUBLISHER_SUBMISSION_OWNER_UNAVAILABLE');
      const selection = await dialog.showOpenDialog(ownerWindow, {
        title: 'Select Tomni package',
        buttonLabel: 'Submit package',
        properties: ['openFile'],
        filters: [{ name: 'Tomni package', extensions: ['tomny'] }],
      });
      if (selection.canceled) return { cancelled: true };
      if (selection.filePaths.length !== 1) throw new Error('PUBLISHER_SUBMISSION_PICKER_INVALID');
      return { cancelled: false, filePath: selection.filePaths[0] };
    },
    submit: submitPickedTomnyArchive,
  });

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

const registerProductionPackageRuntimeIpc = (
  service: PackageManagerService,
  registry: PackageRuntimeRegistry
): (() => void) => {
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
    verifyOpen: (request) => verifyInstalledPackageSurfaceRuntime(service, request),
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

/**
 * Main owns both Electron MessagePorts. Port two is delivered only to the
 * authenticated top-level renderer after it claims an already verified runtime.
 * The preload and host then have to prove that a matching sandbox iframe is live.
 */
const registerProductionSurfaceAiRuntimePortHandoffIpc = (
  service: PackageManagerService,
  runtimeRegistry: PackageRuntimeRegistry,
  transportRegistry: SurfaceAiRuntimeTransportRegistry
): (() => void) => {
  const unsubscribeInvalidated = runtimeRegistry.onInvalidated((event) =>
    transportRegistry.invalidate({ ownerId: event.ownerId, runtimeId: event.runtimeId })
  );
  const disposeHandoff = registerTrustedSurfaceAiRuntimePortHandoffIpcBridge<IpcMainInvokeEvent, MessagePortMain>({
    host: {
      handle: (channel, handler) => ipcMain.handle(channel, (event, payload: unknown) => handler(event, payload)),
      removeHandler: (channel) => ipcMain.removeHandler(channel),
    },
    transportRegistry,
    verifySender: isTrustedPackageMutationSender,
    resolveBinding: (event, claim) => {
      const ownerId = `electron:${event.sender.id}`;
      return resolveVerifiedSurfaceAiRuntimePortBinding(service, runtimeRegistry, ownerId, claim);
    },
    createChannel: () => new MessageChannelMain(),
    toEndpoint: createElectronSurfaceAiRuntimeTransportEndpoint,
    closePort: (port) => port.close(),
    deliverPort: (event, handoff, port) => {
      if (event.sender.isDestroyed() || event.senderFrame !== event.sender.mainFrame) {
        throw new Error('PACKAGE_SURFACE_AI_PORT_HANDOFF_OWNER_UNAVAILABLE');
      }
      event.senderFrame.postMessage(PACKAGE_SURFACE_AI_RUNTIME_NATIVE_CHANNELS.portHandoff, handoff, [port]);
    },
    createConnectionId: randomUUID,
  });
  return () => {
    disposeHandoff();
    unsubscribeInvalidated();
    transportRegistry.dispose();
  };
};

const registerProductionSurfaceAiAccessIpc = (
  service: Pick<PackageManagerService, 'status'>,
  ensureReady: () => Promise<void>,
  requireAuthenticatedAccount: () => Readonly<{ accountId: string }>
): (() => void) => {
  const runtime = createProductionSurfaceAiAccessConsentRuntime(service);
  const afterReady: SurfaceAiAccessConsentRuntime = {
    requestChallenge: async (ownerId, accountId, request) => {
      await ensureReady();
      return runtime.requestChallenge(ownerId, accountId, request);
    },
    confirmChallenge: async (ownerId, accountId, request) => {
      await ensureReady();
      return runtime.confirmChallenge(ownerId, accountId, request);
    },
    revokeConsent: async (accountId, consentId) => {
      await ensureReady();
      return runtime.revokeConsent(accountId, consentId);
    },
    listConsents: async (accountId, packageId) => {
      await ensureReady();
      return runtime.listConsents(accountId, packageId);
    },
  };
  return registerTrustedSurfaceAiAccessIpcBridge({
    host: {
      handle: (channel, handler) => ipcMain.handle(channel, (event, payload: unknown) => handler(event, payload)),
      removeHandler: (channel) => ipcMain.removeHandler(channel),
    },
    verifySender: isTrustedPackageMutationSender,
    identifyOwner: (event) =>
      event.sender.isDestroyed() || event.senderFrame !== event.sender.mainFrame
        ? undefined
        : `electron:${event.sender.id}`,
    requireAuthenticatedAccount,
    runtime: afterReady,
  });
};

const registerProductionPackageCapabilityIpc = (
  service: PackageManagerService,
  registry: PackageRuntimeRegistry
): (() => void) => {
  const broker = getPackageCapabilityBroker();
  const requireTrustedRuntime = (event: IpcMainInvokeEvent, packageId: string, runtimeId: string): void => {
    if (!isTrustedPackageMutationSender(event)) throw new Error('PACKAGE_CAPABILITY_SENDER_UNTRUSTED');
    const ownerId = `electron:${event.sender.id}`;
    if (!registry.ownsRuntime(ownerId, packageId, runtimeId)) {
      throw new Error('PACKAGE_CAPABILITY_RUNTIME_UNAVAILABLE');
    }
  };
  ipcMain.handle(PACKAGE_CAPABILITY_NATIVE_CHANNELS.activate, async (event, payload: unknown) => {
    if (!isCapabilityLeaseRequest(payload)) throw new Error('PACKAGE_CAPABILITY_REQUEST_INVALID');
    requireTrustedRuntime(event, payload.packageId, payload.runtimeId);
    const listing = await service.status(payload.packageId);
    const manifest = listing.state === 'installed' && listing.enabled ? listing.installedManifest : undefined;
    if (!manifest) throw new Error('PACKAGE_CAPABILITY_PACKAGE_INACTIVE');
    return broker.activate(manifest, payload);
  });
  ipcMain.handle(PACKAGE_CAPABILITY_NATIVE_CHANNELS.invoke, (event, payload: unknown): PackageCapabilityResult => {
    if (!isCapabilitySyscall(payload)) throw new Error('PACKAGE_CAPABILITY_REQUEST_INVALID');
    requireTrustedRuntime(event, payload.packageId, payload.runtimeId);
    return broker.invoke(payload);
  });
  ipcMain.handle(PACKAGE_CAPABILITY_NATIVE_CHANNELS.cancel, (event, payload: unknown): boolean => {
    if (!isCapabilityCancelRequest(payload)) throw new Error('PACKAGE_CAPABILITY_REQUEST_INVALID');
    requireTrustedRuntime(event, payload.packageId, payload.runtimeId);
    return broker.cancel(payload.leaseId, payload.packageId, payload.runtimeId);
  });
  return () => {
    ipcMain.removeHandler(PACKAGE_CAPABILITY_NATIVE_CHANNELS.activate);
    ipcMain.removeHandler(PACKAGE_CAPABILITY_NATIVE_CHANNELS.invoke);
    ipcMain.removeHandler(PACKAGE_CAPABILITY_NATIVE_CHANNELS.cancel);
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

/**
 * Main-only read facade over the one initialized PackageManager instance.
 * It deliberately excludes catalog refresh, purchase, install, and runtime
 * activation so orchestration may only inspect signed Store facts.
 */
export type C4SurfaceAiDispatcherFactoryInput = Readonly<{
  /** The active Foundation lifecycle supplied by the Main-only action controller. */
  kernel: RunKernel;
  /** Immutable Store/consent/runtime facts bound before the action begins. */
  readiness: SurfaceAiActionReadiness;
  /** The one per-run Trust authority shared by model and Surface child execution. */
  trust: C4LocalSurfaceAiTrust;
  /** Optional Main-created sink; neither package nor renderer can supply its root or records. */
  observationStore?: Pick<SurfaceAiObservationStore, 'open' | 'recordProgress' | 'recordResult'>;
}>;

const samePackageIdentity = (
  left: Readonly<{ packageId: string; packageVersion: string; publisherId: string }>,
  right: Readonly<{ packageId: string; packageVersion: string; publisherId: string }>
): boolean =>
  left.packageId === right.packageId &&
  left.packageVersion === right.packageVersion &&
  left.publisherId === right.publisherId;

const sameSurfaceAiRuntimeBinding = (
  left: SurfaceAiRuntimeTransportBinding,
  right: SurfaceAiRuntimeTransportBinding
): boolean =>
  samePackageIdentity(left.surface, right.surface) &&
  left.ownerId === right.ownerId &&
  left.runtimeId === right.runtimeId &&
  left.moduleId === right.moduleId &&
  left.artifactIntegrity === right.artifactIntegrity;

/**
 * Creates a dispatcher only from Main-owned C4 readiness facts. The caller
 * cannot name a package, module, runtime, operation, or transport port: all
 * five are closed over from a Store-verified plan and rechecked at dispatch.
 */
export const createC4SurfaceAiOperationDispatcher = async (
  input: C4SurfaceAiDispatcherFactoryInput &
    Readonly<{
      service: Pick<PackageManagerService, 'status' | 'contributions'>;
      runtimeRegistry: PackageRuntimeRegistry;
      transportRegistry: SurfaceAiRuntimeTransportRegistry;
      consentStore: SurfaceAiAccessConsentAuthority;
      /** Release ownership supplies this fail-closed switch; it defaults off. */
      enabled: () => boolean;
    }>
): Promise<SurfaceAiOperationDispatcher> => {
  const { readiness } = input;
  const listing = await input.service.status(readiness.selection.surface.packageId);
  const manifest = listing.state === 'installed' && listing.enabled ? listing.installedManifest : undefined;
  if (
    !manifest ||
    !manifest.artifact ||
    !listing.installedPublicationReview ||
    listing.revoked ||
    (listing.installedTrust !== 'signed-first-party' && listing.installedTrust !== 'signed-store') ||
    !samePackageIdentity(readiness.selection.surface, {
      packageId: manifest.id,
      packageVersion: manifest.version,
      publisherId: manifest.publisherId,
    }) ||
    manifest.artifact.integrity !== readiness.runtime.artifactIntegrity
  ) {
    throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_SURFACE_UNAVAILABLE');
  }

  const activeSurface: ActiveLocalSurface = Object.freeze({
    identity: Object.freeze({
      packageId: manifest.id,
      packageVersion: manifest.version,
      publisherId: manifest.publisherId,
    }),
    manifest: Object.freeze({ aiAccess: manifest.aiAccess }),
    approvedForAiAccess: true,
    revoked: false,
  });
  const isExpectedRuntimeActive = (
    surface: SurfaceAiRuntimeTransportBinding['surface'],
    runtime: Readonly<{ ownerId: string; runtimeId: string }>
  ): boolean =>
    samePackageIdentity(surface, readiness.runtime.surface) &&
    runtime.ownerId === readiness.runtime.ownerId &&
    runtime.runtimeId === readiness.runtime.runtimeId &&
    input.transportRegistry.isActive(readiness.runtime);

  return createSurfaceAiOperationDispatcher({
    broker: createSurfaceAiAccessBroker({
      kernel: input.kernel,
      enabled: input.enabled,
      consentStore: input.consentStore,
      resolveActiveLocalSurface: (packageId) =>
        packageId === activeSurface.identity.packageId ? activeSurface : undefined,
      assertCurrentLocalSurface: async (surface, runtime) => {
        if (!isExpectedRuntimeActive(surface, runtime)) return false;
        const current = await input.service.status(surface.packageId);
        if (
          current.state !== 'installed' ||
          !current.enabled ||
          current.revoked ||
          !current.installedManifest ||
          !current.installedPublicationReview ||
          (current.installedTrust !== 'signed-first-party' && current.installedTrust !== 'signed-store') ||
          current.installedManifest.artifact?.integrity !== readiness.runtime.artifactIntegrity ||
          !samePackageIdentity(surface, {
            packageId: current.installedManifest.id,
            packageVersion: current.installedManifest.version,
            publisherId: current.installedManifest.publisherId,
          })
        ) {
          return false;
        }
        const currentBindings = await listVerifiedSurfaceAiRuntimeBindings(
          input.service,
          input.runtimeRegistry,
          surface.packageId
        );
        return currentBindings.some(
          (binding) =>
            sameSurfaceAiRuntimeBinding(binding, readiness.runtime) && input.transportRegistry.isActive(binding)
        );
      },
      isExactRuntimeActive: isExpectedRuntimeActive,
      onRuntimeInvalidated: (listener) => input.runtimeRegistry.onInvalidated(listener),
      trustBroker: input.trust.trustBroker,
      trustOrigin: input.trust.origin,
    }),
    transportRegistry: input.transportRegistry,
    observationStore: input.observationStore,
    resolveRuntimeBinding: async (surface, runtime) => {
      if (!isExpectedRuntimeActive(surface, runtime)) return undefined;
      const bindings = await listVerifiedSurfaceAiRuntimeBindings(
        input.service,
        input.runtimeRegistry,
        surface.packageId
      );
      return bindings.find(
        (binding) =>
          sameSurfaceAiRuntimeBinding(binding, readiness.runtime) && input.transportRegistry.isActive(binding)
      );
    },
  });
};

/** Main-only read facade over the single Package Manager lifecycle. */
export type PackageManagerStoreReadRuntime = Readonly<{
  ensureReady: () => Promise<void>;
  list: (filter?: { type?: 'app'; installedOnly?: boolean }) => Promise<PackageListing[]>;
  /** Main-only fresh lifecycle read; it is never exposed as an orchestration IPC. */
  status: (packageId: string) => Promise<PackageListing>;
  contributions: () => ReturnType<PackageManagerService['contributions']>;
  onContributionsChanged: PackageManagerService['onContributionsChanged'];
  /**
   * Main-only C4 facts. The facade carries no mutation, install, purchase, or
   * renderer-selected runtime authority; an action coordinator must still bind
   * these facts to the authenticated account and exact consent.
   */

  surfaceAi: Readonly<{
    getConsent: (consentId: string) => Promise<SurfaceAiAccessConsent | undefined>;
    onConsentRevoked: SurfaceAiAccessConsentAuthority['onRevoked'];
    listVerifiedRuntimeBindings: (packageId: string) => Promise<readonly SurfaceAiRuntimeTransportBinding[]>;
    isTransportActive: (binding: SurfaceAiRuntimeTransportBinding) => boolean;
    onRuntimeInvalidated: PackageRuntimeRegistry['onInvalidated'];
    /**
     * Creates a C4 dispatcher from already-bound Main facts. It is not an IPC
     * capability and does not expose package, runtime, or port selection.
     */
    createDispatcher: (input: C4SurfaceAiDispatcherFactoryInput) => Promise<SurfaceAiOperationDispatcher>;
  }>;
}>;

export const registerPackageManagerBridge = (
  options: PackageManagerBridgeOptions = {}
): PackageManagerStoreReadRuntime => {
  requireAuthenticatedPackageAccount = options.requireAuthenticatedAccount ?? (() => {});
  publisherSubmissionAccountSession = options.accountSession;
  const service = getPackageManagerService();
  const federation = getCatalogFederationBroker();
  const mutation = getPackageMutationRuntime();
  let initializationError: unknown;
  const ready = service
    .initialize()
    .then(async (): Promise<void> => {
      await mutation.recoverPendingActions();
      designViuPackageActivationLifecycle?.dispose();
      designViuPackageActivationLifecycle = createDesignViuPackageActivationLifecycle({
        packages: service,
        activate: async () => {
          try {
            await activateInstalledDesignViu(service);
          } catch (error) {
            console.error('[PackagePlatform] Design VIU activation failed:', error);
            throw error;
          }
        },
      });
      await designViuPackageActivationLifecycle.initialize();
      await petPackageActivationLifecycle?.dispose();
      petPackageActivationLifecycle = createFixedPackageActivationLifecycle('com.tomni.pet', {
        packages: service,
        activate: async () => {
          const pet = await import('@process/pet/petManager');
          await activatePetPackageRuntime({
            isSupported: pet.isPetSupported,
            create: pet.createPetWindow,
            destroy: pet.destroyPetWindow,
            resize: pet.resizePetWindow,
            setDnd: pet.setPetDndMode,
            setConfirmEnabled: pet.setPetConfirmEnabled,
          });
        },
        deactivate: async () => {
          deactivatePetPackageRuntime();
        },
      });
      await petPackageActivationLifecycle.initialize();
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
      requireAuthenticatedPackageAccount();
      await ensureReady();
      return mutation.requestConsent(request);
    },
    preparePermissionConsent: async (request) => {
      requireAuthenticatedPackageAccount();
      await ensureReady();
      return mutation.preparePermissionConsent(request);
    },
    approvePermissionConsent: async (request) => {
      requireAuthenticatedPackageAccount();
      await ensureReady();
      return mutation.approvePermissionConsent(request);
    },
    execute: async (request) => {
      requireAuthenticatedPackageAccount();
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
  disposeRuntimeIpc = registerProductionPackageRuntimeIpc(service, getPackageRuntimeRegistry());
  disposeSurfaceAiRuntimePortHandoffIpc?.();
  disposeSurfaceAiRuntimePortHandoffIpc = registerProductionSurfaceAiRuntimePortHandoffIpc(
    service,
    getPackageRuntimeRegistry(),
    getSurfaceAiRuntimeTransportRegistry()
  );
  disposeSurfaceAiAccessIpc?.();
  disposeSurfaceAiAccessIpc = registerProductionSurfaceAiAccessIpc(service, ensureReady, () => {
    const account = options.accountSession?.requireOnlineSession();
    if (!account) throw new Error('ACCOUNT_SESSION_ONLINE_REQUIRED');
    return { accountId: account.accountId };
  });
  disposeCapabilityIpc?.();
  disposeCapabilityIpc = registerProductionPackageCapabilityIpc(service, getPackageRuntimeRegistry());
  disposeMicrosoftStoreNativeIpc?.();
  disposeMicrosoftStoreNativeIpc = registerProductionMicrosoftStoreNativeIpc(getMicrosoftStoreNativeRuntime());
  disposeAppGroupIpc?.();
  disposeAppGroupIpc = registerProductionPackageAppGroupIpc();
  disposePublisherSubmissionIpc?.();
  disposePublisherSubmissionIpc = registerProductionPublisherSubmissionIpc();

  ipcBridge.packagePlatform.refresh.provider(async () => {
    requireAuthenticatedPackageAccount();
    await ensureReady();
    return service.refreshCatalog();
  });

  ipcBridge.packagePlatform.list.provider(async (filter) => {
    requireAuthenticatedPackageAccount();
    await ensureReady();
    return service.list(filter);
  });
  ipcBridge.packagePlatform.search.provider(async (request) => {
    requireAuthenticatedPackageAccount();
    await ensureReady();
    return service.search(request);
  });
  ipcBridge.packagePlatform.federatedSearch.provider(async (request) => {
    requireAuthenticatedPackageAccount();
    await ensureReady();
    return federation.search(request);
  });
  ipcBridge.packagePlatform.status.provider(async ({ id }) => {
    requireAuthenticatedPackageAccount();
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
    requireAuthenticatedPackageAccount();
    await ensureReady();
    return service.contributions();
  });
  ipcBridge.packagePlatform.readAsset.provider(async ({ id, path: assetPath }) => {
    requireAuthenticatedPackageAccount();
    await ensureReady();
    return service.readAsset(id, assetPath);
  });

  unsubscribe?.();
  unsubscribeContributions?.();
  unsubscribe = service.onStateChanged((event) => ipcBridge.packagePlatform.stateChanged.emit(event));
  unsubscribeContributions = service.onContributionsChanged((event) =>
    ipcBridge.packagePlatform.contributionsChanged.emit(event)
  );
  return {
    ensureReady,
    list: (filter) => service.list(filter),
    status: async (packageId) => {
      await ensureReady();
      return service.status(packageId);
    },
    contributions: () => service.contributions(),
    onContributionsChanged: (listener) => service.onContributionsChanged(listener),

    surfaceAi: Object.freeze({
      getConsent: async (consentId) => {
        await ensureReady();
        const authority = getSurfaceAiAccessConsentAuthority();
        await authority.initialize();
        return authority.get(consentId);
      },
      onConsentRevoked: (listener) => getSurfaceAiAccessConsentAuthority().onRevoked(listener),
      listVerifiedRuntimeBindings: async (packageId) => {
        await ensureReady();
        return listVerifiedSurfaceAiRuntimeBindings(service, getPackageRuntimeRegistry(), packageId);
      },
      isTransportActive: (binding) => getSurfaceAiRuntimeTransportRegistry().isActive(binding),
      onRuntimeInvalidated: (listener) => getPackageRuntimeRegistry().onInvalidated(listener),
      createDispatcher: async (input) => {
        await ensureReady();
        const authority = getSurfaceAiAccessConsentAuthority();
        await authority.initialize();
        return createC4SurfaceAiOperationDispatcher({
          ...input,
          service,
          runtimeRegistry: getPackageRuntimeRegistry(),
          transportRegistry: getSurfaceAiRuntimeTransportRegistry(),
          consentStore: authority,
          // C4 must remain inactive until bootstrap provides this release-owned
          // local-pilot switch. No renderer/package input can affect it.
          enabled: options.c4LocalSurfaceAiEnabled ?? (() => false),
        });
      },
    }),
  };
};

export const disposePackageManagerBridge = (): void => {
  designViuPackageActivationLifecycle?.dispose();
  void petPackageActivationLifecycle?.dispose();

  designViuMcpRuntimeSingleton?.dispose();
  designViuContributionManagerSingleton?.dispose();
  disposeMutationIpc?.();
  disposeSurfaceAiRuntimePortHandoffIpc?.();
  disposeSurfaceAiAccessIpc?.();
  disposeRuntimeIpc?.();
  disposeCapabilityIpc?.();
  disposeMicrosoftStoreNativeIpc?.();
  disposeAppGroupIpc?.();
  unsubscribe?.();
  disposePublisherSubmissionIpc?.();
  unsubscribeContributions?.();
  disposeMutationIpc = undefined;
  disposeSurfaceAiRuntimePortHandoffIpc = undefined;
  disposeSurfaceAiAccessIpc = undefined;
  disposeRuntimeIpc = undefined;
  disposeCapabilityIpc = undefined;
  disposeMicrosoftStoreNativeIpc = undefined;
  disposeAppGroupIpc = undefined;
  unsubscribe = undefined;
  disposePublisherSubmissionIpc = undefined;
  disposeDesignViuNativeIpc = undefined;
  designViuPackageActivationLifecycle = undefined;

  petPackageActivationLifecycle = undefined;
  unsubscribeContributions = undefined;
};

export const __resetPackageManagerBridgeForTests = (): void => {
  disposePackageManagerBridge();
  singleton = undefined;
  runtimeRegistrySingleton = undefined;
  capabilityBrokerSingleton = undefined;
  surfaceAiRuntimeTransportRegistrySingleton = undefined;
  surfaceAiAccessConsentAuthoritySingleton = undefined;
  mutationSingleton = undefined;
  appGroupSingleton = undefined;
  designViuContributionManagerSingleton = undefined;
  designViuMcpRuntimeSingleton = undefined;
  designViuSessionServiceSingleton = undefined;

  federationSingleton = undefined;
  microsoftStoreNativeSingleton = undefined;
  requireAuthenticatedPackageAccount = () => {};
  publisherArtifactStagingStoreSingleton = undefined;
  publisherSubmissionStoreSingleton = undefined;
  publisherSubmissionBoundarySingleton = undefined;
  publisherSubmissionAccountSession = undefined;
};
