import type {
  PackageIdentity,
  PackageListing,
  PackageAppGroupCreateRequest,
  PackageAppGroupDocument,
  PackageAppGroupReadRequest,
  PackageAppGroupRemoveRequest,
  PackageCapabilityLease,
  PackageCapabilityLeaseRequest,
  PackageCapabilityResult,
  PackageCapabilitySyscall,
  PackageAppGroupRenameRequest,
  PackageAppGroupReorderRequest,
  PackageMutationConsentGrant,
  PackageMutationConsentRequest,
  PackageMutationExecuteRequest,
  GoalSurfacePlan,
  PackageUpdatePermissionConsentApproveRequest,
  PackageUpdatePermissionConsentGrant,
  PackageUpdatePermissionConsentPreparation,
  PackageUpdatePermissionConsentPrepareRequest,
  DesignViuNativeAPI,
} from '../../packages';

export const DESIGN_VIU_NATIVE_CHANNELS = {
  create: 'design-viu.create',
  capture: 'design-viu.capture',
  analyzeImage: 'design-viu.analyze-image',
  persist: 'design-viu.persist',
  v2Inspect: 'design-viu.v2.inspect',
  v2Preview: 'design-viu.v2.preview',
  v2Commit: 'design-viu.v2.commit',
  v2Validate: 'design-viu.v2.validate',
  assetGrant: 'design-viu.asset.grant',
  assetList: 'design-viu.asset.list',
} as const;

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

/** Account status is secret-free. OAuth tokens are never visible to preload or renderer code. */
export const ACCOUNT_SESSION_NATIVE_CHANNELS = {
  getStatus: 'account-session.get-status',
  beginSignIn: 'account-session.begin-sign-in',
  admitSupabaseSession: 'account-session.admit-supabase-session',
  signOut: 'account-session.sign-out',
  getDiagnosticsConsent: 'account-session.get-diagnostics-consent',
  setDiagnosticsConsent: 'account-session.set-diagnostics-consent',
} as const;

/** Account-bound Hub model selection; credentials and account IDs stay in Main. */
export const HUB_MODEL_SELECTION_NATIVE_CHANNELS = {
  get: 'hub-model-selection.get',
  list: 'hub-model-selection.list',
  set: 'hub-model-selection.set',
} as const;

export type HubModelSelectionNativeRecord = Readonly<{
  targetId: string;
  modelKey: string;
  updatedAt: string;
}>;

export type HubModelSelectionNativeResult =
  | Readonly<{ ok: true; selection?: HubModelSelectionNativeRecord }>
  | Readonly<{
      ok: false;
      code:
        | 'HUB_MODEL_SELECTION_SENDER_UNTRUSTED'
        | 'HUB_MODEL_SELECTION_ACCOUNT_REQUIRED'
        | 'HUB_MODEL_SELECTION_REQUEST_INVALID'
        | 'HUB_MODEL_SELECTION_UNAVAILABLE'
        | 'HUB_MODEL_SELECTION_STORAGE_FAILED';
    }>;

export type HubModelSelectionNativeTarget = Readonly<{
  targetId: string;
  modelKeys: readonly string[];
}>;

export type HubModelSelectionCatalogResult =
  | Readonly<{ ok: true; targets: readonly HubModelSelectionNativeTarget[] }>
  | Exclude<HubModelSelectionNativeResult, Readonly<{ ok: true }>>;

export type HubModelSelectionNativeAPI = {
  get(): Promise<HubModelSelectionNativeResult>;
  list(): Promise<HubModelSelectionCatalogResult>;
  set(payload: Readonly<{ targetId: string; modelKey: string }>): Promise<HubModelSelectionNativeResult>;
};

/** Account-bound provider discovery; provider keys never cross the preload boundary. */
export const PROVIDER_DISCOVERY_NATIVE_CHANNELS = {
  fetchModels: 'provider-discovery.fetch-models',
} as const;

