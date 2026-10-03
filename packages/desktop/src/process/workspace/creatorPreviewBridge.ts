/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main-process IPC contract for creator previews.
 *
 * The generic adapter transports untyped payloads and discards Electron sender
 * metadata. It is therefore not an authority-bearing transport for a sandbox.
 * All generic operations are schema-checked then denied until a dedicated,
 * sender-aware IPC route is registered.
 */

import * as path from 'node:path';
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { bridge } from '@office-ai/platform';
import {
  activateWindowsCreatorSandboxFromProductionConfiguration,
  type ActiveWindowsCreatorSandboxBoundary,
  type WindowsCreatorSandboxProductionActivationResult,
  type WindowsCreatorSandboxProductionConfiguration,
} from '@process/extensions/windowsSandboxActivation';
import { CREATOR_PREVIEW_NATIVE_CHANNELS } from '@/common/types/platform/electron';
import {
  CreatorPreviewBridgePayloadError,
  parseCreatorPreviewCancelRequest,
  parseCreatorPreviewOpenRequest,
  parseCreatorPreviewOperationRequest,
  parseCreatorPreviewStateRequest,
  type CreatorPreviewBridgeAccessPolicy,
  type CreatorPreviewBridgeAccessRequest,
  type CreatorPreviewBridgeCancelRequest,
  type CreatorPreviewBridgeOpenRequest,
  type CreatorPreviewBridgeOperation,
  type CreatorPreviewBridgeOperationRequest,
  type CreatorPreviewBridgeStateRequest,
} from './creatorPreviewBridgeSecurity';
import {
  CreatorPreviewError,
  createCreatorPreviewRuntime,
  createCreatorSandboxDriverRegistry,
  type CreatorPreviewRuntimeOptions,
  type ICreatorPreviewRuntime,
} from './creatorPreviewRuntime';
import type {
  CreatorPreviewErrorCode,
  CreatorPreviewEvent,
  CreatorPreviewOperationRequest,
  CreatorPreviewReceipt,
  CreatorPreviewSessionSnapshot,
} from './creatorPreviewTypes';

export type {
  CreatorPreviewBridgeAccessPolicy,
  CreatorPreviewBridgeAccessRequest,
  CreatorPreviewBridgeCancelRequest,
  CreatorPreviewBridgeOpenRequest,
  CreatorPreviewBridgeOperation,
  CreatorPreviewBridgeOperationRequest,
  CreatorPreviewBridgeStateRequest,
} from './creatorPreviewBridgeSecurity';

export const CREATOR_PREVIEW_CHANNELS = CREATOR_PREVIEW_NATIVE_CHANNELS;

export type CreatorPreviewPublicSession = Omit<
  CreatorPreviewSessionSnapshot,
  'workspaceRoot' | 'entrypoint' | 'sandboxId'
>;

export type CreatorPreviewPublicState = {
  session?: CreatorPreviewPublicSession;
  events: CreatorPreviewEvent[];
  receipts: CreatorPreviewReceipt[];
};

export type CreatorPreviewBridgeErrorCode =
  | CreatorPreviewErrorCode
  | 'CREATOR_PREVIEW_BRIDGE_INACTIVE'
  | 'CREATOR_PREVIEW_UNAUTHORIZED'
  | 'CREATOR_PREVIEW_SENDER_UNVERIFIED'
  | 'CREATOR_PREVIEW_BRIDGE_FAILURE';

export type CreatorPreviewBridgeResult<T> = { ok: true; data: T } | { ok: false; code: CreatorPreviewBridgeErrorCode };

export type CreatorPreviewEventEnvelope = { event: CreatorPreviewEvent };

/** Host adapter that preserves the native sender context for every invoke. */
export type CreatorPreviewTrustedIpcHost<SenderContext> = {
  handle(
    channel: string,
    handler: (sender: SenderContext, payload: unknown) => Promise<CreatorPreviewBridgeResult<unknown>>
  ): void;
  removeHandler(channel: string): void;
};

/** Sender verification is supplied by trusted main-process wiring, never by renderer payload. */
export type CreatorPreviewTrustedSenderVerifier<SenderContext> = {
  verify(sender: SenderContext): boolean | Promise<boolean>;
};

export type CreatorPreviewTrustedSenderIdentity<SenderContext> = {
  identify(sender: SenderContext): string;
  onUnavailable?(listener: (senderId: string) => void): () => void;
};

