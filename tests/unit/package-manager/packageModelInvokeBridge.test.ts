/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { PACKAGE_MODEL_INVOKE_NATIVE_CHANNELS } from '@/common/types/platform/electron';
import {
  registerTrustedPackageModelInvokeIpcBridge,
  type TrustedPackageModelInvokeIpcHost,
} from '@/process/extensions/package-manager/packageBridge';
import type { LocalModelInvocationBroker } from '@/process/resources/packageCapability/localModelInvocationBroker';

type TestEvent = {
  senderId: string;
  trusted: boolean;
};

describe('Package model invoke bridge (registerTrustedPackageModelInvokeIpcBridge)', () => {
  const defaultRequest = {
    version: 1 as const,
    packageId: 'com.tomni.ai-challenge',
    runtimeId: 'runtime-1',
    requestId: 'req-1',
    contract: 'ai-challenge.turn.v1' as const,
    prompt: 'Observation: enemy distance 5m.',
  };

  const setup = (overrides?: {
    isTrusted?: boolean;
    ownsRuntime?: boolean;
    packageListing?: unknown;
  }) => {
    const handlers = new Map<string, (event: TestEvent, payload: unknown) => Promise<unknown> | unknown>();
    const host: TrustedPackageModelInvokeIpcHost<TestEvent> = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => handlers.delete(channel),
    };

    let invalidationListener: ((event: { packageId: string; runtimeId: string; ownerId: string }) => void) | undefined;
    const registry = {
      ownsRuntime: vi.fn(() => overrides?.ownsRuntime ?? true),
      onInvalidated: vi.fn((listener: (event: { packageId: string; runtimeId: string; ownerId: string }) => void) => {
        invalidationListener = listener;
        return () => {
          invalidationListener = undefined;
        };
      }),
    };

    const service = {
      status: vi.fn(async (_id: string) => ({
        state: 'installed' as const,
        enabled: true,
        installedTrust: 'signed-first-party' as const,
        installedManifest: {
          id: 'com.tomni.ai-challenge',
          version: '1.0.0',
          publisherId: 'com.tomni',
        },
        ...(overrides?.packageListing as object),
      })),
    };

    const modelBroker: LocalModelInvocationBroker = {
      invoke: vi.fn(async (req) => ({
        ok: true as const,
        requestId: req.requestId,
        data: {
          schemaVersion: 1,
          contract: 'ai-challenge.turn.v1' as const,
          text: '{"action":"attack"}',
          elapsedMs: 25,
          model: 'qwen2.5:3b',
        },
        receipt: {
          receiptId: 'receipt-1',
          packageId: req.packageId,
          runtimeId: req.runtimeId,
          capability: 'model.invoke' as const,
          syscall: 'model.invoke' as const,
          status: 'completed' as const,
          recordedAt: new Date().toISOString(),
        },
      })),
      cancel: vi.fn(() => true),
      abortRuntime: vi.fn(),
      dispose: vi.fn(),
    };

    const dispose = registerTrustedPackageModelInvokeIpcBridge<TestEvent>({
      host,
      service,
      registry,
      modelBroker,
      verifySender: (event) => (overrides?.isTrusted !== undefined ? overrides.isTrusted : event.trusted),
      identifySender: (event) => event.senderId,
    });

    const invokeHandler = handlers.get(PACKAGE_MODEL_INVOKE_NATIVE_CHANNELS.invoke);
    const cancelHandler = handlers.get(PACKAGE_MODEL_INVOKE_NATIVE_CHANNELS.cancel);

    return {
      host,
      handlers,
      invokeHandler,
      cancelHandler,
      service,
      registry,
      modelBroker,
      dispose,
      triggerInvalidation: (event: { packageId: string; runtimeId: string; ownerId: string }) => {
        invalidationListener?.(event);
      },
    };
  };

  it('rejects untrusted sender with PACKAGE_CAPABILITY_SYSCALL_DENIED', async () => {
    const harness = setup({ isTrusted: false });
    const result = await harness.invokeHandler!({ senderId: 'renderer-1', trusted: false }, defaultRequest);
    expect(result).toEqual({
      ok: false,
      requestId: 'req-1',
      code: 'PACKAGE_CAPABILITY_SYSCALL_DENIED',
    });
    expect(harness.modelBroker.invoke).not.toHaveBeenCalled();
  });

  it('rejects unowned runtime with PACKAGE_CAPABILITY_SYSCALL_DENIED', async () => {
    const harness = setup({ ownsRuntime: false });
    const result = await harness.invokeHandler!({ senderId: 'renderer-1', trusted: true }, defaultRequest);
    expect(result).toEqual({
      ok: false,
      requestId: 'req-1',
      code: 'PACKAGE_CAPABILITY_SYSCALL_DENIED',
    });
    expect(harness.modelBroker.invoke).not.toHaveBeenCalled();
  });

  it('rejects malformed payload with PACKAGE_CAPABILITY_REQUEST_INVALID', async () => {
    const harness = setup();
    const result = await harness.invokeHandler!({ senderId: 'renderer-1', trusted: true }, { invalid: true });
    expect(result).toEqual({
      ok: false,
      requestId: '',
      code: 'PACKAGE_CAPABILITY_REQUEST_INVALID',
    });
    expect(harness.modelBroker.invoke).not.toHaveBeenCalled();
  });

  it('rejects inactive or unverified package status with PACKAGE_CAPABILITY_PACKAGE_INACTIVE', async () => {
    const harness = setup({
      packageListing: {
        state: 'installed',
        enabled: false,
      },
    });
    const result = await harness.invokeHandler!({ senderId: 'renderer-1', trusted: true }, defaultRequest);
    expect(result).toEqual({
      ok: false,
      requestId: 'req-1',
      code: 'PACKAGE_CAPABILITY_PACKAGE_INACTIVE',
    });
    expect(harness.modelBroker.invoke).not.toHaveBeenCalled();
  });

  it('forwards valid trusted invocation to modelBroker.invoke', async () => {
    const harness = setup();
    const result = await harness.invokeHandler!({ senderId: 'renderer-1', trusted: true }, defaultRequest);
    expect(result).toMatchObject({
      ok: true,
      requestId: 'req-1',
      data: {
        text: '{"action":"attack"}',
      },
    });
    expect(harness.modelBroker.invoke).toHaveBeenCalledWith(defaultRequest);
  });

  it('forwards cancellation to modelBroker.cancel', () => {
    const harness = setup();
    const result = harness.cancelHandler!(
      { senderId: 'renderer-1', trusted: true },
      {
        packageId: 'com.tomni.ai-challenge',
        runtimeId: 'runtime-1',
        requestId: 'req-1',
      }
    );
    expect(result).toBe(true);
    expect(harness.modelBroker.cancel).toHaveBeenCalledWith({
      packageId: 'com.tomni.ai-challenge',
      runtimeId: 'runtime-1',
      requestId: 'req-1',
    });
  });

  it('aborts model invocations when runtime is invalidated', () => {
    const harness = setup();
    harness.triggerInvalidation({
      packageId: 'com.tomni.ai-challenge',
      runtimeId: 'runtime-1',
      ownerId: 'renderer-1',
    });
    expect(harness.modelBroker.abortRuntime).toHaveBeenCalledWith('com.tomni.ai-challenge', 'runtime-1');
  });

  it('cleans up handlers and invalidation listeners on dispose', () => {
    const harness = setup();
    expect(harness.handlers.size).toBe(2);
    harness.dispose();
    expect(harness.handlers.size).toBe(0);
  });
});
