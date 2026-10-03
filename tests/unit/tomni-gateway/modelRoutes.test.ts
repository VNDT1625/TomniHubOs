/**
 * @license
 * Copyright 2025 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  startTomniGateway,
  type TomniGatewayCollection,
  type TomniGatewayModelService,
  type TomniGatewayServer,
} from '@process/tomnigateway';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://model-client.tomni.test';
const SESSION = 'gateway-session-is-not-model-credential';
const CONSUMER_CREDENTIAL = 'consumer-credential-v1';
const servers: TomniGatewayServer[] = [];

const collection = (): TomniGatewayCollection => ({
  list: async () => [],
  get: async () => undefined,
});

const harness = async (model: TomniGatewayModelService) => {
  const server = await startTomniGateway({
    auth: { sessionTokens: [SESSION], allowedOrigins: [ORIGIN] },
    services: {
      collections: {
        conversations: collection(),
        teams: collection(),
        companies: collection(),
        cron: collection(),
        mcp: collection(),
      },
      conversationMessages: async () => [],
      model,
    },
  });
  servers.push(server);
  return server;
};

const post = (server: TomniGatewayServer, body: unknown, credential = CONSUMER_CREDENTIAL): Promise<Response> =>
  fetch(`${server.url}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      ...(credential ? { authorization: `Bearer ${credential}` } : {}),
    },
    body: JSON.stringify(body),
  });

const validBody = { model: 'gpt-test', messages: [{ role: 'user', content: 'hello' }] };

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('Tomny model gateway route', () => {
  it('requires a separate consumer credential before reading model input', async () => {
    const authorize = vi.fn(async () => ({ consumerId: 'consumer-1' }));
    const server = await harness({
      authorize,
      chatCompletions: vi.fn(),
    });

    const response = await post(server, validBody, '');

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('MODEL_CREDENTIAL_REQUIRED');
    expect(authorize).not.toHaveBeenCalled();
  });

  it('denies invalid credentials and malformed or oversized requests', async () => {
    const authorize = vi.fn(async ({ credential }: { credential: string }) =>
      credential === CONSUMER_CREDENTIAL ? { consumerId: 'consumer-1' } : undefined
    );
    const server = await harness({ authorize, chatCompletions: vi.fn() });

    const denied = await post(server, validBody, 'wrong');
    const malformed = await post(server, { model: 'gpt-test', messages: [] });
    const oversized = await post(server, {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'x'.repeat(70_000) }],
    });

    expect(denied.status).toBe(401);
    expect((await denied.json()).error.code).toBe('MODEL_CREDENTIAL_DENIED');
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe('INVALID_MODEL_REQUEST');
    expect(oversized.status).toBe(400);
  });

  it('rejects streaming until the broker has a streaming contract', async () => {
    const server = await harness({
      authorize: async () => ({ consumerId: 'consumer-1' }),
      chatCompletions: vi.fn(),
    });

    const response = await post(server, { ...validBody, stream: true });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('MODEL_STREAMING_UNSUPPORTED');
  });

  it('returns a normalized completion without exposing an upstream secret', async () => {
    const chatCompletions = vi.fn(
      async (input: { consumerId: string; model: string; messages: readonly unknown[]; signal: AbortSignal }) => {
        expect(input.consumerId).toBe('consumer-1');
        expect(input.model).toBe('gpt-test');
        expect(input.messages).toEqual(validBody.messages);
        expect(input.signal).toBeInstanceOf(AbortSignal);
        return { model: input.model, content: 'done', usage: { prompt_tokens: 1, completion_tokens: 1 } };
      }
    );
    const server = await harness({
      authorize: async ({ credential }) =>
        credential === CONSUMER_CREDENTIAL ? { consumerId: 'consumer-1' } : undefined,
      chatCompletions,
    });

    const response = await post(server, validBody);
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.object).toBe('chat.completion');
    expect(result.choices[0].message.content).toBe('done');
    expect(JSON.stringify(result)).not.toContain(CONSUMER_CREDENTIAL);
    expect(chatCompletions).toHaveBeenCalledOnce();
  });

  it('propagates client cancellation to the Main-owned model service', async () => {
    let aborted: Promise<void> | undefined;
    const server = await harness({
      authorize: async () => ({ consumerId: 'consumer-1' }),
      chatCompletions: vi.fn(async ({ signal }: { signal: AbortSignal }) => {
        aborted = new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        await aborted;
        throw new Error('cancelled');
      }),
    });
    const controller = new AbortController();
    const request = fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${CONSUMER_CREDENTIAL}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(validBody),
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await expect(request).rejects.toThrow();
    await expect(
      Promise.race([
        aborted,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('abort not propagated')), 1_000)),
      ])
    ).resolves.toBeUndefined();
  });
  it('returns an explicit unknown quota without inferring a balance', async () => {
    const server = await harness({
      authorize: async ({ credential }) =>
        credential === CONSUMER_CREDENTIAL ? { consumerId: 'consumer-1' } : undefined,
      chatCompletions: vi.fn(),
      getQuota: async ({ consumerId, model }) => ({
        status: 'unknown',
        source: 'unsupported',
        unit: 'tokens',
        consumerId,
        ...(model === undefined ? {} : { model }),
      }),
    });
    const response = await fetch(`${server.url}/v1/model-quota?model=gpt-test`, {
      headers: { origin: ORIGIN, authorization: `Bearer ${CONSUMER_CREDENTIAL}` },
    });
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.object).toBe('quota');
    expect(result.data).toEqual({
      status: 'unknown',
      source: 'unsupported',
      unit: 'tokens',
      consumerId: 'consumer-1',
      model: 'gpt-test',
    });
    expect(result.data.remaining).toBeUndefined();
    expect(result.data.limit).toBeUndefined();
  });

  it('exposes actor-scoped replay preview, export, and deletion controls', async () => {
    const replayPreview = vi.fn(async () => ({ enabled: true, count: 1, bytes: 42 }));
    const replayExport = vi.fn(async () => [{ sampleId: 'sample-1', input: { text: 'redacted' } }]);
    const deleteReplay = vi.fn(async (sampleId?: string) => (sampleId === 'sample-1' ? 1 : 0));
    const server = await harness({
      authorize: async () => ({ consumerId: 'consumer-1' }),
      chatCompletions: vi.fn(),
      replayPreview,
      replayExport,
      deleteReplay,
    });

    const preview = await fetch(`${server.url}/v1/model-replay`, {
      headers: { origin: ORIGIN, authorization: `Bearer ${CONSUMER_CREDENTIAL}` },
    });
    const exported = await fetch(`${server.url}/v1/model-replay/export`, {
      headers: { origin: ORIGIN, authorization: `Bearer ${CONSUMER_CREDENTIAL}` },
    });
    const deleted = await fetch(`${server.url}/v1/model-replay?sample_id=sample-1`, {
      method: 'DELETE',
      headers: { origin: ORIGIN, authorization: `Bearer ${CONSUMER_CREDENTIAL}` },
    });

    expect(preview.status).toBe(200);
    expect((await preview.json()).data).toEqual({ enabled: true, count: 1, bytes: 42 });
    expect(exported.status).toBe(200);
    expect((await exported.json()).data).toEqual([{ sampleId: 'sample-1', input: { text: 'redacted' } }]);
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).deleted).toBe(1);
    expect(replayPreview).toHaveBeenCalledOnce();
    expect(replayExport).toHaveBeenCalledOnce();
    expect(deleteReplay).toHaveBeenCalledWith('sample-1');
  });

  it('exposes only the admitted consumer request history', async () => {
    const listRequestHistory = vi.fn(async ({ consumerId, model }: { consumerId?: string; model?: string }) => [
      { requestId: 'request-1', consumerId, model, actorDigest: 'private', status: 'completed' },
    ]);
    const server = await harness({
      authorize: async ({ credential }) =>
        credential === CONSUMER_CREDENTIAL ? { consumerId: 'consumer-1' } : undefined,
      chatCompletions: vi.fn(),
      listRequestHistory,
    });
    const response = await fetch(`${server.url}/v1/model-requests?status=completed&model=gpt-test`, {
      headers: { origin: ORIGIN, authorization: `Bearer ${CONSUMER_CREDENTIAL}` },
    });
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.object).toBe('list');
    expect(result.data).toEqual([
      { requestId: 'request-1', consumerId: 'consumer-1', model: 'gpt-test', status: 'completed' },
    ]);
    expect(JSON.stringify(result)).not.toContain('private');
    expect(listRequestHistory).toHaveBeenCalledWith(
      expect.objectContaining({ consumerId: 'consumer-1', model: 'gpt-test', status: 'completed' })
    );
  });
  it('accepts bounded non-stream Responses requests and normalizes output', async () => {
    const chatCompletions = vi.fn(async (input: { messages: readonly unknown[]; model: string }) => {
      expect(input.model).toBe('gpt-test');
      expect(input.messages).toEqual([{ role: 'user', content: 'hello from responses' }]);
      return {
        model: input.model,
        content: 'response done',
        usage: {
          prompt_tokens: 2,
          completion_tokens: 3,
          total_tokens: 5,
          cached_tokens: 1,
          reasoning_tokens: 2,
        },
        receiptId: 'receipt-1',
      };
    });
    const server = await harness({
      authorize: async () => ({ consumerId: 'consumer-1' }),
      chatCompletions,
    });
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${CONSUMER_CREDENTIAL}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-test', input: 'hello from responses' }),
    });
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.object).toBe('response');
    expect(result.status).toBe('completed');
    expect(result.output_text).toBe('response done');
    expect(result.output[0].content[0].type).toBe('output_text');
    expect(result.usage).toEqual({
      input_tokens: 2,
      output_tokens: 3,
      total_tokens: 5,
      input_tokens_details: { cached_tokens: 1 },
      output_tokens_details: { reasoning_tokens: 2 },
    });
    expect(result.tomni_receipt_id).toBe('receipt-1');
    expect(chatCompletions).toHaveBeenCalledOnce();
  });

  it('rejects non-loopback model ingress hosts', async () => {
    await expect(
      startTomniGateway({
        host: '0.0.0.0',
        auth: { sessionTokens: [SESSION], allowedOrigins: [ORIGIN] },
        services: {
          collections: {
            conversations: collection(),
            teams: collection(),
            companies: collection(),
            cron: collection(),
            mcp: collection(),
          },
          conversationMessages: async () => [],
          model: { authorize: async () => ({ consumerId: 'consumer-1' }), chatCompletions: vi.fn() },
        },
      })
    ).rejects.toThrow('Model ingress requires a loopback host');
  });

  it('rejects streaming Responses requests without faking SSE', async () => {
    const chatCompletions = vi.fn();
    const server = await harness({
      authorize: async () => ({ consumerId: 'consumer-1' }),
      chatCompletions,
    });
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${CONSUMER_CREDENTIAL}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-test', input: 'hello', stream: true }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('MODEL_STREAMING_UNSUPPORTED');
    expect(chatCompletions).not.toHaveBeenCalled();
  });
});
