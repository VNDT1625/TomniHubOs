import { describe, expect, it } from 'vitest';
import {
  ChatPipelineExecutor,
  ChatStageRegistry,
  type ChatPipelineDefinition,
  type IChatStage,
} from '../../../packages/desktop/src/process/services/chatPipeline';

describe('ChatPipelineExecutor', () => {
  it('executes active stages in exact order and propagates query rewrite and grounding', async () => {
    const registry = new ChatStageRegistry();

    // Stage 1: Context7 Docs Retriever
    const context7Stage: IChatStage = {
      id: 'com.context7.docs-retriever',
      displayName: 'Context7 Docs',
      description: 'Fetches documentation',
      phase: 'retrieve',
      defaultEnabled: true,
      async execute(input) {
        return {
          decision: 'continue',
          grounding: { docs: ['python-docs-v3.12'] },
          context: `${input.context ?? ''}\n[Context7: Found python docs]`,
        };
      },
    };

    // Stage 2: Laya Security Guard
    const layaStage: IChatStage = {
      id: 'builtin:laya-security',
      displayName: 'Laya Security Guard',
      description: 'Redacts credentials and PII',
      phase: 'pre_query',
      defaultEnabled: true,
      async execute(input) {
        // Redacts password if found
        if (input.query.includes('123456')) {
          return {
            decision: 'rewrite',
            query: input.query.replace('123456', '[REDACTED]'),
            evidence: { redactedCount: 1 },
          };
        }
        return { decision: 'continue' };
      },
    };

    registry.registerPackageStage(context7Stage, 'com.context7.docs-retriever');
    registry.registerBuiltin(layaStage);

    const definition: ChatPipelineDefinition = {
      schemaVersion: 1,
      id: 'test-pipeline',
      name: 'Test Pipeline',
      enabled: true,
      stages: [
        {
          id: 'step-1',
          stageRegistryId: 'com.context7.docs-retriever',
          phase: 'retrieve',
          enabled: true,
        },
        {
          id: 'step-2',
          stageRegistryId: 'builtin:laya-security',
          phase: 'pre_query',
          enabled: true,
        },
      ],
    };

    const executor = new ChatPipelineExecutor(registry);
    const result = await executor.execute({
      runId: 'run-1',
      query: 'tôi tên Thuận, mk zalo 123456',
      context: 'Initial context',
      definition,
    });

    expect(result.status).toBe('completed');
    expect(result.finalQuery).toBe('tôi tên Thuận, mk zalo [REDACTED]');
    expect(result.finalContext).toContain('[Context7: Found python docs]');
    expect(result.grounding).toEqual({ docs: ['python-docs-v3.12'] });
    expect(result.executedStages).toHaveLength(2);
    expect(result.executedStages[0].stageRegistryId).toBe('com.context7.docs-retriever');
    expect(result.executedStages[0].decision).toBe('continue');
    expect(result.executedStages[1].stageRegistryId).toBe('builtin:laya-security');
    expect(result.executedStages[1].decision).toBe('rewrite');
  });

  it('halts pipeline immediately when a stage returns block', async () => {
    const registry = new ChatStageRegistry();

    const blockerStage: IChatStage = {
      id: 'blocker',
      displayName: 'Blocker Stage',
      description: 'Blocks malicious input',
      phase: 'pre_query',
      defaultEnabled: true,
      async execute() {
        return { decision: 'block', reasonCode: 'PROMPT_INJECTION_DETECTED' };
      },
    };

    const nextStage: IChatStage = {
      id: 'next',
      displayName: 'Next Stage',
      description: 'Should not run',
      phase: 'retrieve',
      defaultEnabled: true,
      async execute() {
        return { decision: 'continue' };
      },
    };

    registry.registerBuiltin(blockerStage);
    registry.registerBuiltin(nextStage);

    const definition: ChatPipelineDefinition = {
      schemaVersion: 1,
      id: 'blocked-pipe',
      name: 'Blocked Pipe',
      enabled: true,
      stages: [
        { id: 's1', stageRegistryId: 'blocker', phase: 'pre_query', enabled: true },
        { id: 's2', stageRegistryId: 'next', phase: 'retrieve', enabled: true },
      ],
    };

    const executor = new ChatPipelineExecutor(registry);
    const result = await executor.execute({
      runId: 'run-2',
      query: 'malicious input',
      definition,
    });

    expect(result.status).toBe('blocked');
    expect(result.blockedReasonCode).toBe('PROMPT_INJECTION_DETECTED');
    expect(result.executedStages).toHaveLength(1);
  });

  it('tolerates errors in non-security stages gracefully by skipping', async () => {
    const registry = new ChatStageRegistry();

    const buggyStage: IChatStage = {
      id: 'buggy-plugin',
      displayName: 'Buggy Plugin',
      description: 'Throws error',
      phase: 'retrieve',
      defaultEnabled: true,
      async execute() {
        throw new Error('Network timeout fetching docs');
      },
    };

    const validStage: IChatStage = {
      id: 'valid-stage',
      displayName: 'Valid Stage',
      description: 'Runs fine',
      phase: 'pre_model',
      defaultEnabled: true,
      async execute(input) {
        return { decision: 'continue', context: `${input.context ?? ''}\nValid ran` };
      },
    };

    registry.registerPackageStage(buggyStage, 'pkg-buggy');
    registry.registerBuiltin(validStage);

    const definition: ChatPipelineDefinition = {
      schemaVersion: 1,
      id: 'tolerant-pipe',
      name: 'Tolerant Pipe',
      enabled: true,
      stages: [
        { id: 's1', stageRegistryId: 'buggy-plugin', phase: 'retrieve', enabled: true },
        { id: 's2', stageRegistryId: 'valid-stage', phase: 'pre_model', enabled: true },
      ],
    };

    const executor = new ChatPipelineExecutor(registry);
    const result = await executor.execute({
      runId: 'run-3',
      query: 'normal query',
      definition,
    });

    expect(result.status).toBe('completed');
    expect(result.finalContext).toContain('Valid ran');
    expect(result.executedStages).toHaveLength(2);
    expect(result.executedStages[0].decision).toBe('skip');
    expect(result.executedStages[0].error).toBe('Network timeout fetching docs');
    expect(result.executedStages[1].decision).toBe('continue');
  });

  it('bypasses stages marked enabled: false', async () => {
    const registry = new ChatStageRegistry();

    let ranDisabled = false;
    const disabledStage: IChatStage = {
      id: 'disabled-stage',
      displayName: 'Disabled Stage',
      description: 'Should be bypassed',
      phase: 'retrieve',
      defaultEnabled: false,
      async execute() {
        ranDisabled = true;
        return { decision: 'continue' };
      },
    };

    registry.registerBuiltin(disabledStage);

    const definition: ChatPipelineDefinition = {
      schemaVersion: 1,
      id: 'bypassed-pipe',
      name: 'Bypassed Pipe',
      enabled: true,
      stages: [{ id: 's1', stageRegistryId: 'disabled-stage', phase: 'retrieve', enabled: false }],
    };

    const executor = new ChatPipelineExecutor(registry);
    const result = await executor.execute({
      runId: 'run-4',
      query: 'hello',
      definition,
    });

    expect(result.status).toBe('completed');
    expect(ranDisabled).toBe(false);
    expect(result.executedStages).toHaveLength(0);
  });
});