export type CreatorPreviewTrustedIpcOptions<SenderContext> = {
  runtime: ICreatorPreviewRuntime;
  host: CreatorPreviewTrustedIpcHost<SenderContext>;
  senderVerifier: CreatorPreviewTrustedSenderVerifier<SenderContext>;
  accessPolicy: CreatorPreviewBridgeAccessPolicy<SenderContext>;
  senderIdentity?: CreatorPreviewTrustedSenderIdentity<SenderContext>;
};

export const creatorPreviewChannels = {
  open: bridge.buildProvider<CreatorPreviewBridgeResult<CreatorPreviewReceipt>, CreatorPreviewBridgeOpenRequest>(
    CREATOR_PREVIEW_CHANNELS.open
  ),
  suspend: bridge.buildProvider<
    CreatorPreviewBridgeResult<CreatorPreviewReceipt>,
    CreatorPreviewBridgeOperationRequest
  >(CREATOR_PREVIEW_CHANNELS.suspend),
  snapshot: bridge.buildProvider<
    CreatorPreviewBridgeResult<CreatorPreviewReceipt>,
    CreatorPreviewBridgeOperationRequest
  >(CREATOR_PREVIEW_CHANNELS.snapshot),
  reset: bridge.buildProvider<CreatorPreviewBridgeResult<CreatorPreviewReceipt>, CreatorPreviewBridgeOperationRequest>(
    CREATOR_PREVIEW_CHANNELS.reset
  ),
  remove: bridge.buildProvider<CreatorPreviewBridgeResult<CreatorPreviewReceipt>, CreatorPreviewBridgeOperationRequest>(
    CREATOR_PREVIEW_CHANNELS.remove
  ),
  cancel: bridge.buildProvider<CreatorPreviewBridgeResult<boolean>, CreatorPreviewBridgeCancelRequest>(
    CREATOR_PREVIEW_CHANNELS.cancel
  ),
  getState: bridge.buildProvider<
    CreatorPreviewBridgeResult<CreatorPreviewPublicState>,
    CreatorPreviewBridgeStateRequest
  >(CREATOR_PREVIEW_CHANNELS.getState),
  event: bridge.buildEmitter<CreatorPreviewEventEnvelope>(CREATOR_PREVIEW_CHANNELS.event),
};

class CreatorPreviewBridgeError extends Error {
  constructor(readonly code: CreatorPreviewBridgeErrorCode) {
    super(code);
    this.name = 'CreatorPreviewBridgeError';
  }
}

let activeRuntime: ICreatorPreviewRuntime | undefined;

const requireRuntime = (): ICreatorPreviewRuntime => {
  if (!activeRuntime) {
    throw new CreatorPreviewBridgeError('CREATOR_PREVIEW_BRIDGE_INACTIVE');
  }
  return activeRuntime;
};

const failureCode = (error: unknown): CreatorPreviewBridgeErrorCode => {
  if (
    error instanceof CreatorPreviewError ||
    error instanceof CreatorPreviewBridgeError ||
    error instanceof CreatorPreviewBridgePayloadError
  ) {
    return error.code;
  }
  return 'CREATOR_PREVIEW_BRIDGE_FAILURE';
};

const resolve = async <T>(work: () => T | Promise<T>): Promise<CreatorPreviewBridgeResult<T>> => {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    return { ok: false, code: failureCode(error) };
  }
};

const rejectUnverifiedSender = (): never => {
  throw new CreatorPreviewBridgeError('CREATOR_PREVIEW_SENDER_UNVERIFIED');
};

const denyUnverifiedOperation = async <T>(
  value: unknown,
  parse: (value: unknown) => T
): Promise<CreatorPreviewBridgeResult<CreatorPreviewReceipt>> => {
  try {
    parse(value);
  } catch (error) {
    return { ok: false, code: failureCode(error) };
  }
  return resolve<CreatorPreviewReceipt>(() => {
    requireRuntime();
    return rejectUnverifiedSender();
  });
};

const resetBinding = (): void => {
  activeRuntime = undefined;
};

/**
 * Register generic adapter providers in fail-closed mode.
 *
 * This adapter has no Electron `IpcMainInvokeEvent`, sender WebContents, or main
 * frame identity. A trusted policy cannot repair that missing subject, so this
 * function never dispatches to the sandbox runtime. A future dedicated Creator
 * Preview IPC route must validate its sender before it calls the runtime.
 */
