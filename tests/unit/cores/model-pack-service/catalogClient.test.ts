import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  ModelPackCatalogClient,
  StrictHttpsFetcher,
} from '../../../../packages/desktop/src/process/experimentalCore/catalog/model-pack-service/catalogClient';
import {
  Ed25519ModelCatalogTrustVerifier,
  modelCatalogSignedPayload,
} from '../../../../packages/desktop/src/process/experimentalCore/catalog/modelCatalogTrustVerifier';
import {
  InMemoryModelRegistryPersistence,
  ModelRegistryStore,
} from '../../../../packages/desktop/src/process/experimentalCore/catalog/modelRegistryStore';
import type {
  ModelCatalogTrustMetadata,
  ModelPackManifest,
} from '../../../../packages/desktop/src/process/experimentalCore/catalog/modelPackTypes';

const keys = generateKeyPairSync('ed25519');
const sha = 'a'.repeat(64);
const urls = {
  metadata: 'https://catalog.example.com/model-metadata.json',
  catalog: 'https://catalog.example.com/model-catalog.json',
  artifact: 'https://cdn.example.com/security.zip',
};

const manifest = (): ModelPackManifest => ({
  schemaVersion: 1,
  kind: 'model-adapter',
  id: 'com.tomny.core.security',
  version: '0.1.0',
  purpose: 'security',
  format: 'peft-lora-safetensors',
  baseModel: { id: 'Qwen/Qwen3.5-0.8B', revision: 'immutable-r1', sha256: sha },
  runtime: {
    engine: 'transformers-peft',
    peft: '>=0.18.1 <0.19.0',
    transformers: '>=5.5.0 <5.6.0',
    minTomnyVersion: '0.0.0',
  },
  contracts: {
    inputSchema: 'tomny.security.input.v1',
    outputSchema: 'tomny.security.output.v1',
    policyVersion: 'core-policy-v1',
  },
  files: [
    { path: 'adapter_model.safetensors', size: 1, sha256: sha },
    { path: 'adapter_config.json', size: 1, sha256: sha },
  ],
  training: {
    datasetManifestSha256: sha,
    recipeSha256: sha,
    seed: 1,
    provenanceSha256: sha,
  },
  evaluation: { reportSha256: sha, benchmarkVersion: 'tomny-core-v2', status: 'candidate' },
  license: 'Apache-2.0',
  createdAt: '2026-07-25T10:00:00Z',
});

const catalogBytes = (revision: number): Buffer =>
  Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      revision,
      entries: [
        {
          manifest: manifest(),
          artifact: { url: urls.artifact, size: 10, sha256: sha },
        },
      ],
    })
  );

const signedMetadata = (revision: number, bytes: Buffer, keyId = 'root'): ModelCatalogTrustMetadata => {
  const metadata: ModelCatalogTrustMetadata = {
    schemaVersion: 1,
    revision,
    version: String(revision),
    expiresAt: '2099-01-01T00:00:00Z',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    keyId,
  };
  return {
    ...metadata,
    signature: sign(null, modelCatalogSignedPayload(metadata), keys.privateKey).toString('base64'),
  };
};

const response = (bytes: Buffer, init: ResponseInit = {}): Response =>
  new Response(bytes, {
    status: 200,
    headers: { 'content-length': String(bytes.byteLength), ...init.headers },
    ...init,
  });

const clientFor = (fetcher: typeof fetch, registry: ModelRegistryStore): ModelPackCatalogClient =>
  new ModelPackCatalogClient({
    source: { metadataUrl: urls.metadata, catalogUrl: urls.catalog },
    registry,
    network: new StrictHttpsFetcher({ fetcher, allowedOrigins: ['https://catalog.example.com'] }),
  });

const registryWithRoot = (): ModelRegistryStore =>
  new ModelRegistryStore(
    new InMemoryModelRegistryPersistence(),
    () => new Date('2026-07-25T12:00:00Z'),
    new Ed25519ModelCatalogTrustVerifier({ trustedKeys: { root: keys.publicKey } })
  );

