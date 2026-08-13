import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  packageSignaturePayload,
  type LinkedMicrosoftAppRecord,
  type PackageCatalogEntry,
  type PackageManifest,
} from '@/common/packages';
import { MICROSOFT_STORE_NATIVE_CHANNELS, type MicrosoftStoreNativeResult } from '@/common/types/platform/electron';
import {
  CatalogFederationError,
  createCatalogActionConsentAuthority,
  createCatalogActionLedger,
  createCatalogFederationBroker,
  createDurableFederatedCatalogCache,
  createMicrosoftStoreCatalogProvider,
  createMicrosoftStoreNativeRuntime,
  createWindowsMicrosoftStoreAdapter,
  parseLinkedMicrosoftAppRecord,
  registerTrustedMicrosoftStoreNativeIpcBridge,
  type CatalogProvider,
  type SafeFileRunner,
} from '@process/extensions/package-manager/catalog-federation';
import {
  createRemotePackageCatalogLoader,
  parseRemotePackageCatalog,
  signRemotePackageCatalog,
} from '@process/extensions/package-manager/remoteCatalog';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const createTestActionLedger = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-action-ledger-test-'));
  roots.push(root);
  return createCatalogActionLedger({ rootDir: path.join(root, 'ledger') });
};

type SignedEntryOptions = {
  id?: string;
  publisherId?: string;
  runtime?: 'sandboxed-web' | 'trusted-react';
  trust?: 'signed-store' | 'signed-first-party';
  version?: string;
};

const signedEntry = (
  options: SignedEntryOptions = {}
): { entry: PackageCatalogEntry; publicKey: string; privateKey: string } => {
  const keys = generateKeyPairSync('ed25519');
  const unsigned: PackageManifest = {
    schemaVersion: 1,
    id: options.id ?? 'com.example.notes',
    publisherId: options.publisherId ?? 'com.example',
    name: 'Notes',
    description: 'Remote notes package',
    type: 'app',
    bundleKind: 'single',
    version: options.version ?? '1.0.0',
    engines: { tomni: '>=0.0.0' },
    modules: [
      {
        id: 'notes',
        title: 'Notes',
        surface: 'apps/notes',
        pinnable: true,
        runtime: options.runtime ?? 'sandboxed-web',
        entrypoint: options.runtime === 'trusted-react' ? 'app.js' : 'index.html',
      },
    ],
    permissions: [],
    dependencies: [],
    tags: ['notes'],
    artifact: {
      integrity: `sha256-${'a'.repeat(64)}`,
      sizeBytes: 10,
      signature: { algorithm: 'ed25519', keyId: 'store-test', value: '' },
    },
  };
  const signature = sign(null, Buffer.from(packageSignaturePayload(unsigned)), keys.privateKey).toString('base64');
  const manifest: PackageManifest = {
    ...unsigned,
    artifact: { ...unsigned.artifact!, signature: { ...unsigned.artifact!.signature, value: signature } },
  };
  return {
    entry: {
      delivery: 'downloaded-package',
      trust: options.trust ?? 'signed-store',
      artifactUrl: 'https://store.example/com.example.notes-1.0.0.tomny',
      manifest,
    },
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
};

const signedCatalog = (entry: PackageCatalogEntry, privateKey: string, revision = 1, issuedAt = new Date()) =>
  signRemotePackageCatalog(
    {
      schemaVersion: 1,
      revision,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
      packages: [entry],
    },
    'store-test',
    privateKey
  );

describe('remote package catalog', () => {
  it('accepts a signed public package and caches it for offline refreshes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-catalog-test-'));
    roots.push(root);
    const { entry, publicKey, privateKey } = signedEntry();
    const document = signedCatalog(entry, privateKey);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(document), { status: 200 }))
      .mockRejectedValueOnce(new Error('offline'));
    const load = createRemotePackageCatalogLoader({
      url: 'https://store.example/catalog.json',
      cachePath: path.join(root, 'catalog.json'),
      fallbackCatalog: [],
      trustedKeys: { 'store-test': publicKey },
      fetcher,
    });

    expect((await load())[0]?.manifest.id).toBe('com.example.notes');
    expect((await load())[0]?.manifest.id).toBe('com.example.notes');
  });

  it('does not grant first-party trust from a catalog-authored trust field', () => {
    const { entry, publicKey, privateKey } = signedEntry({
      id: 'com.tomni.malicious',
      publisherId: 'com.tomni',
      runtime: 'trusted-react',
      trust: 'signed-first-party',
    });
    const document = signedCatalog(entry, privateKey);

    expect(parseRemotePackageCatalog(document, { 'store-test': publicKey }).packages[0]?.trust).toBe('signed-store');
  });

  it('does not let a lower-trust remote package replace a bundled first-party identity', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-catalog-test-'));
    roots.push(root);
    const {
      entry: remoteEntry,
      publicKey,
      privateKey,
    } = signedEntry({
      id: 'com.tomni.document-studio',
      publisherId: 'com.example',
    });
    const fallbackEntry: PackageCatalogEntry = {
      ...remoteEntry,
      trust: 'signed-first-party',
      manifest: {
        ...remoteEntry.manifest,
        publisherId: 'com.tomni',
        name: 'Document Studio',
      },
    };
    const document = signedCatalog(remoteEntry, privateKey);
    const load = createRemotePackageCatalogLoader({
      url: 'https://store.example/catalog.json',
      cachePath: path.join(root, 'catalog.json'),
      fallbackCatalog: [fallbackEntry],
      trustedKeys: { 'store-test': publicKey },
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(document), { status: 200 })),
    });

    expect((await load())[0]).toMatchObject({
      trust: 'signed-first-party',
      manifest: { id: 'com.tomni.document-studio', publisherId: 'com.tomni' },
    });
  });

  it('does not let a lower-version remote package replace a bundled first-party package', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-catalog-test-'));
    roots.push(root);
    const {
      entry: remoteEntry,
      publicKey,
      privateKey,
    } = signedEntry({
      id: 'com.tomni.document-studio',
      publisherId: 'com.tomni',
      version: '0.9.0',
    });
    const fallbackEntry = signedEntry({
      id: 'com.tomni.document-studio',
      publisherId: 'com.tomni',
      version: '1.0.0',
      trust: 'signed-first-party',
    }).entry;
    const load = createRemotePackageCatalogLoader({
      url: 'https://store.example/catalog.json',
      cachePath: path.join(root, 'catalog.json'),
      fallbackCatalog: [fallbackEntry],
      trustedKeys: { 'store-test': publicKey },
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(signedCatalog(remoteEntry, privateKey)), { status: 200 })),
    });

    expect((await load())[0]?.manifest.version).toBe('1.0.0');
  });

  it('rejects a catalog whose publisher signing key is not trusted', () => {
    const { entry, privateKey } = signedEntry();
    const document = signedCatalog(entry, privateKey);

    expect(() => parseRemotePackageCatalog(document, {})).toThrow(/not trusted/i);
  });

  it('rejects a forged catalog envelope even when the package artifact remains signed', () => {
    const { entry, publicKey, privateKey } = signedEntry();
    const document = signedCatalog(entry, privateKey);
    document.packages[0]!.artifactUrl = 'https://attacker.example/replaced.tomny';

    expect(() => parseRemotePackageCatalog(document, { 'store-test': publicKey })).toThrow(/catalog signature/i);
  });

  it('keeps the highest signed revision when a remote response rolls back', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-catalog-test-'));
    roots.push(root);
    const { entry, publicKey, privateKey } = signedEntry();
    const newest = signedCatalog(entry, privateKey, 2);
    const older = signedCatalog(entry, privateKey, 1);
    const cachePath = path.join(root, 'catalog.json');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(newest), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(older), { status: 200 }));
    const load = createRemotePackageCatalogLoader({
      url: 'https://store.example/catalog.json',
      cachePath,
      fallbackCatalog: [],
      trustedKeys: { 'store-test': publicKey },
      fetcher,
    });

    await load();
    await load();

    expect(JSON.parse(await readFile(`${cachePath}.marker`, 'utf8'))).toMatchObject({ revision: 2 });
  });

  it('recovers an offline catalog from the durable recovery snapshot and quarantines corrupt data', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-catalog-test-'));
    roots.push(root);
    const { entry, publicKey, privateKey } = signedEntry();
    const cachePath = path.join(root, 'catalog.json');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(signedCatalog(entry, privateKey)), { status: 200 }))
      .mockRejectedValueOnce(new Error('offline'));
    const load = createRemotePackageCatalogLoader({
      url: 'https://store.example/catalog.json',
      cachePath,
      fallbackCatalog: [],
      trustedKeys: { 'store-test': publicKey },
      fetcher,
    });

    await load();
    await writeFile(cachePath, '{not-json');

    expect((await load())[0]?.manifest.id).toBe('com.example.notes');
    expect(await readdir(`${cachePath}.quarantine`)).not.toHaveLength(0);
  });

  it('does not use a durable catalog beyond its configured stale limit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-catalog-test-'));
    roots.push(root);
    let clock = new Date('2026-07-26T00:00:00.000Z');
    const { entry, publicKey, privateKey } = signedEntry();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(signedCatalog(entry, privateKey, 1, clock)), { status: 200 }))
      .mockRejectedValueOnce(new Error('offline'));
    const load = createRemotePackageCatalogLoader({
      url: 'https://store.example/catalog.json',
      cachePath: path.join(root, 'catalog.json'),
      fallbackCatalog: [],
      trustedKeys: { 'store-test': publicKey },
      fetcher,
      now: () => clock,
      maxCacheAgeMs: 60_000,
    });

    await load();
    clock = new Date(clock.getTime() + 60_001);

    await expect(load()).rejects.toThrow(/offline/i);
  });
});