export const registerCreatorPreviewBridge = (runtime?: ICreatorPreviewRuntime): void => {
  resetBinding();
  activeRuntime = runtime;

  creatorPreviewChannels.open.provider((value) => denyUnverifiedOperation(value, parseCreatorPreviewOpenRequest));
  creatorPreviewChannels.suspend.provider((value) =>
    denyUnverifiedOperation(value, parseCreatorPreviewOperationRequest)
  );
  creatorPreviewChannels.snapshot.provider((value) =>
    denyUnverifiedOperation(value, parseCreatorPreviewOperationRequest)
  );
  creatorPreviewChannels.reset.provider((value) => denyUnverifiedOperation(value, parseCreatorPreviewOperationRequest));
  creatorPreviewChannels.remove.provider((value) =>
    denyUnverifiedOperation(value, parseCreatorPreviewOperationRequest)
  );
  creatorPreviewChannels.cancel.provider((value) => {
    try {
      parseCreatorPreviewCancelRequest(value);
    } catch (error) {
      return Promise.resolve<CreatorPreviewBridgeResult<boolean>>({ ok: false, code: failureCode(error) });
    }
    return resolve<boolean>(() => {
      requireRuntime();
      return rejectUnverifiedSender();
    });
  });
  creatorPreviewChannels.getState.provider((value) => {
    try {
      parseCreatorPreviewStateRequest(value);
    } catch (error) {
      return Promise.resolve<CreatorPreviewBridgeResult<CreatorPreviewPublicState>>({
        ok: false,
        code: failureCode(error),
      });
    }
    return resolve<CreatorPreviewPublicState>(() => {
      requireRuntime();
      return rejectUnverifiedSender();
    });
  });
};

/** Remove access to the runtime without disposing its owner. */
export const disposeCreatorPreviewBridge = (): void => {
  resetBinding();
};

const creatorPreviewPendingKey = (previewId: string, requestId: string): string =>
  JSON.stringify([previewId, requestId]);

type CreatorPreviewPendingOperation = {
  controller: AbortController;
  senderId?: string;
};

const toPublicSession = (session: CreatorPreviewSessionSnapshot): CreatorPreviewPublicSession => ({
  previewId: session.previewId,
  projectId: session.projectId,
  correlationId: session.correlationId,
  policy: {
    quota: { ...session.policy.quota },
    network: { ...session.policy.network, allowedOrigins: [...session.policy.network.allowedOrigins] },
    requestedCapabilities: [...session.policy.requestedCapabilities],
    grantedCapabilities: [...session.policy.grantedCapabilities],
  },
  state: session.state,
  previewUrl: session.previewUrl,
  lastSnapshotId: session.lastSnapshotId,
  degradedCode: session.degradedCode,
  lastErrorCode: session.lastErrorCode,
  crashCount: session.crashCount,
  transitionSequence: session.transitionSequence,
});

const toPublicEvent = (event: CreatorPreviewEvent): CreatorPreviewEvent => ({
  eventId: event.eventId,
  sequence: event.sequence,
  at: event.at,
  type: event.type,
  requestId: event.requestId,
  previewId: event.previewId,
  projectId: event.projectId,
  correlationId: event.correlationId,
  state: event.state,
  code: event.code,
  ...(event.origin === undefined ? {} : { origin: event.origin }),
  ...(event.resource === undefined ? {} : { resource: event.resource }),
});

const toPublicReceipt = (receipt: CreatorPreviewReceipt): CreatorPreviewReceipt => ({
  receiptId: receipt.receiptId,
  requestId: receipt.requestId,
  correlationId: receipt.correlationId,
  previewId: receipt.previewId,
  projectId: receipt.projectId,
  operation: receipt.operation,
  status: receipt.status,
  from: receipt.from,
  to: receipt.to,
  startedAt: receipt.startedAt,
  finishedAt: receipt.finishedAt,
  durationMs: receipt.durationMs,
  code: receipt.code,
  ...(receipt.snapshotId === undefined ? {} : { snapshotId: receipt.snapshotId }),
});

/**
 * Register a Creator Preview-only IPC route that retains the native sender context.
 * The host and verifier are injected by Electron main wiring so renderer fields can
 * never manufacture sender identity or project ownership.
 */
