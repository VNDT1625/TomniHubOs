import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  },
}));

import {
  STUDIO_BINARY_WRITE_GOVERNANCE_REQUIRED,
  registerStudioFsBridge,
} from '@package-apps/document-studio/process/studioFsBridge';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  state.providers.clear();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const providerFor = (channel: string): ProviderHandler => {
  const provider = state.providers.get(channel);
  if (!provider) throw new Error(`No provider registered for ${channel}`);
  return provider;
};

describe('Studio binary filesystem bridge containment', () => {
  it('rejects a renderer-controlled binary write before decoding bytes or creating a target directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-studio-binary-containment-'));
    temporaryDirectories.push(root);
    const target = path.join(root, 'not-created', 'blocked.docx');

    registerStudioFsBridge();

    await expect(
      providerFor('studio.write-binary')({
        path: target,
        base64: 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsDBA==',
      })
    ).rejects.toThrow(STUDIO_BINARY_WRITE_GOVERNANCE_REQUIRED);
    expect(existsSync(path.dirname(target))).toBe(false);
    expect(existsSync(target)).toBe(false);
  });

  it('retains the typed binary read metadata and validates an empty read path', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-studio-binary-read-'));
    temporaryDirectories.push(root);
    const source = path.join(root, 'safe.bin');
    await writeFile(source, Buffer.from([0, 1, 2, 3]));

    registerStudioFsBridge();

    await expect(providerFor('studio.read-binary')({ path: source })).resolves.toEqual({
      ok: true,
      base64: 'AAECAw==',
    });
    await expect(providerFor('studio.read-binary')({ path: '  ' })).resolves.toEqual({
      ok: false,
      error: 'A file path is required.',
    });
  });
});
