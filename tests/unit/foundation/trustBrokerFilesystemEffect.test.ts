import { describe, expect, it } from 'vitest';

import { TrustBroker } from '../../../packages/desktop/src/process/foundation/trustBroker';

const ORIGIN = 'tomny://governed-workspace-mutation';

const createBroker = () =>
  new TrustBroker({
    allowedCapabilities: ['workspace.write'],
    allowedNetworkHosts: [],
    trustedPackageIds: [],
    allowedOrigins: [ORIGIN],
    requireApprovalForMutation: false,
    capabilityGrantTtlMs: 60_000,
    policyVersion: 'filesystem-effect-test-v1',
  });

const request = {
  runId: 'filesystem-effect-run-1',
  taskId: 'filesystem-effect-task-1',
  actorId: 'account-1',
  operation: 'filesystem' as const,
  targetId: 'governed-workspace-mutation',
  requestedCapabilities: ['workspace.write'],
  workspaceScope: 'C:/workspace',
  policyVersion: 'filesystem-effect-test-v1',
  idempotencyKey: 'filesystem-effect-key-1',
  reason: 'Write the user-approved workspace file.',
  filePath: 'C:/workspace/src/app.ts',
};

describe('TrustBroker final filesystem effect inspection', () => {
  it('allows the final exact filesystem effect only with the matching live grant', async () => {
    const broker = createBroker();
    const grant = await broker.requestCapability(request, ORIGIN);

    await expect(
      broker.inspectFinalFilesystemEffect({ ...request, origin: ORIGIN, grantId: grant.grantId })
    ).resolves.toMatchObject({ decision: 'allow', grantId: grant.grantId });
  });

  it('denies a final filesystem effect when its file path differs from the granted request', async () => {
    const broker = createBroker();
    const grant = await broker.requestCapability(request, ORIGIN);

    await expect(
      broker.inspectFinalFilesystemEffect({
        ...request,
        filePath: 'C:/workspace/src/other.ts',
        origin: ORIGIN,
        grantId: grant.grantId,
      })
    ).resolves.toMatchObject({ decision: 'deny', reasonCode: 'FILESYSTEM_GRANT_INVALID' });
  });

  it('denies a final filesystem effect when its grant is missing or revoked', async () => {
    const broker = createBroker();
    const grant = await broker.requestCapability(request, ORIGIN);

    await expect(broker.inspectFinalFilesystemEffect({ ...request, origin: ORIGIN })).resolves.toMatchObject({
      decision: 'deny',
      reasonCode: 'FILESYSTEM_GRANT_REQUIRED',
    });

    await broker.revoke(grant.grantId!, 'User withdrew consent.');
    await expect(
      broker.inspectFinalFilesystemEffect({ ...request, origin: ORIGIN, grantId: grant.grantId })
    ).resolves.toMatchObject({ decision: 'deny', reasonCode: 'FILESYSTEM_GRANT_INVALID' });
  });
});
