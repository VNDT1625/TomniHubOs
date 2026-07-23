/**
 * @license
 * Copyright 2025 Tomni
 * SPDX-License-Identifier: Apache-2.0
 */

import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { assertValidGatewayAuth, authorizeWebSocketProtocols, isHttpAuthorized, isOriginAllowed } from './auth';
import { handleMcpRoute } from './mcpRoutes';
import {
  TOMNI_GATEWAY_PROTOCOL,
  type TomniGatewayCollectionName,
  type TomniGatewayEvent,
  type TomniGatewayOptions,
} from './types';

const COLLECTIONS = new Set<TomniGatewayCollectionName>(['conversations', 'teams', 'companies', 'cron', 'mcp']);
const API_PREFIX = '/api/v1';
const WS_PATH = '/ws/v1';
const WS_PATHS = new Set(['/ws', WS_PATH]);

export type TomniGatewayServer = {
  url: string;
  wsUrl: string;
  port: number;
  clientCount: () => number;
  close: () => Promise<void>;
};

type JsonEnvelope = {
  protocol: typeof TOMNI_GATEWAY_PROTOCOL;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
};

const reply = (response: ServerResponse, status: number, body: JsonEnvelope, origin?: string): void => {
  response
    .writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
    })
    .end(JSON.stringify(body));
};

const success = (response: ServerResponse, data: unknown, origin?: string): void =>
  reply(response, 200, { protocol: TOMNI_GATEWAY_PROTOCOL, ok: true, data }, origin);

const failure = (response: ServerResponse, status: number, code: string, message: string, origin?: string): void =>
  reply(response, status, { protocol: TOMNI_GATEWAY_PROTOCOL, ok: false, error: { code, message } }, origin);

const queryRecord = (url: URL): Readonly<Record<string, string>> => Object.fromEntries(url.searchParams.entries());

const decodedSegment = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length > 0 ? decoded : undefined;
  } catch {
    return undefined;
  }
};

const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 64 * 1024) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(bytes);
  }
  if (chunks.length === 0) return {};
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_JSON');
  return value as Record<string, unknown>;
};

const sessionToken = (request: IncomingMessage): string | undefined => {
  const cookie = request.headers.cookie;
  if (!cookie) return undefined;
  for (const part of cookie.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === 'tomni_session') return decodeURIComponent(value.join('='));
  }
  return undefined;
};

const webAuthReply = (response: ServerResponse, status: number, body: unknown): void => {
  response
    .writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    .end(JSON.stringify(body));
};

const MAX_STT_BYTES = 30 * 1024 * 1024;
const STT_MIME_TYPES = new Set([
  'audio/aac',
  'audio/flac',
  'audio/m4a',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
  'audio/x-wav',
]);

const readBytes = async (request: IncomingMessage, limit: number): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new Error('STT_FILE_TOO_LARGE');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
};

const readSttMultipart = async (
  request: IncomingMessage
): Promise<{ audioBuffer: Uint8Array; file_name: string; mimeType: string; languageHint?: string }> => {
  const contentType = request.headers['content-type'] ?? '';
  const boundary = /boundary=(?:([^]+)|([^;]+))/iu.exec(contentType)?.slice(1).find(Boolean)?.trim();
  if (!contentType.toLowerCase().startsWith('multipart/form-data') || !boundary || boundary.length > 200) {
    throw new Error('STT_INVALID_MULTIPART');
  }
  const raw = await readBytes(request, MAX_STT_BYTES + 64 * 1024);
  const parts = raw.toString('latin1').split(`--${boundary}`);
  let audio: Buffer | undefined;
  let fileName = 'speech-input.webm';
  let partMime = '';
  let requestedMime = '';
  let languageHint: string | undefined;
  for (const part of parts) {
    const separator = part.indexOf('\r\n\r\n');
    if (separator < 0) continue;
    const headers = part.slice(0, separator);
    let value = part.slice(separator + 4);
    if (value.endsWith('\r\n')) value = value.slice(0, -2);
    const disposition =
      /content-disposition:\s*form-data;\s*name=\x22([^\x22]+)\x22(?:;\s*filename=\x22([^\x22]*)\x22)?/iu.exec(headers);

    const name = disposition?.[1];
    if (!name) continue;
    if (name === 'audio') {
      audio = Buffer.from(value, 'latin1');
      fileName = path.basename(disposition?.[2] || fileName);
      partMime = /content-type:\s*([^\r\n;]+)/iu.exec(headers)?.[1]?.trim().toLowerCase() ?? '';
    } else if (name === 'mimeType') {
      requestedMime = value.trim().toLowerCase();
    } else if (name === 'languageHint') {
      languageHint = value.trim().slice(0, 32) || undefined;
    }
  }
  if (!audio || audio.byteLength === 0) throw new Error('STT_EMPTY_AUDIO');
  if (audio.byteLength > MAX_STT_BYTES) throw new Error('STT_FILE_TOO_LARGE');
  const mimeType = requestedMime || partMime;
  if (!STT_MIME_TYPES.has(mimeType)) throw new Error('STT_UNSUPPORTED_MEDIA_TYPE');
  return { audioBuffer: Uint8Array.from(audio), file_name: fileName, mimeType, languageHint };
};