export const registerTrustedCreatorPreviewIpcBridge = <SenderContext>(
  options: CreatorPreviewTrustedIpcOptions<SenderContext>
): (() => void) => {
  const { runtime, host, senderVerifier, accessPolicy, senderIdentity } = options;
  const pending = new Map<string, Set<CreatorPreviewPendingOperation>>();
  const registeredChannels: string[] = [];
  let disposed = false;
  const stopSenderUnavailable =
    senderIdentity?.onUnavailable?.((senderId) => {
      for (const operations of pending.values()) {
        for (const operation of operations) {
          if (operation.senderId === senderId) operation.controller.abort();
        }
      }
    }) ?? (() => undefined);

  const assertAdmitted = async (
    sender: SenderContext,
    access: CreatorPreviewBridgeAccessRequest
  ): Promise<string | undefined> => {
    let senderTrusted = false;
    try {
      senderTrusted = await senderVerifier.verify(sender);
    } catch {
      senderTrusted = false;
    }
    if (!senderTrusted) rejectUnverifiedSender();

    let senderId: string | undefined;
    try {
      senderId = senderIdentity?.identify(sender);
      if (senderIdentity && (!senderId || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(senderId))) {
        rejectUnverifiedSender();
      }
    } catch {
      rejectUnverifiedSender();
    }

    let authorized = false;
    try {
      authorized = await accessPolicy.authorize(sender, access);
    } catch {
      authorized = false;
    }
    if (!authorized) throw new CreatorPreviewBridgeError('CREATOR_PREVIEW_UNAUTHORIZED');
    return senderId;
  };

  const runCancellable = async <T>(
    senderId: string | undefined,
    previewId: string,
    requestId: string,
    work: (signal: AbortSignal) => Promise<T>
  ): Promise<T> => {
    const key = creatorPreviewPendingKey(previewId, requestId);
    const operation: CreatorPreviewPendingOperation = { controller: new AbortController(), senderId };
    const operations = pending.get(key) ?? new Set<CreatorPreviewPendingOperation>();
    operations.add(operation);
    pending.set(key, operations);
    try {
      return await work(operation.controller.signal);
    } finally {
      operations.delete(operation);
      if (operations.size === 0 && pending.get(key) === operations) pending.delete(key);
    }
  };

  const operationAccess = (
    operation: CreatorPreviewBridgeOperation,
    previewId: string
  ): CreatorPreviewBridgeAccessRequest => {
    const session = runtime.getSession(previewId);
    return { operation, previewId, projectId: session?.projectId };
  };

  const handleOperation =
    (
      operation: Exclude<CreatorPreviewBridgeOperation, 'open' | 'cancel' | 'get-state'>,
      work: (request: CreatorPreviewOperationRequest) => Promise<CreatorPreviewReceipt>
    ) =>
    async (sender: SenderContext, payload: unknown): Promise<CreatorPreviewBridgeResult<unknown>> =>
      resolve(async () => {
        const request = parseCreatorPreviewOperationRequest(payload);
        const senderId = await assertAdmitted(sender, operationAccess(operation, request.previewId));
        return runCancellable(senderId, request.previewId, request.requestId, (signal) => work({ ...request, signal }));
      });

  const register = (
    channel: string,
    handler: (sender: SenderContext, payload: unknown) => Promise<CreatorPreviewBridgeResult<unknown>>
  ): void => {
    host.handle(channel, handler);
    registeredChannels.push(channel);
  };

  try {
    register(CREATOR_PREVIEW_CHANNELS.open, async (sender, payload) =>
      resolve(async () => {
        const request = parseCreatorPreviewOpenRequest(payload);
        const senderId = await assertAdmitted(sender, {
          operation: 'open',
          previewId: request.previewId,
          projectId: request.projectId,
          workspaceRoot: request.workspaceRoot,
          entrypoint: request.entrypoint,
          requestedCapabilities: request.policy.requestedCapabilities,
        });
        return runCancellable(senderId, request.previewId, request.requestId, (signal) =>
          runtime.open({ ...request, signal })
        );
      })
    );
    register(
      CREATOR_PREVIEW_CHANNELS.suspend,
      handleOperation('suspend', (request) => runtime.suspend(request))
    );
    register(
      CREATOR_PREVIEW_CHANNELS.snapshot,
      handleOperation('snapshot', (request) => runtime.captureSnapshot(request))
    );
    register(
      CREATOR_PREVIEW_CHANNELS.reset,
      handleOperation('reset', (request) => runtime.reset(request))
    );
    register(
      CREATOR_PREVIEW_CHANNELS.remove,
      handleOperation('remove', (request) => runtime.remove(request))
    );
    register(CREATOR_PREVIEW_CHANNELS.cancel, async (sender, payload) =>
      resolve(async () => {
        const request = parseCreatorPreviewCancelRequest(payload);
        const senderId = await assertAdmitted(sender, operationAccess('cancel', request.previewId));
        const operations = pending.get(creatorPreviewPendingKey(request.previewId, request.requestId));
        if (!operations) return false;
        let cancelled = false;
        for (const operation of operations) {
          if (!senderIdentity || operation.senderId === senderId) {
            operation.controller.abort();
            cancelled = true;
          }
        }
        return cancelled;
      })
    );
    register(CREATOR_PREVIEW_CHANNELS.getState, async (sender, payload) =>
      resolve(async () => {
        const request = parseCreatorPreviewStateRequest(payload);
        await assertAdmitted(sender, operationAccess('get-state', request.previewId));
        const session = runtime.getSession(request.previewId);
        return {
          session: session ? toPublicSession(session) : undefined,
          events: runtime.listEvents(request.previewId).map(toPublicEvent),
          receipts: runtime.listReceipts(request.previewId).map(toPublicReceipt),
        } satisfies CreatorPreviewPublicState;
      })
    );
  } catch (error) {
    stopSenderUnavailable();
    for (const channel of registeredChannels.toReversed()) host.removeHandler(channel);
    throw error;
  }

  return () => {
    if (disposed) return;
    disposed = true;
    stopSenderUnavailable();
    for (const operations of pending.values()) {
      for (const operation of operations) operation.controller.abort();
    }
    pending.clear();
    for (const channel of registeredChannels.toReversed()) host.removeHandler(channel);
  };
};

