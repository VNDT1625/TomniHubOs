/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LayaAnswerChoice, LayaPredictor } from '../../security/layaSemanticEgressModel';
import type { ChatStageInput, ChatStageOutput, IChatStage } from '../types';

export type ModelRecommendationTier = 'fast-cheap' | 'strong' | 'best-value';

export class ModelRoutingStage implements IChatStage {
  public readonly id = 'builtin:model-router';
  public readonly displayName = 'Model Selection Advisor';
  public readonly description =
    'Phân loại độ phức tạp bài toán và đề xuất model tối ưu (fast-cheap, strong, best-value) theo bảng giá & benchmark';
  public readonly phase = 'pre_model' as const;
  public readonly icon = 'Lightning';
  public readonly defaultEnabled = false; // Opt-in stage
  public readonly defaultTimeoutMs = 1_000;

  public constructor(private readonly predictor?: LayaPredictor) {}

  public async execute(input: ChatStageInput): Promise<ChatStageOutput> {
    const startTime = Date.now();
    const query = input.query.toLowerCase();

    let complexity = 'simple_chat';
    let method = 'heuristic_fallback';

    if (this.predictor) {
      try {
        const prediction = await this.predictor(
          { query: input.query },
          {
            taskComplexity: {
              type: 'choice',
              instructions: 'Classify the complexity and depth required to answer this request:',
              criteria: {
                simple_chat: 'Simple chat, direct questions, definitions, translation, quick greeting',
                coding_task: 'Writing code, refactoring, fixing bugs, software engineering, terminal tasks',
                deep_reasoning: 'Complex math, architectural design, deep logical deduction, system planning',
              },
            },
          },
          input.signal
        );

        const choice = (prediction.answers['taskComplexity'] as LayaAnswerChoice | undefined)?.choice;
        if (choice) {
          complexity = choice;
          method = 'laya_neural';
        }
      } catch (err) {
        console.warn('[ModelRoutingStage] Laya predictor failed, falling back to heuristic:', err);
      }
    }

    if (method === 'heuristic_fallback') {
      if (
        /(?:phân tích sâu|kiến trúc|chứng minh|tối ưu hóa hệ thống|quy hoạch|logic phức tạp|kế hoạch)/iu.test(query)
      ) {
        complexity = 'deep_reasoning';
      } else if (/(?:code|viết hàm|debug|lập trình|typescript|python| thuật toán|refactor|function)/iu.test(query)) {
        complexity = 'coding_task';
      } else {
        complexity = 'simple_chat';
      }
    }

    const isAutoMode = input.config?.mode === 'auto' || Boolean(input.config?.autoModelSelection);
    const availableModels = (
      Array.isArray(input.config?.availableModels) ? input.config?.availableModels : undefined
    ) as string[] | undefined;

    let recommendedTier: ModelRecommendationTier = 'fast-cheap';
    let recommendedModel = 'claude-3-5-haiku-20241022';

    if (complexity === 'coding_task') {
      recommendedTier = 'strong';
      recommendedModel = 'claude-3-7-sonnet-20250219';
    } else if (complexity === 'deep_reasoning') {
      recommendedTier = 'best-value';
      recommendedModel = 'claude-3-7-sonnet-thought';
    }

    // Match with available live models if provided
    let selectedModel = recommendedModel;
    if (availableModels && availableModels.length > 0) {
      if (complexity === 'coding_task') {
        selectedModel = availableModels.find((m) => /sonnet|codex|code|o3|gpt-4o/i.test(m)) ?? availableModels[0]!;
      } else if (complexity === 'deep_reasoning') {
        selectedModel =
          availableModels.find((m) => /thought|o1|o3|reasoning|r1|deepseek-r1/i.test(m)) ?? availableModels[0]!;
      } else {
        selectedModel = availableModels.find((m) => /haiku|flash|mini|cheap/i.test(m)) ?? availableModels[0]!;
      }
    }

    return {
      decision: 'continue',
      grounding: {
        modelRouting: {
          recommendedTier,
          recommendedModel,
          selectedModel: isAutoMode ? selectedModel : undefined,
          autoSwitched: isAutoMode,
          complexity,
        },
        ...(isAutoMode ? { selectedModel } : {}),
      },
      evidence: {
        latencyMs: Date.now() - startTime,
        complexity,
        recommendedTier,
        recommendedModel,
        selectedModel: isAutoMode ? selectedModel : undefined,
        autoSwitched: isAutoMode,
        method,
      },
    };
  }
}
