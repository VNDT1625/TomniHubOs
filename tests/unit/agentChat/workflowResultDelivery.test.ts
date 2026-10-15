import { describe, expect, it } from 'vitest';
import {
  createWorkflowResultStore,
  deliverWorkflowResult,
} from '@process/agentRuntime/agentMesh/workflow/resultDelivery';
import type { WorkflowRunResult } from '@process/agentRuntime/agentMesh/workflowEngine';

const run = (outputs: unknown[]): WorkflowRunResult => ({
  status: 'completed',
  steps: outputs.map((output, i) => ({ id: `step_${i}`, tool: 'read', status: 'succeeded', output })),
});

describe('workflow Smart Result Delivery', () => {
  it('returns small results directly without requiring additional model calls', () => {
    const store = createWorkflowResultStore();
    const response = deliverWorkflowResult(run([{ ready: true }, ['a', 'b']]), store);
    const steps = response.steps as Array<{ output: unknown; resultRef: string }>;
    expect(response.deliveryMode).toBe('smart');
    expect(steps[0]?.output).toEqual({ ready: true });
    expect(steps[1]?.output).toEqual(['a', 'b']);
    expect(store.count()).toBe(2);
    expect(JSON.parse(store.get(steps[0]!.resultRef).text)).toEqual({ ready: true });
  });

  it('keeps large intermediate results out of model context and supports bounded on-demand retrieval', () => {
    const store = createWorkflowResultStore();
    const content = 'Q'.repeat(50_000);
    const response = deliverWorkflowResult(run([{ fullText: content }]), store, { maxChars: 8_000 });
    const step = (
      response.steps as Array<{
        output?: unknown;
        outputPreview?: string;
        resultRef: string;
        previewTruncated: boolean;
      }>
    )[0]!;
    expect(JSON.stringify(response).length).toBeLessThan(8_000);
    expect(step.output).toBeUndefined();
    expect(step.previewTruncated).toBe(true);
    expect(step.outputPreview?.length).toBeLessThanOrEqual(600);
    const chunks: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const chunk = store.get(step.resultRef, offset, 4_000);
      chunks.push(chunk.text);
      offset = chunk.nextOffset;
    }
    expect(JSON.parse(chunks.join(''))).toEqual({ fullText: content });
  });

  it('selects only explicit output paths and reports omitted/missing selectors', () => {
    const store = createWorkflowResultStore();
    const result = deliverWorkflowResult(
      run([{ payload: { ok: true, key: 'x' }, ignored: 'Y'.repeat(20_000) }]),
      store,
      {
        mode: 'selected',
        select: [
          { stepId: 'step_0', path: ['payload', 'ok'] },
          { stepId: 'step_0', path: ['payload', 'missing'] },
          { stepId: 'step_0', path: ['__proto__', 'foo'] },
        ],
      }
    );
    const step = (result.steps as Array<{ selected: Record<string, unknown>; omittedPaths: string[] }>)[0]!;
    expect(step.selected).toEqual({ 'payload.ok': true });
    expect(step.omittedPaths).toEqual(['payload.missing', '__proto__.foo']);
    expect(JSON.stringify(result)).not.toContain('YYYY');
  });

  it('supports errorsOnly metadata without echoing successful payloads', () => {
    const store = createWorkflowResultStore();
    const response = deliverWorkflowResult(
      {
        status: 'failed',
        steps: [
          { id: 'A', tool: 'a', status: 'failed', error: 'A failed' },
          { id: 'E', tool: 'e', status: 'succeeded', output: 'long-secret-result' },
        ],
      },
      store,
      { mode: 'errorsOnly' }
    );
    const serialized = JSON.stringify(response);
    expect(serialized).toContain('A failed');
    expect(serialized).not.toContain('long-secret-result');
    expect(store.count()).toBe(1);
  });

  it('full mode never silently truncates a requested result, returns refs on delivery overflow', () => {
    const store = createWorkflowResultStore();
    const output = 'Z'.repeat(25_000);
    const response = deliverWorkflowResult(run([output]), store, { mode: 'full', maxChars: 8_000 });
    expect(response.deliveryLimitExceeded).toBe(true);
    const ref = (response.steps as Array<{ resultRef: string }>)[0]!.resultRef;
    expect(store.get(ref).text).toContain('ZZZZ');
    expect(JSON.stringify(response)).not.toContain('ZZZZ');
  });

  it('expires refs and prevents out-of-range reads, with no global shared store', () => {
    let now = 0;
    const store = createWorkflowResultStore(() => now);
    const ref = store.put('A', { info: 'private' }).ref;
    expect(() => store.get(ref, -1)).toThrow('WORKFLOW_RESULT_OFFSET_INVALID');
    expect(() => store.get(ref, 0, 20_000)).toThrow('WORKFLOW_RESULT_LIMIT_INVALID');
    expect(() => createWorkflowResultStore().get(ref)).toThrow('WORKFLOW_RESULT_REFERENCE_UNAVAILABLE');
    now += 600_001;
    expect(() => store.get(ref)).toThrow('WORKFLOW_RESULT_REFERENCE_UNAVAILABLE');
    expect(store.count()).toBe(0);
  });

  it('refuses oversized outputs rather than returning a corrupted JSON slice', () => {
    const store = createWorkflowResultStore();
    expect(() => store.put('X', 'X'.repeat(2_100_000))).toThrow('WORKFLOW_RESULT_STORE_CAPACITY');
  });
});
