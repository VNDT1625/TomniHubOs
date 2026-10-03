import { describe, expect, it, vi } from 'vitest';
import { loadResourceState, saveResourceState, type ResourceStateFs } from '@/process/resource/resourceState';
import type { ResourceState } from '@/process/resource/leaseTypes';

const maxConcurrent = {
  agent: 1,
  browser: 1,
  emulator: 1,
  windowsTest: 1,
  patchBuild: 1,
  ocr: 1,
  transcription: 1,
  docConvert: 1,
  semanticIndex: 1,
};

const createState = (): ResourceState => ({
  machine: { totalMemMB: 16_000, cpuCores: 8, hasDiscreteGPU: false, freeDiskMB: 100_000 },
  mode: 'suggest',
  preset: 'balanced',
  budget: { maxConcurrent: { ...maxConcurrent }, maxTotalMemoryMB: 8_000, reserveForUserMB: 4_000 },
  active: [],
  queued: [],
  lastAdjustments: [],
});

describe('resource state persistence', () => {
  it('fails closed to the supplied default when a persisted budget is incomplete', async () => {
    const fallback = createState();
    const malformed = {
      ...createState(),
      budget: { ...createState().budget, maxConcurrent: { agent: 1 } },
    };
    const fs: ResourceStateFs = {
      readFile: vi.fn(async () => JSON.stringify(malformed)),
      writeFile: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      mkdir: vi.fn(async () => undefined),
    };

    await expect(loadResourceState({ dir: 'C:\\resource-state', fs, defaultState: fallback })).resolves.toBe(fallback);
  });

  it('recovers a valid backup when the primary state is malformed', async () => {
    const fallback = createState();
    const backup = { ...createState(), mode: 'detailed' as const };
    const fs: ResourceStateFs = {
      readFile: vi.fn(async (filePath: string) => (filePath.endsWith('.bak') ? JSON.stringify(backup) : '{')),
      writeFile: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      mkdir: vi.fn(async () => undefined),
    };

    await expect(loadResourceState({ dir: 'C:\\resource-state', fs, defaultState: fallback })).resolves.toEqual(backup);
  });

  it('does not overwrite primary or recovery files with an invalid state', async () => {
    const writeFile = vi.fn(async () => undefined);
    const rename = vi.fn(async () => undefined);
    const fs: ResourceStateFs = {
      readFile: vi.fn(async () => '{}'),
      writeFile,
      rename,
      mkdir: vi.fn(async () => undefined),
    };
    const invalidState = { ...createState(), mode: 'invalid' } as unknown as ResourceState;

    await expect(saveResourceState(invalidState, { dir: 'C:\\resource-state', fs })).rejects.toThrow(
      'Cannot persist an invalid resource state.'
    );

    expect(writeFile).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it('promotes a recovery copy only after the primary state commits', async () => {
    const rename = vi.fn(async () => undefined);
    const fs: ResourceStateFs = {
      readFile: vi.fn(async () => '{}'),
      writeFile: vi.fn(async () => undefined),
      rename,
      mkdir: vi.fn(async () => undefined),
    };

    await saveResourceState(createState(), { dir: 'C:\\resource-state', fs });

    expect(rename).toHaveBeenNthCalledWith(1, expect.any(String), 'C:\\resource-state\\resource-state.json');
    expect(rename).toHaveBeenNthCalledWith(2, expect.any(String), 'C:\\resource-state\\resource-state.json.bak');
  });

  it('keeps the current backup and removes its staging file when backup promotion fails', async () => {
    const backupPath = 'C:\\resource-state\\resource-state.json.bak';
    const existingBackup = 'known-good-backup';
    const files = new Map([[backupPath, existingBackup]]);
    const writes: string[] = [];
    const rename = vi.fn(async (sourcePath: string, destinationPath: string) => {
      if (destinationPath.endsWith('.bak')) throw new Error('backup rename unavailable');
      const contents = files.get(sourcePath);
      if (contents === undefined) throw new Error('staging file missing');
      files.set(destinationPath, contents);
      files.delete(sourcePath);
    });
    const unlink = vi.fn(async (filePath: string) => {
      files.delete(filePath);
    });
    const fs: ResourceStateFs = {
      readFile: vi.fn(async () => '{}'),
      writeFile: vi.fn(async (filePath: string, data: string) => {
        writes.push(filePath);
        files.set(filePath, data);
      }),
      rename,
      unlink,
      mkdir: vi.fn(async () => undefined),
    };

    await expect(saveResourceState(createState(), { dir: 'C:\\resource-state', fs })).resolves.toBeUndefined();

    expect(rename).toHaveBeenCalledTimes(2);
    expect(files.get(backupPath)).toBe(existingBackup);
    expect(unlink).toHaveBeenCalledWith(writes[1]);
    expect(files.has(writes[1] ?? '')).toBe(false);
  });

  it('uses unique temporary paths for concurrent state saves', async () => {
    const writes: string[] = [];
    const fs: ResourceStateFs = {
      readFile: vi.fn(async () => '{}'),
      writeFile: vi.fn(async (filePath: string) => {
        writes.push(filePath);
      }),
      rename: vi.fn(async () => undefined),
      mkdir: vi.fn(async () => undefined),
    };

    await Promise.all([
      saveResourceState(createState(), { dir: 'C:\\resource-state', fs }),
      saveResourceState(createState(), { dir: 'C:\\resource-state', fs }),
    ]);

    expect(writes).toHaveLength(4);
    expect(new Set(writes).size).toBe(4);
    expect(writes.every((filePath) => filePath.endsWith('.tmp'))).toBe(true);
  });

  it('removes the temporary state file when the atomic rename fails', async () => {
    const writes: string[] = [];
    const renameFailure = new Error('rename unavailable');
    const unlink = vi.fn(async () => undefined);
    const fs: ResourceStateFs = {
      readFile: vi.fn(async () => '{}'),
      writeFile: vi.fn(async (filePath: string) => {
        writes.push(filePath);
      }),
      rename: vi.fn(async () => {
        throw renameFailure;
      }),
      unlink,
      mkdir: vi.fn(async () => undefined),
    };

    await expect(saveResourceState(createState(), { dir: 'C:\\resource-state', fs })).rejects.toBe(renameFailure);

    expect(writes).toHaveLength(1);
    expect(unlink).toHaveBeenCalledWith(writes[0]);
  });
});
