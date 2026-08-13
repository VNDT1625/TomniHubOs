/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Main-process contracts for an isolated creator preview. No driver here executes code. */

export type CreatorPreviewState =
  | 'cold'
  | 'preloading'
  | 'warm'
  | 'active'
  | 'suspended'
  | 'evicted'
  | 'failed'
  | 'quarantined';

export type CreatorPreviewQuota = {
  ramMiB: number;
  cpuPercent: number;
  diskMiB: number;
  processes: number;
  timeoutMs: number;
};

export type CreatorPreviewNetworkPolicy = {
  mode: 'blocked' | 'allowlist';
  allowedOrigins: string[];
};

export type CreatorPreviewPolicy = {
  quota: CreatorPreviewQuota;
  network: CreatorPreviewNetworkPolicy;
  requestedCapabilities: string[];
  grantedCapabilities: string[];
};

export type CreatorPreviewOpenRequest = {
  previewId: string;
  projectId: string;
  requestId: string;
  correlationId?: string;
  workspaceRoot: string;
  entrypoint: string;
  policy: CreatorPreviewPolicy;
  signal?: AbortSignal;
  deadlineAt?: number;
};

export type CreatorPreviewOperationRequest = {
  previewId: string;
  requestId: string;
  correlationId?: string;
  signal?: AbortSignal;
};

export type CreatorPreviewCrashRequest = Omit<CreatorPreviewOperationRequest, 'signal'> & {
  /** Stable technical code only. Raw source, prompt and project content are forbidden. */
  code: string;
};

export type CreatorPreviewOperation = 'open' | 'suspend' | 'snapshot' | 'reset' | 'remove' | 'crash';
export type CreatorPreviewReceiptStatus = 'succeeded' | 'failed' | 'cancelled' | 'degraded';

export type CreatorPreviewReceipt = {
  receiptId: string;
  requestId: string;
  correlationId: string;
  previewId: string;
  projectId: string;
  operation: CreatorPreviewOperation;
  status: CreatorPreviewReceiptStatus;
  from: CreatorPreviewState;
  to: CreatorPreviewState;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  code: string;
  snapshotId?: string;
};

export type CreatorPreviewEventType =
  | 'state-transition'
  | 'policy-applied'
  | 'degraded'
  | 'egress-blocked'
  | 'quota-warning'
  | 'crash-contained'
  | 'quarantined'
  | 'receipt';

export type CreatorPreviewEvent = {
  eventId: string;
  sequence: number;
  at: number;
  type: CreatorPreviewEventType;
  /** Request/operation identifier; never arbitrary user text or payload data. */
  requestId: string;
  previewId: string;
  projectId: string;
  correlationId: string;
  state: CreatorPreviewState;
  code: string;
  /** Origin only; paths, query strings, payloads and project data are forbidden. */
  origin?: string;
  resource?: 'ram' | 'cpu' | 'disk' | 'processes' | 'timeout';
};

export type CreatorPreviewSessionSnapshot = {
  previewId: string;
  projectId: string;
  correlationId: string;
  workspaceRoot: string;
  entrypoint: string;
  policy: CreatorPreviewPolicy;
  state: CreatorPreviewState;
  sandboxId?: string;
  previewUrl?: string;
  lastSnapshotId?: string;
  degradedCode?: string;
  lastErrorCode?: string;
  crashCount: number;
  transitionSequence: number;
};

export type CreatorSandboxCapabilities = {
  /** `blocked-only` cannot safely satisfy a non-empty allowlist. */
  networkIsolation: 'none' | 'blocked-only' | 'allowlist';
  quotaEnforcement: boolean;
  snapshots: boolean;
};

export type CreatorSandboxRuntimeEvent =
  | { type: 'egress-blocked'; code: string; origin: string }
  | { type: 'quota-warning'; code: string; resource: 'ram' | 'cpu' | 'disk' | 'processes' | 'timeout' };

export type CreatorSandboxCreateInput = {
  previewId: string;
  projectId: string;
  workspaceRoot: string;
  entrypoint: string;
  policy: CreatorPreviewPolicy;
  signal: AbortSignal;
  /** Structured metadata only. Raw logs, source, prompts and request payloads are forbidden. */
  onEvent(event: CreatorSandboxRuntimeEvent): void;
};

