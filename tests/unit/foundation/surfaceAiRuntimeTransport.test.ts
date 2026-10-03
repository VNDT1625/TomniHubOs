import { describe, expect, it } from 'vitest';

import type { PackageIdentity } from '@/common/packages';
import {
  MAX_SURFACE_AI_TRANSPORT_ENVELOPE_BYTES,
  createSurfaceAiRuntimeTransportRegistry,
  type SurfaceAiRuntimeTransportBinding,
  type SurfaceAiRuntimeTransportEndpoint,
  type SurfaceAiRuntimeTransportError,
} from '@/process/resources/packageCapability/surfaceAiRuntimeTransport';

class TestEndpoint {
  public readonly sent: unknown[] = [];
  public closed = false;
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly closeListeners = new Set<() => void>();

  public readonly endpoint: SurfaceAiRuntimeTransportEndpoint = {
    postMessage: (message) => this.sent.push(message),
    close: () => {
      this.closed = true;
      for (const listener of this.closeListeners) listener();
    },
    onMessage: (listener) => {
      this.messageListeners.add(listener);
      return () => this.messageListeners.delete(listener);
    },
    onClose: (listener) => {
      this.closeListeners.add(listener);
      return () => this.closeListeners.delete(listener);
    },
  };

  public emit(message: unknown): void {
    for (const listener of this.messageListeners) listener(message);
  }
}

const surface: PackageIdentity = {
  packageId: 'com.tomni.ide',
  packageVersion: '1.0.0',
  publisherId: 'com.tomni',
};

const binding = (): SurfaceAiRuntimeTransportBinding => ({
  surface,
  ownerId: 'electron:1',
  runtimeId: 'runtime-1',
  moduleId: 'surface.main',
  artifactIntegrity: `sha256-${'a'.repeat(64)}`,
});

const ready = (value: SurfaceAiRuntimeTransportBinding = binding()) => ({
  type: 'ready',
  schemaVersion: 1,
  sequence: 0,
  binding: value,
});

const invocation = (
  overrides: Partial<Parameters<ReturnType<typeof createSurfaceAiRuntimeTransportRegistry>['invoke']>[0]> = {}
) => ({
  binding: binding(),
  invocationId: 'invocation-1',
  runId: 'run-1',
  operationId: 'workspace.write-files',
  operationSchemaVersion: 1 as const,
  operationLeaseId: 'lease-opaque-1',
  input: { schemaVersion: 1 as const, instruction: 'Create the requested project files.' },
  timeoutMs: 5_000,
  ...overrides,
});

