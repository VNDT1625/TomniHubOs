import { createHash } from 'node:crypto';
import type {
  DesignViuErrorCode,
  DesignViuLocalAssetRef,
  DesignViuResult,
  DesignViuSessionValidation,
  DesignViuTransactionRequest,
} from '@/common/packages';
import {
  DESIGN_VIU_NATIVE_CHANNELS,
  isDesignViuTransactionRequest,
  isDesignViuWorkspaceRequest,
  parseDesignViuRendererTransaction,
} from '@/common/packages';
import type { ViuProjectState, ViuTransaction, ViuTransactionResult } from '@/common/viu';

import type { DesignViuContributionManager, FixedDesignViuContributionService } from './designViuContributionManager';

type NativeIpcHost<E> = Readonly<{
  handle: (channel: string, handler: (event: E, payload: unknown) => Promise<unknown>) => void;
  removeHandler: (channel: string) => void;
}>;
/** The constrained session operations exposed by the Design package contract. */
type DesignViuSessionService = Readonly<{
  inspect: (workspaceKey: string) => ViuProjectState;
  validate: (workspaceKey: string) => Readonly<{ valid: boolean; revision: number; diagnostics: readonly unknown[] }>;
  previewTransaction: (workspaceKey: string, transaction: ViuTransaction) => ViuTransactionResult;
  commitTransaction: (workspaceKey: string, transaction: ViuTransaction) => ViuTransactionResult;
}>;

type DesignViuAssetService = Readonly<{
  /** Asset grants are capability-owned; the bridge can only return redacted refs. */
  listAssetRefs: () => readonly DesignViuLocalAssetRef[];
}>;

type DesignViuNativeBridgeDeps<E> = Readonly<{
  host: NativeIpcHost<E>;
  manager: DesignViuContributionManager;
  verifySender: (event: E) => boolean;
  ownerId: (event: E) => string | undefined;
  requireAccount: () => Readonly<{ accountId: string }>;
  sessions: DesignViuSessionService;
  assetService?: (workspaceKey: string) => DesignViuAssetService;
}>;

type DesignViuNativeIpcLifecycleDeps<E> = Readonly<
  Omit<DesignViuNativeBridgeDeps<E>, 'sessions'> & { createSessions: () => DesignViuSessionService }
>;

const result = <T>(data: T): DesignViuResult<T> => Object.freeze({ ok: true, data });
const failure = <T = never>(code: DesignViuErrorCode): DesignViuResult<T> => Object.freeze({ ok: false, code });

/** Main-only account/sender namespace. The renderer's workspace key is never used as a global session key. */
const scopedWorkspaceKey = (accountId: string, ownerId: string, workspaceKey: string): string =>
  `design-viu:${createHash('sha256').update(`${accountId}\u0000${ownerId}\u0000${workspaceKey}`, 'utf8').digest('hex')}`;

const defaultAssetService = (_workspaceKey: string): DesignViuAssetService =>
  Object.freeze({
    // A raw renderer path is never a valid asset grant, so this fixed ABI has no refs by default.
    listAssetRefs: (): readonly DesignViuLocalAssetRef[] => [],
  });

/**
 * Registers only fixed Design Viu operations. No channel accepts an operation
 * name, package identity, account identity, host URL, port, token, or generic
 * payload. Unsafe path/network/persistence operations remain explicitly denied.
 */
