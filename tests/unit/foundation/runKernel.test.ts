import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { redactSecretText } from '@process/agentRuntime/agentMesh/security';
import type { ExecutionPlan, PolicyDecision } from '../../../packages/desktop/src/common/foundation/decisionTypes';
import type { RunIntent } from '../../../packages/desktop/src/common/foundation/runTypes';
import { JsonlDurableEventStore } from '../../../packages/desktop/src/process/services/agentChat/durability';
import { ChoiceAdapter } from '../../../packages/desktop/src/process/foundation/choiceAdapter';
import { ContextAdapter } from '../../../packages/desktop/src/process/foundation/contextAdapter';
import { EventStore } from '../../../packages/desktop/src/process/foundation/eventStore';
import { type ActiveRunExecutionContext, RunKernel } from '../../../packages/desktop/src/process/foundation/runKernel';
import { redactFoundationTextForRenderer } from '../../../packages/desktop/src/process/bridge/foundationBridge';
import { ResourceAdapter } from '../../../packages/desktop/src/process/foundation/resourceAdapter';
import { SecurityAdapter } from '../../../packages/desktop/src/process/foundation/securityAdapter';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

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

class PermittingSecurityAdapter extends SecurityAdapter {
  public override async preflightCheck(intent: RunIntent): Promise<PolicyDecision> {
    return {
      decision: 'allow',
      runId: intent.runId,
      taskId: intent.rootTaskId,
      capabilities: ['workspace.read'],
      reasonCode: 'SAFE_ALLOW',
      receiptId: 'receipt_safe_preflight',
    };
  }