export type CreatorSandboxHandle = { sandboxId: string };

export type CreatorSandboxStartResult = {
  /** `true` only after the driver has observed the isolated surface readiness handshake. */
  ready: true;
  /** Timestamp or monotonic mark recorded by the driver after first meaningful paint. */
  firstMeaningfulPaintAt: number;
  /** The isolated preview endpoint. Never an endpoint hosted by Electron Main. */
  previewUrl?: string;
  /** Stable reason code when the preview is useful but partially degraded. */
  degradedCode?: string;
};

export type CreatorSandboxDriver = {
  capabilities: CreatorSandboxCapabilities;
  create(input: CreatorSandboxCreateInput): Promise<CreatorSandboxHandle>;
  /** Resolve only after the isolated surface readiness/first-meaningful-paint handshake. */
  start(input: { sandboxId: string; signal: AbortSignal }): Promise<CreatorSandboxStartResult>;
  suspend(input: { sandboxId: string }): Promise<void>;
  /** Must tolerate repeated cleanup requests for the same sandbox id. */
  destroy(input: { sandboxId: string }): Promise<void>;
  snapshot?: (input: { sandboxId: string; signal: AbortSignal }) => Promise<{ snapshotId: string }>;
  reset(input: { sandboxId: string; snapshotId?: string; signal: AbortSignal }): Promise<void>;
};

/**
 * Main-process health observation supplied by the driver host. A healthy declaration is
 * required before the preview runtime will call a driver, but is not an OS-isolation claim.
 */
export type CreatorSandboxDriverHealth = {
  state: 'healthy' | 'degraded' | 'unhealthy';
  observedAt: number;
  code: string;
};

/**
 * Trust decision supplied by a trusted main-process integration. This record is not a
 * cryptographic verifier and must not be presented as proof that a driver is isolated.
 */
export type CreatorSandboxDriverAttestation = {
  state: 'accepted' | 'unverified' | 'revoked' | 'expired';
  attestedAt: number;
  expiresAt?: number;
  reference: string;
};

/** Public, data-only driver status. It deliberately never exposes the executable driver object. */
export type CreatorSandboxDriverStatus = {
  driverId: string;
  capabilities: CreatorSandboxCapabilities;
  health: CreatorSandboxDriverHealth;
  attestation: CreatorSandboxDriverAttestation;
};

/**
 * Synchronous observability callbacks for a registry entry. Callback failure is isolated
 * from registry state and never changes the driver trust decision.
 */
export type CreatorSandboxDriverLifecycleCallbacks = {
  onRegistered?(status: CreatorSandboxDriverStatus): void;
  onHealthChanged?(status: CreatorSandboxDriverStatus): void;
  onAttestationChanged?(status: CreatorSandboxDriverStatus): void;
  onUnregistered?(status: CreatorSandboxDriverStatus): void;
};

/**
 * Explicit driver registration owned by trusted main-process wiring. The declared
 * capabilities must match the driver's own capability contract exactly.
 */
export type CreatorSandboxDriverRegistration = {
  driverId: string;
  driver: CreatorSandboxDriver;
  capabilityDeclaration: CreatorSandboxCapabilities;
  health: CreatorSandboxDriverHealth;
  attestation: CreatorSandboxDriverAttestation;
  lifecycle?: CreatorSandboxDriverLifecycleCallbacks;
};

export type CreatorPreviewErrorCode =
  | 'INVALID_PREVIEW_REQUEST'
  | 'POLICY_UNENFORCEABLE'
  | 'SANDBOX_DRIVER_UNAVAILABLE'
  | 'SANDBOX_DRIVER_UNTRUSTED'
  | 'SANDBOX_DRIVER_UNHEALTHY'
  | 'SESSION_NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'IDEMPOTENCY_CAPACITY'
  | 'PREVIEW_CANCELLED'
  | 'PREVIEW_DEADLINE'
  | 'PREVIEW_QUARANTINED'
  | 'PREVIEW_BUSY'
  | 'SNAPSHOT_UNSUPPORTED'
  | 'SANDBOX_DRIVER_FAILURE';
