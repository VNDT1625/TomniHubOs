import { describe, expect, it } from 'vitest';
import { ModelRoutingStage } from '../../../packages/desktop/src/process/services/chatPipeline/stages/modelRoutingStage';
import type { LayaPredictor } from '../../../packages/desktop/src/process/services/security/layaSemanticEgressModel';

describe('ModelRoutingStage (Complexity Assessment & Optimal Model Selection)', () => {
  it('recommends fast-cheap model for simple greeting/question', async () => {
    const stage = new ModelRoutingStage();
    const output = await stage.execute({
      schemaVersion: 1,
      runId: 'run-mod-1',
      stageId: 'step-mod',
      query: 'Chào bạn, thời tiết hôm nay thế nào?',
    });

    expect(output.decision).toBe('continue');
    const grounding = output.grounding?.modelRouting as Record<string, unknown> | undefined;
    expect(grounding?.recommendedTier).toBe('fast-cheap');
    expect(grounding?.recommendedModel).toContain('haiku');
  });

  it('recommends strong model for coding task', async () => {
    const mockPredictor: LayaPredictor = async () => ({
      answers: {
        taskComplexity: {
          choice: 'coding_task',
          confidence: 0.94,
        },
      },
    });

    const stage = new ModelRoutingStage(mockPredictor);
    const output = await stage.execute({
      schemaVersion: 1,
      runId: 'run-mod-2',
      stageId: 'step-mod',
      query: 'Refactor class ChatPipelineExecutor để thêm thread pool worker',
    });

    expect(output.decision).toBe('continue');
    const grounding = output.grounding?.modelRouting as Record<string, unknown> | undefined;
    expect(grounding?.recommendedTier).toBe('strong');
    expect(grounding?.recommendedModel).toContain('sonnet');
    expect(output.evidence?.method).toBe('laya_neural');
  });

  it('recommends best-value model for deep reasoning', async () => {
    const mockPredictor: LayaPredictor = async () => ({
      answers: {
        taskComplexity: {
          choice: 'deep_reasoning',
          confidence: 0.96,
        },
      },
    });

    const stage = new ModelRoutingStage(mockPredictor);
    const output = await stage.execute({
      schemaVersion: 1,
      runId: 'run-mod-3',
      stageId: 'step-mod',
      query: 'Hãy chứng minh tính đúng đắn của thuật toán đồng thuận Paxos trong phân tán',
    });

    expect(output.decision).toBe('continue');
    const grounding = output.grounding?.modelRouting as Record<string, unknown> | undefined;
    expect(grounding?.recommendedTier).toBe('best-value');
    expect(grounding?.recommendedModel).toContain('thought');
  });
});
