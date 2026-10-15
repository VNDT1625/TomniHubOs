/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createLayaPipelinePredictor, LayaSidecarClient } from '@process/services/security/layaSidecarClient';

const SLOW_SIDECAR = String.raw`
setTimeout(() => process.stdout.write(JSON.stringify({ status: 'ready' }) + '\n'), 600);
process.stdin.on('data', (chunk) => {
  for (const line of String(chunk).split('\n').filter(Boolean)) {
    const request = JSON.parse(line);
    process.stdout.write(JSON.stringify({ id: request.id, status: 'ok', answers: {} }) + '\n');
  }
});
`;

describe('createLayaPipelinePredictor', () => {
  const clients: LayaSidecarClient[] = [];
  const folders: string[] = [];

  afterEach(() => {
    for (const client of clients.splice(0)) client.stop();
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  const slowClient = (): LayaSidecarClient => {
    const folder = mkdtempSync(path.join(tmpdir(), 'laya-pipeline-'));
    folders.push(folder);
    const scriptPath = path.join(folder, 'slow.js');
    writeFileSync(scriptPath, SLOW_SIDECAR);
    const client = new LayaSidecarClient({ pythonPath: process.execPath, scriptPath, startupTimeoutMs: 20_000 });
    clients.push(client);
    return client;
  };

  it('answers "still starting" at once instead of making the stage wait for the model, and starts it', async () => {
    const client = slowClient();
    const predictor = createLayaPipelinePredictor(client);
    expect(client.ready).toBe(false);

    const started = Date.now();
    await expect(predictor({ body: 'hello' }, {})).rejects.toThrow(/still starting/u);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it('serves requests normally once the model has loaded', async () => {
    const client = slowClient();
    const predictor = createLayaPipelinePredictor(client);
    await expect(predictor({ body: 'first' }, {})).rejects.toThrow();

    // The failed call kicked off the start in the background; wait for it, then the same predictor works.
    await client.start();
    expect(client.ready).toBe(true);
    await expect(predictor({ body: 'second' }, {})).resolves.toEqual({ answers: {} });
  });
});
