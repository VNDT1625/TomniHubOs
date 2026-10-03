import type { SelectionCandidate, SelectionDecision } from '../../common/foundation/decisionTypes';

export type CandidateEvaluation = {
  candidateId: string;
  score: number;
  eligible: boolean;
  rejectReason?: string;
};

export class ChoiceAdvisor {
  public evaluateCandidates(candidates: readonly SelectionCandidate[], minThreshold = 0.3): SelectionDecision {
    if (candidates.length === 0) {
      return {
        runId: 'none',
        taskId: 'none',
        candidates: [],
        filtered: [],
        explanation: 'No candidates provided for evaluation.',
        retryable: false,
        receiptId: `choice_none_${Date.now()}`,
      };
    }

    const evaluations: CandidateEvaluation[] = candidates.map((c) => {
      const factors = c.factors;
      const totalScore = Object.values(factors).reduce((sum, v) => sum + v, 0);
      const eligible = totalScore >= minThreshold;
      return {
        candidateId: c.id,
        score: totalScore,
        eligible,
        rejectReason: eligible ? undefined : 'SCORE_BELOW_MINIMUM_THRESHOLD',
      };
    });

    const eligible = evaluations.filter((e) => e.eligible);
    const filtered = evaluations
      .filter((e) => !e.eligible)
      .map((e) => ({ id: e.candidateId, reasonCode: e.rejectReason ?? 'REJECTED' }));

    if (eligible.length === 0) {
      return {
        runId: 'eval_run',
        taskId: 'eval_task',
        candidates,
        filtered,
        explanation: 'All candidates rejected due to low factor scores.',
        retryable: true,
        receiptId: `choice_rejected_${Date.now()}`,
      };
    }

    eligible.sort((a, b) => b.score - a.score);
    const winner = eligible[0];

    return {
      runId: 'eval_run',
      taskId: 'eval_task',
      selectedId: winner.candidateId,
      candidates,
      filtered,
      explanation: `Selected ${winner.candidateId} with total factor score ${winner.score.toFixed(2)}.`,
      retryable: true,
      receiptId: `choice_${winner.candidateId}_${Date.now()}`,
    };
  }
}
