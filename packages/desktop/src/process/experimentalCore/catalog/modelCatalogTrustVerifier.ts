/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';
import type { ModelCatalogTrustVerifier, VerifiedModelCatalogTrust } from './modelRegistryStore';
import type { ModelCatalogTrustMetadata } from './modelPackTypes';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const STRICT_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const ED25519_SIGNATURE_BYTES = 64;

export type TrustedEd25519PublicKey = KeyObject | string;

export type Ed25519ModelCatalogTrustVerifierOptions = {
  /** Pre-provisioned keys only. Adding/removing IDs is the explicit key-rotation mechanism. */
  trustedKeys?: Readonly<Record<string, TrustedEd25519PublicKey>>;
  /** Digests received through an independently authenticated/pinned channel. */
  trustedPinnedDigests?: ReadonlySet<string>;
};

export class ModelCatalogTrustConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ModelCatalogTrustConfigurationError';
  }
}

const parseEd25519PublicKey = (keyId: string, source: TrustedEd25519PublicKey): KeyObject => {
  let key: KeyObject;
  try {
    key = typeof source === 'string' ? createPublicKey(source) : source;
  } catch {
    throw new ModelCatalogTrustConfigurationError(`Trusted catalog key cannot be parsed: ${keyId}`);
  }
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
    throw new ModelCatalogTrustConfigurationError(`Trusted catalog key must be an Ed25519 public key: ${keyId}`);
  }
  return key;
};

const decodeStrictBase64Signature = (value: string): Buffer | undefined => {
  if (value.length === 0 || value.length % 4 !== 0 || !STRICT_BASE64_PATTERN.test(value)) return undefined;
  const decoded = Buffer.from(value, 'base64');
  if (decoded.byteLength !== ED25519_SIGNATURE_BYTES || decoded.toString('base64') !== value) return undefined;
  return decoded;
};

/** Canonical UTF-8 bytes signed by catalog publishers. Field order and JSON whitespace are fixed. */
export const modelCatalogSignedPayload = (
  metadata: Pick<ModelCatalogTrustMetadata, 'schemaVersion' | 'revision' | 'version' | 'expiresAt' | 'sha256' | 'keyId'>
): Buffer =>
  Buffer.from(
    JSON.stringify({
      schemaVersion: metadata.schemaVersion,
      revision: metadata.revision,
      version: metadata.version,
      expiresAt: metadata.expiresAt,
      sha256: metadata.sha256,
      keyId: metadata.keyId,
    }),
    'utf8'
  );

/** Ed25519 verifier with configured trust roots; it never learns keys or pins from catalog metadata. */
export class Ed25519ModelCatalogTrustVerifier implements ModelCatalogTrustVerifier {
  private readonly trustedKeys = new Map<string, KeyObject>();
  private readonly trustedPinnedDigests: ReadonlySet<string>;

  public constructor(options: Ed25519ModelCatalogTrustVerifierOptions) {
    for (const [keyId, source] of Object.entries(options.trustedKeys ?? {})) {
      if (!KEY_ID_PATTERN.test(keyId)) {
        throw new ModelCatalogTrustConfigurationError(`Trusted catalog key ID is invalid: ${keyId}`);
      }
      this.trustedKeys.set(keyId, parseEd25519PublicKey(keyId, source));
    }
    const pins = new Set<string>();
    for (const digest of options.trustedPinnedDigests ?? []) {
      if (!SHA256_PATTERN.test(digest)) {
        throw new ModelCatalogTrustConfigurationError('Pinned catalog digest must be lowercase SHA-256.');
      }
      pins.add(digest);
    }
    this.trustedPinnedDigests = pins;
    if (this.trustedKeys.size === 0 && this.trustedPinnedDigests.size === 0) {
      throw new ModelCatalogTrustConfigurationError('At least one trusted Ed25519 key or pinned digest is required.');
    }
  }

  public async verify(metadata: Readonly<ModelCatalogTrustMetadata>): Promise<VerifiedModelCatalogTrust> {
    if (
      metadata.schemaVersion !== 1 ||
      !Number.isSafeInteger(metadata.revision) ||
      metadata.revision <= 0 ||
      typeof metadata.version !== 'string' ||
      metadata.version.length === 0 ||
      typeof metadata.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(metadata.expiresAt)) ||
      !SHA256_PATTERN.test(metadata.sha256)
    ) {
      return { trusted: false, reason: 'Catalog metadata is malformed.' };
    }

    if (metadata.signature === undefined && metadata.keyId === undefined) {
      return this.trustedPinnedDigests.has(metadata.sha256)
        ? { trusted: true, method: 'pinned-digest', sha256: metadata.sha256 }
        : { trusted: false, reason: 'Catalog digest is not pinned.' };
    }
    if (
      typeof metadata.signature !== 'string' ||
      typeof metadata.keyId !== 'string' ||
      !KEY_ID_PATTERN.test(metadata.keyId)
    ) {
      return { trusted: false, reason: 'Catalog signature metadata is malformed.' };
    }
    const key = this.trustedKeys.get(metadata.keyId);
    if (!key) return { trusted: false, reason: 'Catalog key ID is not trusted.' };
    const signature = decodeStrictBase64Signature(metadata.signature);
    if (!signature) return { trusted: false, reason: 'Catalog signature is not strict base64 Ed25519.' };
    const verified = verifySignature(null, modelCatalogSignedPayload(metadata), key, signature);
    return verified
      ? { trusted: true, method: 'signature', keyId: metadata.keyId }
      : { trusted: false, reason: 'Catalog signature verification failed.' };
  }
}
