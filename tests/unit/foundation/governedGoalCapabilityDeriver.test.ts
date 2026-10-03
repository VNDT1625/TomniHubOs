import { describe, expect, it, vi } from 'vitest';
import type { PackageIdentity } from '@/common/packages';
import { createGovernedGoalCapabilityDeriver } from '@/process/resources/packageCapability/goalCapability/governedGoalCapabilityDerivationService';

const hubIdentity: PackageIdentity = {
  packageId: 'com.tomni.hub',
  packageVersion: '1.0.0',
  publisherId: 'com.tomni',
};
const input = {
  requestId: 'request-1',
  requestedAt: '2026-08-20T12:00:00.000Z',
  goal: 'Create a private offline note-taking desktop app.',
};
const serviceResult = {
  goalDigest: 'sha256-fixture',
  requirements: [
    { capability: 'workspace.code.edit', dataLocation: 'local-only' as const, requireUi: true, requireOffline: true },
  ],
  targetId: 'target-1',
  selectionReceiptId: 'selection-1',
  executionReceiptId: 'execution-1',
};

const createDeriver = (derive: ReturnType<typeof vi.fn>) =>
  createGovernedGoalCapabilityDeriver(
    { derive },
    {
      accountId: () => 'account-1',
      hubIdentity,
      createQueryId: (_input, index) => `main-query-${index}`,
      createIdempotencyKey: (_input, index) => `main-idempotency-${index}`,
    }
  );

describe('GovernedGoalCapabilityDeriver', () => {
  it('turns service-validated requirements into Hub-owned capability queries', async () => {
    const derive = vi.fn(async () => serviceResult);
    const deriver = createDeriver(derive);

    const result = await deriver.derive(input);

    expect(result).toEqual([
      expect.objectContaining({
        queryId: 'main-query-0',
        idempotencyKey: 'main-idempotency-0',
        requester: hubIdentity,
        purpose: 'Capability requirement: workspace.code.edit',
      }),
    ]);
    expect(derive).toHaveBeenCalledWith({ ...input, accountId: 'account-1' });
    expect(JSON.stringify(result)).not.toContain(input.goal);
  });

  it('abstains when the governed service rejects a target, Trust, or model result', async () => {
    const deriver = createDeriver(vi.fn(async () => Promise.reject(new Error('GOAL_CAPABILITY_TARGET_UNAVAILABLE'))));
    await expect(deriver.derive(input)).resolves.toEqual([]);
  });

  it('does not invoke the service for malformed coordinator input', async () => {
    const derive = vi.fn(async () => serviceResult);
    const deriver = createDeriver(derive);

    await expect(deriver.derive({ ...input, goal: '' })).resolves.toEqual([]);
    expect(derive).not.toHaveBeenCalled();
  });
});
