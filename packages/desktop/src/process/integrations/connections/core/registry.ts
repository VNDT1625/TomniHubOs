/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The connection registry (docs/platform/repotopackage-design.md sections 9.3, 9.4, 9.5). It is the only thing
 * that turns a connection on or off:
 *
 * - installing a package switches nothing on: every connection starts `off`, `unsupported` or `needs-input`;
 * - turning one on needs an `approvalHash` that Main recomputes from what the user was shown;
 * - content that would run and then changes (an update) turns the connection off until it is approved again,
 *   while data-only connections follow the new content;
 * - turning one on from a `group` turns the others of that group off in the same operation;
 * - a code-running connection that is on lasts for this app session only, unless the person marked it to start again
 *   (`setAutoStart`): at the next start it is switched off, or enabled once more through the same checks as a manual enable;
 * - a start-again connection keeps the approval hash it was given while it is off, so a restart can check the same content;
 *   changed content, revoked trust or a switch-off without start-again drops it (docs/platform/repotopackage-design.md 9.4);
 * - a failing host never leaves a half-enabled connection: it ends in `error` with a short reason.
 *
 * Calls for one package run one at a time, so a double click or a sync during an enable cannot interleave.
 */

/* oxlint-disable no-await-in-loop -- host operations for one package must run in order, one at a time */

import { lstat, realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  connectionKey,
  connectionNotInstallableReason,
  type AdapterConnection,
  type AdapterConnectionKind,
  type AdapterDocument,
} from '@/common/packages/adapter';
import { declaresLocalService } from '@/common/packages/adapter/loopback';
import type { PackageTrust } from '@/common/packages/types';
import { computeApprovalHash } from './approval';
import { requiredConnectionEnv } from './envValues';
import type { ConnectionStateStore, InstalledConnectionState } from './state';
import { ConnectionError, type AnyConnectionHost, type ApprovalSubject, type HostContext } from './types';

/** Connections that hold content for the agent and never run code: they follow an updated package by themselves. */
export const DATA_KINDS: ReadonlySet<AdapterConnectionKind> = new Set([
  'skill',
  'command',
  'agent',
  'rules',
  'knowledge',
]);
const MAX_ERROR_LENGTH = 500;
const CHANGED_REASON = 'Nội dung đã đổi, cần duyệt lại trước khi bật.';
/** Shown for every code-running connection of an `unsigned-revoked` package: it stays off until rebuilt and approved. */
const REVOKED_CODE_REASON = 'Khóa ký của gói này trên máy đã bị thu hồi. Tạo lại gói bằng khóa mới rồi duyệt lại.';
/** Shown next to a data connection of an `unsigned-revoked` package: the content stays, but it is no longer signed. */
const REVOKED_DATA_NOTICE = 'Khóa ký của gói này đã bị thu hồi. Nội dung không còn được tin cậy như gói đã ký.';
/** Shown on a code-running connection that was on when the app quit and is not marked to start again. */
const SESSION_ENDED_REASON = 'Tắt khi thoát ứng dụng';
/** Shown on a start-again connection that has no kept approval: nothing may start it until the person approves it once. */
export const NEEDS_APPROVAL_REASON = 'Cần duyệt lại trước khi tự bật khi mở ứng dụng.';

export type LoadedPackage = Readonly<{
  packageId: string;
  packageVersion: string;
  /** Absolute directory of the extracted package. */
  packageDirectory: string;
  adapter: AdapterDocument;
  /** Trust tier of the installed package (`PackageListing.trust`). Absent means not `local-built`. */
  trust?: PackageTrust;
}>;

export type ConnectionRegistryDeps = Readonly<{
  store: ConnectionStateStore;
  hosts: readonly AnyConnectionHost[];
  /** Main-owned. Returns undefined when the package is not installed. */
  loadPackage: (packageId: string) => Promise<LoadedPackage | undefined>;
  listInstalledPackageIds: () => Promise<readonly string[]>;
  /** Main-only vault check; returns missing names but never values. */
  missingRequiredEnv?: (packageId: string, names: readonly string[]) => Promise<readonly string[]>;
  now?: () => number;
}>;

export type ConnectionView = Readonly<{
  connection: AdapterConnection;
  key: string;
  state: InstalledConnectionState;
  /** Variable names only; never handles or values. */
  requiredEnv?: readonly string[];
}>;

