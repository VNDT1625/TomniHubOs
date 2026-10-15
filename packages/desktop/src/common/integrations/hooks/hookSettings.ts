/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The person's controls over Tomny hooks (docs/platform/repotopackage-design.md sections 11.6 and 14, surface S10).
 * The renderer names a hook by its opaque id; Main finds it, recomputes what would run and turns it on only for the
 * `approvalHash` of what the person was shown. No request can carry a file path, and no view holds one.
 */

export const HOOK_SETTINGS_CHANNELS = {
  list: 'core.hooks.list',
  describe: 'core.hooks.describe',
  approve: 'core.hooks.approve',
  setEnabled: 'core.hooks.set-enabled',
  setDisableAll: 'core.hooks.set-disable-all',
  setSourceEnabled: 'core.hooks.set-source-enabled',
  createUser: 'core.hooks.create-user',
  removeUser: 'core.hooks.remove-user',
  audit: 'core.hooks.audit',
  coverage: 'core.hooks.coverage',
} as const;

/** Stable error codes; the renderer branches on these, never on message text. */
export type HookSettingsErrorCode =
  | 'DENIED'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'CANCELLED'
  | 'UNAVAILABLE'
  | 'UNSUPPORTED'
  | 'FORBIDDEN'
  | 'NEEDS_CONSENT'
  | 'HASH_MISMATCH'
  | 'APPROVAL_REQUIRED'
  | 'IO_ERROR';

export type HookSettingsResult<T> = { ok: true; data: T } | { ok: false; error: HookSettingsErrorCode };

/** Narrows a failure; the repository's compiler settings do not narrow on `ok` in the negative branch. */
export const isHookSettingsFailure = <T>(
  result: HookSettingsResult<T>
): result is { ok: false; error: HookSettingsErrorCode } => !result.ok;

export type HookSettingsSource = 'package' | 'user' | 'workspace';

/** Why a hook is or is not runnable. */
export type HookSettingsStatus =
  | 'ready'
  | 'needs-approval'
  | 'needs-consent'
  | 'stale'
  | 'disabled'
  | 'unsupported'
  | 'forbidden';

/** Display data of one hook. The command is already stripped of the hook's own paths; there is no hash. */
export type HookSettingsRow = {
  /** Opaque id; the only handle the renderer sends back. */
  id: string;
  source: HookSettingsSource;
  pluginId?: string;
  event: string;
  matcher?: string;
  form: 'exec' | 'shell';
  command: string;
  args?: string[];
  timeoutSec: number;
  status: HookSettingsStatus;
  statusReason?: string;
  approved: boolean;
  approvedAt?: number;
  /** True when the hook would run now: ready, and neither the global nor its source switch is off. */
  active: boolean;
};

export type HookSettingsSwitches = { disableAll: boolean; sources: Record<HookSettingsSource, boolean> };

export type HookSettingsList = { hooks: HookSettingsRow[]; switches: HookSettingsSwitches };

/** A line of the approval dialog. The renderer translates `key`; `value` is data. */
export type HookSettingsLineKey =
  | 'source'
  | 'plugin'
  | 'event'
  | 'matcher'
  | 'form'
  | 'command'
  | 'args'
  | 'timeout'
  | 'file'
  | 'unpinned'
  | 'network';

export type HookSettingsDescription = {
  hookId: string;
  lines: { key: HookSettingsLineKey; value: string }[];
  /** Binds a "yes" to exactly these lines. Main recomputes it and refuses a different one. */
  approvalHash: string;
};

/** One audit line. Lengths and codes only: never input, never raw output, never a path. */
export type HookSettingsAuditLine = {
  ts: string;
  event: string;
  hookId?: string;
  source: HookSettingsSource;
  pluginId?: string;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  decision: 'deny' | 'ask' | 'block' | 'stop' | 'none';
  stdoutLength: number;
  stderrLength: number;
  errorCode?: string;
};

/** Which kinds of agent a tool hook can stop, stated by Main from the same table the runtime uses. */
export type HookSettingsCoverageAgent = 'tomny' | 'acpAsk' | 'acpAuto' | 'codex' | 'remote';

export type HookSettingsCoverageRow = {
  agent: HookSettingsCoverageAgent;
  preToolUse: 'all-tools' | 'permission-requests-only' | 'none';
  postToolUse: 'result-text' | 'metadata-only' | 'none';
};

/** A user hook to add. It stays off until the person approves it. `args` present means exec form. */
export type HookSettingsNewUserHook = {
  event: string;
  matcher?: string;
  command: string;
  args?: string[];
  timeoutSec: number;
};

export type HookSettingsNativeAPI = {
  list: () => Promise<HookSettingsResult<HookSettingsList>>;
  describe: (payload: { hookId: string }) => Promise<HookSettingsResult<HookSettingsDescription>>;
  /** Needs the `approvalHash` returned by `describe`; Main recomputes it, refuses a stale one and asks natively. */
  approve: (payload: { hookId: string; approvalHash: string }) => Promise<HookSettingsResult<HookSettingsRow>>;
  setEnabled: (payload: { hookId: string; enabled: boolean }) => Promise<HookSettingsResult<HookSettingsRow>>;
  setDisableAll: (payload: { disabled: boolean }) => Promise<HookSettingsResult<HookSettingsSwitches>>;
  setSourceEnabled: (payload: {
    source: HookSettingsSource;
    enabled: boolean;
  }) => Promise<HookSettingsResult<HookSettingsSwitches>>;
  createUser: (payload: HookSettingsNewUserHook) => Promise<HookSettingsResult<HookSettingsRow>>;
  removeUser: (payload: { hookId: string }) => Promise<HookSettingsResult<{ removed: true }>>;
  audit: (payload?: { limit?: number }) => Promise<HookSettingsResult<HookSettingsAuditLine[]>>;
  coverage: () => Promise<HookSettingsResult<HookSettingsCoverageRow[]>>;
};
