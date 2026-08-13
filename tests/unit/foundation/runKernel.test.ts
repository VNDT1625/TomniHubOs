import { describe, expect, it } from 'vitest';
import type { ExecutionPlan, PolicyDecision } from '../../../packages/desktop/src/common/foundation/decisionTypes';
import type { RunIntent } from '../../../packages/desktop/src/common/foundation/runTypes';
import { ChoiceAdapter } from '../../../packages/desktop/src/process/foundation/choiceAdapter';
import { ContextAdapter } from '../../../packages/desktop/src/process/foundation/contextAdapter';
import { RunKernel } from '../../../packages/desktop/src/process/foundation/runKernel';
import { ResourceAdapter } from '../../../packages/desktop/src/process/foundation/resourceAdapter';
import { SecurityAdapter } from '../../../packages/desktop/src/process/foundation/securityAdapter';

class PreflightApprovalRequiredSecurityAdapter extends SecurityAdapter {
  public override async preflightCheck(intent: RunIntent): Promise<PolicyDecision> {
    return {
      decision: 'approval_required',
      runId: intent.runId,
      taskId: intent.rootTaskId,
      capabilities: ['workspace.write'],
      reasonCode: 'SECURITY_APPROVAL_REQUIRED',
      receiptId: 'receipt_preflight_approval',
    };
  }
}

class TargetApprovalRequiredSecurityAdapter extends SecurityAdapter {
  public override async targetPreflight(intent: RunIntent, targetId: string): Promise<PolicyDecision> {
    return {
      decision: 'approval_required',
      runId: intent.runId,
      taskId: intent.rootTaskId,
      targetId,
      capabilities: ['target.execute'],
      reasonCode: 'TARGET_SECURITY_APPROVAL_REQUIRED',
      receiptId: 'receipt_target_approval',
    };
  }
}

class PreflightFailureSecurityAdapter extends SecurityAdapter {
  public override async preflightCheck(_intent: RunIntent): Promise<PolicyDecision> {
    throw new Error('Security adapter unavailable.');
  }
}

class TargetFailureSecurityAdapter extends SecurityAdapter {
  public override async targetPreflight(_intent: RunIntent, _targetId: string): Promise<PolicyDecision> {
    throw new Error('Target security adapter unavailable.');
  }
}

class ContextFailureAdapter extends ContextAdapter {
  public override async projectContext(): Promise<never> {
    throw new Error('Context projection unavailable.');
  }
}

class ChoiceFailureAdapter extends ChoiceAdapter {
  public override async selectCandidate(): Promise<never> {
    throw new Error('Candidate selection unavailable.');
  }
}

class LeaseRequestFailureResourceAdapter extends ResourceAdapter {
  public override async requestLease(_plan: ExecutionPlan): Promise<never> {
    throw new Error('Resource budget exhausted.');
  }
}

class LeaseReleaseFailureResourceAdapter extends ResourceAdapter {
  public override async releaseLease(_leaseId: string): Promise<boolean> {
    throw new Error('Coordinator unavailable during release.');
  }
}

class LeaseAlreadyReleasedResourceAdapter extends ResourceAdapter {
  public override async releaseLease(_leaseId: string): Promise<boolean> {
    return false;
  }
}

