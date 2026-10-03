/** Web-host integration coverage using a dev-only backend mock. */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startWebHost, type WebHostHandle } from '../src/index.js';
import { startMockBackend, type MockBackend } from './fixtures/mock-backend.js';

let host: WebHostHandle | undefined;
let backend: MockBackend | undefined;
let staticDir: string | undefined;

afterEach(async () => {
  await host?.stop();
  await backend?.close();
  if (staticDir) await rm(staticDir, { recursive: true, force: true });
  host = undefined;
  backend = undefined;
  staticDir = undefined;
});

describe('web-host mock backend integration', () => {
  it('serves the browser shell and forwards a chat API request to the dev-only backend', async () => {
    staticDir = await mkdtemp(path.join(os.tmpdir(), 'tomny-web-host-'));
    await writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>Tomny Web</title>');
    backend = await startMockBackend();
    host = await startWebHost({
      app: {
        version: 'test',
        isPackaged: false,
        resourcesPath: staticDir,
        userDataPath: staticDir,
      },
      staticDir,
      port: 0,
      backend: { kind: 'useExistingBackend', port: backend.port },
    });

    const shell = await fetch(`${host.localUrl}/chat/demo`);
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain('<title>Tomny Web</title>');

    const response = await fetch(`${host.localUrl}/api/conversations/demo/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'demo message' }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(backend.received).toHaveLength(1);
    expect(backend.received[0]).toMatchObject({
      method: 'POST',
      url: '/api/conversations/demo/messages',
    });
    expect(backend.received[0].body.toString('utf8')).toBe('{"input":"demo message"}');
  });
});
