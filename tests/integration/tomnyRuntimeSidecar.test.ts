/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { RustSidecarClient } from '../../packages/desktop/src/process/experimentalCore/adapters/sidecar';
import type { SidecarRemoteError } from '../../packages/desktop/src/process/experimentalCore/adapters/sidecar';

const repoRoot = resolve(__dirname, '../..');
const manifestPath = join(repoRoot, 'packages/tomny-runtime/Cargo.toml');
const binaryPath = join(
  repoRoot,
  'packages/tomny-runtime/target/debug',
  process.platform === 'win32' ? 'tomny-runtime.exe' : 'tomny-runtime'
);

beforeAll(() => {
  execFileSync('cargo', ['build', '--manifest-path', manifestPath], { cwd: repoRoot, stdio: 'pipe' });
}, 180_000);

const createClient = (): RustSidecarClient =>
  new RustSidecarClient({
    command: binaryPath,
    args: ['--data-dir', mkdtempSync(join(tmpdir(), 'tomny-runtime-data-'))],
    startupTimeoutMs: 5_000,
    requestTimeoutMs: 5_000,
  });

type Frame = {
  protocol: string;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
};

const collectFrames = (child: ChildProcessWithoutNullStreams, count: number): Promise<Frame[]> =>
  new Promise((resolveFrames, reject) => {
    const frames: Frame[] = [];
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${String(count)} runtime frames`)), 5_000);
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) frames.push(JSON.parse(line) as Frame);
        if (frames.length === count) {
          clearTimeout(timer);
          resolveFrames(frames);
          return;
        }
        newline = buffer.indexOf('\n');
      }
    });
    child.once('error', reject);
  });

describe('Tomny Runtime sidecar acceptance', () => {
  it('negotiates protocol v1 and executes native hashing', async () => {
    const client = createClient();
    try {
      const initialized = await client.start();
      expect(initialized).toMatchObject({ protocol: 'tomny.runtime.v1', protocolVersion: 1 });

      const result = await client.request<{ algorithm: string; digest: string }>('hash.sha256', {
        bytesBase64: Buffer.from('Tomny').toString('base64'),
      });
      expect(result).toEqual({
        algorithm: 'sha256',
        digest: '3835fb5484df4943cce3a45afeaf70ca810e51b559f2a4320a2a878b778bb7a5',
      });
    } finally {
      await client.stop();
    }
  });

  it('fails unknown methods without poisoning the running session', async () => {
    const client = createClient();
    try {
      await expect(client.request('missing.method')).rejects.toMatchObject<Partial<SidecarRemoteError>>({
        name: 'SidecarRemoteError',
        code: 'METHOD_NOT_FOUND',
      });
      await expect(client.request<{ status: string }>('health.check')).resolves.toMatchObject({ status: 'healthy' });
    } finally {
      await client.stop();
    }
  });

  it('survives a malformed frame and accepts the following initialize request', async () => {
    const child = spawn(binaryPath, ['--data-dir', mkdtempSync(join(tmpdir(), 'tomny-runtime-raw-'))], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    try {
      const framesPromise = collectFrames(child, 2);
      child.stdin.write('{not-json}\n');
      child.stdin.write(
        `${JSON.stringify({
          protocol: 'tomny.runtime.v1',
          id: 'initialize-after-error',
          method: 'core.initialize',
          params: {
            protocol: 'tomny.runtime.v1',
            minimumProtocolVersion: 1,
            maximumProtocolVersion: 1,
            clientVersion: 'acceptance-test',
          },
        })}\n`
      );
      const [malformed, initialized] = await framesPromise;
      expect(malformed).toMatchObject({ id: 'invalid', ok: false, error: { code: 'INVALID_REQUEST' } });
      expect(initialized).toMatchObject({ id: 'initialize-after-error', ok: true });
    } finally {
      child.kill('SIGTERM');
    }
  });
});
