/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { MemoryDurableEventStore } from '@process/services/agentChat/durability';
import {
  disposeMainRustSidecarLifecycle,
  getMainRustSidecarLifecycle,
  resolveRustSidecarExecutable,
  RustMirroredDurableEventStore,
  RustRuntimeAccelerator,
  RustSidecarLifecycle,
  SidecarUnavailableError,
  TOMNY_RUST_SIDECAR_PATH_ENV,
  type RustSidecarClient,
} from '@process/experimentalCore/adapters/sidecar';

const runtimeInfo = {
  protocol: 'tomny.runtime.v1' as const,
  protocolVersion: 1,
  runtimeVersion: '1.0.0',
  capabilities: ['health.check'],
};

const fakeClient = (request = vi.fn(async () => ({ status: 'healthy' }))) => {
  const client = {
    start: vi.fn(async () => runtimeInfo),
    stop: vi.fn(async () => undefined),
    request,
    getStatus: vi.fn(() => ({ state: 'ready' as const, runtime: runtimeInfo })),
  };
  return client;
};

describe('Rust sidecar executable resolver', () => {
  it('prefers an accessible explicit environment override', async () => {
    const accessFile = vi.fn(async () => undefined);
    const result = await resolveRustSidecarExecutable({
      env: { [TOMNY_RUST_SIDECAR_PATH_ENV]: 'C:\\runtime\\tomny-runtime.exe' },
      platform: 'win32',
      arch: 'x64',
      resourcesPath: 'C:\\app\\resources',
      accessFile,
    });

    expect(result).toEqual({ command: path.normalize('C:\\runtime\\tomny-runtime.exe'), source: 'environment' });
    expect(accessFile).toHaveBeenCalledOnce();
  });

  it('fails closed when an explicit override is missing instead of silently using another binary', async () => {
    const result = await resolveRustSidecarExecutable({
      env: { [TOMNY_RUST_SIDECAR_PATH_ENV]: 'C:\\missing\\tomny-runtime.exe' },
      platform: 'win32',
      arch: 'x64',
      resourcesPath: 'C:\\app\\resources',
      accessFile: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
    });

    expect(result).toBeNull();
  });

  it('resolves the packaged platform and architecture runtime', async () => {
    const result = await resolveRustSidecarExecutable({
      env: {},
      platform: 'win32',
      arch: 'arm64',
      resourcesPath: 'C:\\app\\resources',
      accessFile: vi.fn(async () => undefined),
    });

    expect(result).toEqual({
      command: path.join('C:\\app\\resources', 'bundled-tomny-runtime', 'win32-arm64', 'tomny-runtime.exe'),
      source: 'bundled',
    });
  });
});

describe('Rust sidecar Main-process lifecycle', () => {
  it('shares one initialization across concurrent callers and reports health', async () => {
    const client = fakeClient();
    const lifecycle = new RustSidecarLifecycle(
      { clientVersion: '1.0.0', env: {} },
      {
        resolveExecutable: vi.fn(async () => ({ command: 'runtime', source: 'bundled' })),
        createClient: () => client as unknown as RustSidecarClient,
      }
    );

    await Promise.all([lifecycle.start(), lifecycle.start(), lifecycle.start()]);
    await expect(lifecycle.health()).resolves.toMatchObject({ status: 'pass', runtimeVersion: '1.0.0' });
    expect(client.start).toHaveBeenCalledOnce();
  });

  it('uses the required explicit fallback when no runtime is installed', async () => {
    const lifecycle = new RustSidecarLifecycle(
      { clientVersion: '1.0.0', env: {}, fallbackMode: 'typescript' },
      { resolveExecutable: vi.fn(async () => null) }
    );
    const fallback = vi.fn(async () => 'typescript');

    await expect(lifecycle.requestWithFallback('health.check', {}, fallback)).resolves.toMatchObject({
      source: 'typescript',
      value: 'typescript',
    });
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('does not fall back when configuration requires Rust', async () => {
    const lifecycle = new RustSidecarLifecycle(
      { clientVersion: '1.0.0', env: {}, fallbackMode: 'disabled' },
      { resolveExecutable: vi.fn(async () => null) }
    );

    await expect(lifecycle.requestWithFallback('health.check', {}, async () => 'hidden')).rejects.toBeInstanceOf(
      SidecarUnavailableError
    );
    await expect(lifecycle.health()).resolves.toMatchObject({ status: 'error' });
  });

  it('keeps a singleton for the Electron Main-process lifetime and disposes it once', async () => {
    await disposeMainRustSidecarLifecycle();
    const client = fakeClient();
    const first = getMainRustSidecarLifecycle(
      { clientVersion: '1.0.0', env: {} },
      {
        resolveExecutable: vi.fn(async () => ({ command: 'runtime', source: 'bundled' })),
        createClient: () => client as unknown as RustSidecarClient,
      }
    );
    const second = getMainRustSidecarLifecycle({ clientVersion: 'ignored', env: {} });

    expect(second).toBe(first);
    await first.start();
    await disposeMainRustSidecarLifecycle();
    expect(client.stop).toHaveBeenCalledOnce();
  });
});

describe('safe Rust acceleration', () => {
  it('hashes through Rust and retains an explicit TypeScript implementation', async () => {
    const lifecycle = {
      requestWithFallback: vi.fn(async () => ({
        source: 'rust' as const,
        value: { algorithm: 'sha256' as const, digest: 'rust-digest' },
      })),
    } as unknown as RustSidecarLifecycle;

    await expect(new RustRuntimeAccelerator(lifecycle).sha256Bytes(new Uint8Array([1, 2, 3]))).resolves.toBe(
      'rust-digest'
    );
    expect(lifecycle.requestWithFallback).toHaveBeenCalledWith(
      'hash.sha256',
      { bytesBase64: 'AQID' },
      expect.any(Function)
    );
  });

  it('keeps the TypeScript journal authoritative and mirrors only metadata events', async () => {
    const primary = new MemoryDurableEventStore();
    const request = vi.fn(async () => ({ event: {} }));
    const lifecycle = { request } as unknown as RustSidecarLifecycle;
    const store = new RustMirroredDurableEventStore(primary, lifecycle);
    await store.initialize();

    const event = await store.append({
      sessionId: 'session-1',
      kind: 'run.started',
      visibility: 'private',
      payload: { state: 'started' },
    });
    await store.append({
      sessionId: 'session-1',
      kind: 'run.delta',
      visibility: 'private',
      payload: { text: 'not mirrored' },
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());

    expect(await store.query()).toHaveLength(2);
    expect(request).toHaveBeenCalledWith('journal.append', {
      stream: 'session-1',
      kind: 'run.started',
      payload: event,
    });
  });
});
