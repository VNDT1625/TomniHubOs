/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PackageManifest, PackageTrust } from '../types';
import { connectionKey, isKnownConnectionKind, parseTolerantConnection, type AdapterConnection } from './connections';
import { declaresLocalService, isHttpWebConnection, loopbackAllowed } from './loopback';
import { ADAPTER_SCHEMA_VERSION, MAX_CONNECTIONS, MAX_OPEN_ITEMS } from './primitives';
import {
  ADAPTER_OPEN_ITEM_KINDS,
  buildOpenItemSchema,
  buildProvenanceSchema,
  detectorList,
  GENERATED_BY,
  type AdapterDocument,
  type AdapterOpenItem,
} from './schema';

const tolerantOpenItemSchema = buildOpenItemSchema(true);
const tolerantProvenanceSchema = buildProvenanceSchema(true);

export type AdapterReadIssue = Readonly<{
  /** Position in `connections`, or -1 for the document itself. */
  index: number;
  kind: string;
  reason: 'unknown-kind' | 'invalid' | 'duplicate' | 'newer-version' | 'unreadable';
  message: string;
}>;

export type AdapterReadResult = Readonly<{
  /** The connections this version understands and found valid. */
  document: AdapterDocument;
  /** What was left out and why. Not errors: the package still installs with what remains. */
  issues: readonly AdapterReadIssue[];
}>;

/**
 * Who the package is, for the rules that depend on it. `trust` is the installed trust tier; without it the package is
 * treated as not `local-built`, so a loopback `web-embed` address is refused unless the package declares a local service.
 */
export type AdapterReadOptions = Readonly<{ trust?: PackageTrust }>;

const EMPTY_FROM_UNKNOWN_SOURCE = (): AdapterDocument => ({ schemaVersion: 1, generatedBy: 'agent', connections: [] });

const LOOPBACK_REFUSED =
  'a loopback web-embed address needs a local-built package or a local service declared in the same package';

/**
 * Reads an adapter written by this or any other version of the app. It never throws: fields it does not
 * know are ignored, connection kinds it does not know are skipped, and a connection that fails validation is
 * dropped on its own. A document whose origin is unreadable is treated like agent output. A plain-http `web-embed`
 * address is kept only when the package policy allows loopback (`loopback.ts`).
 */