const LINKED_APP: LinkedMicrosoftAppRecord = {
  schemaVersion: 1,
  id: 'com.tomni.link.powertoys',
  tomniPackageId: 'com.example.powertoys-guide',
  microsoft: {
    productId: 'XP89DCGQ3K6VLD',
    packageFamilyName: 'Microsoft.PowerToys_8wekyb3d8bbwe',
    publisherIdentity: 'CN=Microsoft Corporation, O=Microsoft Corporation, C=US',
    version: { minimumInclusive: '1.0.0.0', maximumExclusive: '2.0.0.0' },
  },
  activation: { uri: 'powertoys://home' },
  permissions: ['app.launch'],
  requirements: { regions: ['VN'], license: 'free' },
  review: {
    revision: 'review-7',
    reviewedAt: '2026-07-26T00:00:00.000Z',
    health: 'healthy',
    killSwitch: false,
  },
};

const microsoftAdapter = (search: () => Promise<Array<{ productId: string; name: string }>>) => ({
  search: async () => search(),
  installLinked: vi.fn(),
  launchLinked: vi.fn(),
  openStoreProduct: vi.fn(),
});

describe('catalog federation broker', () => {
  it('merges only an explicitly reviewed Tomni-to-Microsoft link and keeps both offers separate', async () => {
    const tomniProvider: CatalogProvider = {
      source: 'tomni-store',
      search: async (request) => [
        {
          display: { name: 'PowerToys Guide', summary: 'Tomni workflow package' },
          offer: {
            source: 'tomni-store',
            sourceItemId: 'com.example.powertoys-guide',
            provenance: { method: 'api', revision: 'catalog-3' },
            lastSeenAt: '2026-07-26T00:00:00.000Z',
            region: request.region,
            availability: 'available',
            trustSignal: { kind: 'tomni-review', tier: 'signed-store' },
          },
        },
      ],
    };
    const adapter = microsoftAdapter(async () => [{ productId: 'XP89DCGQ3K6VLD', name: 'Microsoft PowerToys' }]);
    const broker = createCatalogFederationBroker({
      providers: [tomniProvider, createMicrosoftStoreCatalogProvider(adapter, [LINKED_APP])],
      linkedApps: [LINKED_APP],
      authorize: () => true,
      now: () => new Date('2026-07-26T00:00:00.000Z'),
    });

    const result = await broker.search({ query: 'PowerToys', region: 'VN', limit: 5 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      canonicalKey: 'linked:com.tomni.link.powertoys',
      display: { name: 'PowerToys Guide' },
    });
    expect(result.items[0]?.offers.map((offer) => offer.source)).toEqual(['tomni-store', 'microsoft-store']);
  });

  it('returns stale cached offers instead of claiming a failed source has no products', async () => {
    const search = vi
      .fn<() => Promise<Array<{ productId: string; name: string }>>>()
      .mockResolvedValueOnce([{ productId: 'XP89DCGQ3K6VLD', name: 'Microsoft PowerToys' }])
      .mockRejectedValueOnce(new Error('offline'));
    const provider = createMicrosoftStoreCatalogProvider(
      microsoftAdapter(search),
      [LINKED_APP],
      () => new Date('2026-07-26T00:00:00.000Z')
    );
    const broker = createCatalogFederationBroker({
      providers: [provider],
      linkedApps: [LINKED_APP],
      authorize: () => true,
      now: () => new Date('2026-07-26T00:00:00.000Z'),
    });
    await broker.search({ query: 'PowerToys', region: 'VN', limit: 5 });

    const offline = await broker.search({ query: 'PowerToys', region: 'VN', limit: 5 });

    expect(offline.sources.find((source) => source.source === 'microsoft-store')).toMatchObject({ status: 'stale' });
    expect(offline.items[0]?.offers[0]).toMatchObject({
      source: 'microsoft-store',
      availability: 'unknown',
      lastSeenAt: '2026-07-26T00:00:00.000Z',
    });
  });

  it('requires action authorization before invoking a catalog provider', async () => {
    const install = vi.fn(async () => ({
      provider: 'store-uri' as const,
      status: 'delegated-to-store' as const,
      verification: 'not-applicable' as const,
    }));
    const broker = createCatalogFederationBroker({
      providers: [{ source: 'microsoft-store', search: async () => [], install }],
      ledger: await createTestActionLedger(),
      authorize: () => false,
    });

    await expect(
      broker.install({
        source: 'microsoft-store',
        sourceItemId: 'XP89DCGQ3K6VLD',
        region: 'VN',
        idempotencyKey: 'authorization-denied-1',
      })
    ).rejects.toMatchObject({ code: 'CATALOG_ACTION_DENIED' });
    expect(install).not.toHaveBeenCalled();
  });
});

