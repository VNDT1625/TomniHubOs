import { generateKeyPairSync, sign } from 'node:crypto';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  WINDOWS_CREATOR_SANDBOX_PACKAGE_ID,
  WINDOWS_CREATOR_SANDBOX_TRUST_MANIFEST_FILE_NAME,
  WINDOWS_CREATOR_SANDBOX_TRUST_MANIFEST_SCHEMA,
  canonicalizeWindowsCreatorSandboxTrustManifest,
  canonicalizeWindowsCreatorSandboxTrustManifestPayload,
  getWindowsCreatorSandboxPublicKeyPin,
  verifyWindowsCreatorSandboxTrustAdmission,
  type WindowsCreatorSandboxTrustAdmissionFileSystem,
  type WindowsCreatorSandboxTrustAdmissionInput,
  type WindowsCreatorSandboxTrustManifest,
  type WindowsCreatorSandboxTrustManifestPayload,
  type WindowsCreatorSandboxTrustPolicy,
} from '@/process/extensions/windowsSandboxTrustAdmission';

const HASH = 'a'.repeat(64);
const PACKAGE_ROOT = path.resolve('C:\\Tomni\\resources\\bundled-tomny-runtime\\win32-x64');
const BINARY_PATH = path.resolve(PACKAGE_ROOT, 'tomny-runtime.exe');
const MANIFEST_PATH = path.resolve(PACKAGE_ROOT, WINDOWS_CREATOR_SANDBOX_TRUST_MANIFEST_FILE_NAME);
const BINARY_SIZE = 1_024;
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PUBLIC_KEY = publicKey.export({ format: 'pem', type: 'spki' }).toString();
const KEY_PIN = getWindowsCreatorSandboxPublicKeyPin(PUBLIC_KEY);

const directoryStat = {
  isDirectory: () => true,
  isFile: () => false,
  isSymbolicLink: () => false,
  size: 0,
};

const fileStat = (size: number) => ({
  isDirectory: () => false,
  isFile: () => true,
  isSymbolicLink: () => false,
  size,
});

const policy = (overrides: Partial<WindowsCreatorSandboxTrustPolicy> = {}): WindowsCreatorSandboxTrustPolicy => ({
  packageId: WINDOWS_CREATOR_SANDBOX_PACKAGE_ID,
  minimumPackageVersion: '1.2.3',
  trustedSigners: [{ id: 'tomni-release', publicKey: PUBLIC_KEY, keyPinSha256: KEY_PIN }],
  revokedManifestIds: [],
  revokedSignerIds: [],
  revokedKeyPins: [],
  revokedPackageVersions: [],
  ...overrides,
});

const payload = (
  overrides: Partial<WindowsCreatorSandboxTrustManifestPayload> = {}
): WindowsCreatorSandboxTrustManifestPayload => ({
  schema: WINDOWS_CREATOR_SANDBOX_TRUST_MANIFEST_SCHEMA,
  manifestId: 'release-20260727',
  issuedAt: 1_000,
  expiresAt: 2_000,
  package: { id: WINDOWS_CREATOR_SANDBOX_PACKAGE_ID, version: '1.2.3' },
  binary: { path: 'tomny-runtime.exe', sha256: HASH, sizeBytes: BINARY_SIZE },
  signer: { id: 'tomni-release', keyPinSha256: KEY_PIN },
  ...overrides,
});

const signedManifest = (
  manifestPayload: WindowsCreatorSandboxTrustManifestPayload,
  signingKey: typeof privateKey = privateKey
): WindowsCreatorSandboxTrustManifest => ({
  ...manifestPayload,
  signature: {
    algorithm: 'ed25519',
    value: sign(
      null,
      Buffer.from(canonicalizeWindowsCreatorSandboxTrustManifestPayload(manifestPayload)),
      signingKey
    ).toString('base64url'),
  },
});

type AdmissionFixture = {
  input: WindowsCreatorSandboxTrustAdmissionInput;
  fileSystem: WindowsCreatorSandboxTrustAdmissionFileSystem;
  hashFile: ReturnType<typeof vi.fn>;
  setManifest(manifest: WindowsCreatorSandboxTrustManifest): void;
  setSerialized(serialized: string): void;
};

const createFixture = (
  manifest: WindowsCreatorSandboxTrustManifest = signedManifest(payload()),
  trustPolicy: WindowsCreatorSandboxTrustPolicy = policy()
): AdmissionFixture => {
  let serialized = canonicalizeWindowsCreatorSandboxTrustManifest(manifest);
  const hashFile = vi.fn(async () => HASH);
  const fileSystem: WindowsCreatorSandboxTrustAdmissionFileSystem = {
    lstat: vi.fn(async (filePath) => {
      if (path.resolve(filePath) === PACKAGE_ROOT) return directoryStat;
      if (path.resolve(filePath) === BINARY_PATH) return fileStat(BINARY_SIZE);
      if (path.resolve(filePath) === MANIFEST_PATH) return fileStat(serialized.length);
      throw new Error('Unexpected filesystem path.');
    }),
    realpath: vi.fn(async (filePath) => filePath),
    readFile: vi.fn(async () => serialized),
    hashFile,
  };
  return {
    input: {
      packageRoot: PACKAGE_ROOT,
      binaryPath: BINARY_PATH,
      policy: trustPolicy,
      now: () => 1_500,
      fileSystem,
    },
    fileSystem,
    hashFile,
    setManifest: (next) => {
      serialized = canonicalizeWindowsCreatorSandboxTrustManifest(next);
    },
    setSerialized: (next) => {
      serialized = next;
    },
  };
};