const eventEnvelope = (event: TomniGatewayEvent): string =>
  JSON.stringify({
    protocol: TOMNI_GATEWAY_PROTOCOL,
    type: 'event',
    topic: event.topic,
    timestamp: event.timestamp ?? Date.now(),
    data: event.data,
  });

export const startTomniGateway = async (options: TomniGatewayOptions): Promise<TomniGatewayServer> => {
  assertValidGatewayAuth(options.auth);
  const maxBufferBytes = options.maxWebSocketBufferBytes ?? 1_000_000;
  if (!Number.isSafeInteger(maxBufferBytes) || maxBufferBytes < 1) {
    throw new Error('[TomniGateway] maxWebSocketBufferBytes must be a positive safe integer.');
  }

  const requestHandler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
    if (!isOriginAllowed(origin, options.auth)) {
      failure(response, 403, 'ORIGIN_DENIED', 'Origin is not allowed.');
      return;
    }

    if (request.method === 'OPTIONS') {
      response
        .writeHead(204, {
          ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        })
        .end();
      return;
    }

    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method ?? '')) {
      failure(response, 405, 'METHOD_NOT_ALLOWED', 'HTTP method is not available.', origin);
      return;
    }

    if (url.pathname === `${API_PREFIX}/health`) {
      success(response, { status: 'ok' }, origin);
      return;
    }

    if (!isHttpAuthorized(request.headers, options.auth)) {
      response.setHeader('www-authenticate', 'Bearer');
      failure(response, 401, 'UNAUTHORIZED', 'A valid Tomni session token is required.', origin);
      return;
    }

    if (options.webAuth && url.pathname === '/api/auth/status' && request.method === 'GET') {
      const status = await options.webAuth.status();
      success(response, status, origin);
      return;
    }

    if (options.webAuth && url.pathname === '/login' && request.method === 'POST') {
      try {
        const body = await readJsonBody(request);
        const result = await options.webAuth.login(
          request.socket.remoteAddress ?? 'unknown',
          typeof body.username === 'string' ? body.username : '',
          typeof body.password === 'string' ? body.password : '',
          body.remember === true
        );
        if ('status' in result) {
          if (result.retryAfterSeconds) response.setHeader('retry-after', String(result.retryAfterSeconds));
          webAuthReply(response, result.status, {
            success: false,
            message: result.status === 429 ? 'Too many attempts.' : 'Invalid credentials.',
          });
          return;
        }
        const maxAge = Math.max(0, Math.floor((result.expiresAt - Date.now()) / 1_000));
        response.setHeader(
          'set-cookie',
          `tomni_session=${encodeURIComponent(result.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`
        );
        webAuthReply(response, 200, { success: true, user: result.user });
      } catch {
        webAuthReply(response, 400, { success: false, message: 'Invalid request.' });
      }
      return;
    }

    const authSessionToken = sessionToken(request);
    const authUser = options.webAuth ? await options.webAuth.verify(authSessionToken) : undefined;

    if (url.pathname === '/api/stt' && request.method === 'POST') {
      if (!authUser) {
        webAuthReply(response, 401, { success: false, msg: 'Authentication required.' });
        return;
      }
      if (!options.services.speechTranscribe) {
        webAuthReply(response, 501, { success: false, msg: 'STT_NOT_AVAILABLE' });
        return;
      }
      try {
        const speechRequest = await readSttMultipart(request);
        webAuthReply(response, 200, { success: true, data: await options.services.speechTranscribe(speechRequest) });
      } catch (error) {
        const code = (error as Error).message;
        const status = code === 'STT_FILE_TOO_LARGE' ? 413 : code === 'STT_UNSUPPORTED_MEDIA_TYPE' ? 415 : 400;
        webAuthReply(response, status, { success: false, msg: code });
      }
      return;
    }

    if (options.webAuth && url.pathname === '/api/auth/user' && request.method === 'GET') {
      if (!authUser) {
        webAuthReply(response, 401, { success: false });
        return;
      }
      webAuthReply(response, 200, { success: true, user: authUser });
      return;
    }
    if (options.webAuth && url.pathname === '/logout' && request.method === 'POST') {
      options.webAuth.logout(authSessionToken);
      response.setHeader('set-cookie', 'tomni_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      webAuthReply(response, 200, { success: true });
      return;
    }

    if (options.webAuth && url.pathname.startsWith('/api/webui/') && request.method === 'POST') {
      const internal = request.headers['x-tomni-internal'] === '1';
      if (!authUser && !internal) {
        webAuthReply(response, 401, { success: false, message: 'Authentication required.' });
        return;
      }
      try {
        const body = await readJsonBody(request);
        if (url.pathname === '/api/webui/change-password') {
          const password = typeof body.new_password === 'string' ? body.new_password : '';
          await options.webAuth.changePassword(password);
          success(response, null, origin);
          return;
        }
        if (url.pathname === '/api/webui/change-username') {
          const username = typeof body.new_username === 'string' ? body.new_username : '';
          success(response, await options.webAuth.changeUsername(username), origin);
          return;
        }
        if (url.pathname === '/api/webui/reset-password') {
          success(response, { new_password: await options.webAuth.resetPassword() }, origin);
          return;
        }
        if (url.pathname === '/api/webui/generate-qr-token') {
          success(response, await options.webAuth.generateQrToken(), origin);
          return;
        }
      } catch (error) {
        failure(response, 400, 'INVALID_REQUEST', (error as Error).message, origin);
        return;
      }
    }

    if (
      options.services.mcp &&
      (await handleMcpRoute({
        request,
        url,
        service: options.services.mcp,
        respond: {
          success: (data, status = 200) =>
            reply(response, status, { protocol: TOMNI_GATEWAY_PROTOCOL, ok: true, data }, origin),
          failure: (status, code, message) => failure(response, status, code, message, origin),
        },
      }))
    ) {
      return;
    }

    if (request.method !== 'GET') {
      failure(response, 405, 'METHOD_NOT_ALLOWED', 'Only GET is available for collection routes.', origin);
      return;
    }

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] !== 'api' || segments[1] !== 'v1') {
      failure(response, 404, 'NOT_FOUND', 'Route not found.', origin);
      return;
    }

    const collectionName = segments[2] as TomniGatewayCollectionName | undefined;
    if (!collectionName || !COLLECTIONS.has(collectionName)) {
      failure(response, 404, 'NOT_FOUND', 'Route not found.', origin);
      return;
    }

    const collection = options.services.collections[collectionName];
    const id = decodedSegment(segments[3]);
    try {
      if (!id && segments.length === 3) {
        success(response, await collection.list(queryRecord(url)), origin);
        return;
      }
      if (id && collectionName === 'conversations' && segments[4] === 'messages' && segments.length === 5) {
        success(response, await options.services.conversationMessages(id, queryRecord(url)), origin);
        return;
      }
      if (id && segments.length === 4) {
        const value = await collection.get(id);
        if (value === undefined) {
          failure(response, 404, 'NOT_FOUND', `${collectionName} resource not found.`, origin);
          return;
        }
        success(response, value, origin);
        return;
      }
      failure(response, 404, 'NOT_FOUND', 'Route not found.', origin);
    } catch {
      failure(response, 500, 'INTERNAL_ERROR', 'The Tomni service could not complete the request.', origin);
    }
  };

  const server = http.createServer((request, response) => void requestHandler(request, response));
  const webSockets = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has('tomni-v1') ? 'tomni-v1' : false),
  });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
    const protocol = authorizeWebSocketProtocols(request.headers['sec-websocket-protocol'], options.auth);
    const authorized = protocol !== undefined || isHttpAuthorized(request.headers, options.auth);
    if (!WS_PATHS.has(url.pathname) || !isOriginAllowed(origin, options.auth) || !authorized) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (protocol) request.headers['sec-websocket-protocol'] = protocol;
    webSockets.handleUpgrade(request, socket, head, (client) => webSockets.emit('connection', client, request));
  });

  webSockets.on('connection', (client) => {
    client.send(JSON.stringify({ protocol: TOMNI_GATEWAY_PROTOCOL, type: 'ready', timestamp: Date.now() }));
  });

  const unsubscribe = options.services.subscribe?.((event) => {
    const payload = eventEnvelope(event);
    for (const client of webSockets.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (client.bufferedAmount > maxBufferBytes) {
        client.close(1013, 'Client is not consuming events.');
        continue;
      }
      client.send(payload);
    }
  });

  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address() as AddressInfo;

  return {
    url: `http://${host}:${address.port}`,
    wsUrl: `ws://${host}:${address.port}${WS_PATH}`,
    port: address.port,
    clientCount: () => webSockets.clients.size,
    close: async () => {
      unsubscribe?.();
      for (const client of webSockets.clients) client.close(1001, 'Tomni gateway is shutting down.');
      await new Promise<void>((resolve) => webSockets.close(() => resolve()));
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
};