describe('durable federated catalog cache', () => {
  it('recovers a per-source snapshot after restart without losing its provenance', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-federated-cache-test-'));
    roots.push(root);
    const cacheRoot = path.join(root, 'catalog-cache');
    const clock = new Date('2026-07-26T00:00:00.000Z');
    const cache = createDurableFederatedCatalogCache({ rootDir: cacheRoot, now: () => clock });
    const onlineProvider: CatalogProvider = {
      source: 'tomni-store',
      search: async (request) => [
        {
          display: { name: 'Offline-capable Notes' },
          offer: {
            source: 'tomni-store',
            sourceItemId: 'com.example.notes',
            provenance: { method: 'api', revision: 'catalog-12' },
            lastSeenAt: clock.toISOString(),
            region: request.region,
            availability: 'available',
            trustSignal: { kind: 'tomni-review', tier: 'signed-store' },
          },
        },
      ],
    };
    const request = { query: 'Notes', region: 'VN', limit: 5 };
    const online = createCatalogFederationBroker({
      providers: [onlineProvider],
      cache,
      authorize: () => false,
      now: () => clock,
    });

    await online.search(request);
    const cacheKey = { source: 'tomni-store', query: 'notes', region: 'VN', limit: 5 };
    const identity = createHash('sha256').update(JSON.stringify(cacheKey)).digest('hex');
    const activePath = path.join(cacheRoot, identity.slice(0, 2), identity, 'active.json');
    await writeFile(activePath, '{corrupt');

    const afterRestart = createCatalogFederationBroker({
      providers: [{ source: 'tomni-store', search: async () => Promise.reject(new Error('offline')) }],
      cache: createDurableFederatedCatalogCache({ rootDir: cacheRoot, now: () => clock }),
      authorize: () => false,
      now: () => clock,
    });
    const result = await afterRestart.search(request);

    expect(result.sources.find((source) => source.source === 'tomni-store')).toMatchObject({ status: 'stale' });
    expect(result.items[0]?.offers[0]).toMatchObject({
      provenance: { method: 'api', revision: 'catalog-12' },
      availability: 'unknown',
    });
    expect(await readdir(path.join(cacheRoot, identity.slice(0, 2), identity, 'quarantine'))).not.toHaveLength(0);
  });
});

