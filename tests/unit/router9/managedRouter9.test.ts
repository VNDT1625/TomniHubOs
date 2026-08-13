import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  BrowserWindow: class {
    webContents = {
      session: { cookies: { set: vi.fn(async () => undefined) } },
      setWindowOpenHandler: vi.fn(),
    };
    isDestroyed = vi.fn(() => false);
    loadURL = vi.fn(async () => undefined);
    show = vi.fn();
    focus = vi.fn();
    close = vi.fn();
    on = vi.fn();
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
  shell: { openExternal: vi.fn(async () => undefined) },
}));

import { ManagedRouter9Service } from '@process/router9/managedRouter9';

const tempDirs: string[] = [];

const tempDir = async (): Promise<string> => {
  const value = await mkdtemp(path.join(os.tmpdir(), 'tomni-model-gateway-'));
  tempDirs.push(value);
  return value;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const fakeChild = (): ChildProcessWithoutNullStreams => {
  const child = new EventEmitter() as EventEmitter & Partial<ChildProcessWithoutNullStreams>;
  child.pid = 4242;
  child.killed = false;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => {
    child.killed = true;
    queueMicrotask(() => child.emit('exit', 0, null));
    return true;
  });
  child.unref = vi.fn();
  return child as ChildProcessWithoutNullStreams;
};