export type CreatorPreviewProjectClaim = {
  projectId: string;
  workspaceRoot: string;
  ownerWebContentsId: number;
};

export type CreatorPreviewOwnershipRevocation = {
  projectIds: string[];
  previewIds: string[];
};

export type CreatorPreviewProjectOwnershipRegistry = {
  claim(claim: CreatorPreviewProjectClaim): () => CreatorPreviewOwnershipRevocation;
  authorize(ownerWebContentsId: number, request: CreatorPreviewBridgeAccessRequest): boolean;
  reservePreview(ownerWebContentsId: number, projectId: string, previewId: string): boolean;
  authorizePreview(ownerWebContentsId: number, projectId: string, previewId: string): boolean;
  releasePreview(previewId: string): boolean;
  revokeOwner(ownerWebContentsId: number): CreatorPreviewOwnershipRevocation;
  getOwner(projectId: string): number | undefined;
};

export type CreatorPreviewProjectOwnershipRegistryOptions = {
  normalizeWorkspaceRoot?: (workspaceRoot: string) => string;
  maxPreviewsPerOwner?: number;
};

type CreatorPreviewStoredProjectClaim = {
  projectId: string;
  workspaceRoot: string;
  ownerWebContentsId: number;
  leases: Set<symbol>;
};

type CreatorPreviewStoredPreviewClaim = {
  previewId: string;
  projectId: string;
  ownerWebContentsId: number;
};

const normalizeProjectIdentifier = (value: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(normalized)) {
    throw new Error('Creator preview project id is invalid.');
  }
  return normalized;
};

const defaultNormalizeWorkspaceRoot = (workspaceRoot: string): string => {
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)) {
    throw new Error('Creator preview workspace root must be absolute.');
  }
  const resolved = path.resolve(workspaceRoot);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

