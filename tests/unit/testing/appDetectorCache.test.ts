/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests the appDetector cache (Yêu cầu 2b — UX): after detecting how to run a
 * project, the result is saved to `<name>-data.json` in the testing dir; a later
 * detect for the same project reuses the JSON without calling the model. A
 * `refresh` flag forces a fresh model run + overwrites the cache.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Isolated userData dir per run so the cache file is real but disposable.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tomny-detect-cache-'));
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

const mocks = vi.hoisted(() => ({
  providerChat: vi.fn(),
  runAgentChatMessages: vi.fn(),
}));

const listReadyProviders = vi.fn();
vi.mock('@process/services/tomnyProviderBridge', () => ({
  listReadyProviders: (...args: unknown[]) => listReadyProviders(...args),
}));

vi.mock('@process/services/agentChat', () => ({
  createProviderChat: () => mocks.providerChat,
  runAgentChatMessages: (...args: unknown[]) => mocks.runAgentChatMessages(...args),
}));

import { createAppDetector } from '@/process/testing/appDetector';

const usableProvider = {
  id: 'p1',
  enabled: true,
  api_key: 'sk-test',
  base_url: 'https://api.example.com/v1',
  models: ['gpt-test'],
};

/** Configure the Main-owned broker stub to return one assistant completion. */
const stubModel = (content: string): void => {
  mocks.providerChat.mockResolvedValue(content);
};

let projectDir: string;

beforeEach(() => {
  mocks.providerChat.mockReset();
  mocks.runAgentChatMessages.mockReset();
  mocks.runAgentChatMessages.mockImplementation(
    async (
      providerRun: (model: string, messages: unknown[], signal?: AbortSignal) => Promise<string>,
      model: string,
      messages: unknown[]
    ) => providerRun(model, messages)
  );
  listReadyProviders.mockReset();
  listReadyProviders.mockResolvedValue([usableProvider]);
  // A minimal but recognizable project on disk.
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-proj-'));
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'demo', scripts: { dev: 'vite' } }));
});

describe('appDetector cache (<name>-data.json)', () => {
  it('writes <name>-data.json after the first detect, then reuses it without the model', async () => {
    stubModel('{"url":"http://localhost:5173","command":"npm run dev","cwd":"","services":[]}');
    const det = createAppDetector();

    const first = await det.detect({ projectDir });
    expect(first.url).toBe('http://localhost:5173');
    expect(mocks.providerChat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-test',
        messages: [{ role: 'user', content: expect.stringContaining('You are a build/run expert.') }],
      })
    );
    expect(mocks.runAgentChatMessages).toHaveBeenCalledWith(expect.any(Function), '', expect.any(Array), undefined, {
      workspace: projectDir,
      surface: 'ide',
      permissionMode: 'read-only',
    });

    // The cache file exists, named after the project folder.
    const name = path.basename(projectDir).replace(/[^a-zA-Z0-9._-]+/g, '-');
    const cachePath = path.join(userData, 'testing', `${name}-data.json`);
    expect(fs.existsSync(cachePath)).toBe(true);

    // A cache hit must not make a second broker call.
    mocks.providerChat.mockRejectedValue(new Error('model must not be called on cache hit'));

    const second = await det.detect({ projectDir });
    expect(second.url).toBe('http://localhost:5173');
    expect(second.command).toBe('npm run dev');
  });

  it('refresh=true bypasses the cache and re-runs the model', async () => {
    stubModel('{"url":"http://localhost:3000","command":"next dev","cwd":"","services":[]}');
    const det = createAppDetector();
    await det.detect({ projectDir });

    // A different model answer on refresh should overwrite the cache.
    stubModel('{"url":"http://localhost:4000","command":"npm start","cwd":"","services":[]}');
    const refreshed = await det.detect({ projectDir, refresh: true });
    expect(refreshed.url).toBe('http://localhost:4000');

    // And the next cache hit returns the refreshed value.
    mocks.providerChat.mockRejectedValue(new Error('should be a cache hit'));
    const cached = await det.detect({ projectDir });

    expect(cached.url).toBe('http://localhost:4000');
  });

  it('streams progress phases (reading → analyzing → parsing → done) during a fresh detect', async () => {
    stubModel('{"url":"http://localhost:5173","command":"npm run dev","cwd":"","services":[]}');
    const det = createAppDetector();

    const phases: string[] = [];
    await det.detect({ projectDir, onProgress: (p) => phases.push(p.phase) });

    // A fresh detect must reach the model and finish.
    expect(phases).toContain('reading');
    expect(phases).toContain('analyzing');
    expect(phases).toContain('parsing');
    expect(phases.at(-1)).toBe('done');
    // It read at least the package.json we wrote.
    expect(phases.indexOf('reading')).toBeGreaterThanOrEqual(0);
  });

  it('emits cache + done phases (no analyzing) on a cache hit', async () => {
    stubModel('{"url":"http://localhost:5173","command":"npm run dev","cwd":"","services":[]}');
    const det = createAppDetector();
    await det.detect({ projectDir }); // prime the cache

    const phases: string[] = [];
    await det.detect({ projectDir, onProgress: (p) => phases.push(p.phase) });
    expect(phases).toContain('cache');
    expect(phases.at(-1)).toBe('done');
    // The model phase must NOT run on a cache hit.
    expect(phases).not.toContain('analyzing');
  });
});