describe('SurfaceAiRuntimeTransportRegistry', () => {
  it('accepts an exact ready handshake then invokes and resolves only the matching run', async () => {
    const registry = createSurfaceAiRuntimeTransportRegistry();
    const endpoint = new TestEndpoint();
    const progress: string[] = [];
    registry.register(binding(), endpoint.endpoint);
    endpoint.emit(ready());

    const pending = registry.invoke(invocation({ onProgress: (event) => progress.push(event.phase) }));
    expect(endpoint.sent).toEqual([
      expect.objectContaining({
        type: 'invoke',
        sequence: 1,
        operationLeaseId: 'lease-opaque-1',
        operationId: 'workspace.write-files',
        input: { schemaVersion: 1, instruction: 'Create the requested project files.' },
      }),
    ]);
    endpoint.emit({
      type: 'progress',
      schemaVersion: 1,
      sequence: 1,
      invocationId: 'invocation-1',
      runId: 'run-1',
      operationId: 'workspace.write-files',
      operationSchemaVersion: 1,
      phase: 'writing',
      completed: 1,
      total: 2,
    });
    endpoint.emit({
      type: 'result',
      schemaVersion: 1,
      sequence: 2,
      invocationId: 'invocation-1',
      runId: 'run-1',
      operationId: 'workspace.write-files',
      operationSchemaVersion: 1,
      artifactRefs: ['artifact:project'],
      evidenceRefs: ['evidence:write'],
    });

    await expect(pending).resolves.toEqual({
      invocationId: 'invocation-1',
      runId: 'run-1',
      artifactRefs: ['artifact:project'],
      evidenceRefs: ['evidence:write'],
    });
    expect(progress).toEqual(['writing']);
  });

  it('fails closed and closes when the package spoofs any immutable binding field', () => {
    const registry = createSurfaceAiRuntimeTransportRegistry();
    const endpoint = new TestEndpoint();
    registry.register(binding(), endpoint.endpoint);
    endpoint.emit(ready({ ...binding(), runtimeId: 'runtime-other' }));

    expect(endpoint.closed).toBe(true);
    expect(registry.isActive(binding())).toBe(false);
  });

  it('closes malformed and oversized package messages before they can reach an invocation', () => {
    const malformedRegistry = createSurfaceAiRuntimeTransportRegistry();
    const malformedEndpoint = new TestEndpoint();
    malformedRegistry.register(binding(), malformedEndpoint.endpoint);
    malformedEndpoint.emit({ type: 'ready', schemaVersion: 1, sequence: 0, binding: { nope: true } });
    expect(malformedEndpoint.closed).toBe(true);

    const oversizedRegistry = createSurfaceAiRuntimeTransportRegistry();
    const oversizedEndpoint = new TestEndpoint();
    oversizedRegistry.register(binding(), oversizedEndpoint.endpoint);
    oversizedEndpoint.emit(ready());
    oversizedEndpoint.emit({
      type: 'progress',
      schemaVersion: 1,
      sequence: 1,
      phase: 'x'.repeat(MAX_SURFACE_AI_TRANSPORT_ENVELOPE_BYTES),
    });
    expect(oversizedEndpoint.closed).toBe(true);
  });

  it('rejects an empty or oversized Main operation instruction before package delivery', async () => {
    const registry = createSurfaceAiRuntimeTransportRegistry();
    const endpoint = new TestEndpoint();
    registry.register(binding(), endpoint.endpoint);
    endpoint.emit(ready());

    await expect(
      registry.invoke(invocation({ input: { schemaVersion: 1, instruction: '   ' } }))
    ).rejects.toMatchObject({
      code: 'SURFACE_AI_TRANSPORT_INVOCATION_INVALID',
    });
    await expect(
      registry.invoke(invocation({ input: { schemaVersion: 1, instruction: 'x'.repeat(12 * 1024 + 1) } }))
    ).rejects.toMatchObject({ code: 'SURFACE_AI_TRANSPORT_INVOCATION_INVALID' });
    expect(endpoint.sent).toEqual([]);
  });

  it('rejects a replayed sequence and cancels the active invocation', async () => {
    const registry = createSurfaceAiRuntimeTransportRegistry();
    const endpoint = new TestEndpoint();
    registry.register(binding(), endpoint.endpoint);
    endpoint.emit(ready());
    const pending = registry.invoke(invocation());
    endpoint.emit({
      type: 'progress',
      schemaVersion: 1,
      sequence: 1,
      invocationId: 'invocation-1',
      runId: 'run-1',
      operationId: 'workspace.write-files',
      operationSchemaVersion: 1,
      phase: 'writing',
      completed: 1,
      total: 2,
    });
    endpoint.emit({
      type: 'progress',
      schemaVersion: 1,
      sequence: 1,
      invocationId: 'invocation-1',
      runId: 'run-1',
      operationId: 'workspace.write-files',
      operationSchemaVersion: 1,
      phase: 'writing',
      completed: 1,
      total: 2,
    });

    await expect(pending).rejects.toMatchObject<Partial<SurfaceAiRuntimeTransportError>>({
      code: 'SURFACE_AI_TRANSPORT_SEQUENCE_INVALID',
    });
    expect(endpoint.closed).toBe(true);
  });

  it('sends cancellation and closes when the exact runtime is invalidated', async () => {
    const registry = createSurfaceAiRuntimeTransportRegistry();
    const endpoint = new TestEndpoint();
    registry.register(binding(), endpoint.endpoint);
    endpoint.emit(ready());
    const pending = registry.invoke(invocation());
    registry.invalidate({ ownerId: 'electron:1', runtimeId: 'runtime-1' });

    await expect(pending).rejects.toMatchObject<Partial<SurfaceAiRuntimeTransportError>>({
      code: 'SURFACE_AI_TRANSPORT_INVALIDATED',
    });
    expect(endpoint.sent).toContainEqual(expect.objectContaining({ type: 'cancel', sequence: 2 }));
    expect(endpoint.closed).toBe(true);
  });
});
