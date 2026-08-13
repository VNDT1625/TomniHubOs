/**
 * IPC bridge exposing Foundation RunKernel to Renderer process.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunIntent } from '../../common/foundation/runTypes';
import { assertRunIntent } from '../../common/foundation/runTypes';
import { JsonlDurableEventStore } from '../services/agentChat/durability';
import { createElectronContextServices } from '../agentRuntime/electronContext';
import { ContextAdapter } from '../foundation/contextAdapter';
import { EventStore } from '../foundation/eventStore';
import { HubExecutionAdapter, type HubExecutionTarget } from '../foundation/hubExecutionAdapter';
import { ResourceAdapter } from '../foundation/resourceAdapter';
import { RunKernel } from '../foundation/runKernel';
import { TrustBroker } from '../foundation/trustBroker';
import { getResourceCoordinator } from '../resource/resourceCoordinator';
import type {
  NativeConversationRuntime,
  NativeConversationStartTerminal,
} from '../services/database/nativeConversation/service';

let globalKernel: RunKernel | undefined;

export type FoundationRunPayload = { intent: RunIntent };
export type FoundationCoreContextIdentity = {
  surface?: string;
  agentId?: string;
  personalId?: string;
  permissionScopes?: string[];
  capabilityGrants?: string[];
  availableCapabilities?: string[];
  modelCapabilities?: string[];
};

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
  resolveNetworkHost?: (targetId: string, modelKey?: string) => Promise<string | undefined>;
  executeToCompletion: (input: {
    requestId: string;
    targetId: string;
    prompt: string;
    workspace: string;
    modelKey?: string;
    permissionMode: 'read-only' | 'workspace-write' | 'full-access';
    sessionId?: string;
    contextIdentity?: FoundationCoreContextIdentity;
    signal?: AbortSignal;
  }) => Promise<{ text: string; evidenceRefs: readonly string[] }>;
};
export type FoundationBridgeOptions = { coreRuntime: FoundationCoreRuntime };
export type FoundationExecutionOverrides = {
  requestId?: string;
  modelKey?: string;
  permissionMode?: 'read-only' | 'workspace-write' | 'full-access';
  sessionId?: string;
  contextIdentity?: FoundationCoreContextIdentity;
  onCoreExecutionStarted?: () => void;
};

export type FoundationConversationCoreRuntime = FoundationCoreRuntime &
  Omit<NativeConversationRuntime, 'start' | 'cancel'> & {
    cancel: (requestId: string) => Promise<boolean>;
  };
export type FoundationConversationRuntimeOptions = { kernel?: RunKernel; origin?: string };
export type FoundationRunLifecycleStart = {
  requestId: string;
  targetId: string;
  prompt: string;
  workspace: string;
  modelKey?: string;
  permissionMode: 'read-only' | 'workspace-write' | 'full-access';
  sessionId?: string;
  contextIdentity?: FoundationCoreContextIdentity;
};
export type FoundationRunLifecycle = {
  start: (input: FoundationRunLifecycleStart) => {
    requestId: string;
    sessionId: string;
    terminal: Promise<NativeConversationStartTerminal | undefined>;
  };
  cancel: (requestId: string) => Promise<boolean>;
};
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

const kindForCoreTarget = (
  kind: 'builtin' | 'acp' | 'cli' | 'local' | 'remote',
  modelKey?: string
): HubExecutionTarget['kind'] =>
  kind === 'local'
    ? 'local'
    : kind === 'remote' || (kind === 'builtin' && modelKey?.startsWith('app-provider:'))
      ? 'cloud'
      : 'cli';

const priorityForCoreTarget = (kind: HubExecutionTarget['kind']): number =>
  kind === 'local' ? 40 : kind === 'cloud' ? 30 : kind === 'cli' ? 20 : 10;

/** Builds target candidates exclusively from Main-process runtime discovery. */
export const createFoundationHubTargets = async (
  runtime: FoundationCoreRuntime,
  overrides: FoundationExecutionOverrides = {}
): Promise<readonly HubExecutionTarget[]> =>
  Promise.all(
    (await runtime.listTargets())
      .filter((target) => target.available)
      .map(async (target) => {
        const modelKey = overrides.modelKey ?? target.defaultModelKey;
        const kind = kindForCoreTarget(target.kind, modelKey);
        const networkHost = (await runtime.resolveNetworkHost?.(target.id, modelKey)) ?? target.networkHost;
        const hubTarget: HubExecutionTarget = {
          id: target.id,
          kind,
          priority: priorityForCoreTarget(kind),
          requestedCapabilities: ['target.execute'],
          execute: ({ intent, signal }) =>
            runtime.executeToCompletion({
              requestId: overrides.requestId ?? intent.runId,
              targetId: target.id,
              prompt: intent.goal,
              workspace: intent.workspaceScope,
              modelKey,
              permissionMode: overrides.permissionMode ?? 'workspace-write',
              sessionId: overrides.sessionId,
              contextIdentity: overrides.contextIdentity ?? {
                surface: intent.surface,
                agentId: 'tomny',
                personalId: intent.userId,
                capabilityGrants: intent.capabilityGrant ? [...intent.capabilityGrant] : undefined,
              },
              signal: (() => {
                overrides.onCoreExecutionStarted?.();
                return signal;
              })(),
            }),
        };
        if (networkHost) hubTarget.networkHost = networkHost;
        return hubTarget;
      })
  );

