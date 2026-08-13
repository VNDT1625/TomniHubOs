/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelCatalogTrustMetadata, ModelPackManifest } from '../modelPackTypes';

export type ModelPackCatalogArtifact = {
  url: string;
  size: number;
  sha256: string;
};

export type ModelPackCatalogEntry = {
  manifest: ModelPackManifest;
  artifact: ModelPackCatalogArtifact;
};

export type ModelPackCatalogDocument = {
  schemaVersion: 1;
  revision: number;
  entries: ModelPackCatalogEntry[];
};

export type ModelPackCatalogSource = {
  metadataUrl: string;
  catalogUrl: string;
};

export type ModelPackCatalogRefresh = {
  metadata: ModelCatalogTrustMetadata;
  document: ModelPackCatalogDocument;
  registryRevision: number;
};

export type ModelPackCachedCatalog = {
  metadataBytes: Buffer;
  catalogBytes: Buffer;
  cachedAt: string;
};

export type ModelPackCatalogCache = {
  store(metadataBytes: Buffer, catalogBytes: Buffer): Promise<void>;
  load(): Promise<ModelPackCachedCatalog>;
};

export type ModelPackAuditOperation = 'catalog-refresh' | 'install' | 'uninstall' | 'recovery';

export type ModelPackAuditReceipt = {
  receiptId: string;
  operation: ModelPackAuditOperation;
  subject: string;
  status: 'succeeded' | 'failed';
  startedAt: string;
  finishedAt: string;
  registryRevision?: number;
  bytes?: number;
  errorCode?: ModelPackServiceErrorCode;
};

export type ModelPackAuditSink = {
  append(receipt: Readonly<ModelPackAuditReceipt>): Promise<void>;
};

export type ModelPackServiceErrorCode =
  | 'invalid-url'
  | 'private-network-url'
  | 'redirect-limit'
  | 'redirect-downgrade'
  | 'timeout'
  | 'http-error'
  | 'invalid-content-length'
  | 'download-too-large'
  | 'payload-too-large'
  | 'partial-download'
  | 'catalog-tampered'
  | 'catalog-invalid'
  | 'cache-unavailable'
  | 'cache-stale'
  | 'audit-tampered'
  | 'configuration-invalid'
  | 'artifact-tampered'
  | 'archive-invalid'
  | 'unsafe-entry'
  | 'disk-full'
  | 'already-installed'
  | 'install-conflict'
  | 'pack-not-found'
  | 'pack-active'
  | 'pack-rollback-retained'
  | 'filesystem-error';

export class ModelPackServiceError extends Error {
  public constructor(
    public readonly code: ModelPackServiceErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ModelPackServiceError';
  }
}
