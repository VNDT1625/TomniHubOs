import { describe, expect, it } from 'vitest';

import {
  classifyWorkKind,
  createFailureFingerprint,
  createWorkStatusController,
  deepDebugTask,
  isDeepDebugRequest,
  renderWorkStatus,
} from '@/process/services/debug/workStatus';

describe('WorkStatus', () => {
  it('classifies a bug action and keeps ordinary work in direct mode', () => {
    const controller = createWorkStatusController();
    const status = controller.start('repo', { intent: 'Fix the invoice request crash' });

    expect(status.kind).toBe('bug_fix');
    expect(status.mode).toBe('direct');
  });

  it('does not count the failing reproduction as a failed fix attempt', () => {
    const controller = createWorkStatusController();
    controller.start('repo', { intent: 'debug billing' });
    const status = controller.observe('repo', {
      identity: 'billing-probe',
      phase: 'reproduce',
      outcome: 'failed',
      fingerprint: 'GET /invoices/42 -> 404',
    });

    expect(status.attemptCount).toBe(0);
    expect(status.stagnationTicks).toBe(0);
    expect(status.attempts[0]?.outcome).toBe('baseline');
  });

  it('tries bounded online experience before multi-hypothesis backtracking', () => {
    const controller = createWorkStatusController();
    controller.start('repo', { intent: 'debug billing' });
    controller.observe('repo', {
      identity: 'billing-probe',
      phase: 'reproduce',
      outcome: 'failed',
      fingerprint: 'GET /invoices/42 -> 404',
    });
    const reassess = controller.observe('repo', {
      identity: 'billing-probe',
      phase: 'post-fix',
      outcome: 'failed',
      fingerprint: 'GET /invoices/99 -> 404',
      progress: 'none',
    });
    const onlineSearch = controller.observe('repo', {
      identity: 'billing-probe',
      phase: 'post-fix',
      outcome: 'failed',
      fingerprint: 'GET /invoices/100 -> 404',
      progress: 'none',
    });
    const firstOnlineFailure = controller.observe('repo', {
      identity: 'billing-probe',
      phase: 'post-fix',
      outcome: 'failed',
      fingerprint: 'GET /invoices/101 -> 404',
      progress: 'none',
    });
    const backtrack = controller.observe('repo', {
      identity: 'billing-probe',
      phase: 'post-fix',
      outcome: 'failed',
      fingerprint: 'GET /invoices/102 -> 404',
      progress: 'none',
    });

    expect(reassess.mode).toBe('reassess');
    expect(onlineSearch.mode).toBe('online-search');
    expect(firstOnlineFailure.mode).toBe('online-search');
    expect(backtrack.mode).toBe('backtrack');
    expect(backtrack.onlineSearchFailures).toBe(2);
    expect(renderWorkStatus(backtrack)).toContain('three independent hypotheses');
  });

  it('does not punish partial progress and completes on the matching verification pass', () => {
    const controller = createWorkStatusController();
    controller.start('repo', { intent: 'debug billing' });
    controller.observe('repo', {
      identity: 'billing-probe',
      phase: 'reproduce',
      outcome: 'failed',
      fingerprint: '8 unrelated APIs',
    });
    const improved = controller.observe('repo', {
      identity: 'billing-probe',
      phase: 'post-fix',
      outcome: 'failed',
      fingerprint: '3 unrelated APIs',
      progress: 'partial',
    });
    const passed = controller.observe('repo', {
      identity: 'billing-probe',
      phase: 'post-fix',
      outcome: 'passed',
    });

    expect(improved.stagnationTicks).toBe(0);
    expect(improved.attempts.at(-1)?.outcome).toBe('improved');
    expect(passed.mode).toBe('complete');
  });

  it('does not call a new failure signature stagnation until that signature repeats', () => {
    const controller = createWorkStatusController();
    controller.start('repo', { intent: 'debug billing' });
    controller.observe('repo', {
      identity: 'billing-probe',
      phase: 'reproduce',
      outcome: 'failed',
      fingerprint: 'HTTP 404',
    });
    const changed = controller.observe('repo', {
      identity: 'billing-probe',
      phase: 'post-fix',
      outcome: 'failed',
      fingerprint: 'TypeError parsing response',
    });
    const repeated = controller.observe('repo', {
      identity: 'billing-probe',
      phase: 'post-fix',
      outcome: 'failed',
      fingerprint: 'TypeError parsing response',
    });

    expect(changed.mode).toBe('direct');
    expect(changed.stagnationTicks).toBe(0);
    expect(repeated.mode).toBe('reassess');
  });

  it('enters Deep Debug immediately when the user invokes the command', () => {
    const controller = createWorkStatusController();
    const status = controller.start('repo', { intent: '/deep-debug invoice context is wrong' });

    expect(status.kind).toBe('bug_fix');
    expect(status.mode).toBe('deep-debug');
    expect(isDeepDebugRequest('/deep-debug investigate')).toBe(true);
    expect(deepDebugTask('/deep-debug investigate')).toBe('investigate');
  });

  it('normalizes dynamic ids in failure fingerprints', () => {
    expect(createFailureFingerprint('GET /invoices/42', 'request 123e4567-e89b-12d3-a456-426614174000')).toBe(
      createFailureFingerprint('GET /invoices/99', 'request a987f654-e89b-12d3-a456-426614174999')
    );
  });

  it('keeps non-debug task classification independent', () => {
    expect(classifyWorkKind('Implement a new settings panel')).toBe('feature');
    expect(classifyWorkKind('Trace the message flow without editing')).toBe('investigation');
  });
});
