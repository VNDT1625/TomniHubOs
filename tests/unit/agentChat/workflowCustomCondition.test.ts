import { describe, expect, it } from 'vitest';
import { evaluateCustomCondition } from '@process/agentRuntime/agentMesh/workflowCustomCondition';
import { executeToolWorkflow } from '@process/agentRuntime/agentMesh/workflowEngine';

describe('Custom JavaScript Condition Worker', () => {
  it('runs an Agent-authored function over only declared dependency results and binds the decision', async () => {
    const calls: Array<{ tool: string; input: Record<string, unknown> }> = [];
    const result = await executeToolWorkflow(
      [
        { id: 'find', tool: 'search', input: {} },
        {
          id: 'read',
          tool: 'read',
          input: {},
          dependsOn: ['find'],
          whenScript: {
            language: 'javascript',
            source:
              'function (data) { const files = data.find.output.files.filter(f => !f.name.endsWith(".bak")); return {allow:files.length===1,values:{filePath:files[0].path}}; }',
          },
        },
      ],
      {
        signal: new AbortController().signal,
        admit: async () => ({ release: () => undefined }),
        invoke: async (step) => {
          calls.push({ tool: step.tool, input: { ...step.input } });
          if (step.tool === 'search')
            return {
              files: [
                { name: 'app.ts', path: 'src/app.ts' },
                { name: 'app.bak', path: 'src/app.bak' },
              ],
            };
          return 'read complete';
        },
      }
    );
    expect(result.status).toBe('completed');
    expect(calls).toEqual([
      { tool: 'search', input: {} },
      { tool: 'read', input: { filePath: 'src/app.ts' } },
    ]);
  });

  it('returns a skip when custom condition is false without invoking the followup', async () => {
    const result = await executeToolWorkflow(
      [
        { id: 'find', tool: 'search', input: {} },
        {
          id: 'read',
          tool: 'read',
          input: {},
          dependsOn: ['find'],
          whenScript: { language: 'javascript', source: '(data) => ({allow:data.find.output.files.length===1})' },
        },
      ],
      {
        signal: new AbortController().signal,
        admit: async () => ({ release: () => undefined }),
        invoke: async (step) => {
          if (step.id === 'read') throw Error('wrong invocation');
          return { files: ['one', 'two'] };
        },
      }
    );
    expect(result.steps[1]?.status).toBe('skipped');
  });

    it('resource-queues condition workers rather than starting unbounded workers in parallel', async () => {
    let active = 0;
    let maximum = 0;
    const waiting: Array<() => void> = [];
    const result = await executeToolWorkflow([
      { id: 'A', tool: 'read', input: {} },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `conditional_${index}`, tool: 'read', input: {}, dependsOn: ['A'],
        whenScript: { language: 'javascript' as const, source: '(data) => ({allow:data.A.status==="succeeded"})' },
      })),
    ], {
      signal: new AbortController().signal,
      admit: async () => ({ release: () => undefined }),
      admitCondition: async () => {
        if (active >= 2) await new Promise<void>((resolve) => { waiting.push(resolve); });
        active += 1;
        maximum = Math.max(maximum, active);
        return { release: () => { active -= 1; waiting.shift()?.(); } };
      },
      invoke: async () => 'ok',
    });
    expect(result.steps.every((entry) => entry.status === 'succeeded')).toBe(true);
    expect(maximum).toBe(2);
    expect(active).toBe(0);
  });

  it('denies dynamic code and host objects, bounds infinite loops and cancels', async () => {
    const results = new Map([['A', { id: 'A', tool: 'tool', status: 'succeeded' as const, output: { count: 2 } }]]);
    const dependency = ['A'];
    await expect(
      evaluateCustomCondition(
        {
          language: 'javascript',
          source: '() => ({allow:!!process})',
        },
        results,
        dependency
      )
    ).rejects.toThrow('WORKFLOW_CUSTOM_FORBIDDEN_IDENTIFIER');
    await expect(
      evaluateCustomCondition(
        {
          language: 'javascript',
          source: '() => { for(;;){} }',
        },
        results,
        dependency
      )
    ).rejects.toThrow();
    await expect(
      evaluateCustomCondition(
        {
          language: 'javascript',
          source: '() => ({allow:true})',
        },
        results,
        ['Missing']
      )
    ).rejects.toThrow('WORKFLOW_CUSTOM_DEPENDENCY_UNAVAILABLE');
    const controller = new AbortController();
    controller.abort();
    await expect(
      evaluateCustomCondition(
        {
          language: 'javascript',
          source: '() => ({allow:true})',
        },
        results,
        dependency,
        controller.signal
      )
    ).rejects.toThrow('WORKFLOW_CANCELLED');
  });
});
