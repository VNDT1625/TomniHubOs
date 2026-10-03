import { describe, expect, it } from 'vitest';
import type { CapabilityCandidate, CapabilityQuery } from '@/common/packages';
import { createSurfacePlanningService } from '@/process/resources/packageCapability/surfacePlanningService';

const query: CapabilityQuery = {
  schemaVersion: 1,
  queryId: 'create-app-workspace-write',
  requester: { packageId: 'com.tomni.hub', packageVersion: '1.0.0', publisherId: 'com.tomni' },
  capability: 'workspace.write',
  purpose: 'Create an application.',
  dataLocation: 'local-only',
  requireUi: true,
  requireOffline: false,
  idempotencyKey: 'plan-create-app-1',
};

const candidate = (overrides: Partial<CapabilityCandidate> = {}): CapabilityCandidate => ({
  schemaVersion: 1,
  candidateId: 'surface:com.tomni.ide:1.0.0:workspace.write-files',
  package: { packageId: 'com.tomni.ide', packageVersion: '1.0.0', publisherId: 'com.tomni' },
  contribution: {
    package: { packageId: 'com.tomni.ide', packageVersion: '1.0.0', publisherId: 'com.tomni' },
    contributionId: 'ide',
  },
  capability: 'workspace.write',
  state: 'ready-local',
  trusted: true,
  compatible: true,
  healthy: true,
  dataLocation: 'local-only',
  supportsUi: true,
  supportsOffline: true,
  reasonCodes: [],
  ...overrides,
});

describe('SurfacePlanningService', () => {
  it('uses an eligible installed local Surface before any Store installation candidate', async () => {
    const planner = createSurfacePlanningService({
      sources: [
        {
          collect: async () => [
            candidate(),
            candidate({
              candidateId: 'surface:com.tomni.ide:1.1.0:workspace.write-files',
              state: 'installable',
              healthy: false,
              supportsOffline: false,
            }),
          ],
        },
      ],
      createProposalId: () => 'proposal-1',
      requiresPurchase: () => false,
      evaluatedAt: () => '2026-08-20T00:00:00.000Z',
    });

    await expect(planner.plan({ queries: [query], requestedAt: '2026-08-20T00:00:00.000Z' })).resolves.toMatchObject([
      { kind: 'execute-local', candidate: { candidateId: candidate().candidateId } },
    ]);
  });

  it('returns a reviewable install proposal rather than installing or purchasing a matching Store Surface', async () => {
    const planner = createSurfacePlanningService({
      sources: [{ collect: async () => [candidate({ state: 'installable', healthy: false, supportsOffline: false })] }],
      createProposalId: () => 'proposal-install-1',
      requiresPurchase: () => true,
      evaluatedAt: () => '2026-08-20T00:00:00.000Z',
    });

    await expect(planner.plan({ queries: [query], requestedAt: '2026-08-20T00:00:00.000Z' })).resolves.toMatchObject([
      {
        kind: 'propose-install',
        proposal: { proposalId: 'proposal-install-1', requiresInstall: true, requiresPurchase: true },
      },
    ]);
  });

  it('does not silently route to an incompatible or untrusted Surface', async () => {
    const planner = createSurfacePlanningService({
      sources: [
        {
          collect: async () => [
            candidate({ trusted: false, compatible: false, reasonCodes: ['STORE_REVIEW_REQUIRED'] }),
          ],
        },
      ],
      createProposalId: () => 'proposal-never',
      requiresPurchase: () => false,
      evaluatedAt: () => '2026-08-20T00:00:00.000Z',
    });

    await expect(planner.plan({ queries: [query], requestedAt: '2026-08-20T00:00:00.000Z' })).resolves.toMatchObject([
      { kind: 'blocked', reasonCodes: ['INCOMPATIBLE', 'STORE_REVIEW_REQUIRED', 'UNTRUSTED'] },
    ]);
  });
});
