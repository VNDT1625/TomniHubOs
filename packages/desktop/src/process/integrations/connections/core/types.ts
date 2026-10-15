/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Contracts of the connection layer (docs/platform/repotopackage-design.md sections 6.5, 9.3, 9.4): one
 * `ConnectionHost` owns installing, enabling, disabling and cleaning up one kind of connection. Hosts know
 * nothing about detectors, and detectors nothing about hosts; both only share `adapter.json`.
 */

import type { AdapterConnection, AdapterConnectionKind } from '@/common/packages/adapter';
import type { PackageTrust } from '@/common/packages/types';

export type ConnectionErrorCode =
  | 'APPROVAL_REQUIRED'
  | 'RUNTIME_MISSING'
  | 'UNKNOWN_CONNECTION'
  | 'UNSUPPORTED'
  | 'PACKAGE_NOT_INSTALLED'
  | 'PATH_FORBIDDEN'
  | 'HOST_FAILED';

/** Stable error for the connection IPC; `code` is what tests and the renderer branch on. */
export class ConnectionError extends Error {
  readonly code: ConnectionErrorCode;
  constructor(code: ConnectionErrorCode, message: string) {
    super(message);
    this.name = 'ConnectionError';
    this.code = code;
  }
}

/** Everything a host may know about the package it acts for. Main-owned; never built from renderer input. */
export type HostContext = Readonly<{
  packageId: string;
  packageVersion: string;
  /** Absolute directory of the extracted package. */
  packageDirectory: string;
  /** Reads a file below the package directory; rejects traversal and symlinks that leave the package. */
  readPackageFile: (relativePath: string) => Promise<Buffer>;
  /** Trust tier of the installed package. Missing counts as not `local-built`: a loopback address is then refused. */
  trust?: PackageTrust;
  /** Whether the package declares a service or a web-embed process of its own (see `loopback.ts`). */
  declaresLocalService?: boolean;
}>;

export type HostCheck = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string; needsInput?: boolean }>;

/** What the user is shown before turning a connection on, and what the approval hash covers. */
export type ApprovalSubject = Readonly<{
  kind: AdapterConnectionKind;
  title: string;
  /** Exact command, URL, event, permissions... in the order they are shown. */
  lines: readonly Readonly<{ label: string; value: string }>[];
  /** Package-relative files whose content is part of the approval (scripts that would run). */
  files: readonly string[];
}>;

/**
 * The connections of kind `K`. `kind?` (optional) on purpose: without `strictNullChecks` (the root tsconfig) the
 * inferred members have `kind?: 'mcp'`, which is not assignable to `{ kind: K }`, so a required `kind` made this `never`.
 * With strict checks the members are `{ kind: 'mcp' }`, still assignable to `{ kind?: K }`.
 */
export type ConnectionOf<K extends AdapterConnectionKind> = Extract<AdapterConnection, { kind?: K }>;

export type ConnectionHost<K extends AdapterConnectionKind = AdapterConnectionKind> = Readonly<{
  kind: K;
  /** No side effects. Says in plain words why this machine cannot run the connection yet. */
  check: (context: HostContext, connection: ConnectionOf<K>) => Promise<HostCheck>;
  describe: (context: HostContext, connection: ConnectionOf<K>) => Promise<ApprovalSubject>;
  /** Idempotent. Returns the names it put into the target store so `disable` can remove exactly those. */
  enable: (context: HostContext, connection: ConnectionOf<K>) => Promise<Readonly<{ installed: readonly string[] }>>;
  /** Idempotent: disabling something that is not enabled is not an error. */
  disable: (context: HostContext, connection: ConnectionOf<K>, installed: readonly string[]) => Promise<void>;
  /** At startup: remove what this host installed for packages or connections that are gone or no longer enabled. */
  reconcile?: (input: HostReconcileInput) => Promise<void>;
}>;

export type HostReconcileInput = Readonly<{
  /** `${packageId}\u0000${connectionKey}` of every connection that must stay installed. */
  keep: ReadonlySet<string>;
}>;

/** The registry stores hosts by kind; this is the one place the per-kind generic is erased. */
export type AnyConnectionHost = ConnectionHost<AdapterConnectionKind>;

/** Types a host for one kind, then erases the generic so hosts of different kinds can share a list. */
export const defineConnectionHost = <K extends AdapterConnectionKind>(host: ConnectionHost<K>): AnyConnectionHost =>
  host as unknown as AnyConnectionHost;
