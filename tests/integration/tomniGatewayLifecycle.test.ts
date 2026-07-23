/**
 * @license
 * Copyright 2025 Tomni
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
} from '@process/tomnigateway';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'production-test-session-token';
const tempDirectories: string[] = [];

const dependencies = async () => {
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
  return { conversation, teams, companies, cron, mcp, dataDir, sessionToken: TOKEN };
};

afterEach(async () => {
  await stopProductionTomniGateway();
  resetProductionTomniGatewayForTests();
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('production Tomni gateway lifecycle', () => {
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
});
