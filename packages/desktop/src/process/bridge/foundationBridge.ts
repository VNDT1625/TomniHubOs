/**
 * IPC bridge exposing Foundation RunKernel to Renderer process.
 */

import { app, BrowserWindow, ipcMain, type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunIntent } from '../../common/foundation/runTypes';
import type { CoreMcpServer } from '../experimentalCore/adapters/coreAdapter';
import { assertRunIntent } from '../../common/foundation/runTypes';
import {
  HUB_GOAL_SURFACE_ACTION_NATIVE_CHANNELS,
  HUB_GOAL_SURFACE_PLANNING_NATIVE_CHANNELS,
  type HubGoalSurfaceActionNativeResult,
  type HubGoalSurfaceActionRecoveryNativeResult,
  type HubGoalSurfacePlanningNativeResult,
  type HubGoalSurfaceRestartCancelledNativeObservation,
} from '@/common/types/platform/electron';
import type { GoalSurfacePlan } from '@/common/packages';
import { JsonlDurableEventStore } from '../services/agentChat/durability';
import { createElectronContextServices } from '../agentRuntime/electronContext';
import { redactSecretText } from '../agentRuntime/agentMesh/security/secretFirewall';
import { ContextAdapter } from '../foundation/contextAdapter';
import { EventStore } from '../foundation/eventStore';
import { HubExecutionAdapter, type HubExecutionTarget } from '../foundation/hubExecutionAdapter';
import { ResourceAdapter } from '../foundation/resourceAdapter';
import { type ActiveRunExecutionContext, type FoundationTrustRuntime, RunKernel } from '../foundation/runKernel';
import { TrustBroker } from '../foundation/trustBroker';
import { getResourceCoordinator } from '../resource/resourceCoordinator';
import type {
  NativeConversationRuntime,
  NativeConversationStartTerminal,
} from '../services/database/nativeConversation/service';
import type { GoalSurfacePlanningCoordinator } from '../resources/packageCapability/goalSurfacePlanningCoordinator';
import type { SurfaceAiActionController } from '../resources/packageCapability/goalCapability/surfaceAiActionController';
import type { SurfaceAiObservationSnapshot } from '../resources/packageProcessRuntime/surfaceAiObservationStore';

let globalKernel: RunKernel | undefined;
let globalTrustRuntime: FoundationTrustRuntime | undefined;

