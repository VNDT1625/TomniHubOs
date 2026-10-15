import { describe, expect, it, vi } from 'vitest';
import { createRunScopedScreenshotPublisher } from '@/process/services/runScopedScreenshotMcp';

describe('RunScopedScreenshotPublisher', () => {
  it('captures through protected page perception and publishes only while the run remains active', async () => {
    const capture = vi.fn().mockResolvedValue({ png: new Uint8Array([1, 2]), width: 10, height: 20 });
    const begin = vi.fn();
    const markRunning = vi.fn();
        const publish = vi.fn().mockResolvedValue(undefined);
    const publisher = createRunScopedScreenshotPublisher({
      runId: 'run-1',
      accountId: 'account-1',
      conversationId: 'conversation-1',
      workspace: 'C:/workspace',
      pagePerception: { capture } as never,
      outputs: { begin, markRunning, publish } as never,
      isRunActive: () => true,
    });

    await publisher.capture({ outputId: 'output-1', tabId: 'tab-1' });

    expect(capture).toHaveBeenCalledWith('tab-1');
    expect(begin).toHaveBeenCalledWith({
            outputId: 'output-1',
      accountId: 'account-1',
      conversationId: 'conversation-1',
      runId: 'run-1',
      workspace: 'C:/workspace',
    });
    expect(markRunning).toHaveBeenCalledWith('output-1');
    expect(publish).toHaveBeenCalledWith({ outputId: 'output-1', png: new Uint8Array([1, 2]), width: 10, height: 20 });
  });

  it('refuses capture before it can create output state when the Main run is inactive', async () => {
    const capture = vi.fn();
        const begin = vi.fn();
    const publisher = createRunScopedScreenshotPublisher({
      runId: 'run-1',
      accountId: 'account-1',
      conversationId: 'conversation-1',
      workspace: 'C:/workspace',
      pagePerception: { capture } as never,
      outputs: { begin } as never,
      isRunActive: () => false,
    });

    await expect(publisher.capture({ outputId: 'output-1', tabId: 'tab-1' })).rejects.toThrow('LIVE_IMAGE_OUTPUT_RUN_INACTIVE');
    expect(begin).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });
});
