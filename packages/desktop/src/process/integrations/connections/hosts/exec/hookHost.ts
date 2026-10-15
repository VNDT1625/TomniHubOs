/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Connection host for `hook` (docs/platform/repotopackage-design.md sections 9.3, 10.5, 11.6, 15.1).
 *
 * - A `hook` connection is one handler for one event. Turning it on registers it in the Hub's `HookRegistry` with
 *   source `package` and pins its approval to the registry's own content hash, so the registry stays the only
 *   thing that decides whether a hook may run. Nothing runs here.
 * - The approval the person sees is exactly what `HookRegistry.describeHook` shows (the same builders, with the same
 *   hook identity and plugin folder), plus the package-relative script files, so the connection approval hash also
 *   covers the content of the script. A script that changes afterwards turns the connection off (the connection
 *   registry re-hashes on sync) and the hook off (the hook registry re-pins on every registration and before every run).
 * - Hooks only tighten. Nothing in this host grants a permission or bypasses the permission flow; a package hook has no
 *   role other than `deny`/`ask`/context (design 11.6 item 1).
 * - `check` is where this machine counts: the event must be one the runner fires, the form must be exec (a package
 *   shell hook cannot be switched on), and the command must plan to a real process (script inside the plugin folder,
 *   interpreter present).
 * - `disable` unregisters the hook. Approvals stay in the hook registry (they are content-pinned and cannot enable a
 *   hook that is not registered) unless `forgetApprovals` is set. `reconcile` unregisters hooks of connections that are
 *   no longer enabled and registers again the ones that are, so a restart restores them (the registry is in memory).
 * - The registry replaces the whole hook set of a package on `registerPackageHooks`, so the host keeps the set of
 *   enabled hook connections per package and always registers that whole set.
 */

import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  defaultTimeoutSec,
  isSupportedEvent,
  type HookHandler,
  type KnownHookEventName,
} from '@/common/integrations/hooks';
import type { EnabledConnection } from '@process/integrations/connections/core/registry';
import { planHookCommand } from '@process/integrations/hooks/hookInterpreters';
import {
  buildDescribeLines,
  computeHookId,
  computeHookPinning,
  type HookPinContext,
} from '@process/integrations/hooks/hookPinning';
import type { HookRegistry, PackageHookInput } from '@process/integrations/hooks/hookRegistry';
import {
  defineConnectionHost,
  type AnyConnectionHost,
  type ApprovalSubject,
  type ConnectionOf,
  type HostCheck,
  type HostContext,
} from '../../core/types';

type HookHostConnection = ConnectionOf<'hook'>;

/** The part of the hook registry this host uses. */
export type HookHostRegistry = Pick<
  HookRegistry,
  'registerPackageHooks' | 'unregisterPackageHooks' | 'describeHook' | 'approveHook'
>;

export type HookHostDeps = Readonly<{
  /** The registry the runtime dispatches to. Defaults to the application's (`getHookRegistry`). */
  getRegistry?: () => Promise<HookHostRegistry | undefined>;
  /**
   * Every hook connection that is turned on, so a restart (or a host that has not seen a package yet) restores the
   * hooks of the whole package. Bound late: the registry that answers this is built after its hosts.
   */
  enabledHooks?: () => Promise<readonly EnabledConnection[]>;
  /** The persistent data folder `${CLAUDE_PLUGIN_DATA}` points at, when the application has one for the package. */
  pluginDataDirectory?: (packageId: string) => string | undefined;
  /** Forget a package's hook approvals when its last hook is unregistered. Default: keep them. */
  forgetApprovals?: boolean;
  /** Environment used to find interpreters; defaults to the process environment. */
  env?: NodeJS.ProcessEnv;
}>;

/** Folder `${CLAUDE_PLUGIN_ROOT}` points at when the connection names no plugin. */
const DEFAULT_PLUGIN_FOLDER = 'source';

const LABELS: Readonly<Record<string, string>> = {
  source: 'Source',
  plugin: 'Package',
  event: 'Event',
  matcher: 'Matcher',
  form: 'Form',
  command: 'Command',
  args: 'Argument',
  timeout: 'Timeout (seconds)',
  file: 'Script file (content is pinned)',
  unpinned: 'Not pinned',
  network: 'Outgoing network of the hook',
};

const unavailable = (): Error => new Error('The hook engine is not available.');

const pluginFolderOf = (connection: HookHostConnection): string => connection.plugin ?? DEFAULT_PLUGIN_FOLDER;