export type FoundationRunPayload = { intent: RunIntent };
export type FoundationCoreContextIdentity = {
  surface?: string;
  agentId?: string;
  personalId?: string;
  permissionScopes?: string[];
  capabilityGrants?: string[];
  availableCapabilities?: string[];
  modelCapabilities?: string[];
  /** Main-only session host descriptors; renderer Foundation IPC cannot provide this field. */
  mcpServers?: CoreMcpServer[];
  /** Main-only bounded derivation mode; renderer Foundation payloads cannot set this override. */
  sterile?: boolean;
  /** Main-only C4 mode: no personal context or built-in tool catalog. */
  suppressPersonalContext?: boolean;
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
/**
 * Main-process-only target source for optional, remote, or package-backed
 * execution. It is deliberately not represented in Foundation IPC payloads.
 */
export type FoundationExternalHubTargetProvider = {
  providerId: string;
  listTargets: () => Promise<readonly HubExecutionTarget[]>;
};

export type FoundationBridgeOptions = {
  coreRuntime: FoundationCoreRuntime;
  externalTargetProviders?: readonly FoundationExternalHubTargetProvider[];
  /** Main-owned authority shared by RunKernel preflight and Hub execution. */
  trustRuntime?: FoundationTrustRuntime;
  /** Main-owned Account authority; renderer payloads never establish a subject. */
  requireAuthenticatedAccount?: () => void;
  /** Main-owned Account subject. Renderer-provided `intent.userId` is never admitted as receipt ownership. */
  accountId?: () => string;
};
export type FoundationExecutionOverrides = {
  requestId?: string;
  modelKey?: string;
  /**
   * Main-only target pin. When present, discovery must contain every requested
   * target; no priority-based fallback is allowed.
   */
  allowedTargetIds?: readonly string[];
  permissionMode?: 'read-only' | 'workspace-write' | 'full-access';
  sessionId?: string;
  contextIdentity?: FoundationCoreContextIdentity;
  /**
   * A Main-created, per-run MCP host. Foundation IPC has no field for this;
   * callers must own both host lifetime and the exact parent Run authority.
   */
  mcpServers?: readonly CoreMcpServer[];
  onCoreExecutionStarted?: () => void;
  /** Main-only callback receiving the currently executing parent Run scope. */
  onActiveRun?: (activeRun: ActiveRunExecutionContext) => void;
  /** Main-only post-Core assertion that can fail the parent before its terminal receipt. */
  validateCoreExecution?: () => void;
  /**
   * A per-run Main-owned Trust authority. This is required when a governed
   * action needs one grant lineage across the selected model target and a
   * delegated package operation; renderer IPC cannot inject it.
   */
  trustBroker?: TrustBroker;
  /**
   * Stronger Main-only composition boundary than `trustBroker`: it binds the
   * RunKernel SecurityAdapter, authenticated actor, policy version, and origin
   * to this exact authority before a run begins.
   */
  trustRuntime?: FoundationTrustRuntime;
  /** Main-process injection point; renderer input cannot select or supply a provider. */
  externalTargetProviders?: readonly FoundationExternalHubTargetProvider[];
};

export type FoundationConversationCoreRuntime = FoundationCoreRuntime &
  Omit<NativeConversationRuntime, 'start' | 'cancel'> & {
    cancel: (requestId: string) => Promise<boolean>;
  };
export type FoundationConversationRuntimeOptions = {
  kernel?: RunKernel;
  origin?: string;
  /** Main-owned runtime shared with the Foundation conversation lifecycle. */
  trustRuntime?: FoundationTrustRuntime;
};
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

const parseHubGoalSurfacePlanningRequest = (value: unknown): Readonly<{ goal: string }> | undefined => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  try {
    const record = value as Record<string, unknown>;
    if (
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0 ||
      Object.keys(record).length !== 1 ||
      Object.keys(record)[0] !== 'goal' ||
      typeof record.goal !== 'string' ||
      !record.goal.trim() ||
      record.goal.length > 10_000 ||
      /\p{Cc}/u.test(record.goal)
    ) {
      return undefined;
    }
    return { goal: record.goal };
  } catch {
    return undefined;
  }
};

export type HubGoalSurfacePlanningBridgeOptions = Readonly<{
  ipcMain?: Pick<IpcMain, 'handle' | 'removeHandler'>;
  coordinator: GoalSurfacePlanningCoordinator;
  requireAuthenticatedAccount: () => void;
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  createRequestId?: () => string;
  now?: () => Date;
  /** Optional Main-only cache for a later exact C4 action controller. */
  planCache?: HubGoalSurfacePlanCache;
  /**
   * A Main-derived, opaque receipt for the account's selected model. When an
   * action cache is enabled, planning must pin this value before and after
   * derivation so a later C4 action cannot silently use a changed model.
   */
  modelSelectionReceipt?: (accountId: string) => Promise<string | undefined>;
  accountId?: () => string;
  ownerIdForEvent?: (event: IpcMainInvokeEvent) => string | undefined;
}>;

export type HubGoalSurfaceActionPlan = Readonly<{
  requestId: string;
  accountId: string;
  ownerId: string;
  modelSelectionReceipt: string;
  goal: string;
  plan: GoalSurfacePlan;
  expiresAt: number;
}>;

export type HubGoalSurfacePlanCache = Readonly<{
  retain: (value: Omit<HubGoalSurfaceActionPlan, 'expiresAt'>) => void;
  take: (requestId: string, accountId: string, ownerId: string) => HubGoalSurfaceActionPlan | undefined;
}>;

/**
 * Ephemeral Main-only bridge between planning and the later C4 action. It is
 * owner/account-bound, short-lived and one-shot so the renderer never returns
 * a forged plan or raw goal to a Surface executor.
 */
