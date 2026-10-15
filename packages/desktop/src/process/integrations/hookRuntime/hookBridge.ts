/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import {
  HOOK_SETTINGS_CHANNELS,
  type HookSettingsAuditLine,
  type HookSettingsCoverageAgent,
  type HookSettingsCoverageRow,
  type HookSettingsDescription,
  type HookSettingsErrorCode,
  type HookSettingsList,
  type HookSettingsResult,
  type HookSettingsRow,
  type HookSettingsSwitches,
} from '@/common/integrations/hooks/hookSettings';
import type {
  HookRegistry,
  HookRegistryErrorCode,
  HookRegistryResult,
  HookView,
} from '@process/integrations/hooks/hookRegistry';
import type { HookAuditRecord } from '@process/integrations/hooks/hookAudit';
import { userHookRecordSchema } from '@process/integrations/hooks/hookRegistryStore';
import type { HookCoverage, HookPermissionMode } from '@process/integrations/hookRuntime/hookDispatcher';

const HOOK_ID = z.string().regex(/^[a-f0-9]{64}$/u);
const APPROVAL_HASH = z.string().regex(/^sha256-[a-f0-9]{64}$/u);
const SOURCE = z.enum(['package', 'user', 'workspace']);

// `.strict()` everywhere: a request that carries a path, a directory or anything else unknown is refused whole.
const NO_REQUEST = z.object({}).strict();
const ID_REQUEST = z.object({ hookId: HOOK_ID }).strict();
const APPROVE_REQUEST = z.object({ hookId: HOOK_ID, approvalHash: APPROVAL_HASH }).strict();
const ENABLED_REQUEST = z.object({ hookId: HOOK_ID, enabled: z.boolean() }).strict();
const DISABLE_ALL_REQUEST = z.object({ disabled: z.boolean() }).strict();
const SOURCE_REQUEST = z.object({ source: SOURCE, enabled: z.boolean() }).strict();
const AUDIT_REQUEST = z.object({ limit: z.number().int().min(1).max(200).optional() }).strict();

const MAX_TEXT = 2000;

/** Agents whose coverage the page states, and the protocol and permission mode Main asks the runtime table about. */
const COVERAGE_AGENTS: ReadonlyArray<{
  agent: HookSettingsCoverageAgent;
  protocol: string;
  mode: HookPermissionMode;
}> = [
  { agent: 'tomny', protocol: 'tomny-json-stream', mode: 'workspace-write' },
  { agent: 'acpAsk', protocol: 'acp', mode: 'workspace-write' },
  { agent: 'acpAuto', protocol: 'acp', mode: 'read-only' },
  { agent: 'codex', protocol: 'codex-app-server', mode: 'workspace-write' },
  { agent: 'remote', protocol: 'tomny-remote-v1', mode: 'workspace-write' },
];

/** Receipts never carry a command, a path, a hash or a value. */
type Audit = { subjectId: string; operation: string; status: 'completed' | 'failed' };

export type HookSettingsBridgeOptions = Readonly<{
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  /** Resolves undefined when hooks are unavailable (the page then says so). */
  getRegistry: () => Promise<
    | Pick<
        HookRegistry,
        | 'listHooks'
        | 'describeHook'
        | 'approveHook'
        | 'setHookEnabled'
        | 'setDisableAll'
        | 'setSourceEnabled'
        | 'getSwitches'
        | 'addUserHook'
        | 'removeUserHook'
        | 'readAudit'
      >
    | undefined
  >;
  /** The runtime's own coverage table, so the page can never claim more than the runtime does. */
  coverageOf: (protocol: string, permissionMode: HookPermissionMode) => HookCoverage;
  /**
   * Native confirmation, built by Main from `describeHook`. A hook runs code on this computer, so the renderer cannot
   * answer it and cannot change what it shows.
   */
  confirmApprove: (
    event: IpcMainInvokeEvent,
    detail: Readonly<{ hookId: string; lines: readonly { key: string; value: string }[] }>
  ) => Promise<boolean>;
  audit?: (record: Audit) => Promise<void>;
}>;

const fail = (error: HookSettingsErrorCode): { ok: false; error: HookSettingsErrorCode } => ({ ok: false, error });

