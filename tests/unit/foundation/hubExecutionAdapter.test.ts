import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { RunIntent } from '../../../packages/desktop/src/common/foundation/runTypes';
import {
  HubExecutionAdapter,
  type HubTargetKind,
} from '../../../packages/desktop/src/process/foundation/hubExecutionAdapter';
import { RunKernel } from '../../../packages/desktop/src/process/foundation/runKernel';
import { EventStore } from '../../../packages/desktop/src/process/foundation/eventStore';
import { JsonlDurableEventStore } from '../../../packages/desktop/src/process/services/agentChat/durability';
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

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
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
      allowedCapabilities: ['target.execute', 'workspace.read'],
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

  it('inspects the cloud-bound prompt before the target can transmit it', async () => {
    const trustBroker = new TrustBroker({
      allowedNetworkHosts: ['api.example.test'],
      allowedOrigins: ['app://hub'],
    });
    const inspectOutbound = vi.spyOn(trustBroker, 'inspectFinalEgress').mockImplementation((request) => ({
      runId: request.runId,
      taskId: request.taskId,
      targetId: request.targetId,
      capabilities: request.requestedCapabilities,
      receiptId: 'outbound-denied',
      decision: 'deny',
      reasonCode: 'FINAL_EGRESS_SECRET_DETECTED',
    }));
    let executed = false;
    const hub = new HubExecutionAdapter(
      new RunKernel(),
      [
        {
          id: 'cloud_egress_guard',
          kind: 'cloud',
          priority: 1,
          networkHost: 'api.example.test',
          execute: async () => {
            executed = true;
            return { text: 'unexpected', evidenceRefs: [] };
          },
        },
      ],
      { trustBroker, origin: 'app://hub' }
    );

    const result = await hub.execute(intent('run_cloud_egress'));

    expect(executed).toBe(false);
    expect(inspectOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ serializedPayload: 'Answer a governed goal.' })
    );
    expect(result.receipt.status).not.toBe('verified');
  });

  it('treats a supervised CLI with a discovered network host as an inspected network target', async () => {
    const trustBroker = new TrustBroker({
      allowedNetworkHosts: ['cli.example.test'],
      allowedOrigins: ['app://hub'],
    });
    const inspectOutbound = vi.spyOn(trustBroker, 'inspectFinalEgress').mockImplementation((request) => ({
      runId: request.runId,
      taskId: request.taskId,
      targetId: request.targetId,
      capabilities: request.requestedCapabilities,
      receiptId: 'cli-outbound-denied',
      decision: 'deny',
      reasonCode: 'FINAL_EGRESS_SECRET_DETECTED',
    }));
    let executed = false;
    const hub = new HubExecutionAdapter(
      new RunKernel(),
      [
        {
          id: 'supervised_cli_egress_guard',
          kind: 'cli',
          priority: 1,
          networkHost: 'cli.example.test',
          execute: async () => {
            executed = true;
            return { text: 'unexpected', evidenceRefs: [] };
          },
        },
      ],
      { trustBroker, origin: 'app://hub' }
    );

    const result = await hub.execute(intent('run_cli_egress'));

    expect(executed).toBe(false);
    expect(inspectOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'network', serializedPayload: 'Answer a governed goal.' })
    );
    expect(result.receipt.status).not.toBe('verified');
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

  it('persists one Trust-governed cloud receipt across restart without replaying its terminal run', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tomny-c2-hub-'));
    temporaryDirectories.push(directory);
    const journalPath = path.join(directory, 'foundation.jsonl');
    const trustBroker = new TrustBroker({
      allowedCapabilities: ['target.execute'],
      allowedNetworkHosts: ['api.example.test'],
      allowedOrigins: ['app://hub'],
    });
    const writer = new RunKernel({ eventStore: new EventStore({ journal: new JsonlDurableEventStore(journalPath) }) });
    const hub = new HubExecutionAdapter(
      writer,
      [
        {
          id: 'cloud_c2',
          kind: 'cloud',
          priority: 1,
          networkHost: 'api.example.test',
          execute: async () => ({ text: 'governed result', evidenceRefs: ['cloud-c2-evidence'] }),
        },
      ],
      { trustBroker, origin: 'app://hub' }
    );

    const result = await hub.execute(intent('run_c2_restart'));
    expect(result).toMatchObject({ targetId: 'cloud_c2', receipt: { status: 'verified' } });

    const restarted = new EventStore({ journal: new JsonlDurableEventStore(journalPath) });
    await restarted.initialize();
    const recovered = restarted.getEventsByRunId('run_c2_restart');
    expect(recovered.at(-1)).toMatchObject({ eventType: 'outcome.verified' });
    expect(recovered.filter((event) => event.eventType === 'outcome.verified')).toHaveLength(1);
    await expect(
      restarted.appendDurably(
        {
          ...recovered.at(-1)!,
          eventId: 'evt_after_terminal',
          eventType: 'lease.released',
          sequence: recovered.length,
        },
        'run_c2_restart:after-terminal'
      )
    ).rejects.toThrow('Cannot append event after terminal state');
  });
});
