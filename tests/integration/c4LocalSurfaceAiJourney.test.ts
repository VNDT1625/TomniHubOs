import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {},
  BrowserWindow: {},
  dialog: {},
  ipcMain: {},
  MessageChannelMain: {},
}));

import type {
  GoalSurfacePlan,
  PackageManifest,
  PackageSurfaceAiOperation,
  SurfacePlanningStep,
} from '@/common/packages';
import { packageSignaturePayload } from '@/common/packages';
import type { RunIntent } from '@/common/foundation/runTypes';
import { createHubGoalSurfacePlanCache } from '@/process/bridge/foundationBridge';
import { EventStore } from '@/process/foundation/eventStore';
import { RunKernel } from '@/process/foundation/runKernel';
import { SecurityAdapter } from '@/process/foundation/securityAdapter';
import { TrustBroker } from '@/process/foundation/trustBroker';
import { createPackageManagerService } from '@/process/extensions/package-manager';
import { createPackageRuntimeRegistry } from '@/process/extensions/package-manager/packageBridge';
import {
  createRemotePackageCatalogLoader,
  signRemotePackageCatalog,
  type RemotePackageCatalogDocument,
} from '@/process/extensions/package-manager/remoteCatalog';
import { JsonlDurableEventStore } from '@/process/services/agentChat/durability';
import {
  createJsonSurfaceAiAccessConsentAuthority,
  createSurfaceAiAccessBroker,
  createSurfaceAiAccessConsentChallengeAuthority,
  createSurfaceAiOperationDispatcher,
} from '@/process/resources/packageCapability/surfaceAiAccessBroker';
import { createSurfaceAiActionController } from '@/process/resources/packageCapability/goalCapability/surfaceAiActionController';
import { createSurfaceAiObservationStore } from '@/process/resources/packageProcessRuntime/surfaceAiObservationStore';
import {
  createSurfaceAiRuntimeTransportRegistry,
  type SurfaceAiRuntimeTransportBinding,
  type SurfaceAiRuntimeTransportEndpoint,
} from '@/process/resources/packageCapability/surfaceAiRuntimeTransport';

const roots: string[] = [];
const now = Date.UTC(2030, 7, 1, 12, 0, 0);
const accountId = 'account-c4';
const ownerId = 'window-c4';
const runtimeId = 'runtime-c4';
const packageId = 'com.example.local-builder';
const operation: PackageSurfaceAiOperation = {
  id: 'workspace.write-files',
  capability: 'workspace.write',
  inputSchemaVersion: 1,
  dataClasses: ['workspace', 'conversation'],
  destinationIds: ['local-builder'],
};
const surface = { packageId, packageVersion: '1.0.0', publisherId: 'com.example' } as const;
const surfaceCapability = `surface.ai:${packageId}:${operation.id}`;

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const artifactIntegrity = (files: Readonly<Record<string, Buffer>>): { integrity: string; sizeBytes: number } => {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for (const [file, content] of Object.entries(files).toSorted(([left], [right]) => left.localeCompare(right))) {
    hash.update(file);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
    sizeBytes += content.byteLength;
  }
  return { integrity: `sha256-${hash.digest('hex')}`, sizeBytes };
};

const signedLocalBuilderArtifact = (privateKey: string): { manifest: PackageManifest; bytes: Buffer } => {
  const files = { 'index.html': Buffer.from('<main>Local Builder</main>') };
  const unsigned: PackageManifest = {
    schemaVersion: 1,
    id: packageId,
    publisherId: surface.publisherId,
    name: 'Local Builder',
    description: 'A reviewed local Surface used only by the C4 integration journey.',
    type: 'app',
    bundleKind: 'single',
    version: surface.packageVersion,
    engines: { tomni: '>=1.0.0 <2.0.0' },
    modules: [
      {
        id: 'builder',
        title: 'Builder',
        surface: 'apps/local-builder',
        pinnable: true,
        runtime: 'sandboxed-web',
        entrypoint: 'index.html',
      },
    ],
    permissions: [],
    dependencies: [],
    tags: ['builder', 'local'],
    contributions: { version: 1, apps: [{ id: 'builder', title: 'Builder', moduleId: 'builder' }] },
    aiAccess: { schemaVersion: 1, operations: [structuredClone(operation)] },
    artifact: {
      ...artifactIntegrity(files),
      signature: { algorithm: 'ed25519', keyId: 'local-builder-key', value: '' },
    },
  };
  const manifest: PackageManifest = {
    ...unsigned,
    artifact: {
      ...unsigned.artifact!,
      signature: {
        ...unsigned.artifact!.signature,
        value: sign(null, Buffer.from(packageSignaturePayload(unsigned)), privateKey).toString('base64'),
      },
    },
  };
  return {
    manifest,
    bytes: Buffer.from(
      JSON.stringify({
        format: 'tomni-package-bundle-v1',
        manifest,
        files: Object.fromEntries(Object.entries(files).map(([file, content]) => [file, content.toString('base64')])),
      })
    ),
  };
};

