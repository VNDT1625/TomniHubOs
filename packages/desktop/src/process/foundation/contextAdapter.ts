import type { ContextProjection, WorkGraphProjection } from '../../common/foundation/decisionTypes';
import type { RunIntent } from '../../common/foundation/runTypes';

export class ContextAdapter {
  public async projectContext(intent: RunIntent): Promise<ContextProjection> {
    return {
      runId: intent.runId,
      surface: intent.surface,
      text: `Goal: ${intent.goal}\nWorkspace: ${intent.workspaceScope}`,
      sourceRefs: [intent.workspaceScope],
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
