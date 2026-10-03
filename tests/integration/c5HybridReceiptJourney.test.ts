import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CapabilityCandidate, CapabilityQuery } from '@/common/packages';
import type { RunIntent } from '@/common/foundation/runTypes';
import { EventStore } from '@/process/foundation/eventStore';
import { RunKernel } from '@/process/foundation/runKernel';
import { createSurfacePlanningService } from '@/process/resources/packageCapability/surfacePlanningService';
import { JsonlDurableEventStore } from '@/process/services/agentChat/durability';

const temporaryDirectories: string[] = [];
const accountId = 'account-c5-hybrid';
const requestedAt = '2030-08-01T12:00:00.000Z';

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const hubIdentity = { packageId: 'com.tomni.hub', packageVersion: '1.0.0', publisherId: 'com.tomni' } as const;

const query = (
  queryId: string,
  capability: string,
  dataLocation: CapabilityQuery['dataLocation']
): CapabilityQuery => ({
  schemaVersion: 1,
  queryId,
  requester: hubIdentity,
  capability,
  purpose: `C5 hybrid requirement: ${capability}`,
  dataLocation,
  requireUi: true,
  requireOffline: false,
  idempotencyKey: `idem-${queryId}`,
});

const candidate = (queryValue: CapabilityQuery, state: CapabilityCandidate['state']): CapabilityCandidate => ({
  schemaVersion: 1,
  candidateId: `surface:com.example.${state}:${queryValue.capability}`,
  package: {
    packageId: `com.example.${state}`,
    packageVersion: '1.0.0',
    publisherId: 'com.example',
  },
  contribution: {
    package: {
      packageId: `com.example.${state}`,
      packageVersion: '1.0.0',
      publisherId: 'com.example',
    },
    contributionId: state,
  },
  capability: queryValue.capability,
  state,
  trusted: true,
  compatible: true,
  healthy: true,
  dataLocation: queryValue.dataLocation,
  supportsUi: true,
  supportsOffline: false,
  reasonCodes: [`state:${state}`],
});

const intent = (overrides: Partial<RunIntent> = {}): RunIntent => ({
  runId: 'run-c5-hybrid-parent',
  rootTaskId: 'task-c5-hybrid',
  surface: 'hub',
  goal: 'Prepare locally and produce a remote-reviewed result.',
  constraints: ['governed'],
  successCriteria: ['one parent receipt with linked remote child evidence'],
  workspaceScope: 'workspace:c5-hybrid',
  userId: accountId,
  createdAt: Date.UTC(2030, 7, 1, 12, 0, 0),
  correlationId: 'correlation-c5-hybrid',
  policyVersion: 'trust-v1',
  capabilityGrant: ['workspace.read', 'target.execute'],
  budget: { maxEstimatedCostMB: 256, maxSteps: 2 },
  ...overrides,
});

