import { describe, expect, it } from 'vitest';

import type { RunIntent } from '../../../packages/desktop/src/common/foundation/runTypes';
import {
  HubExecutionAdapter,
  type HubTargetKind,
} from '../../../packages/desktop/src/process/foundation/hubExecutionAdapter';
import { RunKernel } from '../../../packages/desktop/src/process/foundation/runKernel';
import { TrustBroker } from '../../../packages/desktop/src/process/foundation/trustBroker';

const intent = (runId: string): RunIntent => ({
  runId,
  rootTaskId: `${runId}_task`,
  surface: 'hub',
  goal: 'Answer a governed goal.',
  constraints: ['safe_only'],
  successCriteria: ['verified answer'],
  workspaceScope: 'C:/workspace',
  userId: 'user_1',
  createdAt: 1,
  correlationId: `${runId}_correlation`,
  policyVersion: '1.0.0',
});

describe('HubExecutionAdapter', () => {
  it.each<HubTargetKind>(['local', 'cloud', 'cli', 'mcp'])(
    'routes %s through a verified Run Kernel receipt',
    async (kind) => {
      const kernel = new RunKernel();
      const targetId = `${kind}_target`;
      const hub = new HubExecutionAdapter(kernel, [
        {
          id: targetId,
          kind,
          priority: 1,
          execute: async () => ({ text: `${kind} response`, evidenceRefs: [`evidence_${kind}`] }),
        },
      ]);

      const result = await hub.execute(intent(`run_${kind}`));

      expect(result).toMatchObject({ targetId, text: `${kind} response`, receipt: { status: 'verified' } });
      expect(result.receipt.evidenceRefs).toEqual([`evidence_${kind}`]);
      expect(kernel.eventStore.getEventsByRunId(`run_${kind}`).at(-1)?.eventType).toBe('outcome.verified');
    }
  );

  it('uses deterministic target priority and preserves selected target evidence', async () => {
    const kernel = new RunKernel();
    const hub = new HubExecutionAdapter(kernel, [
      {
        id: 'local_low',
        kind: 'local',
        priority: 1,
        execute: async () => ({ text: 'local', evidenceRefs: ['local'] }),
      },
      {
        id: 'cloud_high',
        kind: 'cloud',
        priority: 2,
        execute: async () => ({ text: 'cloud', evidenceRefs: ['cloud'] }),
      },
    ]);

    const result = await hub.execute(intent('run_priority'));

    expect(result).toMatchObject({ targetId: 'cloud_high', text: 'cloud', receipt: { evidenceRefs: ['cloud'] } });
  });

  it('requires origin, capability, and final egress approval for a cloud target', async () => {
    const trustBroker = new TrustBroker({
      allowedCapabilities: ['workspace.read'],
      allowedNetworkHosts: ['api.example.test'],
      allowedOrigins: ['app://hub'],
    });
    const hub = new HubExecutionAdapter(
      new RunKernel(),
      [
        {
          id: 'cloud_governed',
          kind: 'cloud',
          priority: 1,
          requestedCapabilities: ['workspace.read'],
          networkHost: 'api.example.test',
          execute: async () => ({ text: 'safe response', evidenceRefs: ['cloud_receipt'] }),
        },
      ],
      { trustBroker, origin: 'app://hub' }
    );

    const result = await hub.execute(intent('run_governed_cloud'));

    expect(result).toMatchObject({ targetId: 'cloud_governed', receipt: { status: 'verified' } });
  });

  it('filters unavailable, cloud, and unpinned targets before deterministic selection', async () => {
    const hub = new HubExecutionAdapter(new RunKernel(), [
      { id: 'cloud_fast', kind: 'cloud', priority: 10, execute: async () => ({ text: 'cloud', evidenceRefs: [] }) },
      { id: 'local_ready', kind: 'local', priority: 1, execute: async () => ({ text: 'local', evidenceRefs: [] }) },
      {
        id: 'local_unavailable',
        kind: 'local',
        priority: 20,
        health: 'unavailable',
        execute: async () => ({ text: 'unavailable', evidenceRefs: [] }),
      },
    ]);

    const offline = await hub.execute({ ...intent('run_offline'), constraints: ['offline_only'] });
    const pinned = await hub.execute({ ...intent('run_pinned'), constraints: ['target:local_ready'] });

    expect(offline).toMatchObject({ targetId: 'local_ready', text: 'local' });
    expect(pinned).toMatchObject({ targetId: 'local_ready', text: 'local' });
  });

  it('honors explicit capability grants and target resource budgets before selection', async () => {
    const hub = new HubExecutionAdapter(new RunKernel(), [
      {
        id: 'cloud_write',
        kind: 'cloud',
        priority: 100,
        requestedCapabilities: ['workspace.write'],
        estimatedCostMB: 32,
        execute: async () => ({ text: 'cloud', evidenceRefs: [] }),
      },
      {
        id: 'local_bounded',
        kind: 'local',
        priority: 1,
        requestedCapabilities: ['workspace.read'],
        estimatedCostMB: 16,
        execute: async () => ({ text: 'local', evidenceRefs: [] }),
      },
    ]);

    const result = await hub.execute({
      ...intent('run_capability_budget'),
      capabilityGrant: ['workspace.read', 'target.execute'],
      budget: { maxEstimatedCostMB: 16, maxSteps: 2 },
    });

    expect(result).toMatchObject({ targetId: 'local_bounded', text: 'local', receipt: { status: 'verified' } });
  });

  it('breaks equal target priorities by immutable id rather than discovery order', async () => {
    const hub = new HubExecutionAdapter(new RunKernel(), [
      {
        id: 'zulu',
        kind: 'local',
        priority: 1,
        execute: async () => ({ text: 'zulu', evidenceRefs: [] }),
      },
      {
        id: 'alpha',
        kind: 'local',
        priority: 1,
        execute: async () => ({ text: 'alpha', evidenceRefs: [] }),
      },
    ]);

    await expect(hub.execute(intent('run_stable_tiebreak'))).resolves.toMatchObject({
      targetId: 'alpha',
      text: 'alpha',
    });
  });

  it('rejects an explicit grant that omits target execution', async () => {
    const hub = new HubExecutionAdapter(new RunKernel(), [
      {
        id: 'local_denied',
        kind: 'local',
        priority: 1,
        requestedCapabilities: ['workspace.read'],
        execute: async () => ({ text: 'must not execute', evidenceRefs: [] }),
      },
    ]);

    const result = await hub.execute({
      ...intent('run_missing_execution_grant'),
      capabilityGrant: ['workspace.read'],
    });

    expect(result).toMatchObject({ receipt: { status: 'failed' } });
    expect(result.text).toBeUndefined();
  });
});
