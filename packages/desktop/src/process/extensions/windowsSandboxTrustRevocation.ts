/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export type WindowsCreatorSandboxTrustIdentity = {
  manifestId: string;
  packageId: string;
  packageVersion: string;
  signerId: string;
  keyPinSha256: string;
};

export type WindowsCreatorSandboxQuarantinedPackage = {
  packageId: string;
  /** `null` quarantines every version of the package. */
  packageVersion: string | null;
};

/**
 * A trusted main-process integration must authenticate the origin of this data before it
 * exposes a snapshot here. The boundary validates freshness and shape again, then fails
 * closed on every source or subscription error.
 */
export type WindowsCreatorSandboxTrustRevocationSnapshot = {
  revision: string;
  observedAt: number;
  expiresAt: number;
  revokedManifestIds: readonly string[];
  revokedSignerIds: readonly string[];
  revokedKeyPins: readonly string[];
  quarantinedPackages: readonly WindowsCreatorSandboxQuarantinedPackage[];
};

export type WindowsCreatorSandboxTrustRevocationSource = {
  readSnapshot(): Promise<unknown>;
  subscribe(onChanged: () => void): () => void;
};

export type WindowsCreatorSandboxTrustRevocationCode = 'TRUST_REVOCATION_UNAVAILABLE' | 'TRUST_REVOCATION_REVOKED';

export type WindowsCreatorSandboxTrustRevocationWatcher = {
  state: 'ready';
  dispose(): void;
};

export type WindowsCreatorSandboxTrustRevocationWatcherResult =
  | WindowsCreatorSandboxTrustRevocationWatcher
  | { state: 'unavailable'; code: WindowsCreatorSandboxTrustRevocationCode };

export type WindowsCreatorSandboxTrustRevocationWatcherOptions = {
  identity: WindowsCreatorSandboxTrustIdentity;
  source: WindowsCreatorSandboxTrustRevocationSource;
  now?: () => number;
  onRevoked(code: WindowsCreatorSandboxTrustRevocationCode): void | Promise<void>;
};

type NormalizedSnapshot = {
  revision: string;
  observedAt: number;
  expiresAt: number;
  revokedManifestIds: ReadonlySet<string>;
  revokedSignerIds: ReadonlySet<string>;
  revokedKeyPins: ReadonlySet<string>;
  quarantinedPackages: readonly WindowsCreatorSandboxQuarantinedPackage[];
};

type RevocationDecision = { state: 'allowed' } | { state: 'rejected'; code: WindowsCreatorSandboxTrustRevocationCode };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const requireExactRecord = (value: unknown, label: string, keys: readonly string[]): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has an unexpected shape.`);
  }
  return value;
};

const requireIdentifier = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!IDENTIFIER_PATTERN.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
};

const requireSha256 = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SHA256_PATTERN.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
};

const requireStableVersion = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!SEMVER_PATTERN.test(normalized)) throw new Error(`${label} must be a stable semantic version.`);
  return normalized;
};

const requireEpochMilliseconds = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative epoch timestamp.`);
  }
  return value;
};

const requireStringList = (
  value: unknown,
  label: string,
  normalize: (entry: unknown, entryLabel: string) => string
): ReadonlySet<string> => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const entries = value.map((entry) => normalize(entry, label));
  if (new Set(entries).size !== entries.length) throw new Error(`${label} must not contain duplicates.`);
  return new Set(entries);
};

const normalizeSnapshot = (value: unknown): NormalizedSnapshot => {
  const candidate = requireExactRecord(value, 'Trust revocation snapshot', [
    'revision',
    'observedAt',
    'expiresAt',
    'revokedManifestIds',
    'revokedSignerIds',
    'revokedKeyPins',
    'quarantinedPackages',
  ]);
  const observedAt = requireEpochMilliseconds(candidate.observedAt, 'Trust revocation observedAt');
  const expiresAt = requireEpochMilliseconds(candidate.expiresAt, 'Trust revocation expiresAt');
  if (expiresAt <= observedAt) throw new Error('Trust revocation expiry must follow observation.');
  if (!Array.isArray(candidate.quarantinedPackages)) throw new Error('Trust quarantined packages must be an array.');
  const quarantinedPackages = candidate.quarantinedPackages.map((entry) => {
    const packageEntry = requireExactRecord(entry, 'Trust quarantined package', ['packageId', 'packageVersion']);
    return {
      packageId: requireIdentifier(packageEntry.packageId, 'Trust quarantined package id'),
      packageVersion:
        packageEntry.packageVersion === null
          ? null
          : requireStableVersion(packageEntry.packageVersion, 'Trust quarantined package version'),
    };
  });
  const duplicatePackage = new Set(
    quarantinedPackages.map(({ packageId, packageVersion }) => `${packageId}\u0000${packageVersion ?? '*'}`)
  );
  if (duplicatePackage.size !== quarantinedPackages.length)
    throw new Error('Trust quarantined packages must not duplicate.');
  return {
    revision: requireSha256(candidate.revision, 'Trust revocation revision'),
    observedAt,
    expiresAt,
    revokedManifestIds: requireStringList(candidate.revokedManifestIds, 'Revoked manifest ids', requireIdentifier),
    revokedSignerIds: requireStringList(candidate.revokedSignerIds, 'Revoked signer ids', requireIdentifier),
    revokedKeyPins: requireStringList(candidate.revokedKeyPins, 'Revoked signer key pins', requireSha256),
    quarantinedPackages,
  };
};

