import { describe, expect, it } from 'vitest';
import { ChatPipelineExecutor, ChatStageRegistry, OutputSecurityStage } from '@process/services/chatPipeline';

const create = (mode?: 'block' | 'redact') => {
  const registry = new ChatStageRegistry();
  registry.registerBuiltin(new OutputSecurityStage());
  const definition = registry.createDefaultDefinition();
  definition.stages.push({
    id: 'out-guard',
    stageRegistryId: 'builtin:output-security',
    phase: 'post_model',
    enabled: true,
    ...(mode ? { config: { mode } } : {}),
  });
  return { registry, definition, executor: new ChatPipelineExecutor(registry) };
};

describe('Main-owned buffered output guard', () => {
  it('is available as an authorized built-in, but never turns on by default', () => {
    const { registry } = create();
    expect(registry.getStage('builtin:output-security')?.phase).toBe('post_model');
    expect(registry.listMetadata().find((stage) => stage.id === 'builtin:output-security')).toMatchObject({
      role: 'guard',
      authorizedGuard: true,
      defaultEnabled: false,
    });
    expect(registry.createDefaultDefinition().stages).toHaveLength(0);
  });

  it('allows normal completed assistant text without rewriting it', async () => {
    const { executor, definition } = create();
    const result = await executor.execute({ runId: 'out-safe', direction: 'output', query: 'Hello there', definition });
    expect(result.status).toBe('completed');
    expect(result.finalQuery).toBe('Hello there');
    expect(result.executedStages[0]?.decision).toBe('continue');
  });

  it('blocks a detected secret in default policy mode', async () => {
    const { executor, definition } = create();
    const result = await executor.execute({
      runId: 'out-block',
      direction: 'output',
      query: 'mk zalo: 123456',
      definition,
    });
    expect(result).toMatchObject({ status: 'blocked', blockedReasonCode: 'OUTPUT_SECURITY_SECRET_DETECTED' });
  });

  it('redacts instead of publishing the original secret when explicitly configured', async () => {
    const { executor, definition } = create('redact');
    const result = await executor.execute({
      runId: 'out-redact',
      direction: 'output',
      query: 'mk zalo: 123456',
      definition,
    });
    expect(result.status).toBe('completed');
    expect(result.finalQuery).not.toContain('123456');
    expect(result.executedStages[0]?.decision).toBe('rewrite');
  });

  it('never runs the output guard on the input direction', async () => {
    const { executor, definition } = create();
    const result = await executor.execute({
      runId: 'input-untouched',
      direction: 'input',
      query: 'mk zalo: 123456',
      definition,
    });
    expect(result.status).toBe('completed');
    expect(result.executedStages).toHaveLength(0);
  });
});