describe('RunKernel Foundation Integration', () => {
  const createTestIntent = (override?: Partial<RunIntent>): RunIntent => ({
    runId: 'run_test_1',
    rootTaskId: 'task_root_1',
    surface: 'test_surface',
    goal: 'Test RunKernel execution',
    constraints: ['safe_only'],
    successCriteria: ['completed'],
    workspaceScope: 'C:/test/workspace',
    userId: 'user_1',
    createdAt: Date.now(),
    correlationId: 'corr_1',
    policyVersion: '1.0.0',
    ...override,
  });

  it('should successfully orchestrate a run from intent to verified outcome', async () => {
    const kernel = new RunKernel();
    const intent = createTestIntent();
    const candidates = [
      { id: 'candidate_a', factors: { speed: 0.9, accuracy: 0.95 } },
      { id: 'candidate_b', factors: { speed: 0.5, accuracy: 0.7 } },
    ];

    const receipt = await kernel.executeRun(intent, candidates, async (leaseId) => {
      expect(leaseId).toBeDefined();
      return { evidenceRefs: ['ev_1', 'ev_2'] };
    });

    expect(receipt.status).toBe('verified');
    expect(receipt.runId).toBe(intent.runId);
    expect(receipt.evidenceRefs).toEqual(['ev_1', 'ev_2']);

    const events = kernel.eventStore.getEventsByRunId(intent.runId);
    expect(events.length).toBeGreaterThanOrEqual(9);
    expect(events[0].eventType).toBe('run.created');
    expect(events[events.length - 1].eventType).toBe('lease.released');
  });

  it('should handle empty candidates by returning failed receipt', async () => {
    const kernel = new RunKernel();
    const intent = createTestIntent({ runId: 'run_test_empty' });

    const receipt = await kernel.executeRun(intent, [], async () => {
      return { evidenceRefs: [] };
    });

    expect(receipt.status).toBe('failed');
    const events = kernel.eventStore.getEventsByRunId(intent.runId);
    const failedEvent = events.find((e) => e.eventType === 'run.failed');
    expect(failedEvent?.payload.reason).toBe('NO_CANDIDATE_SELECTED');
  });

  it('should release lease even if executor throws an error', async () => {
    const kernel = new RunKernel();
    const intent = createTestIntent({ runId: 'run_test_throw' });
    const candidates = [{ id: 'candidate_a', factors: { score: 1 } }];

    const receipt = await kernel.executeRun(intent, candidates, async () => {
      throw new Error('Executor crash');
    });

    expect(receipt.status).toBe('failed');
    expect(kernel.resourceAdapter.getActiveLeases().length).toBe(0);
    const events = kernel.eventStore.getEventsByRunId(intent.runId);
    expect(events.some((e) => e.eventType === 'lease.released')).toBe(true);
  });

  it('fails closed before selection when context projection throws', async () => {
    const kernel = new RunKernel({ contextAdapter: new ContextFailureAdapter() });
    const intent = createTestIntent({ runId: 'run_test_context_projection_failed' });
    let executorCalled = false;

    const receipt = await kernel.executeRun(intent, [{ id: 'candidate_a', factors: { score: 1 } }], async () => {
      executorCalled = true;
      return { evidenceRefs: [] };
    });

    expect(receipt.status).toBe('failed');
    expect(executorCalled).toBe(false);
    expect(kernel.resourceAdapter.getActiveLeases()).toHaveLength(0);
    expect(kernel.eventStore.getEventsByRunId(intent.runId)).toContainEqual(
      expect.objectContaining({ eventType: 'run.failed', payload: { reason: 'CONTEXT_PROJECTION_FAILED' } })
    );
  });

  it('fails closed before target preflight when candidate selection throws', async () => {
    const kernel = new RunKernel({ choiceAdapter: new ChoiceFailureAdapter() });
    const intent = createTestIntent({ runId: 'run_test_candidate_selection_failed' });
    let executorCalled = false;

    const receipt = await kernel.executeRun(intent, [{ id: 'candidate_a', factors: { score: 1 } }], async () => {
      executorCalled = true;
      return { evidenceRefs: [] };
    });

    expect(receipt.status).toBe('failed');
    expect(executorCalled).toBe(false);
    expect(kernel.resourceAdapter.getActiveLeases()).toHaveLength(0);
    expect(kernel.eventStore.getEventsByRunId(intent.runId)).toContainEqual(
      expect.objectContaining({ eventType: 'run.failed', payload: { reason: 'CANDIDATE_SELECTION_FAILED' } })
    );
  });

  it('fails closed with a receipt when the security preflight adapter throws', async () => {
    const kernel = new RunKernel({ securityAdapter: new PreflightFailureSecurityAdapter() });
    const intent = createTestIntent({ runId: 'run_test_security_preflight_failed' });
    let executorCalled = false;

    const receipt = await kernel.executeRun(intent, [{ id: 'candidate_a', factors: { score: 1 } }], async () => {
      executorCalled = true;
      return { evidenceRefs: [] };
    });

    expect(receipt.status).toBe('failed');
    expect(executorCalled).toBe(false);
    expect(kernel.resourceAdapter.getActiveLeases()).toHaveLength(0);
    expect(kernel.eventStore.getEventsByRunId(intent.runId)).toContainEqual(
      expect.objectContaining({ eventType: 'run.failed', payload: { reason: 'SECURITY_PREFLIGHT_FAILED' } })
    );
  });

  it('fails closed before leasing resources when target security preflight throws', async () => {
    const kernel = new RunKernel({ securityAdapter: new TargetFailureSecurityAdapter() });
    const intent = createTestIntent({ runId: 'run_test_target_security_preflight_failed' });
    let executorCalled = false;

    const receipt = await kernel.executeRun(intent, [{ id: 'candidate_a', factors: { score: 1 } }], async () => {
      executorCalled = true;
      return { evidenceRefs: [] };
    });

    expect(receipt.status).toBe('failed');
    expect(executorCalled).toBe(false);
    expect(kernel.resourceAdapter.getActiveLeases()).toHaveLength(0);
    expect(kernel.eventStore.getEventsByRunId(intent.runId)).toContainEqual(
      expect.objectContaining({ eventType: 'run.failed', payload: { reason: 'TARGET_SECURITY_PREFLIGHT_FAILED' } })
    );
  });

  it('returns a failed receipt when the resource lease is rejected', async () => {
    const kernel = new RunKernel({ resourceAdapter: new LeaseRequestFailureResourceAdapter() });
    const intent = createTestIntent({ runId: 'run_test_lease_rejected' });
    let executorCalled = false;

    const receipt = await kernel.executeRun(intent, [{ id: 'candidate_a', factors: { score: 1 } }], async () => {
      executorCalled = true;
      return { evidenceRefs: [] };
    });

    expect(receipt.status).toBe('failed');
    expect(receipt.leaseId).toBeUndefined();
    expect(executorCalled).toBe(false);
    const events = kernel.eventStore.getEventsByRunId(intent.runId);
    expect(events).toContainEqual(
      expect.objectContaining({ eventType: 'run.failed', payload: { reason: 'RESOURCE_LEASE_REJECTED' } })
    );
    expect(events.some((event) => event.eventType === 'lease.granted')).toBe(false);
  });

  it('marks the receipt failed when lease cleanup cannot be confirmed', async () => {
    const kernel = new RunKernel({ resourceAdapter: new LeaseReleaseFailureResourceAdapter() });
    const intent = createTestIntent({ runId: 'run_test_release_failed' });

    const receipt = await kernel.executeRun(intent, [{ id: 'candidate_a', factors: { score: 1 } }], async () => ({
      evidenceRefs: ['ev_completed_before_cleanup'],
    }));

    expect(receipt.status).toBe('failed');
    const events = kernel.eventStore.getEventsByRunId(intent.runId);
    expect(events).toContainEqual(
      expect.objectContaining({ eventType: 'run.failed', payload: { reason: 'LEASE_RELEASE_FAILED' } })
    );
    expect(events.some((event) => event.eventType === 'lease.released')).toBe(false);
  });

  it('marks the receipt failed when the lease was already absent during cleanup', async () => {
    const kernel = new RunKernel({ resourceAdapter: new LeaseAlreadyReleasedResourceAdapter() });
    const intent = createTestIntent({ runId: 'run_test_release_missing' });

    const receipt = await kernel.executeRun(intent, [{ id: 'candidate_a', factors: { score: 1 } }], async () => ({
      evidenceRefs: ['ev_completed_before_missing_cleanup'],
    }));

    expect(receipt.status).toBe('failed');
    const events = kernel.eventStore.getEventsByRunId(intent.runId);
    expect(events).toContainEqual(
      expect.objectContaining({ eventType: 'run.failed', payload: { reason: 'LEASE_RELEASE_FAILED' } })
    );
    expect(events.some((event) => event.eventType === 'lease.released')).toBe(false);
  });

  it('returns an auditable requirement without requesting a lease when preflight requires approval', async () => {
    const kernel = new RunKernel({ securityAdapter: new PreflightApprovalRequiredSecurityAdapter() });
    const intent = createTestIntent({ runId: 'run_test_preflight_approval' });
    let executorCalled = false;

    const receipt = await kernel.executeRun(intent, [{ id: 'candidate_a', factors: { score: 1 } }], async () => {
      executorCalled = true;
      return { evidenceRefs: [] };
    });

    expect(receipt.status).toBe('approval_required');
    expect(receipt.approval).toEqual({
      stage: 'preflight',
      decisionReceiptId: 'receipt_preflight_approval',
      reasonCode: 'SECURITY_APPROVAL_REQUIRED',
      capabilities: ['workspace.write'],
      expiresAt: undefined,
    });
    expect(executorCalled).toBe(false);
    expect(kernel.resourceAdapter.getActiveLeases()).toHaveLength(0);
    const events = kernel.eventStore.getEventsByRunId(intent.runId);
    expect(events).toContainEqual(
      expect.objectContaining({ eventType: 'approval.required', payload: expect.objectContaining(receipt.approval) })
    );
    expect(events.some((event) => event.eventType === 'run.failed')).toBe(false);
  });

  it('returns a target-scoped requirement without requesting a lease when target approval is required', async () => {
    const kernel = new RunKernel({ securityAdapter: new TargetApprovalRequiredSecurityAdapter() });
    const intent = createTestIntent({ runId: 'run_test_target_approval' });
    let executorCalled = false;

    const receipt = await kernel.executeRun(intent, [{ id: 'candidate_a', factors: { score: 1 } }], async () => {
      executorCalled = true;
      return { evidenceRefs: [] };
    });

    expect(receipt.status).toBe('approval_required');
    expect(receipt.approval).toEqual({
      stage: 'target-preflight',
      decisionReceiptId: 'receipt_target_approval',
      reasonCode: 'TARGET_SECURITY_APPROVAL_REQUIRED',
      targetId: 'candidate_a',
      capabilities: ['target.execute'],
      expiresAt: undefined,
    });
    expect(executorCalled).toBe(false);
    expect(kernel.resourceAdapter.getActiveLeases()).toHaveLength(0);
    const events = kernel.eventStore.getEventsByRunId(intent.runId);
    expect(events).toContainEqual(
      expect.objectContaining({ eventType: 'approval.required', payload: expect.objectContaining(receipt.approval) })
    );
    expect(events.some((event) => event.eventType === 'run.failed')).toBe(false);
  });
});
