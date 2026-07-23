/**
 * @license
 * Copyright 2025 Tomni
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  startTomniGateway,
  TOMNI_GATEWAY_PROTOCOL,
  type TomniGatewayCollection,
  type TomniGatewayEvent,
  type TomniGatewayServer,
} from '@process/tomnigateway';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'tomni-test-session-token-123';
const ORIGIN = 'https://web.tomni.test';
const servers: TomniGatewayServer[] = [];

const collection = (name: string): TomniGatewayCollection => ({
  list: vi.fn(async (query) => ({ name, query })),
  get: vi.fn(async (id) => (id === 'missing' ? undefined : { name, id })),
});

const harness = async () => {
  const listeners = new Set<(event: TomniGatewayEvent) => void>();
  const server = await startTomniGateway({
    auth: { sessionTokens: [TOKEN], allowedOrigins: [ORIGIN] },
    services: {
      collections: {
        conversations: collection('conversations'),
        teams: collection('teams'),
        companies: collection('companies'),
        cron: collection('cron'),
        mcp: collection('mcp'),
      },
      conversationMessages: vi.fn(async (id, query) => ({ id, query, items: [] })),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  });
  servers.push(server);
  return { server, emit: (event: TomniGatewayEvent) => listeners.forEach((listener) => listener(event)) };
};

const request = (server: TomniGatewayServer, pathname: string, token = TOKEN, origin = ORIGIN): Promise<Response> =>
  fetch(`${server.url}${pathname}`, {
    headers: {
      origin,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

const nextMessage = (client: WebSocket): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    client.once('message', (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
    client.once('error', reject);
  });

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('Tomni compatibility gateway contract', () => {
  it('serves versioned native collection and message routes', async () => {
    const { server } = await harness();

    const list = await request(server, '/api/v1/teams?cursor=next');
    const detail = await request(server, '/api/v1/companies/company-1');
    const messages = await request(server, '/api/v1/conversations/chat-1/messages?page=2');

    expect(await list.json()).toEqual({
      protocol: TOMNI_GATEWAY_PROTOCOL,
      ok: true,
      data: { name: 'teams', query: { cursor: 'next' } },
    });
    expect((await detail.json()).data).toEqual({ name: 'companies', id: 'company-1' });
    expect((await messages.json()).data).toEqual({ id: 'chat-1', query: { page: '2' }, items: [] });
  });

  it('rejects missing tokens and unlisted browser origins', async () => {
    const { server } = await harness();

    const missingToken = await request(server, '/api/v1/conversations', '');
    const deniedOrigin = await request(server, '/api/v1/conversations', TOKEN, 'https://evil.example');

    expect(missingToken.status).toBe(401);
    expect((await missingToken.json()).error.code).toBe('UNAUTHORIZED');
    expect(deniedOrigin.status).toBe(403);
    expect((await deniedOrigin.json()).error.code).toBe('ORIGIN_DENIED');
  });

  it('returns bounded errors without exposing service exceptions', async () => {
    const { server } = await harness();

    const missing = await request(server, '/api/v1/mcp/missing');
    const method = await fetch(`${server.url}/api/v1/mcp`, {
      method: 'POST',
      headers: { origin: ORIGIN, authorization: `Bearer ${TOKEN}` },
    });

    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('NOT_FOUND');
    expect(method.status).toBe(405);
  });

  it('authenticates WebSocket clients without URL tokens and broadcasts native events', async () => {
    const { server, emit } = await harness();
    const encodedToken = Buffer.from(TOKEN, 'utf8').toString('base64url');
    const client = new WebSocket(server.wsUrl, ['tomni-v1', `tomni-auth.${encodedToken}`], {
      origin: ORIGIN,
    });

    const ready = await nextMessage(client);
    const eventPromise = nextMessage(client);
    emit({ topic: 'conversation.delta', data: { text: 'hello' }, timestamp: 123 });
    const event = await eventPromise;

    expect(ready).toEqual(expect.objectContaining({ protocol: TOMNI_GATEWAY_PROTOCOL, type: 'ready' }));
    expect(event).toEqual({
      protocol: TOMNI_GATEWAY_PROTOCOL,
      type: 'event',
      topic: 'conversation.delta',
      timestamp: 123,
      data: { text: 'hello' },
    });
    client.close();
  });

  it('rejects WebSocket upgrades with an invalid session token', async () => {
    const { server } = await harness();
    const encodedToken = Buffer.from('invalid-session-token-123', 'utf8').toString('base64url');
    const client = new WebSocket(server.wsUrl, ['tomni-v1', `tomni-auth.${encodedToken}`], {
      origin: ORIGIN,
    });
    const status = await new Promise<number>((resolve, reject) => {
      client.once('unexpected-response', (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      client.once('open', () => reject(new Error('Invalid WebSocket token was accepted.')));
      client.once('error', () => undefined);
    });

    expect(status).toBe(401);
  });
});
