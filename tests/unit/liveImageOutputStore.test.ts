import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLiveImageOutputStore } from '@/process/services/liveImageOutputStore';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAFAAH/e+m+7wAAAABJRU5ErkJggg==',
  'base64'
);

const createStore = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-live-image-test-'));
  const workspace = path.join(root, 'workspace');
  const store = createLiveImageOutputStore({ indexPath: path.join(root, 'live-image-index.json') });
  return { root, workspace, store };
};

describe('LiveImageOutputStore', () => {
  it('publishes a protected PNG into the workspace and returns it only after a verified receipt', async () => {
    const { root, workspace, store } = await createStore();
    try {
      const published = await store.publish({
        outputId: 'output-1',
        conversationId: 'conversation-1',
        runId: 'run-1',
        workspace,
        png: PNG_1PX,
        width: 1,
        height: 1,
      });

      expect(published.state).toBe('finalizing');
      expect(published.relativePath).toBe('.tomni/artifacts/live-images/output-1.png');
      expect(await store.read({ conversationId: 'conversation-1', outputId: 'output-1', outputRef: published.outputRef })).toBeNull();

      const completed = await store.complete({ outputId: 'output-1', receiptId: 'receipt-1', receiptStatus: 'verified' });
      expect(completed?.state).toBe('completed');

      const image = await store.read({
        conversationId: 'conversation-1',
        outputId: 'output-1',
        outputRef: published.outputRef,
      });
      expect(image).toMatchObject({ mimeType: 'image/png', width: 1, height: 1 });
      expect(image?.dataUrl).toMatch(/^data:image\/png;base64,/u);
      expect(await readFile(path.join(workspace, '.tomni', 'artifacts', 'live-images', 'output-1.png'))).toEqual(PNG_1PX);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed for a cross-conversation, stale reference, changed file, or symlink', async () => {
    const { root, workspace, store } = await createStore();
    try {
      const published = await store.publish({
        outputId: 'output-1',
        conversationId: 'conversation-1',
        runId: 'run-1',
        workspace,
        png: PNG_1PX,
        width: 1,
        height: 1,
      });
      await store.complete({ outputId: 'output-1', receiptId: 'receipt-1', receiptStatus: 'verified' });
      const imagePath = path.join(workspace, '.tomni', 'artifacts', 'live-images', 'output-1.png');

      expect(await store.read({ conversationId: 'conversation-2', outputId: 'output-1', outputRef: published.outputRef })).toBeNull();
      expect(await store.read({ conversationId: 'conversation-1', outputId: 'output-1', outputRef: 'outref_wrong' })).toBeNull();

      await writeFile(imagePath, 'tampered');
      expect(await store.read({ conversationId: 'conversation-1', outputId: 'output-1', outputRef: published.outputRef })).toBeNull();

      await writeFile(imagePath, PNG_1PX);
      await rm(imagePath);
      await symlink(path.join(root, 'outside.png'), imagePath);
      expect(await store.read({ conversationId: 'conversation-1', outputId: 'output-1', outputRef: published.outputRef })).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
