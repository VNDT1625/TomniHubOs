/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `adapter/adapter.json`: the outer shell of a package built from a repository. It lists the connections
 * that join the repository (kept untouched under `source/`) to the app. See docs/platform/package-shell-layout.md
 * and docs/platform/repotopackage-design.md section 6.
 *
 * Every connection is data. Nothing in this file runs by itself: the host installs the kinds it can run
 * (`ADAPTER_INSTALLABLE_KINDS`) and keeps the others off with a reason.
 *
 * Compatibility: the writer is strict and the reader is tolerant. A package is written with `adapterDocumentSchema`
 * (unknown fields are rejected, so mistakes show up when a package is built). A host reads it with
 * `readAdapterDocument`, which ignores fields it does not know, skips connection kinds it does not know and drops
 * one broken connection without losing the others, reporting each as an issue instead of failing. A newer field or
 * kind therefore never breaks an older host, and a connection that is absent is not an error. `schemaVersion` changes
 * only when the meaning of existing fields changes; adding fields or kinds does not change it.
 *
 * Layout: `primitives.ts` (shared validators), `connections/` (one builder per kind), `schema.ts` (document level,
 * installable kinds), `read.ts` (tolerant reader, manifest fallback).
 */

export {
  ADAPTER_FILE,
  ADAPTER_ORIGINS,
  ADAPTER_PROCESS_PROGRAMS,
  ADAPTER_SCHEMA_VERSION,
  ADAPTER_SOURCE_DIRECTORY,
} from './primitives';
export {
  ADAPTER_CONNECTION_KINDS,
  ADAPTER_HOOK_EVENTS,
  ADAPTER_MCP_COMMANDS,
  connectionKey,
  type AdapterConnection,
  type AdapterConnectionKind,
} from './connections';
export {
  ADAPTER_INSTALLABLE_KINDS,
  ADAPTER_OPEN_ITEM_KINDS,
  adapterDocumentSchema,
  connectionNotInstallableReason,
  isInstallableConnection,
  parseAdapterDocument,
  serializeAdapterDocument,
  type AdapterDocument,
  type AdapterOpenItem,
  type AdapterProvenance,
} from './schema';
export {
  adapterFromManifest,
  readAdapterDocument,
  type AdapterReadIssue,
  type AdapterReadOptions,
  type AdapterReadResult,
} from './read';
export {
  declaresLocalService,
  isHttpWebConnection,
  isLoopbackWebUrl,
  loopbackAllowed,
  type LoopbackPolicy,
} from './loopback';
