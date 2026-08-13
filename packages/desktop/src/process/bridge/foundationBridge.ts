/**
 * IPC bridge exposing Foundation RunKernel to Renderer process.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunIntent } from '../../common/foundation/runTypes';
import { assertRunIntent } from '../../common/foundation/runTypes';
import { JsonlDurableEventStore } from '../services/agentChat/durability';
import { EventStore } from '../foundation/eventStore';
import { HubExecutionAdapter, type HubExecutionTarget } from '../foundation/hubExecutionAdapter';
import { ResourceAdapter } from '../foundation/resourceAdapter';
import { RunKernel } from '../foundation/runKernel';
import { TrustBroker } from '../foundation/trustBroker';
import { getResourceCoordinator } from '../resource/resourceCoordinator';

let globalKernel: RunKernel | undefined;

export type FoundationRunPayload = { intent: RunIntent };
export type FoundationCoreRuntime = {
  listTargets: () => Promise<
    ReadonlyArray<{
      id: string;
      kind: 'builtin' | 'acp' | 'cli' | 'local' | 'remote';
      available: boolean;
      defaultModelKey?: string;
      networkHost?: string;
    }>
  >;
  executeToCompletion: (input: {
    requestId: string;
    targetId: string;
    prompt: string;
    workspace: string;
    modelKey?: string;
    permissionMode: 'read-only' | 'workspace-write' | 'full-access';
    contextIdentity?: {
      surface?: string;
      agentId?: string;
      personalId?: string;
      permissionScopes?: string[];
      capabilityGrants?: string[];
    };
    signal?: AbortSignal;
  }) => Promise<{ text: string; evidenceRefs: readonly string[] }>;
};
export type FoundationBridgeOptions = { coreRuntime: FoundationCoreRuntime };
type FoundationSenderEvent = {
  sender: { mainFrame?: unknown; isDestroyed?: () => boolean };
  senderFrame?: { url?: string };
};

export const isFoundationMainFrame = (event: FoundationSenderEvent): boolean =>
  event.senderFrame !== undefined && event.senderFrame === event.sender.mainFrame;

/** Returns the exact trusted renderer origin for the main application frame only. */
export const foundationTrustedOrigin = (event: FoundationSenderEvent): string | undefined => {
  if (!isFoundationMainFrame(event) || event.sender.isDestroyed?.()) return undefined;
  const ownerWindow = BrowserWindow.fromWebContents(event.sender as never);
  if (!ownerWindow || ownerWindow.isDestroyed()) return undefined;
  const rawUrl = event.senderFrame?.url;
  if (!rawUrl) return undefined;
  try {
    const senderUrl = new URL(rawUrl);
    if (senderUrl.protocol === 'file:') {
      const expectedFile = path.resolve(__dirname, '../renderer/index.html');
      const actualFile = path.resolve(fileURLToPath(senderUrl));
      const sameFile =
        process.platform === 'win32'
          ? actualFile.toLowerCase() === expectedFile.toLowerCase()
          : actualFile === expectedFile;
      return sameFile ? senderUrl.href : undefined;
    }
    if (app.isPackaged) return undefined;
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    return rendererUrl && senderUrl.origin === new URL(rendererUrl).origin ? senderUrl.origin : undefined;
  } catch {
    return undefined;
  }
};

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

const kindForCoreTarget = (kind: 'builtin' | 'acp' | 'cli' | 'local' | 'remote'): HubExecutionTarget['kind'] =>
  kind === 'local' ? 'local' : kind === 'remote' ? 'cloud' : 'cli';

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
      const hubTarget: HubExecutionTarget = {
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
            contextIdentity: {
              surface: intent.surface,
              agentId: 'tomny',
              personalId: intent.userId,
              capabilityGrants: intent.capabilityGrant ? [...intent.capabilityGrant] : undefined,
            },
            signal,
          }),
      };
      if (target.networkHost) hubTarget.networkHost = target.networkHost;
      return hubTarget;
    });

/** Executes a Hub run using only Main-discovered direct-core targets. */
export const executeFoundationHubRun = async (
  kernel: RunKernel,
  runtime: FoundationCoreRuntime,
  intent: RunIntent,
  origin: string,
  signal?: AbortSignal
) => {
  const targets = await createFoundationHubTargets(runtime);
  const trustBroker = new TrustBroker({
    allowedCapabilities: ['target.execute'],
    allowedOrigins: [origin],
    allowedNetworkHosts: targets.flatMap((target) => (target.networkHost ? [target.networkHost] : [])),
  });
  return new HubExecutionAdapter(kernel, targets, { trustBroker, origin }).execute(intent, signal);
};

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
      const origin = foundationTrustedOrigin(event);
      if (!origin) throw new Error('FOUNDATION_SENDER_REJECTED');
      const payload = parseFoundationRunPayload(rawPayload);
      const result = await executeFoundationHubRun(getGlobalKernel(), coreRuntime, payload.intent, origin);
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
      if (!foundationTrustedOrigin(event)) throw new Error('FOUNDATION_SENDER_REJECTED');
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
