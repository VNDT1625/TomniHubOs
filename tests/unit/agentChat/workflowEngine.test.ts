import { describe, expect, it, vi } from 'vitest';
import { createResourceCoordinator } from '@/process/resource/resourceCoordinator';
import {
  createWorkflowCoordinatorAdmission,
  executeToolWorkflow,
  type WorkflowToolStep,
} from '@/process/agentRuntime/agentMesh/workflowEngine';

const step = (id: string, dependsOn: string[] = [], more: Partial<WorkflowToolStep> = {}): WorkflowToolStep => ({
  id,
  tool: 'mock_read',
  input: { filePath: id },
  dependsOn,
  ...more,
});

const gate = (initial: number) => {
  let capacity = initial;
  let running = 0;
  let peak = 0;
  let nextLeaseId = 0;
  const pending: Array<{ resolve: (value: { id: string; waitMs: number }) => void; id: string }> = [];
  const grant = (): void => {
    while (running < capacity && pending.length) {
      const request = pending.shift()!;
      running += 1;
      peak = Math.max(peak, running);
      request.resolve({ id: request.id, waitMs: 0 });
    }
  };
  const coordinator = {
    requestLease: vi.fn(
      async () =>
        new Promise<{ id: string; waitMs: number }>((resolve) => {
          pending.push({ resolve, id: String(++nextLeaseId) });
          grant();
        })
    ),
    releaseLease: vi.fn(() => {
      running -= 1;
      grant();
    }),
  };
  return {
    coordinator,
    peak: () => peak,
    queued: () => pending.length,
    expand: (newCapacity: number) => {
      capacity = newCapacity;
      grant();
    },
  };
};

