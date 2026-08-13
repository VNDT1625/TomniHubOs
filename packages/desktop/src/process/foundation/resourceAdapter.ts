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

  public constructor(private readonly coordinator?: Pick<IResourceCoordinator, 'requestLease' | 'releaseLease'>) {}

  public async requestLease(plan: ExecutionPlan): Promise<ResourceLease> {
    validateExecutionPlan(plan);
    const leaseId = this.coordinator
      ? (
          await this.coordinator.requestLease({
            kind: 'agent',
            estCostMB: plan.estimatedCostMB,
            priority: plan.priority,
            requestId: `foundation:${plan.runId}:${plan.taskId}`,
            owner: { processKind: 'main', serviceId: 'foundation-run-kernel', taskId: plan.taskId },
          })
        ).id
      : `lease_${plan.runId}_${plan.taskId}_${Date.now()}`;
    const lease: ResourceLease = {
      leaseId,
      runId: plan.runId,
      taskId: plan.taskId,
      kind: plan.resourceKind,
      grantedAt: Date.now(),
    };
    this.activeLeases.set(leaseId, lease);
    return lease;
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
