import { describe, expect, it, vi } from 'vitest';
import type { CapabilityCandidate, CapabilityQuery, PackageIdentity } from '@/common/packages';
import { createGoalSurfacePlanningCoordinator } from '@/process/resources/packageCapability/goalSurfacePlanningCoordinator';
import { createSurfacePlanningService } from '@/process/resources/packageCapability/surfacePlanningService';

const hubIdentity: PackageIdentity = {
  packageId: 'com.tomni.hub',
  packageVersion: '1.0.0',
  publisherId: 'com.tomni',
};

const workspaceQuery: CapabilityQuery = {
  schemaVersion: 1,
  queryId: 'create-app-workspace-write',
  requester: hubIdentity,
  capability: 'workspace.write',
  purpose: 'Create and edit an application workspace.',
  dataLocation: 'local-only',
  requireUi: true,
  requireOffline: false,
  idempotencyKey: 'goal-create-app-1',
};

const ideCandidate = (state: CapabilityCandidate['state'] = 'ready-local'): CapabilityCandidate => ({
  schemaVersion: 1,
  candidateId: 'surface:com.tomni.ide:1.0.0:workspace.write',
  package: { packageId: 'com.tomni.ide', packageVersion: '1.0.0', publisherId: 'com.tomni' },
  contribution: {
    package: { packageId: 'com.tomni.ide', packageVersion: '1.0.0', publisherId: 'com.tomni' },
    contributionId: 'ide',
  },
  capability: 'workspace.write',
  state,
  trusted: true,
  compatible: true,
  healthy: state === 'ready-local',
  dataLocation: 'local-only',
  supportsUi: true,
  supportsOffline: state === 'ready-local',
  reasonCodes: [],
});

const plannerFor = (candidate: CapabilityCandidate) =>
  createSurfacePlanningService({
    sources: [{ collect: async () => [candidate] }],
    createProposalId: () => 'proposal-install-ide',
    requiresPurchase: () => false,
    evaluatedAt: () => '2026-08-20T00:00:00.000Z',
  });

describe('GoalSurfacePlanningCoordinator', () => {
  it('turns a create-app goal into a local-first Surface plan without exposing the raw goal in the plan', async () => {
    const rawGoal = 'Create an app that tracks my reading list.';
    const deriver = { derive: vi.fn(async () => [{ ...workspaceQuery, purpose: rawGoal }]) };
    const coordinator = createGoalSurfacePlanningCoordinator({
      hubIdentity,
      deriver,
      surfacePlanner: plannerFor(ideCandidate()),
    });

    const plan = await coordinator.plan({
      requestId: 'goal-create-app-1',
      goal: rawGoal,
      requestedAt: '2026-08-20T00:00:00.000Z',
    });

    expect(plan).toMatchObject({ requirementCount: 1, steps: [{ kind: 'execute-local' }] });
    expect(plan.goalDigest).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(JSON.stringify(plan)).not.toContain(rawGoal);
    expect(plan.steps[0]?.query.purpose).toBe('Capability requirement: workspace.write');
    expect(deriver.derive).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'goal-create-app-1', goal: rawGoal })
    );
  });

  it('returns only an install proposal when the Store candidate is not installed', async () => {
    const coordinator = createGoalSurfacePlanningCoordinator({
      hubIdentity,
      deriver: { derive: async () => [workspaceQuery] },
      surfacePlanner: plannerFor(ideCandidate('installable')),
    });

    await expect(
      coordinator.plan({ requestId: 'goal-install-1', goal: 'Create an app.', requestedAt: '2026-08-20T00:00:00.000Z' })
    ).resolves.toMatchObject({
      steps: [{ kind: 'propose-install', proposal: { proposalId: 'proposal-install-ide' } }],
    });
  });

  it('fails closed when a model-derived requirement impersonates another requester', async () => {
    const planner = { plan: vi.fn() };
    const coordinator = createGoalSurfacePlanningCoordinator({
      hubIdentity,
      deriver: {
        derive: async () => [{ ...workspaceQuery, requester: { ...hubIdentity, packageId: 'org.example.attacker' } }],
      },
      surfacePlanner: planner,
    });

    await expect(
      coordinator.plan({ requestId: 'goal-invalid-1', goal: 'Create an app.', requestedAt: '2026-08-20T00:00:00.000Z' })
    ).rejects.toThrow('GOAL_SURFACE_REQUIREMENTS_INVALID');
    expect(planner.plan).not.toHaveBeenCalled();
  });
});
