import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  parseModelPackManifest,
  verifyModelPackArtifactContents,
} from '../../../packages/desktop/src/process/experimentalCore/catalog/modelPackManifest';
import type { ModelPackManifest } from '../../../packages/desktop/src/process/experimentalCore/catalog/modelPackTypes';

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const hash = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
const weight = bytes('safe weights');
const config = bytes('{r:8,lora_alpha:16}');
const sha = 'a'.repeat(64);

const manifest = (): ModelPackManifest => ({
  schemaVersion: 1,
  kind: 'model-adapter',
  id: 'com.tomny.core.assistant',
  version: '0.1.0-candidate.1',
  purpose: 'assistant',
  format: 'peft-lora-safetensors',
  baseModel: { id: 'Qwen/Qwen3.5-2B', revision: 'immutable-r1', sha256: sha },
  runtime: {
    engine: 'transformers-peft',
    peft: '>=0.18.1 <0.19.0',
    transformers: '>=5.5.0 <5.6.0',
    minTomnyVersion: '0.0.0',
  },
  contracts: {
    inputSchema: 'tomny.assistant.input.v1',
    outputSchema: 'tomny.assistant.output.v1',
    policyVersion: 'core-policy-v1',
  },
  files: [
    { path: 'adapter_model.safetensors', size: weight.byteLength, sha256: hash(weight) },
    { path: 'adapter_config.json', size: config.byteLength, sha256: hash(config) },
  ],
  training: {
    datasetManifestSha256: sha,
    recipeSha256: sha,
    seed: 20260725,
    provenanceSha256: sha,
  },
  evaluation: { reportSha256: sha, benchmarkVersion: 'tomny-core-v2', status: 'candidate' },
  license: 'Apache-2.0',
  createdAt: '2026-07-25T10:00:00Z',
});

describe('Model Pack manifest verification', () => {
  it('accepts a bound manifest and verifies every declared artifact byte', () => {
    const parsed = parseModelPackManifest(manifest(), { expectedBaseModel: manifest().baseModel });
    expect(() =>
      verifyModelPackArtifactContents(
        parsed,
        new Map([
          ['adapter_model.safetensors', weight],
          ['adapter_config.json', config],
        ])
      )
    ).not.toThrow();
  });

  it('rejects traversal before an artifact can leave staging', () => {
    const candidate = manifest();
    candidate.files[1].path = '../adapter_config.json';
    expect(() => parseModelPackManifest(candidate)).toThrowError(expect.objectContaining({ code: 'unsafe-path' }));
  });

  it('rejects executable content even when its hash and size are declared', () => {
    const candidate = manifest();
    candidate.files.push({ path: 'post-install.ps1', size: 1, sha256: sha });
    expect(() => parseModelPackManifest(candidate)).toThrowError(expect.objectContaining({ code: 'unsafe-file-type' }));
  });

  it('rejects an adapter bound to a different immutable base hash', () => {
    expect(() =>
      parseModelPackManifest(manifest(), {
        expectedBaseModel: { ...manifest().baseModel, sha256: 'b'.repeat(64) },
      })
    ).toThrowError(expect.objectContaining({ code: 'base-mismatch' }));
  });

  it('rejects tampered bytes even when size remains unchanged', () => {
    const parsed = parseModelPackManifest(manifest());
    const tampered = bytes('unsafe weigh');
    expect(() =>
      verifyModelPackArtifactContents(
        parsed,
        new Map([
          ['adapter_model.safetensors', tampered],
          ['adapter_config.json', config],
        ])
      )
    ).toThrowError(expect.objectContaining({ code: 'hash-mismatch' }));
  });

  it('rejects unknown manifest fields instead of silently trusting them', () => {
    expect(() => parseModelPackManifest({ ...manifest(), postInstall: 'run-me' })).toThrowError(
      expect.objectContaining({ code: 'invalid-schema' })
    );
  });
});