const normalizeIdentity = (value: WindowsCreatorSandboxTrustIdentity): WindowsCreatorSandboxTrustIdentity => ({
  manifestId: requireIdentifier(value.manifestId, 'Trust identity manifest id'),
  packageId: requireIdentifier(value.packageId, 'Trust identity package id'),
  packageVersion: requireStableVersion(value.packageVersion, 'Trust identity package version'),
  signerId: requireIdentifier(value.signerId, 'Trust identity signer id'),
  keyPinSha256: requireSha256(value.keyPinSha256, 'Trust identity signer key pin'),
});

const decideRevocation = (
  identity: WindowsCreatorSandboxTrustIdentity,
  snapshot: unknown,
  now: number
): RevocationDecision => {
  try {
    const normalizedIdentity = normalizeIdentity(identity);
    const normalizedSnapshot = normalizeSnapshot(snapshot);
    if (!Number.isSafeInteger(now) || now < normalizedSnapshot.observedAt || now >= normalizedSnapshot.expiresAt) {
      return { state: 'rejected', code: 'TRUST_REVOCATION_UNAVAILABLE' };
    }
    const quarantined = normalizedSnapshot.quarantinedPackages.some(
      ({ packageId, packageVersion }) =>
        packageId === normalizedIdentity.packageId &&
        (packageVersion === null || packageVersion === normalizedIdentity.packageVersion)
    );
    if (
      normalizedSnapshot.revokedManifestIds.has(normalizedIdentity.manifestId) ||
      normalizedSnapshot.revokedSignerIds.has(normalizedIdentity.signerId) ||
      normalizedSnapshot.revokedKeyPins.has(normalizedIdentity.keyPinSha256) ||
      quarantined
    ) {
      return { state: 'rejected', code: 'TRUST_REVOCATION_REVOKED' };
    }
    return { state: 'allowed' };
  } catch {
    return { state: 'rejected', code: 'TRUST_REVOCATION_UNAVAILABLE' };
  }
};

/**
 * Subscribe to revocation changes after a fresh snapshot is admitted. Any live read,
 * validation, or subscription fault tears down the caller's boundary through onRevoked.
 */
export const createWindowsCreatorSandboxTrustRevocationWatcher = async (
  options: WindowsCreatorSandboxTrustRevocationWatcherOptions
): Promise<WindowsCreatorSandboxTrustRevocationWatcherResult> => {
  const now = options.now ?? (() => Date.now());
  const readDecision = async (): Promise<RevocationDecision> => {
    try {
      return decideRevocation(options.identity, await options.source.readSnapshot(), now());
    } catch {
      return { state: 'rejected', code: 'TRUST_REVOCATION_UNAVAILABLE' };
    }
  };

  const initial = await readDecision();
  if (initial.state === 'rejected') return { state: 'unavailable', code: initial.code };

  let closed = false;
  let revoked = false;
  let unsubscribe: (() => void) | undefined;
  let checkInFlight: Promise<void> | undefined;
  const revoke = (code: WindowsCreatorSandboxTrustRevocationCode): void => {
    if (closed || revoked) return;
    revoked = true;
    try {
      unsubscribe?.();
    } catch {
      // Revocation is already terminal even if the source cannot be unsubscribed.
    }
    unsubscribe = undefined;
    void Promise.resolve(options.onRevoked(code)).catch((): undefined => undefined);
  };
  const checkCurrent = (): Promise<void> => {
    if (closed || revoked || checkInFlight) return checkInFlight ?? Promise.resolve();
    const work = (async () => {
      const decision = await readDecision();
      if (decision.state === 'rejected') revoke(decision.code);
    })();
    checkInFlight = work;
    return work.finally(() => {
      if (checkInFlight === work) checkInFlight = undefined;
    });
  };

  try {
    const nextUnsubscribe = options.source.subscribe(() => {
      void checkCurrent();
    });
    if (typeof nextUnsubscribe !== 'function')
      throw new Error('Trust revocation source did not provide an unsubscribe callback.');
    unsubscribe = nextUnsubscribe;
  } catch {
    return { state: 'unavailable', code: 'TRUST_REVOCATION_UNAVAILABLE' };
  }
  const afterSubscription = await readDecision();
  if (afterSubscription.state === 'rejected') {
    try {
      unsubscribe();
    } catch {
      // No active native helper was admitted yet, so returning unavailable is sufficient.
    }
    return { state: 'unavailable', code: afterSubscription.code };
  }

  return {
    state: 'ready',
    dispose: () => {
      if (closed) return;
      closed = true;
      try {
        unsubscribe?.();
      } catch {
        // The caller's boundary is already closed.
      }
      unsubscribe = undefined;
    },
  };
};