export type ProviderDiscoveryNativeResult =
  | Readonly<{ ok: true; models: readonly string[] }>
  | Readonly<{
      ok: false;
      code:
        | 'PROVIDER_DISCOVERY_SENDER_UNTRUSTED'
        | 'PROVIDER_DISCOVERY_ACCOUNT_REQUIRED'
        | 'PROVIDER_DISCOVERY_REQUEST_INVALID'
        | 'PROVIDER_DISCOVERY_PROVIDER_UNAVAILABLE'
        | 'PROVIDER_DISCOVERY_EGRESS_FAILED';
    }>;

export type ProviderDiscoveryNativeAPI = {
  fetchModels(payload: Readonly<{ providerId: string }>): Promise<ProviderDiscoveryNativeResult>;
};

/** The Hub may ask Main to derive a plan, never a target, model, install, or purchase. */
export const HUB_GOAL_SURFACE_PLANNING_NATIVE_CHANNELS = {
  plan: 'hub-goal-surface.plan',
} as const;

export type HubGoalSurfacePlanningNativeResult =
  | Readonly<{ ok: true; plan: GoalSurfacePlan }>
  | Readonly<{
      ok: false;
      code:
        | 'HUB_GOAL_SURFACE_SENDER_UNTRUSTED'
        | 'HUB_GOAL_SURFACE_ACCOUNT_REQUIRED'
        | 'HUB_GOAL_SURFACE_REQUEST_INVALID'
        | 'HUB_GOAL_SURFACE_UNAVAILABLE';
    }>;

export type HubGoalSurfacePlanningNativeAPI = {
  plan(payload: Readonly<{ goal: string }>): Promise<HubGoalSurfacePlanningNativeResult>;
};

/** C4 action calls carry opaque Main-issued IDs only; no target/runtime/goal is accepted. */
export const HUB_GOAL_SURFACE_ACTION_NATIVE_CHANNELS = {
  prepare: 'hub-goal-surface.prepare-local-action',
  execute: 'hub-goal-surface.execute-local-action',
  cancel: 'hub-goal-surface.cancel-local-action',
  listRestartCancelled: 'hub-goal-surface.list-restart-cancelled',
} as const;

export type HubGoalSurfaceActionNativeResult =
  | Readonly<{
      ok: true;
      actionId: string;
      consent: Readonly<{ packageId: string; operationId: string }>;
    }>
  | Readonly<{ ok: true; cancelled: true }>
  | Readonly<{
      ok: true;
      receipt: Readonly<{
        receiptId: string;
        runId: string;
        status: 'verified' | 'failed' | 'cancelled' | 'timed_out' | 'approval_required';
        createdAt: number;
        targetId?: string;
        evidenceRefs: readonly string[];
      }>;
    }>
  | Readonly<{
      ok: false;
      code:
        | 'HUB_GOAL_SURFACE_ACTION_SENDER_UNTRUSTED'
        | 'HUB_GOAL_SURFACE_ACTION_ACCOUNT_REQUIRED'
        | 'HUB_GOAL_SURFACE_ACTION_REQUEST_INVALID'
        | 'HUB_GOAL_SURFACE_ACTION_UNAVAILABLE';
    }>;

/** Redacted terminal recovery evidence for one authenticated account only. */
export type HubGoalSurfaceRestartCancelledNativeObservation = Readonly<{
  runId: string;
  invocationId: string;
  operationId: string;
  state: 'cancelled';
  createdAt: number;
  updatedAt: number;
  progress: readonly Readonly<{
    sequence: number;
    phase: string;
    completed: number;
    total: number;
    observedAt: number;
  }>[];
  artifactRefs: readonly string[];
  evidenceRefs: readonly string[];
  cancellation: Readonly<{ reason: 'restart-recovery'; observedAt: number }>;
}>;

export type HubGoalSurfaceActionRecoveryNativeResult =
  | Readonly<{ ok: true; observations: readonly HubGoalSurfaceRestartCancelledNativeObservation[] }>
  | Exclude<HubGoalSurfaceActionNativeResult, Readonly<{ ok: true }>>;

export type HubGoalSurfaceActionNativeAPI = {
  prepare(payload: Readonly<{ planId: string; stepIndex: number }>): Promise<HubGoalSurfaceActionNativeResult>;
  execute(payload: Readonly<{ actionId: string; consentId: string }>): Promise<HubGoalSurfaceActionNativeResult>;
  cancel(payload: Readonly<{ actionId: string }>): Promise<HubGoalSurfaceActionNativeResult>;
  listRestartCancelled(): Promise<HubGoalSurfaceActionRecoveryNativeResult>;
};

