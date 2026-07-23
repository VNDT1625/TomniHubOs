import { ipcBridge } from '@/common';
import type { PreviewHistoryTarget, PreviewSnapshotInfo } from '@/common/types/office/preview';
import { getDataPath } from '@process/utils';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_CONTENT_BYTES = 10 * 1024 * 1024;
const MAX_SNAPSHOTS_PER_TARGET = 50;

type PreviewIndex = { version: 1; snapshots: PreviewSnapshotInfo[] };
type PreviewContent = { snapshot: PreviewSnapshotInfo; content: string };

const stableTarget = (target: PreviewHistoryTarget): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(target)
        .filter(([, value]) => value !== undefined)
        .toSorted(([a], [b]) => a.localeCompare(b))
    )
  );

export class NativePreviewHistoryService {
  private readonly queues = new Map<string, Promise<void>>();

  public constructor(private readonly rootDir = path.join(getDataPath(), 'tomni-core', 'preview-history')) {}

  public async list(target: PreviewHistoryTarget): Promise<PreviewSnapshotInfo[]> {
    const key = this.targetKey(target);
    await this.waitForWrites(key);
    return (await this.readIndex(key)).snapshots.toSorted((left, right) => right.created_at - left.created_at);
  }

  public async save(target: PreviewHistoryTarget, content: string): Promise<PreviewSnapshotInfo> {
    const size = Buffer.byteLength(content, 'utf8');
    if (size > MAX_CONTENT_BYTES) throw new Error('PREVIEW_HISTORY_CONTENT_TOO_LARGE');
    const key = this.targetKey(target);
    const createdAt = Date.now();
    const snapshot: PreviewSnapshotInfo = {
      id: randomUUID(),
      label: new Date(createdAt).toISOString(),
      created_at: createdAt,
      size,
      contentType: target.contentType,
      file_name: target.file_name,
      file_path: target.file_path,
    };
    await this.enqueue(key, async () => {
      const directory = this.targetDir(key);
      await mkdir(directory, { recursive: true });
      await this.atomicWrite(path.join(directory, snapshot.id + '.txt'), content);
      const index = await this.readIndex(key);
      const snapshots = [snapshot, ...index.snapshots.filter((item) => item.id !== snapshot.id)];
      const removed = snapshots.splice(MAX_SNAPSHOTS_PER_TARGET);
      await this.atomicWrite(this.indexPath(key), JSON.stringify({ version: 1, snapshots } satisfies PreviewIndex));
      await Promise.all(removed.map((item) => rm(path.join(directory, item.id + '.txt'), { force: true })));
    });
    return snapshot;
  }

  public async getContent(target: PreviewHistoryTarget, snapshotId: string): Promise<PreviewContent | null> {
    if (!/^[0-9a-f-]{36}$/iu.test(snapshotId)) return null;
    const key = this.targetKey(target);
    await this.waitForWrites(key);
    const snapshot = (await this.readIndex(key)).snapshots.find((item) => item.id === snapshotId);
    if (!snapshot) return null;
    try {
      const content = await readFile(path.join(this.targetDir(key), snapshotId + '.txt'), 'utf8');
      return { snapshot, content };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private targetKey(target: PreviewHistoryTarget): string {
    return createHash('sha256').update(stableTarget(target)).digest('hex');
  }

  private targetDir(key: string): string {
    return path.join(this.rootDir, key);
  }

  private indexPath(key: string): string {
    return path.join(this.targetDir(key), 'index.json');
  }

  private async readIndex(key: string): Promise<PreviewIndex> {
    try {
      const value = JSON.parse(await readFile(this.indexPath(key), 'utf8')) as Partial<PreviewIndex>;
      return { version: 1, snapshots: Array.isArray(value.snapshots) ? value.snapshots : [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
        return { version: 1, snapshots: [] };
      }
      throw error;
    }
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const temporaryPath = filePath + '.' + randomUUID() + '.tmp';
    await writeFile(temporaryPath, content, 'utf8');
    await rename(temporaryPath, filePath);
  }

  private waitForWrites(key: string): Promise<void> {
    return this.queues.get(key) || Promise.resolve();
  }

  private enqueue(key: string, operation: () => Promise<void>): Promise<void> {
    const pending = this.waitForWrites(key).then(operation, operation);
    this.queues.set(key, pending);
    return pending.finally(() => {
      if (this.queues.get(key) === pending) this.queues.delete(key);
    });
  }
}

let sharedService: NativePreviewHistoryService | undefined;
export const getNativePreviewHistoryService = (): NativePreviewHistoryService =>
  (sharedService ||= new NativePreviewHistoryService());

export const registerNativePreviewHistoryBridge = (): void => {
  const service = getNativePreviewHistoryService();
  ipcBridge.previewHistory.list.provider(({ target }) => service.list(target));
  ipcBridge.previewHistory.save.provider(({ target, content }) => service.save(target, content));
  ipcBridge.previewHistory.getContent.provider(({ target, snapshot_id: snapshotId }) =>
    service.getContent(target, snapshotId)
  );
};
