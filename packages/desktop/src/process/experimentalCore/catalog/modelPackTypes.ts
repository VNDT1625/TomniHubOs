/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export const MODEL_PACK_MANIFEST_SCHEMA_VERSION = 1;
export const MODEL_REGISTRY_SCHEMA_VERSION = 1;

export type CoreModelPurpose = 'security' | 'user-understanding' | 'semantic-analysis';

export type ModelPackBaseBinding = {
  id: string;
  revision: string;
  sha256: string;
};

export type ModelPackRuntime = {
  engine: 'transformers-peft';
  peft: string;
  transformers: string;
  minTomnyVersion: string;
};

export type ModelPackContracts = {
  inputSchema: string;
  outputSchema: string;
  policyVersion: string;
};

export type ModelPackFile = {
  path: string;
  size: number;
  sha256: string;
};

export type ModelPackTraining = {
  datasetManifestSha256: string;
  recipeSha256: string;
  seed: number;
  provenanceSha256: string;
};

export type ModelPackEvaluation = {
  reportSha256: string;
  benchmarkVersion: string;
  status: 'candidate';
};

export type ModelPackManifest = {
  schemaVersion: typeof MODEL_PACK_MANIFEST_SCHEMA_VERSION;
  kind: 'model-adapter';
  id: string;
  version: string;
  purpose: CoreModelPurpose;
  format: 'peft-lora-safetensors';
  baseModel: ModelPackBaseBinding;
  runtime: ModelPackRuntime;
  contracts: ModelPackContracts;
  files: ModelPackFile[];
  training: ModelPackTraining;
  evaluation: ModelPackEvaluation;
  license: string;
  createdAt: string;
};

export type ModelPackManifestLimits = {
  maxFileSizeBytes?: number;
  maxTotalSizeBytes?: number;
};

export type ModelPackManifestParseOptions = ModelPackManifestLimits & {
  expectedBaseModel?: ModelPackBaseBinding;
};

export type ModelPackArtifactContents = ReadonlyMap<string, Uint8Array>;

export type ModelPackManifestErrorCode =
  | 'invalid-json'
  | 'invalid-schema'
  | 'unsupported-schema'
  | 'unsafe-path'
  | 'unsafe-file-type'
  | 'duplicate-file'
  | 'file-too-large'
  | 'pack-too-large'
  | 'missing-required-file'
  | 'missing-artifact'
  | 'unexpected-artifact'
  | 'size-mismatch'
  | 'hash-mismatch'
  | 'base-mismatch';

export class ModelPackManifestError extends Error {
  public constructor(
    public readonly code: ModelPackManifestErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ModelPackManifestError';
  }
}

export type ModelPackLifecycleStatus =
  | 'discovered'
  | 'downloading'
  | 'staged'
  | 'verified'
  | 'candidate'
  | 'shadow'
  | 'pilot'
  | 'active'
  | 'superseded'
  | 'quarantined';

/** A lifecycle destination that may receive an independently approved promotion receipt. */
export type ModelPromotionTarget = 'shadow' | 'pilot' | 'active';

/**
 * Immutable evidence required at each lifecycle promotion boundary. A candidate-only
 * benchmark never promotes automatically: a separately trusted human approval is mandatory.
 */
export type ModelPromotionGateReceipt = {
  schemaVersion: 1;
  target: ModelPromotionTarget;
  candidate: Pick<ModelPackManifest, 'id' | 'version' | 'purpose'> & {
    /** SHA-256 of the canonical, fully parsed Model Pack manifest reviewed for this gate. */
    manifestSha256: string;
  };
  verification: {
    verified: true;
    reportSha256: string;
    provenanceSha256: string;
  };
  benchmark: {
    postTrainingReportSha256: string;
    reportSha256: string;
    confidenceGatePassed: true;
    candidateOnly: true;
    promotionAllowed: false;
  };
  humanApproval: {
    approvalId: string;
    approvalSha256: string;
    approvedAt: string;
    approvedFor: ModelPromotionTarget;
  };
};

export type ModelPackRegistryRecord = {
  key: string;
  manifest: ModelPackManifest;
  status: ModelPackLifecycleStatus;
  installedPath?: string;
  quarantineReason?: string;
  promotionReceipts?: Partial<Record<ModelPromotionTarget, ModelPromotionGateReceipt>>;
  createdAt: string;
  updatedAt: string;
};

export type ModelCatalogTrustMetadata = {
  schemaVersion: 1;
  revision: number;
  version: string;
  expiresAt: string;
  sha256: string;
  signature?: string;
  keyId?: string;
};

export type ModelRegistrySnapshot = {
  schemaVersion: typeof MODEL_REGISTRY_SCHEMA_VERSION;
  revision: number;
  records: Record<string, ModelPackRegistryRecord>;
  activeByPurpose: Partial<Record<CoreModelPurpose, string>>;
  previousActiveByPurpose: Partial<Record<CoreModelPurpose, string>>;
  highestSeenCatalogRevision: number;
  trustedCatalogSha256?: string;
};

export const modelPackKey = (manifest: Pick<ModelPackManifest, 'id' | 'version' | 'files'>): string => {
  const weight = manifest.files.find((file) => file.path === 'adapter_model.safetensors');
  return `${manifest.id}@${manifest.version}#${weight?.sha256 ?? 'missing'}`;
};
