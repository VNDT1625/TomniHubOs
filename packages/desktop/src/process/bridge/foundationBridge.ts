/**
 * IPC bridge exposing Foundation RunKernel to Renderer process.
 */

import { app, ipcMain } from 'electron';
import path from 'node:path';
import type { SelectionCandidate } from '../../common/foundation/decisionTypes';
import type { RunIntent } from '../../common/foundation/runTypes';
import { JsonlDurableEventStore } from '../services/agentChat/durability';
import { EventStore } from '../foundation/eventStore';
import { RunKernel } from '../foundation/runKernel';

let globalKernel: RunKernel | undefined;

const getGlobalKernel = (): RunKernel => {
  globalKernel ??= new RunKernel({
    eventStore: new EventStore({
      journal: new JsonlDurableEventStore(path.join(app.getPath('userData'), 'tomny-core', 'runs', 'foundation.jsonl')),
    }),
  });
  return globalKernel;
};

export const registerFoundationBridge = (): void => {
  ipcMain.handle(
    'foundation:execute-run',
    async (_event, payload: { intent: RunIntent; candidates: readonly SelectionCandidate[] }) => {
      try {
        const receipt = await getGlobalKernel().executeRun(payload.intent, payload.candidates ?? [], async () => {
          return { evidenceRefs: [`ev_gui_${Date.now()}`] };
        });
        return { success: true, receipt };
      } catch (error) {
        console.error('[foundationBridge] Error executing run:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('foundation:get-events', async (_event, runId: string) => {
    try {
      const kernel = getGlobalKernel();
      await kernel.eventStore.initialize();
      const events = kernel.eventStore.getEventsByRunId(runId);
      return { success: true, events };
    } catch (error) {
      console.error('[foundationBridge] Error getting events:', error);
      return { success: false, error: String(error) };
    }
  });
};
