import { describe, expect, it } from 'vitest';

import type { CapabilityQuery, PackageIdentity, PackageListing, PackageManifest } from '@/common/packages';
import { createGoalSurfacePlanningRuntime } from '@/process/resources/packageCapability/goalSurfacePlanningRuntime';

const hubIdentity: PackageIdentity = {
  packageId: 'com.tomni.hub',
  packageVersion: '1.0.0',
  publisherId: 'com.tomni',
};

const query: CapabilityQuery = {
  schemaVersion: 1,
  queryId: 'c4-alternative-builder-workspace-write',
  requester: hubIdentity,
  capability: 'workspace.write',
  purpose: 'Create an app.',
  dataLocation: 'local-only',
  requireUi: true,
  requireOffline: false,
  idempotencyKey: 'c4-alternative-builder-workspace-write-1',
};

const reviewedAt = '2026-08-22T00:00:00.000Z';

const manifestFor = (input: {
  packageId: string;
  publisherId: string;
  name: string;
  moduleId: string;
  operationId: string;
}): PackageManifest => ({
  schemaVersion: 1,
  id: input.packageId,
  publisherId: input.publisherId,
  name: input.name,
  description: `Reviewed ${input.name} Surface.`,
  type: 'app',
  bundleKind: 'single',
  version: '1.0.0',
  engines: { tomni: '>=1.0.0' },
  modules: [{ id: input.moduleId, title: input.name, surface: `apps/${input.moduleId}`, pinnable: true }],
  permissions: [],
  dependencies: [],
  tags: ['builder'],
  contributions: { version: 1, apps: [{ id: input.moduleId, title: input.name, moduleId: input.moduleId }] },
  aiAccess: {
    schemaVersion: 1,
    operations: [
      {
        id: input.operationId,
        capability: 'workspace.write',
        inputSchemaVersion: 1,
        dataClasses: ['workspace'],
        destinationIds: [`local:${input.moduleId}`],
      },
    ],
  },
});

const installedListing = (input: { manifest: PackageManifest; enabled: boolean }): PackageListing => ({
  manifest: input.manifest,
  delivery: 'downloaded-package',
  trust: 'signed-store',
  publicationReview: {
    schemaVersion: 1,
    disposition: 'auto-approved',
    fingerprint: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    reviewedAt,
  },
  state: 'installed',
  installedVersion: input.manifest.version,
  installedManifest: input.manifest,
  installedTrust: 'signed-store',
  installedPublicationReview: {
    schemaVersion: 1,
    disposition: 'auto-approved',
    fingerprint: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    reviewedAt,
  },
  updateAvailable: false,
  compatible: true,
  enabled: input.enabled,
});

const planFor = async (listings: readonly PackageListing[]) =>
  createGoalSurfacePlanningRuntime({
    hubIdentity,
    deriver: { derive: async () => [query] },
    store: { list: async () => listings },
    ensureStoreReady: async () => undefined,
    requiresPurchase: () => false,
    evaluatedAt: () => reviewedAt,
  }).plan({ requestId: 'c4-alternative-builder-1', goal: 'Create app ABC.', requestedAt: reviewedAt });

describe('C4 alternative Surface selection', () => {
  it('selects an eligible non-IDE builder deterministically and preserves why the disabled IDE is ineligible', async () => {
    const ide = installedListing({
      manifest: manifestFor({
        packageId: 'com.tomni.ide',
        publisherId: 'com.tomni',
        name: 'IDE',
        moduleId: 'ide',
        operationId: 'workspace.write-files',
      }),
      enabled: false,
    });
    const builder = installedListing({
      manifest: manifestFor({
        packageId: 'com.example.builder',
        publisherId: 'com.example',
        name: 'Builder',
        moduleId: 'builder',
        operationId: 'workspace.write-project',
      }),
      enabled: true,
    });

    const [forward, reverse] = await Promise.all([planFor([ide, builder]), planFor([builder, ide])]);

    expect(forward).toEqual(reverse);
    const [step] = forward.steps;
    if (step?.kind !== 'execute-local') throw new Error('Expected a local planning result.');
    expect(step.candidate).toMatchObject({
      candidateId: 'surface:com.example.builder:1.0.0:workspace.write-project',
      package: { packageId: 'com.example.builder' },
      reasonCodes: ['operation:workspace.write-project', 'store:com.example.builder'],
    });
    expect(step.resolution).toMatchObject({
      selectedCandidateId: 'surface:com.example.builder:1.0.0:workspace.write-project',
      candidates: [
        {
          candidateId: 'surface:com.example.builder:1.0.0:workspace.write-project',
          state: 'ready-local',
        },
        {
          candidateId: 'surface:com.tomni.ide:1.0.0:workspace.write-files',
          state: 'unavailable',
          reasonCodes: expect.arrayContaining(['PACKAGE_DISABLED', 'SOURCE_UNAVAILABLE', 'store:com.tomni.ide']),
        },
      ],
    });
  });
});