export const createHubGoalSurfacePlanCache = (
  options: Readonly<{ now?: () => number; ttlMs?: number }> = {}
): HubGoalSurfacePlanCache => {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 30 * 60_000) {
    throw new Error('HUB_GOAL_SURFACE_PLAN_CACHE_TTL_INVALID');
  }
  const records = new Map<string, HubGoalSurfaceActionPlan>();
  const prune = (): void => {
    const current = now();
    for (const [requestId, record] of records) if (record.expiresAt <= current) records.delete(requestId);
  };
  return Object.freeze({
    retain: (value) => {
      prune();
      if (!value.requestId.trim() || !value.accountId.trim() || !value.ownerId.trim() || !value.goal.trim()) {
        throw new Error('HUB_GOAL_SURFACE_PLAN_CACHE_RECORD_INVALID');
      }
      records.set(
        value.requestId,
        Object.freeze({ ...value, goal: value.goal, plan: structuredClone(value.plan), expiresAt: now() + ttlMs })
      );
    },
    take: (requestId, accountId, ownerId) => {
      prune();
      const record = records.get(requestId);
      if (!record || record.accountId !== accountId || record.ownerId !== ownerId) return undefined;
      records.delete(requestId);
      return Object.freeze({ ...record, plan: structuredClone(record.plan) });
    },
  });
};

/**
 * Direct account-gated goal planning IPC. The renderer contributes only bounded
 * task text; Main creates identity, timestamp, model selection, and planning
 * inputs. The returned plan has no raw goal and cannot enact any step.
 */
export const registerHubGoalSurfacePlanningBridge = (options: HubGoalSurfacePlanningBridgeOptions): (() => void) => {
  const host = options.ipcMain ?? ipcMain;
  const createRequestId = options.createRequestId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  host.handle(
    HUB_GOAL_SURFACE_PLANNING_NATIVE_CHANNELS.plan,
    async (event, raw: unknown): Promise<HubGoalSurfacePlanningNativeResult> => {
      if (!options.verifySender(event)) return { ok: false, code: 'HUB_GOAL_SURFACE_SENDER_UNTRUSTED' };
      try {
        options.requireAuthenticatedAccount();
      } catch {
        return { ok: false, code: 'HUB_GOAL_SURFACE_ACCOUNT_REQUIRED' };
      }
      const request = parseHubGoalSurfacePlanningRequest(raw);
      if (!request) return { ok: false, code: 'HUB_GOAL_SURFACE_REQUEST_INVALID' };
      try {
        let cacheBinding: Readonly<{ accountId: string; ownerId: string; modelSelectionReceipt: string }> | undefined;
        if (options.planCache !== undefined) {
          const accountId = options.accountId?.();
          const ownerId = options.ownerIdForEvent?.(event);
          const modelSelectionReceipt = accountId ? await options.modelSelectionReceipt?.(accountId) : undefined;
          if (!accountId || !ownerId || !modelSelectionReceipt) {
            throw new Error('HUB_GOAL_SURFACE_PLAN_CACHE_OWNER_UNAVAILABLE');
          }
          cacheBinding = { accountId, ownerId, modelSelectionReceipt };
        }
        const plan = await options.coordinator.plan({
          requestId: createRequestId(),
          goal: request.goal,
          requestedAt: now().toISOString(),
        });
        if (options.planCache !== undefined && cacheBinding !== undefined) {
          const currentReceipt = await options.modelSelectionReceipt?.(cacheBinding.accountId);
          if (currentReceipt !== cacheBinding.modelSelectionReceipt) {
            throw new Error('HUB_GOAL_SURFACE_SELECTION_CHANGED');
          }
          options.planCache.retain({
            requestId: plan.requestId,
            ...cacheBinding,
            goal: request.goal,
            plan,
          });
        }
        return { ok: true, plan };
      } catch {
        return { ok: false, code: 'HUB_GOAL_SURFACE_UNAVAILABLE' };
      }
    }
  );
  return () => host.removeHandler(HUB_GOAL_SURFACE_PLANNING_NATIVE_CHANNELS.plan);
};

export type HubGoalSurfaceActionBridgeOptions = Readonly<{
  ipcMain?: Pick<IpcMain, 'handle' | 'removeHandler'>;
  /** Omit outside the explicit C4 pilot: only the inert recovery-query endpoint is registered. */
  controller?: SurfaceAiActionController;
  requireAuthenticatedAccount: () => void;
  accountId: () => string;
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  ownerIdForEvent: (event: IpcMainInvokeEvent) => string | undefined;
  /** Main-only, account-bound terminal recovery evidence; no invocation/replay authority. */
  listRestartCancelledForAccount?: (accountId: string) => Promise<readonly SurfaceAiObservationSnapshot[]>;
}>;

const isOpaqueActionIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200 && /^[A-Za-z0-9._:@/-]+$/.test(value);

const isExactActionPayload = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => key in value);

const isActionContext = (
  value: Readonly<{ accountId: string; ownerId: string }> | HubGoalSurfaceActionNativeResult
): value is Readonly<{ accountId: string; ownerId: string }> => 'accountId' in value;

/** Drops account/package identity and raw runtime state before recovery evidence reaches the renderer. */
const projectRestartCancelledObservation = (
  observation: SurfaceAiObservationSnapshot
): HubGoalSurfaceRestartCancelledNativeObservation => {
  if (observation.state !== 'cancelled' || observation.cancellation?.reason !== 'restart-recovery') {
    throw new Error('HUB_GOAL_SURFACE_RECOVERY_OBSERVATION_INVALID');
  }
  return Object.freeze({
    runId: observation.identity.runId,
    invocationId: observation.identity.invocationId,
    operationId: observation.identity.operationId,
    state: 'cancelled' as const,
    createdAt: observation.createdAt,
    updatedAt: observation.updatedAt,
    progress: Object.freeze(observation.progress.map((progress) => Object.freeze({ ...progress }))),
    artifactRefs: Object.freeze([...(observation.result?.artifactRefs ?? [])]),
    evidenceRefs: Object.freeze([...(observation.result?.evidenceRefs ?? [])]),
    cancellation: Object.freeze({
      reason: observation.cancellation.reason,
      observedAt: observation.cancellation.observedAt,
    }),
  });
};

/**
 * Narrow C4 action IPC. It accepts only opaque IDs and binds them to the exact
 * authenticated account and top-level renderer owner in Main. This bridge
 * does not expose goals, model targets, Package identities, runtimes, or ports.
 */
