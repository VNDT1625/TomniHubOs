import type { ExecutionPlan } from '../../common/foundation/decisionTypes';
import { validateExecutionPlan } from '../../common/foundation/decisionTypes';

export type ResourceLease = {
  leaseId: string;
  runId: string;
  taskId: string;
  kind: string;
  grantedAt: number;
};

export class ResourceAdapter {
  private activeLeases = new Map<string, ResourceLease>();

  public async requestLease(plan: ExecutionPlan): Promise<ResourceLease> {
    validateExecutionPlan(plan);
    const leaseId = `lease_${plan.runId}_${plan.taskId}_${Date.now()}`;
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
    return this.activeLeases.delete(leaseId);
  }

  public getActiveLeases(): readonly ResourceLease[] {
    return Array.from(this.activeLeases.values());
  }
}
