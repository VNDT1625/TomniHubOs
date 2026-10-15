/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Loopback addresses a `web-embed` `url` may name (docs/platform/repotopackage-design.md, decision B). Plain `http` is
 * accepted only as `127.0.0.1` or `localhost` with an explicit port, and only for a package that is `local-built` or
 * that declares a local service of its own. Every other `url` stays https-only. The reader applies this policy when it
 * reads `adapter.json`, and the host applies it again when it checks and opens the app.
 */

import type { PackageTrust } from '../types';
import type { AdapterConnection } from './connections';

const LOOPBACK_URL = /^http:\/\/(?:127\.0\.0\.1|localhost):([1-9][0-9]{0,4})(\/[A-Za-z0-9._~/-]*)?$/u;
const MAX_LOOPBACK_URL = 500;

/**
 * True for `http://127.0.0.1:<port>[/path]` and `http://localhost:<port>[/path]` only. Refused: other hosts (`0.0.0.0`,
 * `[::]`, `localhost.example.com`), numeric forms of 127.0.0.1 (decimal, hex, octal), a user name or password, a
 * missing port, a query or a fragment, a port above 65535, and a path with `..`.
 */
export const isLoopbackWebUrl = (value: string): boolean => {
  if (value.length > MAX_LOOPBACK_URL) return false;
  const match = LOOPBACK_URL.exec(value);
  if (match === null) return false;
  const port = Number(match[1]);
  const pathPart = match[2] ?? '';
  return port >= 1 && port <= 65535 && !pathPart.split('/').includes('..');
};

/** What the package is, as far as the loopback rule cares. A missing trust tier is not `local-built` (fails closed). */
export type LoopbackPolicy = Readonly<{ trust?: PackageTrust; declaresLocalService: boolean }>;

/** True when the package declares a program that runs on this machine: a `service` or a `web-embed` process. */
export const declaresLocalService = (connections: readonly AdapterConnection[]): boolean =>
  connections.some(
    (connection) =>
      connection.kind === 'service' || (connection.kind === 'web-embed' && connection.process !== undefined)
  );

/** Whether a package with this policy may use a loopback `url`. */
export const loopbackAllowed = (policy: LoopbackPolicy): boolean =>
  policy.trust === 'local-built' || policy.declaresLocalService;

/** True for a `web-embed` connection whose `url` is plain http (the only ones the loopback policy governs). */
export const isHttpWebConnection = (connection: AdapterConnection): boolean =>
  connection.kind === 'web-embed' && connection.url !== undefined && connection.url.startsWith('http:');