export const registerHubGoalSurfaceActionBridge = (options: HubGoalSurfaceActionBridgeOptions): (() => void) => {
  const host = options.ipcMain ?? ipcMain;
  const controller = options.controller;
  const contextFor = (
    event: IpcMainInvokeEvent
  ): Readonly<{ accountId: string; ownerId: string }> | HubGoalSurfaceActionNativeResult => {
    if (!options.verifySender(event)) return { ok: false, code: 'HUB_GOAL_SURFACE_ACTION_SENDER_UNTRUSTED' };
    try {
      options.requireAuthenticatedAccount();
      const accountId = options.accountId();
      const ownerId = options.ownerIdForEvent(event);
      if (!isOpaqueActionIdentifier(accountId) || !ownerId || !isOpaqueActionIdentifier(ownerId)) {
        return { ok: false, code: 'HUB_GOAL_SURFACE_ACTION_ACCOUNT_REQUIRED' };
      }
      return { accountId, ownerId };
    } catch {
      return { ok: false, code: 'HUB_GOAL_SURFACE_ACTION_ACCOUNT_REQUIRED' };
    }
  };
  if (controller !== undefined) {
    host.handle(HUB_GOAL_SURFACE_ACTION_NATIVE_CHANNELS.prepare, async (event, raw: unknown) => {
      const context = contextFor(event);
      if (!isActionContext(context)) return context;
      if (!isExactActionPayload(raw, ['planId', 'stepIndex']) || !isOpaqueActionIdentifier(raw.planId)) {
        return {
          ok: false,
          code: 'HUB_GOAL_SURFACE_ACTION_REQUEST_INVALID',
        } satisfies HubGoalSurfaceActionNativeResult;
      }
      if (
        typeof raw.stepIndex !== 'number' ||
        !Number.isSafeInteger(raw.stepIndex) ||
        raw.stepIndex < 0 ||
        raw.stepIndex >= 128
      ) {
        return {
          ok: false,
          code: 'HUB_GOAL_SURFACE_ACTION_REQUEST_INVALID',
        } satisfies HubGoalSurfaceActionNativeResult;
      }
      try {
        const prepared = await controller.prepare({ ...context, planId: raw.planId, stepIndex: raw.stepIndex });
        return { ok: true, ...prepared } satisfies HubGoalSurfaceActionNativeResult;
      } catch {
        return { ok: false, code: 'HUB_GOAL_SURFACE_ACTION_UNAVAILABLE' } satisfies HubGoalSurfaceActionNativeResult;
      }
    });
    host.handle(HUB_GOAL_SURFACE_ACTION_NATIVE_CHANNELS.execute, async (event, raw: unknown) => {
      const context = contextFor(event);
      if (!isActionContext(context)) return context;
      if (
        !isExactActionPayload(raw, ['actionId', 'consentId']) ||
        !isOpaqueActionIdentifier(raw.actionId) ||
        !isOpaqueActionIdentifier(raw.consentId)
      ) {
        return {
          ok: false,
          code: 'HUB_GOAL_SURFACE_ACTION_REQUEST_INVALID',
        } satisfies HubGoalSurfaceActionNativeResult;
      }
      try {
        const receipt = await controller.execute({
          ...context,
          actionId: raw.actionId,
          consentId: raw.consentId,
        });
        return { ok: true, receipt } satisfies HubGoalSurfaceActionNativeResult;
      } catch {
        return { ok: false, code: 'HUB_GOAL_SURFACE_ACTION_UNAVAILABLE' } satisfies HubGoalSurfaceActionNativeResult;
      }
    });
    host.handle(HUB_GOAL_SURFACE_ACTION_NATIVE_CHANNELS.cancel, async (event, raw: unknown) => {
      const context = contextFor(event);
      if (!isActionContext(context)) return context;
      if (!isExactActionPayload(raw, ['actionId']) || !isOpaqueActionIdentifier(raw.actionId)) {
        return {
          ok: false,
          code: 'HUB_GOAL_SURFACE_ACTION_REQUEST_INVALID',
        } satisfies HubGoalSurfaceActionNativeResult;
      }
      try {
        if (!controller.cancel({ ...context, actionId: raw.actionId })) {
          return { ok: false, code: 'HUB_GOAL_SURFACE_ACTION_UNAVAILABLE' } satisfies HubGoalSurfaceActionNativeResult;
        }
        return { ok: true, cancelled: true } satisfies HubGoalSurfaceActionNativeResult;
      } catch {
        return { ok: false, code: 'HUB_GOAL_SURFACE_ACTION_UNAVAILABLE' } satisfies HubGoalSurfaceActionNativeResult;
      }
    });
  }
  host.handle(HUB_GOAL_SURFACE_ACTION_NATIVE_CHANNELS.listRestartCancelled, async (event, raw: unknown) => {
    const context = contextFor(event);
    if (!isActionContext(context)) return context;
    if (raw !== undefined) {
      return {
        ok: false,
        code: 'HUB_GOAL_SURFACE_ACTION_REQUEST_INVALID',
      } satisfies HubGoalSurfaceActionRecoveryNativeResult;
    }
    if (options.listRestartCancelledForAccount === undefined) {
      return {
        ok: false,
        code: 'HUB_GOAL_SURFACE_ACTION_UNAVAILABLE',
      } satisfies HubGoalSurfaceActionRecoveryNativeResult;
    }
    try {
      const observations = await options.listRestartCancelledForAccount(context.accountId);
      return {
        ok: true,
        observations: Object.freeze(observations.map(projectRestartCancelledObservation)),
      } satisfies HubGoalSurfaceActionRecoveryNativeResult;
    } catch {
      return {
        ok: false,
        code: 'HUB_GOAL_SURFACE_ACTION_UNAVAILABLE',
      } satisfies HubGoalSurfaceActionRecoveryNativeResult;
    }
  });
  return () => {
    if (controller !== undefined) {
      host.removeHandler(HUB_GOAL_SURFACE_ACTION_NATIVE_CHANNELS.prepare);
      host.removeHandler(HUB_GOAL_SURFACE_ACTION_NATIVE_CHANNELS.execute);
      host.removeHandler(HUB_GOAL_SURFACE_ACTION_NATIVE_CHANNELS.cancel);
    }
    host.removeHandler(HUB_GOAL_SURFACE_ACTION_NATIVE_CHANNELS.listRestartCancelled);
  };
};

/**
 * Core output and error details are untrusted at the Main-to-renderer boundary.
 * Preserve usable prose while removing credential representations that the
 * shared secret firewall recognises.
 */