/** The real plugin folder inside the package. Throws when it is missing, not a folder, or outside the package. */
const resolvePluginRoot = async (context: HostContext, connection: HookHostConnection): Promise<string> => {
  const root = await realpath(context.packageDirectory);
  const target = await realpath(path.join(root, ...pluginFolderOf(connection).split('/')));
  const inside = path.relative(root, target);
  if (inside.startsWith('..') || path.isAbsolute(inside) || !(await stat(target)).isDirectory()) {
    throw new Error('The plugin folder of the hook is outside the package.');
  }
  return target;
};

const handlerOf = (connection: HookHostConnection): HookHandler => {
  const event = connection.event as KnownHookEventName;
  return {
    event,
    ...(connection.matcher !== undefined ? { matcher: connection.matcher } : {}),
    command: connection.command,
    ...(connection.args !== undefined ? { args: [...connection.args] } : {}),
    timeoutSec: connection.timeoutSec ?? defaultTimeoutSec(event),
    form: connection.args === undefined ? 'shell' : 'exec',
    unsupported: !isSupportedEvent(event),
  };
};

/** Placeholders a hook owns: the plugin folder and the package data folder. */
const pinContextOf = (pluginRoot: string, pluginData: string | undefined): HookPinContext => ({
  source: 'package',
  pluginRoot,
  ...(pluginData === undefined ? {} : { pluginData }),
});

