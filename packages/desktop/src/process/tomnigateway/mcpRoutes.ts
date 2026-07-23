/**
 * @license
 * Copyright 2025 Tomni
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IncomingMessage } from 'node:http';
import type { IMcpServer, IMcpServerTransport } from '@/common/config/storage';
import type { McpServerDraft, McpServerImport } from '@process/resources/mcpRegistry/mcpRegistry';
import type { TomniGatewayMcpService } from './types';

const MAX_JSON_BYTES = 64 * 1024;
const SECRET_KEY = /(authorization|api[_-]?key|token|secret|password|cookie|credential)/iu;
const REDACTED = '[redacted]';

type McpRouteResponder = {
  success: (data: unknown, status?: number) => void;
  failure: (status: number, code: string, message: string) => void;
};

export type McpRouteRequest = {
  request: IncomingMessage;
  url: URL;
  service: TomniGatewayMcpService;
  respond: McpRouteResponder;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const redactText = (value: string): string =>
  value
    .replace(/(bearer\s+)[^\s,;]+/giu, `$1${REDACTED}`)
    .replace(/([?&](?:access_token|api[_-]?key|token|secret|password)=)[^&\s]+/giu, `$1${REDACTED}`);

const redactUnknown = (value: unknown, key = ''): unknown => {
  if (SECRET_KEY.test(key)) return REDACTED;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entry]) => [entryKey, redactUnknown(entry, entryKey)])
  );
};

const redactOriginalJson = (value: string): string => {
  try {
    return JSON.stringify(redactUnknown(JSON.parse(value) as unknown), null, 2);
  } catch {
    return REDACTED;
  }
};

const publicServer = (server: IMcpServer): unknown => ({
  ...server,
  transport: redactUnknown(server.transport),
  ...(server.tools ? { tools: redactUnknown(server.tools) } : {}),
  original_json: redactOriginalJson(server.original_json),
  ...(server.last_test_error ? { last_test_error: redactText(server.last_test_error) } : {}),
});

const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_JSON_BYTES) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(bytes);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!isRecord(parsed)) throw new Error('INVALID_JSON');
  return parsed;
};

const stringMap = (value: unknown): Record<string, string> | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== 'string')) {
    throw new Error('INVALID_TRANSPORT');
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, entry as string]));
};

const stringArray = (value: unknown): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new Error('INVALID_TRANSPORT');
  return [...value];
};

const transportFrom = (value: unknown): IMcpServerTransport => {
  if (!isRecord(value) || typeof value.type !== 'string') throw new Error('INVALID_TRANSPORT');
  if (value.type === 'stdio') {
    if (typeof value.command !== 'string' || value.command.trim().length === 0) throw new Error('INVALID_TRANSPORT');
    return {
      type: 'stdio',
      command: value.command,
      ...(stringArray(value.args) ? { args: stringArray(value.args) } : {}),
      ...(stringMap(value.env) ? { env: stringMap(value.env) } : {}),
    };
  }
  if (!['sse', 'http', 'streamable_http'].includes(value.type) || typeof value.url !== 'string') {
    throw new Error('INVALID_TRANSPORT');
  }
  const url = new URL(value.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('INVALID_TRANSPORT');
  return {
    type: value.type as 'sse' | 'http' | 'streamable_http',
    url: url.toString(),
    ...(stringMap(value.headers) ? { headers: stringMap(value.headers) } : {}),
  };
};

const draftFrom = (value: unknown, partial = false): Partial<McpServerDraft> => {
  if (!isRecord(value)) throw new Error('INVALID_REQUEST');
  const draft: Partial<McpServerDraft> = {};
  if (value.name !== undefined) {
    if (typeof value.name !== 'string' || value.name.trim().length === 0) throw new Error('INVALID_REQUEST');
    draft.name = value.name;
  }
  if (value.description !== undefined) {
    if (typeof value.description !== 'string') throw new Error('INVALID_REQUEST');
    draft.description = value.description;
  }
  if (value.transport !== undefined) draft.transport = transportFrom(value.transport);
  if (value.original_json !== undefined) {
    if (typeof value.original_json !== 'string') throw new Error('INVALID_REQUEST');
    draft.original_json = value.original_json;
  }
  if (value.builtin !== undefined) {
    if (typeof value.builtin !== 'boolean') throw new Error('INVALID_REQUEST');
    draft.builtin = value.builtin;
  }
  if (!partial && (!draft.name || !draft.transport)) throw new Error('INVALID_REQUEST');
  if (!partial && !draft.original_json) {
    draft.original_json = JSON.stringify({ mcpServers: { [draft.name as string]: draft.transport } }, null, 2);
  }
  if (partial && Object.keys(draft).length === 0) throw new Error('INVALID_REQUEST');
  return draft;
};

const importFrom = (value: unknown): McpServerImport => {
  const draft = draftFrom(value) as McpServerDraft;
  if (!isRecord(value)) throw new Error('INVALID_REQUEST');
  return {
    ...draft,
    ...(typeof value.id === 'string' ? { id: value.id } : {}),
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
    ...(typeof value.created_at === 'number' && Number.isFinite(value.created_at)
      ? { created_at: value.created_at }
      : {}),
  };
};

const serverUrlFrom = (value: unknown): string => {
  if (!isRecord(value) || typeof value.server_url !== 'string') throw new Error('INVALID_REQUEST');
  const url = new URL(value.server_url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('INVALID_REQUEST');
  return url.toString();
};

const requireExisting = async (service: TomniGatewayMcpService, id: string): Promise<IMcpServer> => {
  const server = await service.get(id);
  if (!server) throw new Error('MCP_NOT_FOUND');
  return server;
};

const publicDiscovery = (groups: Awaited<ReturnType<TomniGatewayMcpService['discover']>>): unknown =>
  groups.map((group) => ({ ...group, servers: group.servers.map(publicServer) }));

const methodFailure = (respond: McpRouteResponder, methods: string[]): true => {
  respond.failure(405, 'METHOD_NOT_ALLOWED', `Allowed methods: ${methods.join(', ')}.`);
  return true;
};

export const handleMcpRoute = async ({ request, url, service, respond }: McpRouteRequest): Promise<boolean> => {
  if (url.pathname !== '/api/v1/mcp' && !url.pathname.startsWith('/api/v1/mcp/')) return false;
  const method = request.method ?? 'GET';
  const segments = url.pathname.split('/').filter(Boolean).slice(3).map(decodeURIComponent);

  try {
    if (segments.length === 0) {
      if (method === 'GET') respond.success((await service.list()).map(publicServer));
      else if (method === 'POST')
        respond.success(
          publicServer(await service.create(draftFrom(await readJsonBody(request)) as McpServerDraft)),
          201
        );
      else return methodFailure(respond, ['GET', 'POST']);
      return true;
    }

    if (segments[0] === 'import' && segments.length === 1) {
      if (method !== 'POST') return methodFailure(respond, ['POST']);
      const body = await readJsonBody(request);
      if (!Array.isArray(body.servers)) throw new Error('INVALID_REQUEST');
      respond.success((await service.importMany(body.servers.map(importFrom))).map(publicServer));
      return true;
    }

    if (segments[0] === 'agent-configs' && segments.length === 1) {
      if (method !== 'GET') return methodFailure(respond, ['GET']);
      respond.success(publicDiscovery(await service.discover()));
      return true;
    }

    if (segments[0] === 'oauth') {
      if (segments[1] === 'authenticated' && segments.length === 2) {
        if (method !== 'GET') return methodFailure(respond, ['GET']);
        respond.success({ server_urls: await service.oauth.authenticated() });
        return true;
      }
      if (!['status', 'login', 'logout'].includes(segments[1] ?? '') || segments.length !== 2) {
        respond.failure(404, 'NOT_FOUND', 'MCP route not found.');
        return true;
      }
      if (method !== 'POST') return methodFailure(respond, ['POST']);
      const serverUrl = serverUrlFrom(await readJsonBody(request));
      if (segments[1] === 'status') respond.success(await service.oauth.status(serverUrl));
      else if (segments[1] === 'login') {
        const result = await service.oauth.login(serverUrl);
        respond.success(
          result.success ? result : { success: false, error: redactText(result.error ?? 'OAuth login failed.') }
        );
      } else {
        await service.oauth.logout(serverUrl);
        respond.success({ success: true });
      }
      return true;
    }

    const id = segments[0];
    if (!id) {
      respond.failure(404, 'NOT_FOUND', 'MCP route not found.');
      return true;
    }
    if (segments.length === 1) {
      if (method === 'GET') respond.success(publicServer(await requireExisting(service, id)));
      else if (method === 'PATCH') {
        await requireExisting(service, id);
        respond.success(publicServer(await service.update(id, draftFrom(await readJsonBody(request), true))));
      } else if (method === 'DELETE') {
        await requireExisting(service, id);
        await service.remove(id);
        respond.success({ deleted: true });
      } else return methodFailure(respond, ['GET', 'PATCH', 'DELETE']);
      return true;
    }

    if (segments.length === 2 && segments[1] === 'toggle') {
      if (method !== 'POST') return methodFailure(respond, ['POST']);
      await requireExisting(service, id);
      respond.success(publicServer(await service.toggle(id)));
      return true;
    }

    if (segments.length === 2 && segments[1] === 'test') {
      if (method !== 'POST') return methodFailure(respond, ['POST']);
      const server = await requireExisting(service, id);
      const testedAt = Date.now();
      const result = await service.test(server);
      const persisted = await service.recordTest(id, { ...result, testedAt });
      respond.success({
        ...result,
        ...(result.tools ? { tools: redactUnknown(result.tools) } : {}),
        ...(result.error ? { error: redactText(result.error) } : {}),
        server: publicServer(persisted),
      });
      return true;
    }

    respond.failure(404, 'NOT_FOUND', 'MCP route not found.');
    return true;
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    if (code === 'REQUEST_TOO_LARGE') respond.failure(413, code, 'JSON request body exceeds 64 KiB.');
    else if (['INVALID_JSON', 'INVALID_REQUEST', 'INVALID_TRANSPORT'].includes(code)) {
      respond.failure(400, 'INVALID_REQUEST', 'The MCP request body is invalid.');
    } else if (code === 'MCP_NOT_FOUND') respond.failure(404, 'NOT_FOUND', 'MCP server not found.');
    else if (/already exists/iu.test(code))
      respond.failure(409, 'CONFLICT', 'An MCP server with that name already exists.');
    else respond.failure(500, 'MCP_OPERATION_FAILED', 'The Tomni MCP service could not complete the request.');
    return true;
  }
};