export const redactFoundationTextForRenderer = (text: string): string => redactSecretText(text).text;

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

const compareHubTargetIds = (left: HubExecutionTarget, right: HubExecutionTarget): number =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

/**
 * Gives optional Main-process sources a deterministic, fail-closed path into
 * the Hub without letting them replace a Core target or bypass Trust.
 */
const mergeFoundationHubTargets = (
  coreTargets: readonly HubExecutionTarget[],
  externalTargets: readonly HubExecutionTarget[]
): readonly HubExecutionTarget[] => {
  const targetIds = new Set<string>();
  for (const target of [...coreTargets, ...externalTargets]) {
    if (!target.id.trim()) throw new Error('INVALID_FOUNDATION_HUB_TARGET_ID');
    if (targetIds.has(target.id)) throw new Error(`FOUNDATION_HUB_TARGET_ID_COLLISION:${target.id}`);
    targetIds.add(target.id);
  }
  return [...coreTargets, ...externalTargets].toSorted(compareHubTargetIds);
};

const listExternalFoundationHubTargets = async (
  providers: readonly FoundationExternalHubTargetProvider[]
): Promise<readonly HubExecutionTarget[]> => {
  const targetGroups = await Promise.all(
    providers.map(async (provider) => {
      if (!provider.providerId.trim()) throw new Error('INVALID_FOUNDATION_EXTERNAL_TARGET_PROVIDER');
      const targets = await provider.listTargets();
      if (!Array.isArray(targets)) throw new Error(`INVALID_FOUNDATION_EXTERNAL_TARGETS:${provider.providerId}`);
      return targets;
    })
  );
  return targetGroups.flat();
};

