import type { ExecutionPlan } from '../../common/foundation/decisionTypes';
import { validateExecutionPlan } from '../../common/foundation/decisionTypes';
import type { IResourceCoordinator } from '../resource/resourceCoordinator';

export type ResourceLease = {
  leaseId: string;
  runId: string;
  taskId: string;
  kind: string;
  grantedAt: number;
};

export class ResourceAdapter {
  private activeLeases = new Map<string, ResourceLease>();

  public constructor(
    private readonly coordinator?: Pick<IResourceCoordinator, 'requestLease' | 'releaseLease' | 'cancelQueuedRequest'>
  ) {}

  public async requestLease(plan: ExecutionPlan, signal?: AbortSignal): Promise<ResourceLease> {
    validateExecutionPlan(plan);
    if (signal?.aborted) throw new Error('RESOURCE_LEASE_ABORTED');
    const requestId = `foundation:${plan.runId}:${plan.taskId}`;
    let aborted = false;
    const abort = (): void => {
      aborted = true;
      this.coordinator?.cancelQueuedRequest(requestId);
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const leaseId = this.coordinator
        ? (
            await this.coordinator.requestLease({
              kind: 'agent',
              estCostMB: plan.estimatedCostMB,
              priority: plan.priority,
              requestId,
              owner: { processKind: 'main', serviceId: 'foundation-run-kernel', taskId: plan.taskId },
            })
          ).id
        : `lease_${plan.runId}_${plan.taskId}_${Date.now()}`;
      if (aborted) {
        this.coordinator?.releaseLease(leaseId);
        throw new Error('RESOURCE_LEASE_ABORTED');
      }
      const lease: ResourceLease = {
        leaseId,
        runId: plan.runId,
        taskId: plan.taskId,
        kind: plan.resourceKind,
        grantedAt: Date.now(),
      };
      this.activeLeases.set(leaseId, lease);
      return lease;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  public async releaseLease(leaseId: string): Promise<boolean> {
    const active = this.activeLeases.get(leaseId);
    if (!active) return false;
    this.activeLeases.delete(leaseId);
    if (this.coordinator) this.coordinator.releaseLease(leaseId);
    return true;
  }

  public getActiveLeases(): readonly ResourceLease[] {
    return Array.from(this.activeLeases.values());
  }
}
