/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import {
  PACKAGE_CONNECTIONS_CHANNELS,
  type PackageConnectionErrorCode,
  type PackageConnectionResult,
  type PackageConnectionView,
  type PackageEnableReport,
  type PackageServiceEntry,
} from '@/common/types/platform/packageConnections';
import type { ConnectionRegistry, ConnectionView } from '@process/integrations/connections/core/registry';
import type { RulesService } from '@process/integrations/packageContext/rulesService';
import type { PackageServiceControl, PackageServiceStatus } from '@process/integrations/runtime/packageServices';
import { ConnectionError, type ApprovalSubject } from '@process/integrations/connections/core/types';

const PACKAGE_ID = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
/** `${kind}:${id}` or `skill:${path}`. It is only compared with the keys Main derives from the adapter. */
const CONNECTION_KEY = z
  .string()
  .min(3)
  .max(300)
  // oxlint-disable-next-line no-control-regex -- control characters are exactly what is refused here.
  .regex(/^[a-z][a-z-]*:[^\u0000-\u001f\u007f]+$/u);
const APPROVAL_HASH = z.string().regex(/^sha256-[a-f0-9]{64}$/u);

// `.strict()` everywhere: a request that carries a path, a directory or anything else unknown is refused whole.
const LIST_REQUEST = z.object({ packageId: PACKAGE_ID }).strict();
const KEY_REQUEST = z.object({ packageId: PACKAGE_ID, connectionKey: CONNECTION_KEY }).strict();
const AUTO_START_REQUEST = z
  .object({ packageId: PACKAGE_ID, connectionKey: CONNECTION_KEY, autoStart: z.boolean() })
  .strict();
const PACKAGE_ENABLED_REQUEST = z.object({ packageId: PACKAGE_ID, enabled: z.boolean() }).strict();
const ENABLE_REQUEST = z
  .object({ packageId: PACKAGE_ID, connectionKey: CONNECTION_KEY, approvalHash: APPROVAL_HASH })
  .strict();

/** Connections that only add content for the agent. Everything else runs code and needs a native confirmation. */
const DATA_KINDS: ReadonlySet<string> = new Set(['skill', 'command', 'agent', 'rules', 'knowledge']);

const EMPTY = z.object({}).strict();
const CONNECTION_ID = z
  .string()
  .min(1)
  .max(300)
  // oxlint-disable-next-line no-control-regex -- control characters are refused, as for connection keys.
  .regex(/^[^\u0000-\u001f\u007f]+$/u);
const SERVICE_REQUEST = z.object({ packageId: PACKAGE_ID, connectionId: CONNECTION_ID }).strict();
const RULES_REQUEST = z
  .object({
    packageId: PACKAGE_ID,
    connectionId: CONNECTION_ID,
    workspace: z
      .string()
      .min(1)
      .max(1024)
      // oxlint-disable-next-line no-control-regex -- a workspace path never carries control characters.
      .regex(/^[^\u0000]+$/u),
  })
  .strict();
const MAX_TEXT = 500;

/** Receipts never carry a command, a path, a hash or a value. */
type Audit = { subjectId: string; operation: string; status: 'completed' | 'failed' };

export type PackageConnectionsBridgeOptions = Readonly<{
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  registry: Pick<ConnectionRegistry, 'view' | 'describe' | 'enable' | 'disable' | 'setAutoStart'>;
  /**
   * Native confirmation, built by Main from `describe`, for a connection that runs code. The renderer cannot
   * answer it and cannot change what it shows.
   */
  confirmEnable: (
    event: IpcMainInvokeEvent,
    detail: Readonly<{ packageId: string; subject: ApprovalSubject }>
  ) => Promise<boolean>;
  audit?: (record: Audit) => Promise<void>;
  /**
   * The package master switch. Main builds it (the native confirmation for code-running connections, sender checked by
   * Main before any dialog). Optional so a host without the package switch registers no such channel.
   */
  setPackageEnabled?: (event: IpcMainInvokeEvent, packageId: string, enabled: boolean) => Promise<PackageEnableReport>;
  /** Rules attachments (S11). Optional so a host without the Library surface registers no rules channels. */
  rules?: Pick<RulesService, 'list' | 'attach' | 'detach'>;
  /** Explicit start and stop of service connections (S17). Optional for the same reason. */
  services?: Pick<PackageServiceControl, 'list' | 'start' | 'stop'>;
}>;

const fail = (error: PackageConnectionErrorCode): { ok: false; error: PackageConnectionErrorCode } => ({
  ok: false,
  error,
});

