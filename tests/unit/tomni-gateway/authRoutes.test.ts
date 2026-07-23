import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startTomniGateway, type TomniGatewayCollection, type TomniGatewayServer } from '@process/tomnigateway';
import { TomniWebAuth } from '@process/tomnigateway/webAuth';

const TOKEN = 'tomni-auth-route-test-token';
const servers: TomniGatewayServer[] = [];
const directories: string[] = [];
const collection: TomniGatewayCollection = {
  list: async () => [],
  get: async () => undefined,
};

const harness = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tomni-auth-route-'));
  directories.push(directory);
  const webAuth = new TomniWebAuth(directory);
  const speechTranscribe = vi.fn(async () => ({ text: 'hello', provider: 'test' }));
  const server = await startTomniGateway({
    auth: { sessionTokens: [TOKEN], allowedOrigins: [], allowMissingOrigin: true },
    webAuth,
    services: {
      collections: {
        conversations: collection,
        teams: collection,
        companies: collection,
        cron: collection,
        mcp: collection,
      },
      conversationMessages: async () => [],
      speechTranscribe,
    },
  });
  servers.push(server);
  return { server, webAuth, speechTranscribe };
};

const gatewayFetch = (server: TomniGatewayServer, route: string, init?: RequestInit): Promise<Response> =>
  fetch(server.url + route, {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${TOKEN}` },
  });

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Tomni gateway WebUI auth routes', () => {
  it('seeds credentials internally, logs in, verifies the cookie, and logs out', async () => {
    const { server } = await harness();
    const reset = await gatewayFetch(server, '/api/webui/reset-password', {
      method: 'POST',
      headers: { 'x-tomni-internal': '1' },
    });
    const password = ((await reset.json()) as { data: { new_password: string } }).data.new_password;

    const login = await gatewayFetch(server, '/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password, remember: false }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie');
    expect(cookie).toContain('tomni_session=');
    expect(cookie).toContain('HttpOnly');

    const current = await gatewayFetch(server, '/api/auth/user', { headers: { cookie: cookie!.split(';')[0] } });
    expect(await current.json()).toEqual({ success: true, user: { id: 'tomni-admin', username: 'admin' } });

    const logout = await gatewayFetch(server, '/logout', {
      method: 'POST',
      headers: { cookie: cookie!.split(';')[0] },
    });
    expect(logout.status).toBe(200);
    const rejected = await gatewayFetch(server, '/api/auth/user', { headers: { cookie: cookie!.split(';')[0] } });
    expect(rejected.status).toBe(401);
  });

  it('accepts authenticated audio multipart and rejects unsupported media', async () => {
    const { server, webAuth, speechTranscribe } = await harness();
    const password = await webAuth.resetPassword();
    const login = await webAuth.login('test', 'admin', password, false);
    if (!login.ok) throw new Error('login failed');

    const valid = new FormData();
    valid.append('audio', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), 'voice.webm');
    valid.append('mimeType', 'audio/webm');
    const response = await gatewayFetch(server, '/api/stt', {
      method: 'POST',
      headers: { cookie: `tomni_session=${encodeURIComponent(login.token)}` },
      body: valid,
    });

    expect(response.status).toBe(200);
    expect(speechTranscribe).toHaveBeenCalledWith(
      expect.objectContaining({ file_name: 'voice.webm', mimeType: 'audio/webm', audioBuffer: expect.any(Uint8Array) })
    );

    const invalid = new FormData();
    invalid.append('audio', new Blob([new Uint8Array([1])], { type: 'text/plain' }), 'voice.txt');
    invalid.append('mimeType', 'text/plain');
    const unsupported = await gatewayFetch(server, '/api/stt', {
      method: 'POST',
      headers: { cookie: `tomni_session=${encodeURIComponent(login.token)}` },
      body: invalid,
    });
    expect(unsupported.status).toBe(415);
  });
});
