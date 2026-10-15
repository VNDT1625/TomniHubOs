import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LayaSidecarClient } from '../../../packages/desktop/src/process/services/security/layaSidecarClient';

const SLOW_SIDECAR = String.raw`
setTimeout(() => process.stdout.write(JSON.stringify({ status: 'ready' }) + '\n'), 1500);
process.stdin.on('data', (chunk) => {
  for (const line of String(chunk).split('\n').filter(Boolean)) {
    const request = JSON.parse(line);
    process.stdout.write(JSON.stringify({ id: request.id, status: 'ok', answers: {} }) + '\n');
  }
});
`;

describe('LayaSidecarClient cold start', () => {
  const clients: LayaSidecarClient[] = [];
  const folders: string[] = [];

  afterEach(() => {
    for (const client of clients.splice(0)) client.stop();
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  const slowClient = (): LayaSidecarClient => {
    const folder = mkdtempSync(path.join(tmpdir(), 'laya-sidecar-'));
    folders.push(folder);
    const scriptPath = path.join(folder, 'slow.js');
    writeFileSync(scriptPath, SLOW_SIDECAR);
    const client = new LayaSidecarClient({ pythonPath: process.execPath, scriptPath, startupTimeoutMs: 20_000 });
    clients.push(client);
    return client;
  };

  it('gives up as soon as the caller aborts instead of waiting for the sidecar to finish starting', async () => {
    const client = slowClient();
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('STAGE_TIMEOUT_100MS')), 100);
    const started = Date.now();
    await expect(client.predict({ body: 'hello' }, {}, controller.signal)).rejects.toThrow(/not ready/u);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('keeps starting after a caller gave up, so the next request is served by the same process', async () => {
    const client = slowClient();
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('STAGE_TIMEOUT_100MS')), 100);
    await expect(client.predict({ body: 'hello' }, {}, controller.signal)).rejects.toThrow(/not ready/u);
    await expect(client.predict({ body: 'again' }, {})).resolves.toEqual({ answers: {} });
  });
});
