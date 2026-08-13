/**
 * IPC bridge exposing Foundation RunKernel to Renderer process.
 */

import { app, ipcMain } from 'electron';
import path from 'node:path';
import type { SelectionCandidate } from '../../common/foundation/decisionTypes';
import type { RunIntent } from '../../common/foundation/runTypes';
import { assertRunIntent } from '../../common/foundation/runTypes';
import { JsonlDurableEventStore } from '../services/agentChat/durability';
import { EventStore } from '../foundation/eventStore';
import { RunKernel } from '../foundation/runKernel';

let globalKernel: RunKernel | undefined;

export type FoundationRunPayload = { intent: RunIntent; candidates: readonly SelectionCandidate[] };

/** Validate renderer input before it can allocate a Run, lease, or durable event. */
export const parseFoundationRunPayload = (value: unknown): FoundationRunPayload => {
  if (!value || typeof value !== 'object') throw new Error('INVALID_FOUNDATION_REQUEST');
  const payload = value as Partial<FoundationRunPayload>;
  if (!Array.isArray(payload.candidates) || payload.candidates.length > 16)
    throw new Error('INVALID_FOUNDATION_CANDIDATES');
  const candidates = payload.candidates.map((candidate) => {
    if (
      !candidate ||
      typeof candidate.id !== 'string' ||
      candidate.id.length === 0 ||
      candidate.id.length > 200 ||
      !candidate.factors ||
      typeof candidate.factors !== 'object' ||
      Object.keys(candidate.factors).length > 16 ||
      Object.values(candidate.factors).some((score) => !Number.isFinite(score))
    ) {
      throw new Error('INVALID_FOUNDATION_CANDIDATES');
    }
    return { id: candidate.id, factors: { ...candidate.factors } };
  });
  return { intent: assertRunIntent(payload.intent as RunIntent), candidates };
};

const getGlobalKernel = (): RunKernel => {
  globalKernel ??= new RunKernel({
    eventStore: new EventStore({
      journal: new JsonlDurableEventStore(path.join(app.getPath('userData'), 'tomny-core', 'runs', 'foundation.jsonl')),
    }),
  });
  return globalKernel;
};

export const registerFoundationBridge = (): void => {
  ipcMain.handle('foundation:execute-run', async (_event, rawPayload: unknown) => {
    try {
      const payload = parseFoundationRunPayload(rawPayload);
      const receipt = await getGlobalKernel().executeRun(payload.intent, payload.candidates ?? [], async () => {
        return { evidenceRefs: [`ev_gui_${Date.now()}`] };
      });
      return { success: true, receipt };
    } catch (error) {
      console.error('[foundationBridge] Error executing run:', error);
      return { success: false, error: 'FOUNDATION_EXECUTION_REJECTED' };
    }
  });

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
