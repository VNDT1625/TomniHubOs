import { describe, expect, it, vi } from 'vitest';

import { CAPABILITY_DERIVATION_OUTPUT_SCHEMA } from '@/process/resources/packageCapability/capabilityDerivationContract';
import {
  accountModelSelectionReceipt,
  createAccountSelectedLocalSurfaceAiTargetResolver,
  createAccountSelectedGoalCapabilityExecutor,
  createGovernedGoalCapabilityDerivationService,
  GovernedGoalCapabilityDerivationError,
} from '@/process/resources/packageCapability/goalCapability/governedGoalCapabilityDerivationService';
import { FoundationTrustRuntime, RunKernel } from '@/process/foundation/runKernel';

const goal = 'Create a local-first notes application.';
const input = {
  requestId: 'request-1',
  goal,
  requestedAt: '2026-08-20T10:00:00.000Z',
  accountId: 'account-1',
};
const target = { targetId: 'target-local-1', modelId: 'model-local-1', selectionReceiptId: 'selection-1' } as const;
const validOutput = {
  schema: CAPABILITY_DERIVATION_OUTPUT_SCHEMA,
  requirements: [
    { capability: 'workspace.code.edit', dataLocation: 'local-only', requireUi: true, requireOffline: true },
  ],
};

const trustDependencies = (actorId: () => string = () => 'account-1') => {
  const trustRuntime = new FoundationTrustRuntime({
    actorId,
    policy: {
      allowedCapabilities: ['target.execute'],
      allowedNetworkHosts: [],
      trustedPackageIds: [],
      allowedOrigins: ['tomny://hub-capability-derivation'],
      requireApprovalForMutation: true,
      capabilityGrantTtlMs: 5 * 60 * 1000,
      policyVersion: 'foundation-v1',
    },
  });
  return { trustRuntime, kernel: trustRuntime.createRunKernel() };
};

const fixture = (overrides: Partial<Parameters<typeof createGovernedGoalCapabilityDerivationService>[0]> = {}) => {
  const resolveTarget = vi.fn(async () => target);
  const execute = vi.fn(async () => ({
    targetId: target.targetId,
    modelId: target.modelId,
    executionReceiptId: 'execution-1',
    text: JSON.stringify(validOutput),
  }));
  return {
    resolveTarget,
    execute,
    service: createGovernedGoalCapabilityDerivationService({
      resolveTarget,
      execute,
      now: () => Date.UTC(2026, 7, 20, 10, 0, 0),
      ...overrides,
    }),
  };
};

