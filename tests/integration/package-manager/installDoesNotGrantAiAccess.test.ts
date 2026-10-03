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
const accountId = 'account-c1';
const packageId = 'org.example.ai-gated';
const runtimeId = 'runtime-c1';
const ownerId = 'window-c1';
const operation: PackageSurfaceAiOperation = {
  id: 'workspace.write-files',
  capability: 'workspace.write',
  inputSchemaVersion: 1,
  dataClasses: ['workspace', 'conversation'],
  destinationIds: ['local-builder'],
};

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-c1-install-ai-'));
  roots.push(root);
  return root;
};

const parentIntent = (surfaceCapability: string): RunIntent => ({
  runId: 'parent-c1',
  rootTaskId: 'task-c1',
  surface: 'hub',
  goal: 'Create a local project.',
  constraints: [],
  successCriteria: ['A project exists.'],
  workspaceScope: 'workspace:default',
  userId: accountId,
  createdAt: now,
  correlationId: 'correlation-c1',
  policyVersion: 'trust-v1',
  capabilityGrant: ['target.execute', surfaceCapability],
  budget: { maxEstimatedCostMB: 64, maxSteps: 1 },
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('C1 installation and AI authorization separation', () => {
  it('does not create AI consent or permit broker dispatch when a reviewed package is newly installed and enabled', async () => {
    const storeRoot = await tempRoot();
    const sourceDirectory = await tempRoot();
    await mkdir(path.join(sourceDirectory, 'dist'), { recursive: true });
    await writeFile(path.join(sourceDirectory, 'index.html'), '<main>AI gated builder</main>');
    await writeFile(path.join(sourceDirectory, 'dist', 'main.js'), 'export const ready = true;\n');

    const artifact = await computeArtifactIntegrity(sourceDirectory);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const unsignedManifest: PackageManifest = {
      schemaVersion: 1,
      id: packageId,
      publisherId: 'org.example',
      name: 'AI-gated Builder',
      description: 'A reviewed Store app whose AI access requires separate consent.',
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
        signature: { algorithm: 'ed25519', keyId: 'package-c1-key', value: '' },
      },
    };
    const signature = sign(null, Buffer.from(packageSignaturePayload(unsignedManifest)), privateKey).toString('base64');
    const manifest: PackageManifest = {
      ...unsignedManifest,
      artifact: {
        ...unsignedManifest.artifact!,
        signature: { algorithm: 'ed25519', keyId: 'package-c1-key', value: signature },
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
      trustedKeys: { 'package-c1-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
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

    const listing = await service.status(packageId);
    const installedManifest = listing.installedManifest;
    expect(installedManifest).toBeDefined();
    if (!installedManifest) throw new Error('Expected installed manifest.');
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
    expect(consentAuthority.listForAccount(accountId)).toEqual([]);

    const resolveActiveLocalSurface = (candidatePackageId: string) =>
      candidatePackageId === packageId
        ? {
            identity: surface,
            manifest: { aiAccess: installedManifest.aiAccess },
            approvedForAiAccess: true,
            revoked: false,
          }
        : undefined;
    const eventStore = new EventStore({ journal: new JsonlDurableEventStore(path.join(storeRoot, 'runs.jsonl')) });
    await eventStore.initialize();
    const broker = createSurfaceAiAccessBroker({
      kernel: new RunKernel({
        eventStore,
        securityAdapter: new SecurityAdapter(
          new TrustBroker({ allowedCapabilities: ['target.execute', surfaceCapability] }, { now: () => now })
        ),
      }),
      enabled: () => true,
      now: () => now,
      consentStore: consentAuthority,
      resolveActiveLocalSurface,
      isExactRuntimeActive: (candidate, runtime) =>
        candidate.packageId === packageId &&
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
    const invokeSurface = vi.fn();

    await expect(
      broker.invoke({
        invocationId: 'invocation-without-consent',
        consentId: 'consent-not-confirmed',
        accountId,
        surface,
        runtime: { ownerId, runtimeId },
        placement: 'local',
        operationId: operation.id,
        dataClasses: operation.dataClasses,
        destinationIds: operation.destinationIds,
        secretUse: false,
        parentIntent: parentIntent(surfaceCapability),
        childRunId: 'child-without-consent',
        childTaskId: 'task-child-without-consent',
        budget: { maxEstimatedCostMB: 64, maxSteps: 1 },
        input: { schemaVersion: 1, instruction: 'Create the project.' },
        invokeSurface,
      })
    ).rejects.toMatchObject<Partial<SurfaceAiAccessBrokerError>>({ code: 'SURFACE_AI_ACCESS_CONSENT_UNAVAILABLE' });
    expect(invokeSurface).not.toHaveBeenCalled();
    expect(consentAuthority.listForAccount(accountId)).toEqual([]);

    const challenges = createSurfaceAiAccessConsentChallengeAuthority({
      consentAuthority,
      resolveActiveLocalSurface,
      now: () => now,
      createChallengeId: () => 'challenge-c1',
      createConsentId: () => 'consent-c1',
    });
    const challenge = challenges.issue({
      ownerId,
      accountId,
      packageId,
      operationId: operation.id,
      secretUse: false,
      limits: { maxEstimatedCostMB: 64, maxSteps: 1 },
    });
    await expect(
      challenges.confirm({ ownerId, challengeId: challenge.challengeId, approved: true })
    ).resolves.toMatchObject({
      approved: true,
      consent: { consentId: 'consent-c1', surface, operationId: operation.id },
    });
    expect(consentAuthority.listForAccount(accountId)).toHaveLength(1);
  });
});