describe('Windows sandbox trust admission', () => {
  it('accepts only an exact canonical manifest signed by a pinned release key', async () => {
    const fixture = createFixture();

    await expect(verifyWindowsCreatorSandboxTrustAdmission(fixture.input)).resolves.toMatchObject({
      state: 'accepted',
      manifest: { manifestId: 'release-20260727' },
    });
    expect(fixture.hashFile).toHaveBeenCalledWith(BINARY_PATH);
  });

  it('rejects a re-canonicalized manifest whose binary hash was tampered after signing', async () => {
    const fixture = createFixture();
    const signed = signedManifest(payload());
    fixture.setSerialized(
      canonicalizeWindowsCreatorSandboxTrustManifest({
        ...signed,
        binary: { path: 'tomny-runtime.exe', sha256: 'b'.repeat(64), sizeBytes: BINARY_SIZE },
      })
    );

    await expect(verifyWindowsCreatorSandboxTrustAdmission(fixture.input)).resolves.toEqual({
      state: 'rejected',
      code: 'TRUST_MANIFEST_SIGNATURE_INVALID',
    });
  });

  it('rejects a stale signed release replayed below the configured minimum version', async () => {
    const fixture = createFixture(
      signedManifest(payload({ package: { id: WINDOWS_CREATOR_SANDBOX_PACKAGE_ID, version: '1.2.2' } }))
    );

    await expect(verifyWindowsCreatorSandboxTrustAdmission(fixture.input)).resolves.toEqual({
      state: 'rejected',
      code: 'TRUST_MANIFEST_VERSION_REJECTED',
    });
  });

  it('rejects an expired manifest even when its signature and pins remain valid', async () => {
    const fixture = createFixture(signedManifest(payload({ expiresAt: 1_500 })));

    await expect(verifyWindowsCreatorSandboxTrustAdmission(fixture.input)).resolves.toEqual({
      state: 'rejected',
      code: 'TRUST_MANIFEST_EXPIRED',
    });
  });

  it('rejects a validly signed manifest from an unknown release signer', async () => {
    const unknown = generateKeyPairSync('ed25519');
    const unknownPublicKey = unknown.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const fixture = createFixture(
      signedManifest(
        payload({
          signer: { id: 'unknown-release', keyPinSha256: getWindowsCreatorSandboxPublicKeyPin(unknownPublicKey) },
        }),
        unknown.privateKey
      )
    );

    await expect(verifyWindowsCreatorSandboxTrustAdmission(fixture.input)).resolves.toEqual({
      state: 'rejected',
      code: 'TRUST_MANIFEST_SIGNER_UNTRUSTED',
    });
  });

  it('rejects a manifest path that attempts to traverse above the package root before hashing', async () => {
    const fixture = createFixture();
    const escaped = {
      ...signedManifest(payload()),
      binary: { path: '../tomny-runtime.exe', sha256: HASH, sizeBytes: BINARY_SIZE },
    };
    fixture.setSerialized(JSON.stringify(escaped));

    await expect(verifyWindowsCreatorSandboxTrustAdmission(fixture.input)).resolves.toEqual({
      state: 'rejected',
      code: 'TRUST_MANIFEST_INVALID',
    });
    expect(fixture.hashFile).not.toHaveBeenCalled();
  });

  it('rejects a revoked manifest before it can admit the executable', async () => {
    const fixture = createFixture(undefined, policy({ revokedManifestIds: ['release-20260727'] }));

    await expect(verifyWindowsCreatorSandboxTrustAdmission(fixture.input)).resolves.toEqual({
      state: 'rejected',
      code: 'TRUST_MANIFEST_REVOKED',
    });
  });

  it('rejects a binary whose observed size no longer matches the signed package manifest', async () => {
    const fixture = createFixture();
    const originalLstat = fixture.fileSystem.lstat;
    fixture.fileSystem.lstat = vi.fn(async (filePath) => {
      if (path.resolve(filePath) === BINARY_PATH) return fileStat(BINARY_SIZE + 1);
      return originalLstat(filePath);
    });

    await expect(verifyWindowsCreatorSandboxTrustAdmission(fixture.input)).resolves.toEqual({
      state: 'rejected',
      code: 'TRUST_MANIFEST_BINARY_UNTRUSTED',
    });
  });

  it('rejects a non-canonical JSON representation before cryptographic verification', async () => {
    const fixture = createFixture();
    fixture.setSerialized(JSON.stringify(signedManifest(payload())));

    await expect(verifyWindowsCreatorSandboxTrustAdmission(fixture.input)).resolves.toEqual({
      state: 'rejected',
      code: 'TRUST_MANIFEST_UNCANONICAL',
    });
  });

  it('rejects trailing whitespace so the on-disk manifest is byte-for-byte canonical', async () => {
    const fixture = createFixture();
    fixture.setSerialized(`${canonicalizeWindowsCreatorSandboxTrustManifest(signedManifest(payload()))}\n`);

    await expect(verifyWindowsCreatorSandboxTrustAdmission(fixture.input)).resolves.toEqual({
      state: 'rejected',
      code: 'TRUST_MANIFEST_UNCANONICAL',
    });
  });
});