describe('catalog action consent, policy and receipts', () => {
  it('binds a consent grant to its trusted owner and idempotency key', async () => {
    const clock = new Date('2026-07-26T00:00:00.000Z');
    const consent = createCatalogActionConsentAuthority({
      now: () => clock,
      randomId: () => 'owner-bound-consent',
    });
    const grant = consent.recordUserDecision({
      action: 'install',
      source: 'tomni-store',
      sourceItemId: 'com.example.notes',
      region: 'VN',
      ownerId: 'renderer-main-1',
      idempotencyKey: 'install-owner-bound-1',
      approved: true,
    });
    const install = vi.fn(async () => ({
      provider: 'tomni-package-manager' as const,
      status: 'completed' as const,
      verification: 'verified' as const,
      installedVersion: '1.0.0',
    }));
    const ledger = await createTestActionLedger();
    const broker = createCatalogFederationBroker({
      providers: [{ source: 'tomni-store', search: async () => [], install }],
      ledger,
      authorize: () => true,
      consent,
      now: () => clock,
      randomId: () => 'owner-bound-operation',
    });

    await expect(
      broker.install({
        source: 'tomni-store',
        sourceItemId: 'com.example.notes',
        region: 'VN',
        idempotencyKey: 'install-owner-bound-1',
        consentId: grant?.consentId,
        ownerId: 'renderer-main-2',
      })
    ).rejects.toMatchObject({ code: 'CATALOG_ACTION_DENIED' });
    expect(install).not.toHaveBeenCalled();

    await expect(
      broker.install({
        source: 'tomni-store',
        sourceItemId: 'com.example.notes',
        region: 'VN',
        idempotencyKey: 'install-owner-bound-1',
        consentId: grant?.consentId,
        ownerId: 'renderer-main-1',
      })
    ).resolves.toMatchObject({ status: 'completed', installedVersion: '1.0.0' });
    expect(install).toHaveBeenCalledOnce();
  });

  it('replays a completed ledger receipt without manufacturing replacement consent', async () => {
    const clock = new Date('2026-07-26T00:00:00.000Z');
    const consent = createCatalogActionConsentAuthority({
      now: () => clock,
      randomId: () => 'replay-consent',
    });
    const grant = consent.recordUserDecision({
      action: 'uninstall',
      source: 'tomni-store',
      sourceItemId: 'com.example.notes',
      region: 'VN',
      ownerId: 'renderer-main-1',
      idempotencyKey: 'uninstall-replay-1',
      approved: true,
    });
    const uninstall = vi.fn(async () => ({
      provider: 'tomni-package-manager' as const,
      status: 'completed' as const,
      verification: 'verified' as const,
    }));
    const ledger = await createTestActionLedger();
    const createBroker = () =>
      createCatalogFederationBroker({
        providers: [{ source: 'tomni-store', search: async () => [], uninstall }],
        ledger,
        authorize: () => true,
        consent,
        now: () => clock,
        randomId: () => 'replay-operation',
      });
    const request = {
      source: 'tomni-store' as const,
      sourceItemId: 'com.example.notes',
      region: 'VN',
      idempotencyKey: 'uninstall-replay-1',
      consentId: grant?.consentId,
      ownerId: 'renderer-main-1',
    };

    const receipt = await createBroker().uninstall(request);
    consent.revokeOwner('renderer-main-1');
    await expect(createBroker().uninstall(request)).resolves.toEqual(receipt);
    expect(uninstall).toHaveBeenCalledOnce();
  });

  it('does not create a consent record for a denied user decision', () => {
    const consent = createCatalogActionConsentAuthority({ randomId: () => 'must-not-be-issued' });

    expect(
      consent.recordUserDecision({
        action: 'install',
        source: 'tomni-store',
        sourceItemId: 'com.example.notes',
        region: 'VN',
        ownerId: 'renderer-main-1',
        idempotencyKey: 'install-denied-1',
        approved: false,
      })
    ).toBeUndefined();
  });
  it('persists a completed authorized action receipt across a ledger restart', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-action-ledger-test-'));
    roots.push(root);
    const clock = new Date('2026-07-26T00:00:00.000Z');
    const ledger = createCatalogActionLedger({
      rootDir: path.join(root, 'ledger'),
      now: () => clock,
      randomId: () => 'ledger-entry-1',
    });
    const broker = createCatalogFederationBroker({
      providers: [
        {
          source: 'tomni-store',
          search: async () => [],
          uninstall: async () => ({
            provider: 'tomni-package-manager',
            status: 'completed',
            verification: 'verified',
          }),
        },
      ],
      ledger,
      authorize: () => true,
      consent: {
        authorize: (request) => ({
          allowed: true,
          consent: {
            schemaVersion: 1,
            consentId: 'consent-1',
            action: request.action,
            source: request.source,
            sourceItemId: request.sourceItemId,
            ...(request.region ? { region: request.region } : {}),
            grantedAt: clock.toISOString(),
            expiresAt: new Date(clock.getTime() + 60_000).toISOString(),
          },
        }),
      },
      randomId: () => 'operation-1',
      now: () => clock,
    });

    await broker.uninstall({
      source: 'tomni-store',
      sourceItemId: 'com.example.notes',
      region: 'VN',
      idempotencyKey: 'uninstall-notes-1',
    });
    const persisted = await createCatalogActionLedger({ rootDir: path.join(root, 'ledger'), now: () => clock }).list();

    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      state: 'completed',
      consent: { consentId: 'consent-1' },
      receipt: { operationId: 'operation-1', action: 'uninstall', status: 'completed' },
    });
  });

  it('does not invoke a provider when the current consent is denied', async () => {
    const install = vi.fn(async () => ({
      provider: 'tomni-package-manager' as const,
      status: 'completed' as const,
      verification: 'verified' as const,
    }));
    const broker = createCatalogFederationBroker({
      providers: [{ source: 'tomni-store', search: async () => [], install }],
      ledger: await createTestActionLedger(),
      authorize: () => true,
      consent: { authorize: () => ({ allowed: false }) },
    });

    await expect(
      broker.install({
        source: 'tomni-store',
        sourceItemId: 'com.example.notes',
        region: 'VN',
        idempotencyKey: 'install-notes-denied-1',
      })
    ).rejects.toMatchObject({ code: 'CATALOG_ACTION_DENIED' });
    expect(install).not.toHaveBeenCalled();
  });

  it('fails closed when a side-effect action has no current consent resolver', async () => {
    const uninstall = vi.fn(async () => ({
      provider: 'tomni-package-manager' as const,
      status: 'completed' as const,
      verification: 'verified' as const,
    }));
    const broker = createCatalogFederationBroker({
      providers: [{ source: 'tomni-store', search: async () => [], uninstall }],
      ledger: await createTestActionLedger(),
      authorize: () => true,
    });

    await expect(
      broker.uninstall({
        source: 'tomni-store',
        sourceItemId: 'com.example.notes',
        region: 'VN',
        idempotencyKey: 'uninstall-notes-no-consent-1',
      })
    ).rejects.toMatchObject({ code: 'CATALOG_CONSENT_INVALID' });
    expect(uninstall).not.toHaveBeenCalled();
  });

  it('refreshes a linked App policy and blocks an active kill-switch before provider execution', async () => {
    const install = vi.fn(async () => ({
      provider: 'winget-msstore' as const,
      status: 'completed' as const,
      verification: 'verified' as const,
    }));
    const blocked = structuredClone(LINKED_APP);
    const clock = new Date('2026-07-26T00:00:00.000Z');
    blocked.review.killSwitch = true;
    const broker = createCatalogFederationBroker({
      providers: [{ source: 'microsoft-store', search: async () => [], install }],
      ledger: await createTestActionLedger(),
      linkedApps: [LINKED_APP],
      linkedAppPolicy: { refresh: async () => [blocked] },
      authorize: () => true,
      consent: {
        authorize: (request) => ({
          allowed: true,
          consent: {
            schemaVersion: 1,
            consentId: 'consent-policy-1',
            action: request.action,
            source: request.source,
            sourceItemId: request.sourceItemId,
            ...(request.region ? { region: request.region } : {}),
            grantedAt: clock.toISOString(),
            expiresAt: new Date(clock.getTime() + 60_000).toISOString(),
          },
        }),
      },
      now: () => clock,
    });

    await expect(
      broker.install({
        source: 'microsoft-store',
        sourceItemId: LINKED_APP.microsoft.productId,
        region: 'VN',
        idempotencyKey: 'microsoft-install-blocked-1',
      })
    ).rejects.toMatchObject({ code: 'LINKED_APP_BLOCKED' });
    expect(install).not.toHaveBeenCalled();
  });

  it('requires a reviewed Linked App before a Microsoft install can reach its provider', async () => {
    const install = vi.fn(async () => ({
      provider: 'winget-msstore' as const,
      status: 'completed' as const,
      verification: 'verified' as const,
    }));
    const clock = new Date('2026-07-26T00:00:00.000Z');
    const broker = createCatalogFederationBroker({
      providers: [{ source: 'microsoft-store', search: async () => [], install }],
      ledger: await createTestActionLedger(),
      authorize: () => true,
      consent: {
        authorize: (request) => ({
          allowed: true,
          consent: {
            schemaVersion: 1,
            consentId: 'consent-unreviewed-1',
            action: request.action,
            source: request.source,
            sourceItemId: request.sourceItemId,
            ...(request.region ? { region: request.region } : {}),
            grantedAt: clock.toISOString(),
            expiresAt: new Date(clock.getTime() + 60_000).toISOString(),
          },
        }),
      },
      now: () => clock,
    });

    await expect(
      broker.install({
        source: 'microsoft-store',
        sourceItemId: 'XP89DCGQ3K6VLD',
        region: 'VN',
        idempotencyKey: 'microsoft-install-unreviewed-1',
      })
    ).rejects.toMatchObject({ code: 'LINKED_APP_NOT_REVIEWED' });
    expect(install).not.toHaveBeenCalled();
  });

  it('rejects consent that is not bound to the requested region', async () => {
    const clock = new Date('2026-07-26T00:00:00.000Z');
    const install = vi.fn(async () => ({
      provider: 'tomni-package-manager' as const,
      status: 'completed' as const,
      verification: 'verified' as const,
      installedVersion: '1.0.0',
    }));
    const broker = createCatalogFederationBroker({
      providers: [{ source: 'tomni-store', search: async () => [], install }],
      ledger: await createTestActionLedger(),
      authorize: () => true,
      consent: {
        authorize: (request) => ({
          allowed: true,
          consent: {
            schemaVersion: 1,
            consentId: 'unscoped-consent-1',
            action: request.action,
            source: request.source,
            sourceItemId: request.sourceItemId,
            grantedAt: clock.toISOString(),
            expiresAt: new Date(clock.getTime() + 60_000).toISOString(),
          },
        }),
      },
      now: () => clock,
    });

    await expect(
      broker.install({
        source: 'tomni-store',
        sourceItemId: 'com.example.notes',
        region: 'VN',
        idempotencyKey: 'region-bound-consent-1',
      })
    ).rejects.toMatchObject({ code: 'CATALOG_CONSENT_INVALID' });
    expect(install).not.toHaveBeenCalled();
  });

  it('recovers an interrupted package action from provider state without reinvoking it', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-action-recovery-test-'));
    roots.push(root);
    const clock = new Date('2026-07-26T00:00:00.000Z');
    const ledger = createCatalogActionLedger({ rootDir: path.join(root, 'ledger'), now: () => clock });
    const authorization = {
      action: 'install' as const,
      source: 'tomni-store' as const,
      sourceItemId: 'com.example.notes',
    };
    const pending = await ledger.begin({
      authorization,
      region: 'VN',
      idempotencyKey: 'recover-install-notes-1',
      consent: {
        schemaVersion: 1,
        consentId: 'recover-consent-1',
        ...authorization,
        region: 'VN',
        grantedAt: clock.toISOString(),
        expiresAt: new Date(clock.getTime() + 60_000).toISOString(),
      },
      startedAt: clock.toISOString(),
    });
    await ledger.markInvoking(pending.id);
    const install = vi.fn(async () => ({
      provider: 'tomni-package-manager' as const,
      status: 'completed' as const,
      verification: 'verified' as const,
      installedVersion: '1.0.0',
    }));
    const broker = createCatalogFederationBroker({
      providers: [
        {
          source: 'tomni-store',
          search: async () => [],
          install,
          reconcile: async () => ({
            state: 'satisfied',
            result: {
              provider: 'tomni-package-manager',
              status: 'completed',
              verification: 'verified',
              installedVersion: '1.0.0',
            },
          }),
        },
      ],
      ledger,
      authorize: () => true,
      now: () => clock,
      randomId: () => 'recovered-operation-1',
    });

    const report = await broker.recoverPendingActions();
    const persisted = await ledger.findByIdempotencyKey('recover-install-notes-1');

    expect(report.recovered).toEqual([
      expect.objectContaining({ operationId: 'recovery:recovered-operation-1', installedVersion: '1.0.0' }),
    ]);
    expect(install).not.toHaveBeenCalled();
    expect(persisted).toMatchObject({ state: 'completed', receipt: { verification: 'verified' } });
  });
});

