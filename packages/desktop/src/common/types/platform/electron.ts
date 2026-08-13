import type {
  PackageListing,
  PackageAppGroupCreateRequest,
  PackageAppGroupDocument,
  PackageAppGroupReadRequest,
  PackageAppGroupRemoveRequest,
  PackageAppGroupRenameRequest,
  PackageAppGroupReorderRequest,
  PackageMutationConsentGrant,
  PackageMutationConsentRequest,
  PackageMutationExecuteRequest,
  PackageUpdatePermissionConsentApproveRequest,
  PackageUpdatePermissionConsentGrant,
  PackageUpdatePermissionConsentPreparation,
  PackageUpdatePermissionConsentPrepareRequest,
} from '../../packages';

// WebUI ???? / WebUI status interface
export interface WebUIStatus {
  running: boolean;
  port: number;
  allowRemote: boolean;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string;
  adminUsername: string;
  initialPassword?: string;
}

export const CREATOR_PREVIEW_NATIVE_CHANNELS = {
  open: 'creator-preview.open',
  suspend: 'creator-preview.suspend',
  snapshot: 'creator-preview.snapshot',
  reset: 'creator-preview.reset',
  remove: 'creator-preview.remove',
  cancel: 'creator-preview.cancel',
  getState: 'creator-preview.get-state',
  event: 'creator-preview.event',
} as const;

export type CreatorPreviewNativeAPI = {
  open(payload: unknown): Promise<unknown>;
  suspend(payload: unknown): Promise<unknown>;
  snapshot(payload: unknown): Promise<unknown>;
  reset(payload: unknown): Promise<unknown>;
  remove(payload: unknown): Promise<unknown>;
  cancel(payload: unknown): Promise<unknown>;
  getState(payload: unknown): Promise<unknown>;
  onEvent(callback: (payload: unknown) => void): () => void;
};

export const PACKAGE_MUTATION_NATIVE_CHANNELS = {
  requestConsent: 'package-platform.mutation.request-consent',
  preparePermissionConsent: 'package-platform.mutation.prepare-permission-consent',
  approvePermissionConsent: 'package-platform.mutation.approve-permission-consent',
  execute: 'package-platform.mutation.execute',
} as const;

export type PackageMutationNativeAPI = {
  requestConsent(payload: PackageMutationConsentRequest): Promise<PackageMutationConsentGrant>;
  preparePermissionConsent(
    payload: PackageUpdatePermissionConsentPrepareRequest
  ): Promise<PackageUpdatePermissionConsentPreparation>;
  approvePermissionConsent(
    payload: PackageUpdatePermissionConsentApproveRequest
  ): Promise<PackageUpdatePermissionConsentGrant>;
  execute(payload: PackageMutationExecuteRequest): Promise<PackageListing>;
};

export const PACKAGE_RUNTIME_NATIVE_CHANNELS = {
  open: 'package-platform.runtime.open',
  close: 'package-platform.runtime.close',
} as const;

export type PackageRuntimeOpenRequest = {
  packageId: string;
  runtimeId: string;
};

export type PackageRuntimeCloseRequest = PackageRuntimeOpenRequest;

/** Sender-aware lifecycle API for sandboxed package runtimes. */
export type PackageRuntimeNativeAPI = {
  open(payload: PackageRuntimeOpenRequest): Promise<void>;
  close(payload: PackageRuntimeCloseRequest): Promise<void>;
};

export const MICROSOFT_STORE_NATIVE_CHANNELS = {
  requestConsent: 'package-platform.microsoft-store.request-consent',
  execute: 'package-platform.microsoft-store.execute',
  openStorePage: 'package-platform.microsoft-store.open-store-page',
} as const;

export type MicrosoftStoreNativeAction = 'install' | 'launch';

export type MicrosoftStoreNativeConsentRequest = {
  action: MicrosoftStoreNativeAction;
  linkedAppId: string;
  region: string;
  idempotencyKey: string;
};

export type MicrosoftStoreNativeExecuteRequest = MicrosoftStoreNativeConsentRequest & {
  consentId: string;
};

export type MicrosoftStoreNativeOpenPageRequest = {
  productId: string;
};

export type MicrosoftStoreNativeOpenPageReceipt = {
  productId: string;
};

export type MicrosoftStoreNativeIdentity = {
  packageFamilyName: string;
  publisherIdentity: string;
  version: string;
};

export type MicrosoftStoreNativeExecutionReceipt = {
  receiptId: string;
  action: MicrosoftStoreNativeAction;
  linkedAppId: string;
  identity: MicrosoftStoreNativeIdentity;
};