export type ConnectionApproval = Readonly<{ subject: ApprovalSubject; approvalHash: string }>;

/** One turned-on connection with the Main-owned context to read its package files. Never sent to a renderer. */
export type EnabledConnection = Readonly<{
  packageId: string;
  packageVersion: string;
  key: string;
  connection: AdapterConnection;
  context: HostContext;
}>;

export type ConnectionRegistry = Readonly<{
  /** Reads the package's adapter and rebuilds its connection states, keeping what is still valid. */
  syncPackage: (packageId: string) => Promise<readonly ConnectionView[]>;
  view: (packageId: string) => Promise<readonly ConnectionView[]>;
  describe: (packageId: string, key: string) => Promise<ConnectionApproval>;
  enable: (packageId: string, key: string, approvalHash: string) => Promise<InstalledConnectionState>;
  disable: (packageId: string, key: string) => Promise<InstalledConnectionState>;
  /**
   * Marks a code-running connection to start again at the next launch, or not. It needs a record that a sync created
   * and approves nothing: a start still needs the approval hash the person gave.
   */
  setAutoStart: (packageId: string, key: string, value: boolean) => Promise<InstalledConnectionState>;
  /** Turns every connection of a package off and forgets its state (package uninstalled or disabled). */
  removePackage: (packageId: string) => Promise<void>;
  /**
   * Every connection of `kind` that is on, with its file reader. For hosts whose "installed" content is read on
   * demand (prompt commands) instead of copied into another store. Skips packages that are not installed.
   */
  enabledOfKind: (kind: AdapterConnectionKind) => Promise<readonly EnabledConnection[]>;
  /** At startup: drop connections of packages that are gone and turn off ones whose content changed. */
  reconcile: () => Promise<void>;
  /**
   * Packages with a start-again code connection that is waiting for the person's one approval (see awaitsStartApproval).
   * Reads the recorded state only; runs nothing and changes nothing.
   */
  startApprovalNeeded: () => Promise<readonly string[]>;
}>;

/** The person's start-again choice, carried over every rewrite of a record. Absent means not chosen. */
const preference = (previous: InstalledConnectionState | undefined): Pick<InstalledConnectionState, 'autoStart'> =>
  previous?.autoStart === true ? { autoStart: true } : {};

/**
 * The approval a start-again connection keeps while it is off: the hash of exactly what the person approved. A start at
 * the next launch checks the same content again before anything runs. Every other record drops its approval when it is
 * switched off, so only a connection the person chose to start again keeps one.
 */
const retainedApproval = (
  previous: InstalledConnectionState | undefined
): Pick<InstalledConnectionState, 'approvalHash' | 'approvedAt'> => {
  if (previous?.autoStart !== true || previous.approvalHash === undefined) return {};
  return previous.approvedAt === undefined
    ? { approvalHash: previous.approvalHash }
    : { approvalHash: previous.approvalHash, approvedAt: previous.approvedAt };
};

/**
 * A start-again code connection that is off and has no approval: the one state a start must not run without the person's
 * approval. Only a record that a sync marked with NEEDS_APPROVAL_REASON counts; a failing check or a changed one does not.
 */
export const awaitsStartApproval = (state: InstalledConnectionState): boolean => {
  const kind = state.connectionKey.split(':')[0] ?? '';
  return (
    state.autoStart === true &&
    state.enabled !== true &&
    state.approvalHash === undefined &&
    state.reason === NEEDS_APPROVAL_REASON &&
    !DATA_KINDS.has(kind as AdapterConnectionKind)
  );
};

/** A copy of a record without its approval, with the start-again choice set as given. */
const withoutApproval = (
  state: InstalledConnectionState,
  change: Pick<InstalledConnectionState, 'autoStart'>
): InstalledConnectionState => {
  const { approvalHash: _approvalHash, approvedAt: _approvedAt, ...rest } = state;
  return { ...rest, ...change };
};

const base = (loaded: LoadedPackage, key: string): InstalledConnectionState => ({
  packageId: loaded.packageId,
  packageVersion: loaded.packageVersion,
  connectionKey: key,
  enabled: false,
  status: 'off',
});

/**
 * A code-running connection (every kind but the data kinds) of a package whose signing key was revoked. Fails closed:
 * a kind added later counts as code until it is listed as data.
 */
