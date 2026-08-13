import { describe, expect, it, vi } from 'vitest';
import {
  createWindowsCreatorSandboxTrustRevocationWatcher,
  type WindowsCreatorSandboxTrustRevocationSnapshot,
  type WindowsCreatorSandboxTrustRevocationSource,
} from '@/process/extensions/windowsSandboxTrustRevocation';

const HASH = 'a'.repeat(64);
const IDENTITY = {
  manifestId: 'release-20260727',
  packageId: 'tomni.creator-preview.os-sandbox',
  packageVersion: '1.2.3',
  signerId: 'tomni-release',
  keyPinSha256: HASH,
};

const snapshot = (
  overrides: Partial<WindowsCreatorSandboxTrustRevocationSnapshot> = {}
): WindowsCreatorSandboxTrustRevocationSnapshot => ({
  revision: 'b'.repeat(64),
  observedAt: 100,
  expiresAt: 1_000,
  revokedManifestIds: [],
  revokedSignerIds: [],
  revokedKeyPins: [],
  quarantinedPackages: [],
  ...overrides,
});

type RevocationFixture = {
  source: WindowsCreatorSandboxTrustRevocationSource;
  emit(): void;
  failReads(): void;
  setSnapshot(next: WindowsCreatorSandboxTrustRevocationSnapshot): void;
  unsubscribe: ReturnType<typeof vi.fn>;
};

const createFixture = (): RevocationFixture => {
  let current = snapshot();
  let failed = false;
  const listeners = new Set<() => void>();
  const unsubscribe = vi.fn();
  return {
    source: {
      readSnapshot: vi.fn(async () => {
        if (failed) throw new Error('revocation source unavailable');
        return current;
      }),
      subscribe: vi.fn((listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          unsubscribe();
        };
      }),
    },
    emit: () => {
      for (const listener of listeners) listener();
    },
    failReads: () => {
      failed = true;
    },
    setSnapshot: (next) => {
      current = next;
    },
    unsubscribe,
  };
};

describe('Windows sandbox live trust revocation watcher', () => {
  it('admits a fresh source snapshot and subscribes before the native helper can run', async () => {
    const fixture = createFixture();

    const watcher = await createWindowsCreatorSandboxTrustRevocationWatcher({
      identity: IDENTITY,
      source: fixture.source,
      now: () => 200,
      onRevoked: vi.fn(),
    });

    expect(watcher.state).toBe('ready');
    if (watcher.state === 'ready') watcher.dispose();
    expect(fixture.unsubscribe).toHaveBeenCalledOnce();
  });

  it('blocks a new launch when the source cannot provide a revocation subscription', async () => {
    const fixture = createFixture();
    fixture.source.subscribe = vi.fn(
      () => undefined
    ) as unknown as WindowsCreatorSandboxTrustRevocationSource['subscribe'];

    await expect(
      createWindowsCreatorSandboxTrustRevocationWatcher({
        identity: IDENTITY,
        source: fixture.source,
        now: () => 200,
        onRevoked: vi.fn(),
      })
    ).resolves.toEqual({ state: 'unavailable', code: 'TRUST_REVOCATION_UNAVAILABLE' });
  });

  it('blocks a new launch when the signing key is already revoked', async () => {
    const fixture = createFixture();
    fixture.setSnapshot(snapshot({ revokedKeyPins: [HASH] }));

    await expect(
      createWindowsCreatorSandboxTrustRevocationWatcher({
        identity: IDENTITY,
        source: fixture.source,
        now: () => 200,
        onRevoked: vi.fn(),
      })
    ).resolves.toEqual({ state: 'unavailable', code: 'TRUST_REVOCATION_REVOKED' });
  });

  it('blocks a new launch when the exact package version is quarantined', async () => {
    const fixture = createFixture();
    fixture.setSnapshot(
      snapshot({ quarantinedPackages: [{ packageId: IDENTITY.packageId, packageVersion: IDENTITY.packageVersion }] })
    );

    await expect(
      createWindowsCreatorSandboxTrustRevocationWatcher({
        identity: IDENTITY,
        source: fixture.source,
        now: () => 200,
        onRevoked: vi.fn(),
      })
    ).resolves.toEqual({ state: 'unavailable', code: 'TRUST_REVOCATION_REVOKED' });
  });

  it('revokes a running helper exactly once when a signing key is revoked live', async () => {
    const fixture = createFixture();
    let resolveRevoked: (() => void) | undefined;
    const revoked = new Promise<void>((resolve) => {
      resolveRevoked = resolve;
    });
    const onRevoked = vi.fn(() => resolveRevoked?.());
    const watcher = await createWindowsCreatorSandboxTrustRevocationWatcher({
      identity: IDENTITY,
      source: fixture.source,
      now: () => 200,
      onRevoked,
    });
    if (watcher.state !== 'ready') throw new Error('Expected a live revocation watcher.');

    fixture.setSnapshot(snapshot({ revokedSignerIds: [IDENTITY.signerId] }));
    fixture.emit();
    fixture.emit();
    await revoked;

    expect(onRevoked).toHaveBeenCalledOnce();
    watcher.dispose();
  });

  it('fails closed and revokes a running helper when the live source becomes unreadable', async () => {
    const fixture = createFixture();
    let resolveRevoked: (() => void) | undefined;
    const revoked = new Promise<void>((resolve) => {
      resolveRevoked = resolve;
    });
    const watcher = await createWindowsCreatorSandboxTrustRevocationWatcher({
      identity: IDENTITY,
      source: fixture.source,
      now: () => 200,
      onRevoked: () => resolveRevoked?.(),
    });
    if (watcher.state !== 'ready') throw new Error('Expected a live revocation watcher.');

    fixture.failReads();
    fixture.emit();
    await revoked;

    watcher.dispose();
  });

  it('does not keep monitoring after the active boundary is disposed', async () => {
    const fixture = createFixture();
    const onRevoked = vi.fn();
    const watcher = await createWindowsCreatorSandboxTrustRevocationWatcher({
      identity: IDENTITY,
      source: fixture.source,
      now: () => 200,
      onRevoked,
    });
    if (watcher.state !== 'ready') throw new Error('Expected a live revocation watcher.');
    watcher.dispose();

    fixture.setSnapshot(snapshot({ revokedManifestIds: [IDENTITY.manifestId] }));
    fixture.emit();
    await Promise.resolve();

    expect(onRevoked).not.toHaveBeenCalled();
    expect(fixture.unsubscribe).toHaveBeenCalledOnce();
  });

  it('fails closed when the snapshot is expired before a new launch', async () => {
    const fixture = createFixture();
    fixture.setSnapshot(snapshot({ expiresAt: 200 }));

    await expect(
      createWindowsCreatorSandboxTrustRevocationWatcher({
        identity: IDENTITY,
        source: fixture.source,
        now: () => 200,
        onRevoked: vi.fn(),
      })
    ).resolves.toEqual({ state: 'unavailable', code: 'TRUST_REVOCATION_UNAVAILABLE' });
  });
});
