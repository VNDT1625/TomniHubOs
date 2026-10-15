/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { createLocalModelInvocationBroker } from '@/process/resources/packageCapability/localModelInvocationBroker';

describe('LocalModelInvocationBroker (AI Challenge)', () => {
  const defaultRequest = {
    version: 1 as const,
    packageId: 'com.tomni.ai-challenge',
    runtimeId: 'runtime-1',
    requestId: 'req-1',
    contract: 'ai-challenge.turn.v1' as const,
    prompt: 'Observation: enemy distance 5m. Legal actions: move_forward, attack, retreat.',
  };

  it('rejects remote or non-loopback endpoints before calling network', async () => {
    const fetchMock = vi.fn();
    const broker = createLocalModelInvocationBroker({
      isPackageActive: () => true,
      endpoint: 'https://api.openai.com/v1',
      fetchImpl: fetchMock,
    });

    const result = await broker.invoke(defaultRequest);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PACKAGE_CAPABILITY_MODEL_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects loopback endpoints containing credentials before calling network', async () => {
    const fetchMock = vi.fn();
    const broker = createLocalModelInvocationBroker({
      isPackageActive: () => true,
      endpoint: 'http://user:secret@127.0.0.1:11434/v1',
      fetchImpl: fetchMock,
    });

    const result = await broker.invoke(defaultRequest);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PACKAGE_CAPABILITY_MODEL_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects packages other than com.tomni.ai-challenge', async () => {
    const fetchMock = vi.fn();
    const broker = createLocalModelInvocationBroker({
      isPackageActive: () => true,
      fetchImpl: fetchMock,
    });

    const result = await broker.invoke({
      ...defaultRequest,
      packageId: 'com.attacker.app',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PACKAGE_CAPABILITY_NOT_DECLARED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects contracts other than ai-challenge.turn.v1', async () => {
    const fetchMock = vi.fn();
    const broker = createLocalModelInvocationBroker({
      isPackageActive: () => true,
      fetchImpl: fetchMock,
    });

    const result = await broker.invoke({
      ...defaultRequest,
      contract: 'unsupported.contract' as unknown as 'ai-challenge.turn.v1',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PACKAGE_CAPABILITY_REQUEST_INVALID');
  });

  it('rejects inactive packages', async () => {
    const fetchMock = vi.fn();
    const broker = createLocalModelInvocationBroker({
      isPackageActive: () => false,
      fetchImpl: fetchMock,
    });

    const result = await broker.invoke(defaultRequest);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PACKAGE_CAPABILITY_PACKAGE_INACTIVE');
  });

  it('rejects invalid or unverified leases when leaseId is provided', async () => {
    const fetchMock = vi.fn();
    const broker = createLocalModelInvocationBroker({
      isPackageActive: () => true,
      verifyLease: () => false,
      fetchImpl: fetchMock,
    });

    const result = await broker.invoke({
      ...defaultRequest,
      leaseId: 'invalid-lease',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PACKAGE_CAPABILITY_LEASE_UNAVAILABLE');
  });

  it('discovers model, completes chat turn, and returns sanitized result with receipt', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'qwen2.5:3b' }] }), { status: 200 });
      }
      if (url.endsWith('/chat/completions')) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"action":"attack","confidence":0.9}' } }],
          }),
          { status: 200 }
        );
      }
      return new Response('Not Found', { status: 404 });
    });

    let time = 1000;
    const broker = createLocalModelInvocationBroker({
      isPackageActive: () => true,
      endpoint: 'http://127.0.0.1:11434/v1',
      fetchImpl: fetchMock,
      now: () => time,
      createId: () => 'receipt-uuid-1',
    });

    time += 50;
    const result = await broker.invoke(defaultRequest);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected ok');
    expect(result.requestId).toBe('req-1');
    expect(result.data.contract).toBe('ai-challenge.turn.v1');
    expect(result.data.text).toBe('{"action":"attack","confidence":0.9}');
    expect(result.data.model).toBe('qwen2.5:3b');
    expect(result.receipt).toMatchObject({
      receiptId: 'receipt-uuid-1',
      packageId: 'com.tomni.ai-challenge',
      runtimeId: 'runtime-1',
      capability: 'model.invoke',
      status: 'completed',
    });
    expect(result).not.toHaveProperty('endpoint');
    expect(result).not.toHaveProperty('headers');
  });

  it('enforces one in-flight invocation per runtime with PACKAGE_CAPABILITY_MODEL_BUSY', async () => {
    let resolveFirst: (res: Response) => void;
    const firstCallPromise = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'test-model' }] }), { status: 200 });
      }
      return firstCallPromise;
    });

    const broker = createLocalModelInvocationBroker({
      isPackageActive: () => true,
      fetchImpl: fetchMock,
    });

    const firstInvoke = broker.invoke({
      ...defaultRequest,
      requestId: 'req-first',
    });

    // Second call for same runtime while first is in flight
    const secondInvoke = await broker.invoke({
      ...defaultRequest,
      requestId: 'req-second',
    });

    expect(secondInvoke.ok).toBe(false);
    expect(secondInvoke.code).toBe('PACKAGE_CAPABILITY_MODEL_BUSY');

    resolveFirst!(
      new Response(JSON.stringify({ choices: [{ message: { content: 'action_1' } }] }), { status: 200 })
    );

    const firstResult = await firstInvoke;
    expect(firstResult.ok).toBe(true);
  });

  it('supports cancellation of active invocation via cancel()', async () => {
    let aborted = false;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) {
          aborted = true;
          reject(init.signal.reason ?? new Error('Aborted'));
          return;
        }
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(init.signal.reason ?? new Error('Aborted'));
        });
      });
    });

    const broker = createLocalModelInvocationBroker({
      isPackageActive: () => true,
      defaultModel: 'fast-model',
      fetchImpl: fetchMock,
    });

    const invokePromise = broker.invoke(defaultRequest);
    await Promise.resolve(); // let microtasks advance to fetch call

    // Cancel active invocation
    const cancelled = broker.cancel({
      packageId: defaultRequest.packageId,
      runtimeId: defaultRequest.runtimeId,
      requestId: defaultRequest.requestId,
    });
    expect(cancelled).toBe(true);
    expect(aborted).toBe(true);

    const result = await invokePromise;
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PACKAGE_CAPABILITY_LEASE_REVOKED');
  });

  it('handles timeout when model takes longer than deadline', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(init.signal.reason ?? new Error('Aborted'));
            return;
          }
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal.reason ?? new Error('Aborted'));
          });
        });
      });

      const broker = createLocalModelInvocationBroker({
        isPackageActive: () => true,
        defaultModel: 'heavy-model',
        fetchImpl: fetchMock,
      });

      const invokePromise = broker.invoke(defaultRequest);

      // Fast-forward past 1500ms
      await vi.advanceTimersByTimeAsync(1600);

      const result = await invokePromise;
      expect(result.ok).toBe(false);
      expect(result.code).toBe('PACKAGE_CAPABILITY_MODEL_TIMEOUT');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects malformed or empty LLM output with PACKAGE_CAPABILITY_MODEL_INVALID', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'qwen2.5:3b' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '   ' } }] }), { status: 200 });
    });

    const broker = createLocalModelInvocationBroker({
      isPackageActive: () => true,
      fetchImpl: fetchMock,
    });

    const result = await broker.invoke(defaultRequest);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PACKAGE_CAPABILITY_MODEL_INVALID');
  });
});