const clip = (value: string): string => (value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT - 1)}…` : value);

const textOf = (connection: object, field: string): string | undefined => {
  const value = (connection as Record<string, unknown>)[field];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

const toView = (view: ConnectionView): PackageConnectionView => {
  const { connection, state } = view;
  const title = textOf(connection, 'title') ?? textOf(connection, 'id') ?? textOf(connection, 'path') ?? view.key;
  const description = textOf(connection, 'description');
  const plugin = textOf(connection, 'plugin');
  const format = connection.kind === 'extension' ? textOf(connection, 'format') : undefined;
  const group = textOf(connection, 'group');
  return {
    key: view.key,
    kind: connection.kind,
    title: clip(title),
    ...(description ? { description: clip(description) } : {}),
    ...(plugin ? { plugin: clip(plugin) } : {}),
    ...(format ? { format: clip(format) } : {}),
    ...(group ? { group: clip(group) } : {}),
    runsCode: !DATA_KINDS.has(connection.kind),
    enabled: state.enabled,
    autoStart: state.autoStart === true,
    status: state.status,
    ...(state.reason ? { reason: clip(state.reason) } : {}),
    ...(state.lastError ? { lastError: clip(state.lastError) } : {}),
    ...(state.approvedAt === undefined ? {} : { approvedAt: state.approvedAt }),
    ...(view.requiredEnv?.length ? { requiredEnv: [...view.requiredEnv] } : {}),
  };
};

const errorCodeOf = (error: unknown): PackageConnectionErrorCode => {
  // Rules and services errors are recognised by name so this bridge does not import their runtime modules.
  if (error instanceof Error && error.name === 'RulesError') {
    const code = (error as { code?: unknown }).code;
    return code === 'NOT_ENABLED' ? 'NOT_ENABLED' : code === 'INVALID_WORKSPACE' ? 'INVALID_WORKSPACE' : 'IO_ERROR';
  }
  if (error instanceof Error && error.name === 'PackageServiceError') return 'SERVICE_FAILED';
  if (!(error instanceof ConnectionError)) return 'IO_ERROR';
  switch (error.code) {
    case 'APPROVAL_REQUIRED':
      return 'APPROVAL_REQUIRED';
    case 'RUNTIME_MISSING':
      return 'RUNTIME_MISSING';
    case 'UNSUPPORTED':
      return 'UNSUPPORTED';
    case 'HOST_FAILED':
      return 'HOST_FAILED';
    case 'PATH_FORBIDDEN':
      return 'DENIED';
    case 'PACKAGE_NOT_INSTALLED':
    case 'UNKNOWN_CONNECTION':
      return 'NOT_FOUND';
  }
};

/**
 * List, describe, enable and disable the connections of an installed package. The sender is checked before and
 * after every await; requests are strict schemas; `enable` takes the `approvalHash` of what `describe` returned and
 * the registry refuses it unless Main recomputes the same value from the package on disk. A connection that runs code
 * additionally needs the person's click in a native dialog that Main builds from the same description.
 */
export const registerPackageConnectionsBridge = (options: PackageConnectionsBridgeOptions): (() => void) => {
  let active = true;
  const allowed = (event: IpcMainInvokeEvent): boolean => active && options.verifySender(event);
  const done = async (packageId: string, operation: string, succeeded: boolean): Promise<void> => {
    try {
      await options.audit?.({ subjectId: packageId, operation, status: succeeded ? 'completed' : 'failed' });
    } catch {
      // A receipt that cannot be written must not undo or hide what already happened.
    }
  };

  const handle = <S extends z.ZodTypeAny, T>(
    channel: string,
    schema: S,
    run: (event: IpcMainInvokeEvent, request: z.infer<S>) => Promise<PackageConnectionResult<T>>
  ): void => {
    options.ipcMain.handle(channel, async (event, raw: unknown) => {
      try {
        if (!allowed(event)) return fail('DENIED');
        const parsed = schema.safeParse(raw);
        if (!parsed.success) return fail('INVALID_REQUEST');
        return await run(event, parsed.data);
      } catch (error) {
        return fail(errorCodeOf(error));
      }
    });
  };

  const find = async (packageId: string, key: string): Promise<ConnectionView | undefined> =>
    (await options.registry.view(packageId)).find((candidate) => candidate.key === key);

  handle(PACKAGE_CONNECTIONS_CHANNELS.list, LIST_REQUEST, async (_event, request) => {
    const { packageId } = request;
    return { ok: true, data: (await options.registry.view(packageId)).map(toView) };
  });

  handle(PACKAGE_CONNECTIONS_CHANNELS.describe, KEY_REQUEST, async (_event, request) => {
    const { packageId, connectionKey } = request;
    const { subject, approvalHash } = await options.registry.describe(packageId, connectionKey);
    return {
      ok: true,
      data: {
        kind: subject.kind,
        title: subject.title,
        lines: subject.lines.map((line) => ({ label: line.label, value: line.value })),
        files: [...subject.files],
        approvalHash,
      },
    };
  });

  handle(PACKAGE_CONNECTIONS_CHANNELS.enable, ENABLE_REQUEST, async (event, request) => {
    const { packageId, connectionKey, approvalHash } = request;
    const target = await find(packageId, connectionKey);
    if (!target) return fail('NOT_FOUND');
    // Main describes it again; a hash that does not match what Main sees now never reaches the dialog.
    const current = await options.registry.describe(packageId, connectionKey);
    if (current.approvalHash !== approvalHash) return fail('APPROVAL_REQUIRED');
    if (!DATA_KINDS.has(target.connection.kind)) {
      if (!(await options.confirmEnable(event, { packageId, subject: current.subject }))) {
        await done(packageId, 'connection-enable-cancelled', false);
        return fail('CANCELLED');
      }
      // The window may have navigated away while the dialog was open.
      if (!allowed(event)) return fail('DENIED');
    }
    try {
      const state = await options.registry.enable(packageId, connectionKey, approvalHash);
      await done(packageId, 'connection-enable', true);
      return { ok: true, data: toView({ ...target, state }) };
    } catch (error) {
      await done(packageId, 'connection-enable', false);
      throw error;
    }
  });

  handle(PACKAGE_CONNECTIONS_CHANNELS.setAutoStart, AUTO_START_REQUEST, async (_event, request) => {
    const { packageId, connectionKey, autoStart } = request;
    const target = await find(packageId, connectionKey);
    if (!target) return fail('NOT_FOUND');
    // Only code-running kinds have a start-again choice; a data kind has nothing to start.
    if (DATA_KINDS.has(target.connection.kind)) return fail('UNSUPPORTED');
    try {
      const state = await options.registry.setAutoStart(packageId, connectionKey, autoStart);
      await done(packageId, 'connection-auto-start', true);
      return { ok: true, data: toView({ ...target, state }) };
    } catch (error) {
      await done(packageId, 'connection-auto-start', false);
      throw error;
    }
  });

  const packageSwitch = options.setPackageEnabled;
  if (packageSwitch) {
    handle(PACKAGE_CONNECTIONS_CHANNELS.setPackageEnabled, PACKAGE_ENABLED_REQUEST, async (event, request) => {
      const { packageId, enabled } = request;
      const operation = enabled ? 'package-enable' : 'package-disable';
      try {
        const report = await packageSwitch(event, packageId, enabled);
        await done(packageId, operation, true);
        return { ok: true, data: report };
      } catch (error) {
        await done(packageId, operation, false);
        throw error;
      }
    });
  }

  handle(PACKAGE_CONNECTIONS_CHANNELS.disable, KEY_REQUEST, async (_event, request) => {
    const { packageId, connectionKey } = request;
    const target = await find(packageId, connectionKey);
    if (!target) return fail('NOT_FOUND');
    const state = await options.registry.disable(packageId, connectionKey);
    await done(packageId, 'connection-disable', state.status !== 'error');
    return { ok: true, data: toView({ ...target, state }) };
  });

  const rulesService = options.rules;
  if (rulesService) {
    handle(PACKAGE_CONNECTIONS_CHANNELS.rulesList, EMPTY, async () => {
      const entries = await rulesService.list();
      return {
        ok: true,
        data: entries.map((entry) => ({
          packageId: entry.packageId,
          connectionId: entry.connectionId,
          title: clip(entry.title),
          format: clip(entry.format),
          workspaces: entry.workspaces.map(clip),
        })),
      };
    });
    handle(PACKAGE_CONNECTIONS_CHANNELS.rulesAttach, RULES_REQUEST, async (_event, request) => {
      const { packageId, connectionId, workspace } = request;
      try {
        await rulesService.attach({ packageId, connectionId, workspace });
      } catch (error) {
        await done(packageId, 'rules-attach', false);
        throw error;
      }
      await done(packageId, 'rules-attach', true);
      return { ok: true, data: null };
    });
    handle(PACKAGE_CONNECTIONS_CHANNELS.rulesDetach, RULES_REQUEST, async (_event, request) => {
      const { packageId, connectionId, workspace } = request;
      await rulesService.detach({ packageId, connectionId, workspace });
      await done(packageId, 'rules-detach', true);
      return { ok: true, data: null };
    });
  }

  const serviceControl = options.services;
  if (serviceControl) {
    const toService = (status: PackageServiceStatus): PackageServiceEntry => ({
      packageId: status.packageId,
      connectionId: status.connectionId,
      title: clip(status.title),
      state: status.state,
      ...(status.error ? { error: clip(status.error.message) } : {}),
    });
    handle(PACKAGE_CONNECTIONS_CHANNELS.servicesList, EMPTY, async () => ({
      ok: true,
      data: serviceControl.list().map(toService),
    }));
    handle(PACKAGE_CONNECTIONS_CHANNELS.servicesStart, SERVICE_REQUEST, async (_event, request) => {
      const { packageId, connectionId } = request;
      try {
        await serviceControl.start({ packageId, connectionId });
        await done(packageId, 'service-start', true);
      } catch (error) {
        await done(packageId, 'service-start', false);
        throw error;
      }
      return { ok: true, data: serviceControl.list().map(toService) };
    });
    handle(PACKAGE_CONNECTIONS_CHANNELS.servicesStop, SERVICE_REQUEST, async (_event, request) => {
      const { packageId, connectionId } = request;
      await serviceControl.stop({ packageId, connectionId });
      await done(packageId, 'service-stop', true);
      return { ok: true, data: serviceControl.list().map(toService) };
    });
  }

  return () => {
    active = false;
    for (const channel of Object.values(PACKAGE_CONNECTIONS_CHANNELS)) options.ipcMain.removeHandler(channel);
  };
};
