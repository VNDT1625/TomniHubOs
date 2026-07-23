import { NativePreviewHistoryService } from '@process/resources/nativePlatform/previewHistoryService';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
const target = { contentType: 'markdown' as const, workspace: 'C:/workspace', file_path: 'README.md' };

const createService = async (): Promise<NativePreviewHistoryService> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tomni-preview-history-'));
  directories.push(directory);
  return new NativePreviewHistoryService(directory);
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Tomni native preview history', () => {
  it('persists and retrieves isolated snapshots without legacy HTTP', async () => {
    const service = await createService();
    const first = await service.save(target, '# one');
    await service.save({ ...target, file_path: 'OTHER.md' }, '# other');

    expect(await service.list(target)).toEqual([first]);
    expect(await service.getContent(target, first.id)).toEqual({ snapshot: first, content: '# one' });
    expect(await service.getContent({ ...target, file_path: 'OTHER.md' }, first.id)).toBeNull();
  });

  it('serializes concurrent writes and survives a service restart', async () => {
    const service = await createService();
    const rootDir = (service as unknown as { rootDir: string }).rootDir;
    await Promise.all(Array.from({ length: 8 }, (_, index) => service.save(target, 'snapshot ' + index)));

    const restarted = new NativePreviewHistoryService(rootDir);
    const snapshots = await restarted.list(target);
    expect(snapshots).toHaveLength(8);
    await expect(restarted.getContent(target, snapshots[0].id)).resolves.toEqual(
      expect.objectContaining({ content: expect.stringMatching(/^snapshot /u) })
    );
  });

  it('rejects invalid ids and keeps the bridge free of legacy preview routes', async () => {
    const service = await createService();
    await expect(service.getContent(target, '../escape')).resolves.toBeNull();
    const source = await readFile(path.join(process.cwd(), 'packages/desktop/src/common/adapter/ipcBridge.ts'), 'utf8');
    expect(source).not.toContain('/api/preview-history/');
    expect(source).toContain('preview-history.get-content');
  });
});