describe('Windows Microsoft Store adapter', () => {
  it('passes the complete search text as one argv value without a shell', async () => {
    const calls: Array<{ executable: string; args: readonly string[] }> = [];
    const runFile: SafeFileRunner = async (executable, args) => {
      calls.push({ executable, args });
      return {
        stdout:
          'Name                Id             Version\n------------------------------------------\nMicrosoft PowerToys XP89DCGQ3K6VLD Unknown\n',
        stderr: '',
      };
    };
    const adapter = createWindowsMicrosoftStoreAdapter({ runFile, openExternal: vi.fn() });

    const hits = await adapter.search('PowerToys; Remove-Item C:\\data', 3);

    expect(calls[0]).toEqual({
      executable: 'winget',
      args: [
        'search',
        '--source',
        'msstore',
        '--query',
        'PowerToys; Remove-Item C:\\data',
        '--count',
        '3',
        '--accept-source-agreements',
        '--disable-interactivity',
      ],
    });
    expect(hits).toEqual([{ productId: 'XP89DCGQ3K6VLD', name: 'Microsoft PowerToys' }]);
  });

  it('installs through WinGet and verifies package identity before returning success', async () => {
    const calls: Array<{ executable: string; args: readonly string[]; env?: Readonly<Record<string, string>> }> = [];
    const runFile: SafeFileRunner = async (executable, args, options) => {
      calls.push({ executable, args, env: options.env });
      if (executable === 'winget') return { stdout: '', stderr: '' };
      return {
        stdout: JSON.stringify({
          packageFamilyName: LINKED_APP.microsoft.packageFamilyName,
          publisherIdentity: LINKED_APP.microsoft.publisherIdentity,
          version: '1.4.2.0',
        }),
        stderr: '',
      };
    };
    const adapter = createWindowsMicrosoftStoreAdapter({ runFile, openExternal: vi.fn() });

    const identity = await adapter.installLinked(LINKED_APP, 'VN');

    expect(calls[0]?.args).toEqual([
      'install',
      '--id',
      'XP89DCGQ3K6VLD',
      '--source',
      'msstore',
      '--exact',
      '--accept-package-agreements',
      '--accept-source-agreements',
      '--disable-interactivity',
    ]);
    expect(calls[1]).toMatchObject({
      executable: 'powershell.exe',
      env: { TOMNI_LINKED_APP_PFN: LINKED_APP.microsoft.packageFamilyName },
    });
    expect(identity.version).toBe('1.4.2.0');
  });

  it('fails closed when the installed publisher does not match the reviewed link', async () => {
    const runFile: SafeFileRunner = async (executable) =>
      executable === 'winget'
        ? { stdout: '', stderr: '' }
        : {
            stdout: JSON.stringify({
              packageFamilyName: LINKED_APP.microsoft.packageFamilyName,
              publisherIdentity: 'CN=Unexpected Publisher',
              version: '1.4.2.0',
            }),
            stderr: '',
          };
    const adapter = createWindowsMicrosoftStoreAdapter({ runFile, openExternal: vi.fn() });

    await expect(adapter.installLinked(LINKED_APP, 'VN')).rejects.toMatchObject({
      code: 'LINKED_APP_IDENTITY_MISMATCH',
    });
  });

  it('rejects a Microsoft product ID that could be interpreted as extra command text', () => {
    const invalid = structuredClone(LINKED_APP);
    invalid.microsoft.productId = 'XP89DCGQ3K6VLD --source evil';

    expect(() => parseLinkedMicrosoftAppRecord(invalid)).toThrow(CatalogFederationError);
  });

  it('delegates an unlinked product to the official Store page without claiming verification', async () => {
    const adapter = microsoftAdapter(async () => []);
    const broker = createCatalogFederationBroker({
      providers: [createMicrosoftStoreCatalogProvider(adapter)],
      authorize: () => true,
      randomId: () => 'operation-1',
      now: () => new Date('2026-07-26T00:00:00.000Z'),
    });

    const receipt = await broker.openStorePage({
      source: 'microsoft-store',
      sourceItemId: 'XP89DCGQ3K6VLD',
    });

    expect(adapter.openStoreProduct).toHaveBeenCalledWith('XP89DCGQ3K6VLD');
    expect(receipt).toMatchObject({
      operationId: 'operation-1',
      provider: 'store-uri',
      status: 'delegated-to-store',
      verification: 'not-applicable',
    });
  });
});

