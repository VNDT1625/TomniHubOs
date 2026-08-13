import type { OutcomeReceipt } from '../../common/foundation/receiptTypes';
import type { RunIntent } from '../../common/foundation/runTypes';
import type { RunKernel } from './runKernel';
import type { TrustBroker, TrustOperation } from './trustBroker';

export type HubTargetKind = 'cli' | 'cloud' | 'local' | 'mcp';

export type HubExecutionTarget = {
  id: string;
  kind: HubTargetKind;
  priority: number;
  health?: 'healthy' | 'unavailable';
  requestedCapabilities?: readonly string[];
  networkHost?: string;
  /** Main-discovered upper-bound lease estimate used for the Run budget gate. */
  estimatedCostMB?: number;
  execute: (request: {
    intent: RunIntent;
    signal?: AbortSignal;
  }) => Promise<{ text: string; evidenceRefs: readonly string[] }>;
};

export type HubExecutionResult = {
  receipt: OutcomeReceipt;
  targetId?: string;
  text?: string;
};

export type HubExecutionAdapterOptions = {
  trustBroker?: TrustBroker;
  origin?: string;
};

const operationFor = (kind: HubTargetKind): TrustOperation =>
  kind === 'cloud' ? 'network' : kind === 'local' ? 'provider' : kind;

const targetMatchesIntent = (target: HubExecutionTarget, intent: RunIntent): boolean => {
  if (target.health === 'unavailable') return false;
  if (intent.constraints.includes('offline_only') && target.kind !== 'local') return false;
  if (intent.constraints.includes('private_only') && target.kind === 'cloud') return false;
  if (
    intent.capabilityGrant !== undefined &&
    (target.requestedCapabilities ?? []).some((capability) => !intent.capabilityGrant?.includes(capability))
  ) {
    return false;
  }
  if (intent.budget !== undefined && (target.estimatedCostMB ?? 128) > intent.budget.maxEstimatedCostMB) return false;
  const pin = intent.constraints.find((constraint) => constraint.startsWith('target:'));
  return pin === undefined || pin === `target:${target.id}`;
};

/** Routes all supported execution target kinds through the same governed Run Kernel. */
export class HubExecutionAdapter {
  private readonly targets: ReadonlyMap<string, HubExecutionTarget>;

  constructor(
    private readonly kernel: RunKernel,
    targets: readonly HubExecutionTarget[],
    private readonly options: HubExecutionAdapterOptions = {}
  ) {
    const targetMap = new Map(targets.map((target) => [target.id, target]));
    if (targetMap.size !== targets.length) throw new Error('Hub execution target ids must be unique.');
    this.targets = targetMap;
  }

  public async execute(intent: RunIntent, signal?: AbortSignal): Promise<HubExecutionResult> {
    let output: { targetId: string; text: string } | undefined;
    const receipt = await this.kernel.executeRun(
      intent,
      [...this.targets.values()]
        .filter((target) => targetMatchesIntent(target, intent))
        .map((target) => ({
          id: target.id,
          factors: {
            priority: target.priority,
            privacy: intent.constraints.includes('private_only') && target.kind === 'local' ? 1 : 0,
            offline: intent.constraints.includes('offline_only') && target.kind === 'local' ? 1 : 0,
          },
          estimatedCostMB: target.estimatedCostMB ?? 128,
          priority: target.priority,
        })),
      async (_leaseId, executorSignal, targetId) => {
        if (targetId === undefined) throw new Error('Run Kernel did not select an execution target.');
        const target = this.targets.get(targetId);
        if (target === undefined) throw new Error(`Selected execution target is not registered: ${targetId}`);
        if (this.options.trustBroker && this.options.origin) {
          const request = {
            runId: intent.runId,
            taskId: intent.rootTaskId,
            operation: operationFor(target.kind),
            targetId: target.id,
            requestedCapabilities: target.requestedCapabilities ?? [],
            workspaceScope: intent.workspaceScope,
            networkHost: target.networkHost,
          };
          const capability = this.options.trustBroker.requestCapability(request, this.options.origin);
          if (capability.decision !== 'allow') throw new Error(`Hub target denied: ${capability.reasonCode}`);
          const result = await target.execute({ intent, signal: executorSignal });
          const egress = this.options.trustBroker.inspectFinalEgress({
            ...request,
            origin: this.options.origin,
            serializedPayload: result.text,
          });
          if (egress.decision !== 'allow') throw new Error(`Hub final egress denied: ${egress.reasonCode}`);
          output = { targetId, text: result.text };
          return { evidenceRefs: result.evidenceRefs };
        }
        const result = await target.execute({ intent, signal: executorSignal });
        output = { targetId, text: result.text };
        return { evidenceRefs: result.evidenceRefs };
      },
      signal
    );
    return { receipt, targetId: output?.targetId, text: output?.text };
  }
}