export const registerDesignViuNativeIpcBridge = <E>(deps: DesignViuNativeBridgeDeps<E>): (() => void) => {
  const assets = new Map<string, DesignViuAssetService>();
  const assetServiceFor = (workspaceKey: string): DesignViuAssetService => {
    const existing = assets.get(workspaceKey);
    if (existing) return existing;
    const created = deps.assetService?.(workspaceKey) ?? defaultAssetService(workspaceKey);
    assets.set(workspaceKey, created);
    return created;
  };

  const active = (event: E): FixedDesignViuContributionService | DesignViuResult<never> => {
    if (!deps.verifySender(event)) return failure('DESIGN_VIU_SENDER_UNTRUSTED');
    const ownerId = deps.ownerId(event);
    if (!ownerId) return failure('DESIGN_VIU_SENDER_UNTRUSTED');
    try {
      deps.requireAccount();
    } catch {
      return failure('DESIGN_VIU_ACCOUNT_REQUIRED');
    }
    const service = deps.manager.activeService();
    if (!service || service.isCancelled()) return failure('DESIGN_VIU_CONTRIBUTION_INACTIVE');
    return service;
  };

  const forWorkspace = (
    event: E,
    payload: unknown
  ): Readonly<{ service: FixedDesignViuContributionService; workspaceKey: string }> | DesignViuResult<never> => {
    if (!isDesignViuWorkspaceRequest(payload)) return failure('DESIGN_VIU_REQUEST_INVALID');
    const current = active(event);
    if ('ok' in current) return current;
    const ownerId = deps.ownerId(event);
    let account: Readonly<{ accountId: string }>;
    try {
      account = deps.requireAccount();
    } catch {
      return failure('DESIGN_VIU_ACCOUNT_REQUIRED');
    }
    if (!ownerId) return failure('DESIGN_VIU_SENDER_UNTRUSTED');
    return Object.freeze({
      service: current,
      workspaceKey: scopedWorkspaceKey(account.accountId, ownerId, payload.workspaceKey),
    });
  };

  const settle = <T>(service: FixedDesignViuContributionService, value: T): DesignViuResult<T> =>
    service.isCancelled() || deps.manager.activeService() !== service ? failure('DESIGN_VIU_CANCELLED') : result(value);

  const inspect = async (event: E, payload: unknown): Promise<DesignViuResult<ViuProjectState>> => {
    const current = forWorkspace(event, payload);
    if ('ok' in current) return current;
    return settle(current.service, deps.sessions.inspect(current.workspaceKey));
  };
  const validate = async (event: E, payload: unknown): Promise<DesignViuResult<DesignViuSessionValidation>> => {
    const current = forWorkspace(event, payload);
    if ('ok' in current) return current;
    const validation = deps.sessions.validate(current.workspaceKey);
    return settle(
      current.service,
      Object.freeze({ ...validation, diagnostics: structuredClone(validation.diagnostics) })
    );
  };
  const transaction =
    (mode: 'preview' | 'commit') =>
    async (event: E, payload: unknown): Promise<DesignViuResult<ViuTransactionResult>> => {
      if (!isDesignViuTransactionRequest(payload)) return failure('DESIGN_VIU_REQUEST_INVALID');
      const parsed = parseDesignViuRendererTransaction(payload.transaction, mode);
      if (!parsed) return failure('DESIGN_VIU_REQUEST_INVALID');
      const current = forWorkspace(event, { workspaceKey: payload.workspaceKey });
      if ('ok' in current) return current;
      const output =
        mode === 'preview'
          ? deps.sessions.previewTransaction(current.workspaceKey, parsed)
          : deps.sessions.commitTransaction(current.workspaceKey, parsed);
      return settle(current.service, output);
    };
  const listAssets = async (event: E, payload: unknown): Promise<DesignViuResult<DesignViuLocalAssetRef[]>> => {
    const current = forWorkspace(event, payload);
    if ('ok' in current) return current;
    return settle(
      current.service,
      assetServiceFor(current.workspaceKey)
        .listAssetRefs()
        .map((asset) => Object.freeze(structuredClone(asset)))
    );
  };
  const denied = async (event: E): Promise<DesignViuResult<never>> => {
    const current = active(event);
    return 'ok' in current ? current : failure('DESIGN_VIU_OPERATION_DENIED');
  };

  deps.host.handle(DESIGN_VIU_NATIVE_CHANNELS.create, (event, _payload) => denied(event));
  deps.host.handle(DESIGN_VIU_NATIVE_CHANNELS.capture, (event, _payload) => denied(event));
  deps.host.handle(DESIGN_VIU_NATIVE_CHANNELS.analyzeImage, (event, _payload) => denied(event));
  deps.host.handle(DESIGN_VIU_NATIVE_CHANNELS.persist, (event, _payload) => denied(event));
  deps.host.handle(DESIGN_VIU_NATIVE_CHANNELS.v2Inspect, inspect);
  deps.host.handle(DESIGN_VIU_NATIVE_CHANNELS.v2Preview, transaction('preview'));
  deps.host.handle(DESIGN_VIU_NATIVE_CHANNELS.v2Commit, transaction('commit'));
  deps.host.handle(DESIGN_VIU_NATIVE_CHANNELS.v2Validate, validate);
  deps.host.handle(DESIGN_VIU_NATIVE_CHANNELS.assetGrant, (event, _payload) => denied(event));
  deps.host.handle(DESIGN_VIU_NATIVE_CHANNELS.assetList, listAssets);

  return () => {
    for (const channel of Object.values(DESIGN_VIU_NATIVE_CHANNELS)) deps.host.removeHandler(channel);
    assets.clear();
  };
};

/**
 * Defers Design-native channel registration until the reviewed contribution is
 * actually admitted. A clean base keeps no Design IPC handlers; revocation and
 * uninstall remove every handler before the optional package can be reached.
 */
export const createDesignViuNativeIpcLifecycle = <E>(deps: DesignViuNativeIpcLifecycleDeps<E>): (() => void) => {
  const { createSessions, ...bridgeDeps } = deps;
  let unregister: (() => void) | undefined;
  let disposed = false;
  const reconcile = (): void => {
    if (disposed) return;
    if (deps.manager.activeService()) {
      unregister ??= registerDesignViuNativeIpcBridge({ ...bridgeDeps, sessions: createSessions() });
      return;
    }
    unregister?.();
    unregister = undefined;
  };
  const unsubscribe = deps.manager.onStateChanged(reconcile);
  reconcile();
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    unregister?.();
    unregister = undefined;
  };
};