export type AccountSessionNativeSnapshot = Readonly<{
  phase: 'authenticated' | 'unauthenticated';
  accountId?: string;
  displayName?: string;
  expiresAt?: string;
  verifiedAt?: string;
  offlineLocalOnly?: boolean;
}>;

export type AccountSessionNativeSignInResult = Readonly<{
  started: boolean;
  code?: 'ACCOUNT_SIGN_IN_NOT_CONFIGURED' | 'ACCOUNT_SIGN_IN_UNAVAILABLE';
}>;

/** Main validates this short-lived Supabase token handoff and never returns it to the renderer. */
export type AccountSessionNativeSupabaseSession = Readonly<{
  accessToken: string;
  refreshToken?: string;
}>;

export type AccountSessionNativeSupabaseSessionResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      code: 'ACCOUNT_SUPABASE_SESSION_INVALID' | 'ACCOUNT_SUPABASE_NOT_CONFIGURED';
      message: string;
    }>;

/** Secret-free result for the account-gated, device-local diagnostics choice. */
export type AccountDiagnosticsConsentNativeResult =
  | Readonly<{ ok: true; granted: boolean }>
  | Readonly<{
      ok: false;
      code:
        | 'ACCOUNT_DIAGNOSTICS_CONSENT_SENDER_UNTRUSTED'
        | 'ACCOUNT_DIAGNOSTICS_CONSENT_ACCOUNT_REQUIRED'
        | 'ACCOUNT_DIAGNOSTICS_CONSENT_REQUEST_INVALID'
        | 'ACCOUNT_DIAGNOSTICS_CONSENT_UNAVAILABLE';
    }>;

export type AccountSessionNativeAPI = {
  getStatus(): Promise<AccountSessionNativeSnapshot>;
  beginSignIn(): Promise<AccountSessionNativeSignInResult>;
  admitSupabaseSession(
    payload: AccountSessionNativeSupabaseSession
  ): Promise<AccountSessionNativeSupabaseSessionResult>;
  signOut(): Promise<void>;
  getDiagnosticsConsent(): Promise<AccountDiagnosticsConsentNativeResult>;
  setDiagnosticsConsent(payload: Readonly<{ granted: boolean }>): Promise<AccountDiagnosticsConsentNativeResult>;
};

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

export const PUBLISHER_SUBMISSION_NATIVE_CHANNELS = {
  pickAndSubmit: 'package-platform.publisher-submission.pick-and-submit',
} as const;

/** The renderer can request a Main-owned picker only; it never supplies an archive path or bytes. */
export type PublisherSubmissionPickAndSubmitRequest = Readonly<{
  idempotencyKey: string;
}>;

/** Intentionally bounded: no local filename, signing key, token, archive, or raw verification evidence is exposed. */
export type PublisherSubmissionNativeReviewFinding = Readonly<{
  code: string;
  severity: 'warning';
  evidence: string;
  remediation: string;
}>;

export type PublisherSubmissionNativeReceipt = Readonly<{
  submissionId: string;
  packageId: string;
  version: string;
  status: 'auto-approved' | 'human-review-required';
  review: Readonly<{
    disposition: 'auto-approved' | 'human-review-required';
    findings: readonly PublisherSubmissionNativeReviewFinding[];
  }>;
  submittedAt: string;
}>;

export type PublisherSubmissionNativeResult =
  | Readonly<{ ok: true; receipt: PublisherSubmissionNativeReceipt }>
  | Readonly<{
      ok: false;
      code:
        | 'PUBLISHER_SUBMISSION_SENDER_UNTRUSTED'
        | 'PUBLISHER_SUBMISSION_ACCOUNT_REQUIRED'
        | 'PUBLISHER_SUBMISSION_UNAVAILABLE'
        | 'PUBLISHER_SUBMISSION_REQUEST_INVALID'
        | 'PUBLISHER_SUBMISSION_CANCELLED'
        | 'PUBLISHER_SUBMISSION_FAILED';
    }>;

