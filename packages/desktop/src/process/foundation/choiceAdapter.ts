import type { SelectionCandidate, SelectionDecision } from '../../common/foundation/decisionTypes';
import type { RunIntent } from '../../common/foundation/runTypes';

export class ChoiceAdapter {
  public async selectCandidate(
    intent: RunIntent,
    candidates: readonly SelectionCandidate[]
  ): Promise<SelectionDecision> {
    if (candidates.length === 0) {
      return {
        runId: intent.runId,
        taskId: intent.rootTaskId,
        candidates: [],
        filtered: [],
        explanation: 'No candidates provided for selection.',
        retryable: false,
        receiptId: `sel_empty_${Date.now()}`,
      };
    }

    // Rank candidates by declared factors. Equal scores use the immutable target
    // id so selection is reproducible regardless of discovery iteration order.
    const ranked = [...candidates].sort((a, b) => {
      const scoreA = Object.values(a.factors).reduce((sum, v) => sum + v, 0);
      const scoreB = Object.values(b.factors).reduce((sum, v) => sum + v, 0);
      return scoreB - scoreA || a.id.localeCompare(b.id);
    });

    const selected = ranked[0];

    return {
      runId: intent.runId,
      taskId: intent.rootTaskId,
      selectedId: selected.id,
      candidates,
      filtered: [],
      explanation: `Selected candidate ${selected.id} based on highest factor score.`,
      retryable: true,
      receiptId: `sel_${selected.id}_${Date.now()}`,
    };
  }
}