describe('tool workflow DAG under ResourceCoordinator admission', () => {
  it('runs A and B together, then C after both; sends one collected result', async () => {
    const started: string[] = [];
    const completed: string[] = [];
    const waits: Array<() => void> = [];
    const admission = gate(3);
    const run = executeToolWorkflow(
      [
        step('A'),
        step('B'),
        step('C', ['A', 'B'], {
          when: [
            { stepId: 'A', status: 'succeeded', path: ['ready'], equals: true },
            { stepId: 'B', status: 'succeeded', path: ['ready'], equals: true },
          ],
        }),
      ],
      {
        admit: createWorkflowCoordinatorAdmission(
          admission.coordinator,
          () => ({ kind: 'semanticIndex', costMB: 24 }),
          {
            processKind: 'main',
            serviceId: 'workflow-test',
          }
        ),
        signal: new AbortController().signal,
        invoke: async ({ id }) => {
          started.push(id);
          if (id !== 'C') await new Promise<void>((resolve) => waits.push(resolve));
          completed.push(id);
          return { ready: true, id };
        },
      }
    );
    await vi.waitFor(() => expect(started).toEqual(['A', 'B']));
    expect(started).not.toContain('C');
    waits.splice(0).forEach((resolve) => resolve());
    const result = await run;
    expect(started).toEqual(['A', 'B', 'C']);
    expect(result.status).toBe('completed');
    expect(result.steps.map((entry) => entry.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expect(completed).toContain('C');
    expect(admission.peak()).toBe(2);
  });

  it('schedules many ready steps, but only machine-admitted jobs actually start', async () => {
    const admission = gate(2);
    let active = 0;
    let peak = 0;
    const result = await executeToolWorkflow(
      Array.from({ length: 18 }, (_, index) => step(`T${index}`)),
      {
        admit: createWorkflowCoordinatorAdmission(
          admission.coordinator,
          () => ({ kind: 'semanticIndex', costMB: 32 }),
          {
            processKind: 'main',
            serviceId: 'workflow-test',
          }
        ),
        signal: new AbortController().signal,
        invoke: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise<void>((resolve) => setTimeout(resolve, 1));
          active -= 1;
          return 'ok';
        },
      }
    );
    expect(result.status).toBe('completed');
    expect(result.steps).toHaveLength(18);
    expect(peak).toBe(2);
    expect(admission.peak()).toBe(2);
    expect(admission.coordinator.releaseLease).toHaveBeenCalledTimes(18);
  });

  it('adapts to more capacity while requests are queued without changing the DAG', async () => {
    const admission = gate(1);
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const run = executeToolWorkflow(
      Array.from({ length: 6 }, (_, i) => step(`N${i}`)),
      {
        admit: createWorkflowCoordinatorAdmission(admission.coordinator, () => ({ kind: 'semanticIndex', costMB: 8 }), {
          processKind: 'main',
          serviceId: 'workflow-test',
        }),
        signal: new AbortController().signal,
        invoke: async ({ id }) => {
          started.push(id);
          await new Promise<void>((resolve) => releases.push(resolve));
          return id;
        },
      }
    );
    await vi.waitFor(() => expect(admission.queued()).toBe(5));
    await vi.waitFor(() => expect(started).toHaveLength(1));
    admission.expand(4);
    await vi.waitFor(() => expect(started).toHaveLength(4));
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(started).toHaveLength(6));
    releases.splice(0).forEach((release) => release());
    const result = await run;
    expect(result.status).toBe('completed');
    expect(admission.peak()).toBe(4);
  });

  it('runs error recovery when B fails and skips the success-only C', async () => {
    const admission = gate(3);
    const executed: string[] = [];
    const result = await executeToolWorkflow(
      [
        step('A'),
        step('B'),
        step('C', ['A', 'B']),
        step('Recover', ['A', 'B'], { when: [{ stepId: 'B', status: 'failed' }] }),
      ],
      {
        admit: createWorkflowCoordinatorAdmission(
          admission.coordinator,
          () => ({ kind: 'semanticIndex', costMB: 12 }),
          {
            processKind: 'main',
            serviceId: 'workflow-test',
          }
        ),
        signal: new AbortController().signal,
        invoke: async ({ id }) => {
          executed.push(id);
          if (id === 'B') throw new Error('B failed');
          return id;
        },
      }
    );
    expect(result.status).toBe('failed');
    expect(executed).toEqual(['A', 'B', 'Recover']);
    expect(result.steps.map((entry) => entry.status)).toEqual(['succeeded', 'failed', 'skipped', 'succeeded']);
  });

  it('does not wait for unrelated slow branches before starting a dependent step', async () => {
    const admission = gate(3);
    let releaseSlow!: () => void;
    const started: string[] = [];
    const run = executeToolWorkflow([step('A'), step('SlowB'), step('C', ['A'])], {
      admit: createWorkflowCoordinatorAdmission(admission.coordinator, () => ({ kind: 'semanticIndex', costMB: 12 }), {
        processKind: 'main',
        serviceId: 'workflow-test',
      }),
      signal: new AbortController().signal,
      invoke: async ({ id }) => {
        started.push(id);
        if (id === 'SlowB')
          await new Promise<void>((resolve) => {
            releaseSlow = resolve;
          });
        return id;
      },
    });
    await vi.waitFor(() => expect(started).toContain('C'));
    expect(started).toContain('SlowB');
    releaseSlow();
    expect((await run).status).toBe('completed');
  });

  it('honors a real ResourceCoordinator machine budget and queues tool leases', async () => {
    const coordinator = createResourceCoordinator({
      autoStartBalanceLoop: false,
      probe: async () => ({ totalMemMB: 16_384, cpuCores: 8, hasDiscreteGPU: false, freeDiskMB: 10_000 }),
      store: {
        dir: 'memory',
        fs: {
          readFile: async () => {
            throw new Error('ENOENT');
          },
          writeFile: async () => undefined,
          rename: async () => undefined,
          mkdir: async () => undefined,
        },
      },
    });
    try {
      await coordinator.init();
      const budget = coordinator.getState().budget;
      coordinator.setBudget({ maxConcurrent: { ...budget.maxConcurrent, semanticIndex: 2 } });
      let active = 0;
      let peak = 0;
      const result = await executeToolWorkflow(
        Array.from({ length: 12 }, (_, i) => step(`T${i}`)),
        {
          admit: createWorkflowCoordinatorAdmission(coordinator, () => ({ kind: 'semanticIndex', costMB: 32 }), {
            processKind: 'main',
            serviceId: 'workflow-real-coordinator',
          }),
          signal: new AbortController().signal,
          invoke: async () => {
            active += 1;
            peak = Math.max(active, peak);
            await new Promise<void>((resolve) => setTimeout(resolve, 2));
            active -= 1;
            return 'ok';
          },
        }
      );
      expect(result.status).toBe('completed');
      expect(result.steps).toHaveLength(12);
      expect(peak).toBe(2);
      expect(coordinator.getState().active).toHaveLength(0);
      expect(coordinator.getState().queued).toHaveLength(0);
    } finally {
      await coordinator.dispose();
    }
  });

  it('passes only a bounded scalar from the prerequisite MCP content to a later tool', async () => {
    const inputs: Record<string, unknown>[] = [];
    const result = await executeToolWorkflow(
      [
        step('A'),
        step('C', ['A'], {
          inputFrom: { query: { stepId: 'A', path: ['0', 'text'] } },
          when: [{ stepId: 'A', status: 'succeeded', path: ['0', 'text'], equals: 'file-result' }],
        }),
      ],
      {
        admit: async () => ({ release: () => undefined }),
        signal: new AbortController().signal,
        invoke: async (current) => {
          if (current.id === 'A') return [{ type: 'text', text: 'file-result' }];
          inputs.push({ ...current.input });
          return 'done';
        },
      }
    );
    expect(result.status).toBe('completed');
    expect(inputs).toEqual([{ filePath: 'C', query: 'file-result' }]);
  });

  it('reads automatically only when tomny_glob returns one verified path', async () => {
    const calls: string[] = [];
    const result = await executeToolWorkflow(
      [
        { id: 'find', tool: 'tomny_glob', input: { pattern: 'target-*.txt' } },
        {
          id: 'read',
          tool: 'tomny_read',
          input: {},
          dependsOn: ['find'],
          when: [{ stepId: 'find', status: 'succeeded', fileCount: 1 }],
          inputFrom: { filePath: { stepId: 'find', select: 'singleFile' } },
        },
      ],
      {
        admit: async () => ({ release: () => undefined }),
        signal: new AbortController().signal,
        invoke: async (current) => {
          calls.push(current.tool);
          if (current.tool === 'tomny_glob') return [{ type: 'text', text: 'src/target-file.txt' }];
          expect(current.input).toEqual({ filePath: 'src/target-file.txt' });
          return [{ type: 'text', text: 'The file content' }];
        },
      }
    );
    expect(calls).toEqual(['tomny_glob', 'tomny_read']);
    expect(result.status).toBe('completed');
    expect(result.steps[0]?.fileMatchCount).toBe(1);
    expect(JSON.stringify(result)).toContain('The file content');
  });

  it.each([
    { text: 'No files match the pattern.', count: 0 },
    { text: ['src/a.txt', 'src/b.txt'].join(String.fromCharCode(10)), count: 2 },
  ])('skips read for $count matching files while returning the glob result', async ({ text: globText, count }) => {
    const invoke = vi.fn(async (current: WorkflowToolStep) => {
      if (current.tool !== 'tomny_glob') throw new Error('Read should not run');
      return [{ type: 'text', text: globText }];
    });
    const result = await executeToolWorkflow(
      [
        { id: 'find', tool: 'tomny_glob', input: { pattern: '*.txt' } },
        {
          id: 'read',
          tool: 'tomny_read',
          input: {},
          dependsOn: ['find'],
          when: [{ stepId: 'find', fileCount: 1 }],
          inputFrom: { filePath: { stepId: 'find', select: 'singleFile' } },
        },
      ],
      { admit: async () => ({ release: () => undefined }), signal: new AbortController().signal, invoke }
    );
    expect(result.status).toBe('completed');
    expect(result.steps[0]?.fileMatchCount).toBe(count);
    expect(result.steps[1]?.status).toBe('skipped');
    expect(result.steps[0]?.output).toEqual([{ type: 'text', text: globText }]);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('does not promote truncated, ambiguous or non-glob outputs to a Read input', async () => {
    await Promise.all(
      (
        [
          ['tomny_glob', [{ type: 'text', text: ['src/a.txt', '...[truncated]'].join(String.fromCharCode(10)) }]],
          ['tomny_glob', [{ type: 'text', text: '../escape.txt' }]],
          ['tomny_glob', [{ type: 'text', text: ['src/a.txt', 'src/a.txt'].join(String.fromCharCode(10)) }]],
          ['tomny_search', [{ type: 'text', text: 'src/a.txt' }]],
        ] as const
      ).map(async ([tool, output]) => {
        const invoke = vi.fn(async () => output);
        const result = await executeToolWorkflow(
          [
            { id: 'find', tool, input: { pattern: '*.txt' } },
            {
              id: 'read',
              tool: 'tomny_read',
              input: {},
              dependsOn: ['find'],
              when: [{ stepId: 'find', fileCount: 1 }],
              inputFrom: { filePath: { stepId: 'find', select: 'singleFile' } },
            },
          ],
          { admit: async () => ({ release: () => undefined }), signal: new AbortController().signal, invoke }
        );
        expect(result.steps[0]?.fileMatchCount).toBeUndefined();
        expect(result.steps[1]?.status).toBe('skipped');
        expect(invoke).toHaveBeenCalledOnce();
      })
    );
  });

  it('rejects cycles and unknown or unsafe conditional dependencies before calling tools', async () => {
    const admission = gate(2);
    const invoke = vi.fn(async () => 'should not execute');
    const options = {
      admit: createWorkflowCoordinatorAdmission(admission.coordinator, () => ({ kind: 'semanticIndex', costMB: 12 }), {
        processKind: 'main' as const,
        serviceId: 'workflow-test',
      }),
      signal: new AbortController().signal,
      invoke,
    };
    await expect(executeToolWorkflow([step('A', ['B']), step('B', ['A'])], options)).rejects.toThrow('WORKFLOW_CYCLE');
    await expect(executeToolWorkflow([step('A', ['Missing'])], options)).rejects.toThrow(
      'WORKFLOW_DEPENDENCY_NOT_FOUND'
    );
    await expect(
      executeToolWorkflow([step('A'), step('B', [], { when: [{ stepId: 'A', status: 'succeeded' }] })], options)
    ).rejects.toThrow('WORKFLOW_CONDITION_NOT_DEPENDENCY');
    await expect(
      executeToolWorkflow(
        [step('A'), step('B', [], { inputFrom: { query: { stepId: 'A', path: ['text'] } } })],
        options
      )
    ).rejects.toThrow('WORKFLOW_BINDING_INVALID');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('cancels queued work, never invokes it, and releases admitted leases', async () => {
    const controller = new AbortController();
    let releaseFirst!: () => void;
    let running = false;
    const invoke = vi.fn(async () => {
      running = true;
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return 'ok';
    });
    let granted = 0;
    let released = 0;
    const pending: Array<(error: Error) => void> = [];
    const admission = createWorkflowCoordinatorAdmission(
      {
        requestLease: async (_request, options) => {
          if (granted++ === 0) return { id: 'lease-1', kind: 'semanticIndex', grantedAt: 0, estCostMB: 8 };
          return new Promise((_, reject) => {
            const abort = () => reject(new Error('CANCELLED'));
            pending.push(abort);
            options?.signal?.addEventListener('abort', abort, { once: true });
          });
        },
        releaseLease: () => {
          released += 1;
        },
      },
      () => ({ kind: 'semanticIndex', costMB: 8 }),
      { processKind: 'main', serviceId: 'workflow-test' }
    );
    const run = executeToolWorkflow([step('A'), step('B'), step('C')], {
      admit: admission,
      signal: controller.signal,
      invoke,
    });
    await vi.waitFor(() => expect(running).toBe(true));
    controller.abort();
    expect(pending).toHaveLength(2);
    releaseFirst();
    const result = await run;
    expect(result.status).toBe('cancelled');
    expect(result.steps.map((entry) => entry.status)).toEqual(['succeeded', 'cancelled', 'cancelled']);
    expect(released).toBe(1);
    expect(invoke).toHaveBeenCalledOnce();
  });
});
