import { describe, expect, it, vi } from 'vitest';

import type { GoalSurfacePlan, SurfacePlanningStep } from '@/common/packages';
import { createHubGoalSurfacePlanCache } from '@/process/bridge/foundationBridge';
import { createSurfaceAiActionController } from '@/process/resources/packageCapability/goalCapability/surfaceAiActionController';
import type { SurfaceAiActionControllerError } from '@/process/resources/packageCapability/goalCapability/surfaceAiActionController';

const step: SurfacePlanningStep = {
  kind: 'execute-local',
  query: {
    schemaVersion: 1,
    queryId: 'query-1',
    capability: 'workspace.write',
    purpose: 'Build an app',
    dataLocation: 'local-only',
    requireUi: true,
    requireOffline: true,
    idempotencyKey: 'query-1',
  },
  resolution: {
    schemaVersion: 1,
    queryId: 'query-1',
    selectedCandidateId: 'surface:com.tomni.ide:1.0.0:workspace-write',
    candidates: [],
    evaluatedAt: '2030-01-01T00:00:00.000Z',
  },
  candidate: {
    schemaVersion: 1,
    candidateId: 'surface:com.tomni.ide:1.0.0:workspace-write',
    package: { packageId: 'com.tomni.ide', packageVersion: '1.0.0', publisherId: 'com.tomni' },
    capability: 'workspace.write',
    state: 'ready-local',
    trusted: true,
    compatible: true,
    healthy: true,
    dataLocation: 'local-only',
    supportsUi: true,
    supportsOffline: true,
    reasonCodes: [],
  },
};

const plan: GoalSurfacePlan = {
  schemaVersion: 1,
  requestId: 'plan-1',
  goalDigest: 'sha256-goal',
  requirementCount: 1,
  steps: [step],
};

const retain = (cache: ReturnType<typeof createHubGoalSurfacePlanCache>): void =>
  cache.retain({
    requestId: plan.requestId,
    accountId: 'account-1',
    ownerId: 'window-1',
    modelSelectionReceipt: 'model-selection:sha256-test',
    goal: 'Create a private local app',
    plan,
  });

describe('Surface AI action controller', () => {
  it('binds a cached plan to its account/window and returns only a consent identity', async () => {
    const cache = createHubGoalSurfacePlanCache();
    retain(cache);
    const execute = vi.fn();
    const controller = createSurfaceAiActionController({
      planCache: cache,
      selectConsent: vi.fn().mockResolvedValue({ packageId: 'com.tomni.ide', operationId: 'workspace-write' }),
      execute,
      createActionId: () => 'action-1',
    });

    await expect(
      controller.prepare({ planId: plan.requestId, stepIndex: 0, accountId: 'account-1', ownerId: 'other-window' })
    ).rejects.toMatchObject<Partial<SurfaceAiActionControllerError>>({ code: 'SURFACE_AI_ACTION_PLAN_UNAVAILABLE' });
    const prepared = await controller.prepare({
      planId: plan.requestId,
      stepIndex: 0,
      accountId: 'account-1',
      ownerId: 'window-1',
    });

    expect(prepared).toEqual({
      actionId: 'action-1',
      consent: { packageId: 'com.tomni.ide', operationId: 'workspace-write' },
    });
    expect(JSON.stringify(prepared)).not.toContain('Create a private local app');
    await expect(
      controller.execute({
        actionId: prepared.actionId,
        consentId: 'consent-1',
        accountId: 'other',
        ownerId: 'window-1',
      })
    ).rejects.toMatchObject<Partial<SurfaceAiActionControllerError>>({ code: 'SURFACE_AI_ACTION_ACCOUNT_MISMATCH' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('cancels an owned active action and never projects its raw goal in the receipt', async () => {
    const cache = createHubGoalSurfacePlanCache();
    retain(cache);
    const execute = vi.fn(
      async ({ signal }: { signal: AbortSignal }) =>
        await new Promise<never>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('cancelled')))
        )
    );
    const controller = createSurfaceAiActionController({
      planCache: cache,
      selectConsent: async () => ({ packageId: 'com.tomni.ide', operationId: 'workspace-write' }),
      execute,
      createActionId: () => 'action-2',
    });
    const prepared = await controller.prepare({
      planId: plan.requestId,
      stepIndex: 0,
      accountId: 'account-1',
      ownerId: 'window-1',
    });
    const running = controller.execute({
      actionId: prepared.actionId,
      consentId: 'consent-1',
      accountId: 'account-1',
      ownerId: 'window-1',
    });

    expect(controller.cancel({ actionId: prepared.actionId, accountId: 'account-1', ownerId: 'window-1' })).toBe(true);
    await expect(running).rejects.toThrow('cancelled');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: 'Create a private local app',
        consentId: 'consent-1',
        modelSelectionReceipt: 'model-selection:sha256-test',
      })
    );
  });

  it('aborts every ephemeral action when Main invalidates the account execution lifecycle', async () => {
    const cache = createHubGoalSurfacePlanCache();
    retain(cache);
    const controller = createSurfaceAiActionController({
      planCache: cache,
      selectConsent: async () => ({ packageId: 'com.tomni.ide', operationId: 'workspace-write' }),
      execute: async ({ signal }) =>
        await new Promise<never>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('cancelled')))
        ),
      createActionId: () => 'action-revoke-all',
    });
    const prepared = await controller.prepare({
      planId: plan.requestId,
      stepIndex: 0,
      accountId: 'account-1',
      ownerId: 'window-1',
    });
    const running = controller.execute({
      actionId: prepared.actionId,
      consentId: 'consent-1',
      accountId: 'account-1',
      ownerId: 'window-1',
    });

    controller.revokeAll();
    await expect(running).rejects.toThrow('cancelled');
  });
});