/** Builds target candidates exclusively from Main-process runtime discovery. */
export const createFoundationHubTargets = async (
  runtime: FoundationCoreRuntime,
  overrides: FoundationExecutionOverrides = {}
): Promise<readonly HubExecutionTarget[]> => {
  const requestedTargetIds = overrides.allowedTargetIds;
  if (
    requestedTargetIds !== undefined &&
    (requestedTargetIds.length === 0 ||
      requestedTargetIds.some((targetId) => typeof targetId !== 'string' || !targetId.trim()) ||
      new Set(requestedTargetIds).size !== requestedTargetIds.length)
  ) {
    throw new Error('INVALID_FOUNDATION_HUB_TARGET_PIN');
  }
  const allowedTargetIds = requestedTargetIds === undefined ? undefined : new Set(requestedTargetIds);
  const coreTargets = await Promise.all(
    (await runtime.listTargets())
      .filter((target) => target.available && (allowedTargetIds === undefined || allowedTargetIds.has(target.id)))
      .map(async (target) => {
        const modelKey = overrides.modelKey ?? target.defaultModelKey;
        const kind = kindForCoreTarget(target.kind, modelKey);
        const networkHost = (await runtime.resolveNetworkHost?.(target.id, modelKey)) ?? target.networkHost;
        const hubTarget: HubExecutionTarget = {
          id: target.id,
          kind,
          priority: priorityForCoreTarget(kind),
          requestedCapabilities: ['target.execute'],
          execute: async ({ intent, signal, activeRun }) => {
            overrides.onActiveRun?.(activeRun);
            const result = await runtime.executeToCompletion({
              requestId: overrides.requestId ?? intent.runId,
              targetId: target.id,
              prompt: intent.goal,
              workspace: intent.workspaceScope,
              modelKey,
              permissionMode: overrides.permissionMode ?? 'workspace-write',
              sessionId: overrides.sessionId,
              contextIdentity: {
                ...(overrides.contextIdentity ?? {
                  surface: intent.surface,
                  agentId: 'tomny',
                  personalId: intent.userId,
                  capabilityGrants: intent.capabilityGrant ? [...intent.capabilityGrant] : undefined,
                  sterile: overrides.contextIdentity?.sterile === true,
                  suppressPersonalContext: overrides.contextIdentity?.suppressPersonalContext === true,
                }),
                ...(overrides.mcpServers === undefined ? {} : { mcpServers: [...overrides.mcpServers] }),
              },
              signal: (() => {
                overrides.onCoreExecutionStarted?.();
                return signal;
              })(),
            });
            overrides.validateCoreExecution?.();
            return result;
          },
        };
        if (networkHost) hubTarget.networkHost = networkHost;
        return hubTarget;
      })
  );
  const externalTargets = (await listExternalFoundationHubTargets(overrides.externalTargetProviders ?? [])).filter(
    (target) => allowedTargetIds === undefined || allowedTargetIds.has(target.id)
  );
  const merged = mergeFoundationHubTargets(coreTargets, externalTargets);
  if (allowedTargetIds !== undefined && merged.length !== allowedTargetIds.size) {
    throw new Error('FOUNDATION_HUB_TARGET_PIN_UNAVAILABLE');
  }
  return merged;
};

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
  const trustRuntime = overrides?.trustRuntime;
  if (trustRuntime !== undefined) {
    if (overrides?.trustBroker !== undefined && overrides.trustBroker !== trustRuntime.trustBroker) {
      throw new Error('FOUNDATION_TRUST_RUNTIME_BROKER_MISMATCH');
    }
    await trustRuntime.assertRunStart(kernel, intent, origin);
  }
  const discoveredHosts = targets.flatMap((target) => (target.networkHost ? [target.networkHost] : []));
  const trustBroker =
    trustRuntime?.trustBroker ??
    overrides?.trustBroker ??
    new TrustBroker({
      allowedCapabilities: ['target.execute'],
      allowedOrigins: [origin],
      allowedNetworkHosts: discoveredHosts,
    });
  if (
    discoveredHosts.length > 0 &&
    typeof (trustBroker as { allowNetworkHosts?: (hosts: readonly string[]) => void }).allowNetworkHosts === 'function'
  ) {
    (trustBroker as { allowNetworkHosts: (hosts: readonly string[]) => void }).allowNetworkHosts(discoveredHosts);
  }
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
      const trustRuntime = options.trustRuntime ?? globalTrustRuntime;
      let actorUserId: string | undefined;
      if (trustRuntime) {
        try {
          actorUserId = trustRuntime.actorId;
        } catch {
          actorUserId = undefined;
        }
      }
      const intentUserId = actorUserId ?? contextIdentity?.personalId ?? 'local-user';
      const intent: RunIntent = {
        runId: requestId,
        rootTaskId: `core-session:${resolvedSessionId}`,
        surface: contextIdentity?.surface ?? 'chat',
        goal: prompt,
        constraints: [`target:${targetId}`],
        successCriteria: ['conversation response'],
        workspaceScope: workspace,
        userId: intentUserId,
        createdAt: Date.now(),
        correlationId: requestId,
        policyVersion: trustRuntime?.policyVersion ?? 'foundation-v1',
        capabilityGrant: [...new Set(['target.execute', ...(contextIdentity?.capabilityGrants ?? [])])],
      };
      const terminal = executeFoundationHubRun(
        options.kernel ?? getFoundationKernel(options.trustRuntime ?? globalTrustRuntime),
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
          ...(options.trustRuntime === undefined && globalTrustRuntime === undefined
            ? {}
            : { trustRuntime: options.trustRuntime ?? globalTrustRuntime }),
          onCoreExecutionStarted: () => {
            coreExecutionStarted = true;
          },
        }
      )
        .then((result): NativeConversationStartTerminal | undefined => {
          if (coreExecutionStarted || result.receipt.status === 'verified') return undefined;
          console.error('[FoundationConv] Run ended before core started:', result.receipt.status, requestId);
          return {
            type: controller.signal.aborted ? 'cancelled' : 'error',
            text: `Foundation run ${result.receipt.status}.`,
          };
        })
        .catch((error: unknown): NativeConversationStartTerminal | undefined => {
          console.error(
            '[FoundationConv] Run threw before core started:',
            error instanceof Error ? error.message : String(error),
            requestId
          );
          return {
            type: controller.signal.aborted ? 'cancelled' : 'error',
            text: redactFoundationTextForRenderer(
              error instanceof Error ? error.message : 'Foundation execution failed.'
            ),
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

/**
 * Installs the one Foundation trust composition before its durable kernel is
 * created. Rebinding after initialization is rejected rather than silently
 * leaving preflight on a stale broker.
 */
export const configureFoundationTrustRuntime = (trustRuntime: FoundationTrustRuntime): void => {
  if (globalKernel !== undefined && globalKernel.securityAdapter.trustBroker !== trustRuntime.trustBroker) {
    throw new Error('FOUNDATION_TRUST_RUNTIME_ALREADY_INITIALIZED');
  }
  globalTrustRuntime = trustRuntime;
};

/** Returns the process-wide Main-owned runtime without exposing it through IPC. */
export const getConfiguredFoundationTrustRuntime = (): FoundationTrustRuntime | undefined => globalTrustRuntime;

/** Returns the process-wide durable Foundation kernel for Main-process compatibility callers. */
export const getFoundationKernel = (trustRuntime?: FoundationTrustRuntime): RunKernel => {
  if (
    globalKernel !== undefined &&
    trustRuntime !== undefined &&
    globalKernel.securityAdapter.trustBroker !== trustRuntime.trustBroker
  ) {
    throw new Error('FOUNDATION_TRUST_RUNTIME_KERNEL_MISMATCH');
  }
  globalKernel ??= new RunKernel({
    eventStore: new EventStore({
      journal: new JsonlDurableEventStore(path.join(app.getPath('userData'), 'tomny-core', 'runs', 'foundation.jsonl')),
    }),
    contextAdapter: new ContextAdapter({ composer: createElectronContextServices().composer }),
    resourceAdapter: new ResourceAdapter(getResourceCoordinator()),
    ...(trustRuntime === undefined ? {} : { trustRuntime }),
  });
  return globalKernel;
};

export const registerFoundationBridge = ({
  coreRuntime,
  externalTargetProviders,
  trustRuntime = globalTrustRuntime,
  requireAuthenticatedAccount = () => {},
  accountId,
}: FoundationBridgeOptions): void => {
  ipcMain.handle('foundation:execute-run', async (event, rawPayload: unknown) => {
    try {
      const origin = foundationTrustedOrigin(event);
      if (!origin) throw new Error('FOUNDATION_SENDER_REJECTED');
      requireAuthenticatedAccount();
      const payload = parseFoundationRunPayload(rawPayload);
      if (trustRuntime === undefined) throw new Error('FOUNDATION_TRUST_RUNTIME_REQUIRED');
      const mainAccountId = accountId?.();
      if (mainAccountId !== undefined && !mainAccountId.trim()) throw new Error('FOUNDATION_ACCOUNT_REQUIRED');
      const result = await executeFoundationHubRun(
        getFoundationKernel(trustRuntime),
        coreRuntime,
        {
          ...payload.intent,
          ...(mainAccountId === undefined ? {} : { userId: mainAccountId }),
          // Renderer payloads cannot select a policy revision.
          policyVersion: trustRuntime.policyVersion,
        },
        origin,
        undefined,
        {
          externalTargetProviders,
          trustRuntime,
        }
      );
      return {
        success: result.receipt.status === 'verified',
        receipt: result.receipt,
        targetId: result.targetId,
        text: redactFoundationTextForRenderer(result.text),
        ...(result.receipt.status === 'verified'
          ? {}
          : { error: `FOUNDATION_RUN_${result.receipt.status.toUpperCase()}` }),
      };
    } catch {
      console.error('[foundationBridge] Foundation execution rejected.');
      return { success: false, error: 'FOUNDATION_EXECUTION_REJECTED' };
    }
  });

  ipcMain.handle('foundation:get-events', async (event, rawRunId: unknown) => {
    try {
      if (!foundationTrustedOrigin(event)) throw new Error('FOUNDATION_SENDER_REJECTED');
      requireAuthenticatedAccount();
      const mainAccountId = accountId?.();
      if (!mainAccountId?.trim()) throw new Error('FOUNDATION_ACCOUNT_REQUIRED');
      const runId = parseFoundationRunId(rawRunId);
      const kernel = getFoundationKernel();
      const events = await kernel.getEventsForAccount(mainAccountId, runId);
      if (events === undefined) throw new Error('FOUNDATION_EVENTS_OWNER_REJECTED');
      return { success: true, events };
    } catch {
      console.error('[foundationBridge] Foundation events rejected.');
      return { success: false, error: 'FOUNDATION_EVENTS_REJECTED' };
    }
  });
};