/** Main-process-only project ownership registry. Renderer payloads can query but never mutate it. */
export const createCreatorPreviewProjectOwnershipRegistry = (
  options: CreatorPreviewProjectOwnershipRegistryOptions = {}
): CreatorPreviewProjectOwnershipRegistry => {
  const normalizeWorkspaceRoot = options.normalizeWorkspaceRoot ?? defaultNormalizeWorkspaceRoot;
  const maxPreviewsPerOwner = Math.max(1, Math.min(256, Math.floor(options.maxPreviewsPerOwner ?? 64)));
  const claims = new Map<string, CreatorPreviewStoredProjectClaim>();
  const previews = new Map<string, CreatorPreviewStoredPreviewClaim>();

  return {
    claim: (claim) => {
      const projectId = normalizeProjectIdentifier(claim.projectId);
      if (!Number.isSafeInteger(claim.ownerWebContentsId) || claim.ownerWebContentsId <= 0) {
        throw new Error('Creator preview owner id is invalid.');
      }
      const workspaceRoot = normalizeWorkspaceRoot(claim.workspaceRoot);
      const existing = claims.get(projectId);
      if (
        existing &&
        (existing.ownerWebContentsId !== claim.ownerWebContentsId || existing.workspaceRoot !== workspaceRoot)
      ) {
        throw new Error('Creator preview project already has a different owner.');
      }
      const lease = Symbol(projectId);
      const stored =
        existing ??
        ({
          projectId,
          workspaceRoot,
          ownerWebContentsId: claim.ownerWebContentsId,
          leases: new Set<symbol>(),
        } satisfies CreatorPreviewStoredProjectClaim);
      stored.leases.add(lease);
      claims.set(projectId, stored);
      let released = false;
      return () => {
        if (released) return { projectIds: [], previewIds: [] };
        released = true;
        const current = claims.get(projectId);
        if (current !== stored) return { projectIds: [], previewIds: [] };
        current.leases.delete(lease);
        if (current.leases.size > 0) return { projectIds: [], previewIds: [] };
        const previewIds: string[] = [];
        claims.delete(projectId);
        for (const [previewId, preview] of previews) {
          if (preview.projectId !== projectId) continue;
          previews.delete(previewId);
          previewIds.push(previewId);
        }
        return { projectIds: [projectId], previewIds };
      };
    },
    authorize: (ownerWebContentsId, request) => {
      if (!request.projectId) return false;
      const claim = claims.get(request.projectId);
      if (!claim || claim.ownerWebContentsId !== ownerWebContentsId) return false;
      if (request.operation !== 'open') return true;
      if (!request.workspaceRoot) return false;
      try {
        return normalizeWorkspaceRoot(request.workspaceRoot) === claim.workspaceRoot;
      } catch {
        return false;
      }
    },
    reservePreview: (ownerWebContentsId, projectId, previewId) => {
      const normalizedProjectId = normalizeProjectIdentifier(projectId);
      const normalizedPreviewId = normalizeProjectIdentifier(previewId);
      const project = claims.get(normalizedProjectId);
      if (!project || project.ownerWebContentsId !== ownerWebContentsId) return false;
      const existing = previews.get(normalizedPreviewId);
      if (existing) {
        return existing.ownerWebContentsId === ownerWebContentsId && existing.projectId === normalizedProjectId;
      }
      let ownerPreviewCount = 0;
      for (const preview of previews.values()) {
        if (preview.ownerWebContentsId === ownerWebContentsId) ownerPreviewCount += 1;
      }
      if (ownerPreviewCount >= maxPreviewsPerOwner) return false;
      previews.set(normalizedPreviewId, {
        previewId: normalizedPreviewId,
        projectId: normalizedProjectId,
        ownerWebContentsId,
      });
      return true;
    },
    authorizePreview: (ownerWebContentsId, projectId, previewId) => {
      const preview = previews.get(previewId);
      return (
        preview?.ownerWebContentsId === ownerWebContentsId &&
        preview.projectId === projectId &&
        claims.get(projectId)?.ownerWebContentsId === ownerWebContentsId
      );
    },
    releasePreview: (previewId) => previews.delete(previewId),
    revokeOwner: (ownerWebContentsId) => {
      const projectIds: string[] = [];
      const previewIds: string[] = [];
      for (const [projectId, claim] of claims) {
        if (claim.ownerWebContentsId !== ownerWebContentsId) continue;
        claims.delete(projectId);
        projectIds.push(projectId);
      }
      for (const [previewId, preview] of previews) {
        if (preview.ownerWebContentsId !== ownerWebContentsId) continue;
        previews.delete(previewId);
        previewIds.push(previewId);
      }
      return { projectIds, previewIds };
    },
    getOwner: (projectId) => claims.get(projectId)?.ownerWebContentsId,
  };
};

type CreatorPreviewElectronSenderIdentity = CreatorPreviewTrustedSenderIdentity<IpcMainInvokeEvent> & {
  dispose(): void;
};

const createCreatorPreviewElectronSenderIdentity = (): CreatorPreviewElectronSenderIdentity => {
  const listeners = new Set<(senderId: string) => void>();
  const tracked = new Map<number, { sender: WebContents; onDestroyed: () => void }>();

  const identify = (event: IpcMainInvokeEvent): string => {
    const sender = event.sender;
    if (sender.isDestroyed() || !Number.isSafeInteger(sender.id) || sender.id <= 0) {
      throw new Error('Creator preview sender is unavailable.');
    }
    if (!tracked.has(sender.id)) {
      const onDestroyed = (): void => {
        tracked.delete(sender.id);
        const senderId = String(sender.id);
        for (const listener of listeners) listener(senderId);
      };
      tracked.set(sender.id, { sender, onDestroyed });
      sender.once('destroyed', onDestroyed);
    }
    return String(sender.id);
  };

  return {
    identify,
    onUnavailable: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      listeners.clear();
      for (const { sender, onDestroyed } of tracked.values()) sender.off('destroyed', onDestroyed);
      tracked.clear();
    },
  };
};

