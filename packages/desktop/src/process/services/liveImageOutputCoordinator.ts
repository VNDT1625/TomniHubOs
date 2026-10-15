import type { LiveImageOutputUpdate } from '@/common/chat/liveImageOutput';
import type { LiveImageOutputStore } from './liveImageOutputStore';

export type LiveImageOutputCoordinator = Readonly<{
  begin(input: { outputId: string; accountId: string; conversationId: string; runId: string; workspace: string }): {
    outputId: string;
  };
  markRunning(outputId: string): void;
  publish(input: { outputId: string; png: Uint8Array; width: number; height: number }): Promise<void>;
  finishRun(input: {
    runId: string;
    receiptId: string;
    status: 'verified' | 'failed' | 'cancelled' | 'timed_out';
  }): Promise<void>;
}>;

type ActiveOutput = {
  outputId: string;
  accountId: string;
  conversationId: string;
  runId: string;
  workspace: string;
  revision: number;
  state: LiveImageOutputUpdate['state'];
  outputRef?: string;
  width?: number;
  height?: number;
};

const ERROR_FOR_TERMINAL_RECEIPT = 'PUBLICATION_FAILED' as const;

/**
 * Main-only coordinator for the renderer-safe output lifecycle. It serializes
 * revisions, never takes a renderer-provided file path, and refuses to expose
 * a completed image until the owning Foundation Run verifies.
 */
export const createLiveImageOutputCoordinator = (input: {
  store: LiveImageOutputStore;
  emit(update: LiveImageOutputUpdate): void;
}): LiveImageOutputCoordinator => {
  const active = new Map<string, ActiveOutput>();

  const emit = (output: ActiveOutput, update: Omit<LiveImageOutputUpdate, 'schemaVersion' | 'outputId' | 'revision' | 'conversationId' | 'runId' | 'source'>): void => {
    output.revision += 1;
    output.state = update.state;
    input.emit({
      schemaVersion: 1,
      outputId: output.outputId,
      revision: output.revision,
      conversationId: output.conversationId,
      runId: output.runId,
      source: 'browser-screenshot',
      ...update,
    });
  };

  return Object.freeze({
    begin: ({ outputId, accountId, conversationId, runId, workspace }) => {
      if (active.has(outputId)) throw new Error('LIVE_IMAGE_OUTPUT_ALREADY_ACTIVE');
      const output: ActiveOutput = {
        outputId,
        accountId,
        conversationId,
        runId,
        workspace,
        revision: 0,
        state: 'queued',
      };
      active.set(outputId, output);
      emit(output, { state: 'queued' });
      return { outputId };
    },
    markRunning: (outputId) => {
      const output = active.get(outputId);
      if (!output || output.state !== 'queued') return;
      emit(output, { state: 'running' });
    },
    publish: async ({ outputId, png, width, height }) => {
      const output = active.get(outputId);
      if (!output || (output.state !== 'queued' && output.state !== 'running')) return;
      try {
        const published = await input.store.publish({
          outputId: output.outputId,
          accountId: output.accountId,
          conversationId: output.conversationId,
          runId: output.runId,
          workspace: output.workspace,
          png,
          width,
          height,
        });
        output.outputRef = published.outputRef;
        output.width = width;
        output.height = height;
        emit(output, { state: 'finalizing' });
      } catch {
        emit(output, { state: 'failed', errorCode: 'PUBLICATION_FAILED' });
      }
    },
    finishRun: async ({ runId, receiptId, status }) => {
      const outputs = [...active.values()].filter((output) => output.runId === runId);
      for (const output of outputs) {
        if (output.state === 'failed' || output.state === 'cancelled' || output.state === 'completed') continue;
        if (status === 'cancelled' || status === 'timed_out') {
          emit(output, { state: 'cancelled' });
          continue;
        }
        if (status !== 'verified' || output.state !== 'finalizing' || !output.outputRef || !output.width || !output.height) {
          emit(output, { state: 'failed', errorCode: ERROR_FOR_TERMINAL_RECEIPT });
          continue;
        }
        const completed = await input.store.complete({ outputId: output.outputId, receiptId, receiptStatus: status });
        if (!completed) {
          emit(output, { state: 'failed', errorCode: 'PUBLICATION_FAILED' });
          continue;
        }
        emit(output, {
          state: 'completed',
          receiptId,
          image: {
            outputRef: completed.outputRef,
            mimeType: 'image/png',
            width: output.width,
            height: output.height,
          },
        });
      }
    },
  });
};
