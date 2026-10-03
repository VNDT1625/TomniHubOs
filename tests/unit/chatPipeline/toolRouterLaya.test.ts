import { describe, expect, it } from 'vitest';
import { ToolRouterStage } from '../../../packages/desktop/src/process/services/chatPipeline/stages/toolRouterStage';
import type { LayaPredictor } from '../../../packages/desktop/src/process/services/security/layaSemanticEgressModel';

describe('ToolRouterStage (Browser Control & Coding Intent)', () => {
  it('routes to browser_action and identifies browser-control MCP server via pattern fallback', async () => {
    const stage = new ToolRouterStage();
    const output = await stage.execute({
      schemaVersion: 1,
      runId: 'run-1',
      stageId: 'step-tool',
      query: 'Mở trang web https://example.com và kiểm tra tiêu đề',
    });

    expect(output.decision).toBe('continue');
    const grounding = output.grounding?.toolRouter as Record<string, unknown> | undefined;
    expect(grounding).toBeDefined();
    expect(grounding?.requiresBrowser).toBe(true);
    expect(grounding?.selectedTools).toContain('browser_action');
    expect(grounding?.mcpServers).toContain('browser-control');
  });

  it('routes to browser_action using Laya predictor', async () => {
    const mockPredictor: LayaPredictor = async () => ({
      answers: {
        toolDomain: {
          choice: 'browser',
          confidence: 0.98,
        },
      },
    });

    const stage = new ToolRouterStage(mockPredictor);
    const output = await stage.execute({
      schemaVersion: 1,
      runId: 'run-2',
      stageId: 'step-tool',
      query: 'Tra cứu thông tin tuyển dụng trực tuyến trên internet',
    });

    expect(output.decision).toBe('continue');
    const grounding = output.grounding?.toolRouter as Record<string, unknown> | undefined;
    expect(grounding?.requiresBrowser).toBe(true);
    expect(grounding?.selectedTools).toContain('browser_action');
    expect(output.evidence?.method).toBe('laya_neural');
  });

  it('routes to code tools when query is coding related', async () => {
    const mockPredictor: LayaPredictor = async () => ({
      answers: {
        toolDomain: {
          choice: 'code',
          confidence: 0.95,
        },
      },
    });

    const stage = new ToolRouterStage(mockPredictor);
    const output = await stage.execute({
      schemaVersion: 1,
      runId: 'run-3',
      stageId: 'step-tool',
      query: 'Viết một hàm TypeScript tính Fibonacci bằng đệ quy có memoization',
    });

    expect(output.decision).toBe('continue');
    const grounding = output.grounding?.toolRouter as Record<string, unknown> | undefined;
    expect(grounding?.requiresBrowser).toBe(false);
    expect(grounding?.selectedTools).toContain('code_executor');
    expect(grounding?.selectedTools).toContain('file_search');
    expect(output.evidence?.method).toBe('laya_neural');
  });
});
