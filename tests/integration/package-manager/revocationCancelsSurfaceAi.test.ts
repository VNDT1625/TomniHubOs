import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { packageSignaturePayload, type PackageManifest, type PackageSurfaceAiOperation } from '@/common/packages';
import type { RunIntent } from '@/common/foundation/runTypes';
import { EventStore } from '@/process/foundation/eventStore';
import { RunKernel } from '@/process/foundation/runKernel';
import { SecurityAdapter } from '@/process/foundation/securityAdapter';
import { TrustBroker } from '@/process/foundation/trustBroker';
import {
  computeArtifactIntegrity,
  createPackageManagerService,
  createPackageRuntimeRegistry,
} from '@/process/extensions/package-manager';
import { JsonlDurableEventStore } from '@/process/services/agentChat/durability';
import {
  createJsonSurfaceAiAccessConsentAuthority,
  createSurfaceAiAccessBroker,
  createSurfaceAiAccessConsentChallengeAuthority,
  type SurfaceAiAccessBrokerError,
} from '@/process/resources/packageCapability/surfaceAiAccessBroker';

const roots: string[] = [];
const now = Date.UTC(2030, 7, 1, 12, 0, 0);
const accountId = 'account-c1-revoke';
const ownerId = 'window-c1-revoke';
const runtimeId = 'runtime-c1-revoke';
const packageId = 'org.example.revocation-gated';
const operation: PackageSurfaceAiOperation = {
  id: 'workspace.write-files',
  capability: 'workspace.write',
  inputSchemaVersion: 1,
  dataClasses: ['workspace', 'conversation'],
  destinationIds: ['local-builder'],
};

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-c1-revocation-'));
  roots.push(root);
  return root;
};

