import { generateKeyPairSync, sign as signBytes, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  Ed25519ModelCatalogTrustVerifier,
  ModelCatalogTrustConfigurationError,
  modelCatalogSignedPayload,
} from '../../../packages/desktop/src/process/experimentalCore/catalog/modelCatalogTrustVerifier';
import {
  InMemoryModelRegistryPersistence,
  ModelRegistryStore,
} from '../../../packages/desktop/src/process/experimentalCore/catalog/modelRegistryStore';
import type { ModelCatalogTrustMetadata } from '../../../packages/desktop/src/process/experimentalCore/catalog/modelPackTypes';

const sha = 'a'.repeat(64);
const oldKeys = generateKeyPairSync('ed25519');
const newKeys = generateKeyPairSync('ed25519');

const unsignedMetadata = (keyId = 'old-root'): ModelCatalogTrustMetadata => ({
  schemaVersion: 1,
  revision: 7,
  version: '7',
  expiresAt: '2026-08-01T00:00:00Z',
  sha256: sha,
  keyId,
});

const signMetadata = (metadata: ModelCatalogTrustMetadata, privateKey: KeyObject): ModelCatalogTrustMetadata => ({
  ...metadata,
  signature: signBytes(null, modelCatalogSignedPayload(metadata), privateKey).toString('base64'),
});

const verifier = (trustedKeys: Readonly<Record<string, KeyObject>>) =>
  new Ed25519ModelCatalogTrustVerifier({ trustedKeys });

describe('Ed25519 Model Catalog trust verifier', () => {
  it('verifies canonical catalog metadata with a configured Ed25519 root', async () => {
    const metadata = signMetadata(unsignedMetadata(), oldKeys.privateKey);
    await expect(verifier({ 'old-root': oldKeys.publicKey }).verify(metadata)).resolves.toEqual({
      trusted: true,
      method: 'signature',
      keyId: 'old-root',
    });
  });

  it('rejects forged signature bytes even when strict base64 remains valid', async () => {
    const metadata = signMetadata(unsignedMetadata(), oldKeys.privateKey);
    const forged = Buffer.from(metadata.signature!, 'base64');
    forged[0] ^= 1;
    metadata.signature = forged.toString('base64');
    await expect(verifier({ 'old-root': oldKeys.publicKey }).verify(metadata)).resolves.toMatchObject({
      trusted: false,
    });
  });

  it('rejects a signature produced by a different key selected by key ID', async () => {
    const metadata = signMetadata(unsignedMetadata('new-root'), oldKeys.privateKey);
    await expect(verifier({ 'new-root': newKeys.publicKey }).verify(metadata)).resolves.toMatchObject({
      trusted: false,
    });
  });

  it('rejects mutation of any canonical signed metadata field', async () => {
    const signed = signMetadata(unsignedMetadata(), oldKeys.privateKey);
    const mutated = { ...signed, revision: signed.revision + 1 };
    await expect(verifier({ 'old-root': oldKeys.publicKey }).verify(mutated)).resolves.toMatchObject({
      trusted: false,
    });
  });

  it('rejects non-canonical base64 before crypto verification', async () => {
    const metadata = { ...unsignedMetadata(), signature: 'not_base64url==' };
    await expect(verifier({ 'old-root': oldKeys.publicKey }).verify(metadata)).resolves.toMatchObject({
      trusted: false,
    });
  });

  it('supports explicit key rotation without trusting removed key IDs', async () => {
    const oldSigned = signMetadata(unsignedMetadata('old-root'), oldKeys.privateKey);
    const newSigned = signMetadata(unsignedMetadata('new-root'), newKeys.privateKey);
    const overlap = verifier({ 'old-root': oldKeys.publicKey, 'new-root': newKeys.publicKey });
    await expect(overlap.verify(oldSigned)).resolves.toMatchObject({ trusted: true });
    await expect(overlap.verify(newSigned)).resolves.toMatchObject({ trusted: true });
    await expect(verifier({ 'new-root': newKeys.publicKey }).verify(oldSigned)).resolves.toMatchObject({
      trusted: false,
    });
  });

  it('accepts only digests explicitly supplied by a pinned trust source', async () => {
    const pinned = new Ed25519ModelCatalogTrustVerifier({ trustedPinnedDigests: new Set([sha]) });
    const metadata = { ...unsignedMetadata(), keyId: undefined };
    await expect(pinned.verify(metadata)).resolves.toEqual({
      trusted: true,
      method: 'pinned-digest',
      sha256: sha,
    });
    await expect(pinned.verify({ ...metadata, sha256: 'b'.repeat(64) })).resolves.toMatchObject({ trusted: false });
  });

  it('rejects non-Ed25519 trust roots at configuration time', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() => verifier({ root: rsa.publicKey })).toThrow(ModelCatalogTrustConfigurationError);
  });

  it('lets the registry reject an expired catalog after a valid signature', async () => {
    const trustVerifier = verifier({ 'old-root': oldKeys.publicKey });
    const store = new ModelRegistryStore(
      new InMemoryModelRegistryPersistence(),
      () => new Date('2026-08-02T00:00:00Z'),
      trustVerifier
    );
    const metadata = signMetadata(unsignedMetadata(), oldKeys.privateKey);
    await expect(store.acceptCatalog(metadata, 0)).rejects.toMatchObject({ code: 'catalog-freeze' });
  });
});