/**
 * A local sandbox peer for the production, schema-checked runtime transport.
 * It is intentionally only a MessagePort peer: package admission, consent,
 * Trust, dispatch, lifecycle, and receipt handling stay on production paths.
 */
class LocalBuilderRuntimePeer {
  public readonly sent: unknown[] = [];
  public invocationCount = 0;
  public mode: 'complete' | 'hold' = 'complete';
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly closeListeners = new Set<() => void>();
  private started: (() => void) | undefined;

  public readonly endpoint: SurfaceAiRuntimeTransportEndpoint = {
    postMessage: (message) => this.receiveFromMain(message),
    close: () => {
      for (const listener of this.closeListeners) listener();
    },
    onMessage: (listener) => {
      this.messageListeners.add(listener);
      return () => this.messageListeners.delete(listener);
    },
    onClose: (listener) => {
      this.closeListeners.add(listener);
      return () => this.closeListeners.delete(listener);
    },
  };

  public signalReady(binding: SurfaceAiRuntimeTransportBinding): void {
    this.emit({ type: 'ready', schemaVersion: 1, sequence: 0, binding });
  }

  public waitForInvocation(): Promise<void> {
    return new Promise((resolve) => {
      this.started = resolve;
    });
  }

  private emit(message: unknown): void {
    for (const listener of this.messageListeners) listener(message);
  }

  private receiveFromMain(message: unknown): void {
    this.sent.push(message);
    if (!message || typeof message !== 'object' || (message as { type?: unknown }).type !== 'invoke') return;
    const invocation = message as {
      invocationId: string;
      runId: string;
      operationId: string;
      operationSchemaVersion: 1;
    };
    this.invocationCount += 1;
    this.started?.();
    this.started = undefined;
    if (this.mode === 'hold') return;
    queueMicrotask(() => {
      this.emit({
        type: 'progress',
        schemaVersion: 1,
        sequence: 1,
        invocationId: invocation.invocationId,
        runId: invocation.runId,
        operationId: invocation.operationId,
        operationSchemaVersion: invocation.operationSchemaVersion,
        phase: 'writing',
        completed: 1,
        total: 1,
      });
      this.emit({
        type: 'result',
        schemaVersion: 1,
        sequence: 2,
        invocationId: invocation.invocationId,
        runId: invocation.runId,
        operationId: invocation.operationId,
        operationSchemaVersion: invocation.operationSchemaVersion,
        artifactRefs: ['artifact:app-abc'],
        evidenceRefs: ['runtime:local-builder'],
      });
    });
  }
}

const parentIntentFor = (runId: string): RunIntent => ({
  runId,
  rootTaskId: `task-${runId}`,
  surface: 'hub',
  goal: 'Create app ABC locally.',
  constraints: [],
  successCriteria: ['A local project artifact exists.'],
  workspaceScope: 'workspace:default',
  userId: accountId,
  createdAt: now,
  correlationId: `correlation-${runId}`,
  policyVersion: 'trust-v1',
  capabilityGrant: ['target.execute', surfaceCapability],
  budget: { maxEstimatedCostMB: 64, maxSteps: 1 },
});

