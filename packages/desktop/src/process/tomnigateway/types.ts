/**
 * @license
 * Copyright 2025 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMcpServer } from '@/common/config/storage';
import type { McpServerDraft, McpServerImport } from '@process/resources/mcpRegistry/mcpRegistry';
import type { McpTestResult } from '@process/resources/nativePlatform/mcpDrivers';
import type { TomniWebAuth } from './webAuth';

export const TOMNI_GATEWAY_PROTOCOL = 'tomni.gateway.v1' as const;

export type TomniGatewayCollectionName = 'conversations' | 'teams' | 'companies' | 'cron' | 'mcp';

export type TomniGatewayCollection = {
  list: (query: Readonly<Record<string, string>>) => Promise<unknown>;
  get: (id: string) => Promise<unknown | undefined>;
};

export type TomniGatewayEvent = {
  topic: string;
  data: unknown;
  timestamp?: number;
};

export type TomniGatewaySpeechRequest = {
  audioBuffer: Uint8Array;
  file_name: string;
  mimeType: string;
  languageHint?: string;
};

export type TomniGatewayMcpDiscoveryGroup = {
  source: string;
  servers: Array<IMcpServer & { importable: boolean; import_skip_reason?: string }>;
};

export type TomniGatewayMcpService = {
  list: () => Promise<IMcpServer[]>;
  get: (id: string) => Promise<IMcpServer | undefined>;
  create: (draft: McpServerDraft) => Promise<IMcpServer>;
  importMany: (drafts: McpServerImport[]) => Promise<IMcpServer[]>;
  update: (id: string, data: Partial<McpServerDraft>) => Promise<IMcpServer>;
  remove: (id: string) => Promise<void>;
  toggle: (id: string) => Promise<IMcpServer>;
  test: (server: IMcpServer) => Promise<McpTestResult>;
  recordTest: (id: string, result: McpTestResult & { testedAt: number }) => Promise<IMcpServer>;
  discover: () => Promise<TomniGatewayMcpDiscoveryGroup[]>;
  oauth: {
    status: (serverUrl: string) => Promise<{ authenticated: boolean }>;
    login: (serverUrl: string) => Promise<{ success: boolean; error?: string }>;
    logout: (serverUrl: string) => Promise<void>;
    authenticated: () => Promise<string[]>;
  };
};

export type TomniGatewayServices = {
  collections: Record<TomniGatewayCollectionName, TomniGatewayCollection>;
  conversationMessages: (conversationId: string, query: Readonly<Record<string, string>>) => Promise<unknown>;
  mcp?: TomniGatewayMcpService;

  speechTranscribe?: (request: TomniGatewaySpeechRequest) => Promise<unknown>;
  subscribe?: (listener: (event: TomniGatewayEvent) => void) => () => void;
};

export type TomniGatewayAuthConfig = {
  /** One or more opaque session tokens. Empty tokens are rejected at startup. */
  sessionTokens: readonly string[];
  /** Exact browser origins. Wildcards are intentionally unsupported. */
  allowedOrigins: readonly string[];
  /** Required for native clients which cannot send Origin. Defaults to false. */
  allowMissingOrigin?: boolean;
};

export type TomniGatewayOptions = {
  auth: TomniGatewayAuthConfig;
  services: TomniGatewayServices;

  webAuth?: TomniWebAuth;
  host?: string;
  port?: number;
  maxWebSocketBufferBytes?: number;
};
