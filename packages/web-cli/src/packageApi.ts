/**
 * @license
 * Copyright 2025 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import {
  FIRST_PARTY_PACKAGE_CATALOG,
  excludeDefaultSurfaceCatalogEntries,
  FIRST_PARTY_PACKAGE_TRUSTED_KEYS,
} from '../../desktop/src/common/packages/index.js';
import {
  createLocalPackageMutationRuntime,
  createPackageHttpApi,
  createPackageHttpRuntimeRegistry,
  isSameOriginPackageMutationRequest,
} from '../../desktop/src/process/extensions/package-manager/packageHttpApi.js';
import { createPackageManagerService } from '../../desktop/src/process/extensions/package-manager/PackageManagerService.js';

type PackageApiHandler = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;

type WebCliPackageApiOptions = {
  dataDir: string;
  appVersion: string;
  backendPort: number;
  resolveArtifactUrl?: (url: string) => string;
  allowLocalArtifactUrls?: boolean;
  fetchImpl?: typeof fetch;
};

type ArtifactEnvironment = Readonly<Record<string, string | undefined>>;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const parseAuthenticatedPrincipal = (value: unknown): string | undefined => {
  const root = asRecord(value);
  if (!root) return undefined;
  const user = asRecord(root.user);
  const data = asRecord(root.data);
  const candidate = user?.id ?? data?.id ?? root.id ?? user?.username ?? data?.username ?? root.username;
  if (typeof candidate !== 'string' || !candidate.trim() || candidate.length > 512) return undefined;
  if ([...candidate].some((character) => (character.codePointAt(0) ?? 0) <= 31)) return undefined;
  return candidate;
};

const packageMutationOwner = (principal: string): string =>
  `http-user:${createHash('sha256').update(principal).digest('hex')}`;

/** Resolves Store downloads to an optional remote mirror without shipping artifacts in the base host. */
export const resolveWebCliPackageArtifactUrl = (
  artifactUrl: string,
  env: ArtifactEnvironment = process.env
): string => {
  const exactUrl = env.TOMNI_PACKAGE_ARTIFACT_URL?.trim();
  if (exactUrl) return exactUrl;

  const baseUrl = env.TOMNI_PACKAGE_ARTIFACT_BASE_URL?.trim();
  if (!baseUrl) return artifactUrl;
  const filename = new URL(artifactUrl).pathname.split('/').at(-1);
  if (!filename) return artifactUrl;
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(encodeURIComponent(filename), normalizedBase).toString();
};

/** Creates the owner-local Package API used by the released standalone Web CLI. */
export const createWebCliPackageApiHandler = ({
  dataDir,
  appVersion,
  backendPort,
  resolveArtifactUrl,
  allowLocalArtifactUrls = false,
  fetchImpl = fetch,
}: WebCliPackageApiOptions): PackageApiHandler => {
  const packageRoot = path.join(dataDir, 'tomny-packages');
  const authenticatedMutationOwners = new WeakMap<IncomingMessage, string>();
  const runtime = createPackageHttpRuntimeRegistry();
  const service = createPackageManagerService({
    rootDir: packageRoot,
    appVersion,
    catalog: excludeDefaultSurfaceCatalogEntries(FIRST_PARTY_PACKAGE_CATALOG),
    trustedKeys: FIRST_PARTY_PACKAGE_TRUSTED_KEYS,
    firstPartyTrustedKeys: FIRST_PARTY_PACKAGE_TRUSTED_KEYS,
    resolveArtifactUrl,
    allowLocalArtifactUrls,
    isPackageSandboxActive: runtime.isActive,
    reservePackageSandboxMutation: runtime.reserveMutation,
  });
  const mutation = createLocalPackageMutationRuntime({
    service,
    ledgerRootDir: path.join(packageRoot, 'catalog-action-ledger'),
  });

  return createPackageHttpApi({
    service,
    mutation,
    runtime,
    authorize: async (request) => {
      try {
        const response = await fetchImpl(`http://127.0.0.1:${backendPort}/api/auth/user`, {
          headers: { cookie: request.headers.cookie ?? '' },
        });
        if (!response.ok) return false;
        const payload = await response.json().catch(() => undefined);
        const principal = parseAuthenticatedPrincipal(payload);
        if (principal) authenticatedMutationOwners.set(request, packageMutationOwner(principal));
        return true;
      } catch {
        return false;
      }
    },
    authorizeMutation: isSameOriginPackageMutationRequest,
    resolveMutationOwner: (request) => authenticatedMutationOwners.get(request),
  });
};
