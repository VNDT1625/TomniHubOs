import type { BrowserTabId } from '@process/browser/browserViewManager';
import type { IPagePerception } from '@process/browser/pagePerception';
import type { LiveImageOutputCoordinator } from './liveImageOutputCoordinator';

export type RunScopedScreenshotPublisher = Readonly<{
  capture(input: { outputId: string; tabId: BrowserTabId }): Promise<void>;
}>;

/**
 * Main-only browser screenshot publisher. The model can name only an existing
 * browser tab and an opaque output id; workspace path, bytes and output refs
 * stay inside Main-owned collaborators.
 */
export const createRunScopedScreenshotPublisher = (input: {
  runId: string;
  accountId: string;
  conversationId: string;
  workspace: string;
  pagePerception: IPagePerception;
  outputs: LiveImageOutputCoordinator;
  isRunActive: () => boolean;
}): RunScopedScreenshotPublisher => {
  return Object.freeze({
    capture: async ({ outputId, tabId }) => {
      if (!input.isRunActive()) throw new Error('LIVE_IMAGE_OUTPUT_RUN_INACTIVE');
      input.outputs.begin({
        outputId,
                accountId: input.accountId,
        conversationId: input.conversationId,
        runId: input.runId,
        workspace: input.workspace,
      });
      input.outputs.markRunning(outputId);
      const captured = await input.pagePerception.capture(tabId);
      if (!input.isRunActive()) throw new Error('LIVE_IMAGE_OUTPUT_RUN_INACTIVE');
      await input.outputs.publish({
        outputId,
        png: captured.png,
        width: captured.width,
        height: captured.height,
      });
    },
  });
};
