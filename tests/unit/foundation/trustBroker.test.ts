import { describe, expect, it } from 'vitest';

import { TrustBroker } from '../../../packages/desktop/src/process/foundation/trustBroker';

const createBroker = () =>
  new TrustBroker({
    allowedCapabilities: ['target.execute', 'cli.execute', 'secret.use', 'workspace.read', 'workspace.write'],
    allowedNetworkHosts: ['api.example.test'],
    trustedPackageIds: ['com.tomni.ide'],
    allowedOrigins: ['app://hub'],
  });

const request = {
  runId: 'run_trust_1',
  taskId: 'task_trust_1',
  actorId: 'user_trust_1',
  operation: 'cli' as const,
  targetId: 'tool.example',
  requestedCapabilities: ['workspace.read'],
  workspaceScope: 'C:/workspace',
  policyVersion: 'trust-v1',
  idempotencyKey: 'run_trust_1:task_trust_1:0',
  reason: 'Read the selected workspace file.',
};

describe('TrustBroker', () => {
  it('allows an in-policy preflight and binds structured decision identity', () => {
    const decision = createBroker().authorize(request);

    expect(decision).toMatchObject({
      decision: 'allow',
      reasonCode: 'TRUST_ALLOWED',
      runId: request.runId,
      taskId: request.taskId,
      actorId: request.actorId,
      policyVersion: request.policyVersion,
    });
  });

  it('fails closed for malformed, ungranted, out-of-scope, network, and package requests', () => {
    const broker = createBroker();

    expect(broker.authorize({ ...request, reason: '' }).reasonCode).toBe('INVALID_TRUST_REQUEST');
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

  it('binds egress to a live origin-specific grant and rejects revocation and secret-shaped content', async () => {
    const broker = createBroker();

    await expect(broker.requestCapability(request, 'app://untrusted')).resolves.toMatchObject({
      decision: 'deny',
      reasonCode: 'ORIGIN_NOT_ALLOWED',
    });

    const grant = await broker.requestCapability(request, 'app://hub');
    expect(grant).toMatchObject({ decision: 'allow', origin: 'app://hub', grantId: expect.any(String) });

    await expect(
      broker.inspectFinalEgress({ ...request, origin: 'app://hub', serializedPayload: 'safe payload' })
    ).resolves.toMatchObject({ decision: 'deny', reasonCode: 'EGRESS_GRANT_REQUIRED' });
    await expect(
      broker.inspectFinalEgress({
        ...request,
        origin: 'app://hub',
        grantId: grant.grantId,
        serializedPayload: 'api_key=should-not-leave',
      })
    ).resolves.toMatchObject({ decision: 'deny', reasonCode: 'FINAL_EGRESS_SECRET_DETECTED' });

    await broker.revoke(grant.grantId!, 'User withdrew consent.');
    await expect(
      broker.inspectFinalEgress({
        ...request,
        origin: 'app://hub',
        grantId: grant.grantId,
        serializedPayload: 'safe payload',
      })
    ).resolves.toMatchObject({ decision: 'deny', reasonCode: 'EGRESS_GRANT_INVALID' });
  });

  it('returns an opaque secret lease only for the exact live secret-use grant and destination', async () => {
    const broker = createBroker();
    const secretRequest = {
      ...request,
      operation: 'provider' as const,
      targetId: 'provider.example',
      requestedCapabilities: ['secret.use'],
      reason: 'Use the provider credential for this request.',
    };
    const grant = await broker.requestCapability(secretRequest, 'app://hub');
    const lease = await broker.resolveSecret({
      runId: secretRequest.runId,
      taskId: secretRequest.taskId,
      actorId: secretRequest.actorId,
      targetId: secretRequest.targetId,
      origin: 'app://hub',
      secretHandle: 'secretref_provider_primary',
      purpose: secretRequest.reason,
      policyVersion: secretRequest.policyVersion,
      idempotencyKey: secretRequest.idempotencyKey,
      grantId: grant.grantId!,
      destinationHost: 'api.example.test',
    });

    expect(lease).toEqual({
      leaseId: expect.any(String),
      secretHandle: 'secretref_provider_primary',
      runId: secretRequest.runId,
      taskId: secretRequest.taskId,
      targetId: secretRequest.targetId,
      expiresAt: expect.any(Number),
      policyVersion: 'trust-v1',
    });
    expect(lease).not.toHaveProperty('value');
  });

  it('accepts dynamic destination evidence only for the native provider-execution origin and exact provider target', async () => {
    const evidence = new Set(['user_trust_1:provider:provider-1:byok.example.test']);
    const broker = new TrustBroker(
      {
        allowedCapabilities: ['provider.execute', 'secret.use'],
        allowedNetworkHosts: [],
        allowedOrigins: ['tomny://provider-execution', 'app://hub'],
      },
      {
        isProviderDestinationAllowed: ({ actorId, targetId, hostname }) =>
          evidence.has(`${actorId}:${targetId}:${hostname}`),
      }
    );
    const providerRequest = {
      ...request,
      operation: 'provider' as const,
      targetId: 'provider:provider-1',
      requestedCapabilities: ['provider.execute', 'secret.use'],
      reason: 'Execute an explicitly saved provider.',
    };
    const grant = await broker.requestCapability(providerRequest, 'tomny://provider-execution');

    await expect(
      broker.resolveSecret({
        runId: providerRequest.runId,
        taskId: providerRequest.taskId,
        actorId: providerRequest.actorId,
        targetId: providerRequest.targetId,
        origin: 'tomny://provider-execution',
        secretHandle: 'secretref_provider_1',
        purpose: providerRequest.reason,
        policyVersion: providerRequest.policyVersion,
        idempotencyKey: providerRequest.idempotencyKey,
        grantId: grant.grantId!,
        destinationHost: 'byok.example.test',
      })
    ).resolves.toMatchObject({ secretHandle: 'secretref_provider_1' });

    const nonNativeGrant = await broker.requestCapability(providerRequest, 'app://hub');
    await expect(
      broker.resolveSecret({
        runId: providerRequest.runId,
        taskId: providerRequest.taskId,
        actorId: providerRequest.actorId,
        targetId: providerRequest.targetId,
        origin: 'app://hub',
        secretHandle: 'secretref_provider_1',
        purpose: providerRequest.reason,
        policyVersion: providerRequest.policyVersion,
        idempotencyKey: providerRequest.idempotencyKey,
        grantId: nonNativeGrant.grantId!,
        destinationHost: 'byok.example.test',
      })
    ).rejects.toThrow('SECRET_DESTINATION_NOT_ALLOWED');
  });

  it('rejects expired grants deterministically', async () => {
    let now = 100;
    const broker = new TrustBroker(
      {
        allowedCapabilities: ['workspace.read'],
        allowedOrigins: ['app://hub'],
        capabilityGrantTtlMs: 10,
      },
      { now: () => now }
    );
    const grant = await broker.requestCapability(request, 'app://hub');
    now = 110;

    await expect(
      broker.inspectFinalEgress({
        ...request,
        origin: 'app://hub',
        grantId: grant.grantId,
        serializedPayload: 'safe payload',
      })
    ).resolves.toMatchObject({ decision: 'deny', reasonCode: 'EGRESS_GRANT_INVALID' });
  });
});
