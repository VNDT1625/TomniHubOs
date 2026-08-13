import type { ContextProjection, WorkGraphProjection } from '../../common/foundation/decisionTypes';
import type { RunIntent } from '../../common/foundation/runTypes';
import type { CoreContextComposer } from '../agentRuntime/contextTypes';

export type ContextAdapterOptions = { composer?: CoreContextComposer; agentId?: string };

export class ContextAdapter {
  private readonly agentId: string;

  public constructor(private readonly options: ContextAdapterOptions = {}) {
    this.agentId = options.agentId ?? 'tomny';
  }

  public async projectContext(intent: RunIntent): Promise<ContextProjection> {
    const identity = this.options.composer?.inspectContext
      ? await this.options.composer.inspectContext({
          agentId: this.agentId,
          personalId: intent.userId,
          surface: intent.surface,
          // Foundation receipt projection never exposes opaque secret handles.
          secretContextPolicy: { includeOpaqueSecretHandles: false },
        })
      : undefined;
    return {
      runId: intent.runId,
      surface: intent.surface,
      text: `Goal: ${intent.goal}\nWorkspace: ${intent.workspaceScope}`,
      sourceRefs: [
        intent.workspaceScope,
        ...(identity?.agent ? [`context-agent:${this.agentId}`] : []),
        ...(identity?.personal ? [`context-personal:${intent.userId}`] : []),
      ],
      maxChars: 4000,
      sensitivity: 'normal',
    };
  }

  public async projectWorkGraph(intent: RunIntent): Promise<WorkGraphProjection> {
    return {
      runId: intent.runId,
      task: {
        taskId: intent.rootTaskId,
        runId: intent.runId,
        idempotencyKey: `${intent.runId}:${intent.rootTaskId}:0`,
      },
      goal: intent.goal,
      constraints: intent.constraints,
      successCriteria: intent.successCriteria,
      artifactRefs: [],
    };
  }
}
