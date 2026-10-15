/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The document-level schemas of `adapter/adapter.json` (strict, for the writer) and the pieces the reader reuses
 * in tolerant form: open items, provenance and the detector list. Connection schemas live in `./connections`.
 */

import { z } from 'zod';
import {
  ADAPTER_SCHEMA_VERSION,
  connectionId,
  ENV_KEY,
  httpsUrl,
  isSafeRelativePath,
  MAX_CONNECTIONS,
  MAX_OPEN_ITEMS,
  packagePath,
  shapedFor,
} from './primitives';
import { connectionKey, connectionSchema, type AdapterConnection, type AdapterConnectionKind } from './connections';

/**
 * What the backend could not finish and hands to an agent or the user. Kinds: `env-value` (a variable that
 * needs a value), `unrecognized` (code the rules could not turn into a connection), `needs-runtime` (a
 * connection this host cannot run yet), `choose` (several equal options, `connections` naming the ids in one
 * `group`), `needs-build` (build first, then point at the output folder) and `needs-consent` (a broad permission or
 * a background service that needs explicit consent before it is switched on).
 */
export const ADAPTER_OPEN_ITEM_KINDS = [
  'env-value',
  'unrecognized',
  'needs-runtime',
  'choose',
  'needs-build',
  'needs-consent',
] as const;

export const buildOpenItemSchema = (tolerant: boolean) =>
  shapedFor(tolerant)({
    kind: z.enum(ADAPTER_OPEN_ITEM_KINDS),
    note: z.string().trim().min(1).max(300),
    connection: connectionId.optional(),
    path: packagePath.optional(),
    name: z.string().max(64).regex(ENV_KEY).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().min(1).max(100)).max(8).optional(),
    connections: z.array(connectionId).max(16).optional(),
  });
const openItemSchema = buildOpenItemSchema(false);

export const GENERATED_BY = ['classifier', 'agent', 'user'] as const;

const PROVENANCE_KINDS = ['git', 'local', 'url', 'store', 'user', 'chrome-web-store'] as const;
/** Kinds whose `url` is fetched again on update, so it must be an https address. */
const REMOTE_PROVENANCE_KINDS: ReadonlySet<string> = new Set(['git', 'url', 'store', 'chrome-web-store']);

/**
 * Where a package came from, so it can be updated from the same source. `url` and `commit` are identifiers, not
 * permission: an update still goes through the normal egress and consent checks.
 */
export const buildProvenanceSchema = (tolerant: boolean) =>
  shapedFor(tolerant)({
    kind: z.enum(PROVENANCE_KINDS),
    url: z.string().min(1).max(500).optional(),
    /** Full 40-character commit id. */
    commit: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .optional(),
    ref: z.string().min(1).max(200).optional(),
    /** Folder of the repository the package was built from. */
    subdirectory: z
      .string()
      .min(1)
      .max(240)
      .refine(isSafeRelativePath, 'must be a relative path without ..')
      .optional(),
    /** Chrome Web Store extension id (32 letters a-p). */
    extensionId: z
      .string()
      .regex(/^[a-p]{32}$/)
      .optional(),
    extensionVersion: z
      .string()
      .max(64)
      .regex(/^[0-9][0-9.]*$/)
      .optional(),
    /** Milliseconds since the epoch. */
    packagedAt: z.number().int().nonnegative(),
  }).refine(
    (value) =>
      !REMOTE_PROVENANCE_KINDS.has(value.kind) || value.url === undefined || httpsUrl(500).safeParse(value.url).success,
    { message: 'url must be https for a remote source' }
  );

/** `"<detector id>@<version>"`: which detectors produced the connections, to tell old packages from new ones. */
export const detectorEntry = z
  .string()
  .max(100)
  .regex(/^[a-z0-9][a-z0-9._-]*@[0-9][0-9.]*$/);
export const detectorList = z.array(detectorEntry).max(64);

export const adapterDocumentSchema = z
  .object({
    schemaVersion: z.literal(ADAPTER_SCHEMA_VERSION),
    generatedBy: z.enum(GENERATED_BY),
    connections: z.array(connectionSchema).max(MAX_CONNECTIONS),
    openItems: z.array(openItemSchema).max(MAX_OPEN_ITEMS).optional(),
    provenance: buildProvenanceSchema(false).optional(),
    detectors: detectorList.optional(),
  })
  .strict()
  .superRefine((document, context) => {
    const seen = new Set<string>();
    for (const [index, connection] of document.connections.entries()) {
      const key = connectionKey(connection);
      if (seen.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['connections', index],
          message: `Duplicate connection ${key}`,
        });
      }
      seen.add(key);
    }
  });

export type AdapterDocument = z.infer<typeof adapterDocumentSchema>;
export type AdapterOpenItem = z.infer<typeof openItemSchema>;
export type AdapterProvenance = NonNullable<AdapterDocument['provenance']>;

/**
 * Connection kinds this version of the app can install: every kind that has a host in
 * `defaultHosts` (process/integrations/connections/wiring/connectionRuntime.ts). `bridge` and `vscode` have no host
 * yet, so they stay in the package, switched off. Keep this set in step with `defaultHosts`.
 */
export const ADAPTER_INSTALLABLE_KINDS: ReadonlySet<AdapterConnectionKind> = new Set([
  'mcp',
  'skill',
  'agent',
  'command',
  'rules',
  'knowledge',
  'hook',
  'cli',
  'tool',
  'extension',
  'web-embed',
  'service',
  'launcher',
]);

export const isInstallableConnection = (connection: AdapterConnection): boolean =>
  ADAPTER_INSTALLABLE_KINDS.has(connection.kind);

/** Why a connection is not installed by this version of the app, in words the user can read. */
export const connectionNotInstallableReason = (connection: AdapterConnection): string | undefined =>
  isInstallableConnection(connection)
    ? undefined
    : `Phiên bản này chưa có thành phần để chạy kết nối "${connection.kind}"; kết nối được giữ trong gói và đang tắt.`;

/** Validates a document this version of the app is about to write. Throws on anything unexpected. */
export const parseAdapterDocument = (raw: unknown): AdapterDocument => adapterDocumentSchema.parse(raw);

export const serializeAdapterDocument = (document: AdapterDocument): string =>
  `${JSON.stringify(adapterDocumentSchema.parse(document), null, 2)}\n`;