export const readAdapterDocument = (raw: unknown, options: AdapterReadOptions = {}): AdapterReadResult => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      document: EMPTY_FROM_UNKNOWN_SOURCE(),
      issues: [{ index: -1, kind: 'document', reason: 'unreadable', message: 'adapter.json is not an object' }],
    };
  }
  const source = raw as Record<string, unknown>;
  if (typeof source.schemaVersion === 'number' && source.schemaVersion > ADAPTER_SCHEMA_VERSION) {
    return {
      document: EMPTY_FROM_UNKNOWN_SOURCE(),
      issues: [
        {
          index: -1,
          kind: 'document',
          reason: 'newer-version',
          message: `adapter.json uses schemaVersion ${source.schemaVersion}; this version understands up to ${ADAPTER_SCHEMA_VERSION}`,
        },
      ],
    };
  }
  const generatedBy = GENERATED_BY.find((candidate) => candidate === source.generatedBy) ?? 'agent';
  const items = Array.isArray(source.connections) ? (source.connections as unknown[]) : [];
  const parsedEntries: { index: number; kind: string; connection: AdapterConnection }[] = [];
  const issues: AdapterReadIssue[] = [];
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (index >= MAX_CONNECTIONS) {
      issues.push({
        index,
        kind: 'document',
        reason: 'invalid',
        message: `only the first ${MAX_CONNECTIONS} connections are read`,
      });
      break;
    }
    const kind =
      typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).kind === 'string'
        ? String((item as Record<string, unknown>).kind)
        : '';
    if (!isKnownConnectionKind(kind)) {
      issues.push({
        index,
        kind: kind === '' ? 'unknown' : kind,
        reason: 'unknown-kind',
        message: `connection kind "${kind}" is not known to this version of the app`,
      });
      continue;
    }
    const parsed = parseTolerantConnection(kind, item);
    if (!parsed.success) {
      issues.push({ index, kind, reason: 'invalid', message: parsed.message });
      continue;
    }
    const key = connectionKey(parsed.data);
    if (seen.has(key)) {
      issues.push({ index, kind, reason: 'duplicate', message: `duplicate connection ${key}` });
      continue;
    }
    seen.add(key);
    parsedEntries.push({ index, kind, connection: parsed.data });
  }
  // The loopback rule needs the whole document: a local service may be declared after the web-embed that uses it.
  const policy = {
    trust: options.trust,
    declaresLocalService: declaresLocalService(parsedEntries.map((entry) => entry.connection)),
  };
  const connections: AdapterConnection[] = [];
  for (const entry of parsedEntries) {
    if (isHttpWebConnection(entry.connection) && !loopbackAllowed(policy)) {
      issues.push({ index: entry.index, kind: entry.kind, reason: 'invalid', message: LOOPBACK_REFUSED });
      continue;
    }
    connections.push(entry.connection);
  }
  const openItems: AdapterOpenItem[] = [];
  const rawOpenItems = Array.isArray(source.openItems) ? (source.openItems as unknown[]) : [];
  for (const [index, item] of rawOpenItems.slice(0, MAX_OPEN_ITEMS).entries()) {
    const kind = typeof item === 'object' && item !== null ? String((item as Record<string, unknown>).kind ?? '') : '';
    const known = (ADAPTER_OPEN_ITEM_KINDS as readonly string[]).includes(kind);
    const parsed = known ? tolerantOpenItemSchema.safeParse(item) : undefined;
    if (parsed?.success) openItems.push(parsed.data);
    else {
      issues.push({
        index,
        kind: `open-item:${kind === '' ? 'unknown' : kind}`,
        reason: known ? 'invalid' : 'unknown-kind',
        message: parsed?.error.issues[0]?.message ?? `open item kind "${kind}" is not known to this version of the app`,
      });
    }
  }
  // Document-level fields: a malformed one is dropped on its own and reported, like a broken connection.
  const provenance =
    source.provenance === undefined ? undefined : tolerantProvenanceSchema.safeParse(source.provenance);
  if (provenance && !provenance.success) {
    issues.push({
      index: -1,
      kind: 'provenance',
      reason: 'invalid',
      message: provenance.error.issues[0]?.message ?? 'invalid provenance',
    });
  }
  const detectors = source.detectors === undefined ? undefined : detectorList.safeParse(source.detectors);
  if (detectors && !detectors.success) {
    issues.push({
      index: -1,
      kind: 'detectors',
      reason: 'invalid',
      message: detectors.error.issues[0]?.message ?? 'invalid detectors',
    });
  }
  return {
    document: {
      schemaVersion: 1,
      generatedBy,
      connections,
      ...(openItems.length > 0 ? { openItems } : {}),
      ...(provenance?.success ? { provenance: provenance.data } : {}),
      ...(detectors?.success ? { detectors: detectors.data } : {}),
    },
    issues,
  };
};

/**
 * The adapter of a package that has no `adapter/adapter.json` (built before the standard layout). Its MCP
 * servers become `mcp` connections, so installers read one shape.
 */
export const adapterFromManifest = (manifest: Pick<PackageManifest, 'contributions'>): AdapterDocument => {
  const connections: AdapterConnection[] = [];
  for (const server of manifest.contributions?.mcpServers ?? []) {
    connections.push({
      kind: 'mcp',
      id: server.id,
      title: server.title,
      ...(server.description ? { description: server.description } : {}),
      command: server.command,
      args: [...server.args],
      ...(server.envKeys?.length ? { env: server.envKeys.map((name) => ({ name, required: false })) } : {}),
    });
  }
  return { schemaVersion: 1, generatedBy: 'classifier', connections };
};