  public override async targetPreflight(intent: RunIntent, targetId: string): Promise<PolicyDecision> {
    return {
      decision: 'allow',
      runId: intent.runId,
      taskId: intent.rootTaskId,
      targetId,
      capabilities: ['target.execute'],
      reasonCode: 'SAFE_ALLOW',
      receiptId: 'receipt_safe_target',
    };
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
    expect(events[events.length - 1].eventType).toBe('outcome.verified');
  });

  it('keeps the goal in memory but durably records only a stable audit digest', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tomny-run-kernel-redaction-'));
    temporaryDirectories.push(directory);
    const journalPath = path.join(directory, 'foundation.jsonl');
    const eventStore = new EventStore({ journal: new JsonlDurableEventStore(journalPath) });
    const kernel = new RunKernel({ eventStore });
    const rawGoal = 'Build my confidential pricing plan for tomorrow.';
    const intent = createTestIntent({ runId: 'run_goal_redaction', goal: rawGoal });
    const preflight = vi.spyOn(kernel.securityAdapter, 'preflightCheck');

    const receipt = await kernel.executeRun(intent, [{ id: 'candidate_a', factors: { score: 1 } }], async () => ({
      evidenceRefs: ['evidence_1'],
    }));

    const expectedDigest = `sha256-${createHash('sha256').update(rawGoal, 'utf8').digest('hex')}`;
    expect(preflight).toHaveBeenCalledWith(expect.objectContaining({ goal: rawGoal }));
    expect(receipt.status).toBe('verified');
    expect(JSON.stringify(receipt)).not.toContain(rawGoal);

    const events = eventStore.getEventsByRunId(intent.runId);
    const created = events[0];
    expect(created).toMatchObject({
      eventType: 'run.created',
      payload: expect.objectContaining({ goalDigest: expectedDigest, goalProjection: 'redacted' }),
    });
    expect(created?.payload.goal).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain(rawGoal);

    const journal = await readFile(journalPath, 'utf8');
    expect(journal).not.toContain(rawGoal);
    expect(journal).toContain(expectedDigest);

    const recovered = new EventStore({ journal: new JsonlDurableEventStore(journalPath) });
    await recovered.initialize();
    expect(recovered.getEventsByRunId(intent.runId)).toEqual(events);
    expect(recovered.getEventsByRunId(intent.runId)[0]?.payload.goalDigest).toBe(expectedDigest);
  });

  it('keeps ANSI and serialized credentials out of the durable receipt and journal', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tomny-run-kernel-secret-firewall-'));
    temporaryDirectories.push(directory);
    const journalPath = path.join(directory, 'foundation.jsonl');
    const eventStore = new EventStore({ journal: new JsonlDurableEventStore(journalPath) });
    const kernel = new RunKernel({ eventStore });
    const credential = `ghp_${'a'.repeat(36)}`;
    const terminalCredential = `${credential.slice(0, 12)}\u001b[31m${credential.slice(12)}\u001b[0m`;
    const serializedCredential = JSON.stringify({ clientSecret: credential, scope: 'deploy' });
    const maliciousReference = '../../private/secret.txt';
    const rawGoal = `Deploy terminal output ${terminalCredential}; diagnostic payload ${serializedCredential}.`;
    const firewallResult = redactSecretText(rawGoal);
    const forbiddenRepresentations = [
      credential,
      terminalCredential,
      serializedCredential,
      maliciousReference,
      JSON.stringify(rawGoal),
    ];

    expect(firewallResult.redacted).toBe(true);
    for (const representation of forbiddenRepresentations) {
      expect(firewallResult.text).not.toContain(representation);
    }

    const projectContext = vi.spyOn(ContextAdapter.prototype, 'projectContext');
    const executor = vi.fn(async () => ({ evidenceRefs: ['evidence_1'] }));
    const deniedReceipt = await kernel.executeRun(
      createTestIntent({ runId: 'run_firewall_guard', goal: rawGoal }),
      [{ id: 'candidate_a', factors: { score: 1 } }],
      executor
    );
    expect(deniedReceipt).toMatchObject({ status: 'failed', evidenceRefs: [] });
    expect(projectContext).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();

    const events = eventStore.getEventsByRunId('run_firewall_guard');
    const journal = await readFile(journalPath, 'utf8');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ eventType: 'run.created', payload: { goalProjection: 'redacted' } });
    expect(events[1]).toMatchObject({ eventType: 'run.failed', payload: { reason: 'SENSITIVE_GOAL_DENIED' } });

    for (const representation of forbiddenRepresentations) {
      expect(JSON.stringify(events)).not.toContain(representation);
      expect(journal).not.toContain(representation);
    }

    const durableRunId = 'run_firewall_durable_projection';
    const durableKernel = new RunKernel({ eventStore, securityAdapter: new PermittingSecurityAdapter() });
    const transientReceipt = await durableKernel.executeRun(
      createTestIntent({ runId: durableRunId, goal: 'Complete a clean deployment.' }),
      [{ id: 'candidate_a', factors: { score: 1 } }],
      async () => ({
        evidenceRefs: ['evidence_safe_1', credential, terminalCredential, serializedCredential, maliciousReference],
      })
    );
    expect(transientReceipt.status).toBe('verified');
    expect(transientReceipt.evidenceRefs).toEqual(['evidence_safe_1']);

    const durableReceipt = await durableKernel.getReceiptForAccount('user_1', durableRunId);
    const restartedReceipt = await new RunKernel({
      eventStore: new EventStore({ journal: new JsonlDurableEventStore(journalPath) }),
    }).getReceiptForAccount('user_1', durableRunId);
    const durableEvents = eventStore.getEventsByRunId(durableRunId);
    const durableJournal = await readFile(journalPath, 'utf8');
    expect(durableReceipt).toMatchObject({ evidenceRefs: ['evidence_safe_1'] });
    expect(restartedReceipt).toMatchObject({ evidenceRefs: ['evidence_safe_1'] });

    for (const representation of forbiddenRepresentations) {
      expect(JSON.stringify(transientReceipt)).not.toContain(representation);
      expect(JSON.stringify(durableReceipt)).not.toContain(representation);
      expect(JSON.stringify(restartedReceipt)).not.toContain(representation);
      expect(JSON.stringify(durableEvents)).not.toContain(representation);
      expect(durableJournal).not.toContain(representation);
    }
  });

  it('redacts credential representations before Core text crosses the renderer boundary', () => {
    const credential = 'ghp_' + 'a'.repeat(36);
    const terminalCredential =
      credential.slice(0, 12) +
      String.fromCharCode(0x1b) +
      '[31m' +
      credential.slice(12) +
      String.fromCharCode(0x1b) +
      '[0m';
    const serializedCredential = JSON.stringify({ clientSecret: credential, scope: 'deploy' });
    const rawCoreText = 'Core diagnostic: ' + terminalCredential + '; payload ' + serializedCredential + '.';

    const rendererText = redactFoundationTextForRenderer(rawCoreText);

    for (const representation of [credential, terminalCredential, serializedCredential]) {
      expect(rendererText).not.toContain(representation);
    }
  });

  it('uses the canonical personal-context composer for governed projection without copying plaintext into the receipt projection', async () => {
    const inspectContext = vi.fn().mockResolvedValue({ agent: 'agent guidance', personal: 'personal guidance' });
    const adapter = new ContextAdapter({ composer: { composePrompt: vi.fn(), inspectContext } });
    const intent = createTestIntent({ userId: 'personal_1', surface: 'hub' });

    const projection = await adapter.projectContext(intent);

    expect(inspectContext).toHaveBeenCalledWith({
      agentId: 'tomny',
      personalId: 'personal_1',
      surface: 'hub',
      workspace: 'C:/test/workspace',
      secretContextPolicy: { includeOpaqueSecretHandles: false },
    });
    expect(projection.sourceRefs).toEqual(['C:/test/workspace', 'context-agent:tomny', 'context-personal:personal_1']);
    expect(projection.text).not.toContain('personal guidance');
  });

  it('executes a child run only within its parent grant and links its receipt', async () => {
    const kernel = new RunKernel();
    const parent = createTestIntent({
      runId: 'run_parent_1',
      rootTaskId: 'task_parent_1',
      capabilityGrant: ['workspace.read', 'agent.execute'],
      budget: { maxEstimatedCostMB: 256, maxSteps: 3 },
    });
    const child = createTestIntent({
      runId: 'run_child_1',
      rootTaskId: 'task_child_1',
      parentRunId: parent.runId,
      capabilityGrant: ['workspace.read'],
      budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
    });

    const receipt = await kernel.executeDelegatedRun(
      parent,
      child,
      [{ id: 'candidate_a', factors: { score: 1 } }],
      async () => ({
        evidenceRefs: ['evidence_child_1'],
      })
    );

    expect(receipt.status).toBe('verified');
    expect(receipt.parentRunId).toBe(parent.runId);
    expect(kernel.eventStore.getEventsByRunId(child.runId)[0]).toMatchObject({
      eventType: 'run.created',
      payload: expect.objectContaining({ parentRunId: parent.runId }),
    });
  });

  it('rejects child delegation that amplifies capability or budget', async () => {
    const kernel = new RunKernel();
    const parent = createTestIntent({
      runId: 'run_parent_restricted',
      capabilityGrant: ['workspace.read'],
      budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
    });
    const expandedChild = createTestIntent({
      runId: 'run_child_expanded',
      parentRunId: parent.runId,
      capabilityGrant: ['workspace.write'],
      budget: { maxEstimatedCostMB: 256, maxSteps: 2 },
    });

    await expect(
      kernel.executeDelegatedRun(parent, expandedChild, [{ id: 'candidate_a', factors: { score: 1 } }], async () => ({
        evidenceRefs: [],
      }))
    ).rejects.toThrow('Delegated run cannot amplify capabilities.');
    expect(kernel.eventStore.getEventsByRunId(expandedChild.runId)).toHaveLength(0);
  });

  it('fails a run before leasing when its explicit resource budget is insufficient', async () => {
    const kernel = new RunKernel();
    const intent = createTestIntent({
      runId: 'run_budget_too_small',
      budget: { maxEstimatedCostMB: 127, maxSteps: 1 },
    });

    const receipt = await kernel.executeRun(intent, [{ id: 'candidate_a', factors: { score: 1 } }], async () => ({
      evidenceRefs: [],
    }));

    expect(receipt.status).toBe('failed');
    expect(kernel.resourceAdapter.getActiveLeases()).toHaveLength(0);
    expect(kernel.eventStore.getEventsByRunId(intent.runId)).toContainEqual(
      expect.objectContaining({
        eventType: 'run.failed',
        payload: expect.objectContaining({ reason: 'RUN_BUDGET_EXCEEDED' }),
      })
    );
  });

  it('cancels before leasing and records a single terminal cancellation receipt', async () => {
    const kernel = new RunKernel();
    const controller = new AbortController();
    controller.abort();
    const intent = createTestIntent({ runId: 'run_cancelled_before_start' });
    let executorCalled = false;

    const receipt = await kernel.executeRun(
      intent,
      [{ id: 'candidate_a', factors: { score: 1 } }],
      async () => {
        executorCalled = true;
        return { evidenceRefs: [] };
      },
      controller.signal
    );

    expect(receipt.status).toBe('cancelled');
    expect(executorCalled).toBe(false);
    expect(kernel.resourceAdapter.getActiveLeases()).toHaveLength(0);
    expect(kernel.eventStore.getEventsByRunId(intent.runId).map((event) => event.eventType)).toEqual([
      'run.created',
      'run.cancelled',
    ]);
  });

  it('keeps a verified receipt when a trusted atomic local effect commits just before cancellation', async () => {
    const kernel = new RunKernel();
    const controller = new AbortController();
    const intent = createTestIntent({ runId: 'run_atomic_effect_committed_before_abort' });
    let committedWrites = 0;

    const receipt = await kernel.executeRun(
      intent,
      [{ id: 'candidate_a', factors: { score: 1 } }],
      async (_leaseId, signal) => {
        expect(signal?.aborted).toBe(false);
        // This models a trusted Main-only driver that returns only after its
        // atomic non-idempotent write and durable opaque evidence both commit.
        committedWrites += 1;
        controller.abort();
        return {
          evidenceRefs: ['workspace-write:atomic-commit-1'],
          effect: { state: 'committed', idempotencyKey: intent.correlationId },
        };
      },
      controller.signal
    );

    expect(committedWrites).toBe(1);
    expect(receipt).toMatchObject({
      status: 'verified',
      evidenceRefs: ['workspace-write:atomic-commit-1'],
    });
    expect(kernel.resourceAdapter.getActiveLeases()).toHaveLength(0);
    expect(kernel.eventStore.getEventsByRunId(intent.runId).at(-1)?.eventType).toBe('outcome.verified');
    expect(kernel.eventStore.getEventsByRunId(intent.runId).some((event) => event.eventType === 'run.cancelled')).toBe(
      false
    );
  });

  it('keeps an abort before a local effect as cancelled with no commit evidence', async () => {
    const kernel = new RunKernel();
    const controller = new AbortController();
    const intent = createTestIntent({ runId: 'run_atomic_effect_aborted_before_commit' });
    let committedWrites = 0;

    const receipt = await kernel.executeRun(
      intent,
      [{ id: 'candidate_a', factors: { score: 1 } }],
      async (_leaseId, signal) => {
        controller.abort();
        expect(signal?.aborted).toBe(true);
        // The trusted driver observes cancellation before its atomic boundary.
        expect(committedWrites).toBe(0);
        return { evidenceRefs: [] };
      },
      controller.signal
    );

    expect(committedWrites).toBe(0);
    expect(receipt).toMatchObject({ status: 'cancelled', evidenceRefs: [] });
    expect(kernel.resourceAdapter.getActiveLeases()).toHaveLength(0);
    expect(kernel.eventStore.getEventsByRunId(intent.runId).at(-1)?.eventType).toBe('run.cancelled');
  });

  it('propagates a parent cancellation signal to the delegated executor', async () => {
    const kernel = new RunKernel();
    const controller = new AbortController();
    const parent = createTestIntent({
      runId: 'run_parent_cancelled',
      capabilityGrant: ['workspace.read'],
      budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
    });
    const child = createTestIntent({
      runId: 'run_child_cancelled',
      parentRunId: parent.runId,
      capabilityGrant: ['workspace.read'],
      budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
    });

    const receipt = await kernel.executeDelegatedRun(
      parent,
      child,
      [{ id: 'candidate_a', factors: { score: 1 } }],
      async (_leaseId, signal) => {
        expect(signal).toBe(controller.signal);
        controller.abort();
        return { evidenceRefs: [] };
      },
      controller.signal
    );

    expect(receipt.status).toBe('cancelled');
    expect(kernel.resourceAdapter.getActiveLeases()).toHaveLength(0);
    expect(kernel.eventStore.getEventsByRunId(child.runId).at(-1)?.eventType).toBe('run.cancelled');
  });

  it('keeps the parent active until it aggregates verified bounded child evidence', async () => {
    const kernel = new RunKernel();
    const parent = createTestIntent({
      runId: 'run_parent_multistep',
      capabilityGrant: ['workspace.read'],
      budget: { maxEstimatedCostMB: 256, maxSteps: 2 },
    });
    const child = createTestIntent({
      runId: 'run_child_multistep',
      parentRunId: parent.runId,
      capabilityGrant: ['workspace.read'],
      budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
    });

    const result = await kernel.executeRunWithChild(
      parent,
      [{ id: 'parent_target', factors: { score: 1 } }],
      child,
      [{ id: 'child_target', factors: { score: 1 } }],
      async () => ({ evidenceRefs: ['child_evidence'] }),
      ['parent_evidence']
    );

    expect(result.childReceipt.status).toBe('verified');
    expect(result.parentReceipt.status).toBe('verified');
    expect(result.parentReceipt.evidenceRefs).toEqual([
      'parent_evidence',
      `child-receipt:${result.childReceipt.receiptId}`,
      'child_evidence',
    ]);
    const parentEvents = kernel.eventStore.getEventsByRunId(parent.runId);
    expect(parentEvents.at(-1)?.eventType).toBe('outcome.verified');
    expect(parentEvents.some((event) => event.eventType === 'outcome.verified')).toBe(true);
  });

  it('creates one parent lifecycle when an active executor delegates a child and retires that authority at terminal state', async () => {
    const kernel = new RunKernel();
    const parent = createTestIntent({
      runId: 'run_parent_active_scope',
      capabilityGrant: ['workspace.read'],
      budget: { maxEstimatedCostMB: 256, maxSteps: 2 },
    });
    const child = createTestIntent({
      runId: 'run_child_active_scope',
      parentRunId: parent.runId,
      capabilityGrant: ['workspace.read'],
      budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
    });
    let retiredScope: ActiveRunExecutionContext | undefined;
    let childReceiptId: string | undefined;

    const parentReceipt = await kernel.executeRun(
      parent,
      [{ id: 'parent_target', factors: { score: 1 } }],
      async (_leaseId, _signal, _targetId, activeRun) => {
        expect(activeRun?.isActive()).toBe(true);
        retiredScope = activeRun;
        if (activeRun === undefined) throw new Error('Expected an active parent Run scope.');
        const childReceipt = await activeRun.executeDelegatedChild({
          childIntent: child,
          candidates: [{ id: 'child_target', factors: { score: 1 } }],
          executor: async () => ({ evidenceRefs: ['child_evidence'] }),
          parentEvidence: ['parent_evidence'],
        });
        expect(childReceipt).toMatchObject({ status: 'verified', parentRunId: parent.runId });
        childReceiptId = childReceipt.receiptId;
        return { evidenceRefs: ['parent_executor_evidence'] };
      }
    );

    expect(parentReceipt.status).toBe('verified');
    expect(parentReceipt.evidenceRefs).toEqual([
      'parent_executor_evidence',
      'parent_evidence',
      `child-receipt:${childReceiptId}`,
      'child_evidence',
    ]);
    expect(
      kernel.eventStore.getEventsByRunId(parent.runId).filter((event) => event.eventType === 'run.created')
    ).toHaveLength(1);
    expect(
      kernel.eventStore.getEventsByRunId(parent.runId).filter((event) => event.eventType === 'outcome.verified')
    ).toHaveLength(1);
    expect(retiredScope?.isActive()).toBe(false);
    if (retiredScope === undefined) throw new Error('Expected a retired active Run scope.');
    await expect(
      retiredScope.executeDelegatedChild({
        childIntent: { ...child, runId: 'run_child_after_terminal' },
        candidates: [{ id: 'child_target', factors: { score: 1 } }],
        executor: async () => ({ evidenceRefs: [] }),
      })
    ).rejects.toThrow('ACTIVE_RUN_SCOPE_INACTIVE');
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
      expect.objectContaining({
        eventType: 'run.failed',
        payload: expect.objectContaining({ reason: 'CONTEXT_PROJECTION_FAILED' }),
      })
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
      expect.objectContaining({
        eventType: 'run.failed',
        payload: expect.objectContaining({ reason: 'CANDIDATE_SELECTION_FAILED' }),
      })
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
      expect.objectContaining({
        eventType: 'run.failed',
        payload: expect.objectContaining({ reason: 'SECURITY_PREFLIGHT_FAILED' }),
      })
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
      expect.objectContaining({
        eventType: 'run.failed',
        payload: expect.objectContaining({ reason: 'TARGET_SECURITY_PREFLIGHT_FAILED' }),
      })
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
      expect.objectContaining({
        eventType: 'run.failed',
        payload: expect.objectContaining({ reason: 'RESOURCE_LEASE_REJECTED' }),
      })
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
      expect.objectContaining({
        eventType: 'run.failed',
        payload: expect.objectContaining({ reason: 'LEASE_RELEASE_FAILED' }),
      })
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
      expect.objectContaining({
        eventType: 'run.failed',
        payload: expect.objectContaining({ reason: 'LEASE_RELEASE_FAILED' }),
      })
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

  it('recovers exactly one redacted terminal receipt only for its owning account', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tomny-run-kernel-owner-receipt-'));
    temporaryDirectories.push(directory);
    const journalPath = path.join(directory, 'foundation.jsonl');
    const intent = createTestIntent({
      runId: 'run_owner_receipt',
      userId: 'account-owner-1',
      goal: 'Do not persist this private goal.',
    });
    const kernel = new RunKernel({ eventStore: new EventStore({ journal: new JsonlDurableEventStore(journalPath) }) });

    const receipt = await kernel.executeRun(intent, [{ id: 'candidate_a', factors: { score: 1 } }], async () => ({
      evidenceRefs: ['evidence:receipt-1'],
    }));
    const terminal = kernel.eventStore.getEventsByRunId(intent.runId).at(-1);
    expect(terminal).toMatchObject({
      eventType: 'outcome.verified',
      payload: expect.objectContaining({ receiptId: receipt.receiptId, receiptStatus: 'verified' }),
    });
    expect(terminal?.payload.receiptOwnerAccountDigest).not.toBe(intent.userId);
    expect(await kernel.getReceiptForAccount('account-other-1', intent.runId)).toBeUndefined();

    const restarted = new RunKernel({
      eventStore: new EventStore({ journal: new JsonlDurableEventStore(journalPath) }),
    });
    await expect(restarted.getReceiptForAccount(intent.userId, intent.runId)).resolves.toEqual(receipt);
    await expect(restarted.getReceiptForAccount('account-other-1', intent.runId)).resolves.toBeUndefined();
    const journal = await readFile(journalPath, 'utf8');
    expect(journal).not.toContain(intent.userId);
    expect(journal).not.toContain(intent.goal);
  });

  it('returns a redacted event timeline only to the account bound by run.created', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tomny-run-kernel-owner-events-'));
    temporaryDirectories.push(directory);
    const journalPath = path.join(directory, 'foundation.jsonl');
    const intent = createTestIntent({
      runId: 'run_owner_events',
      userId: 'account-owner-events',
      workspaceScope: 'C:/private-workspace',
      goal: 'Never expose this goal.',
    });
    const kernel = new RunKernel({ eventStore: new EventStore({ journal: new JsonlDurableEventStore(journalPath) }) });

    await kernel.executeRun(intent, [{ id: 'candidate_a', factors: { score: 1 } }], async () => ({
      evidenceRefs: ['evidence:events-1'],
    }));

    await expect(kernel.getEventsForAccount('account-other-events', intent.runId)).resolves.toBeUndefined();
    const events = await kernel.getEventsForAccount(intent.userId, intent.runId);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'run.created' })]));
    const created = events?.find((event) => event.eventType === 'run.created');
    expect(created?.payload).toMatchObject({ goalProjection: 'redacted' });
    expect(created?.payload.ownerAccountDigest).toBeUndefined();
    expect(created?.payload.workspaceScope).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain(intent.goal);
    expect(JSON.stringify(events)).not.toContain(intent.workspaceScope);

    const legacyKernel = new RunKernel({
      eventStore: new EventStore({
        journal: {
          initialize: async () => {},
          append: async () => {},
          query: async () => [
            {
              sessionId: 'foundation.run-kernel',
              requestId: 'run_legacy_events',
              visibility: 'private',
              occurredAt: 1,
              payload: {
                foundationEvent: {
                  eventId: 'evt_legacy_0',
                  eventType: 'run.created',
                  aggregateId: 'run_legacy_events',
                  runId: 'run_legacy_events',
                  sequence: 0,
                  correlationId: 'correlation_legacy',
                  occurredAt: 1,
                  schemaVersion: 1,
                  payload: { goalDigest: 'sha256-legacy', goalProjection: 'redacted' },
                },
              },
            },
          ],
        },
      }),
    });
    await expect(legacyKernel.getEventsForAccount(intent.userId, 'run_legacy_events')).resolves.toBeUndefined();
  });

  it('reconstructs one parent and one child terminal receipt after restart without a duplicate effect', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tomny-run-kernel-parent-child-receipt-'));
    temporaryDirectories.push(directory);
    const journalPath = path.join(directory, 'foundation.jsonl');
    const owner = 'account-owner-2';
    const parentIntent = createTestIntent({
      runId: 'run_parent_receipt',
      userId: owner,
      capabilityGrant: ['target.execute'],
      budget: { maxEstimatedCostMB: 1024, maxSteps: 4 },
    });
    const childIntent = createTestIntent({
      runId: 'run_child_receipt',
      parentRunId: parentIntent.runId,
      userId: owner,
      capabilityGrant: ['target.execute'],
      budget: { maxEstimatedCostMB: 512, maxSteps: 2 },
    });
    const kernel = new RunKernel({ eventStore: new EventStore({ journal: new JsonlDurableEventStore(journalPath) }) });
    let childEffects = 0;
    const result = await kernel.executeRunWithChild(
      parentIntent,
      [{ id: 'parent-candidate', factors: { score: 1 } }],
      childIntent,
      [{ id: 'child-candidate', factors: { score: 1 } }],
      async () => {
        childEffects += 1;
        return { evidenceRefs: ['evidence:child-1'] };
      }
    );
    expect(childEffects).toBe(1);
    const restarted = new RunKernel({
      eventStore: new EventStore({ journal: new JsonlDurableEventStore(journalPath) }),
    });
    await expect(restarted.getReceiptForAccount(owner, parentIntent.runId)).resolves.toEqual(result.parentReceipt);
    await expect(restarted.getReceiptForAccount(owner, childIntent.runId)).resolves.toEqual(result.childReceipt);
    expect(childEffects).toBe(1);
  });
});
