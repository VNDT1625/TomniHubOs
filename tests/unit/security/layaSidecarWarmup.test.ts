/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { LayaSidecarClient } from '@process/services/security/layaSidecarClient';

/** Ready quickly, but the first request it answers takes a long time, like a model that has not warmed up. */
const COLD_MODEL = String.raw`
let first = true;
setTimeout(() => process.stdout.write(JSON.stringify({ status: 'ready' }) + String.fromCharCode(10)), 50);
process.stdin.on('data', (chunk) => {
  for (const line of String(chunk).split(String.fromCharCode(10)).filter(Boolean)) {
    const request = JSON.parse(line);
    const answer = () => process.stdout.write(JSON.stringify({ id: request.id, status: 'ok', answers: {} }) + String.fromCharCode(10));
    if (first) { first = false; setTimeout(answer, 500); } else answer();
  }
});
`;

describe('LayaSidecarClient warm-up', () => {
  const clients: LayaSidecarClient[] = [];
  const folders: string[] = [];

  afterEach(() => {
    for (const client of clients.splice(0)) client.stop();
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  const coldClient = (): LayaSidecarClient => {
    const folder = mkdtempSync(path.join(tmpdir(), 'laya-warmup-'));
    folders.push(folder);
    const scriptPath = path.join(folder, 'cold.js');
    writeFileSync(scriptPath, COLD_MODEL);
    const client = new LayaSidecarClient({ pythonPath: process.execPath, scriptPath, startupTimeoutMs: 20_000 });
    clients.push(client);
    return client;
  };

  it('without a warm-up the first real request pays for it', async () => {
    const client = coldClient();
    await client.start();
    const started = Date.now();
    await client.predict({ body: 'hello' }, {});
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
  });

  it('answers a warm-up request before reporting ready, so the first real request is fast', async () => {
    const client = coldClient();
    client.setWarmup({ body: 'warm up' }, {});

    const startBegan = Date.now();
    await client.start();
    expect(client.ready).toBe(true);
    expect(Date.now() - startBegan).toBeGreaterThanOrEqual(400);

    const started = Date.now();
    await client.predict({ body: 'hello' }, {});
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('is not ready while the warm-up is still running', async () => {
    const client = coldClient();
    client.setWarmup({ body: 'warm up' }, {});
    const starting = client.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(client.ready).toBe(false);
    await starting;
    expect(client.ready).toBe(true);
  });
});
