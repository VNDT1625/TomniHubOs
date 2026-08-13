/**
 * IPC bridge exposing Foundation RunKernel to Renderer process.
 */

import { app, ipcMain } from 'electron';
import path from 'node:path';
import type { RunIntent } from '../../common/foundation/runTypes';
import { assertRunIntent } from '../../common/foundation/runTypes';
import { JsonlDurableEventStore } from '../services/agentChat/durability';
import { EventStore } from '../foundation/eventStore';
import { HubExecutionAdapter, type HubExecutionTarget } from '../foundation/hubExecutionAdapter';
import { ResourceAdapter } from '../foundation/resourceAdapter';
import { RunKernel } from '../foundation/runKernel';
import { getResourceCoordinator } from '../resource/resourceCoordinator';

let globalKernel: RunKernel | undefined;

export type FoundationRunPayload = { intent: RunIntent };
export type FoundationCoreRuntime = {
  listTargets: () => Promise<
    ReadonlyArray<{
      id: string;
      kind: 'builtin' | 'acp' | 'cli' | 'remote';
      available: boolean;
      defaultModelKey?: string;
    }>
  >;
  executeToCompletion: (input: {
    requestId: string;
    targetId: string;
    prompt: string;
    workspace: string;
    modelKey?: string;
    permissionMode: 'read-only' | 'workspace-write' | 'full-access';
    signal?: AbortSignal;
  }) => Promise<{ text: string; evidenceRefs: readonly string[] }>;
};
export type FoundationBridgeOptions = { coreRuntime: FoundationCoreRuntime };
type FoundationSenderEvent = { sender: { mainFrame?: unknown }; senderFrame?: unknown };

export const isFoundationMainFrame = (event: FoundationSenderEvent): boolean =>
  event.senderFrame !== undefined && event.senderFrame === event.sender.mainFrame;

export const parseFoundationRunId = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200)
    throw new Error('INVALID_FOUNDATION_RUN_ID');
  return value;
};

/** Validate renderer input before it can allocate a Run, lease, or durable event. */
export const parseFoundationRunPayload = (value: unknown): FoundationRunPayload => {
  if (!value || typeof value !== 'object') throw new Error('INVALID_FOUNDATION_REQUEST');
  const payload = value as Partial<FoundationRunPayload>;
  return { intent: assertRunIntent(payload.intent as RunIntent) };
};

const kindForCoreTarget = (kind: 'builtin' | 'acp' | 'cli' | 'remote'): HubExecutionTarget['kind'] =>
  kind === 'builtin' ? 'local' : kind === 'remote' ? 'cloud' : 'cli';

const priorityForCoreTarget = (kind: HubExecutionTarget['kind']): number =>
  kind === 'local' ? 40 : kind === 'cloud' ? 30 : kind === 'cli' ? 20 : 10;

/** Builds target candidates exclusively from Main-process runtime discovery. */
export const createFoundationHubTargets = async (
  runtime: FoundationCoreRuntime
): Promise<readonly HubExecutionTarget[]> =>
  (await runtime.listTargets())
    .filter((target) => target.available)
    .map((target) => {
      const kind = kindForCoreTarget(target.kind);
      return {
        id: target.id,
        kind,
        priority: priorityForCoreTarget(kind),
        requestedCapabilities: ['target.execute'],
        execute: ({ intent, signal }) =>
          runtime.executeToCompletion({
            requestId: intent.runId,
            targetId: target.id,
            prompt: intent.goal,
            workspace: intent.workspaceScope,
            modelKey: target.defaultModelKey,
            permissionMode: 'workspace-write',
            signal,
          }),
      };
    });

/** Executes a Hub run using only Main-discovered direct-core targets. */
export const executeFoundationHubRun = async (
  kernel: RunKernel,
  runtime: FoundationCoreRuntime,
  intent: RunIntent,
  signal?: AbortSignal
) => new HubExecutionAdapter(kernel, await createFoundationHubTargets(runtime)).execute(intent, signal);

const getGlobalKernel = (): RunKernel => {
  globalKernel ??= new RunKernel({
    eventStore: new EventStore({
      journal: new JsonlDurableEventStore(path.join(app.getPath('userData'), 'tomny-core', 'runs', 'foundation.jsonl')),
    }),
    resourceAdapter: new ResourceAdapter(getResourceCoordinator()),
  });
  return globalKernel;
};

export const registerFoundationBridge = ({ coreRuntime }: FoundationBridgeOptions): void => {
  ipcMain.handle('foundation:execute-run', async (event, rawPayload: unknown) => {
    try {
      if (!isFoundationMainFrame(event)) throw new Error('FOUNDATION_SENDER_REJECTED');
      const payload = parseFoundationRunPayload(rawPayload);
      const result = await executeFoundationHubRun(getGlobalKernel(), coreRuntime, payload.intent);
      return {
        success: result.receipt.status === 'verified',
        receipt: result.receipt,
        targetId: result.targetId,
        text: result.text,
        ...(result.receipt.status === 'verified'
          ? {}
          : { error: `FOUNDATION_RUN_${result.receipt.status.toUpperCase()}` }),
      };
    } catch (error) {
      console.error('[foundationBridge] Error executing run:', error);
      return { success: false, error: 'FOUNDATION_EXECUTION_REJECTED' };
    }
  });

  ipcMain.handle('foundation:get-events', async (event, rawRunId: unknown) => {
    try {
      if (!isFoundationMainFrame(event)) throw new Error('FOUNDATION_SENDER_REJECTED');
      const runId = parseFoundationRunId(rawRunId);
      const kernel = getGlobalKernel();
      await kernel.eventStore.initialize();
      const events = kernel.eventStore.getEventsByRunId(runId);
      return { success: true, events };
    } catch (error) {
      console.error('[foundationBridge] Error getting events:', error);
      return { success: false, error: 'FOUNDATION_EVENTS_REJECTED' };
    }
  });
};
