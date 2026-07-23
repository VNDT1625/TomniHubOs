import { timingSafeEqual } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { TomniRemoteEventBroker } from './eventBroker';
import type { TomniRemoteConversationPort, TomniRemoteEvent, TomniRemoteGatewayConfig } from './types';

const MAX_BODY_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 15_000;
const NOOP = (): void => undefined;

export type TomniRemoteGatewayHost = {
  port: number;
  localUrl: string;
  snapshot: () => TomniRemoteGatewayConfig;
  configure: (updates: Partial<TomniRemoteGatewayConfig>) => void;
  close: () => Promise<void>;
};

export type StartTomniRemoteGatewayInput = {
  secret: string;
  conversations: TomniRemoteConversationPort;
  events: TomniRemoteEventBroker;
  language?: string;
  port?: number;
};

const sendJson = (res: http.ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const authorized = (req: http.IncomingMessage, expected: string): boolean => {
  const header = req.headers.authorization;
  const value =
    typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice(7).trim()
      : typeof req.headers['x-tomni-remote-secret'] === 'string'
        ? req.headers['x-tomni-remote-secret'].trim()
        : '';
  const presented = Buffer.from(value, 'utf8');
  const secret = Buffer.from(expected, 'utf8');
  return presented.length === secret.length && timingSafeEqual(presented, secret);
};

const readJson = async (req: http.IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('payload-too-large');
    chunks.push(chunk);
  }
  try {
    return chunks.length === 0 ? {} : (JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
  } catch {
    throw new Error('invalid-json');
  }
};

const positiveInt = (value: string | null, fallback: number, max: number): number => {
  const parsed = value === null ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(max, parsed) : fallback;
};

const parseConversationRoute = (pathname: string): { id: string; action: 'messages' | 'cancel' } | undefined => {
  const match = /^\/v1\/conversations\/([^/]+)\/(messages|cancel)$/u.exec(pathname);
  if (!match) return undefined;
  try {
    return { id: decodeURIComponent(match[1]), action: match[2] as 'messages' | 'cancel' };
  } catch {
    return undefined;
  }
};

const writeEvent = (res: http.ServerResponse, event: TomniRemoteEvent): boolean =>
  res.write(`id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);

/** Starts a loopback-only, bearer-protected gateway over the native conversation service. */
export const startTomniRemoteGateway = async (input: StartTomniRemoteGatewayInput): Promise<TomniRemoteGatewayHost> => {
  const config: TomniRemoteGatewayConfig = { language: input.language?.trim() || 'en-US' };
  const sockets = new Set<Socket>();
  const server = http.createServer((req, res) => {
    void (async (): Promise<void> => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, {
          ok: true,
          runtime: 'tomni-native',
          protocol: 'tomni.remote.v1',
          sequence: input.events.latestSequence(),
        });
        return;
      }
      if (!authorized(req, input.secret)) {
        res.setHeader('www-authenticate', 'Bearer realm=tomni-remote');
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/status') {
        sendJson(res, 200, { ...config, sequence: input.events.latestSequence() });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/conversations') {
        sendJson(
          res,
          200,
          await input.conversations.list(
            url.searchParams.get('cursor') ?? undefined,
            positiveInt(url.searchParams.get('limit'), 50, 200)
          )
        );
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/events') {
        const after = positiveInt(url.searchParams.get('after'), 0, Number.MAX_SAFE_INTEGER);
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-store',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        let closed = false;
        let heartbeat: NodeJS.Timeout | undefined;
        let unsubscribe = NOOP;
        const close = (): void => {
          if (closed) return;
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          unsubscribe();
        };
        unsubscribe = input.events.subscribe((event) => {
          if (!closed && !writeEvent(res, event)) {
            close();
            res.end();
          }
        });
        heartbeat = setInterval(() => res.write(': keepalive\n\n'), HEARTBEAT_MS);
        heartbeat.unref();
        req.once('close', close);
        for (const event of input.events.after(after)) {
          if (!writeEvent(res, event)) break;
        }
        return;
      }

      const route = parseConversationRoute(url.pathname);
      if (route?.action === 'messages' && req.method === 'GET') {
        sendJson(
          res,
          200,
          await input.conversations.history(
            route.id,
            positiveInt(url.searchParams.get('page'), 1, Number.MAX_SAFE_INTEGER),
            positiveInt(url.searchParams.get('page_size'), 50, 500),
            url.searchParams.get('order') ?? 'asc'
          )
        );
        return;
      }
      if (route?.action === 'messages' && req.method === 'POST') {
        const body = await readJson(req);
        if (typeof body !== 'object' || body === null || typeof (body as { input?: unknown }).input !== 'string') {
          sendJson(res, 400, { error: 'input-required' });
          return;
        }
        const message = body as { input: string; model_input?: unknown; files?: unknown };
        sendJson(
          res,
          202,
          await input.conversations.send({
            conversation_id: route.id,
            input: message.input,
            ...(typeof message.model_input === 'string' ? { model_input: message.model_input } : {}),
            ...(Array.isArray(message.files) && message.files.every((file) => typeof file === 'string')
              ? { files: message.files }
              : {}),
          })
        );
        return;
      }
      if (route?.action === 'cancel' && req.method === 'POST') {
        await input.conversations.cancel(route.id);
        sendJson(res, 200, { cancelled: true });
        return;
      }
      sendJson(res, 404, { error: 'not-found' });
    })().catch((error: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const status = message === 'payload-too-large' ? 413 : message === 'invalid-json' ? 400 : 500;
      sendJson(res, status, { error: status === 500 ? 'internal-error' : message });
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(input.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    localUrl: `http://127.0.0.1:${port}`,
    snapshot: () => ({ ...config }),
    configure: (updates) => {
      if (typeof updates.language === 'string' && updates.language.trim()) config.language = updates.language.trim();
      if (typeof updates.publicUrl === 'string' && updates.publicUrl.trim())
        config.publicUrl = updates.publicUrl.trim();
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
};
