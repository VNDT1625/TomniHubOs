import { describe, expect, it } from 'vitest';
import { ToolRouterStage, UNIVERSAL_TOOL_FALLBACK_DIRECTIVE } from '@/process/services/chatPipeline';

describe('ToolRouterStage (Speculative Schema Loading & Autonomous Fallback)', () => {
  it('injects 0 tools for pure greetings to prevent token waste', async () => {
    const stage = new ToolRouterStage();
    const result = await stage.execute({
      schemaVersion: 1,
      runId: 'run-spec-1',
      stageId: 'builtin:tool-router',
      query: 'Xin chào bạn!',
    });

    expect(result.decision).toBe('continue');
    expect(result.grounding?.toolRouter?.selectedTools).toEqual([]);
    expect(result.evidence?.isPureGreeting).toBe(true);
    expect(result.grounding?.toolRouter?.universalDirective).toBe(UNIVERSAL_TOOL_FALLBACK_DIRECTIVE);
  });

  it('injects 0 tools for English greeting "hello"', async () => {
    const stage = new ToolRouterStage();
    const result = await stage.execute({
      schemaVersion: 1,
      runId: 'run-spec-2',
      stageId: 'builtin:tool-router',
      query: 'Hello there',
    });

    expect(result.decision).toBe('continue');
    expect(result.grounding?.toolRouter?.selectedTools).toEqual([]);
    expect(result.evidence?.isPureGreeting).toBe(true);
  });

  it('always provides Universal Fallback Directive and fallbackAction', async () => {
    const stage = new ToolRouterStage();
    const result = await stage.execute({
      schemaVersion: 1,
      runId: 'run-spec-3',
      stageId: 'builtin:tool-router',
      query: 'viết code python',
    });

    expect(result.grounding?.toolRouter?.universalDirective).toBe(UNIVERSAL_TOOL_FALLBACK_DIRECTIVE);
    expect(result.grounding?.toolRouter?.fallbackAction).toBe('request_tools');
  });

  it('self-heals and loads code tools when Agent emits fallback signal request_tools(code)', async () => {
    const stage = new ToolRouterStage();
    const result = await stage.execute({
      schemaVersion: 1,
      runId: 'run-spec-4',
      stageId: 'builtin:tool-router',
      query: 'request_tools(code)',
    });

    expect(result.decision).toBe('continue');
    expect(result.grounding?.toolRouter?.selectedTools).toEqual(['code_executor', 'file_search']);
    expect(result.grounding?.toolRouter?.selfHealed).toBe(true);
    expect(result.evidence?.method).toBe('agent_self_healing_fallback');
  });

  it('self-heals and loads browser tools when Agent emits fallback signal request_tools(browser)', async () => {
    const stage = new ToolRouterStage();
    const result = await stage.execute({
      schemaVersion: 1,
      runId: 'run-spec-5',
      stageId: 'builtin:tool-router',
      query: 'cần_công_cụ(browser)',
    });

    expect(result.decision).toBe('continue');
    expect(result.grounding?.toolRouter?.selectedTools).toEqual(['browser_action']);
    expect(result.grounding?.toolRouter?.selfHealed).toBe(true);
  });

  it('self-heals and loads all tools when Agent emits unspecified request_tools', async () => {
    const stage = new ToolRouterStage();
    const result = await stage.execute({
      schemaVersion: 1,
      runId: 'run-spec-6',
      stageId: 'builtin:tool-router',
      query: 'Tôi không thể làm được, xin hãy request_tools',
    });

    expect(result.decision).toBe('continue');
    expect(result.grounding?.toolRouter?.selectedTools).toContain('code_executor');
    expect(result.grounding?.toolRouter?.selectedTools).toContain('browser_action');
    expect(result.grounding?.toolRouter?.selfHealed).toBe(true);
  });
});