describe('Model Pack catalog client', () => {
  it('hashes exact catalog bytes before accepting signed trust metadata', async () => {
    const bytes = catalogBytes(1);
    const metadata = Buffer.from(JSON.stringify(signedMetadata(1, bytes)));
    const fetcher = vi.fn(async (input: URL | RequestInfo) =>
      response(String(input) === urls.metadata ? metadata : bytes)
    ) as unknown as typeof fetch;
    const refreshed = await clientFor(fetcher, registryWithRoot()).refresh(0);
    expect(refreshed.document.revision).toBe(1);
    expect(refreshed.registryRevision).toBe(1);
  });

  it('rejects catalog bytes changed after metadata was signed', async () => {
    const trustedBytes = catalogBytes(1);
    const tamperedBytes = Buffer.from(trustedBytes.toString().replace('security', 'assistanz'));
    const metadata = Buffer.from(JSON.stringify(signedMetadata(1, trustedBytes)));
    const fetcher = vi.fn(async (input: URL | RequestInfo) =>
      response(String(input) === urls.metadata ? metadata : tamperedBytes)
    ) as unknown as typeof fetch;
    await expect(clientFor(fetcher, registryWithRoot()).refresh(0)).rejects.toMatchObject({
      code: 'catalog-tampered',
    });
  });

  it('rejects a stale catalog revision after a newer revision was trusted', async () => {
    let revision = 2;
    const registry = registryWithRoot();
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const bytes = catalogBytes(revision);
      return response(
        String(input) === urls.metadata ? Buffer.from(JSON.stringify(signedMetadata(revision, bytes))) : bytes
      );
    }) as unknown as typeof fetch;
    const client = clientFor(fetcher, registry);
    const newer = await client.refresh(0);
    revision = 1;
    await expect(client.refresh(newer.registryRevision)).rejects.toMatchObject({ code: 'catalog-rollback' });
  });

  it('rejects metadata signed by a revoked or unknown key id', async () => {
    const bytes = catalogBytes(1);
    const metadata = Buffer.from(JSON.stringify(signedMetadata(1, bytes, 'revoked-root')));
    const fetcher = vi.fn(async (input: URL | RequestInfo) =>
      response(String(input) === urls.metadata ? metadata : bytes)
    ) as unknown as typeof fetch;
    await expect(clientFor(fetcher, registryWithRoot()).refresh(0)).rejects.toMatchObject({
      code: 'catalog-trust-invalid',
    });
  });

  it('rejects an HTTPS redirect that downgrades to HTTP', async () => {
    const fetcher = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: 'http://cdn.example.com/catalog.json' } })
    ) as unknown as typeof fetch;
    await expect(
      new StrictHttpsFetcher({ fetcher, allowedOrigins: ['https://catalog.example.com'] }).fetchBytes(
        urls.catalog,
        1024
      )
    ).rejects.toMatchObject({
      code: 'redirect-downgrade',
    });
  });

  it('rejects an HTTPS redirect to an origin outside the trusted allowlist', async () => {
    const fetcher = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/catalog.json' } })
    ) as unknown as typeof fetch;
    const network = new StrictHttpsFetcher({
      fetcher,
      allowedOrigins: ['https://catalog.example.com'],
    });
    await expect(network.fetchBytes(urls.catalog, 1024)).rejects.toMatchObject({ code: 'invalid-url' });
  });

  it('rejects a response that ends before Content-Length', async () => {
    const fetcher = vi.fn(
      async () => new Response(Buffer.from('abc'), { status: 200, headers: { 'content-length': '4' } })
    ) as unknown as typeof fetch;
    await expect(
      new StrictHttpsFetcher({ fetcher, allowedOrigins: ['https://catalog.example.com'] }).fetchBytes(
        urls.catalog,
        1024
      )
    ).rejects.toMatchObject({
      code: 'partial-download',
    });
  });
});
