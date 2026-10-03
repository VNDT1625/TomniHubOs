import { beforeEach, describe, expect, it, vi } from 'vitest';

type ProviderHandler = (input: unknown) => unknown;

const registered = new Map<string, ProviderHandler>();

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: (channel: string) => ({
      provider: (handler: ProviderHandler) => registered.set(channel, handler),
      invoke: vi.fn(),
    }),
  },
}));

import type { NativeFileGateway } from '@process/resources/nativeFileGateway';
import { NATIVE_FILE_MUTATION_DISABLED, registerFileGatewayBridge } from '@process/resources/nativeFileGatewayBridge';

const gateway = {
  getFilesByDir: vi.fn(async () => [{ name: 'safe.txt' }]),
  listWorkspaceFiles: vi.fn(async () => [{ name: 'safe.txt' }]),
  imageDataUrl: vi.fn(async () => 'data:image/png;base64,c2FmZQ=='),
  fetchRemoteImage: vi.fn(async () => 'data:image/png;base64,cmVtb3Rl'),
  readText: vi.fn(async () => 'safe text'),
  readBase64: vi.fn(async () => 'c2FmZSB0ZXh0'),
  createTempFile: vi.fn(async () => '/tmp/unsafe.txt'),
  writeText: vi.fn(async () => true),
  metadata: vi.fn(async () => ({ path: '/workspace/safe.txt' })),
  copyToWorkspace: vi.fn(async () => ({ copied_files: ['/workspace/safe.txt'] })),
  remove: vi.fn(async () => undefined),
  rename: vi.fn(async () => ({ new_path: '/workspace/renamed.txt' })),
};

const invoke = async (channel: string, input: unknown): Promise<unknown> => {
  const handler = registered.get(channel);
  if (!handler) throw new Error(`No provider registered for ${channel}`);
  return handler(input);
};

beforeEach(() => {
  registered.clear();
  vi.clearAllMocks();
  registerFileGatewayBridge(gateway as unknown as NativeFileGateway);
});

describe('native file gateway bridge containment', () => {
  it('keeps safe reads on the injected Main gateway', async () => {
    await expect(invoke('native-fs.get-files-by-dir', { dir: '/workspace', root: '/workspace' })).resolves.toEqual([
      { name: 'safe.txt' },
    ]);
    await expect(invoke('native-fs.list-workspace-files', { root: '/workspace' })).resolves.toEqual([
      { name: 'safe.txt' },
    ]);
    await expect(invoke('native-fs.image-base64', { path: '/workspace/safe.png' })).resolves.toBe(
      'data:image/png;base64,c2FmZQ=='
    );
    await expect(invoke('native-fs.fetch-remote-image', { url: 'https://images.example/safe.png' })).resolves.toBe(
      'data:image/png;base64,cmVtb3Rl'
    );
    await expect(invoke('native-fs.read', { path: '/workspace/safe.txt' })).resolves.toBe('safe text');
    await expect(invoke('native-fs.read-buffer', { path: '/workspace/safe.txt' })).resolves.toBe('c2FmZSB0ZXh0');
    await expect(invoke('native-fs.metadata', { path: '/workspace/safe.txt' })).resolves.toEqual({
      path: '/workspace/safe.txt',
    });

    expect(gateway.getFilesByDir).toHaveBeenCalledWith({ dir: '/workspace', root: '/workspace' });
    expect(gateway.listWorkspaceFiles).toHaveBeenCalledWith('/workspace');
    expect(gateway.imageDataUrl).toHaveBeenCalledWith('/workspace/safe.png');
    expect(gateway.fetchRemoteImage).toHaveBeenCalledWith('https://images.example/safe.png');
    expect(gateway.readText).toHaveBeenCalledWith('/workspace/safe.txt');
    expect(gateway.readBase64).toHaveBeenCalledWith('/workspace/safe.txt');
    expect(gateway.metadata).toHaveBeenCalledWith('/workspace/safe.txt');
  });

  it('rejects every renderer-exposed filesystem mutation before the gateway can touch disk', async () => {
    await expect(invoke('native-fs.temp', { file_name: 'unsafe.txt' })).rejects.toThrow(NATIVE_FILE_MUTATION_DISABLED);
    await expect(invoke('native-fs.write', { path: '/workspace/unsafe.txt', data: 'unsafe' })).rejects.toThrow(
      NATIVE_FILE_MUTATION_DISABLED
    );
    await expect(
      invoke('native-fs.copy', {
        file_paths: ['/workspace/unsafe.txt'],
        workspace: '/workspace',
      })
    ).rejects.toThrow(NATIVE_FILE_MUTATION_DISABLED);
    await expect(invoke('native-fs.remove', { path: '/workspace/unsafe.txt' })).rejects.toThrow(
      NATIVE_FILE_MUTATION_DISABLED
    );
    await expect(
      invoke('native-fs.rename', {
        path: '/workspace/unsafe.txt',
        new_name: 'renamed.txt',
      })
    ).rejects.toThrow(NATIVE_FILE_MUTATION_DISABLED);

    expect(gateway.createTempFile).not.toHaveBeenCalled();
    expect(gateway.writeText).not.toHaveBeenCalled();
    expect(gateway.copyToWorkspace).not.toHaveBeenCalled();
    expect(gateway.remove).not.toHaveBeenCalled();
    expect(gateway.rename).not.toHaveBeenCalled();
  });
});
