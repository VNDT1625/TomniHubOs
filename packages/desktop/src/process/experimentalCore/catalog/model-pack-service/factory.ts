/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { Ed25519ModelCatalogTrustVerifier, type TrustedEd25519PublicKey } from '../modelCatalogTrustVerifier';
import { FileModelRegistryPersistence, ModelRegistryStore } from '../modelRegistryStore';
import type { CoreModelPurpose, ModelPackBaseBinding } from '../modelPackTypes';
import { ModelPackCatalogClient, StrictHttpsFetcher } from './catalogClient';
import { DurableModelPackCatalogCache } from './durableCatalogCache';
import { HashChainModelPackAuditSink } from './hashChainAuditSink';
import { ModelPackService } from './modelPackService';
import { ModelPackServiceError, type ModelPackCatalogSource } from './types';

export type ModelPackBackendFactoryOptions = {
  /** Electron app.getPath('userData'), injected by the composition root. */
  userDataPath: string;
  source: ModelPackCatalogSource;
  trustedOrigins: readonly string[];
  trustedKeys?: Readonly<Record<string, TrustedEd25519PublicKey>>;
  trustedPinnedDigests?: ReadonlySet<string>;
  expectedBases: Readonly<Partial<Record<CoreModelPurpose, ModelPackBaseBinding>>>;
  offlineMaxAgeMs?: number;
  fetcher?: typeof fetch;
  now?: () => Date;
  onAuditError?: (error: unknown) => void;
};

export type ModelPackBackend = {
  storageRoot: string;
  registry: ModelRegistryStore;
  network: StrictHttpsFetcher;
  cache: DurableModelPackCatalogCache;
  auditSink: HashChainModelPackAuditSink;
  catalogClient: ModelPackCatalogClient;
  service: ModelPackService;
};

const isInside = (parent: string, candidate: string): boolean => {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};

export const createModelPackBackend = (options: ModelPackBackendFactoryOptions): ModelPackBackend => {
  if (!path.isAbsolute(options.userDataPath)) {
    throw new ModelPackServiceError('configuration-invalid', 'Electron userData path must be absolute.');
  }
  const userDataPath = path.resolve(options.userDataPath);
  if (userDataPath === path.parse(userDataPath).root) {
    throw new ModelPackServiceError('configuration-invalid', 'Filesystem root cannot be used as Electron userData.');
  }
  const storageRoot = path.resolve(userDataPath, 'tomny-model-platform');
  if (!isInside(userDataPath, storageRoot)) {
    throw new ModelPackServiceError('configuration-invalid', 'Model Pack storage escaped Electron userData.');
  }
  const trustVerifier = new Ed25519ModelCatalogTrustVerifier({
    trustedKeys: options.trustedKeys,
    trustedPinnedDigests: options.trustedPinnedDigests,
  });
  const registry = new ModelRegistryStore(
    new FileModelRegistryPersistence(path.join(storageRoot, 'registry.json')),
    options.now,
    trustVerifier
  );
  const network = new StrictHttpsFetcher({
    allowedOrigins: options.trustedOrigins,
    fetcher: options.fetcher,
  });
  const cache = new DurableModelPackCatalogCache({
    directory: path.join(storageRoot, 'catalog-cache'),
    trustVerifier,
    offlineMaxAgeMs: options.offlineMaxAgeMs,
    now: options.now,
  });
  const auditSink = new HashChainModelPackAuditSink({
    auditPath: path.join(storageRoot, 'audit', 'model-pack-audit.jsonl'),
  });
  const catalogClient = new ModelPackCatalogClient({ source: options.source, registry, network, cache });
  const service = new ModelPackService({
    rootDir: storageRoot,
    registry,
    catalogClient,
    network,
    auditSink,
    expectedBases: options.expectedBases,
    now: options.now,
    onAuditError: options.onAuditError ? (error) => options.onAuditError?.(error) : undefined,
  });
  return { storageRoot, registry, network, cache, auditSink, catalogClient, service };
};
