import { describe, expect, it } from 'vitest';
import { assertRunIntent, createEvent, createIdempotencyKey, validateExecutionPlan } from '@/common/foundation';

describe('foundation contracts', () => {
  it('validates run identity and creates stable idempotency keys', () => {
    const intent = assertRunIntent({
      runId: 'run-1',
      rootTaskId: 'task-1',
      surface: 'chat',
      goal: 'goal',
      constraints: [],
      successCriteria: [],
      workspaceScope: 'workspace',
      userId: 'user',
      createdAt: 1,
      correlationId: 'corr',
      policyVersion: 'v1',
    });
    expect(intent.runId).toBe('run-1');
    expect(assertRunIntent({ ...intent, goal: 'First line\\nSecond line' }).goal).toBe('First line\\nSecond line');
    expect(createIdempotencyKey('run-1', 'task-1', 0)).toBe('run-1:task-1:0');
  });

  it('rejects unsafe event payloads and invalid execution plans', () => {
    expect(() =>
      createEvent({
        eventId: 'event',
        eventType: 'run.created',
        aggregateId: 'run-1',
        runId: 'run-1',
        sequence: 0,
        correlationId: 'corr',
        occurredAt: 1,
        schemaVersion: 1,
        payload: { apiKey: 'x' },
      })
    ).toThrow('Unsafe event payload');
    expect(() =>
      validateExecutionPlan({
        runId: 'run',
        taskId: 'task',
        candidateId: 'candidate',
        resourceKind: 'agent',
        estimatedCostMB: -1,
        priority: 0,
      })
    ).toThrow('estimated cost');
  });
});