export const createHookHost = (deps: HookHostDeps = {}): AnyConnectionHost => {
  const getRegistry =
    deps.getRegistry ??
    (async () => (await import('@process/integrations/hookRuntime/hookDispatcher')).getHookRegistry());
  /** `packageId` -> (connection id -> what is registered for it). The registry holds the same, in memory. */
  const enabled = new Map<string, Map<string, PackageHookInput>>();
  let hydrated: Promise<void> | undefined;

  const requireRegistry = async (): Promise<HookHostRegistry> => {
    const registry = await getRegistry();
    if (registry === undefined) throw unavailable();
    return registry;
  };

  const inputOf = async (context: HostContext, connection: HookHostConnection): Promise<PackageHookInput> => {
    const pluginRoot = await resolvePluginRoot(context, connection);
    const pluginData = deps.pluginDataDirectory?.(context.packageId);
    return { handler: handlerOf(connection), pluginRoot, ...(pluginData === undefined ? {} : { pluginData }) };
  };

  /** Builds the registrations of every turned-on hook connection (those in `keep` when it is given). */
  const loadEnabled = async (keep?: ReadonlySet<string>): Promise<Map<string, Map<string, PackageHookInput>>> => {
    const found = new Map<string, Map<string, PackageHookInput>>();
    for (const item of (await deps.enabledHooks?.()) ?? []) {
      if (item.connection.kind !== 'hook') continue;
      if (keep !== undefined && !keep.has(`${item.packageId}\u0000${item.key}`)) continue;
      try {
        // oxlint-disable-next-line no-await-in-loop -- a few hooks, resolved one after another
        const input = await inputOf(item.context, item.connection as HookHostConnection);
        const set = found.get(item.packageId) ?? new Map<string, PackageHookInput>();
        set.set((item.connection as HookHostConnection).id, input);
        found.set(item.packageId, set);
      } catch {
        // A hook whose folder is gone is simply not registered; the connection state reports it on the next sync.
      }
    }
    return found;
  };

  /** Reads the turned-on connections once, so a call about one connection never drops its package's other hooks. */
  const hydrate = (): Promise<void> => {
    hydrated ??= loadEnabled().then((found) => {
      for (const [packageId, set] of found) if (!enabled.has(packageId)) enabled.set(packageId, set);
    });
    return hydrated;
  };

  /** Registers the whole set of a package, or unregisters the package when the set is empty. */
  const publish = async (registry: HookHostRegistry, packageId: string, forgetWhenEmpty: boolean): Promise<void> => {
    const set = enabled.get(packageId);
    if (set === undefined || set.size === 0) {
      enabled.delete(packageId);
      await registry.unregisterPackageHooks(packageId, {
        forgetApprovals: forgetWhenEmpty && deps.forgetApprovals === true,
      });
      return;
    }
    await registry.registerPackageHooks(packageId, [...set.values()]);
  };

  const check = async (context: HostContext, connection: HookHostConnection): Promise<HostCheck> => {
    const handler = handlerOf(connection);
    if (handler.unsupported) return { ok: false, reason: `The event "${connection.event}" is not supported yet.` };
    if (handler.form === 'shell') {
      return {
        ok: false,
        reason: 'A package hook must be written in exec form (with an argument list), not as a shell command.',
      };
    }
    let pluginRoot: string;
    try {
      pluginRoot = await resolvePluginRoot(context, connection);
    } catch {
      return { ok: false, reason: 'The plugin folder of the hook is missing or outside the package.' };
    }
    const pluginData = deps.pluginDataDirectory?.(context.packageId);
    const plan = await planHookCommand({
      handler: {
        form: handler.form,
        command: handler.command,
        args: handler.args ?? [],
        timeoutSec: handler.timeoutSec,
      },
      source: 'package',
      placeholders: { pluginRoot, ...(pluginData === undefined ? {} : { pluginData }) },
      cwd: pluginRoot,
      env: deps.env ?? process.env,
    });
    return plan.kind === 'ok' ? { ok: true } : { ok: false, reason: plan.error.message };
  };

  const describe = async (context: HostContext, connection: HookHostConnection): Promise<ApprovalSubject> => {
    const handler = handlerOf(connection);
    const pluginRoot = await resolvePluginRoot(context, connection);
    const pin = pinContextOf(pluginRoot, deps.pluginDataDirectory?.(context.packageId));
    const pinning = await computeHookPinning(handler, pin);
    const prefix = pluginFolderOf(connection);
    return {
      kind: 'hook',
      title: `${connection.event} hook`,
      lines: buildDescribeLines(handler, pin, context.packageId, pinning).map((line) => ({
        label: LABELS[line.key] ?? line.key,
        value: line.value,
      })),
      // Package-relative, so the connection approval hash covers the content of every script the hook runs.
      files: pinning.files.map((label) => `${prefix}/${label}`),
    };
  };

  return defineConnectionHost({
    kind: 'hook',
    check,
    describe: (context, connection: HookHostConnection) => describe(context, connection),
    enable: async (context, connection: HookHostConnection) => {
      const checked = await check(context, connection);
      if (checked.ok === false) throw new Error(checked.reason);
      const registry = await requireRegistry();
      await hydrate();
      const input = await inputOf(context, connection);
      const set = enabled.get(context.packageId) ?? new Map<string, PackageHookInput>();
      const previous = set.get(connection.id);
      set.set(connection.id, input);
      enabled.set(context.packageId, set);
      try {
        await registry.registerPackageHooks(context.packageId, [...set.values()]);
        const hookId = computeHookId('package', context.packageId, input.handler);
        const description = await registry.describeHook(hookId);
        if (description === undefined) throw new Error('The hook was not registered.');
        // The person approved the connection, which showed exactly these lines; the registry pins that content.
        const approved = await registry.approveHook(hookId, description.hash);
        if (approved.ok === false) throw new Error(approved.message);
        return { installed: [hookId] };
      } catch (error) {
        if (previous === undefined) set.delete(connection.id);
        else set.set(connection.id, previous);
        await publish(registry, context.packageId, false).catch((): undefined => undefined);
        throw error;
      }
    },
    disable: async (context, connection: HookHostConnection, _installed) => {
      await hydrate();
      const set = enabled.get(context.packageId);
      if (set?.delete(connection.id) !== true) return;
      await publish(await requireRegistry(), context.packageId, true);
    },
    reconcile: async ({ keep }) => {
      const registry = await requireRegistry();
      const wanted =
        deps.enabledHooks === undefined
          ? new Map(
              [...enabled]
                .map(([packageId, set]): [string, Map<string, PackageHookInput>] => [
                  packageId,
                  new Map([...set].filter(([id]) => keep.has(`${packageId}\u0000hook:${id}`))),
                ])
                .filter(([, set]) => set.size > 0)
            )
          : await loadEnabled(keep);
      const orphans = [...enabled.keys()].filter((packageId) => !wanted.has(packageId));
      enabled.clear();
      for (const [packageId, set] of wanted) enabled.set(packageId, set);
      hydrated = Promise.resolve();
      for (const packageId of orphans) {
        // oxlint-disable-next-line no-await-in-loop -- one package at a time
        await registry.unregisterPackageHooks(packageId, { forgetApprovals: deps.forgetApprovals === true });
      }
      for (const packageId of wanted.keys()) {
        // oxlint-disable-next-line no-await-in-loop -- one package at a time
        await publish(registry, packageId, false);
      }
    },
  });
};