describe('ManagedRouter9Service', () => {
  it('reports a missing bundled runtime without mutating the filesystem', async () => {
    const root = await tempDir();
    const service = new ManagedRouter9Service({
      resourcesPath: () => path.join(root, 'resources'),
      userDataPath: () => path.join(root, 'data'),
      fetch: vi.fn(async () => new Response(null, { status: 503 })) as typeof fetch,
    });

    const status = await service.status();

    expect(status.state).toBe('stopped');
    expect(status.runtimeReady).toBe(false);
  });

  it('does not claim ownership when another compatible gateway already occupies the port', async () => {
    const root = await tempDir();
    const service = new ManagedRouter9Service({
      resourcesPath: () => path.join(root, 'resources'),
      userDataPath: () => path.join(root, 'data'),
      fetch: vi.fn(async () => Response.json({ requireLogin: true })) as typeof fetch,
    });

    const status = await service.start();

    expect(status.state).toBe('external');
    expect(status.owned).toBe(false);
  });

  it('persists auto-start without starting the runtime until startup wiring asks for it', async () => {
    const root = await tempDir();
    const deps = {
      resourcesPath: () => path.join(root, 'resources'),
      userDataPath: () => path.join(root, 'data'),
      fetch: vi.fn(async () => new Response(null, { status: 503 })) as typeof fetch,
    };
    const first = new ManagedRouter9Service(deps);

    const enabled = await first.setAutoStart(true);
    const restored = await new ManagedRouter9Service(deps).status();

    expect(enabled.autoStart).toBe(true);
    expect(restored.autoStart).toBe(true);
  });

  it('migrates legacy v1 auto-start preferences to disabled v2 preferences', async () => {
    const root = await tempDir();
    const dataDir = path.join(root, 'data', 'tomni-model-gateway');
    const preferencesPath = path.join(dataDir, 'model-gateway-preferences.json');
    await mkdir(dataDir, { recursive: true });
    await writeFile(preferencesPath, JSON.stringify({ schemaVersion: 1, autoStart: true }));
    const service = new ManagedRouter9Service({
      resourcesPath: () => path.join(root, 'resources'),
      userDataPath: () => path.join(root, 'data'),
      fetch: vi.fn(async () => new Response(null, { status: 503 })) as typeof fetch,
    });

    const status = await service.status();
    const migrated = JSON.parse(await readFile(preferencesPath, 'utf8')) as Record<string, unknown>;

    expect(status.autoStart).toBe(false);
    expect(migrated).toEqual({ schemaVersion: 2, autoStart: false });
  });

  it('reuses a compatible running gateway when persisted auto-start is enabled', async () => {
    const root = await tempDir();
    const fetchMock = vi.fn(async () => Response.json({ requireLogin: true })) as typeof fetch;
    const service = new ManagedRouter9Service({
      resourcesPath: () => path.join(root, 'resources'),
      userDataPath: () => path.join(root, 'data'),
      fetch: fetchMock,
    });
    await service.setAutoStart(true);

    const status = await service.startIfEnabled();

    expect(status).toMatchObject({ autoStart: true, state: 'external', owned: false });
  });

  it('starts the pinned runtime and issues a client-specific key', async () => {
    const root = await tempDir();
    const runtime = path.join(root, 'resources', 'bundled-model-gateway', `${process.platform}-${process.arch}`);
    await mkdir(runtime, { recursive: true });
    await writeFile(
      path.join(runtime, 'manifest.json'),
      JSON.stringify({ entry: 'custom-server.js', upstreamCommit: 'pinned', upstreamVersion: 'test' })
    );
    await writeFile(path.join(runtime, 'custom-server.js'), '');
    let spawned = false;
    const child = fakeChild();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/auth/status')) return new Response(null, { status: spawned ? 200 : 503 });
      if (url.endsWith('/api/auth/login')) {
        return Response.json({ success: true }, { headers: { 'set-cookie': 'session=test; Path=/' } });
      }
      if (url.endsWith('/api/keys') && init?.method === 'POST') {
        return Response.json({ id: 'client-1', name: 'Codex', key: 'sk-client-1', isActive: true }, { status: 201 });
      }
      if (url.endsWith('/api/keys')) return Response.json({ keys: [] });
      if (url.endsWith('/api/providers')) return Response.json({ connections: [{ id: 'p1', provider: 'openai' }] });
      if (url.endsWith('/api/usage/request-logs'))
        return Response.json(['date | model | provider | account | 1 | 2 | OK']);
      if (url.endsWith('/v1/models')) return Response.json({ data: [{ id: 'gpt-test', object: 'model' }] });
      return new Response(null, { status: 404 });
    });
    const spawnMock = vi.fn(() => {
      spawned = true;
      return child;
    });

    const stopChild = vi.fn(async () => {
      spawned = false;
      child.emit('exit', 0, null);
    });
    const service = new ManagedRouter9Service({
      resourcesPath: () => path.join(root, 'resources'),
      userDataPath: () => path.join(root, 'data'),
      execPath: () => 'electron-test',
      newSecret: () => 'test-secret-value-with-sufficient-length',
      spawn: spawnMock,

      stopChild,
      fetch: fetchMock as typeof fetch,
    });

    const status = await service.start();
    const client = await service.ensureClient('Codex');
    const providers = await service.listProviders();
    const logs = await service.listUsageLogs();
    const models = await service.listModels(client.key);
    await service.openDashboard('providers');

    const stopped = await service.stop();

    expect(status).toMatchObject({ state: 'running', owned: true, pid: 4242, upstreamCommit: 'pinned' });
    expect(spawnMock).toHaveBeenCalledWith(
      'electron-test',
      [path.join(runtime, 'custom-server.js')],
      expect.objectContaining({ detached: true, stdio: 'ignore', windowsHide: true })
    );
    expect(child.unref).not.toHaveBeenCalled();
    expect(stopChild).toHaveBeenCalledWith(child);
    expect(stopped).toMatchObject({ state: 'stopped', owned: false });
    expect(client).toMatchObject({ id: 'client-1', key: 'sk-client-1' });
    expect(providers.connections).toHaveLength(1);
    expect(logs).toHaveLength(1);
    expect(models).toEqual([{ id: 'gpt-test', object: 'model' }]);
  });

  it('waits for an in-flight start and prevents a gateway spawn after shutdown begins', async () => {
    const root = await tempDir();
    const runtime = path.join(root, 'resources', 'bundled-model-gateway', `${process.platform}-${process.arch}`);
    await mkdir(runtime, { recursive: true });
    await writeFile(path.join(runtime, 'manifest.json'), JSON.stringify({ entry: 'custom-server.js' }));
    await writeFile(path.join(runtime, 'custom-server.js'), '');

    let releaseInitialProbe: (() => void) | undefined;
    const initialProbe = new Promise<void>((resolve) => {
      releaseInitialProbe = resolve;
    });
    let probeCount = 0;
    let spawned = false;
    const child = fakeChild();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/auth/status')) {
        probeCount += 1;
        if (probeCount === 1) {
          await initialProbe;
          return new Response(null, { status: 503 });
        }
        return new Response(null, { status: spawned ? 200 : 503 });
      }
      if (url.endsWith('/api/auth/login')) {
        return Response.json({ success: true }, { headers: { 'set-cookie': 'session=test; Path=/' } });
      }
      return new Response(null, { status: 404 });
    });
    const spawnMock = vi.fn(() => {
      spawned = true;
      return child;
    });
    const stopChild = vi.fn(async () => {
      spawned = false;
      child.emit('exit', 0, null);
    });
    const service = new ManagedRouter9Service({
      resourcesPath: () => path.join(root, 'resources'),
      userDataPath: () => path.join(root, 'data'),
      execPath: () => 'electron-test',
      newSecret: () => 'test-secret-value-with-sufficient-length',
      spawn: spawnMock,
      stopChild,
      fetch: fetchMock as typeof fetch,
    });

    const startPromise = service.start();
    await vi.waitFor(() => expect(probeCount).toBe(1));
    let shutdownSettled = false;
    const shutdownPromise = service.shutdown().finally(() => {
      shutdownSettled = true;
    });
    await vi.waitFor(() => expect(probeCount).toBeGreaterThanOrEqual(2));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const settledBeforeInitialProbeFinished = shutdownSettled;
    releaseInitialProbe?.();

    const [startResult, shutdownResult] = await Promise.allSettled([startPromise, shutdownPromise]);
    expect(settledBeforeInitialProbeFinished).toBe(false);
    expect(startResult.status).toBe('rejected');
    expect(shutdownResult.status).toBe('fulfilled');
    expect(spawnMock).not.toHaveBeenCalled();
    expect(stopChild).not.toHaveBeenCalled();
  });
});