const isRevokedCode = (loaded: LoadedPackage, connection: AdapterConnection): boolean =>
  loaded.trust === 'unsigned-revoked' && !DATA_KINDS.has(connection.kind);

/** A data connection of an `unsigned-revoked` package keeps its state and says so; the notice goes once trust returns. */
const withRevokedNotice = (
  loaded: LoadedPackage,
  state: InstalledConnectionState,
  kind: AdapterConnectionKind | undefined
): InstalledConnectionState => {
  if (kind === undefined || !DATA_KINDS.has(kind)) return state;
  if (loaded.trust === 'unsigned-revoked')
    return state.reason === undefined ? { ...state, reason: REVOKED_DATA_NOTICE } : state;
  if (state.reason !== REVOKED_DATA_NOTICE) return state;
  const { reason: _reason, ...rest } = state;
  return rest;
};

const shortError = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH - 1)}…` : text;
};

/** Reads a file below `root`, refusing traversal and anything that resolves outside it (symlinks, junctions). */
const readInside = async (root: string, relativePath: string): Promise<Buffer> => {
  if (
    relativePath === '' ||
    relativePath.includes('\\') ||
    path.isAbsolute(relativePath) ||
    relativePath.split('/').some((part) => part === '..' || part === '')
  ) {
    throw new ConnectionError('PATH_FORBIDDEN', `Path is not allowed: ${relativePath}`);
  }
  const resolvedRoot = await realpath(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new ConnectionError('PATH_FORBIDDEN', `Not a regular file: ${relativePath}`);
  }
  const real = await realpath(target);
  const inside = path.relative(resolvedRoot, real);
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new ConnectionError('PATH_FORBIDDEN', `Path leaves the package: ${relativePath}`);
  }
  return readFile(real);
};

export const createConnectionRegistry = (deps: ConnectionRegistryDeps): ConnectionRegistry => {
  const now = deps.now ?? Date.now;
  const hosts = new Map<AdapterConnectionKind, AnyConnectionHost>();
  for (const host of deps.hosts) {
    if (hosts.has(host.kind)) throw new Error(`Two connection hosts for kind ${host.kind}.`);
    hosts.set(host.kind, host);
  }

  const chains = new Map<string, Promise<unknown>>();
  /** Packages whose start-of-run restore has completed in this app run. */
  const restoredThisRun = new Set<string>();
  /** Runs `task` after every earlier call for the same package has settled. */
  const serialized = <T>(packageId: string, task: () => Promise<T>): Promise<T> => {
    const previous = chains.get(packageId) ?? Promise.resolve();
    const next = previous.catch((): undefined => undefined).then(task);
    const tail = next.catch((): undefined => undefined);
    chains.set(packageId, tail);
    void tail.then(() => {
      if (chains.get(packageId) === tail) chains.delete(packageId);
    });
    return next;
  };

  const contextFor = (loaded: LoadedPackage): HostContext => ({
    packageId: loaded.packageId,
    packageVersion: loaded.packageVersion,
    packageDirectory: loaded.packageDirectory,
    readPackageFile: (relativePath) => readInside(loaded.packageDirectory, relativePath),
    ...(loaded.trust === undefined ? {} : { trust: loaded.trust }),
    declaresLocalService: declaresLocalService(loaded.adapter.connections),
  });

  const requireLoaded = async (packageId: string): Promise<LoadedPackage> => {
    const loaded = await deps.loadPackage(packageId);
    if (!loaded) throw new ConnectionError('PACKAGE_NOT_INSTALLED', `Package is not installed: ${packageId}`);
    return loaded;
  };

  const findConnection = (loaded: LoadedPackage, key: string): AdapterConnection => {
    const connection = loaded.adapter.connections.find((candidate) => connectionKey(candidate) === key);
    if (!connection) throw new ConnectionError('UNKNOWN_CONNECTION', `Unknown connection: ${key}`);
    return connection;
  };

  const approvalFor = async (
    host: AnyConnectionHost,
    context: HostContext,
    connection: AdapterConnection
  ): Promise<ConnectionApproval> => {
    const subject = await host.describe(context, connection as never);
    const files = new Map<string, Buffer>();
    for (const file of subject.files) {
      try {
        files.set(file, await context.readPackageFile(file));
      } catch {
        // Unreadable stays out of the map; computeApprovalHash makes that visible in the hash.
      }
    }
    return { subject, approvalHash: computeApprovalHash(connection, subject, files) };
  };

  /** Switches a connection off in its target store. A host failure is recorded, never thrown past the caller. */
  const switchOff = async (
    loaded: LoadedPackage,
    connection: AdapterConnection,
    previous: InstalledConnectionState
  ): Promise<string | undefined> => {
    const host = hosts.get(connection.kind);
    if (!host) return undefined;
    try {
      await host.disable(contextFor(loaded), connection as never, previous.installed ?? []);
      return undefined;
    } catch (error) {
      return shortError(error);
    }
  };

  const buildViews = (loaded: LoadedPackage): readonly ConnectionView[] =>
    loaded.adapter.connections.map((connection) => {
      const key = connectionKey(connection);
      return {
        connection,
        key,
        state: deps.store.get(loaded.packageId, key) ?? base(loaded, key),
        ...(requiredConnectionEnv(loaded.adapter, connection).length > 0
          ? { requiredEnv: requiredConnectionEnv(loaded.adapter, connection) }
          : {}),
      };
    });

  const sync = async (packageId: string): Promise<readonly ConnectionView[]> => {
    const loaded = await requireLoaded(packageId);
    const context = contextFor(loaded);
    const previousByKey = new Map(deps.store.list(packageId).map((state) => [state.connectionKey, state]));
    const next: InstalledConnectionState[] = [];

    for (const connection of loaded.adapter.connections) {
      const key = connectionKey(connection);
      const previous = previousByKey.get(key);
      previousByKey.delete(key);
      const plain = { ...base(loaded, key), ...preference(previous) };
      // A temporary failure below (a check, a value, a host) keeps the approval, so the next start can try again.
      const state = { ...plain, ...retainedApproval(previous) };
      if (isRevokedCode(loaded, connection)) {
        const failure = previous?.enabled ? await switchOff(loaded, connection, previous) : undefined;
        // Revoked trust drops the approval: a later start needs a fresh one.
        next.push({
          ...plain,
          status: 'needs-input',
          reason: REVOKED_CODE_REASON,
          ...(failure ? { lastError: failure } : {}),
        });
        continue;
      }
      const host = hosts.get(connection.kind);

      if (!host) {
        if (previous?.enabled) await switchOff(loaded, connection, previous);
        next.push({
          ...state,
          status: 'unsupported',
          reason:
            connectionNotInstallableReason(connection) ??
            `Phiên bản này chưa có thành phần để chạy kết nối "${connection.kind}".`,
        });
        continue;
      }

      let check: Awaited<ReturnType<AnyConnectionHost['check']>>;
      try {
        check = await host.check(context, connection as never);
      } catch (error) {
        check = { ok: false, reason: shortError(error) };
      }
      if (check.ok === false) {
        if (previous?.enabled) await switchOff(loaded, connection, previous);
        next.push({
          ...state,
          status: check.needsInput ? 'needs-input' : 'unsupported',
          reason: check.reason.slice(0, MAX_ERROR_LENGTH),
        });
        continue;
      }

      const required = requiredConnectionEnv(loaded.adapter, connection);
      const missing =
        required.length > 0 ? await (deps.missingRequiredEnv?.(packageId, required) ?? Promise.resolve(required)) : [];
      if (missing.length > 0) {
        if (previous?.enabled) await switchOff(loaded, connection, previous);
        next.push({
          ...state,
          status: 'needs-input',
          reason: `Cần nhập biến môi trường: ${missing.join(', ')}`.slice(0, MAX_ERROR_LENGTH),
        });
        continue;
      }

      if (!previous?.enabled) {
        if (state.approvalHash !== undefined) {
          // A kept approval counts only while the content still matches it. A recompute that fails is no proof of a change:
          // the approval stays, and the next start checks it again.
          const kept = await approvalFor(host, context, connection).catch((): undefined => undefined);
          if (kept !== undefined && kept.approvalHash !== state.approvalHash) {
            next.push({ ...plain, status: 'needs-input', reason: CHANGED_REASON });
            continue;
          }
          next.push(state);
          continue;
        }
        // A start-again record without a kept approval cannot start; the record says what the person must do.
        const needsApproval = state.autoStart === true;
        next.push(needsApproval ? { ...state, reason: NEEDS_APPROVAL_REASON } : state);
        continue;
      }

      let current: ConnectionApproval | undefined;
      try {
        current = await approvalFor(host, context, connection);
      } catch {
        current = undefined;
      }
      if (current && current.approvalHash === previous.approvalHash) {
        next.push({ ...previous, packageVersion: loaded.packageVersion });
      } else if (current && DATA_KINDS.has(connection.kind)) {
        // Data only: follow the new content without asking again.
        const failure = await switchOff(loaded, connection, previous);
        try {
          if (failure) throw new Error(failure);
          const enabled = await host.enable(context, connection as never);
          next.push({
            ...previous,
            packageVersion: loaded.packageVersion,
            approvalHash: current.approvalHash,
            installed: [...enabled.installed],
          });
        } catch (error) {
          next.push({ ...state, status: 'error', lastError: shortError(error) });
        }
      } else {
        // Changed content: the approval no longer matches what would run, so it is dropped.
        const failure = await switchOff(loaded, connection, previous);
        next.push({
          ...plain,
          status: 'needs-input',
          reason: CHANGED_REASON,
          ...(failure ? { lastError: failure } : {}),
        });
      }
    }

    // A connection the package no longer declares is no longer in `keep`, so host.reconcile() removes its items.
    const kindByKey = new Map(
      loaded.adapter.connections.map((connection) => [connectionKey(connection), connection.kind])
    );
    await deps.store.replaceForPackage(
      packageId,
      next.map((state) => withRevokedNotice(loaded, state, kindByKey.get(state.connectionKey)))
    );
    return buildViews(loaded);
  };

  const enableOne = async (packageId: string, key: string, approvalHash: string) => {
    const loaded = await requireLoaded(packageId);
    const connection = findConnection(loaded, key);
    if (isRevokedCode(loaded, connection)) throw new ConnectionError('UNSUPPORTED', REVOKED_CODE_REASON);
    const host = hosts.get(connection.kind);
    if (!host) {
      throw new ConnectionError(
        'UNSUPPORTED',
        connectionNotInstallableReason(connection) ?? `No host for connection kind ${connection.kind}.`
      );
    }
    const context = contextFor(loaded);
    const check = await host.check(context, connection as never);
    if (check.ok === false) throw new ConnectionError('RUNTIME_MISSING', check.reason);
    const required = requiredConnectionEnv(loaded.adapter, connection);
    const missing =
      required.length > 0 ? await (deps.missingRequiredEnv?.(packageId, required) ?? Promise.resolve(required)) : [];
    if (missing.length > 0)
      throw new ConnectionError('RUNTIME_MISSING', `Cần nhập biến môi trường: ${missing.join(', ')}`);

    const approval = await approvalFor(host, context, connection);
    if (approval.approvalHash !== approvalHash) {
      throw new ConnectionError('APPROVAL_REQUIRED', 'What would run changed since it was shown; review it again.');
    }

    // Alternatives in the same group: only one may be on.
    const group = 'group' in connection ? connection.group : undefined;
    if (group !== undefined) {
      for (const other of loaded.adapter.connections) {
        const otherKey = connectionKey(other);
        if (otherKey === key || !('group' in other) || other.group !== group) continue;
        const otherState = deps.store.get(packageId, otherKey);
        if (!otherState?.enabled) continue;
        const failure = await switchOff(loaded, other, otherState);
        await deps.store.save({
          ...base(loaded, otherKey),
          ...preference(otherState),
          ...retainedApproval(otherState),
          ...(failure ? { status: 'error' as const, lastError: failure } : {}),
        });
      }
    }

    try {
      const enabled = await host.enable(context, connection as never);
      const state: InstalledConnectionState = {
        ...base(loaded, key),
        ...preference(deps.store.get(packageId, key)),
        enabled: true,
        status: 'on',
        approvalHash,
        approvedAt: now(),
        installed: [...enabled.installed],
      };
      await deps.store.save(state);
      return state;
    } catch (error) {
      // Undo anything a failing host may have half-installed, then record the failure.
      const recorded = deps.store.get(packageId, key);
      await switchOff(loaded, connection, recorded ?? base(loaded, key));
      const failed: InstalledConnectionState = {
        ...base(loaded, key),
        ...preference(recorded),
        ...retainedApproval(recorded),
        status: 'error',
        lastError: shortError(error),
      };
      await deps.store.save(failed);
      throw new ConnectionError('HOST_FAILED', failed.lastError ?? 'The connection could not be turned on.');
    }
  };

  const disableOne = async (packageId: string, key: string) => {
    const loaded = await requireLoaded(packageId);
    const connection = findConnection(loaded, key);
    const previous = deps.store.get(packageId, key) ?? base(loaded, key);
    const failure = await switchOff(loaded, connection, previous);
    const state: InstalledConnectionState = {
      ...base(loaded, key),
      ...preference(previous),
      ...retainedApproval(previous),
      ...(failure ? { status: 'error' as const, lastError: failure } : {}),
    };
    await deps.store.save(state);
    return state;
  };

  /** Marks a connection to start again, or not. It needs a record that a sync created; it approves nothing. */
  const setAutoStartOne = async (packageId: string, key: string, value: boolean): Promise<InstalledConnectionState> => {
    const loaded = await requireLoaded(packageId);
    const connection = findConnection(loaded, key);
    if (DATA_KINDS.has(connection.kind)) {
      throw new ConnectionError('UNSUPPORTED', 'Only connections that run code can start again automatically.');
    }
    const current = deps.store.get(packageId, key);
    if (!current) throw new ConnectionError('UNKNOWN_CONNECTION', `No recorded state for connection: ${key}`);
    // Off and no longer started again: the kept approval has no purpose, so it goes with the choice.
    const state: InstalledConnectionState =
      !value && !current.enabled ? withoutApproval(current, { autoStart: false }) : { ...current, autoStart: value };
    await deps.store.save(state);
    return state;
  };

  /**
   * Startup for one installed package. The package is synced first: changed content, revoked trust and missing values turn a
   * connection off with its reason. Then a code-running connection that is still on is switched off for this session unless
   * the person marked it to start again. Last, every connection marked to start again that still holds its approval is
   * enabled through the same checks as a manual enable, whether it is on or off now: the approval is the proof of what was
   * shown, so a record without one stays off (sync gives it the reason), and a stale approval never starts anything.
   */
  const restoreSession = async (packageId: string): Promise<void> => {
    const loaded = await requireLoaded(packageId);
    await sync(packageId);
    for (const connection of loaded.adapter.connections) {
      if (DATA_KINDS.has(connection.kind)) continue;
      const key = connectionKey(connection);
      const previous = deps.store.get(packageId, key);
      if (!previous?.enabled || previous.autoStart === true) continue;
      const failure = await switchOff(loaded, connection, previous);
      await deps.store.save({
        ...base(loaded, key),
        reason: SESSION_ENDED_REASON,
        ...(failure ? { status: 'error' as const, lastError: failure } : {}),
      });
    }
    for (const connection of loaded.adapter.connections) {
      if (DATA_KINDS.has(connection.kind)) continue;
      const key = connectionKey(connection);
      const current = deps.store.get(packageId, key);
      if (current?.autoStart !== true || current.approvalHash === undefined) continue;
      try {
        await enableOne(packageId, key, current.approvalHash);
      } catch (error) {
        // A failed check or host leaves the record off with its approval kept, so the next start tries again.
        const still = deps.store.get(packageId, key);
        // A host failure is already recorded as `error` with its reason, and the approval is kept there too.
        if (still?.status === 'error' && still.enabled !== true) continue;
        const failure = still?.enabled === true ? await switchOff(loaded, connection, still) : undefined;
        await deps.store.save({
          ...base(loaded, key),
          ...preference(still),
          ...retainedApproval(still),
          status: 'needs-input',
          reason: shortError(error),
          ...(failure ? { lastError: failure } : {}),
        });
      }
    }
  };

  const removeOne = async (packageId: string): Promise<void> => {
    const loaded = await deps.loadPackage(packageId);
    if (loaded) {
      for (const connection of loaded.adapter.connections) {
        const previous = deps.store.get(packageId, connectionKey(connection));
        if (previous?.enabled) await switchOff(loaded, connection, previous);
      }
    }
    await deps.store.removePackage(packageId);
  };

  /**
   * Each host removes what it installed for a connection that is no longer kept. Only enabled connections of installed
   * packages are kept, the same set Settings lists, so the catalog and the Settings list cannot disagree. One host
   * failing never stops the others.
   */
  const reconcileHosts = async (installed: ReadonlySet<string>): Promise<void> => {
    const keep = new Set(
      deps.store
        .list()
        .filter((state) => state.enabled && installed.has(state.packageId))
        .map((state) => `${state.packageId}\u0000${state.connectionKey}`)
    );
    for (const host of hosts.values()) {
      try {
        await host.reconcile?.({ keep });
      } catch {
        // One host failing to clean up must not stop the others.
      }
    }
  };

  return {
    syncPackage: (packageId) => serialized(packageId, () => sync(packageId)),
    view: (packageId) =>
      serialized(packageId, async () =>
        deps.missingRequiredEnv ? sync(packageId) : buildViews(await requireLoaded(packageId))
      ),
    describe: (packageId, key) =>
      serialized(packageId, async () => {
        const loaded = await requireLoaded(packageId);
        const connection = findConnection(loaded, key);
        const host = hosts.get(connection.kind);
        if (!host) {
          throw new ConnectionError(
            'UNSUPPORTED',
            connectionNotInstallableReason(connection) ?? `No host for connection kind ${connection.kind}.`
          );
        }
        return approvalFor(host, contextFor(loaded), connection);
      }),
    enable: (packageId, key, approvalHash) => serialized(packageId, () => enableOne(packageId, key, approvalHash)),
    disable: (packageId, key) => serialized(packageId, () => disableOne(packageId, key)),
    setAutoStart: (packageId, key, value) => serialized(packageId, () => setAutoStartOne(packageId, key, value)),
    // Host cleanup always follows the record removal, so a package that leaves the installed set (quarantined, removed)
    // takes its catalog servers and live effects with it, even when this call is the only one made.
    removePackage: async (packageId) => {
      try {
        await serialized(packageId, () => removeOne(packageId));
      } finally {
        await reconcileHosts(new Set(await deps.listInstalledPackageIds())).catch((): undefined => undefined);
      }
    },
    enabledOfKind: async (kind) => {
      const prefix = `${kind}:`;
      const packageIds = [
        ...new Set(
          deps.store
            .list()
            .filter((state) => state.enabled && state.connectionKey.startsWith(prefix))
            .map((state) => state.packageId)
        ),
      ];
      const found: EnabledConnection[] = [];
      for (const packageId of packageIds) {
        let loaded: LoadedPackage | undefined;
        try {
          loaded = await deps.loadPackage(packageId);
        } catch {
          loaded = undefined;
        }
        if (!loaded) continue;
        if (loaded.trust === 'unsigned-revoked' && !DATA_KINDS.has(kind)) continue;
        const context = contextFor(loaded);
        for (const connection of loaded.adapter.connections) {
          const key = connectionKey(connection);
          if (connection.kind !== kind || !deps.store.get(packageId, key)?.enabled) continue;
          found.push({ packageId, packageVersion: loaded.packageVersion, key, connection, context });
        }
      }
      return found;
    },
    startApprovalNeeded: async () => [
      ...new Set(
        deps.store
          .list()
          .filter((state) => awaitsStartApproval(state))
          .map((state) => state.packageId)
      ),
    ],
    reconcile: async () => {
      const installed = new Set(await deps.listInstalledPackageIds());
      const known = new Set(deps.store.list().map((state) => state.packageId));
      for (const packageId of known) {
        if (!installed.has(packageId)) {
          // Not installed (quarantined, failed or removed): its records and live effects go. One failure must not stop
          // the host cleanup below, which is what keeps the catalog in step with the installed packages.
          await serialized(packageId, () => removeOne(packageId)).catch((): undefined => undefined);
          continue;
        }
        try {
          // The start of this app run restores a package once; later reconciles (another package changed) only sync it,
          // so a connection the person turned off or started for this session is not switched back.
          await serialized(packageId, async () => {
            if (restoredThisRun.has(packageId)) return sync(packageId);
            await restoreSession(packageId);
            restoredThisRun.add(packageId);
            return undefined;
          });
        } catch {
          // A package whose adapter cannot be read keeps its recorded state; sync reports on the next attempt.
        }
      }
      await reconcileHosts(installed);
    },
  };
};
