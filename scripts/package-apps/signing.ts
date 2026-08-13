/** Signing policy for first-party Store package builds. */

import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { FIRST_PARTY_PACKAGE_TRUSTED_KEYS } from '../../packages/desktop/src/common/packages/catalog';

export const PRODUCTION_SIGNING_KEY_ID = 'tomni-store-2026-02';
export const DEVELOPMENT_SIGNING_KEY_ID = 'tomni-store-dev-local';

export type PackageSigningKey = {
  keyId: string;
  privateKey: string;
  publicKey: string;
  production: boolean;
};

type LoadSigningKeyOptions = {
  env?: NodeJS.ProcessEnv;
  signingRoot?: string;
};

const publicKeyFor = (privateKey: string): string => {
  const parsed = createPrivateKey(privateKey);
  if (parsed.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('Tomni package signing requires an Ed25519 private key.');
  }
  return createPublicKey(parsed).export({ format: 'pem', type: 'spki' }).toString();
};

const loadDevelopmentKey = async (signingRoot: string): Promise<PackageSigningKey> => {
  await mkdir(signingRoot, { recursive: true });
  const privateKeyPath = path.join(signingRoot, `${DEVELOPMENT_SIGNING_KEY_ID}.private.pem`);
  const publicKeyPath = path.join(signingRoot, `${DEVELOPMENT_SIGNING_KEY_ID}.public.pem`);
  try {
    const privateKey = await readFile(privateKeyPath, 'utf8');
    return {
      keyId: DEVELOPMENT_SIGNING_KEY_ID,
      privateKey,
      publicKey: publicKeyFor(privateKey),
      production: false,
    };
  } catch {
    const pair = generateKeyPairSync('ed25519');
    const privateKey = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const publicKey = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    await writeFile(privateKeyPath, privateKey, { mode: 0o600 });
    await writeFile(publicKeyPath, publicKey, { mode: 0o644 });
    return { keyId: DEVELOPMENT_SIGNING_KEY_ID, privateKey, publicKey, production: false };
  }
};

/** Load an explicit key and bind trusted key IDs to their committed public-key anchor. */
export const loadExplicitPackageSigningKey = async (
  privateKeyPath: string,
  keyId: string
): Promise<PackageSigningKey> => {
  const privateKey = await readFile(path.resolve(privateKeyPath), 'utf8');
  const publicKey = publicKeyFor(privateKey);
  const trustedAnchor = FIRST_PARTY_PACKAGE_TRUSTED_KEYS[keyId];
  if (keyId === PRODUCTION_SIGNING_KEY_ID && !trustedAnchor) {
    throw new Error(`Missing committed trust anchor for production key ${PRODUCTION_SIGNING_KEY_ID}.`);
  }
  if (trustedAnchor && publicKey !== trustedAnchor) {
    throw new Error(`Signing key does not match the committed trust anchor for ${keyId}.`);
  }
  return { keyId, privateKey, publicKey, production: keyId === PRODUCTION_SIGNING_KEY_ID };
};

/**
 * Load package signing material. Production is fail-closed and never generates
 * a key. Local development generation is opt-in and uses a non-production ID.
 */
export const loadPackageSigningKey = async (options: LoadSigningKeyOptions = {}): Promise<PackageSigningKey> => {
  const env = options.env ?? process.env;
  const signingRoot =
    options.signingRoot ?? path.join(env.LOCALAPPDATA || homedir(), 'Tomni', 'StoreSigning', 'development');
  if (env.TOMNI_PACKAGE_DEV_SIGNING === '1') return loadDevelopmentKey(signingRoot);

  const privateKeyPath = env.TOMNI_PACKAGE_SIGNING_PRIVATE_KEY_PATH?.trim();
  if (!privateKeyPath) {
    throw new Error(
      'Production package signing requires TOMNI_PACKAGE_SIGNING_PRIVATE_KEY_PATH. ' +
        'Use TOMNI_PACKAGE_DEV_SIGNING=1 only for non-production local artifacts.'
    );
  }
  return loadExplicitPackageSigningKey(privateKeyPath, PRODUCTION_SIGNING_KEY_ID);
};
