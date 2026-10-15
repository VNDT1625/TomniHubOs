/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The person's controls over the connections an installed package offers (docs/platform/repotopackage-design.md
 * sections 9.3 and 9.4). The renderer names a package and a connection key; Main finds the package, recomputes what
 * would run, and turns a connection on only for the `approvalHash` of what the person was shown. No request can
 * carry a file path.
 */

export const PACKAGE_CONNECTIONS_CHANNELS = {
  list: 'core.package-connections.list',
  describe: 'core.package-connections.describe',
  enable: 'core.package-connections.enable',
  disable: 'core.package-connections.disable',
  setAutoStart: 'core.package-connections.set-auto-start',
  setPackageEnabled: 'core.package-connections.set-package-enabled',
  rulesList: 'core.package-connections.rules-list',
  rulesAttach: 'core.package-connections.rules-attach',
  rulesDetach: 'core.package-connections.rules-detach',
  servicesList: 'core.package-connections.services-list',
  servicesStart: 'core.package-connections.services-start',
  servicesStop: 'core.package-connections.services-stop',
} as const;

/** Stable error codes; the renderer branches on these, never on message text. */
export type PackageConnectionErrorCode =
  | 'DENIED'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'CANCELLED'
  | 'APPROVAL_REQUIRED'
  | 'UNSUPPORTED'
  | 'RUNTIME_MISSING'
  | 'HOST_FAILED'
  | 'IO_ERROR'
  | 'NOT_ENABLED'
  | 'INVALID_WORKSPACE'
  | 'SERVICE_FAILED';

export type PackageConnectionResult<T> = { ok: true; data: T } | { ok: false; error: PackageConnectionErrorCode };

export type PackageConnectionStatus = 'off' | 'on' | 'needs-input' | 'unsupported' | 'error';

/**
 * Revoking this machine's local signing key (docs/platform/repotopackage-design.md section 9.1). The renderer only asks:
 * Main shows its own native confirmation (default: cancel), revokes, and returns a count. No key id, package id or path
 * is sent in either direction.
 */
export const LOCAL_KEY_CHANNELS = {
  revoke: 'packages.revokeLocalKey',
} as const;

export type LocalKeyRevokeError = 'DENIED' | 'CANCELLED' | 'FAILED';

export type LocalKeyRevokeResult =
  | Readonly<{ ok: true; unsignedPackages: number }>
  | Readonly<{ ok: false; error: LocalKeyRevokeError }>;

export type LocalKeyNativeAPI = {
  /** Asks Main to revoke the local key after its own confirmation. */
  revoke: () => Promise<LocalKeyRevokeResult>;
};

/** Display data of one connection. It never holds a command, an environment value, a path or a secret. */
export type PackageConnectionView = {
  /** `${kind}:${id}` or `skill:${path}`; the only handle the renderer sends back. */
  key: string;
  kind: string;
  title: string;
  description?: string;
  /** Extension format (chrome-mv3, chrome-mv2, userscript); only on extension connections. */
  format?: string;
  /** Plugin folder the connection came from, for grouping. */
  plugin?: string;
  /** Alternatives share a group: turning one on turns the others off. */
  group?: string;
  /** True when turning it on runs code (the person sees a native confirmation first). */
  runsCode: boolean;
  enabled: boolean;
  status: PackageConnectionStatus;
  /** Why it cannot run or needs attention, in words a person can read. */
  reason?: string;
  lastError?: string;
  approvedAt?: number;
  /**
   * Starts again automatically at the next launch, if its approval still matches (code-running kinds only). Absent or
   * false means it is on for this session only.
   */
  autoStart?: boolean;
  /** Required variable names, never secret values or vault handles. */
  requiredEnv?: string[];
};

/** What the person is asked to approve: the lines as Main will show them and the hash that binds a "yes" to them. */
export type PackageConnectionApproval = {
  kind: string;
  title: string;
  lines: { label: string; value: string }[];
  /** Package-relative files whose content is part of the approval. */
  files: string[];
  approvalHash: string;
};

/**
 * Result of the package master switch: the connections it turned on (with the start-again choice the person made) and
 * every connection that is still off after it, each with a reason in words a person can read. Keys are the only handles.
 */
export type PackageEnableReport = {
  enabled: { key: string; kind: string; autoStart: boolean }[];
  stayedOff: { key: string; reason: string }[];
};

/** A rules connection that is on, with the workspaces it is attached to (paths as attached, for display). */
export type PackageRulesEntry = {
  packageId: string;
  connectionId: string;
  title: string;
  format: string;
  workspaces: string[];
};

/** One running or failing service connection (the Active list). No command, path, log line or variable value. */
export type PackageServiceEntry = {
  packageId: string;
  connectionId: string;
  title: string;
  state: 'starting' | 'running' | 'error';
  /** Short, already-redacted reason when the service is in error. */
  error?: string;
};

