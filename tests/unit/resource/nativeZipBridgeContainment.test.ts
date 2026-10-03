import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

type ProviderHandler = (input: unknown) => Promise<unknown> | unknown;

const state = vi.hoisted(() => ({ providers: new Map<string, ProviderHandler>() }));

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: vi.fn((channel: string) => ({
      provider: vi.fn((handler: ProviderHandler) => state.providers.set(channel, handler)),
    })),
    buildEmitter: vi.fn(() => ({ emit: vi.fn() })),
  },
}));

import { registerNativeFileOperationBridge } from '@process/resources/nativePlatform/fileBridge';

const temporary: string[] = [];

afterEach(async () => {
  state.providers.clear();
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const providerFor = (channel: string): ProviderHandler => {
  const provider = state.providers.get(channel);
  if (!provider) throw new Error(`No provider registered for ${channel}`);
  return provider;
};

describe('native ZIP bridge containment', () => {
  it('rejects the legacy ZIP request before the unmanaged writer can create an archive', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-native-zip-containment-'));
    temporary.push(root);
    const target = path.join(root, 'blocked.zip');

    registerNativeFileOperationBridge();

    await expect(
      providerFor('native-fs.zip')({ path: target, files: [{ name: 'safe.txt', content: 'safe' }] })
    ).rejects.toThrow('Native ZIP creation is disabled until the governed Main file-operation seam is available.');
    expect(existsSync(target)).toBe(false);
    await expect(providerFor('native-fs.zip-cancel')({ request_id: 'unused' })).resolves.toBe(false);
  });
});
