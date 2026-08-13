/**
 * IPC bridge exposing Foundation RunKernel to Renderer process.
 */

import { ipcMain } from 'electron';
import type { SelectionCandidate } from '../../common/foundation/decisionTypes';
import type { RunIntent } from '../../common/foundation/runTypes';
import { RunKernel } from '../foundation/runKernel';

const globalKernel = new RunKernel();

export const registerFoundationBridge = (): void => {
  ipcMain.handle(
    'foundation:execute-run',
    async (
      _event,
      payload: { intent: RunIntent; candidates: readonly SelectionCandidate[] },
    ) => {
      try {
        const receipt = await globalKernel.executeRun(
          payload.intent,
          payload.candidates ?? [],
          async () => {
            return { evidenceRefs: [`ev_gui_${Date.now()}`] };
          },
        );
        return { success: true, receipt };
      } catch (error) {
        console.error('[foundationBridge] Error executing run:', error);
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle('foundation:get-events', async (_event, runId: string) => {
    try {
      const events = globalKernel.eventStore.getEventsByRunId(runId);
      return { success: true, events };
    } catch (error) {
      console.error('[foundationBridge] Error getting events:', error);
      return { success: false, error: String(error) };
    }
  });
};