/**
 * In-app approval of the code-running connections of a package that was just installed (owner decision 2026-10-15).
 * Main sends one request to the main window only; the renderer answers with the same `requestId` and the exact key set
 * Main sent. Main still recomputes every approval hash before anything starts.
 */
export const INSTALL_APPROVAL_CHANNELS = {
  request: 'core.package-connections.install-approval-request',
  respond: 'core.package-connections.install-approval-respond',
  /** Asks Main for the requests still waiting for an answer; the preload replays them to a freshly mounted renderer. */
  pending: 'core.package-connections.install-approval-pending',
} as const;

/** Fixed categories of a row line. The renderer translates them; the host text of a value stays as the host wrote it. */
export type InstallApprovalFieldId = 'command' | 'folder' | 'setup' | 'env' | 'network' | 'url' | 'other';

export type InstallApprovalField = Readonly<{ id: InstallApprovalFieldId; label: string; value: string }>;

/** Identical connections are one row with a count. */
export type InstallApprovalRow = Readonly<{ title: string; count: number; fields: readonly InstallApprovalField[] }>;

export type InstallApprovalRisk = 'setup-install' | 'network-open';

/** The question the dialog asks: the install confirmation, or the one-time start-again approval at app start. */
export type InstallApprovalPrompt = 'install' | 'start-again';

export type InstallApprovalGroupKind = 'mcp' | 'hook' | 'cli' | 'other';

export type InstallApprovalGroup = Readonly<{
  kind: InstallApprovalGroupKind;
  /** The connection kind as the package names it; shown for `other` groups only. */
  kindName: string;
  /** Connections in the group before identical rows were merged. */
  count: number;
  /** Lines every row of a multi-row group shares; shown once for the group. */
  shared: readonly InstallApprovalField[];
  rows: readonly InstallApprovalRow[];
  risks: readonly InstallApprovalRisk[];
}>;

export type InstallApprovalRequest = Readonly<{
  requestId: string;
  packageId: string;
  packageName: string;
  prompt: InstallApprovalPrompt;
  /** Every connection key the request covers. The answer must echo exactly this set. */
  keys: readonly string[];
  groups: readonly InstallApprovalGroup[];
}>;

/** The renderer says approve, cancel, or dismiss (start-again prompt only), and echoes the keys it was shown. */
export type InstallApprovalResponse = Readonly<{
  requestId: string;
  decision: 'approve' | 'cancel' | 'dismiss';
  autoStart: boolean;
  keys: readonly string[];
}>;

export type PackageConnectionsNativeAPI = {
  rulesList: (payload: Record<string, never>) => Promise<PackageConnectionResult<PackageRulesEntry[]>>;
  rulesAttach: (payload: {
    packageId: string;
    connectionId: string;
    workspace: string;
  }) => Promise<PackageConnectionResult<null>>;
  rulesDetach: (payload: {
    packageId: string;
    connectionId: string;
    workspace: string;
  }) => Promise<PackageConnectionResult<null>>;
  servicesList: (payload: Record<string, never>) => Promise<PackageConnectionResult<PackageServiceEntry[]>>;
  servicesStart: (payload: {
    packageId: string;
    connectionId: string;
  }) => Promise<PackageConnectionResult<PackageServiceEntry[]>>;
  servicesStop: (payload: {
    packageId: string;
    connectionId: string;
  }) => Promise<PackageConnectionResult<PackageServiceEntry[]>>;
  list: (payload: { packageId: string }) => Promise<PackageConnectionResult<PackageConnectionView[]>>;
  describe: (payload: {
    packageId: string;
    connectionKey: string;
  }) => Promise<PackageConnectionResult<PackageConnectionApproval>>;
  /** Needs the `approvalHash` returned by `describe`; Main recomputes it and refuses a stale one. */
  enable: (payload: {
    packageId: string;
    connectionKey: string;
    approvalHash: string;
  }) => Promise<PackageConnectionResult<PackageConnectionView>>;
  disable: (payload: {
    packageId: string;
    connectionKey: string;
  }) => Promise<PackageConnectionResult<PackageConnectionView>>;
  /** Chooses whether a code-running connection starts again at the next launch. Runs nothing and approves nothing. */
  setAutoStart: (payload: {
    packageId: string;
    connectionKey: string;
    autoStart: boolean;
  }) => Promise<PackageConnectionResult<PackageConnectionView>>;
  /**
   * The package master switch. Turning it on runs one native confirmation for the code-running connections (default
   * Cancel); data connections switch on without a question. Turning it off turns every connection of the package off.
   */
  setPackageEnabled: (payload: {
    packageId: string;
    enabled: boolean;
  }) => Promise<PackageConnectionResult<PackageEnableReport>>;
  /** Main asks the main window to approve a just-installed package. The listener returns an unsubscribe function. */
  onInstallApprovalRequest: (listener: (request: InstallApprovalRequest) => void) => () => void;
  /** Answers one request. Main refuses an answer whose request id or key set does not match what it sent. */
  respondInstallApproval: (response: InstallApprovalResponse) => Promise<boolean>;
};
