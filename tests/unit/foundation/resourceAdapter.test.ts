import { describe, expect, it, vi } from 'vitest';

import { ResourceAdapter } from '../../../packages/desktop/src/process/foundation/resourceAdapter';

describe('Foundation ResourceAdapter', () => {
  it('delegates production leases to the shared coordinator and releases the exact granted id', async () => {
    const releaseLease = vi.fn();
    const coordinator = {
      requestLease: vi.fn().mockResolvedValue({ id: 'shared_lease_1' }),
      releaseLease,
    };
    const adapter = new ResourceAdapter(coordinator);

    const lease = await adapter.requestLease({
      runId: 'run_1',
      taskId: 'task_1',
      candidateId: 'target_1',
      resourceKind: 'agent.execution',
      estimatedCostMB: 128,
      priority: 3,
    });

    expect(lease.leaseId).toBe('shared_lease_1');
    expect(coordinator.requestLease).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent', estCostMB: 128, priority: 3, requestId: 'foundation:run_1:task_1' })
    );
    await expect(adapter.releaseLease(lease.leaseId)).resolves.toBe(true);
    expect(releaseLease).toHaveBeenCalledWith('shared_lease_1');
  });
});