describe('C5 hybrid planning and receipt journey', () => {
  it('plans a local-plus-remote handoff and persists one parent receipt linked to the verified remote child', async () => {
    const localQuery = query('query-local-prepare', 'workspace.read', 'local-only');
    const remoteQuery = query('query-remote-produce', 'target.execute', 'remote-allowed');
    const localCandidate = candidate(localQuery, 'ready-local');
    const remoteCandidate = candidate(remoteQuery, 'ready-remote');
    const planner = createSurfacePlanningService({
      sources: [
        {
          collect: async (input) =>
            input.queryId === localQuery.queryId
              ? [localCandidate]
              : input.queryId === remoteQuery.queryId
                ? [remoteCandidate]
                : [],
        },
      ],
      createProposalId: () => 'proposal-not-used',
      requiresPurchase: () => false,
      evaluatedAt: () => requestedAt,
    });

    const [localStep, remoteStep] = await planner.plan({
      queries: [localQuery, remoteQuery],
      requestedAt,
    });
    expect(localStep).toMatchObject({ kind: 'execute-local', candidate: { candidateId: localCandidate.candidateId } });
    expect(remoteStep).toMatchObject({
      kind: 'execute-remote',
      candidate: { candidateId: remoteCandidate.candidateId },
    });
    if (localStep?.kind !== 'execute-local' || remoteStep?.kind !== 'execute-remote') {
      throw new Error('Expected local and remote governed planning steps.');
    }

    const directory = await mkdtemp(path.join(os.tmpdir(), 'tomni-c5-hybrid-receipt-'));
    temporaryDirectories.push(directory);
    const journalPath = path.join(directory, 'foundation.jsonl');
    const kernel = new RunKernel({
      eventStore: new EventStore({ journal: new JsonlDurableEventStore(journalPath) }),
    });
    const parentIntent = intent();
    const childIntent = intent({
      runId: 'run-c5-hybrid-remote-child',
      parentRunId: parentIntent.runId,
      surface: remoteStep.candidate.candidateId,
      capabilityGrant: ['target.execute'],
      budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
    });
    let remoteExecutions = 0;

    const result = await kernel.executeRunWithChild(
      parentIntent,
      [{ id: localStep.candidate.candidateId, factors: { score: 1 } }],
      childIntent,
      [{ id: remoteStep.candidate.candidateId, factors: { score: 1 } }],
      async (_leaseId, _signal, targetId) => {
        remoteExecutions += 1;
        expect(targetId).toBe(remoteStep.candidate.candidateId);
        return { evidenceRefs: ['remote-output:c5-hybrid'] };
      },
      ['plan:local-preparation-complete']
    );

    expect(remoteExecutions).toBe(1);
    expect(result.childReceipt).toMatchObject({
      status: 'verified',
      runId: childIntent.runId,
      parentRunId: parentIntent.runId,
      evidenceRefs: ['remote-output:c5-hybrid'],
    });
    expect(result.parentReceipt).toMatchObject({
      status: 'verified',
      runId: parentIntent.runId,
      evidenceRefs: [
        'plan:local-preparation-complete',
        `child-receipt:${result.childReceipt.receiptId}`,
        'remote-output:c5-hybrid',
      ],
    });
    expect(
      kernel.eventStore.getEventsByRunId(parentIntent.runId).filter((event) => event.eventType === 'outcome.verified')
    ).toHaveLength(1);

    const restartedKernel = new RunKernel({
      eventStore: new EventStore({ journal: new JsonlDurableEventStore(journalPath) }),
    });
    await expect(restartedKernel.getReceiptForAccount(accountId, parentIntent.runId)).resolves.toEqual(
      result.parentReceipt
    );
    await expect(restartedKernel.getReceiptForAccount(accountId, childIntent.runId)).resolves.toEqual(
      result.childReceipt
    );

    const replayed = await restartedKernel.executeRunWithChild(
      parentIntent,
      [{ id: localStep.candidate.candidateId, factors: { score: 1 } }],
      childIntent,
      [{ id: remoteStep.candidate.candidateId, factors: { score: 1 } }],
      async () => {
        remoteExecutions += 1;
        return { evidenceRefs: ['remote-output:must-not-run-twice'] };
      },
      ['plan:must-not-run-twice']
    );
    expect(replayed).toEqual(result);
    expect(remoteExecutions).toBe(1);
    expect(
      restartedKernel.eventStore
        .getEventsByRunId(parentIntent.runId)
        .filter((event) => event.eventType === 'outcome.verified')
    ).toHaveLength(1);
    expect(
      restartedKernel.eventStore
        .getEventsByRunId(childIntent.runId)
        .filter((event) => event.eventType === 'outcome.verified')
    ).toHaveLength(1);
  });

  it('fails closed before a remote executor can run when the child does not link to its parent', async () => {
    const kernel = new RunKernel();
    const parentIntent = intent({ runId: 'run-c5-invalid-parent' });
    const unlinkedChild = intent({
      runId: 'run-c5-invalid-child',
      parentRunId: 'run-someone-else',
      capabilityGrant: ['target.execute'],
      budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
    });
    let remoteExecutions = 0;

    await expect(
      kernel.executeRunWithChild(
        parentIntent,
        [{ id: 'surface:local', factors: { score: 1 } }],
        unlinkedChild,
        [{ id: 'surface:remote', factors: { score: 1 } }],
        async () => {
          remoteExecutions += 1;
          return { evidenceRefs: ['must-not-exist'] };
        }
      )
    ).rejects.toThrow('Parent execution did not create a delegated child receipt.');

    expect(remoteExecutions).toBe(0);
    expect(kernel.eventStore.getEventsByRunId(unlinkedChild.runId)).toEqual([]);
    expect(kernel.eventStore.getEventsByRunId(parentIntent.runId).at(-1)).toMatchObject({
      eventType: 'run.failed',
      payload: { reason: 'EXECUTION_THREW_ERROR' },
    });
    await expect(
      kernel.executeDelegatedRun(
        parentIntent,
        unlinkedChild,
        [{ id: 'surface:remote', factors: { score: 1 } }],
        async () => ({
          evidenceRefs: [],
        })
      )
    ).rejects.toThrow('Delegated run must identify its parent run.');
  });
});
