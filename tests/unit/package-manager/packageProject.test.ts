import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePackageManifest, type PackageCatalogEntry } from '@/common/packages';
import { verifyArtifactSignature } from '@process/extensions/package-manager/artifactSecurity';
import { buildPackageProject } from '../../../scripts/package-apps/packageProject';

import { loadPublishCatalog, mergePublishCatalog } from '../../../scripts/package-apps/publishCatalog';
import {
  assertPublicStoreVisibility,
  assertPublishCatalogUnchanged,
  assertStorePublisherAuthorized,
  computePublishCatalogIdentity,
  createStagedReleaseAssetName,
  parseStorePublisherOwners,
  PUBLISH_LOCK_ASSET_NAME,
  publishStagedRelease,
  selectOwnedPublishLockAsset,
  selectOwnedReleaseAsset,
  withPublishLock,
} from '../../../scripts/package-apps/publishConcurrency';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const createProject = async (entrypoint = 'index.html') => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-package-project-'));
  roots.push(root);
  await mkdir(path.join(root, 'payload'));
  await writeFile(
    path.join(root, 'tomny-package.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'com.example.demo',
      publisherId: 'com.example',
      name: 'Demo',
      description: 'Demo package',
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=0.0.0' },
      modules: [
        {
          id: 'main',
          title: 'Demo',
          surface: 'apps/demo',
          pinnable: true,
          runtime: 'sandboxed-web',
          entrypoint,
        },
      ],
      permissions: [],
      dependencies: [],
      tags: ['demo'],
    })
  );
  await writeFile(path.join(root, 'payload', 'index.html'), '<!doctype html><title>Demo</title>');
  return root;
};

describe('package project builder', () => {
  it('creates a signed compressed artifact with its runnable payload', async () => {
    const projectDirectory = await createProject();
    const keys = generateKeyPairSync('ed25519');
    const keyPath = path.join(projectDirectory, 'private.pem');
    await writeFile(keyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const result = await buildPackageProject({
      projectDirectory,
      outputDirectory: path.join(projectDirectory, 'output'),
      privateKeyPath: keyPath,
      keyId: 'test-key',
    });

    const archive = await JSZip.loadAsync(
      await import('node:fs/promises').then(({ readFile }) => readFile(result.artifactPath))
    );
    const manifest = parsePackageManifest(
      JSON.parse(await archive.file('tomny-package.json')!.async('string')) as unknown
    );
    verifyArtifactSignature(manifest, {
      'test-key': keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    });
    expect(await archive.file('index.html')?.async('string')).toContain('<title>Demo</title>');
  });

  it('rejects a manifest whose declared entrypoint is missing', async () => {
    const projectDirectory = await createProject('missing.html');
    const keys = generateKeyPairSync('ed25519');
    const keyPath = path.join(projectDirectory, 'private.pem');
    await writeFile(keyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));

    await expect(
      buildPackageProject({
        projectDirectory,
        outputDirectory: path.join(projectDirectory, 'output'),
        privateKeyPath: keyPath,
        keyId: 'test-key',
      })
    ).rejects.toThrow(/entrypoint is missing/i);
  });
});

const publishEntry = (
  id: string,
  version: string,
  integrity = `sha256-${id}-${version}`,
  artifactUrl = `https://store.example/${id}-${version}.tomny`
): PackageCatalogEntry =>
  ({
    delivery: 'downloaded-package',
    trust: 'signed-store',
    artifactUrl,
    manifest: {
      id,
      name: id,
      publisherId: id.split('.').slice(0, 2).join('.'),
      version,
      artifact: {
        integrity,
        sizeBytes: 1,
        signature: { algorithm: 'ed25519', keyId: 'store-test', value: `signature-${integrity}` },
      },
    },
  }) as PackageCatalogEntry;

const missingCatalogFetcher = async (): Promise<Response> => new Response('', { status: 404 });
const unexpectedCatalogFetcher = async (): Promise<Response> => {
  throw new Error('must not fetch');
};