export type PublisherSubmissionNativeAPI = {
  pickAndSubmit(payload: PublisherSubmissionPickAndSubmitRequest): Promise<PublisherSubmissionNativeResult>;
};

export const PACKAGE_RUNTIME_NATIVE_CHANNELS = {
  open: 'package-platform.runtime.open',
  close: 'package-platform.runtime.close',
} as const;

/** Dedicated one-way delivery channel for a Main-owned Surface AI MessagePort. */
export const PACKAGE_SURFACE_AI_RUNTIME_NATIVE_CHANNELS = {
  requestPortHandoff: 'package-platform.surface-ai.request-port-handoff',
  portHandoff: 'package-platform.surface-ai.port-handoff',
} as const;

/**
 * Renderer-supplied identity claim for a local Package App Surface. Main always
 * compares this claim to its currently installed, reviewed package record before
 * registering a sandbox runtime.
 */
export type PackageRuntimeSurfaceIdentity = {
  packageVersion: string;
  publisherId: string;
  moduleId: string;
};

export type PackageRuntimeOpenRequest = {
  packageId: string;
  runtimeId: string;
} & PackageRuntimeSurfaceIdentity;

/** Closing needs only the Main-owned package/runtime binding created on open. */
export type PackageRuntimeCloseRequest = Pick<PackageRuntimeOpenRequest, 'packageId' | 'runtimeId'>;

/** Sender-aware lifecycle API for sandboxed package runtimes. */
export type PackageRuntimeNativeAPI = {
  open(payload: PackageRuntimeOpenRequest): Promise<void>;
  close(payload: PackageRuntimeCloseRequest): Promise<void>;
};

/** Renderer claim only. Main derives the owner identity and verifies every field. */
export type PackageSurfaceAiRuntimePortBindingClaim = Readonly<{
  packageId: string;
  packageVersion: string;
  publisherId: string;
  runtimeId: string;
  moduleId: string;
  artifactIntegrity: string;
}>;

/** The complete binding is emitted by Main only after its exact runtime check. */
export type PackageSurfaceAiRuntimePortBinding = Readonly<{
  surface: PackageIdentity;
  ownerId: string;
  runtimeId: string;
  moduleId: string;
  artifactIntegrity: string;
}>;

export type PackageSurfaceAiRuntimePortHandoffRequest = Readonly<{
  requestId: string;
  binding: PackageSurfaceAiRuntimePortBindingClaim;
}>;

export type PackageSurfaceAiRuntimePortHandoff = Readonly<{
  requestId: string;
  connectionId: string;
  binding: PackageSurfaceAiRuntimePortBinding;
  port: MessagePort;
}>;

/**
 * This API deliberately has no package-controlled invoke operation. The renderer
 * host can request an authenticated handoff and must accept it synchronously for
 * its currently mounted iframe; rejected deliveries are closed in preload.
 */
export type PackageSurfaceAiRuntimeNativeAPI = {
  requestPortHandoff(payload: PackageSurfaceAiRuntimePortHandoffRequest): Promise<void>;
  onPortHandoff(listener: (handoff: PackageSurfaceAiRuntimePortHandoff) => boolean): () => void;
};

/**
 * Explicit per-operation consent for an installed local Package App Surface.
 * Main derives the identity, declaration, destinations, and resource bounds
 * from the reviewed installed manifest; the renderer can only identify the
 * package operation to display and approve a one-time challenge.
 */
export const PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS = {
  requestChallenge: 'package-platform.surface-ai.request-challenge',
  confirmChallenge: 'package-platform.surface-ai.confirm-challenge',
  revokeConsent: 'package-platform.surface-ai.revoke-consent',
  listConsents: 'package-platform.surface-ai.list-consents',
} as const;

export type PackageSurfaceAiAccessChallengeRequest = Readonly<{
  packageId: string;
  operationId: string;
}>;

export type PackageSurfaceAiAccessChallengeDisplay = Readonly<{
  challengeId: string;
  packageId: string;
  packageVersion: string;
  publisherId: string;
  operationId: string;
  capability: string;
  dataClasses: readonly string[];
  destinationIds: readonly string[];
  secretUse: boolean;
  expiresAt: string;
}>;

