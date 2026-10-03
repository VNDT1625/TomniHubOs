import { describe, expect, it } from 'vitest';
import { ModelRoutingStage } from '@/process/services/chatPipeline';
import type { LayaPredictor } from '@/process/services/security';

describe('Auto Model Selection (Autonomous Model Switcher)', () => {
  it('automatically selects optimal coding model when mode is auto', async () => {
    const stage = new ModelRoutingStage();
    const result = await stage.execute({
      schemaVersion: 1,
      runId: 'run-auto-1',
      stageId: 'builtin:model-router',
      query: 'hãy viết code kết nối websocket bằng typescript',
      config: { mode: 'auto' },
    });

    expect(result.decision).toBe('continue');
    expect(result.grounding?.selectedModel).toBe('claude-3-7-sonnet-20250219');
    expect(result.grounding?.modelRouting).toMatchObject({
      recommendedTier: 'strong',
      selectedModel: 'claude-3-7-sonnet-20250219',
      autoSwitched: true,
      complexity: 'coding_task',
    });
  });

  it('filters and selects from available live models pool in auto mode', async () => {
    const stage = new ModelRoutingStage();
    const availablePool = ['gemini-2.0-flash', 'deepseek-chat', 'gpt-4o', 'qwen-coder'];

    const result = await stage.execute({
      schemaVersion: 1,
      runId: 'run-auto-2',
      stageId: 'builtin:model-router',
      query: 'refactor class này theo solid và viết unit test',
      config: {
        mode: 'auto',
        availableModels: availablePool,
      },
    });

    expect(result.decision).toBe('continue');
    expect(result.grounding?.selectedModel).toBe('gpt-4o');
    expect(result.grounding?.modelRouting?.autoSwitched).toBe(true);
  });

  it('selects fast-cheap model for simple chat in auto mode', async () => {
    const stage = new ModelRoutingStage();
    const availablePool = ['claude-3-5-haiku', 'claude-3-7-sonnet'];

    const result = await stage.execute({
      schemaVersion: 1,
      runId: 'run-auto-3',
      stageId: 'builtin:model-router',
      query: 'thủ đô của Pháp là gì?',
      config: {
        mode: 'auto',
        availableModels: availablePool,
      },
    });

    expect(result.decision).toBe('continue');
    expect(result.grounding?.selectedModel).toBe('claude-3-5-haiku');
  });

  it('does not force auto switch when mode is manual/default', async () => {
    const stage = new ModelRoutingStage();
    const result = await stage.execute({
      schemaVersion: 1,
      runId: 'run-manual-1',
      stageId: 'builtin:model-router',
      query: 'viết hàm quicksort bằng python',
      config: { mode: 'manual' },
    });

    expect(result.decision).toBe('continue');
    expect(result.grounding?.selectedModel).toBeUndefined();
    expect(result.grounding?.modelRouting?.recommendedModel).toBe('claude-3-7-sonnet-20250219');
    expect(result.grounding?.modelRouting?.autoSwitched).toBe(false);
  });

  it('uses Laya neural predictor to drive autonomous model selection', async () => {
    const mockPredictor: LayaPredictor = async () => ({
      answers: {
        taskComplexity: { choice: 'deep_reasoning', confidence: 0.95 },
      },
    });

    const stage = new ModelRoutingStage(mockPredictor);
    const result = await stage.execute({
      schemaVersion: 1,
      runId: 'run-auto-4',
      stageId: 'builtin:model-router',
      query: 'bài toán logic phức tạp cần suy luận nhiều bước',
      config: { mode: 'auto' },
    });

    expect(result.decision).toBe('continue');
    expect(result.grounding?.selectedModel).toBe('claude-3-7-sonnet-thought');
    expect(result.evidence?.method).toBe('laya_neural');
  });
});
