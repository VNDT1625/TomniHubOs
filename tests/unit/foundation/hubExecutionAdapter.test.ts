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
});
