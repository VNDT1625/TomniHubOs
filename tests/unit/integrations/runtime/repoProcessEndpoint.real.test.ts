import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startRepoProcessEndpoint } from '@process/integrations/runtime/repoProcessEndpoint';
import { createNodeRepoProcessPorts } from '@process/integrations/runtime/repoProcessNodePorts';
import { RepoProcessError } from '@process/integrations/runtime/repoProcessPorts';
import { cleanPackages, makePackage, service, specFor } from './repoProcessHarness';

afterEach(cleanPackages);

const SERVER = `
const net = require('node:net');
const { spawn } = require('node:child_process');
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
console.log('GRANDCHILD=' + grandchild.pid);
console.log('KEYS=' + Object.keys(process.env).join(','));
console.log('SECRET=' + (process.env.DB_PASSWORD || ''));
net.createServer().listen(Number(process.env.PORT), process.env.HOST);
setInterval(() => {}, 1000);
`;

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitDead = async (pid: number): Promise<boolean> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!alive(pid)) return true;
    // oxlint-disable-next-line no-await-in-loop -- polling the OS for process exit
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};

const realPorts = () =>
  createNodeRepoProcessPorts({
    resolveSecret: (name) => Promise.resolve(name === 'DB_PASSWORD' ? 'real-secret-value' : undefined),
    setupMarkers: { has: () => Promise.resolve(false), mark: () => Promise.resolve() },
  });

describe('RepoProcessEndpoint with real child processes', () => {
  it('starts a server, hides host secrets, and kills the whole tree on stop', async () => {
    process.env['GITHUB_TOKEN'] = 'host-token-must-not-leak';
    const dir = await makePackage([]);
    await mkdir(path.join(dir, 'source', 'api'), { recursive: true });
    await writeFile(path.join(dir, 'source', 'api', 'server.js'), SERVER);
    const port = await freePort();
    const endpoint = await startRepoProcessEndpoint(
      { ports: realPorts(), readyTimeoutMs: 30_000 },
      specFor(dir, [service('api', port, { env: [{ name: 'DB_PASSWORD', required: true }] })])
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const text = endpoint
        .logs('api')
        .map((line) => line.text)
        .join('\n');
      const keys = /KEYS=(.*)/u.exec(text)?.[1] ?? '';
      expect(keys).toContain('PORT');
      expect(keys).toContain('DB_PASSWORD');
      expect(keys).not.toContain('GITHUB_TOKEN');
      expect(text).not.toContain('real-secret-value');
      expect(text).not.toContain('host-token-must-not-leak');
      const grandchild = Number(/GRANDCHILD=(\d+)/u.exec(text)?.[1]);
      expect(grandchild).toBeGreaterThan(0);
      expect(alive(grandchild)).toBe(true);
      await endpoint.stop();
      expect(await waitDead(grandchild)).toBe(true);
    } finally {
      await endpoint.stop();
      delete process.env['GITHUB_TOKEN'];
    }
  }, 60_000);

  it('reports PORT_IN_USE when something already listens on the port', async () => {
    const dir = await makePackage(['api']);
    const blocker = net.createServer();
    const port = await new Promise<number>((resolve) => {
      blocker.listen(0, '127.0.0.1', () => resolve((blocker.address() as net.AddressInfo).port));
    });
    try {
      const failure = await startRepoProcessEndpoint({ ports: realPorts() }, specFor(dir, [service('api', port)])).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(failure).toBeInstanceOf(RepoProcessError);
      expect((failure as RepoProcessError).code).toBe('PORT_IN_USE');
    } finally {
      blocker.close();
    }
  }, 30_000);
});
