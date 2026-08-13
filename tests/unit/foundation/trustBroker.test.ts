import { describe, expect, it } from 'vitest';

import { TrustBroker } from '../../../packages/desktop/src/process/foundation/trustBroker';

const createBroker = () =>
  new TrustBroker({
    allowedCapabilities: ['cli.execute', 'workspace.read', 'workspace.write'],
    allowedNetworkHosts: ['api.example.test'],
    trustedPackageIds: ['com.tomni.ide'],
    allowedOrigins: ['app://hub'],
  });

const request = {
  runId: 'run_trust_1',
  taskId: 'task_trust_1',
  operation: 'cli' as const,
  targetId: 'tool.example',
  requestedCapabilities: ['workspace.read'],
  workspaceScope: 'C:/workspace',
};

describe('TrustBroker', () => {
  it('allows an in-policy action and emits a structured receipt', () => {
    const decision = createBroker().authorize(request);

    expect(decision).toMatchObject({
      decision: 'allow',
      reasonCode: 'TRUST_ALLOWED',
      runId: request.runId,
      taskId: request.taskId,
    });
    expect(decision.receiptId).toContain('trust_run_trust_1_task_trust_1_cli_');
  });

  it('fails closed for ungranted capability, out-of-scope file, network, and package', () => {
    const broker = createBroker();

    expect(broker.authorize({ ...request, requestedCapabilities: ['shell.execute'] }).reasonCode).toBe(
      'CAPABILITY_NOT_ALLOWED'
    );
    expect(
      broker.authorize({ ...request, operation: 'filesystem', filePath: 'C:/other-workspace/secret.txt' }).reasonCode
    ).toBe('WORKSPACE_SCOPE_VIOLATION');
    expect(broker.authorize({ ...request, operation: 'network', networkHost: 'untrusted.example' }).reasonCode).toBe(
      'NETWORK_HOST_NOT_ALLOWED'
    );
    expect(
      broker.authorize({ ...request, operation: 'package', packageId: 'com.tomni.ide', packageSigned: false })
        .reasonCode
    ).toBe('PACKAGE_NOT_TRUSTED');
  });

  it('requires approval for a granted mutating capability instead of silently allowing it', () => {
    const decision = createBroker().authorize({ ...request, requestedCapabilities: ['workspace.write'] });

    expect(decision).toMatchObject({ decision: 'approval_required', reasonCode: 'MUTATION_REQUIRES_APPROVAL' });
  });

  it('denies unknown origins and final secret-shaped egress, then honors revocation', () => {
    const broker = createBroker();

    expect(broker.requestCapability(request, 'app://untrusted').reasonCode).toBe('ORIGIN_NOT_ALLOWED');
    expect(
      broker.inspectFinalEgress({ ...request, origin: 'app://hub', serializedPayload: 'api_key=should-not-leave' })
        .reasonCode
    ).toBe('FINAL_EGRESS_SECRET_DETECTED');
    broker.revoke('workspace.read');
    expect(broker.requestCapability(request, 'app://hub').reasonCode).toBe('CAPABILITY_NOT_ALLOWED');
  });
});