describe('trusted Microsoft Store native IPC', () => {
  type Sender = { id: string; trusted: boolean };
  type Handler = (sender: Sender, payload: unknown) => Promise<MicrosoftStoreNativeResult<unknown>>;

  const createHarness = (overrides?: {
    installLinked?: () => Promise<never>;
    loadLinkedApp?: (linkedAppId: string) => Promise<LinkedMicrosoftAppRecord | undefined>;
    confirmAction?: () => boolean | Promise<boolean>;
  }) => {
    const handlers = new Map<string, Handler>();
    const identity = {
      packageFamilyName: LINKED_APP.microsoft.packageFamilyName,
      publisherIdentity: LINKED_APP.microsoft.publisherIdentity,
      version: '1.4.2.0',
    };
    const adapter = {
      search: vi.fn(),
      installLinked: overrides?.installLinked ?? vi.fn(async () => identity),
      launchLinked: vi.fn(async () => identity),
      openStoreProduct: vi.fn(),
    };
    const loadLinkedApp = vi.fn(
      overrides?.loadLinkedApp ??
        (async (linkedAppId: string) => (linkedAppId === LINKED_APP.id ? LINKED_APP : undefined))
    );
    const confirmAction = vi.fn(overrides?.confirmAction ?? (() => true));
    const runtime = createMicrosoftStoreNativeRuntime({
      adapter,
      consent: createCatalogActionConsentAuthority({ randomId: () => 'native-consent-1' }),
      loadLinkedApp,
      confirmAction,
      createReceiptId: () => 'native-receipt-1',
    });
    const dispose = registerTrustedMicrosoftStoreNativeIpcBridge({
      host: {
        handle: (channel, handler) => handlers.set(channel, handler),
        removeHandler: (channel) => handlers.delete(channel),
      },
      runtime,
      verifySender: (sender) => sender.trusted,
      identifySender: (sender) => `electron:${sender.id}`,
    });
    return { adapter, confirmAction, dispose, handlers, loadLinkedApp };
  };

  const consentPayload = (action: 'install' | 'launch' = 'install') => ({
    action,
    linkedAppId: LINKED_APP.id,
    region: 'VN',
    idempotencyKey: `${action}-request-1`,
  });

  it('registers the exact native channels and rejects uninstall before runtime invocation', async () => {
    const harness = createHarness();
    const requestConsent = harness.handlers.get(MICROSOFT_STORE_NATIVE_CHANNELS.requestConsent)!;

    const result = await requestConsent({ id: '1', trusted: true }, { ...consentPayload(), action: 'uninstall' });

    expect([...harness.handlers.keys()].toSorted()).toEqual(Object.values(MICROSOFT_STORE_NATIVE_CHANNELS).toSorted());
    expect(result).toEqual({ ok: false, code: 'MICROSOFT_STORE_REQUEST_INVALID' });
    expect(harness.adapter.installLinked).not.toHaveBeenCalled();
    harness.dispose();
  });

  it('opens a validated Microsoft Store product only for a trusted sender', async () => {
    const harness = createHarness();
    const openStorePage = harness.handlers.get(MICROSOFT_STORE_NATIVE_CHANNELS.openStorePage)!;

    const result = await openStorePage({ id: '1', trusted: true }, { productId: 'xp89dcgq3k6vld' });

    expect(result).toEqual({ ok: true, data: { productId: 'XP89DCGQ3K6VLD' } });
    expect(harness.adapter.openStoreProduct).toHaveBeenCalledWith('XP89DCGQ3K6VLD');
    harness.dispose();
  });

  it('rejects untrusted or malformed requests before opening Microsoft Store', async () => {
    const harness = createHarness();
    const openStorePage = harness.handlers.get(MICROSOFT_STORE_NATIVE_CHANNELS.openStorePage)!;

    const untrusted = await openStorePage({ id: '1', trusted: false }, { productId: 'XP89DCGQ3K6VLD' });
    const malformed = await openStorePage({ id: '1', trusted: true }, { productId: 'not a product id' });

    expect(untrusted).toEqual({ ok: false, code: 'MICROSOFT_STORE_SENDER_UNTRUSTED' });
    expect(malformed).toEqual({ ok: false, code: 'MICROSOFT_STORE_REQUEST_INVALID' });
    expect(harness.adapter.openStoreProduct).not.toHaveBeenCalled();
    harness.dispose();
  });

  it('rejects an untrusted sender before granting consent', async () => {
    const harness = createHarness();
    const requestConsent = harness.handlers.get(MICROSOFT_STORE_NATIVE_CHANNELS.requestConsent)!;

    const result = await requestConsent({ id: '1', trusted: false }, consentPayload());

    expect(result).toEqual({ ok: false, code: 'MICROSOFT_STORE_SENDER_UNTRUSTED' });
    expect(harness.adapter.installLinked).not.toHaveBeenCalled();
    harness.dispose();
  });

  it('rejects renderer-supplied policy records and consent decisions before consulting main authority', async () => {
    const harness = createHarness();
    const requestConsent = harness.handlers.get(MICROSOFT_STORE_NATIVE_CHANNELS.requestConsent)!;

    const result = await requestConsent(
      { id: '1', trusted: true },
      { ...consentPayload(), record: LINKED_APP, confirmed: true }
    );

    expect(result).toEqual({ ok: false, code: 'MICROSOFT_STORE_REQUEST_INVALID' });
    expect(harness.loadLinkedApp).not.toHaveBeenCalled();
    expect(harness.confirmAction).not.toHaveBeenCalled();
    harness.dispose();
  });

  it('fails closed when the main-process consent authority denies the reviewed app action', async () => {
    const harness = createHarness({ confirmAction: () => false });
    const requestConsent = harness.handlers.get(MICROSOFT_STORE_NATIVE_CHANNELS.requestConsent)!;

    const result = await requestConsent({ id: '1', trusted: true }, consentPayload());

    expect(result).toEqual({ ok: false, code: 'MICROSOFT_STORE_CONSENT_DENIED' });
    expect(harness.loadLinkedApp).toHaveBeenCalledWith(LINKED_APP.id);
    expect(harness.adapter.installLinked).not.toHaveBeenCalled();
    harness.dispose();
  });

  it('launches only after matching consent from the same owner', async () => {
    const harness = createHarness();
    const requestConsent = harness.handlers.get(MICROSOFT_STORE_NATIVE_CHANNELS.requestConsent)!;
    const execute = harness.handlers.get(MICROSOFT_STORE_NATIVE_CHANNELS.execute)!;
    const sender = { id: '1', trusted: true };
    const payload = consentPayload('launch');
    const grant = await requestConsent(sender, payload);
    if (!grant.ok) throw new Error('Expected consent grant');

    const result = await execute(sender, {
      ...payload,
      consentId: (grant.data as { consentId: string }).consentId,
    });

    expect(result).toMatchObject({
      ok: true,
      data: { receiptId: 'native-receipt-1', identity: { version: '1.4.2.0' } },
    });
    expect(harness.adapter.launchLinked).toHaveBeenCalledWith(LINKED_APP, 'VN');
    harness.dispose();
  });

  it('binds launch consent to the WebContents-derived owner', async () => {
    const harness = createHarness();
    const requestConsent = harness.handlers.get(MICROSOFT_STORE_NATIVE_CHANNELS.requestConsent)!;
    const execute = harness.handlers.get(MICROSOFT_STORE_NATIVE_CHANNELS.execute)!;
    const payload = consentPayload('launch');
    const grant = await requestConsent({ id: '1', trusted: true }, payload);
    if (!grant.ok) throw new Error('Expected consent grant');

    const denied = await execute(
      { id: '2', trusted: true },
      { ...payload, consentId: (grant.data as { consentId: string }).consentId }
    );

    expect(denied).toEqual({ ok: false, code: 'MICROSOFT_STORE_CONSENT_DENIED' });
    expect(harness.adapter.launchLinked).not.toHaveBeenCalled();
    harness.dispose();
  });

  it('coalesces concurrent and completed replays into one stable execution receipt', async () => {
    const harness = createHarness();
    const requestConsent = harness.handlers.get(MICROSOFT_STORE_NATIVE_CHANNELS.requestConsent)!;
    const execute = harness.handlers.get(MICROSOFT_STORE_NATIVE_CHANNELS.execute)!;
    const sender = { id: '1', trusted: true };
    const payload = consentPayload();
    const grant = await requestConsent(sender, payload);
    if (!grant.ok) throw new Error('Expected consent grant');
    const request = { ...payload, consentId: (grant.data as { consentId: string }).consentId };

    const [first, concurrent] = await Promise.all([execute(sender, request), execute(sender, request)]);
    const replay = await execute(sender, request);

    expect(first).toEqual(concurrent);
    expect(replay).toEqual(first);
    expect(harness.adapter.installLinked).toHaveBeenCalledTimes(1);
    harness.dispose();
  });

  it('refuses execution when the main-process linked app policy changes after consent', async () => {
    let policyReads = 0;
    const harness = createHarness({
      loadLinkedApp: async () => {
        policyReads += 1;
        return policyReads === 1 ? LINKED_APP : { ...LINKED_APP, review: { ...LINKED_APP.review, killSwitch: true } };
      },
    });
    const requestConsent = harness.handlers.get(MICROSOFT_STORE_NATIVE_CHANNELS.requestConsent)!;
    const execute = harness.handlers.get(MICROSOFT_STORE_NATIVE_CHANNELS.execute)!;
    const sender = { id: '1', trusted: true };
    const payload = consentPayload();
    const grant = await requestConsent(sender, payload);
    if (!grant.ok) throw new Error('Expected consent grant');

    const result = await execute(sender, {
      ...payload,
      consentId: (grant.data as { consentId: string }).consentId,
    });

    expect(result).toEqual({ ok: false, code: 'MICROSOFT_STORE_CONSENT_DENIED' });
    expect(harness.loadLinkedApp).toHaveBeenCalledTimes(2);
    expect(harness.adapter.installLinked).not.toHaveBeenCalled();
    harness.dispose();
  });

  it('rejects an idempotency-key collision without invoking a second native action', async () => {
    const harness = createHarness();
    const requestConsent = harness.handlers.get(MICROSOFT_STORE_NATIVE_CHANNELS.requestConsent)!;
    const execute = harness.handlers.get(MICROSOFT_STORE_NATIVE_CHANNELS.execute)!;
    const sender = { id: '1', trusted: true };
    const payload = consentPayload();
    const grant = await requestConsent(sender, payload);
    if (!grant.ok) throw new Error('Expected consent grant');
    const request = { ...payload, consentId: (grant.data as { consentId: string }).consentId };
    await execute(sender, request);

    const collision = await execute(sender, { ...request, region: 'US' });

    expect(collision).toEqual({ ok: false, code: 'MICROSOFT_STORE_REQUEST_INVALID' });
    expect(harness.adapter.installLinked).toHaveBeenCalledTimes(1);
    harness.dispose();
  });

  it('redacts native adapter failures after valid owner-bound consent', async () => {
    const harness = createHarness({
      installLinked: async () => {
        throw new Error('C:\\Users\\private\\winget.log');
      },
    });
    const requestConsent = harness.handlers.get(MICROSOFT_STORE_NATIVE_CHANNELS.requestConsent)!;
    const execute = harness.handlers.get(MICROSOFT_STORE_NATIVE_CHANNELS.execute)!;
    const sender = { id: '1', trusted: true };
    const payload = consentPayload();
    const grant = await requestConsent(sender, payload);
    if (!grant.ok) throw new Error('Expected consent grant');

    const result = await execute(sender, {
      ...payload,
      consentId: (grant.data as { consentId: string }).consentId,
    });

    expect(result).toEqual({ ok: false, code: 'MICROSOFT_STORE_ACTION_FAILED' });
    expect(JSON.stringify(result)).not.toContain('private');
    harness.dispose();
  });
});
