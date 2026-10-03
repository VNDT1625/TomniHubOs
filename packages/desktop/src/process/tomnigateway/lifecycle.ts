/**
 * @license
 * Copyright 2025 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { CoreScheduledTaskService } from '@process/cron/scheduledTasks';
import type { NativeConversationService } from '@process/services/database/nativeConversation';

import { transcribeSpeech } from '@process/services/contentExtract/speechTranscription';
import type { JsonTeamStore } from '@process/team';
import type { CompanyServices } from '@process/company/companyBridge';
import type { McpRegistry } from '@process/resources/mcpRegistry/mcpRegistry';
import {
  McpOAuthVault,
  NativeMcpConfigScanner,
  NativeMcpOAuthService,
  NativeMcpProbe,
} from '@process/resources/nativePlatform';
import { startTomniGateway, type TomniGatewayServer } from './server';
import type { TomniGatewayEvent, TomniGatewayModelService, TomniGatewayServices } from './types';

import { TomniWebAuth } from './webAuth';

export type ProductionTomniGatewayDeps = {
  conversation: NativeConversationService;
  teams: JsonTeamStore;
  companies: CompanyServices;
  cron: CoreScheduledTaskService;
  mcp: McpRegistry;
  mcpProbe?: NativeMcpProbe;
  mcpScanner?: NativeMcpConfigScanner;
  mcpOAuth?: NativeMcpOAuthService;
  dataDir: string;
  subscribe?: (listener: (event: TomniGatewayEvent) => void) => () => void;
  sessionToken?: string;
  /** Main-owned isolated model ingress; omitted keeps model routes disabled. */
  modelService?: TomniGatewayModelService;
  port?: number;
};

export type TomniGatewayEndpoint = {
  url: string;
  wsUrl: string;
  port: number;
  sessionToken: string;
};

let serverPromise: Promise<TomniGatewayServer> | undefined;
let endpointPromise: Promise<TomniGatewayEndpoint> | undefined;
let activeGatewayPort: number | undefined;

export const getTomniGatewayPort = (): number | undefined => activeGatewayPort;

const positiveInteger = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

const companyIds = async (dataDir: string): Promise<string[]> => {
  try {
    const entries = await readdir(path.join(dataDir, 'companies'), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.length > 0 && !entry.name.includes('..'))
      .map((entry) => entry.name)
      .toSorted();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
};

const servicePorts = (deps: ProductionTomniGatewayDeps): TomniGatewayServices => {
  const probe = deps.mcpProbe ?? new NativeMcpProbe();
  const scanner = deps.mcpScanner ?? new NativeMcpConfigScanner();
  const oauth =
    deps.mcpOAuth ??
    new NativeMcpOAuthService(new McpOAuthVault(path.join(deps.dataDir, 'tomny-core', 'mcp-oauth.enc')));
  const getMcp = async (id: string) => (await deps.mcp.list()).find((server) => server.id === id);
  return {
    collections: {
      conversations: {
        list: (query) => deps.conversation.list(query.cursor, positiveInteger(query.limit, 50, 200)),
        get: (id) => deps.conversation.get(id),
      },
      teams: {
        list: () => deps.teams.list(),
        get: async (id) => (await deps.teams.get(id)) ?? undefined,
      },
      companies: {
        list: async () =>
          Promise.all((await companyIds(deps.dataDir)).map((id) => deps.companies.configStore.load(id))),
        get: async (id) => {
          const ids = await companyIds(deps.dataDir);
          return ids.includes(id) ? deps.companies.configStore.load(id) : undefined;
        },
      },
      cron: {
        list: () => deps.cron.list(),
        get: (id) => deps.cron.get(id),
      },
      mcp: {
        list: () => deps.mcp.list(),
        get: async (id) => (await deps.mcp.list()).find((server) => server.id === id),
      },
    },
    mcp: {
      list: () => deps.mcp.list(),
      get: getMcp,
      create: (draft) => deps.mcp.create(draft),
      importMany: (drafts) => deps.mcp.importMany(drafts),
      update: (id, data) => deps.mcp.update(id, data),
      remove: (id) => deps.mcp.remove(id),
      toggle: (id) => deps.mcp.toggle(id),
      test: (server) => probe.test(server),
      recordTest: (id, result) => deps.mcp.recordTest(id, result),
      discover: () => scanner.scan(),
      oauth: {
        status: (serverUrl) => oauth.status(serverUrl),
        login: (serverUrl) => oauth.login(serverUrl),
        logout: (serverUrl) => oauth.logout(serverUrl),
        authenticated: () => oauth.authenticated(),
      },
    },
    conversationMessages: (conversationId, query) =>
      deps.conversation.history(
        conversationId,
        positiveInteger(query.page, 1, Number.MAX_SAFE_INTEGER),
        positiveInteger(query.page_size, 50, 500),
        query.order === 'desc' ? 'desc' : 'asc'
      ),
    speechTranscribe: (request) => transcribeSpeech(request),

    subscribe: deps.subscribe,
    model: deps.modelService,
  };
};

export const startProductionTomniGateway = (deps: ProductionTomniGatewayDeps): Promise<TomniGatewayEndpoint> => {
  if (endpointPromise) return endpointPromise;
  const sessionToken =
    deps.sessionToken ?? process.env.TOMNI_GATEWAY_SESSION_TOKEN ?? randomBytes(32).toString('base64url');
  const port = deps.port ?? Number(process.env.TOMNI_GATEWAY_PORT || 0);
  serverPromise = startTomniGateway({
    host: '127.0.0.1',
    port: Number.isSafeInteger(port) && port >= 0 ? port : 0,
    auth: {
      sessionTokens: [sessionToken],
      allowedOrigins: [],
      // The gateway is loopback-only. WebHost strips browser Origin and adds the
      // private bearer, so direct browser requests still cannot authenticate.
      allowMissingOrigin: true,
    },
    services: servicePorts(deps),

    webAuth: new TomniWebAuth(deps.dataDir),
  });
  endpointPromise = serverPromise.then((server) => {
    activeGatewayPort = server.port;
    (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort = server.port;
    return {
      url: server.url,
      wsUrl: server.wsUrl,
      port: server.port,
      sessionToken,
    };
  });
  return endpointPromise;
};

export const getTomniGatewayEndpoint = async (): Promise<TomniGatewayEndpoint> => {
  if (!endpointPromise) throw new Error('[TomnyGateway] Native gateway has not started.');
  return endpointPromise;
};

export const stopProductionTomniGateway = async (): Promise<void> => {
  const current = serverPromise;
  serverPromise = undefined;
  endpointPromise = undefined;
  activeGatewayPort = undefined;
  if (current) await (await current).close();
};

export const resetProductionTomniGatewayForTests = (): void => {
  serverPromise = undefined;
  endpointPromise = undefined;
  activeGatewayPort = undefined;
};
