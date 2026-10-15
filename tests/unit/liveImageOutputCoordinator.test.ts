import { describe, expect, it, vi } from 'vitest';
import type { LiveImageOutputStore } from '@/process/services/liveImageOutputStore';
import { createLiveImageOutputCoordinator } from '@/process/services/liveImageOutputCoordinator';

const store: LiveImageOutputStore = {
  publish: vi.fn(async (input) => ({
    outputId: input.outputId,
    outputRef: 'outref_1',
    relativePath: '.tomni/artifacts/live-images/output-1.png',
    state: 'finalizing',
  })),
  complete: vi.fn(async (input) => ({
    outputId: input.outputId,
    outputRef: 'outref_1',
    state: 'completed',
    receiptId: input.receiptId,
  })),
  read: vi.fn(),
};

describe('LiveImageOutputCoordinator', () => {
  it('streams queued through finalizing and gates completed state on a verified run receipt', async () => {
    const updates: unknown[] = [];
    const coordinator = createLiveImageOutputCoordinator({ store, emit: (update) => updates.push(update) });
    const output = coordinator.begin({
      outputId: 'output-1',
      conversationId: 'conversation-1',
      runId: 'run-1',
      workspace: 'C:/workspace',
    });

    coordinator.markRunning(output.outputId);
    await coordinator.publish({ outputId: output.outputId, png: new Uint8Array([1, 2, 3]), width: 1, height: 1 });
    await coordinator.finishRun({ runId: 'run-1', receiptId: 'rcpt-1', status: 'failed' });
    await coordinator.finishRun({ runId: 'run-1', receiptId: 'rcpt-1', status: 'verified' });

    expect(updates).toEqual([
      expect.objectContaining({ outputId: 'output-1', state: 'queued', revision: 1 }),
      expect.objectContaining({ outputId: 'output-1', state: 'running', revision: 2 }),
      expect.objectContaining({ outputId: 'output-1', state: 'finalizing', revision: 3 }),
      expect.objectContaining({ outputId: 'output-1', state: 'failed', revision: 4, errorCode: 'PUBLICATION_FAILED' }),
    ]);
    expect(store.complete).not.toHaveBeenCalled();
  });

  it('publishes completed only once and exposes an opaque reference after verification', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const coordinator = createLiveImageOutputCoordinator({ store, emit: (update) => updates.push(update) });
    const output = coordinator.begin({
      outputId: 'output-2',
      conversationId: 'conversation-1',
      runId: 'run-2',
      workspace: 'C:/workspace',
    });

    await coordinator.publish({ outputId: output.outputId, png: new Uint8Array([1]), width: 1, height: 1 });
    await coordinator.finishRun({ runId: 'run-2', receiptId: 'rcpt-2', status: 'verified' });
    await coordinator.finishRun({ runId: 'run-2', receiptId: 'rcpt-2', status: 'verified' });

    expect(store.complete).toHaveBeenCalledTimes(1);
    expect(updates.at(-1)).toMatchObject({
      outputId: 'output-2',
      state: 'completed',
      receiptId: 'rcpt-2',
      image: { outputRef: 'outref_1', mimeType: 'image/png', width: 1, height: 1 },
    });
  });
});