const planFor = (requestId: string): GoalSurfacePlan => {
  const candidate = {
    schemaVersion: 1 as const,
    candidateId: `surface:${packageId}:${surface.packageVersion}:${operation.id}`,
    package: surface,
    contribution: { package: surface, contributionId: 'builder' },
    capability: operation.capability,
    state: 'ready-local' as const,
    trusted: true,
    compatible: true,
    healthy: true,
    dataLocation: 'local-only' as const,
    supportsUi: true,
    supportsOffline: true,
    reasonCodes: [`store:${packageId}`, `operation:${operation.id}`],
  };
  const step: Extract<SurfacePlanningStep, Readonly<{ kind: 'execute-local' }>> = {
    kind: 'execute-local',
    query: {
      schemaVersion: 1,
      queryId: `query-${requestId}`,
      requester: { packageId: 'com.tomni.hub', packageVersion: '1.0.0', publisherId: 'com.tomni' },
      capability: operation.capability,
      purpose: 'Create app ABC locally.',
      dataLocation: 'local-only',
      requireUi: true,
      requireOffline: true,
      idempotencyKey: `idempotency-${requestId}`,
    },
    resolution: {
      schemaVersion: 1,
      queryId: `query-${requestId}`,
      candidates: [candidate],
      selectedCandidateId: candidate.candidateId,
      evaluatedAt: new Date(now).toISOString(),
    },
    candidate,
  };
  return { schemaVersion: 1, requestId, goalDigest: `sha256-${requestId}`, requirementCount: 1, steps: [step] };
};

