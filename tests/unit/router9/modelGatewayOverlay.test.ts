import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { applyTomniOverlay } = require('../../../packages/shared-scripts/src/model-gateway/applyTomniOverlay.js') as {
  applyTomniOverlay: (sourceDir: string) => void;
};

const roots: string[] = [];

const fixture = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-gateway-overlay-'));
  roots.push(root);
  const files: Record<string, string> = {
    'src/lib/db/repos/usageRepo.js': [
      'stringifyJson(tokens), stringifyJson({}),',
      'SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory ${where} ORDER BY id ASC',
      'cost: r.cost, status: r.status, tokens: parseJson(r.tokens, {}),',
    ].join('\n'),
    'open-sse/handlers/chatCore/requestDetail.js': [
      'export function saveUsageStats({ provider, model, tokens, connectionId, apiKey, endpoint, label = "USAGE", silent = false }) {',
      'endpoint: endpoint || null\n  }).catch(() => {});',
    ].join('\n'),
    'open-sse/handlers/chatCore.js':
      'const sharedCtx = { provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, pxpipe: pxpipeSummary, reqTag, log };',
    'open-sse/handlers/chatCore/streamingHandler.js': [
      'clientRawRequest, pxpipe, reqTag, log }) {',
      'endpoint: clientRawRequest?.endpoint, label: "STREAM USAGE", silent: true',
    ].join('\n'),
    'open-sse/handlers/chatCore/nonStreamingHandler.js': [
      'pxpipe, reqTag, log }) {',
      'endpoint: clientRawRequest?.endpoint, silent: true',
    ].join('\n'),
    'open-sse/handlers/chatCore/sseToJsonHandler.js': [
      'appendLog, reqTag, log }) {',
      'endpoint: clientRawRequest?.endpoint, silent: true',
      'endpoint: clientRawRequest?.endpoint, silent: true',
    ].join('\n'),
  };
  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]) => {
      const destination = path.join(root, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, contents);
    })
  );
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Tomny model-gateway overlay', () => {
  it('adds session attribution, measurement provenance and the breakdown route', async () => {
    const root = await fixture();

    applyTomniOverlay(root);

    const usageRepo = await readFile(path.join(root, 'src/lib/db/repos/usageRepo.js'), 'utf8');
    const route = await readFile(path.join(root, 'src/app/api/usage/tomni-breakdown/route.js'), 'utf8');
    expect(usageRepo).toContain('stringifyJson(entry.meta || {})');
    expect(route).toContain('sessionId');
    expect(route).toContain('gateway-estimated');
  });

  it('fails closed when the pinned upstream source no longer matches', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'src/lib/db/repos/usageRepo.js'), 'upstream changed');

    expect(() => applyTomniOverlay(root)).toThrow(/expected 1 match/);
  });
});
