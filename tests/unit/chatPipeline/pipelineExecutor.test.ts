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

    // Stage 1: docs retriever (test double)
    const docsStage: IChatStage = {
      id: 'test:docs-retriever',
      displayName: 'Docs retriever',
      description: 'Fetches documentation',
      phase: 'retrieve',
      defaultEnabled: true,
      async execute(input) {
        return {
          decision: 'continue',
          grounding: { docs: ['python-docs-v3.12'] },
          context: `${input.context ?? ''}\n[docs: found python docs]`,
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

    registry.registerPackageStage(docsStage, 'test:docs-retriever');
    registry.registerBuiltin(layaStage);

    const definition: ChatPipelineDefinition = {
      schemaVersion: 1,
      id: 'test-pipeline',
      name: 'Test Pipeline',
      enabled: true,
      stages: [
        {
          id: 'step-1',
          stageRegistryId: 'test:docs-retriever',
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
    expect(result.finalContext).toContain('[docs: found python docs]');
    expect(result.grounding).toEqual({ docs: ['python-docs-v3.12'] });
    expect(result.executedStages).toHaveLength(2);
    expect(result.executedStages[0].stageRegistryId).toBe('test:docs-retriever');
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

describe('direction boundary', () => {
  const setup = () => {
    const registry = new ChatStageRegistry();
    const calls: string[] = [];
    const controller = new AbortController();
    for (const phase of ['pre_query', 'retrieve', 'pre_model', 'post_model'] as const) {
      registry.registerBuiltin({
        id: phase,
        displayName: phase,
        description: phase,
        phase,
        defaultEnabled: true,
        async execute(input) {
          calls.push(phase);
          if (input.config?.cancel) controller.abort();
          return { decision: 'rewrite', query: `${input.query}:${phase}` };
        },
      });
    }
    const definition = registry.createDefaultDefinition();
    const executor = new ChatPipelineExecutor(registry);
    return { definition, executor, calls, controller };
  };

  it.each([undefined, 'input', 'output'] as const)(
    'routes %s in order and excludes disabled stages',
    async (direction) => {
      const { definition, executor, calls, controller } = setup();
      definition.stages.push({
        id: 'disabled',
        stageRegistryId: 'missing-disabled',
        phase: 'post_model',
        enabled: false,
      });
      definition.stages.push({ ...definition.stages[3]!, id: 'output-copy' });
      const result = await executor.execute({
        definition,
        runId: 'run',
        query: 'text',
        direction,
        signal: controller.signal,
      });
      expect(result.status).toBe('completed');
      const expected = direction === 'output' ? ['post_model', 'post_model'] : ['pre_query', 'retrieve', 'pre_model'];
      expect(calls).toEqual(expected);
      expect(result.finalQuery).toBe(['text', ...expected].join(':'));
    }
  );

  it.each(['input', 'output'] as const)(
    'fails closed before side effects for invalid references in %s',
    async (direction) => {
      for (const error of ['STAGE_NOT_FOUND', 'STAGE_PHASE_MISMATCH']) {
        const { definition, executor, calls, controller } = setup();
        definition.stages.push({
          id: 'bad',
          stageRegistryId: error === 'STAGE_NOT_FOUND' ? 'missing' : 'post_model',
          phase: 'pre_query',
          enabled: true,
        });
        const result = await executor.execute({
          definition,
          runId: 'run',
          query: 'text',
          direction,
          signal: controller.signal,
        });
        expect(result.status).toBe('blocked');
        expect(result.blockedReasonCode).toBe(error);
        expect(calls).toEqual([]);
      }
    }
  );

  it.each(['input', 'output'] as const)(
    'does not accept a rewrite after final-stage cancellation in %s',
    async (direction) => {
      const { definition, executor, calls, controller } = setup();
      const phase = direction === 'output' ? 'post_model' : 'pre_model';
      definition.stages = definition.stages
        .filter((ref) => ref.phase === phase)
        .map((ref) => ({ ...ref, config: { cancel: true } }));
      const result = await executor.execute({
        definition,
        runId: 'run',
        query: 'text',
        direction,
        signal: controller.signal,
      });
      expect(result.status).toBe('aborted');
      expect(calls).toEqual([phase]);
      expect(result.finalQuery).toBe('text');
    }
  );

  it('honors a pre-aborted empty or disabled pipeline', async () => {
    const direction = 'output' as const;
    const { definition, executor, calls, controller } = setup();
    definition.enabled = false;
    definition.stages = [];
    controller.abort();
    const result = await executor.execute({
      definition,
      runId: 'run',
      query: 'text',
      direction,
      signal: controller.signal,
    });
    expect(result.status).toBe('aborted');
    expect(calls).toEqual([]);
  });
});

describe('pipeline time and configuration boundaries', () => {
  const makeStage = (id: string, execute: IChatStage['execute'], role?: IChatStage['role']): IChatStage => ({
    id,
    displayName: id,
    description: id,
    phase: 'pre_query',
    defaultEnabled: true,
    defaultTimeoutMs: 20,
    role,
    execute,
  });

  it('retries only a vetted idempotent builtin on an explicit transient code, retaining attempt evidence', async () => {
    const registry = new ChatStageRegistry();
    let attempts = 0;
    registry.registerBuiltin({
      ...makeStage('builtin:read-only', async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('PIPELINE_TRANSIENT_NETWORK');
        return { decision: 'continue' };
      }),
      retrySafe: true,
    });
    const result = await new ChatPipelineExecutor(registry).execute({
      runId: 'retry-safe',
      query: 'hello',
      definition: registry.createDefaultDefinition(),
    });
    expect(result.status).toBe('completed');
    expect(attempts).toBe(2);
    expect(result.executedStages[0]?.evidence).toMatchObject({ attempts: 2 });
  });

  it('never trusts a package self-declaration of retry safety', async () => {
    const registry = new ChatStageRegistry();
    let attempts = 0;
    registry.registerPackageStage(
      {
        ...makeStage('package:read-only', async () => {
          attempts += 1;
          throw new Error('PIPELINE_TRANSIENT_NETWORK');
        }),
        retrySafe: true,
      },
      'package'
    );
    const result = await new ChatPipelineExecutor(registry).execute({
      runId: 'retry-package',
      query: 'hello',
      definition: registry.createDefaultDefinition(),
    });
    expect(result.status).toBe('completed');
    expect(attempts).toBe(1);
    expect(result.executedStages[0]?.decision).toBe('skip');
  });

  it('aborts transient retry backoff instead of rerunning a cancelled stage', async () => {
    const registry = new ChatStageRegistry();
    const controller = new AbortController();
    let calls = 0;
    registry.registerBuiltin({
      ...makeStage('builtin:retry-cancel', async () => {
        calls += 1;
        setTimeout(() => controller.abort(new Error('cancelled')), 2);
        throw new Error('PIPELINE_TRANSIENT_NETWORK');
      }),
      retrySafe: true,
    });
    const result = await new ChatPipelineExecutor(registry).execute({
      runId: 'cancel-backoff',
      query: 'hello',
      definition: registry.createDefaultDefinition(),
      signal: controller.signal,
    });
    expect(result.status).toBe('aborted');
    expect(calls).toBe(1);
  });

  it('times out an uncooperative guard without waiting for its unresolved promise', async () => {
    const registry = new ChatStageRegistry();
    registry.registerBuiltin(makeStage('guard', async () => new Promise(() => undefined), 'guard'));
    const result = await new ChatPipelineExecutor(registry).execute({
      runId: 'guard-timeout',
      query: 'hello',
      definition: registry.createDefaultDefinition(),
    });
    expect(result.status).toBe('blocked');
    expect(result.blockedReasonCode).toBe('SECURITY_STAGE_ERROR');
    expect(result.executedStages[0]?.error).toContain('STAGE_TIMEOUT_');
  });

  it('stops the chain after its shared run budget expires, rather than resetting the deadline', async () => {
    const registry = new ChatStageRegistry();
    const reached: string[] = [];
    registry.registerBuiltin(
      makeStage('stall', async () => {
        reached.push('stall');
        return new Promise(() => undefined);
      })
    );
    registry.registerBuiltin(
      makeStage('never', async () => {
        reached.push('never');
        return { decision: 'continue' };
      })
    );
    const definition: ChatPipelineDefinition = {
      ...registry.createDefaultDefinition(),
      limits: { maxTotalTimeoutMs: 10 },
    };
    const result = await new ChatPipelineExecutor(registry).execute({
      runId: 'budget-exhausted',
      query: 'hello',
      definition,
    });
    expect(result.status).toBe('blocked');
    expect(result.blockedReasonCode).toBe('PIPELINE_BUDGET_EXHAUSTED');
    expect(reached).toEqual(['stall']);
  });

  it('aborts an uncooperative stage promptly and does not execute later stages', async () => {
    const registry = new ChatStageRegistry();
    const reached: string[] = [];
    const abort = new AbortController();
    registry.registerBuiltin(
      makeStage('pending', async () => {
        reached.push('pending');
        abort.abort();
        return new Promise(() => undefined);
      })
    );
    registry.registerBuiltin(
      makeStage('later', async () => {
        reached.push('later');
        return { decision: 'continue' };
      })
    );
    const result = await new ChatPipelineExecutor(registry).execute({
      runId: 'cancel-hanging',
      query: 'hello',
      definition: registry.createDefaultDefinition(),
      signal: abort.signal,
    });
    expect(result.status).toBe('aborted');
    expect(reached).toEqual(['pending']);
  });

  it('blocks oversized query before executing any stage, even when the chain is disabled', async () => {
    const registry = new ChatStageRegistry();
    let called = false;
    registry.registerBuiltin(
      makeStage('spy', async () => {
        called = true;
        return { decision: 'continue' };
      })
    );
    const definition = { ...registry.createDefaultDefinition(), enabled: false };
    const result = await new ChatPipelineExecutor(registry).execute({
      runId: 'large-query',
      query: 'x'.repeat(128_001),
      definition,
    });
    expect(result).toMatchObject({ status: 'blocked', blockedReasonCode: 'PIPELINE_INPUT_TOO_LARGE' });
    expect(called).toBe(false);
  });

  it('rejects context expansion before dispatching later stages', async () => {
    const registry = new ChatStageRegistry();
    let called = false;
    registry.registerBuiltin(
      makeStage('expander', async () => ({
        decision: 'continue',
        context: 'x'.repeat(500),
      }))
    );
    registry.registerBuiltin(
      makeStage('later', async () => {
        called = true;
        return { decision: 'continue' };
      })
    );
    const result = await new ChatPipelineExecutor(registry).execute({
      runId: 'oversize-context',
      query: 'hello',
      definition: { ...registry.createDefaultDefinition(), limits: { maxContextBytes: 128 } },
    });
    expect(result).toMatchObject({ status: 'blocked', blockedReasonCode: 'PIPELINE_OUTPUT_TOO_LARGE' });
    expect(called).toBe(false);
  });

  it('snapshots the stage chain before awaited stage work begins', async () => {
    const registry = new ChatStageRegistry();
    let releaseFirst: (() => void) | undefined;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const reached: string[] = [];
    registry.registerBuiltin(
      makeStage('first', async () => {
        reached.push('first');
        await firstDone;
        return { decision: 'continue' };
      })
    );
    registry.registerBuiltin(
      makeStage('second', async () => {
        reached.push('second');
        return { decision: 'continue' };
      })
    );
    const definition = registry.createDefaultDefinition();
    const resultPromise = new ChatPipelineExecutor(registry).execute({
      runId: 'snapshot',
      query: 'hello',
      definition,
    });
    definition.stages.splice(1, 1);
    releaseFirst?.();
    const result = await resultPromise;
    expect(result.status).toBe('completed');
    expect(reached).toEqual(['first', 'second']);
  });
});