/** Executes a Hub run using only Main-discovered direct-core targets. */
export const executeFoundationHubRun = async (
  kernel: RunKernel,
  runtime: FoundationCoreRuntime,
  intent: RunIntent,
  origin: string,
  signal?: AbortSignal,
  overrides?: FoundationExecutionOverrides
) => {
  const targets = await createFoundationHubTargets(runtime, overrides);
  const trustBroker = new TrustBroker({
    allowedCapabilities: ['target.execute'],
    allowedOrigins: [origin],
    allowedNetworkHosts: targets.flatMap((target) => (target.networkHost ? [target.networkHost] : [])),
  });
  return new HubExecutionAdapter(kernel, targets, { trustBroker, origin }).execute(intent, signal);
};

const FOUNDATION_CONVERSATION_ORIGIN = 'tomny://native-conversation';

/**
 * Owns the governed start/cancel lifecycle for every compatibility caller that
 * still relies on ExperimentalCore's streaming transport. Core remains the
 * event producer, while Foundation owns the policy, target choice, lease, and
 * terminal receipt around that transport.
 */
export const createFoundationRunLifecycle = (
  coreRuntime: FoundationCoreRuntime & { cancel: (requestId: string) => Promise<boolean> },
  options: FoundationConversationRuntimeOptions = {}
): FoundationRunLifecycle => {
  const active = new Map<string, AbortController>();
  return {
    start: ({ requestId, targetId, prompt, workspace, modelKey, permissionMode, sessionId, contextIdentity }) => {
      const resolvedSessionId = sessionId ?? requestId;
      const controller = new AbortController();
      active.set(requestId, controller);
      let coreExecutionStarted = false;
      const intent: RunIntent = {
        runId: requestId,
        rootTaskId: `core-session:${resolvedSessionId}`,
        surface: contextIdentity?.surface ?? 'chat',
        goal: prompt,
        constraints: [`target:${targetId}`],
        successCriteria: ['conversation response'],
        workspaceScope: workspace,
        userId: contextIdentity?.personalId ?? 'local-user',
        createdAt: Date.now(),
        correlationId: requestId,
        policyVersion: 'foundation-v1',
        capabilityGrant: [...new Set(['target.execute', ...(contextIdentity?.capabilityGrants ?? [])])],
      };
      const terminal = executeFoundationHubRun(
        options.kernel ?? getGlobalKernel(),
        coreRuntime,
        intent,
        options.origin ?? FOUNDATION_CONVERSATION_ORIGIN,
        controller.signal,
        {
          requestId,
          modelKey,
          permissionMode,
          sessionId,
          contextIdentity,
          onCoreExecutionStarted: () => {
            coreExecutionStarted = true;
          },
        }
      )
        .then((result): NativeConversationStartTerminal | undefined => {
          if (coreExecutionStarted || result.receipt.status === 'verified') return undefined;
          return {
            type: controller.signal.aborted ? 'cancelled' : 'error',
            text: `Foundation run ${result.receipt.status}.`,
          };
        })
        .catch((error: unknown): NativeConversationStartTerminal | undefined => {
          if (coreExecutionStarted) return undefined;
          return {
            type: controller.signal.aborted ? 'cancelled' : 'error',
            text: error instanceof Error ? error.message : 'Foundation execution failed.',
          };
        })
        .finally(() => active.delete(requestId));
      return { requestId, sessionId: resolvedSessionId, terminal };
    },
    cancel: async (requestId) => {
      const controller = active.get(requestId);
      controller?.abort();
      const cancelledCore = await coreRuntime.cancel(requestId);
      return Boolean(controller) || cancelledCore;
    },
  };
};

/**
 * Routes ordinary native conversations through the Foundation policy sequence
 * while retaining the ExperimentalCore event stream consumed by the existing
 * conversation UI. A terminal is returned only when policy rejects before the
 * Core runtime starts, preventing a pending conversation from being stranded.
 */
export const createFoundationConversationRuntime = (
  coreRuntime: FoundationConversationCoreRuntime,
  options: FoundationConversationRuntimeOptions = {}
): NativeConversationRuntime => {
  const lifecycle = createFoundationRunLifecycle(coreRuntime, options);
  return {
    start: (requestId, targetId, prompt, workspace, modelKey, permissionMode, sessionId, _companyId, contextIdentity) =>
      lifecycle.start({ requestId, targetId, prompt, workspace, modelKey, permissionMode, sessionId, contextIdentity }),
    cancel: (requestId) => lifecycle.cancel(requestId),
    inspectContext: (input) => coreRuntime.inspectContext(input),
    resolvePermission: (permissionId, approved, lifetime) =>
      coreRuntime.resolvePermission(permissionId, approved, lifetime),
    resolveOrchestrationProposal: (proposalId, approved) =>
      coreRuntime.resolveOrchestrationProposal(proposalId, approved),
    getSession: (sessionId) => coreRuntime.getSession(sessionId),
    updateSessionConfig: (sessionId, config) => coreRuntime.updateSessionConfig(sessionId, config),
    listModels: (targetId, workspace) => coreRuntime.listModels(targetId, workspace),
  };
};

const getGlobalKernel = (): RunKernel => {
  globalKernel ??= new RunKernel({
    eventStore: new EventStore({
      journal: new JsonlDurableEventStore(path.join(app.getPath('userData'), 'tomny-core', 'runs', 'foundation.jsonl')),
    }),
    contextAdapter: new ContextAdapter({ composer: createElectronContextServices().composer }),
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
