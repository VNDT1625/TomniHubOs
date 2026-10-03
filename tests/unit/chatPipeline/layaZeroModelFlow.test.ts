/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { ToolRouterStage } from '@/process/services/chatPipeline/stages/toolRouterStage';
import { ModelRoutingStage } from '@/process/services/chatPipeline/stages/modelRoutingStage';
import type { LayaPredictor } from '@/process/services/security';

describe('Laya Dual-Path Flow (Zero-Model Tool Execution vs Reasoning Model Gate)', () => {
  describe('Path 1: Deterministic Tool Execution (Zero Model Required)', () => {
    it('routes direct browser command without needing any model', async () => {
      const stage = new ToolRouterStage();
      const result = await stage.execute({
        schemaVersion: 1,
        runId: 'run-tool-1',
        stageId: 'builtin:tool-router',
        query: 'mở browser và kiểm tra trang web',
      });

      expect(result.decision).toBe('continue');
      expect(result.grounding?.toolRouter?.requiresBrowser).toBe(true);
      expect(result.grounding?.toolRouter?.selectedTools).toContain('browser_action');
    });

    it('routes code/terminal intent directly via pattern matching', async () => {
      const stage = new ToolRouterStage();
      const result = await stage.execute({
        schemaVersion: 1,
        runId: 'run-tool-2',
        stageId: 'builtin:tool-router',
        query: 'viết code kiểm tra git status',
      });

      expect(result.decision).toBe('continue');
      expect(result.grounding?.toolRouter?.selectedTools).toContain('code_executor');
    });
  });

  describe('Path 2: Reasoning/Planning Task (Requires Model Connection)', () => {
    it('identifies planning task as deep reasoning', async () => {
      const stage = new ModelRoutingStage();
      const result = await stage.execute({
        schemaVersion: 1,
        runId: 'run-reasoning-1',
        stageId: 'builtin:model-router',
        query: 'hãy lập kế hoạch kiến trúc hệ thống phân tán microservices',
        config: { mode: 'auto', availableModels: [] },
      });

      expect(result.decision).toBe('continue');
      expect(result.grounding?.modelRouting?.complexity).toBe('deep_reasoning');
      expect(result.grounding?.modelRouting?.recommendedTier).toBe('best-value');
    });

    it('identifies coding task as requiring strong model', async () => {
      const stage = new ModelRoutingStage();
      const result = await stage.execute({
        schemaVersion: 1,
        runId: 'run-reasoning-2',
        stageId: 'builtin:model-router',
        query: 'refactor toàn bộ module auth và tối ưu hóa hiệu năng',
        config: { mode: 'auto', availableModels: [] },
      });

      expect(result.decision).toBe('continue');
      expect(result.grounding?.modelRouting?.complexity).toBe('coding_task');
      expect(result.grounding?.modelRouting?.recommendedTier).toBe('strong');
    });
  });
});