const createOwnershipBoundRuntime = (
  runtime: ICreatorPreviewRuntime,
  ownershipRegistry: CreatorPreviewProjectOwnershipRegistry
): ICreatorPreviewRuntime => ({
  open: async (request) => {
    try {
      return await runtime.open(request);
    } catch (error) {
      if (!runtime.getSession(request.previewId)) ownershipRegistry.releasePreview(request.previewId);
      throw error;
    }
  },
  suspend: (request) => runtime.suspend(request),
  captureSnapshot: (request) => runtime.captureSnapshot(request),
  reset: (request) => runtime.reset(request),
  reportCrash: (request) => runtime.reportCrash(request),
  remove: async (request) => {
    const result = await runtime.remove(request);
    ownershipRegistry.releasePreview(request.previewId);
    return result;
  },
  getSession: (previewId) => runtime.getSession(previewId),
  listEvents: (previewId) => runtime.listEvents(previewId),
  listReceipts: (previewId) => runtime.listReceipts(previewId),
  onEvent: (listener) => runtime.onEvent(listener),
  dispose: () => runtime.dispose(),
});

let creatorPreviewTeardownSequence = 0;

const teardownCreatorPreviews = async (
  runtime: ICreatorPreviewRuntime,
  previewIds: readonly string[]
): Promise<void> => {
  const removeOne = async (previewId: string, attempt = 0): Promise<void> => {
    if (!runtime.getSession(previewId)) return;
    try {
      creatorPreviewTeardownSequence += 1;
      await runtime.remove({
        previewId,
        requestId: `owner-teardown-${creatorPreviewTeardownSequence}`,
        correlationId: `owner-teardown-${creatorPreviewTeardownSequence}`,
      });
      return;
    } catch (error) {
      const retryable =
        error instanceof CreatorPreviewError && (error.code === 'PREVIEW_BUSY' || error.code === 'PREVIEW_CANCELLED');
      if (retryable && attempt < 2) {
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 25));
        return removeOne(previewId, attempt + 1);
      }
    }
    if (runtime.getSession(previewId)) {
      console.warn('[CreatorPreview] Owner teardown could not be confirmed.');
    }
  };

  await Promise.allSettled(previewIds.map((previewId) => removeOne(previewId)));
};

export type CreatorPreviewElectronIpcOptions = {
  runtime: ICreatorPreviewRuntime;
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  getMainWindow: () => BrowserWindow | null | undefined;
  ownershipRegistry: CreatorPreviewProjectOwnershipRegistry;
};

/** Bind the trusted Creator Preview contract directly to Electron ipcMain. */
export const registerElectronCreatorPreviewIpcBridge = (options: CreatorPreviewElectronIpcOptions): (() => void) => {
  const senderIdentity = createCreatorPreviewElectronSenderIdentity();
  const trustedRuntime = createOwnershipBoundRuntime(options.runtime, options.ownershipRegistry);
  const host: CreatorPreviewTrustedIpcHost<IpcMainInvokeEvent> = {
    handle: (channel, handler) => {
      options.ipcMain.handle(channel, (event, payload: unknown) => handler(event, payload));
    },
    removeHandler: (channel) => options.ipcMain.removeHandler(channel),
  };
  const disposeTrusted = registerTrustedCreatorPreviewIpcBridge({
    runtime: trustedRuntime,
    host,
    senderIdentity,
    senderVerifier: {
      verify: (event) => {
        const window = options.getMainWindow();
        if (!window || window.isDestroyed() || event.sender.isDestroyed()) return false;
        return event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
      },
    },
    accessPolicy: {
      authorize: (event, request) => {
        const ownerId = event.sender.id;
        if (!options.ownershipRegistry.authorize(ownerId, request) || !request.projectId) return false;
        return request.operation === 'open'
          ? options.ownershipRegistry.reservePreview(ownerId, request.projectId, request.previewId)
          : options.ownershipRegistry.authorizePreview(ownerId, request.projectId, request.previewId);
      },
    },
  });
  const stopOwnershipCleanup = senderIdentity.onUnavailable?.((senderId) => {
    const numericId = Number(senderId);
    if (!Number.isSafeInteger(numericId)) return;
    const revocation = options.ownershipRegistry.revokeOwner(numericId);
    void teardownCreatorPreviews(options.runtime, revocation.previewIds);
  });
  const stopEvents = options.runtime.onEvent((event) => {
    const window = options.getMainWindow();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
    if (options.ownershipRegistry.getOwner(event.projectId) !== window.webContents.id) return;
    window.webContents.send(CREATOR_PREVIEW_CHANNELS.event, { event: toPublicEvent(event) });
  });
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    stopEvents();
    stopOwnershipCleanup?.();
    disposeTrusted();
    senderIdentity.dispose();
  };
};