describe('C4 local reviewed Surface journey', () => {
  it('installs a reviewed signed builder, invokes it once with consent, persists parent/child receipts, and fails closed across cancel, restart, revoke, and uninstall', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-c4-local-surface-journey-'));
    roots.push(root);
    const packageSigningKey = generateKeyPairSync('ed25519');
    const privateKey = packageSigningKey.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const publicKey = packageSigningKey.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const storeSigningKey = generateKeyPairSync('ed25519');
    const storePrivateKey = storeSigningKey.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const storePublicKey = storeSigningKey.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const artifact = signedLocalBuilderArtifact(privateKey);
    const artifactUrl = 'https://artifacts.example/local-builder.tomni';
    const catalogUrl = 'https://catalog.example/c4-local-surface.json';
    const signedCatalog: RemotePackageCatalogDocument = signRemotePackageCatalog(
      {
        schemaVersion: 1,
        revision: 1,
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 24 * 60 * 60 * 1_000).toISOString(),
        packages: [
          {
            manifest: artifact.manifest,
            delivery: 'downloaded-package',
            trust: 'signed-store',
            artifactUrl,
            publicationReview: {
              schemaVersion: 1,
              disposition: 'auto-approved',
              fingerprint: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              reviewedAt: new Date(now).toISOString(),
            },
          },
        ],
      },
      'store-c4-key',
      storePrivateKey
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        return url === artifactUrl
          ? new Response(artifact.bytes, {
              status: 200,
              headers: { 'content-length': String(artifact.bytes.byteLength) },
            })
          : new Response(null, { status: 404 });
      })
    );

    const runtimeRegistry = createPackageRuntimeRegistry();
    const service = createPackageManagerService({
      rootDir: path.join(root, 'store'),
      appVersion: '1.2.0',
      catalog: [],
      catalogLoader: createRemotePackageCatalogLoader({
        url: catalogUrl,
        cachePath: path.join(root, 'store-catalog-cache.json'),
        fallbackCatalog: [],
        trustedKeys: { 'local-builder-key': publicKey, 'store-c4-key': storePublicKey },
        fetcher: async (input) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
          return url === catalogUrl
            ? new Response(JSON.stringify(signedCatalog), { status: 200 })
            : new Response(null, { status: 404 });
        },
        now: () => new Date(now),
      }),
      trustedKeys: { 'local-builder-key': publicKey, 'store-c4-key': storePublicKey },
      isPackageSandboxActive: runtimeRegistry.isActive,
      reservePackageSandboxMutation: runtimeRegistry.reserveMutation,
      revokePackageSandbox: runtimeRegistry.revokePackage,
      now: () => now,
    });
    await service.initialize();
    const installed = await service.install(packageId);
    expect(installed).toMatchObject({
      state: 'installed',
      enabled: true,
      installedPublicationReview: { disposition: 'auto-approved' },
      installedManifest: { id: packageId, aiAccess: { operations: [{ id: operation.id }] } },
    });
    expect((await service.contributions()).snapshot.apps.map((app) => app.packageId)).toEqual([packageId]);

    runtimeRegistry.open(ownerId, {
      packageId,
      packageVersion: surface.packageVersion,
      publisherId: surface.publisherId,
      moduleId: 'builder',
      runtimeId,
    });
    const binding: SurfaceAiRuntimeTransportBinding = {
      surface,
      ownerId,
      runtimeId,
      moduleId: 'builder',
      artifactIntegrity: artifact.manifest.artifact!.integrity,
    };
    const peer = new LocalBuilderRuntimePeer();
    const transport = createSurfaceAiRuntimeTransportRegistry();
    transport.register(binding, peer.endpoint);
    peer.signalReady(binding);
    const unsubscribeRuntimeInvalidation = runtimeRegistry.onInvalidated((event) => transport.invalidate(event));

    const consentAuthority = createJsonSurfaceAiAccessConsentAuthority({
      filePath: path.join(root, 'consents.json'),
      now: () => now,
    });
    await consentAuthority.initialize();
    const currentLocalSurface = () => {
      const active = runtimeRegistry.getRuntimeBinding(ownerId, packageId, runtimeId);
      if (
        !active ||
        installed.state !== 'installed' ||
        !installed.enabled ||
        installed.installedPublicationReview?.disposition !== 'auto-approved' ||
        installed.installedManifest?.id !== packageId
      ) {
        return undefined;
      }
      return {
        identity: surface,
        manifest: { aiAccess: installed.installedManifest.aiAccess },
        approvedForAiAccess: true,
        revoked: false,
      };
    };
    const challenges = createSurfaceAiAccessConsentChallengeAuthority({
      consentAuthority,
      resolveActiveLocalSurface: (candidatePackageId) =>
        candidatePackageId === packageId ? currentLocalSurface() : undefined,
      now: () => now,
      createChallengeId: () => 'challenge-c4',
      createConsentId: () => 'consent-c4',
    });
    const challenge = challenges.issue({
      ownerId,
      accountId,
      packageId,
      operationId: operation.id,
      secretUse: false,
      limits: { maxEstimatedCostMB: 64, maxSteps: 1 },
    });
    const confirmed = await challenges.confirm({ ownerId, challengeId: challenge.challengeId, approved: true });
    expect(confirmed).toMatchObject({
      approved: true,
      consent: { consentId: 'consent-c4', surface, operationId: operation.id },
    });

    const journalPath = path.join(root, 'foundation.jsonl');
    const eventStore = new EventStore({ journal: new JsonlDurableEventStore(journalPath) });
    await eventStore.initialize();
    const kernel = new RunKernel({
      eventStore,
      securityAdapter: new SecurityAdapter(
        new TrustBroker({ allowedCapabilities: ['target.execute', surfaceCapability] }, { now: () => now })
      ),
    });
    const broker = createSurfaceAiAccessBroker({
      kernel,
      enabled: () => true,
      now: () => now,
      consentStore: consentAuthority,
      resolveActiveLocalSurface: (candidatePackageId) =>
        candidatePackageId === packageId ? currentLocalSurface() : undefined,
      isExactRuntimeActive: (identity, runtime) =>
        identity.packageId === packageId &&
        runtimeRegistry.ownsRuntime(runtime.ownerId, identity.packageId, runtime.runtimeId),
      onRuntimeInvalidated: runtimeRegistry.onInvalidated,
      trustBroker: new TrustBroker(
        {
          allowedCapabilities: [surfaceCapability],
          allowedOrigins: ['tomny://surface-ai'],
          trustedPackageIds: [packageId],
          requireApprovalForMutation: false,
        },
        { now: () => now }
      ),
      trustOrigin: 'tomny://surface-ai',
    });
    const observations = createSurfaceAiObservationStore({ rootPath: path.join(root, 'observations'), now: () => now });
    const dispatcher = createSurfaceAiOperationDispatcher({
      broker,
      transportRegistry: transport,
      resolveRuntimeBinding: async (identity, runtime) =>
        identity.packageId === packageId &&
        runtimeRegistry.ownsRuntime(runtime.ownerId, identity.packageId, runtime.runtimeId)
          ? binding
          : undefined,
      observationStore: observations,
      createOperationLeaseId: () => 'lease-c4',
      timeoutMs: 15_000,
    });
    const planCache = createHubGoalSurfacePlanCache();
    let actionSequence = 0;
    const controller = createSurfaceAiActionController({
      planCache,
      selectConsent: async () => ({ packageId, operationId: operation.id }),
      createActionId: () => `action-c4-${++actionSequence}`,
      execute: async ({ consentId, signal }) => {
        const sequence = actionSequence;
        const result = await dispatcher.dispatch({
          invocationId: `invocation-c4-${sequence}`,
          consentId,
          accountId,
          surface,
          runtime: { ownerId, runtimeId },
          placement: 'local',
          operationId: operation.id,
          dataClasses: operation.dataClasses,
          destinationIds: operation.destinationIds,
          secretUse: false,
          parentIntent: parentIntentFor(`parent-c4-${sequence}`),
          childRunId: `child-c4-${sequence}`,
          childTaskId: `child-task-c4-${sequence}`,
          budget: { maxEstimatedCostMB: 64, maxSteps: 1 },
          input: { schemaVersion: 1, instruction: 'Create app ABC files.' },
          signal,
        });
        return { receipt: result.childReceipt, targetId: `surface:${packageId}:${operation.id}` };
      },
    });
    const retainPlan = (requestId: string): void =>
      planCache.retain({
        requestId,
        accountId,
        ownerId,
        modelSelectionReceipt: 'model-selection:c4',
        goal: 'Create app ABC locally.',
        plan: planFor(requestId),
      });

    retainPlan('plan-c4-complete');
    const complete = await controller.prepare({ planId: 'plan-c4-complete', stepIndex: 0, accountId, ownerId });
    const completedReceipt = await controller.execute({
      actionId: complete.actionId,
      consentId: 'consent-c4',
      accountId,
      ownerId,
    });
    expect(completedReceipt).toMatchObject({
      runId: 'child-c4-1',
      status: 'verified',
      targetId: `surface:${packageId}:${operation.id}`,
    });
    expect(peer.invocationCount).toBe(1);
    const journal = await readFile(journalPath, 'utf8');
    expect(journal).toContain('parent-c4-1');
    expect(journal).toContain('child-c4-1');
    expect(journal).toContain('surface-ai-observation:sha256-');
    const restartedKernel = new RunKernel({
      eventStore: new EventStore({ journal: new JsonlDurableEventStore(journalPath) }),
    });
    await expect(restartedKernel.getReceiptForAccount(accountId, 'parent-c4-1')).resolves.toMatchObject({
      status: 'verified',
    });
    await expect(restartedKernel.getReceiptForAccount(accountId, 'child-c4-1')).resolves.toMatchObject({
      status: 'verified',
    });

    const restartedParentEvents = await restartedKernel.getEventsForAccount(accountId, 'parent-c4-1');
    const restartedChildEvents = await restartedKernel.getEventsForAccount(accountId, 'child-c4-1');
    expect(restartedParentEvents?.filter((event) => event.eventType === 'run.created')).toHaveLength(1);
    expect(restartedParentEvents?.filter((event) => event.eventType === 'outcome.verified')).toHaveLength(1);
    expect(restartedChildEvents?.filter((event) => event.eventType === 'run.created')).toHaveLength(1);
    expect(restartedChildEvents?.filter((event) => event.eventType === 'outcome.verified')).toHaveLength(1);
    expect(peer.invocationCount).toBe(1);

    const restartedBroker = createSurfaceAiAccessBroker({
      kernel: restartedKernel,
      enabled: () => true,
      now: () => now,
      consentStore: consentAuthority,
      resolveActiveLocalSurface: (candidatePackageId) =>
        candidatePackageId === packageId ? currentLocalSurface() : undefined,
      isExactRuntimeActive: (identity, runtime) =>
        identity.packageId === packageId &&
        runtimeRegistry.ownsRuntime(runtime.ownerId, identity.packageId, runtime.runtimeId),
      onRuntimeInvalidated: runtimeRegistry.onInvalidated,
      trustBroker: new TrustBroker(
        {
          allowedCapabilities: [surfaceCapability],
          allowedOrigins: ['tomny://surface-ai'],
          trustedPackageIds: [packageId],
          requireApprovalForMutation: false,
        },
        { now: () => now }
      ),
      trustOrigin: 'tomny://surface-ai',
    });
    const restartedDispatcher = createSurfaceAiOperationDispatcher({
      broker: restartedBroker,
      transportRegistry: transport,
      resolveRuntimeBinding: async (identity, runtime) =>
        identity.packageId === packageId &&
        runtimeRegistry.ownsRuntime(runtime.ownerId, identity.packageId, runtime.runtimeId)
          ? binding
          : undefined,
      observationStore: observations,
      createOperationLeaseId: () => 'lease-c4-restarted',
      timeoutMs: 15_000,
    });
    const replayed = await restartedDispatcher.dispatch({
      invocationId: 'invocation-c4-1',
      consentId: 'consent-c4',
      accountId,
      surface,
      runtime: { ownerId, runtimeId },
      placement: 'local',
      operationId: operation.id,
      dataClasses: operation.dataClasses,
      destinationIds: operation.destinationIds,
      secretUse: false,
      parentIntent: parentIntentFor('parent-c4-1'),
      childRunId: 'child-c4-1',
      childTaskId: 'child-task-c4-1',
      budget: { maxEstimatedCostMB: 64, maxSteps: 1 },
      input: { schemaVersion: 1, instruction: 'Create app ABC files.' },
    });
    expect(replayed).toMatchObject({
      parentReceipt: { runId: 'parent-c4-1', status: 'verified' },
      childReceipt: { runId: 'child-c4-1', status: 'verified' },
    });
    expect(peer.invocationCount).toBe(1);

    peer.mode = 'hold';
    retainPlan('plan-c4-cancel');
    const cancellable = await controller.prepare({ planId: 'plan-c4-cancel', stepIndex: 0, accountId, ownerId });
    const pendingCancel = controller.execute({
      actionId: cancellable.actionId,
      consentId: 'consent-c4',
      accountId,
      ownerId,
    });
    await peer.waitForInvocation();
    expect(controller.cancel({ actionId: cancellable.actionId, accountId, ownerId })).toBe(true);
    await expect(pendingCancel).resolves.toMatchObject({ status: 'cancelled' });
    expect(peer.invocationCount).toBe(2);
    expect(peer.sent).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'cancel', invocationId: 'invocation-c4-2' })])
    );

    await observations.open({
      accountId,
      runId: 'child-c4-restart',
      invocationId: 'invocation-c4-restart',
      operationId: operation.id,
      surface,
      artifactIntegrity: binding.artifactIntegrity,
    });
    const restartResult = await dispatcher.dispatch({
      invocationId: 'invocation-c4-restart',
      consentId: 'consent-c4',
      accountId,
      surface,
      runtime: { ownerId, runtimeId },
      placement: 'local',
      operationId: operation.id,
      dataClasses: operation.dataClasses,
      destinationIds: operation.destinationIds,
      secretUse: false,
      parentIntent: parentIntentFor('parent-c4-restart'),
      childRunId: 'child-c4-restart',
      childTaskId: 'child-task-c4-restart',
      budget: { maxEstimatedCostMB: 64, maxSteps: 1 },
      input: { schemaVersion: 1, instruction: 'Create app ABC files.' },
    });
    expect(restartResult).toMatchObject({ childReceipt: { status: 'failed' }, parentReceipt: { status: 'failed' } });
    expect(peer.invocationCount).toBe(2);

    retainPlan('plan-c4-revoke');
    const revocable = await controller.prepare({ planId: 'plan-c4-revoke', stepIndex: 0, accountId, ownerId });
    const pendingRevoke = controller.execute({
      actionId: revocable.actionId,
      consentId: 'consent-c4',
      accountId,
      ownerId,
    });
    await peer.waitForInvocation();
    await expect(consentAuthority.revoke('consent-c4')).resolves.toBe(true);
    await expect(pendingRevoke).resolves.toMatchObject({ status: 'cancelled' });
    expect(peer.invocationCount).toBe(3);

    runtimeRegistry.close(ownerId, { packageId, runtimeId });
    await expect(service.uninstall(packageId)).resolves.toMatchObject({ state: 'available', enabled: false });
    expect(runtimeRegistry.isActive(packageId)).toBe(false);
    expect(transport.isActive(binding)).toBe(false);
    expect((await service.contributions()).snapshot.apps).toEqual([]);
    await expect(service.status(packageId)).resolves.toMatchObject({ state: 'available', enabled: false });
    unsubscribeRuntimeInvalidation();
    transport.dispose();
  });
});
