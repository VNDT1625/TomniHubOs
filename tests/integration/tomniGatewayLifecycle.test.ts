/**
 * @license
 * Copyright 2025 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CompanyServices } from '@process/company/companyBridge';
import type { CoreScheduledTaskService } from '@process/cron/scheduledTasks';
import type { McpRegistry } from '@process/resources/mcpRegistry/mcpRegistry';
import type { NativeConversationService } from '@process/services/database/nativeConversation';
import type { JsonTeamStore } from '@process/team';
import {
  getTomniGatewayEndpoint,
  resetProductionTomniGatewayForTests,
  startProductionTomniGateway,
  stopProductionTomniGateway,
  type TomniGatewayModelService,
} from '@process/tomnigateway';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'production-test-session-token';
const MODEL_CREDENTIAL = 'production-model-consumer-token';
const tempDirectories: string[] = [];

const dependencies = async (modelService?: TomniGatewayModelService) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tomni-gateway-native-'));
  tempDirectories.push(dataDir);
  const conversation = {
    list: vi.fn(async () => ({ items: [{ id: 'chat-1' }], total: 1, has_more: false })),
    get: vi.fn(async (id: string) => (id === 'chat-1' ? { id } : undefined)),
    history: vi.fn(async () => ({ items: [], total: 0, has_more: false })),
  } as unknown as NativeConversationService;
  const teams = {
    list: vi.fn(async () => [{ id: 'team-1' }]),
    get: vi.fn(async (id: string) => (id === 'team-1' ? { id } : null)),
  } as unknown as JsonTeamStore;
  const companies = {
    configStore: { load: vi.fn(), save: vi.fn(), setRules: vi.fn(), getRules: vi.fn(), deleteCompany: vi.fn() },
    contextLayering: {},
    buildStructure: vi.fn(),
  } as unknown as CompanyServices;
  const cron = {
    list: vi.fn(async () => [{ id: 'cron-1' }]),
    get: vi.fn(async (id: string) => (id === 'cron-1' ? { id } : undefined)),
  } as unknown as CoreScheduledTaskService;
  const mcp = {
    list: vi.fn(async () => [{ id: 'mcp-1', name: 'Native MCP' }]),
  } as unknown as McpRegistry;
  return { conversation, teams, companies, cron, mcp, dataDir, sessionToken: TOKEN, modelService };
};

afterEach(async () => {
  await stopProductionTomniGateway();
  resetProductionTomniGatewayForTests();
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('production Tomny gateway lifecycle', () => {
  it('starts over native service instances, serves data, and stops cleanly', async () => {
    const endpoint = await startProductionTomniGateway(await dependencies());
    expect(await getTomniGatewayEndpoint()).toEqual(endpoint);

    const response = await fetch(`${endpoint.url}/api/v1/conversations`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data.items).toEqual([{ id: 'chat-1' }]);

    await stopProductionTomniGateway();
    await expect(fetch(`${endpoint.url}/api/v1/health`)).rejects.toThrow();
  });

  it('keeps model ingress disabled when no Main-owned model service is injected', async () => {
    const endpoint = await startProductionTomniGateway(await dependencies());

    const response = await fetch(`${endpoint.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${MODEL_CREDENTIAL}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'model-1', messages: [{ role: 'user', content: 'hello' }] }),
    });

    expect(response.status).toBe(401);
  });

  it('forwards an explicitly injected Main-owned model service without sharing the session token', async () => {
    const modelService: TomniGatewayModelService = {
      authorize: vi.fn(async ({ credential }) =>
        credential === MODEL_CREDENTIAL ? { consumerId: 'consumer-1' } : undefined
      ),
      chatCompletions: vi.fn(async ({ model }) => ({ model, content: 'native answer' })),
    };
    const endpoint = await startProductionTomniGateway(await dependencies(modelService));

    const response = await fetch(`${endpoint.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${MODEL_CREDENTIAL}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'model-1', messages: [{ role: 'user', content: 'hello' }] }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).choices[0].message.content).toBe('native answer');
    expect(modelService.authorize).toHaveBeenCalledWith({
      credential: MODEL_CREDENTIAL,
      origin: undefined,
      path: '/v1/chat/completions',
    });
    expect(modelService.authorize).not.toHaveBeenCalledWith(expect.objectContaining({ credential: TOKEN }));
  });
});
