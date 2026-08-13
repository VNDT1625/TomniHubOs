import type { OutcomeReceipt } from '../../common/foundation/receiptTypes';
import type { RunIntent } from '../../common/foundation/runTypes';
import type { RunKernel } from './runKernel';

export type HubTargetKind = 'cli' | 'cloud' | 'local' | 'mcp';

export type HubExecutionTarget = {
  id: string;
  kind: HubTargetKind;
  priority: number;
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

/** Routes all supported execution target kinds through the same governed Run Kernel. */
export class HubExecutionAdapter {
  private readonly targets: ReadonlyMap<string, HubExecutionTarget>;

  constructor(
    private readonly kernel: RunKernel,
    targets: readonly HubExecutionTarget[]
  ) {
    const targetMap = new Map(targets.map((target) => [target.id, target]));
    if (targetMap.size !== targets.length) throw new Error('Hub execution target ids must be unique.');
    this.targets = targetMap;
  }

  public async execute(intent: RunIntent, signal?: AbortSignal): Promise<HubExecutionResult> {
    let output: { targetId: string; text: string } | undefined;
    const receipt = await this.kernel.executeRun(
      intent,
      [...this.targets.values()].map((target) => ({
        id: target.id,
        factors: { priority: target.priority },
      })),
      async (_leaseId, executorSignal, targetId) => {
        if (targetId === undefined) throw new Error('Run Kernel did not select an execution target.');
        const target = this.targets.get(targetId);
        if (target === undefined) throw new Error(`Selected execution target is not registered: ${targetId}`);
        const result = await target.execute({ intent, signal: executorSignal });
        output = { targetId, text: result.text };
        return { evidenceRefs: result.evidenceRefs };
      },
      signal
    );
    return { receipt, targetId: output?.targetId, text: output?.text };
  }
}
