/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  MODEL_PACK_MANIFEST_SCHEMA_VERSION,
  ModelPackManifestError,
  type CoreModelPurpose,
  type ModelPackArtifactContents,
  type ModelPackBaseBinding,
  type ModelPackContracts,
  type ModelPackEvaluation,
  type ModelPackFile,
  type ModelPackManifest,
  type ModelPackManifestParseOptions,
  type ModelPackRuntime,
  type ModelPackTraining,
} from './modelPackTypes';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const PACKAGE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u;
const SEMVER_PATTERN =
  /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2}(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const CONTRACT_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u;
const VERSION_RANGE_PATTERN = /^(?:[<>=~^]+\d+(?:\.\d+){0,2})(?:\s+(?:[<>=~^]+\d+(?:\.\d+){0,2}))*$/u;
const PURPOSES = new Set<CoreModelPurpose>(['security', 'user-understanding', 'orchestrator', 'assistant']);
const ALLOWED_FILE_EXTENSIONS = new Set(['.json', '.jinja', '.txt', '.safetensors']);
const REQUIRED_FILES = ['adapter_model.safetensors', 'adapter_config.json'] as const;
const DEFAULT_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_SIZE_BYTES = 4 * 1024 * 1024 * 1024;

const assertRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ModelPackManifestError('invalid-schema', `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const assertExactKeys = (value: Record<string, unknown>, keys: readonly string[], label: string): void => {
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    throw new ModelPackManifestError('invalid-schema', `${label} contains missing or unknown fields.`);
  }
};

const requireString = (value: unknown, label: string, pattern?: RegExp): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || (pattern && !pattern.test(value))) {
    throw new ModelPackManifestError('invalid-schema', `${label} is invalid.`);
  }
  return value;
};

const requireSha256 = (value: unknown, label: string): string => requireString(value, label, SHA256_PATTERN);

const parseBaseModel = (value: unknown): ModelPackBaseBinding => {
  const record = assertRecord(value, 'baseModel');
  assertExactKeys(record, ['id', 'revision', 'sha256'], 'baseModel');
  return {
    id: requireString(record.id, 'baseModel.id'),
    revision: requireString(record.revision, 'baseModel.revision'),
    sha256: requireSha256(record.sha256, 'baseModel.sha256'),
  };
};

const parseRuntime = (value: unknown): ModelPackRuntime => {
  const record = assertRecord(value, 'runtime');
  assertExactKeys(record, ['engine', 'peft', 'transformers', 'minTomnyVersion'], 'runtime');
  if (record.engine !== 'transformers-peft') {
    throw new ModelPackManifestError('invalid-schema', 'runtime.engine is unsupported.');
  }
  return {
    engine: 'transformers-peft',
    peft: requireString(record.peft, 'runtime.peft', VERSION_RANGE_PATTERN),
    transformers: requireString(record.transformers, 'runtime.transformers', VERSION_RANGE_PATTERN),
    minTomnyVersion: requireString(record.minTomnyVersion, 'runtime.minTomnyVersion', SEMVER_PATTERN),
  };
};

const parseContracts = (value: unknown): ModelPackContracts => {
  const record = assertRecord(value, 'contracts');
  assertExactKeys(record, ['inputSchema', 'outputSchema', 'policyVersion'], 'contracts');
  return {
    inputSchema: requireString(record.inputSchema, 'contracts.inputSchema', CONTRACT_PATTERN),
    outputSchema: requireString(record.outputSchema, 'contracts.outputSchema', CONTRACT_PATTERN),
    policyVersion: requireString(record.policyVersion, 'contracts.policyVersion', CONTRACT_PATTERN),
  };
};

const parseSafeFilePath = (value: unknown): string => {
  const filePath = requireString(value, 'files[].path');
  const normalized = path.posix.normalize(filePath);
  const segments = filePath.split('/');
  if (
    path.posix.isAbsolute(filePath) ||
    normalized !== filePath ||
    filePath.includes('\\') ||
    filePath.includes('\0') ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..' || segment.includes(':'))
  ) {
    throw new ModelPackManifestError('unsafe-path', `Unsafe Model Pack path: ${filePath}`);
  }
  const extension = path.posix.extname(filePath).toLowerCase();
  if (!ALLOWED_FILE_EXTENSIONS.has(extension)) {
    throw new ModelPackManifestError('unsafe-file-type', `Model Pack file type is not allowed: ${filePath}`);
  }
  return filePath;
};

const parseFiles = (value: unknown, options: ModelPackManifestParseOptions): ModelPackFile[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new ModelPackManifestError('invalid-schema', 'files must contain between 1 and 64 entries.');
  }
  const maxFileSize = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  const maxTotalSize = options.maxTotalSizeBytes ?? DEFAULT_MAX_TOTAL_SIZE_BYTES;
  const seen = new Set<string>();
  let totalSize = 0;
  const files = value.map((item): ModelPackFile => {
    const record = assertRecord(item, 'files[]');
    assertExactKeys(record, ['path', 'size', 'sha256'], 'files[]');
    const filePath = parseSafeFilePath(record.path);
    if (seen.has(filePath)) throw new ModelPackManifestError('duplicate-file', `Duplicate file: ${filePath}`);
    seen.add(filePath);
    if (!Number.isSafeInteger(record.size) || (record.size as number) <= 0) {
      throw new ModelPackManifestError('invalid-schema', `Invalid size for ${filePath}.`);
    }
    const size = record.size as number;
    if (size > maxFileSize) {
      throw new ModelPackManifestError('file-too-large', `Model Pack file exceeds its size limit: ${filePath}`);
    }
    totalSize += size;
    if (!Number.isSafeInteger(totalSize) || totalSize > maxTotalSize) {
      throw new ModelPackManifestError('pack-too-large', 'Model Pack exceeds its total extracted size limit.');
    }
    return { path: filePath, size, sha256: requireSha256(record.sha256, `files[${filePath}].sha256`) };
  });
  for (const required of REQUIRED_FILES) {
    if (!seen.has(required)) {
      throw new ModelPackManifestError('missing-required-file', `Model Pack is missing ${required}.`);
    }
  }
  return files;
};

const parseTraining = (value: unknown): ModelPackTraining => {
  const record = assertRecord(value, 'training');
  assertExactKeys(record, ['datasetManifestSha256', 'recipeSha256', 'seed', 'provenanceSha256'], 'training');
  if (!Number.isSafeInteger(record.seed) || (record.seed as number) < 0) {
    throw new ModelPackManifestError('invalid-schema', 'training.seed is invalid.');
  }
  return {
    datasetManifestSha256: requireSha256(record.datasetManifestSha256, 'training.datasetManifestSha256'),
    recipeSha256: requireSha256(record.recipeSha256, 'training.recipeSha256'),
    seed: record.seed as number,
    provenanceSha256: requireSha256(record.provenanceSha256, 'training.provenanceSha256'),
  };
};

const parseEvaluation = (value: unknown): ModelPackEvaluation => {
  const record = assertRecord(value, 'evaluation');
  assertExactKeys(record, ['reportSha256', 'benchmarkVersion', 'status'], 'evaluation');
  if (record.status !== 'candidate') {
    throw new ModelPackManifestError('invalid-schema', 'Publisher evaluation status must be candidate.');
  }
  return {
    reportSha256: requireSha256(record.reportSha256, 'evaluation.reportSha256'),
    benchmarkVersion: requireString(record.benchmarkVersion, 'evaluation.benchmarkVersion'),
    status: 'candidate',
  };
};

const assertExpectedBase = (actual: ModelPackBaseBinding, expected?: ModelPackBaseBinding): void => {
  if (
    expected &&
    (actual.id !== expected.id ||
      actual.revision !== expected.revision ||
      actual.sha256 !== expected.sha256.toLowerCase())
  ) {
    throw new ModelPackManifestError('base-mismatch', 'Model Pack is bound to a different base model.');
  }
};

export const parseModelPackManifest = (
  input: string | unknown,
  options: ModelPackManifestParseOptions = {}
): ModelPackManifest => {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      throw new ModelPackManifestError('invalid-json', 'Model Pack manifest is not valid JSON.');
    }
  }
  const record = assertRecord(value, 'manifest');
  assertExactKeys(
    record,
    [
      'schemaVersion',
      'kind',
      'id',
      'version',
      'purpose',
      'format',
      'baseModel',
      'runtime',
      'contracts',
      'files',
      'training',
      'evaluation',
      'license',
      'createdAt',
    ],
    'manifest'
  );
  if (record.schemaVersion !== MODEL_PACK_MANIFEST_SCHEMA_VERSION) {
    throw new ModelPackManifestError('unsupported-schema', 'Unsupported Model Pack manifest schema version.');
  }
  if (record.kind !== 'model-adapter' || record.format !== 'peft-lora-safetensors') {
    throw new ModelPackManifestError('invalid-schema', 'Model Pack kind or format is invalid.');
  }
  if (typeof record.purpose !== 'string' || !PURPOSES.has(record.purpose as CoreModelPurpose)) {
    throw new ModelPackManifestError('invalid-schema', 'Model Pack purpose is invalid.');
  }
  const baseModel = parseBaseModel(record.baseModel);
  assertExpectedBase(baseModel, options.expectedBaseModel);
  const createdAt = requireString(record.createdAt, 'createdAt');
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(createdAt) || !Number.isFinite(Date.parse(createdAt))) {
    throw new ModelPackManifestError('invalid-schema', 'createdAt must be an RFC-3339 timestamp.');
  }
  return {
    schemaVersion: MODEL_PACK_MANIFEST_SCHEMA_VERSION,
    kind: 'model-adapter',
    id: requireString(record.id, 'id', PACKAGE_ID_PATTERN),
    version: requireString(record.version, 'version', SEMVER_PATTERN),
    purpose: record.purpose as CoreModelPurpose,
    format: 'peft-lora-safetensors',
    baseModel,
    runtime: parseRuntime(record.runtime),
    contracts: parseContracts(record.contracts),
    files: parseFiles(record.files, options),
    training: parseTraining(record.training),
    evaluation: parseEvaluation(record.evaluation),
    license: requireString(record.license, 'license'),
    createdAt,
  };
};

/**
 * Stable identity for the complete reviewed manifest. Promotion evidence must bind to
 * this value so a receipt cannot be reused after a base, runtime, contract, or file
 * declaration changes while the adapter's own weight hash happens to stay the same.
 */
export const modelPackManifestSha256 = (manifest: ModelPackManifest): string =>
  createHash('sha256').update(JSON.stringify(parseModelPackManifest(manifest))).digest('hex');

export const verifyModelPackArtifactContents = (
  manifest: ModelPackManifest,
  contents: ModelPackArtifactContents
): void => {
  const declaredPaths = new Set(manifest.files.map((file) => file.path));
  for (const artifactPath of contents.keys()) {
    if (!declaredPaths.has(artifactPath)) {
      throw new ModelPackManifestError('unexpected-artifact', `Artifact was not declared: ${artifactPath}`);
    }
  }
  for (const file of manifest.files) {
    const content = contents.get(file.path);
    if (!content) throw new ModelPackManifestError('missing-artifact', `Artifact is missing: ${file.path}`);
    if (content.byteLength !== file.size) {
      throw new ModelPackManifestError('size-mismatch', `Artifact size does not match manifest: ${file.path}`);
    }
    const actualHash = createHash('sha256').update(content).digest('hex');
    if (actualHash !== file.sha256) {
      throw new ModelPackManifestError('hash-mismatch', `Artifact hash does not match manifest: ${file.path}`);
    }
  }
};