export type PackageSurfaceAiAccessConsentResult =
  | Readonly<{ ok: true; challenge: PackageSurfaceAiAccessChallengeDisplay }>
  | Readonly<{ ok: true; approved: boolean; consentId?: string; expiresAt?: string }>
  | Readonly<{ ok: true; revoked: boolean }>
  | Readonly<{
      ok: false;
      code:
        | 'PACKAGE_SURFACE_AI_ACCESS_SENDER_UNTRUSTED'
        | 'PACKAGE_SURFACE_AI_ACCESS_ACCOUNT_REQUIRED'
        | 'PACKAGE_SURFACE_AI_ACCESS_REQUEST_INVALID'
        | 'PACKAGE_SURFACE_AI_ACCESS_SURFACE_UNAVAILABLE'
        | 'PACKAGE_SURFACE_AI_ACCESS_OPERATION_UNDECLARED'
        | 'PACKAGE_SURFACE_AI_ACCESS_CHALLENGE_INVALID'
        | 'PACKAGE_SURFACE_AI_ACCESS_CHALLENGE_EXPIRED'
        | 'PACKAGE_SURFACE_AI_ACCESS_CONSENT_UNAVAILABLE';
    }>;

export type PackageSurfaceAiAccessConsentDisplay = Readonly<{
  consentId: string;
  packageId: string;
  packageVersion: string;
  operationId: string;
  expiresAt: string;
}>;

export type PackageSurfaceAiAccessConsentListResult =
  | Readonly<{ ok: true; consents: readonly PackageSurfaceAiAccessConsentDisplay[] }>
  | Exclude<PackageSurfaceAiAccessConsentResult, Readonly<{ ok: true }>>;

export type PackageSurfaceAiAccessNativeAPI = {
  requestChallenge(payload: PackageSurfaceAiAccessChallengeRequest): Promise<PackageSurfaceAiAccessConsentResult>;
  confirmChallenge(
    payload: Readonly<{ challengeId: string; approved: boolean }>
  ): Promise<PackageSurfaceAiAccessConsentResult>;
  revokeConsent(payload: Readonly<{ consentId: string }>): Promise<PackageSurfaceAiAccessConsentResult>;
  listConsents(payload: Readonly<{ packageId: string }>): Promise<PackageSurfaceAiAccessConsentListResult>;
};

export const PACKAGE_CAPABILITY_NATIVE_CHANNELS = {
  activate: 'package-platform.capability.activate',
  invoke: 'package-platform.capability.invoke',
  cancel: 'package-platform.capability.cancel',
} as const;

export type PackageCapabilityCancelRequest = Pick<PackageCapabilityLease, 'leaseId' | 'packageId' | 'runtimeId'>;

/** Main-owned native capability ABI available only through the package host gateway. */
export type PackageCapabilityNativeAPI = {
  activate(payload: PackageCapabilityLeaseRequest): Promise<PackageCapabilityLease>;
  invoke(payload: PackageCapabilitySyscall): Promise<PackageCapabilityResult>;
  cancel(payload: PackageCapabilityCancelRequest): Promise<boolean>;
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
  accountSession?: AccountSessionNativeAPI;
  hubModelSelection?: HubModelSelectionNativeAPI;
  providerDiscovery?: ProviderDiscoveryNativeAPI;
  hubGoalSurfacePlanning?: HubGoalSurfacePlanningNativeAPI;
  hubGoalSurfaceAction?: HubGoalSurfaceActionNativeAPI;
  creatorPreview?: CreatorPreviewNativeAPI;
  packageMutation?: PackageMutationNativeAPI;
  publisherSubmission?: PublisherSubmissionNativeAPI;
  packageRuntime?: PackageRuntimeNativeAPI;
  packageSurfaceAiRuntime?: PackageSurfaceAiRuntimeNativeAPI;
  packageSurfaceAiAccess?: PackageSurfaceAiAccessNativeAPI;
  packageCapability?: PackageCapabilityNativeAPI;
  microsoftStore?: MicrosoftStoreNativeAPI;
  packageAppGroups?: PackageAppGroupNativeAPI;
  designViu?: DesignViuNativeAPI;
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