const parentIntent = (surfaceCapability: string): RunIntent => ({
  runId: 'parent-c1-revocation',
  rootTaskId: 'task-c1-revocation',
  surface: 'hub',
  goal: 'Create a local project.',
  constraints: [],
  successCriteria: ['A project exists.'],
  workspaceScope: 'workspace:default',
  userId: accountId,
  createdAt: now,
  correlationId: 'correlation-c1-revocation',
  policyVersion: 'trust-v1',
  capabilityGrant: ['target.execute', surfaceCapability],
  budget: { maxEstimatedCostMB: 64, maxSteps: 1 },
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('C1 durable Surface AI consent revocation', () => {
  it('cancels a live Package Manager-backed Surface invocation, releases its leases, and denies a subsequent invocation', async () => {
    const storeRoot = await temporaryRoot();
    const sourceDirectory = await temporaryRoot();
    await mkdir(path.join(sourceDirectory, 'dist'), { recursive: true });
    await writeFile(path.join(sourceDirectory, 'index.html'), '<main>Revocation-gated Builder</main>');
    await writeFile(path.join(sourceDirectory, 'dist', 'main.js'), 'export const ready = true;\n');

    const artifact = await computeArtifactIntegrity(sourceDirectory);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const unsignedManifest: PackageManifest = {
      schemaVersion: 1,
      id: packageId,
      publisherId: 'org.example',
      name: 'Revocation-gated Builder',
      description: 'A signed local Surface whose AI consent can be revoked.',
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=1.0.0' },
      modules: [
        {
          id: 'builder',
          title: 'Builder',
          surface: 'apps/builder',
          pinnable: true,
          runtime: 'sandboxed-web',
          entrypoint: 'index.html',
        },
      ],
      permissions: [],
      dependencies: [],
      tags: ['builder'],
      aiAccess: { schemaVersion: 1, operations: [operation] },
      artifact: {
        ...artifact,
        signature: { algorithm: 'ed25519', keyId: 'package-c1-revoke-key', value: '' },
      },
    };
    const manifest: PackageManifest = {
      ...unsignedManifest,
      artifact: {
        ...unsignedManifest.artifact!,
        signature: {
          algorithm: 'ed25519',
          keyId: 'package-c1-revoke-key',
          value: sign(null, Buffer.from(packageSignaturePayload(unsignedManifest)), privateKey).toString('base64'),
        },
      },
    };
    await writeFile(path.join(sourceDirectory, 'tomny-package.json'), JSON.stringify(manifest));

    const service = createPackageManagerService({
      rootDir: storeRoot,
      appVersion: '1.2.0',
      catalog: [
        {
          manifest,
          delivery: 'downloaded-package',
          trust: 'signed-store',
          sourceDirectory,
          publicationReview: {
            schemaVersion: 1,
            disposition: 'auto-approved',
            fingerprint: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            reviewedAt: new Date(now).toISOString(),
          },
        },
      ],
      trustedKeys: { 'package-c1-revoke-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
      now: () => now,
    });
    await service.initialize();
    await service.install(packageId);
    const installed = await service.status(packageId);
    expect(installed).toMatchObject({ state: 'installed', enabled: true, installedManifest: { id: packageId } });
    const installedManifest = installed.installedManifest;
    if (!installedManifest) throw new Error('Expected the signed package to be installed.');

    const surface = {
      packageId: installedManifest.id,
      packageVersion: installedManifest.version,
      publisherId: installedManifest.publisherId,
    };
    const surfaceCapability = `surface.ai:${packageId}:${operation.id}`;
    const runtimeRegistry = createPackageRuntimeRegistry();
    runtimeRegistry.open(ownerId, {
      packageId,
      packageVersion: surface.packageVersion,
      publisherId: surface.publisherId,
      moduleId: 'builder',
      runtimeId,
    });

    const consentAuthority = createJsonSurfaceAiAccessConsentAuthority({
      filePath: path.join(storeRoot, 'surface-ai-consents.json'),
      now: () => now,
    });
    await consentAuthority.initialize();
    const resolveActiveLocalSurface = (candidatePackageId: string) =>
      candidatePackageId === packageId
        ? {
            identity: surface,
            manifest: { aiAccess: installedManifest.aiAccess },
            approvedForAiAccess: true,
            revoked: false,
          }
        : undefined;
    const challengeAuthority = createSurfaceAiAccessConsentChallengeAuthority({
      consentAuthority,
      resolveActiveLocalSurface,
      now: () => now,
      createChallengeId: () => 'challenge-c1-revoke',
      createConsentId: () => 'consent-c1-revoke',
    });
    const challenge = challengeAuthority.issue({
      ownerId,
      accountId,
      packageId,
      operationId: operation.id,
      secretUse: false,
      limits: { maxEstimatedCostMB: 64, maxSteps: 1 },
    });
    const confirmation = await challengeAuthority.confirm({
      ownerId,
      challengeId: challenge.challengeId,
      approved: true,
    });
    if (!confirmation.consent) throw new Error('Expected confirmed AI-access consent.');

    const eventStore = new EventStore({ journal: new JsonlDurableEventStore(path.join(storeRoot, 'runs.jsonl')) });
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
      resolveActiveLocalSurface,
      assertCurrentLocalSurface: async (candidate, runtime) => {
        const current = await service.status(candidate.packageId);
        return (
          current.state === 'installed' &&
          current.enabled &&
          current.revoked !== true &&
          current.installedManifest?.version === candidate.packageVersion &&
          runtimeRegistry.ownsRuntime(runtime.ownerId, candidate.packageId, runtime.runtimeId)
        );
      },
      isExactRuntimeActive: (candidate, runtime) =>
        runtimeRegistry.ownsRuntime(runtime.ownerId, candidate.packageId, runtime.runtimeId),
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
    const baseRequest = {
      consentId: confirmation.consent.consentId,
      accountId,
      surface,
      runtime: { ownerId, runtimeId },
      placement: 'local' as const,
      operationId: operation.id,
      dataClasses: operation.dataClasses,
      destinationIds: operation.destinationIds,
      secretUse: false,
      parentIntent: parentIntent(surfaceCapability),
      budget: { maxEstimatedCostMB: 64, maxSteps: 1 },
      input: { schemaVersion: 1 as const, instruction: 'Create the project.' },
    };

    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const invokeSurface = vi.fn(
      async ({ signal }: { signal: AbortSignal }) =>
        new Promise<{ evidenceRefs: readonly string[] }>((resolve) => {
          signal.addEventListener('abort', () => resolve({ evidenceRefs: [] }), { once: true });
          markStarted?.();
        })
    );
    const active = broker.invoke({
      ...baseRequest,
      invocationId: 'invocation-c1-revoke-active',
      childRunId: 'child-c1-revoke-active',
      childTaskId: 'task-c1-revoke-active',
      invokeSurface,
    });

    await started;
    expect(kernel.resourceAdapter.getActiveLeases()).not.toEqual([]);
    await expect(consentAuthority.revoke(confirmation.consent.consentId)).resolves.toBe(true);
    await expect(active).resolves.toMatchObject({
      childReceipt: { status: 'cancelled' },
      parentReceipt: { status: 'cancelled' },
    });
    expect(kernel.resourceAdapter.getActiveLeases()).toEqual([]);
    expect(eventStore.getEventsByRunId('child-c1-revoke-active')).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventType: 'lease.released' })])
    );

    const laterInvoke = vi.fn();
    await expect(
      broker.invoke({
        ...baseRequest,
        invocationId: 'invocation-c1-revoke-denied',
        childRunId: 'child-c1-revoke-denied',
        childTaskId: 'task-c1-revoke-denied',
        invokeSurface: laterInvoke,
      })
    ).rejects.toMatchObject<Partial<SurfaceAiAccessBrokerError>>({ code: 'SURFACE_AI_ACCESS_CONSENT_EXPIRED' });
    expect(laterInvoke).not.toHaveBeenCalled();
    expect(kernel.resourceAdapter.getActiveLeases()).toEqual([]);
  });
});