export const CREATOR_PREVIEW_PRODUCTION_DRIVER_ID = 'tomni.creator-preview.os-sandbox';

const productionDriverRegistry = createCreatorSandboxDriverRegistry();
const productionOwnershipRegistry = createCreatorPreviewProjectOwnershipRegistry();
let productionRuntime: ICreatorPreviewRuntime | undefined;
let disposeProductionIpc: (() => void) | undefined;
let activeProductionWindowsSandbox: ActiveWindowsCreatorSandboxBoundary | undefined;
let productionWindowsSandboxActivation: Promise<WindowsCreatorSandboxProductionActivationResult> | undefined;
let productionWindowsSandboxEpoch = 0;

/**
 * This is the only production registration seam for the Windows Creator Sandbox.
 * Supplying no configuration leaves the registry empty; callers cannot inject a fake
 * client, filesystem, or driver registry through this API.
 */
export const activateProductionWindowsCreatorSandbox = (
  configuration: WindowsCreatorSandboxProductionConfiguration
): Promise<WindowsCreatorSandboxProductionActivationResult> => {
  if (activeProductionWindowsSandbox) return Promise.resolve(activeProductionWindowsSandbox);
  if (productionWindowsSandboxActivation) return productionWindowsSandboxActivation;
  const activationEpoch = productionWindowsSandboxEpoch;
  const activation: Promise<WindowsCreatorSandboxProductionActivationResult> =
    activateWindowsCreatorSandboxFromProductionConfiguration(configuration, productionDriverRegistry).then(
      async (result): Promise<WindowsCreatorSandboxProductionActivationResult> => {
        if (result.state !== 'ready') return result;
        if (
          result.driverId !== CREATOR_PREVIEW_PRODUCTION_DRIVER_ID ||
          activationEpoch !== productionWindowsSandboxEpoch
        ) {
          await result.dispose().catch((): undefined => undefined);
          return { state: 'unavailable', code: 'DRIVER_REGISTRATION_REJECTED' };
        }
        activeProductionWindowsSandbox = result;
        return result;
      }
    );
  productionWindowsSandboxActivation = activation;
  void activation.then(
    () => {
      if (productionWindowsSandboxActivation === activation) productionWindowsSandboxActivation = undefined;
    },
    () => {
      if (productionWindowsSandboxActivation === activation) productionWindowsSandboxActivation = undefined;
    }
  );
  return activation;
};

export const claimProductionCreatorPreviewProject = (claim: CreatorPreviewProjectClaim): (() => void) => {
  const release = productionOwnershipRegistry.claim(claim);
  return () => {
    const revocation = release();
    if (productionRuntime) void teardownCreatorPreviews(productionRuntime, revocation.previewIds);
  };
};

export type ProductionCreatorPreviewBridgeOptions = {
  coordinator: CreatorPreviewRuntimeOptions['coordinator'];
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  getMainWindow: () => BrowserWindow | null | undefined;
};

/** Register the production native route; an absent sandbox driver remains fail-closed. */
export const registerProductionCreatorPreviewBridge = (
  options: ProductionCreatorPreviewBridgeOptions
): (() => void) => {
  disposeProductionIpc?.();
  productionRuntime ??= createCreatorPreviewRuntime({
    coordinator: options.coordinator,
    driverRegistry: productionDriverRegistry,
    driverId: CREATOR_PREVIEW_PRODUCTION_DRIVER_ID,
  });
  const runtime = productionRuntime;
  const dispose = registerElectronCreatorPreviewIpcBridge({
    runtime,
    ipcMain: options.ipcMain,
    getMainWindow: options.getMainWindow,
    ownershipRegistry: productionOwnershipRegistry,
  });
  disposeProductionIpc = dispose;
  return () => {
    if (disposeProductionIpc !== dispose) return;
    disposeProductionIpc = undefined;
    dispose();
  };
};

export const disposeProductionCreatorPreviewBridge = async (): Promise<void> => {
  disposeProductionIpc?.();
  disposeProductionIpc = undefined;
  disposeCreatorPreviewBridge();
  productionWindowsSandboxEpoch += 1;
  await productionWindowsSandboxActivation?.catch((): undefined => undefined);
  const activeSandbox = activeProductionWindowsSandbox;
  activeProductionWindowsSandbox = undefined;
  await activeSandbox?.dispose().catch((): undefined => undefined);
  const runtime = productionRuntime;
  productionRuntime = undefined;
  await runtime?.dispose();
};
