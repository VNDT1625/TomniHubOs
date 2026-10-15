import { describe, expect, it } from 'vitest';
import { createWorkflowMailbox } from '@process/agentRuntime/agentMesh/workflow/mailbox';
import { createWorkflowResultStore } from '@process/agentRuntime/agentMesh/workflow/resultDelivery';

describe('Workflow Mailbox and wakeup deduplication', () => {
  it('buffers sibling completions without model wakeups and acknowledges by cursor', async () => {
    let clock = 1_000;
    const store = createWorkflowResultStore(() => clock);
    const mailbox = createWorkflowMailbox(store, () => clock);
    const job = mailbox.create('flow-1', 'turn-A');
    job.reserveSteps(['A', 'B', 'C', 'E']);
    let wakes = 0;
    const checkpoint = job.checkpoint().then((value) => {
      wakes += 1;
      return value;
    });
    job.onStepSettled({ id: 'A', tool: 'fail', status: 'failed', error: 'A failed' });
    const early = await checkpoint;
    expect(early.status).toBe('needs_agent');
    expect(wakes).toBe(1);
    job.onStepSettled({ id: 'B', tool: 'b', status: 'succeeded', output: { ok: true } });
    job.onStepSettled({ id: 'C', tool: 'c', status: 'succeeded', output: { ok: true } });
    job.onStepSettled({ id: 'E', tool: 'e', status: 'succeeded', output: { value: 123 } });
    expect(wakes).toBe(1);
    expect(mailbox.list()[0]?.unread).toBe(4);
    const first = mailbox.read('flow-1', 0, 2);
    expect(first.events).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(mailbox.list()[0]?.unread).toBe(2);
    const next = mailbox.read('flow-1', first.cursor, 8);
    expect(next.events.map((event) => event.stepId)).toEqual(['C', 'E']);
    expect(mailbox.list()[0]?.unread).toBe(0);
    const ref = next.events[1]?.resultRef;
    expect(ref).toBeTruthy();
    expect(JSON.parse(store.get(ref!).text)).toEqual({ value: 123 });
    job.complete({ status: 'failed', steps: [] });
    expect(mailbox.read('flow-1').status).toBe('needs_agent');
  });

  it('resume appends uniquely named repair steps to the same run, not a second workflow', () => {
    const mailbox = createWorkflowMailbox(createWorkflowResultStore());
    const original = mailbox.create('job-123', 'turn1');
    original.reserveSteps(['A', 'B']);
    original.onStepSettled({ id: 'A', tool: 'a', status: 'failed', error: 'fail' });
    const repair = mailbox.resume('job-123', ['fixA'], 'turn2');
    expect(() => mailbox.resume('job-123', ['fixA'], 'turn3')).toThrow('WORKFLOW_RESUME_STEP_CONFLICT');
    repair.onStepSettled({ id: 'fixA', tool: 'fix', status: 'succeeded', output: 'ok' });
    repair.complete({ status: 'completed', steps: [] }, true);
    original.onStepSettled({ id: 'B', tool: 'b', status: 'succeeded', output: 'done' });
    original.complete({ status: 'failed', steps: [] });
    expect(mailbox.read('job-123').status).toBe('completed_with_errors');
    expect(mailbox.read('job-123').events).toHaveLength(3);
  });

  it('cancels only jobs owned by a user-cancelled turn and retains unrelated sessions', () => {
    const mailbox = createWorkflowMailbox(createWorkflowResultStore());
    mailbox.create('first', 'turn1');
    mailbox.create('second', 'turn2');
    mailbox.abortByOwner('turn1');
    expect(mailbox.read('first').status).toBe('cancelled');
    expect(mailbox.read('second').status).toBe('running');
  });

  it('expires completed jobs after TTL, but not active ones', () => {
    let now = 0;
    const mailbox = createWorkflowMailbox(
      createWorkflowResultStore(() => now),
      () => now
    );
    const job = mailbox.create('stale');
    job.complete({ status: 'completed', steps: [] });
    mailbox.create('active');
    now += 600_001;
    expect(mailbox.list()).toEqual([{ workflowId: 'active', status: 'running', cursor: 0, unread: 0 }]);
    expect(() => mailbox.read('stale')).toThrow('WORKFLOW_MAILBOX_NOT_FOUND');
  });
});
