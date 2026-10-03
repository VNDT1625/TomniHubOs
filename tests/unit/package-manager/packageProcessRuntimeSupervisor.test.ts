import { describe, expect, it, vi } from 'vitest';
import {
  createPackageProcessRuntimeSupervisor,
  type PackageProcessRuntimeBinding,
} from '@/process/resources/packageProcessRuntime/packageProcessRuntimeSupervisor';
import {
  createPackageProcessRuntimeDriverEndpoint,
  PACKAGE_PROCESS_RUNTIME_DRIVER_PROTOCOL,
} from '@/process/resources/packageProcessRuntime/packageProcessRuntimeDriver';

const binding: PackageProcessRuntimeBinding = {
  surface: {
    packageId: 'com.tomni.ide',
    packageVersion: '1.0.0',
    publisherId: 'com.tomni',
  },
  runtimeId: 'runtime-ide-1',
  entrypointId: 'ide-helper',
  artifactIntegrity: `sha256-${'a'.repeat(64)}`,
};

const createSupervisor = (overrides: Partial<Parameters<typeof createPackageProcessRuntimeSupervisor>[0]> = {}) => {
  const terminate = vi.fn(async () => undefined);
  const invoke = vi.fn(async () => ({ ok: true }));
  const supervisor = createPackageProcessRuntimeSupervisor({
    isBindingActive: async () => true,
    hasCapabilityGrant: () => true,
    createEndpoint: async () => ({ invoke, terminate }),
    validateInput: (_binding, _operation, input) => input,
    validateOutput: (_binding, _operation, output) => output,
    recordEvidence: async () => undefined,
    createInvocationId: () => 'invocation-1',
    ...overrides,
  });
  return { supervisor, invoke, terminate };
};

describe('PackageProcessRuntimeSupervisor', () => {
  it('runs a bounded validated invocation only for an active granted binding', async () => {
    const { supervisor, invoke, terminate } = createSupervisor();

    await expect(
      supervisor.invoke({
        binding,
        operationId: 'compile',
        input: { file: 'main.ts' },
        deadlineAt: Date.now() + 2_000,
      })
    ).resolves.toEqual({ ok: true });

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ invocationId: 'invocation-1', operationId: 'compile', input: { file: 'main.ts' } })
    );
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('fails closed before a helper starts for inactive bindings and missing grants', async () => {
    const inactive = createSupervisor({ isBindingActive: async () => false });
    await expect(
      inactive.supervisor.invoke({ binding, operationId: 'compile', input: {}, deadlineAt: Date.now() + 2_000 })
    ).rejects.toThrow('PACKAGE_PROCESS_RUNTIME_BINDING_INACTIVE');
    expect(inactive.invoke).not.toHaveBeenCalled();

    const ungranted = createSupervisor({ hasCapabilityGrant: () => false });
    await expect(
      ungranted.supervisor.invoke({ binding, operationId: 'compile', input: {}, deadlineAt: Date.now() + 2_000 })
    ).rejects.toThrow('PACKAGE_PROCESS_RUNTIME_GRANT_REQUIRED');
    expect(ungranted.invoke).not.toHaveBeenCalled();
  });

  it('aborts and terminates an active helper when its exact runtime is invalidated', async () => {
    let release: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    let invocationSignal: AbortSignal | undefined;
    const endpointTerminate = vi.fn(async () => undefined);
    const { supervisor } = createSupervisor({
      createEndpoint: async () => ({
        invoke: async (request) => {
          invocationSignal = request.signal;
          await started;
          return { ok: true };
        },
        terminate: endpointTerminate,
      }),
    });
    const pending = supervisor.invoke({ binding, operationId: 'compile', input: {}, deadlineAt: Date.now() + 2_000 });
    await vi.waitFor(() => expect(invocationSignal).toBeDefined());

    await supervisor.invalidate(binding.surface, binding.runtimeId);
    release?.();

    await expect(pending).rejects.toThrow('PACKAGE_PROCESS_RUNTIME_REVOKED');
    expect(invocationSignal?.aborted).toBe(true);
    expect(endpointTerminate).toHaveBeenCalledTimes(1);
  });

  it('records redacted lifecycle evidence and makes a deadline terminal without waiting for a non-cooperative helper', async () => {
    let invocationSignal: AbortSignal | undefined;
    const evidence: unknown[] = [];
    const endpointTerminate = vi.fn(async () => undefined);
    const { supervisor } = createSupervisor({
      createEndpoint: async () => ({
        invoke: async (request) => {
          invocationSignal = request.signal;
          return new Promise(() => undefined);
        },
        terminate: endpointTerminate,
      }),
      recordEvidence: async (event) => evidence.push(event),
    });

    await expect(
      supervisor.invoke({
        binding,
        operationId: 'compile',
        input: { secret: 'must-not-appear' },
        deadlineAt: Date.now() + 15,
      })
    ).rejects.toThrow('PACKAGE_PROCESS_RUNTIME_DEADLINE_EXCEEDED');

    expect(invocationSignal?.aborted).toBe(true);
    expect(endpointTerminate).toHaveBeenCalledTimes(1);
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'admitted', inputDigest: expect.stringMatching(/^sha256-/) }),
        expect.objectContaining({ phase: 'started' }),
        expect.objectContaining({ phase: 'cancelled', reason: 'PACKAGE_PROCESS_RUNTIME_DEADLINE_EXCEEDED' }),
      ])
    );
    expect(JSON.stringify(evidence)).not.toContain('must-not-appear');
  });

  it('binds a package-specific driver to the versioned protocol without granting it executable selection', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const close = vi.fn(async () => undefined);
    const { supervisor } = createSupervisor({
      createEndpoint: async (runtimeBinding, signal) =>
        createPackageProcessRuntimeDriverEndpoint({
          binding: runtimeBinding,
          signal,
          driver: {
            protocolVersion: PACKAGE_PROCESS_RUNTIME_DRIVER_PROTOCOL,
            open: async () => ({ execute, close }),
          },
        }),
    });

    await expect(
      supervisor.invoke({ binding, operationId: 'compile', input: { file: 'main.ts' }, deadlineAt: Date.now() + 2_000 })
    ).resolves.toEqual({ ok: true });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        protocolVersion: PACKAGE_PROCESS_RUNTIME_DRIVER_PROTOCOL,
        binding,
        invocation: expect.objectContaining({ operationId: 'compile', deadlineAt: expect.any(Number) }),
      })
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized validated payloads without opening the helper', async () => {
    const { supervisor, invoke } = createSupervisor({
      validateInput: () => ({ data: 'x'.repeat(64 * 1024) }),
    });

    await expect(
      supervisor.invoke({ binding, operationId: 'compile', input: {}, deadlineAt: Date.now() + 2_000 })
    ).rejects.toThrow('PACKAGE_PROCESS_RUNTIME_PAYLOAD_TOO_LARGE');
    expect(invoke).not.toHaveBeenCalled();
  });
});
