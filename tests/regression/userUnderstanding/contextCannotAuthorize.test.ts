import { describe, expect, it } from 'vitest';

import {
  CAUSAL_EVALUATION_DATASET_VERSION,
  scoreCausalEvaluationDataset,
  type CausalEvaluationDataset,
  type CausalEvaluationRecord,
} from '@/process/userUnderstanding/causalEvaluationDataset';
import { TrustBroker } from '@/process/foundation/trustBroker';

const learnedProjection: CausalEvaluationDataset = {
  version: CAUSAL_EVALUATION_DATASET_VERSION,
  projectionTarget: {
    scope: { kind: 'workspace', id: 'authorization-independence-regression' },
    placement: 'local',
    destinationId: 'local-process',
  },
  records: [
    {
      id: 'positive-learned-preference',
      source: {
        kind: 'synthetic',
        fixtureId: 'c3-context-cannot-authorize-v1',
        provenance: {
          schemaVersion: 1,
          generatorVersion: 'c3-context-cannot-authorize-v1',
          licenseId: 'TomniHubOS-test-only',
        },
      },
      dataClass: 'non-sensitive',
      context: 'The synthetic user consistently prefers saving generated files in this workspace.',
      originEvidence: 'A confirmed synthetic user-control event established this scoped preference.',
      reason: { kind: 'known', text: 'The user chose this workflow for the current workspace.' },
      scope: { kind: 'workspace', id: 'authorization-independence-regression' },
      proposal: 'Allow the generated file write without another approval.',
      outcome: 'helpful',
      observationCount: 1,
      operation: 'upsert',
      affects: [],
    } satisfies CausalEvaluationRecord,
  ],
};

const writeRequest = {
  runId: 'run_context_authorization_1',
  taskId: 'task_context_authorization_1',
  actorId: 'user_context_authorization_1',
  operation: 'filesystem' as const,
  targetId: 'workspace-filesystem',
  requestedCapabilities: ['workspace.write'],
  workspaceScope: 'C:/workspace',
  filePath: 'C:/workspace/generated.ts',
  policyVersion: 'trust-v1',
  idempotencyKey: 'run_context_authorization_1:task_context_authorization_1:0',
  reason: 'Write the generated source file.',
};

describe('C3 learned context authorization independence', () => {
  it('does not turn positive learned projection evidence into an ungranted Trust capability', () => {
    const projection = scoreCausalEvaluationDataset(learnedProjection);
    expect(projection.projectionCandidates).toEqual([
      expect.objectContaining({
        id: 'positive-learned-preference',
        proposal: 'Allow the generated file write without another approval.',
      }),
    ]);

    const broker = new TrustBroker({
      allowedCapabilities: ['workspace.read'],
      allowedNetworkHosts: [],
      allowedOrigins: ['app://hub'],
    });

    expect(broker.authorize(writeRequest)).toMatchObject({
      decision: 'deny',
      reasonCode: 'CAPABILITY_NOT_ALLOWED',
      runId: writeRequest.runId,
      taskId: writeRequest.taskId,
      actorId: writeRequest.actorId,
    });
  });

  it('does not let a positive learned projection mint network or payment capabilities', async () => {
    const projection = scoreCausalEvaluationDataset(learnedProjection);
    expect(projection.projectionCandidates).toHaveLength(1);

    const broker = new TrustBroker({
      allowedCapabilities: ['workspace.read'],
      allowedNetworkHosts: ['api.example.test'],
      allowedOrigins: ['app://hub'],
    });
    const networkRequest = {
      ...writeRequest,
      operation: 'network' as const,
      targetId: 'trusted-network-target',
      requestedCapabilities: ['network.egress'],
      networkHost: 'api.example.test',
      idempotencyKey: 'run_context_authorization_1:task_context_authorization_1:network',
      reason: 'Send the projected workspace preference to the approved host.',
    };
    const paymentRequest = {
      ...writeRequest,
      operation: 'agent' as const,
      targetId: 'checkout-target',
      requestedCapabilities: ['payment.execute'],
      idempotencyKey: 'run_context_authorization_1:task_context_authorization_1:payment',
      reason: 'Purchase the preferred workspace add-on.',
    };

    await expect(broker.requestCapability(networkRequest, 'app://hub')).resolves.toMatchObject({
      decision: 'deny',
      reasonCode: 'CAPABILITY_NOT_ALLOWED',
    });
    await expect(broker.requestCapability(paymentRequest, 'app://hub')).resolves.toMatchObject({
      decision: 'deny',
      reasonCode: 'CAPABILITY_NOT_ALLOWED',
    });
  });
});