describe('GovernedGoalCapabilityDerivationService', () => {
  it('resolves only the still-selected local model for a pinned C4 action', async () => {
    const selection = {
      schemaVersion: 1 as const,
      accountId: 'account-1',
      targetId: 'target-local-1',
      modelKey: 'model-local-1',
      updatedAt: '2026-08-20T10:00:00.000Z',
    };
    const resolver = createAccountSelectedLocalSurfaceAiTargetResolver({
      accountSession: { requireOnlineSession: () => ({ accountId: 'account-1' }) } as never,
      selectionVault: { load: vi.fn(async () => selection) },
      runtime: {
        listTargets: vi.fn(async () => [
          { id: 'target-local-1', kind: 'local' as const, available: true },
          { id: 'target-remote-1', kind: 'remote' as const, available: true },
        ]),
        listModels: vi.fn(async () => [{ key: 'model-local-1' }]),
        resolveNetworkHost: vi.fn(async () => '127.0.0.1'),
        executeToCompletion: vi.fn(),
      },
      workspace: () => 'C:\\tomni-surface-action',
    });

    await expect(
      resolver({ accountId: 'account-1', expectedSelectionReceipt: accountModelSelectionReceipt(selection) })
    ).resolves.toEqual({
      targetId: 'target-local-1',
      kind: 'local',
      modelKey: 'model-local-1',
      networkHost: '127.0.0.1',
    });
    await expect(
      resolver({ accountId: 'account-1', expectedSelectionReceipt: 'selection-changed' })
    ).resolves.toBeUndefined();
  });

  it('pins exactly one Main-selected target with no fallback and returns no raw goal', async () => {
    const { service, resolveTarget, execute } = fixture();

    const result = await service.derive(input);

    expect(resolveTarget).toHaveBeenCalledTimes(1);
    expect(resolveTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        purpose: 'capability-derivation',
        maxOutputBytes: 16 * 1024,
      })
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        target,
        purpose: 'capability-derivation',
        maxOutputBytes: 16 * 1024,
        signal: expect.any(AbortSignal),
      })
    );
    expect(result).toEqual({
      goalDigest: 'sha256-e46b744d92bf40220bc9c4e61e2b3f1eacc74629ed27e4f6be465541dce16410',
      requirements: validOutput.requirements,
      targetId: 'target-local-1',
      selectionReceiptId: 'selection-1',
      executionReceiptId: 'execution-1',
    });
    expect(JSON.stringify(result)).not.toContain(goal);
  });

  it('uses a sterile fixed prompt that contains neither account context nor model-target metadata', async () => {
    const { service, execute } = fixture();

    await service.derive(input);

    const invocation = execute.mock.calls[0]?.[0];
    expect(invocation?.prompt).toContain(goal);
    expect(invocation?.prompt).not.toContain('account-1');
    expect(invocation?.prompt).not.toContain('target-local-1');
    expect(invocation?.prompt).not.toContain('model-local-1');
    expect(invocation?.prompt).not.toContain('history');
    expect(invocation?.prompt).not.toContain('profile');
    expect(invocation?.prompt).not.toContain('secret');
    expect(invocation?.prompt).not.toContain('package');
    expect(invocation?.prompt).not.toContain('candidate');
  });

  it('runs only the encrypted account-selected model through a pinned sterile Foundation path', async () => {
    const selection = {
      schemaVersion: 1 as const,
      accountId: 'account-1',
      targetId: 'target-local-1',
      modelKey: 'model-local-1',
      updatedAt: '2026-08-20T10:00:00.000Z',
    };
    const runtime = {
      listTargets: vi.fn(async () => [
        {
          id: selection.targetId,
          kind: 'local' as const,
          available: true,
          defaultModelKey: selection.modelKey,
        },
        { id: 'target-other', kind: 'remote' as const, available: true, defaultModelKey: 'other' },
      ]),
      listModels: vi.fn(async () => [
        { key: selection.modelKey, modelId: 'local-model', label: 'Local', isDefault: true },
      ]),
      executeToCompletion: vi.fn(async () => ({ text: JSON.stringify(validOutput), evidenceRefs: ['local-evidence'] })),
    };
    const sharedTrust = trustDependencies();
    const executor = createAccountSelectedGoalCapabilityExecutor({
      accountSession: { requireOnlineSession: () => ({ accountId: 'account-1' }) } as never,
      selectionVault: { load: vi.fn(async () => selection) },
      runtime,
      ...sharedTrust,
      workspace: () => 'C:\\tomni-goal-derivation',
      createRunId: () => 'goal-run-1',
      now: () => Date.UTC(2026, 7, 20, 10, 0, 0),
    });
    const service = createGovernedGoalCapabilityDerivationService({
      ...executor,
      now: () => Date.UTC(2026, 7, 20, 10, 0, 0),
    });

    const result = await service.derive(input);

    expect(result.targetId).toBe(selection.targetId);
    expect(sharedTrust.kernel.securityAdapter.trustBroker).toBe(sharedTrust.trustRuntime.trustBroker);
    expect(runtime.listModels).toHaveBeenCalledWith(selection.targetId, 'C:\\tomni-goal-derivation');
    expect(runtime.executeToCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: selection.targetId,
        modelKey: selection.modelKey,
        permissionMode: 'read-only',
        contextIdentity: expect.objectContaining({ sterile: true, surface: 'hub-capability-derivation' }),
      })
    );
    const execution = runtime.executeToCompletion.mock.calls[0]?.[0];
    expect(execution?.prompt).toContain(goal);
    expect(execution?.prompt).not.toContain('account-1');
    expect(execution?.contextIdentity?.personalId).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(goal);
  });

  it('rechecks selection and selected model immediately before opening the Foundation Run', async () => {
    const selection = {
      schemaVersion: 1 as const,
      accountId: 'account-1',
      targetId: 'target-local-1',
      modelKey: 'model-local-1',
      updatedAt: '2026-08-20T10:00:00.000Z',
    };
    const selectionVault = {
      load: vi
        .fn()
        .mockResolvedValueOnce(selection)
        .mockResolvedValueOnce(selection)
        .mockResolvedValueOnce({ ...selection, modelKey: 'model-changed', updatedAt: '2026-08-20T10:01:00.000Z' }),
    };
    const runtime = {
      listTargets: vi.fn(async () => [{ id: selection.targetId, kind: 'local' as const, available: true }]),
      listModels: vi.fn(async () => [{ key: selection.modelKey }]),
      executeToCompletion: vi.fn(),
    };
    const executor = createAccountSelectedGoalCapabilityExecutor({
      accountSession: { requireOnlineSession: () => ({ accountId: 'account-1' }) } as never,
      selectionVault,
      runtime,
      ...trustDependencies(),
      workspace: () => 'C:\\tomni-goal-derivation',
    });
    const service = createGovernedGoalCapabilityDerivationService(executor);

    await expect(service.derive(input)).rejects.toEqual(
      expect.objectContaining({ code: 'GOAL_CAPABILITY_EXECUTOR_FAILED' })
    );
    expect(runtime.executeToCompletion).not.toHaveBeenCalled();
    expect(runtime.listModels).toHaveBeenCalledTimes(2);
    expect(selectionVault.load).toHaveBeenCalledTimes(3);
  });

  it('does not open a Foundation Run when the selected model disappears after resolution', async () => {
    const selection = {
      schemaVersion: 1 as const,
      accountId: 'account-1',
      targetId: 'target-local-1',
      modelKey: 'model-local-1',
      updatedAt: '2026-08-20T10:00:00.000Z',
    };
    const runtime = {
      listTargets: vi.fn(async () => [{ id: selection.targetId, kind: 'local' as const, available: true }]),
      listModels: vi
        .fn()
        .mockResolvedValueOnce([{ key: selection.modelKey }])
        .mockResolvedValueOnce([]),
      executeToCompletion: vi.fn(),
    };
    const executor = createAccountSelectedGoalCapabilityExecutor({
      accountSession: { requireOnlineSession: () => ({ accountId: 'account-1' }) } as never,
      selectionVault: { load: vi.fn(async () => selection) },
      runtime,
      ...trustDependencies(),
      workspace: () => 'C:\\tomni-goal-derivation',
    });
    const service = createGovernedGoalCapabilityDerivationService(executor);

    await expect(service.derive(input)).rejects.toEqual(
      expect.objectContaining({ code: 'GOAL_CAPABILITY_EXECUTOR_FAILED' })
    );
    expect(runtime.executeToCompletion).not.toHaveBeenCalled();
    expect(runtime.listModels).toHaveBeenCalledTimes(2);
  });

  it.each(['revoked runtime', 'kernel/runtime mismatch'] as const)(
    'denies %s before Core target execution',
    async (mode) => {
      const selection = {
        schemaVersion: 1 as const,
        accountId: 'account-1',
        targetId: 'target-local-1',
        modelKey: 'model-local-1',
        updatedAt: '2026-08-20T10:00:00.000Z',
      };
      const runtime = {
        listTargets: vi.fn(async () => [{ id: selection.targetId, kind: 'local' as const, available: true }]),
        listModels: vi.fn(async () => [{ key: selection.modelKey }]),
        executeToCompletion: vi.fn(),
      };
      const sharedTrust = trustDependencies();
      if (mode === 'revoked runtime') sharedTrust.trustRuntime.revoke('test-revocation');
      const executor = createAccountSelectedGoalCapabilityExecutor({
        accountSession: { requireOnlineSession: () => ({ accountId: 'account-1' }) } as never,
        selectionVault: { load: vi.fn(async () => selection) },
        runtime,
        trustRuntime: sharedTrust.trustRuntime,
        kernel: mode === 'kernel/runtime mismatch' ? new RunKernel() : sharedTrust.kernel,
        workspace: () => 'C:\\tomni-goal-derivation',
      });

      await expect(createGovernedGoalCapabilityDerivationService(executor).derive(input)).rejects.toEqual(
        expect.objectContaining({ code: 'GOAL_CAPABILITY_EXECUTOR_FAILED' })
      );
      expect(runtime.executeToCompletion).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['unavailable target', { resolveTarget: async () => undefined }, 'GOAL_CAPABILITY_TARGET_UNAVAILABLE'],
    [
      'target drift',
      {
        execute: async () => ({
          targetId: 'target-cloud-1',
          modelId: target.modelId,
          executionReceiptId: 'execution-1',
          text: JSON.stringify(validOutput),
        }),
      },
      'GOAL_CAPABILITY_TARGET_DRIFT',
    ],
    [
      'executor failure',
      { execute: async () => Promise.reject(new Error('provider payload')) },
      'GOAL_CAPABILITY_EXECUTOR_FAILED',
    ],
  ])('fails closed for %s', async (_label, overrides, code) => {
    const { service } = fixture(overrides);
    await expect(service.derive(input)).rejects.toEqual(expect.objectContaining({ code }));
  });

  it('rejects invalid JSON and output that echoes the user goal', async () => {
    const invalid = fixture({
      execute: async () => ({
        targetId: target.targetId,
        modelId: target.modelId,
        executionReceiptId: 'execution-1',
        text: '```json {} ```',
      }),
    });
    await expect(invalid.service.derive(input)).rejects.toEqual(
      expect.objectContaining({ code: 'GOAL_CAPABILITY_OUTPUT_INVALID' })
    );

    const echo = fixture({
      execute: async () => ({
        targetId: target.targetId,
        modelId: target.modelId,
        executionReceiptId: 'execution-1',
        text: JSON.stringify({
          ...validOutput,
          requirements: [{ ...validOutput.requirements[0], capability: `Do ${goal}` }],
        }),
      }),
    });
    await expect(echo.service.derive(input)).rejects.toEqual(
      expect.objectContaining({ code: 'GOAL_CAPABILITY_OUTPUT_ECHOED' })
    );
  });

  it('rejects renderer-like target, model, or context injection before any dependency is called', async () => {
    const { service, resolveTarget, execute } = fixture();
    const attackerInput = { ...input, targetId: 'target-cloud-1', modelId: 'paid-model', profile: { taste: 'x' } };

    await expect(service.derive(attackerInput)).rejects.toBeInstanceOf(GovernedGoalCapabilityDerivationError);
    await expect(service.derive(attackerInput)).rejects.toEqual(
      expect.objectContaining({ code: 'GOAL_CAPABILITY_REQUEST_INVALID' })
    );
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('has no install, purchase, or surface-execution callbacks to invoke', async () => {
    const install = vi.fn();
    const purchase = vi.fn();
    const executeSurface = vi.fn();
    const { service } = fixture({
      ...({ install, purchase, executeSurface } as never),
    });

    await service.derive(input);

    expect(install).not.toHaveBeenCalled();
    expect(purchase).not.toHaveBeenCalled();
    expect(executeSurface).not.toHaveBeenCalled();
  });
});