const clip = (value: string): string => (value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT - 1)}…` : value);

const REGISTRY_ERRORS: Record<HookRegistryErrorCode, HookSettingsErrorCode> = {
  HOOK_NOT_FOUND: 'NOT_FOUND',
  HOOK_UNSUPPORTED: 'UNSUPPORTED',
  HOOK_FORBIDDEN: 'FORBIDDEN',
  HOOK_NEEDS_CONSENT: 'NEEDS_CONSENT',
  HOOK_HASH_MISMATCH: 'HASH_MISMATCH',
  HOOK_APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  HOOK_INVALID: 'INVALID_REQUEST',
  HOOK_STORE_FAILED: 'IO_ERROR',
};

/** Copies only the whitelisted fields, so nothing the registry might add later reaches the renderer. */
const toRow = (view: HookView): HookSettingsRow => ({
  id: view.id,
  source: view.source,
  ...(view.pluginId === undefined ? {} : { pluginId: clip(view.pluginId) }),
  event: view.event,
  ...(view.matcher === undefined ? {} : { matcher: clip(view.matcher) }),
  form: view.form,
  command: clip(view.command),
  ...(view.args === undefined ? {} : { args: view.args.map(clip) }),
  timeoutSec: view.timeoutSec,
  status: view.status,
  ...(view.statusReason === undefined ? {} : { statusReason: view.statusReason }),
  approved: view.approved,
  ...(view.approvedAt === undefined ? {} : { approvedAt: view.approvedAt }),
  active: view.active,
});

const switchesOf = (registry: { getSwitches: () => HookSettingsSwitches }): HookSettingsSwitches => {
  const switches = registry.getSwitches();
  return { disableAll: switches.disableAll, sources: { ...switches.sources } };
};

/** Copies only the whitelisted audit fields. */
const toAuditLine = (record: HookAuditRecord): HookSettingsAuditLine => {
  const line: HookSettingsAuditLine = {
    ts: record.ts,
    event: record.event,
    source: record.source,
    durationMs: record.durationMs,
    exitCode: record.exitCode,
    timedOut: record.timedOut,
    decision: record.decision,
    stdoutLength: record.stdoutLength,
    stderrLength: record.stderrLength,
  };
  if (record.hookId !== undefined) line.hookId = record.hookId;
  if (record.pluginId !== undefined) line.pluginId = record.pluginId;
  if (record.errorCode !== undefined) line.errorCode = record.errorCode;
  return line;
};

const fromRegistry = (result: HookRegistryResult): HookSettingsResult<HookSettingsRow> =>
  result.ok
    ? { ok: true, data: toRow(result.hook) }
    : fail(REGISTRY_ERRORS[(result as Extract<HookRegistryResult, { ok: false }>).code]);

/**
 * List, describe, approve, switch and audit Tomny hooks. The sender is checked before and after every await; requests
 * are strict schemas; `approve` takes the `approvalHash` of what `describe` returned, Main recomputes it from the
 * script on disk and the registry refuses it unless it is the same value, and the person must also click a native
 * dialog that Main builds from the same description. A hook never gains a permission from any of this: hooks only
 * tighten (design 11.6).
 */
export const registerHookSettingsBridge = (options: HookSettingsBridgeOptions): (() => void) => {
  let active = true;
  const allowed = (event: IpcMainInvokeEvent): boolean => active && options.verifySender(event);
  const done = async (subjectId: string, operation: string, succeeded: boolean): Promise<void> => {
    try {
      await options.audit?.({ subjectId, operation, status: succeeded ? 'completed' : 'failed' });
    } catch {
      // A receipt that cannot be written must not undo or hide what already happened.
    }
  };

  const handle = <S extends z.ZodTypeAny, T>(
    channel: string,
    schema: S,
    run: (
      event: IpcMainInvokeEvent,
      request: z.infer<S>,
      registry: NonNullable<Awaited<ReturnType<HookSettingsBridgeOptions['getRegistry']>>>
    ) => Promise<HookSettingsResult<T>>
  ): void => {
    options.ipcMain.handle(channel, async (event, raw: unknown) => {
      try {
        if (!allowed(event)) return fail('DENIED');
        const parsed = schema.safeParse(raw ?? {});
        if (!parsed.success) return fail('INVALID_REQUEST');
        const registry = await options.getRegistry();
        if (!registry) return fail('UNAVAILABLE');
        if (!allowed(event)) return fail('DENIED');
        return await run(event, parsed.data, registry);
      } catch {
        return fail('IO_ERROR');
      }
    });
  };

  handle(
    HOOK_SETTINGS_CHANNELS.list,
    NO_REQUEST,
    async (_event, _request, registry): Promise<HookSettingsResult<HookSettingsList>> => ({
      ok: true,
      data: { hooks: (await registry.listHooks()).map(toRow), switches: switchesOf(registry) },
    })
  );

  handle(
    HOOK_SETTINGS_CHANNELS.describe,
    ID_REQUEST,
    async (_event, request, registry): Promise<HookSettingsResult<HookSettingsDescription>> => {
      const description = await registry.describeHook(request.hookId);
      if (!description) return fail('NOT_FOUND');
      return {
        ok: true,
        data: {
          hookId: request.hookId,
          lines: description.lines.map((line) => ({ key: line.key, value: clip(line.value) })),
          approvalHash: description.hash,
        },
      };
    }
  );

  handle(HOOK_SETTINGS_CHANNELS.approve, APPROVE_REQUEST, async (event, request, registry) => {
    const { hookId, approvalHash } = request;
    const target = (await registry.listHooks()).find((hook) => hook.id === hookId);
    if (!target) return fail('NOT_FOUND');
    // Main describes it again; a hash that does not match what Main sees now never reaches the dialog.
    const current = await registry.describeHook(hookId);
    if (!current) return fail('NOT_FOUND');
    if (current.hash !== approvalHash) return fail('HASH_MISMATCH');
    if (!(await options.confirmApprove(event, { hookId, lines: current.lines }))) {
      await done(hookId, 'hook-approve-cancelled', false);
      return fail('CANCELLED');
    }
    // The window may have navigated away while the dialog was open.
    if (!allowed(event)) return fail('DENIED');
    const result = fromRegistry(await registry.approveHook(hookId, approvalHash));
    await done(hookId, 'hook-approve', result.ok);
    return result;
  });

  handle(HOOK_SETTINGS_CHANNELS.setEnabled, ENABLED_REQUEST, async (_event, request, registry) => {
    const result = fromRegistry(await registry.setHookEnabled(request.hookId, request.enabled));
    await done(request.hookId, request.enabled ? 'hook-enable' : 'hook-disable', result.ok);
    return result;
  });

  handle(HOOK_SETTINGS_CHANNELS.setDisableAll, DISABLE_ALL_REQUEST, async (_event, request, registry) => {
    const saved = await registry.setDisableAll(request.disabled);
    await done('all', request.disabled ? 'hooks-disable-all' : 'hooks-enable-all', saved);
    return saved ? { ok: true, data: switchesOf(registry) } : fail('IO_ERROR');
  });

  handle(HOOK_SETTINGS_CHANNELS.setSourceEnabled, SOURCE_REQUEST, async (_event, request, registry) => {
    const saved = await registry.setSourceEnabled(request.source, request.enabled);
    await done(request.source, request.enabled ? 'hooks-source-enable' : 'hooks-source-disable', saved);
    return saved ? { ok: true, data: switchesOf(registry) } : fail('IO_ERROR');
  });

  handle(HOOK_SETTINGS_CHANNELS.createUser, userHookRecordSchema, async (_event, request, registry) => {
    const result = fromRegistry(await registry.addUserHook(request));
    // The new hook is off until it is approved; creating it grants nothing.
    await done(result.ok ? result.data.id : 'user', 'hook-create-user', result.ok);
    return result;
  });

  handle(HOOK_SETTINGS_CHANNELS.removeUser, ID_REQUEST, async (_event, request, registry) => {
    const target = (await registry.listHooks()).find((hook) => hook.id === request.hookId);
    if (!target) return fail('NOT_FOUND');
    if (target.source !== 'user') return fail('FORBIDDEN');
    const removed = await registry.removeUserHook(request.hookId);
    await done(request.hookId, 'hook-remove-user', removed);
    return removed ? { ok: true, data: { removed: true as const } } : fail('IO_ERROR');
  });

  handle(
    HOOK_SETTINGS_CHANNELS.audit,
    AUDIT_REQUEST,
    async (_event, request, registry): Promise<HookSettingsResult<HookSettingsAuditLine[]>> => ({
      ok: true,
      data: (await registry.readAudit(request.limit)).map(toAuditLine),
    })
  );

  handle(
    HOOK_SETTINGS_CHANNELS.coverage,
    NO_REQUEST,
    async (): Promise<HookSettingsResult<HookSettingsCoverageRow[]>> => ({
      ok: true,
      data: COVERAGE_AGENTS.map(({ agent, protocol, mode }) => {
        const coverage = options.coverageOf(protocol, mode);
        return { agent, preToolUse: coverage.preToolUse, postToolUse: coverage.postToolUse };
      }),
    })
  );

  return () => {
    active = false;
    for (const channel of Object.values(HOOK_SETTINGS_CHANNELS)) options.ipcMain.removeHandler(channel);
  };
};