describe('Store publish catalog safety', () => {
  it('lets only one concurrent publisher hold the remote release lock', async () => {
    let held = false;
    let signalEntered: (() => void) | undefined;
    let continueFirst: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      continueFirst = resolve;
    });
    const adapter = {
      acquire: async (): Promise<void> => {
        if (held) throw new Error('publish lock conflict');
        held = true;
      },
      release: async (): Promise<void> => {
        held = false;
      },
    };

    const first = withPublishLock(adapter, async () => {
      signalEntered?.();
      await blocked;
      return 'first';
    });
    await entered;
    const concurrentOutcome = await withPublishLock(adapter, async () => 'second').catch((error: unknown) => error);

    expect(concurrentOutcome).toBeInstanceOf(Error);
    expect(held).toBe(true);

    continueFirst?.();
    await expect(first).resolves.toBe('first');
    expect(held).toBe(false);
  });

  it('releases the remote lock after the publish operation fails', async () => {
    let held = false;
    const adapter = {
      acquire: async (): Promise<void> => {
        held = true;
      },
      release: async (): Promise<void> => {
        held = false;
      },
    };

    await expect(
      withPublishLock(adapter, async () => {
        throw new Error('catalog upload failed');
      })
    ).rejects.toThrow(/catalog upload failed/i);
    expect(held).toBe(false);
  });

  it('releases only the immutable lease returned by acquisition', async () => {
    let currentAssetId: number | undefined = 101;
    const releasedAssetIds: number[] = [];
    const adapter = {
      acquire: async (): Promise<number> => currentAssetId!,
      release: async (assetId: number): Promise<void> => {
        releasedAssetIds.push(assetId);
        if (currentAssetId === assetId) currentAssetId = undefined;
      },
    };

    await withPublishLock(adapter, async () => {
      currentAssetId = 202;
    });

    expect(releasedAssetIds).toEqual([101]);
    expect(currentAssetId).toBe(202);
  });

  it('accepts only the uploaded lock asset whose immutable metadata matches this publisher', () => {
    const expected = {
      id: 101,
      name: PUBLISH_LOCK_ASSET_NAME,
      state: 'uploaded',
      size: 128,
      digest: `sha256:${'a'.repeat(64)}`,
    };

    expect(selectOwnedPublishLockAsset({ assets: [expected] }, expected.digest, expected.size)).toEqual({
      assetId: expected.id,
    });
    expect(() =>
      selectOwnedPublishLockAsset(
        {
          assets: [{ ...expected, id: 202, digest: `sha256:${'b'.repeat(64)}` }],
        },
        expected.digest,
        expected.size
      )
    ).toThrow(/does not belong/i);
    expect(() =>
      selectOwnedPublishLockAsset(
        {
          assets: [expected, { ...expected, id: 202 }],
        },
        expected.digest,
        expected.size
      )
    ).toThrow(/exactly one/i);
  });

  it('stages, verifies, promotes, then makes the package discoverable only through the catalog commit', async () => {
    const events: string[] = [];

    await publishStagedRelease({
      stageArtifact: async () => {
        events.push('stage');
      },
      verifyStagedArtifact: async () => {
        events.push('verify-stage');
      },
      promoteArtifact: async () => {
        events.push('promote');
      },
      verifyPromotedArtifact: async () => {
        events.push('verify-promoted');
      },
      publishCatalog: async () => {
        events.push('catalog');
      },
      catalogMayBeVisibleAfterFailure: async () => false,
      discardStagedArtifact: async () => {
        events.push('discard-stage');
      },
      discardPromotedArtifact: async () => {
        events.push('discard-promoted');
      },
    });

    expect(events).toEqual(['stage', 'verify-stage', 'promote', 'verify-promoted', 'catalog', 'discard-stage']);
  });

  it('removes the staging bytes when server-side stage verification rejects them', async () => {
    const events: string[] = [];

    await expect(
      publishStagedRelease({
        stageArtifact: async () => {
          events.push('stage');
        },
        verifyStagedArtifact: async () => {
          throw new Error('stage digest mismatch');
        },
        promoteArtifact: async () => {
          events.push('promote');
        },
        verifyPromotedArtifact: async () => undefined,
        publishCatalog: async () => undefined,
        catalogMayBeVisibleAfterFailure: async () => false,
        discardStagedArtifact: async () => {
          events.push('discard-stage');
        },
        discardPromotedArtifact: async () => {
          events.push('discard-promoted');
        },
      })
    ).rejects.toThrow(/stage digest mismatch/i);

    expect(events).toEqual(['stage', 'discard-stage']);
  });

  it('rolls back both promoted and staging bytes when the catalog commit is known not to be visible', async () => {
    const events: string[] = [];

    await expect(
      publishStagedRelease({
        stageArtifact: async () => {
          events.push('stage');
        },
        verifyStagedArtifact: async () => {
          events.push('verify-stage');
        },
        promoteArtifact: async () => {
          events.push('promote');
        },
        verifyPromotedArtifact: async () => {
          events.push('verify-promoted');
        },
        publishCatalog: async () => {
          throw new Error('catalog upload failed');
        },
        catalogMayBeVisibleAfterFailure: async () => false,
        discardStagedArtifact: async () => {
          events.push('discard-stage');
        },
        discardPromotedArtifact: async () => {
          events.push('discard-promoted');
        },
      })
    ).rejects.toThrow(/catalog upload failed/i);

    expect(events).toEqual([
      'stage',
      'verify-stage',
      'promote',
      'verify-promoted',
      'discard-promoted',
      'discard-stage',
    ]);
  });

  it('retains promoted bytes when a failed catalog request could already be visible', async () => {
    const events: string[] = [];

    await expect(
      publishStagedRelease({
        stageArtifact: async () => {
          events.push('stage');
        },
        verifyStagedArtifact: async () => undefined,
        promoteArtifact: async () => {
          events.push('promote');
        },
        verifyPromotedArtifact: async () => undefined,
        publishCatalog: async () => {
          throw new Error('catalog transport interrupted');
        },
        catalogMayBeVisibleAfterFailure: async () => true,
        discardStagedArtifact: async () => {
          events.push('discard-stage');
        },
        discardPromotedArtifact: async () => {
          events.push('discard-promoted');
        },
      })
    ).rejects.toThrow(/cleanup is incomplete/i);

    expect(events).toEqual(['stage', 'promote', 'discard-stage']);
  });

  it('accepts only server metadata for the exact staged asset bytes', () => {
    const expected = {
      id: 202,
      name: 'tomni-stage-0123456789abcdef0123456789abcdef-com.example.demo-1.0.0.tomny',
      state: 'uploaded',
      size: 512,
      digest: `sha256:${'c'.repeat(64)}`,
    };

    expect(selectOwnedReleaseAsset({ assets: [expected] }, expected)).toEqual({ assetId: 202 });
  });

  it('accepts the declared publisher owner with writable repository permission', () => {
    const publisherOwners = parseStorePublisherOwners(JSON.stringify({ 'com.example': 'release-bot' }));

    expect(() => {
      assertPublicStoreVisibility(undefined);
      assertStorePublisherAuthorized(
        { publisherId: 'com.example' },
        { login: 'Release-Bot', repositoryPermission: 'maintain' },
        publisherOwners
      );
    }).not.toThrow();
  });

  it('rejects a private target and publishers that the authenticated repository writer does not own', () => {
    const publisherOwners = parseStorePublisherOwners(JSON.stringify({ 'com.example': 'release-bot' }));

    expect(() => assertPublicStoreVisibility('private')).toThrow(/not supported/i);
    expect(() =>
      assertStorePublisherAuthorized(
        { publisherId: 'com.example' },
        { login: 'other-release-bot', repositoryPermission: 'write' },
        publisherOwners
      )
    ).toThrow(/does not own/i);
  });

  it('derives an opaque staging filename from the final deterministic asset name', () => {
    expect(createStagedReleaseAssetName('com.example.demo-1.0.0.tomny', '01234567-89ab-cdef-0123-456789abcdef')).toBe(
      'tomni-stage-0123456789abcdef0123456789abcdef-com.example.demo-1.0.0.tomny'
    );
  });

  it('uses an order-independent catalog identity and fails a stale publisher', () => {
    const first = publishEntry('com.example.first', '1.0.0');
    const second = publishEntry('com.example.second', '1.0.0');
    const expectedIdentity = computePublishCatalogIdentity([first, second]);

    expect(computePublishCatalogIdentity([second, first])).toBe(expectedIdentity);
    expect(() => assertPublishCatalogUnchanged(expectedIdentity, [second, first])).not.toThrow();
    expect(() =>
      assertPublishCatalogUnchanged(expectedIdentity, [second, publishEntry('com.example.first', '2.0.0')])
    ).toThrow(/lost update/i);
  });

  it('loads and verifies the authoritative catalog before publishing', async () => {
    const current = publishEntry('com.example.current', '1.0.0');
    let parsedValue: unknown;
    const packages = await loadPublishCatalog({
      url: 'https://store.example/catalog.json',
      bootstrap: false,
      fetcher: async () => new Response(JSON.stringify({ packages: [current] })),
      parse: (value) => {
        parsedValue = value;
        return { packages: [current] };
      },
    });

    expect(parsedValue).toEqual({ packages: [current] });
    expect(packages).toEqual([current]);
  });

  it('rejects an insecure or credential-bearing catalog URL before fetching', async () => {
    await expect(
      loadPublishCatalog({
        url: 'http://store.example/catalog.json',
        bootstrap: false,
        fetcher: unexpectedCatalogFetcher,
        parse: () => ({ packages: [] }),
      })
    ).rejects.toThrow(/credential-free HTTPS/i);
    await expect(
      loadPublishCatalog({
        url: 'https://user:secret@store.example/catalog.json',
        bootstrap: false,
        fetcher: unexpectedCatalogFetcher,
        parse: () => ({ packages: [] }),
      })
    ).rejects.toThrow(/credential-free HTTPS/i);
  });

  it('fails closed when the catalog cannot be reached or returns a non-missing error', async () => {
    await expect(
      loadPublishCatalog({
        url: 'https://store.example/catalog.json',
        bootstrap: false,
        fetcher: async () => {
          throw new Error('offline');
        },
        parse: () => ({ packages: [] }),
      })
    ).rejects.toThrow(/could not be reached/i);
    await expect(
      loadPublishCatalog({
        url: 'https://store.example/catalog.json',
        bootstrap: true,
        fetcher: async () => new Response('', { status: 403 }),
        parse: () => ({ packages: [] }),
      })
    ).rejects.toThrow(/HTTP 403/);
  });

  it('allows an empty catalog only for an explicit bootstrap against exact HTTP 404', async () => {
    await expect(
      loadPublishCatalog({
        url: 'https://store.example/catalog.json',
        bootstrap: false,
        fetcher: missingCatalogFetcher,
        parse: () => ({ packages: [] }),
      })
    ).rejects.toThrow(/HTTP 404/);
    await expect(
      loadPublishCatalog({
        url: 'https://store.example/catalog.json',
        bootstrap: true,
        fetcher: missingCatalogFetcher,
        parse: () => ({ packages: [] }),
      })
    ).resolves.toEqual([]);
  });

  it('rejects redirect downgrade and does not bootstrap from a redirected 404', async () => {
    await expect(
      loadPublishCatalog({
        url: 'https://store.example/catalog.json',
        bootstrap: false,
        fetcher: async () =>
          new Response(null, { status: 302, headers: { location: 'http://mirror.example/catalog.json' } }),
        parse: () => ({ packages: [] }),
      })
    ).rejects.toThrow(/credential-free HTTPS/i);

    let requestCount = 0;
    await expect(
      loadPublishCatalog({
        url: 'https://store.example/catalog.json',
        bootstrap: true,
        fetcher: async () => {
          requestCount += 1;
          return requestCount === 1
            ? new Response(null, { status: 302, headers: { location: 'https://mirror.example/catalog.json' } })
            : new Response('', { status: 404 });
        },
        parse: () => ({ packages: [] }),
      })
    ).rejects.toThrow(/redirected.*404|HTTP 404/i);
  });

  it('fails closed for malformed or untrusted catalog content', async () => {
    await expect(
      loadPublishCatalog({
        url: 'https://store.example/catalog.json',
        bootstrap: false,
        fetcher: async () => new Response('{not-json'),
        parse: () => ({ packages: [] }),
      })
    ).rejects.toThrow(/invalid or untrusted/i);
    await expect(
      loadPublishCatalog({
        url: 'https://store.example/catalog.json',
        bootstrap: false,
        fetcher: async () => new Response('{}'),
        parse: () => {
          throw new Error('forged signature');
        },
      })
    ).rejects.toThrow(/invalid or untrusted/i);
  });

  it('preserves unrelated entries while replacing only the published package', () => {
    const unrelated = publishEntry('com.example.unrelated', '3.0.0');
    const previous = publishEntry('com.example.target', '1.0.0');
    const next = publishEntry('com.example.target', '2.0.0');

    expect(mergePublishCatalog([unrelated, previous], next)).toEqual([next, unrelated]);
  });

  it('rejects downgrade, same-version byte mutation, and cross-package artifact URL conflicts', () => {
    const current = publishEntry('com.example.target', '2.0.0');
    const publisherTakeover = publishEntry('com.example.target', '3.0.0');
    publisherTakeover.manifest.publisherId = 'org.attacker';
    expect(() => mergePublishCatalog([current], publisherTakeover)).toThrow(/publisher/i);

    expect(() => mergePublishCatalog([current], publishEntry('com.example.target', '1.0.0'))).toThrow(/older/);
    expect(() => mergePublishCatalog([current], publishEntry('com.example.target', '2.0.0', 'sha256-mutated'))).toThrow(
      /immutable/
    );
    expect(() =>
      mergePublishCatalog([current], publishEntry('com.example.other', '1.0.0', 'sha256-other', current.artifactUrl))
    ).toThrow(/artifact URL.*already belongs/i);
    expect(() =>
      mergePublishCatalog(
        [current],
        publishEntry(
          'com.example.other',
          '1.0.0',
          'sha256-other',
          current.artifactUrl?.replace('https://store.example/', 'https://store.example:443/')
        )
      )
    ).toThrow(/artifact URL.*already belongs/i);
    expect(() =>
      mergePublishCatalog(
        [publishEntry('com.example.target', '2.0.0+build.1')],
        publishEntry('com.example.target', '2.0.0+build.2', 'sha256-mutated')
      )
    ).toThrow(/immutable/i);
    expect(() =>
      mergePublishCatalog([current], publishEntry('com.example.target', '3.0.0', 'sha256-next', current.artifactUrl))
    ).toThrow(/unique artifact filename/i);
  });
});
