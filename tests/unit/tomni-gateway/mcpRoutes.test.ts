/**
 * @license
 * Copyright 2025 Tomni
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMcpServer } from '@/common/config/storage';
import {
  startTomniGateway,
  type TomniGatewayCollection,
  type TomniGatewayMcpService,
  type TomniGatewayServer,
} from '@process/tomnigateway';
import { afterEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'tomni-mcp-gateway-token';
const ORIGIN = 'https://mcp.tomni.test';
const servers: TomniGatewayServer[] = [];

const collection = (): TomniGatewayCollection => ({
  list: vi.fn(async () => []),
  get: vi.fn(async () => undefined),
});

const initialServer = (): IMcpServer => ({
  id: 'mcp-1',
  name: 'Native MCP',
  enabled: true,
  transport: {
    type: 'http',
    url: 'https://mcp.example.test/api?token=url-secret',
    headers: { Authorization: 'Bearer header-secret', Accept: 'application/json' },
  },
  original_json: JSON.stringify({
    mcpServers: {
      native: { headers: { Authorization: 'Bearer json-secret' } },
    },
  }),
  created_at: 1,
  updated_at: 1,
});

const harness = async () => {
  let items = [initialServer()];
  const oauth = {
    status: vi.fn(async () => ({ authenticated: true })),
    login: vi.fn(async () => ({ success: true })),
    logout: vi.fn(async () => undefined),
    authenticated: vi.fn(async () => ['https://mcp.example.test/']),
  };
  const mcp: TomniGatewayMcpService = {
    list: vi.fn(async () => structuredClone(items)),
    get: vi.fn(async (id) => structuredClone(items.find((item) => item.id === id))),
    create: vi.fn(async (draft) => {
      const created: IMcpServer = {
        ...draft,
        id: 'mcp-created',
        enabled: true,
        created_at: 2,
        updated_at: 2,
      };
      items.push(created);
      return structuredClone(created);
    }),
    importMany: vi.fn(async (drafts) =>
      drafts.map((draft, index) => ({
        ...draft,
        id: draft.id ?? `import-${index}`,
        enabled: draft.enabled ?? true,
        created_at: draft.created_at ?? 3,
        updated_at: 3,
        original_json: draft.original_json ?? '{}',
      }))
    ),
    update: vi.fn(async (id, data) => {
      const index = items.findIndex((item) => item.id === id);
      items[index] = { ...items[index], ...data, updated_at: 4 };
      return structuredClone(items[index]);
    }),
    remove: vi.fn(async (id) => {
      items = items.filter((item) => item.id !== id);
    }),
    toggle: vi.fn(async (id) => {
      const index = items.findIndex((item) => item.id === id);
      items[index] = { ...items[index], enabled: !items[index].enabled };
      return structuredClone(items[index]);
    }),
    test: vi.fn(async () => ({
      success: false,
      error: '401 at https://mcp.example.test/?token=probe-secret with Bearer response-secret',
      needsAuth: true,
      authMethod: 'oauth',
    })),
    recordTest: vi.fn(async (id, result) => {
      const index = items.findIndex((item) => item.id === id);
      items[index] = {
        ...items[index],
        last_test_status: result.success ? 'connected' : 'error',
        last_test_at: result.testedAt,
        last_test_error: result.error,
      };
      return structuredClone(items[index]);
    }),
    discover: vi.fn(async () => [
      {
        source: 'codex',
        servers: [{ ...initialServer(), id: 'discovered', importable: true }],
      },
    ]),
    oauth,
  };
  const server = await startTomniGateway({
    auth: { sessionTokens: [TOKEN], allowedOrigins: [ORIGIN] },
    services: {
      collections: {
        conversations: collection(),
        teams: collection(),
        companies: collection(),
        cron: collection(),
        mcp: { list: mcp.list, get: mcp.get },
      },
      conversationMessages: vi.fn(async () => []),
      mcp,
    },
  });
  servers.push(server);
  return { server, mcp, oauth };
};

const request = (
  server: TomniGatewayServer,
  pathname: string,
  method = 'GET',
  body?: unknown,
  token = TOKEN
): Promise<Response> =>
  fetch(`${server.url}${pathname}`, {
    method,
    headers: {
      origin: ORIGIN,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('Tomni MCP gateway routes', () => {
  it('creates, updates, toggles, and deletes MCP servers through the native service', async () => {
    const { server } = await harness();
    const created = await request(server, '/api/v1/mcp', 'POST', {
      name: 'Created',
      transport: { type: 'stdio', command: 'node', args: ['server.js'] },
    });
    const updated = await request(server, '/api/v1/mcp/mcp-created', 'PATCH', { description: 'Updated' });
    const toggled = await request(server, '/api/v1/mcp/mcp-created/toggle', 'POST');
    const removed = await request(server, '/api/v1/mcp/mcp-created', 'DELETE');

    expect(created.status).toBe(201);
    expect((await updated.json()).data.description).toBe('Updated');
    expect((await toggled.json()).data.enabled).toBe(false);
    expect((await removed.json()).data).toEqual({ deleted: true });
  });

  it('imports and discovers agent MCP configs while redacting credentials', async () => {
    const { server } = await harness();
    const imported = await request(server, '/api/v1/mcp/import', 'POST', {
      servers: [{ name: 'Imported', transport: { type: 'http', url: 'https://import.test/' } }],
    });
    const discovered = await request(server, '/api/v1/mcp/agent-configs');

    expect(imported.status).toBe(200);
    const payload = JSON.stringify(await discovered.json());
    expect(payload).not.toContain('header-secret');
    expect(payload).not.toContain('json-secret');
    expect(payload).not.toContain('url-secret');
  });

  it('persists bounded test results and never returns probe secrets', async () => {
    const { server, mcp } = await harness();
    const response = await request(server, '/api/v1/mcp/mcp-1/test', 'POST');
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mcp.recordTest).toHaveBeenCalledOnce();
    expect(payload.data.server.last_test_status).toBe('error');
    expect(JSON.stringify(payload)).not.toContain('probe-secret');
  });

  it('supports OAuth status, login, logout, and authenticated URL discovery without token exposure', async () => {
    const { server, oauth } = await harness();
    const input = { server_url: 'https://mcp.example.test/' };
    await request(server, '/api/v1/mcp/oauth/status', 'POST', input);
    await request(server, '/api/v1/mcp/oauth/login', 'POST', input);
    await request(server, '/api/v1/mcp/oauth/logout', 'POST', input);
    const authenticated = await request(server, '/api/v1/mcp/oauth/authenticated');

    expect(oauth.status).toHaveBeenCalledWith(input.server_url);
    expect(oauth.login).toHaveBeenCalledWith(input.server_url);
    expect(oauth.logout).toHaveBeenCalledWith(input.server_url);
    expect(await authenticated.json()).toEqual(
      expect.objectContaining({ data: { server_urls: ['https://mcp.example.test/'] } })
    );
  });

  it('enforces authentication, route methods, body limits, validation, and missing-resource responses', async () => {
    const { server } = await harness();
    const unauthorized = await request(server, '/api/v1/mcp', 'GET', undefined, '');
    const method = await request(server, '/api/v1/mcp/import', 'GET');
    const invalid = await request(server, '/api/v1/mcp', 'POST', { name: 'Missing transport' });
    const tooLarge = await request(server, '/api/v1/mcp', 'POST', `{"value":"${'x'.repeat(70_000)}"}`);
    const missing = await request(server, '/api/v1/mcp/missing');

    expect(unauthorized.status).toBe(401);
    expect(method.status).toBe(405);
    expect(invalid.status).toBe(400);
    expect(tooLarge.status).toBe(413);
    expect(missing.status).toBe(404);
  });
});