export type MicrosoftStoreNativeErrorCode =
  | 'MICROSOFT_STORE_SENDER_UNTRUSTED'
  | 'MICROSOFT_STORE_OWNER_UNAVAILABLE'
  | 'MICROSOFT_STORE_REQUEST_INVALID'
  | 'MICROSOFT_STORE_CONSENT_DENIED'
  | 'MICROSOFT_STORE_ACTION_FAILED'
  | 'MICROSOFT_STORE_BRIDGE_FAILURE';

export type MicrosoftStoreNativeResult<T> = { ok: true; data: T } | { ok: false; code: MicrosoftStoreNativeErrorCode };

export type MicrosoftStoreNativeConsentGrant = {
  consentId: string;
  expiresAt: string;
};

/** Sender-aware, consent-gated Microsoft Store API. Uninstall is intentionally absent. */
export type MicrosoftStoreNativeAPI = {
  requestConsent(
    payload: MicrosoftStoreNativeConsentRequest
  ): Promise<MicrosoftStoreNativeResult<MicrosoftStoreNativeConsentGrant>>;
  execute(
    payload: MicrosoftStoreNativeExecuteRequest
  ): Promise<MicrosoftStoreNativeResult<MicrosoftStoreNativeExecutionReceipt>>;
  openStorePage(
    payload: MicrosoftStoreNativeOpenPageRequest
  ): Promise<MicrosoftStoreNativeResult<MicrosoftStoreNativeOpenPageReceipt>>;
};

export const PACKAGE_APP_GROUP_NATIVE_CHANNELS = {
  read: 'package-platform.app-groups.read',
  create: 'package-platform.app-groups.create',
  rename: 'package-platform.app-groups.rename',
  reorder: 'package-platform.app-groups.reorder',
  remove: 'package-platform.app-groups.remove',
} as const;

export type PackageAppGroupNativeResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code:
        | 'APP_GROUP_BRIDGE_UNAUTHORIZED'
        | 'APP_GROUP_REQUEST_INVALID'
        | 'APP_GROUP_NOT_FOUND'
        | 'APP_GROUP_ORDER_INVALID'
        | 'APP_GROUP_ID_CONFLICT'
        | 'APP_GROUP_SCOPE_LIMIT'
        | 'APP_GROUP_BRIDGE_FAILURE';
    };

/** Native sender-aware API for user/workspace app-group state. */
export type PackageAppGroupNativeAPI = {
  read(payload: PackageAppGroupReadRequest): Promise<PackageAppGroupNativeResult<PackageAppGroupDocument>>;
  create(payload: PackageAppGroupCreateRequest): Promise<PackageAppGroupNativeResult<PackageAppGroupDocument>>;
  rename(payload: PackageAppGroupRenameRequest): Promise<PackageAppGroupNativeResult<PackageAppGroupDocument>>;
  reorder(payload: PackageAppGroupReorderRequest): Promise<PackageAppGroupNativeResult<PackageAppGroupDocument>>;
  remove(payload: PackageAppGroupRemoveRequest): Promise<PackageAppGroupNativeResult<PackageAppGroupDocument>>;
};

export interface ElectronBridgeAPI {
  emit: (name: string, data: unknown) => Promise<unknown> | void;
  on: (callback: (event: { value: string }) => void) => void;
  // ??????/??????? / Get absolute path for dragged file/directory
  getPathForFile?: (file: File) => string;
  // Feedback log collection / ??????
  collectFeedbackLogs?: () => Promise<{ filename: string; data: number[] } | null>;
  // Feedback screenshot capture / ????
  captureFeedbackScreenshot?: () => Promise<{ filename: string; data: number[] } | null>;
  creatorPreview?: CreatorPreviewNativeAPI;
  packageMutation?: PackageMutationNativeAPI;
  packageRuntime?: PackageRuntimeNativeAPI;
  microsoftStore?: MicrosoftStoreNativeAPI;
  packageAppGroups?: PackageAppGroupNativeAPI;
}

export type BackendStartupFailureReason =
  | 'backend_incompatible_runtime'
  | 'backend_incomplete_installation'
  | 'backend_startup_failed';

export interface BackendStartupFailureInfo {
  reason: BackendStartupFailureReason;
  runtime?: 'glibc';
  requiredVersions?: string[];
  missingResources?: string[];
}

declare global {
  interface Window {
    electronAPI?: ElectronBridgeAPI;
    __backendStartupFailed?: boolean;
    __backendStartupFailure?: BackendStartupFailureInfo | null;
    __studioSplitRouteRedirectEnabled?: boolean;
  }
}
