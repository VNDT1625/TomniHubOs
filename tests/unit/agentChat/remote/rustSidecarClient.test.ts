/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  RustSidecarClient,
  SidecarProtocolError,
  SidecarRemoteError,
  SidecarTimeoutError,
  SidecarUnavailableError,
  TOMNY_SIDECAR_PROTOCOL,
  type SidecarRequest,
} from '@process/experimentalCore/adapters/sidecar';

const initializeResult = {
  protocol: TOMNY_SIDECAR_PROTOCOL,
  protocolVersion: 1,
  runtimeVersion: '0.1.0',
  capabilities: ['health.check'],
};

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly requests: SidecarRequest[] = [];
  killed = false;

  constructor(private readonly handler?: (request: SidecarRequest, child: FakeChild) => void) {
    super();
    let buffer = '';
    this.stdin.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const request = JSON.parse(line) as SidecarRequest;
        this.requests.push(request);
        this.handler?.(request, this);
        newline = buffer.indexOf('\n');
      }
    });
  }

  respond(id: string, result: unknown): void {
    this.stdout.write(`${JSON.stringify({ protocol: TOMNY_SIDECAR_PROTOCOL, id, ok: true, result })}\n`);
  }

  fail(id: string, code: string, message: string): void {
    this.stdout.write(
      `${JSON.stringify({ protocol: TOMNY_SIDECAR_PROTOCOL, id, ok: false, error: { code, message } })}\n`
    );
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }

  crash(code = 1): void {
    this.emit('exit', code, null);
  }
}

const withHandshake = (handler?: (request: SidecarRequest, child: FakeChild) => void): FakeChild =>
  new FakeChild((request, child) => {
    if (request.method === 'core.initialize') {
      queueMicrotask(() => child.respond(request.id, initializeResult));
      return;
    }
    handler?.(request, child);
  });

const spawnFake = (children: FakeChild[]): typeof spawn =>
  vi.fn(() => {
    const child = children.shift();
    if (!child) throw new Error('No fake child available.');
    return child as unknown as ChildProcessWithoutNullStreams;
  }) as unknown as typeof spawn;

describe('RustSidecarClient', () => {
  it('negotiates the version and correlates concurrent responses received out of order', async () => {
    const work: SidecarRequest[] = [];
    const child = withHandshake((request) => work.push(request));
    const client = new RustSidecarClient(
      { command: 'tomny-runtime' },
      {
        spawnProcess: spawnFake([child]),
        createRequestId: (() => {
          let id = 0;
          return () => `id-${++id}`;
        })(),
      }
    );

    const first = client.request<string>('health.check', { index: 1 });
    const second = client.request<string>('hash.sha256', { index: 2 });
    await vi.waitFor(() => expect(work).toHaveLength(2));
    child.respond(work[1].id, 'second');
    child.respond(work[0].id, 'first');

    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(client.getStatus()).toEqual({ state: 'ready', runtime: initializeResult });
  });

  it('cancels a timed-out request and ignores its late response', async () => {
    const child = withHandshake();
    const client = new RustSidecarClient({ command: 'tomny-runtime' }, { spawnProcess: spawnFake([child]) });

    await expect(client.request('journal.query', {}, { timeoutMs: 5 })).rejects.toBeInstanceOf(SidecarTimeoutError);
    const work = child.requests.find((request) => request.method === 'journal.query');
    const cancel = child.requests.find((request) => request.method === 'core.cancel');
    expect(cancel?.params).toEqual({ requestId: work?.id });
    if (work) child.respond(work.id, 'late');
    expect(client.getStatus().state).toBe('ready');
  });

  it('propagates AbortSignal and sends protocol cancellation', async () => {
    const child = withHandshake();
    const client = new RustSidecarClient({ command: 'tomny-runtime' }, { spawnProcess: spawnFake([child]) });
    const controller = new AbortController();
    const request = client.request('process.spawn', {}, { signal: controller.signal });
    await vi.waitFor(() => expect(child.requests.some((item) => item.method === 'process.spawn')).toBe(true));

    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(child.requests.some((item) => item.method === 'core.cancel')).toBe(true);
  });

  it('restarts on the next request after a crash when policy is on-demand', async () => {
    const first = withHandshake();
    const second = withHandshake((request, child) => child.respond(request.id, 'healthy'));
    const spawnProcess = spawnFake([first, second]);
    const client = new RustSidecarClient({ command: 'tomny-runtime', restartPolicy: 'on-demand' }, { spawnProcess });
    await client.start();
    first.crash();

    await expect(client.request('health.check')).resolves.toBe('healthy');
    expect(spawnProcess).toHaveBeenCalledTimes(2);
  });

  it('does not restart after a crash when automatic restart is disabled', async () => {
    const child = withHandshake();
    const spawnProcess = spawnFake([child]);
    const client = new RustSidecarClient({ command: 'tomny-runtime', restartPolicy: 'never' }, { spawnProcess });
    await client.start();
    child.crash();

    await expect(client.request('health.check')).rejects.toBeInstanceOf(SidecarUnavailableError);
    expect(spawnProcess).toHaveBeenCalledTimes(1);
  });

  it('rejects and terminates a sidecar that negotiates an incompatible protocol', async () => {
    const child = new FakeChild((request, target) => {
      target.respond(request.id, { ...initializeResult, protocolVersion: 99 });
    });
    const client = new RustSidecarClient({ command: 'tomny-runtime' }, { spawnProcess: spawnFake([child]) });

    await expect(client.start()).rejects.toBeInstanceOf(SidecarProtocolError);
    expect(child.killed).toBe(true);
  });

  it('uses TypeScript fallback only when explicitly supplied for an operational failure', async () => {
    const spawnProcess = vi.fn(() => {
      throw new Error('missing binary');
    }) as unknown as typeof spawn;
    const client = new RustSidecarClient({ command: 'missing-runtime' }, { spawnProcess });
    const fallback = vi.fn(async () => 'typescript-result');

    await expect(client.requestWithFallback('health.check', {}, fallback)).resolves.toMatchObject({
      source: 'typescript',
      value: 'typescript-result',
    });
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('does not hide remote business errors behind the TypeScript fallback', async () => {
    const child = withHandshake((request, target) => target.fail(request.id, 'INVALID_INPUT', 'bad request'));
    const client = new RustSidecarClient({ command: 'tomny-runtime' }, { spawnProcess: spawnFake([child]) });
    const fallback = vi.fn(async () => 'fallback');

    await expect(client.requestWithFallback('journal.append', {}, fallback)).rejects.toBeInstanceOf(SidecarRemoteError);
    expect(fallback).not.toHaveBeenCalled();
  });
});
