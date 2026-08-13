import { describe, expect, it } from 'vitest';
import {
  isPackageCompatible,
  packageSignaturePayload,
  parsePackageAppGroupDocument,
  parsePackageAppGroupCreateRequest,
  parsePackageManifest,
  resolvePackageDependencies,
  resolvePackageDependencyResult,
  resolvePackageAppGroup,
} from '@/common/packages';

const validManifest = {
  schemaVersion: 1,
  id: 'com.tomni.example',
  publisherId: 'com.tomni',
  name: 'Example',
  description: 'Example package',
  type: 'app',
  bundleKind: 'single',
  version: '1.2.3',
  engines: { tomni: '>=1.0.0 <2.0.0' },
  modules: [{ id: 'main', title: 'Main', surface: 'example/main', pinnable: true }],
  permissions: ['workspace.read'],
  dependencies: [],
  tags: ['example'],
} as const;

describe('package manifest validation', () => {
  it('keeps user-created app groups outside package manifests and preserves core versus optional members', () => {
    const document = parsePackageAppGroupDocument({
      schemaVersion: 1,
      groups: [
        {
          id: 'studio',
          name: 'Studio',
          members: [
            { packageId: 'com.tomni.ide', appId: 'ide', moduleId: 'ide', role: 'core' },
            { packageId: 'com.tomni.design-studio', appId: 'design', moduleId: 'design', role: 'optional' },
          ],
        },
      ],
    });

    expect(document.groups[0]?.name).toBe('Studio');
    expect(() => parsePackageManifest({ ...validManifest, appGroups: document.groups })).toThrow();
    expect(
      resolvePackageAppGroup(document.groups[0]!, [
        { packageId: 'com.tomni.ide', appId: 'ide', moduleId: 'ide' },
      ]).members
    ).toEqual([
      { packageId: 'com.tomni.ide', appId: 'ide', moduleId: 'ide', role: 'core', availability: 'ready' },
      {
        packageId: 'com.tomni.design-studio',
        appId: 'design',
        moduleId: 'design',
        role: 'optional',
        availability: 'missing',
      },
    ]);
  });

  it('rejects duplicate app identities inside a user-created app group', () => {
    expect(() =>
      parsePackageAppGroupDocument({
        schemaVersion: 1,
        groups: [
          {
            id: 'studio',
            name: 'Studio',
            members: [
              { packageId: 'com.tomni.ide', appId: 'ide', moduleId: 'ide', role: 'core' },
              { packageId: 'com.tomni.ide', appId: 'ide', moduleId: 'ide', role: 'optional' },
            ],
          },
        ],
      })
    ).toThrow(/unique package\/app\/module identities/i);
  });

  it('rejects reserved workspace keys and oversized identifiers at the app-group boundary', () => {
    expect(() =>
      parsePackageAppGroupCreateRequest({
        scope: { kind: 'workspace', workspaceId: 'constructor' },
        name: 'Studio',
        members: [{ packageId: 'com.tomni.ide', appId: 'ide', moduleId: 'ide', role: 'core' }],
      })
    ).toThrow(/reserved/i);
    expect(() =>
      parsePackageAppGroupCreateRequest({
        scope: { kind: 'user' },
        name: 'Studio',
        members: [{ packageId: `com.tomni.${'a'.repeat(200)}`, appId: 'ide', moduleId: 'ide', role: 'core' }],
      })
    ).toThrow();
  });

  it('accepts a versioned app package contract', () => {
    expect(parsePackageManifest(validManifest).id).toBe('com.tomni.example');
  });

  it('requires every declared permission to use one canonical, unique identifier', () => {
    expect(() =>
      parsePackageManifest({ ...validManifest, permissions: ['workspace.read', 'workspace.read'] })
    ).toThrow('Package permissions must be unique');
    expect(() => parsePackageManifest({ ...validManifest, permissions: ['Workspace.Read'] })).toThrow();
  });

  it('rejects oversized manifest identifiers before they can be retained in package state', () => {
    expect(() => parsePackageManifest({ ...validManifest, id: `org.${'a'.repeat(200)}` })).toThrow();
    expect(() =>
      parsePackageManifest({
        ...validManifest,
        modules: [{ ...validManifest.modules[0], surface: `apps/${'a'.repeat(508)}` }],
      })
    ).toThrow();
    expect(() => parsePackageManifest({ ...validManifest, permissions: ['workspace.' + 'a'.repeat(160)] })).toThrow();
  });

  it('rejects oversized artifact declarations before catalog signature work', () => {
    const artifact = {
      integrity: `sha256-${'a'.repeat(64)}`,
      sizeBytes: 200 * 1024 * 1024 + 1,
      signature: { algorithm: 'ed25519' as const, keyId: 'test-key', value: 'a'.repeat(10_000) },
    };

    expect(() => parsePackageManifest({ ...validManifest, artifact })).toThrow();
  });

  it('accepts signed HTTPS screenshots and rejects insecure preview URLs', () => {
    const manifest = parsePackageManifest({
      ...validManifest,
      screenshots: [{ url: 'https://cdn.tomny.dev/example/preview.webp', alt: 'Example workspace' }],
    });

    expect(manifest.screenshots).toEqual([
      { url: 'https://cdn.tomny.dev/example/preview.webp', alt: 'Example workspace' },
    ]);
    expect(() =>
      parsePackageManifest({
        ...validManifest,
        screenshots: [{ url: 'http://cdn.tomny.dev/example/preview.webp' }],
      })
    ).toThrow('Expected an HTTPS URL');
  });

  it('rejects the retired capability package type', () => {
    expect(() => parsePackageManifest({ ...validManifest, type: 'capability' })).toThrow();
  });

  it('rejects self dependencies and duplicate modules', () => {
    expect(() =>
      parsePackageManifest({
        ...validManifest,
        modules: [...validManifest.modules, validManifest.modules[0]],
        dependencies: [{ id: validManifest.id, version: '*' }],
      })
    ).toThrow();
  });

  it('checks Tomni compatibility using semantic versions', () => {
    const manifest = parsePackageManifest(validManifest);
    expect(isPackageCompatible(manifest, '1.5.0')).toBe(true);
    expect(isPackageCompatible(manifest, '2.0.0')).toBe(false);
    expect(isPackageCompatible(manifest, 'not-a-version')).toBe(false);
  });

  it('resolves compatible active dependencies before their dependent package', () => {
    const core = parsePackageManifest({ ...validManifest, id: 'com.tomni.core', version: '1.1.0' });
    const runtime = parsePackageManifest({
      ...validManifest,
      id: 'org.example.runtime',
      dependencies: [{ id: core.id, version: '^1.0.0' }],
    });
    const extension = parsePackageManifest({
      ...validManifest,
      id: 'org.example.extension',
      dependencies: [{ id: runtime.id, version: '^1.0.0' }],
    });
    const candidates = new Map([
      [core.id, { manifest: core, state: 'installed' as const, enabled: true }],
      [runtime.id, { manifest: runtime, state: 'installed' as const, enabled: true }],
    ]);

    const resolution = resolvePackageDependencies(extension, (id) => candidates.get(id));

    expect(resolution.packageIds).toEqual([core.id, runtime.id]);
  });

  it('rejects an inactive transitive dependency before activation', () => {
    const core = parsePackageManifest({ ...validManifest, id: 'com.tomni.core' });
    const runtime = parsePackageManifest({
      ...validManifest,
      id: 'org.example.runtime',
      dependencies: [{ id: core.id, version: '^1.0.0' }],
    });
    const extension = parsePackageManifest({
      ...validManifest,
      id: 'org.example.extension',
      dependencies: [{ id: runtime.id, version: '^1.0.0' }],
    });
    const candidates = new Map([
      [core.id, { manifest: core, state: 'installed' as const, enabled: false }],
      [runtime.id, { manifest: runtime, state: 'installed' as const, enabled: true }],
    ]);

    expect(resolvePackageDependencyResult(extension, (id) => candidates.get(id))).toEqual({
      ok: false,
      error: { phase: 'activation', code: 'PACKAGE_DEPENDENCY_DISABLED' },
    });
  });

  it('reports a disabled installed dependency before traversing its inactive cycle', () => {
    const alpha = parsePackageManifest({
      ...validManifest,
      id: 'org.example.disabled-alpha',
      dependencies: [{ id: 'org.example.disabled-beta', version: '^1.0.0' }],
    });
    const beta = parsePackageManifest({
      ...validManifest,
      id: 'org.example.disabled-beta',
      dependencies: [{ id: alpha.id, version: '^1.0.0' }],
    });
    const candidates = new Map([
      [alpha.id, { manifest: alpha, state: 'installed' as const, enabled: true }],
      [beta.id, { manifest: beta, state: 'installed' as const, enabled: false }],
    ]);

    expect(resolvePackageDependencyResult(alpha, (id) => candidates.get(id))).toEqual({
      ok: false,
      error: { phase: 'activation', code: 'PACKAGE_DEPENDENCY_DISABLED' },
    });
  });

  it('rejects dependency cycles before activation', () => {
    const alpha = parsePackageManifest({
      ...validManifest,
      id: 'org.example.alpha',
      dependencies: [{ id: 'org.example.beta', version: '^1.0.0' }],
    });
    const beta = parsePackageManifest({
      ...validManifest,
      id: 'org.example.beta',
      dependencies: [{ id: alpha.id, version: '^1.0.0' }],
    });
    const candidates = new Map([
      [alpha.id, { manifest: alpha, state: 'installed' as const, enabled: true }],
      [beta.id, { manifest: beta, state: 'installed' as const, enabled: true }],
    ]);

    expect(resolvePackageDependencyResult(alpha, (id) => candidates.get(id))).toEqual({
      ok: false,
      error: { phase: 'activation', code: 'PACKAGE_DEPENDENCY_CYCLE' },
    });
  });

  it('reports a catalog cycle before inactive availability', () => {
    const alpha = parsePackageManifest({
      ...validManifest,
      id: 'org.example.catalog-alpha',
      dependencies: [{ id: 'org.example.catalog-beta', version: '^1.0.0' }],
    });
    const beta = parsePackageManifest({
      ...validManifest,
      id: 'org.example.catalog-beta',
      dependencies: [{ id: alpha.id, version: '^1.0.0' }],
    });
    const candidates = new Map([
      [alpha.id, { manifest: alpha, state: 'available' as const, enabled: false }],
      [beta.id, { manifest: beta, state: 'available' as const, enabled: false }],
    ]);

    expect(resolvePackageDependencyResult(alpha, (id) => candidates.get(id), 'install')).toEqual({
      ok: false,
      error: { phase: 'install', code: 'PACKAGE_DEPENDENCY_CYCLE' },
    });
  });

  it('serializes a missing dependency without package metadata', () => {
    const extension = parsePackageManifest({
      ...validManifest,
      id: 'org.example.missing-dependency',
      dependencies: [{ id: 'org.example.absent', version: '^1.0.0' }],
    });

    expect(resolvePackageDependencyResult(extension, () => undefined)).toEqual({
      ok: false,
      error: { phase: 'activation', code: 'PACKAGE_DEPENDENCY_MISSING' },
    });
  });

  it('serializes a version-incompatible dependency without versions', () => {
    const core = parsePackageManifest({ ...validManifest, id: 'com.tomni.core', version: '2.0.0' });
    const extension = parsePackageManifest({
      ...validManifest,
      id: 'org.example.version-incompatible',
      dependencies: [{ id: core.id, version: '^1.0.0' }],
    });
    const candidates = new Map([[core.id, { manifest: core, state: 'installed' as const, enabled: true }]]);

    expect(resolvePackageDependencyResult(extension, (id) => candidates.get(id))).toEqual({
      ok: false,
      error: { phase: 'activation', code: 'PACKAGE_DEPENDENCY_INCOMPATIBLE_VERSION' },
    });
  });

  it('reports a direct incompatible version before disabled state', () => {
    const core = parsePackageManifest({ ...validManifest, id: 'com.tomni.disabled-core', version: '2.0.0' });
    const extension = parsePackageManifest({
      ...validManifest,
      id: 'org.example.disabled-version-incompatible',
      dependencies: [{ id: core.id, version: '^1.0.0' }],
    });
    const candidates = new Map([[core.id, { manifest: core, state: 'installed' as const, enabled: false }]]);

    expect(resolvePackageDependencyResult(extension, (id) => candidates.get(id))).toEqual({
      ok: false,
      error: { phase: 'activation', code: 'PACKAGE_DEPENDENCY_INCOMPATIBLE_VERSION' },
    });
  });

  it('serializes a quarantined dependency without internal state details', () => {
    const core = parsePackageManifest({ ...validManifest, id: 'com.tomni.core' });
    const extension = parsePackageManifest({
      ...validManifest,
      id: 'org.example.quarantined-dependency',
      dependencies: [{ id: core.id, version: '^1.0.0' }],
    });
    const candidates = new Map([[core.id, { manifest: core, state: 'quarantined' as const, enabled: false }]]);

    expect(resolvePackageDependencyResult(extension, (id) => candidates.get(id))).toEqual({
      ok: false,
      error: { phase: 'activation', code: 'PACKAGE_DEPENDENCY_QUARANTINED' },
    });
  });

  it('accepts sandboxed web modules with an HTML entrypoint', () => {
    const manifest = parsePackageManifest({
      ...validManifest,
      modules: [
        {
          ...validManifest.modules[0],
          runtime: 'sandboxed-web',
          entrypoint: 'index.html',
        },
      ],
    });

    expect(manifest.modules[0]?.runtime).toBe('sandboxed-web');
  });

  it('rejects sandboxed web modules without an HTML entrypoint', () => {
    expect(() =>
      parsePackageManifest({
        ...validManifest,
        modules: [
          {
            ...validManifest.modules[0],
            runtime: 'sandboxed-web',
            entrypoint: 'app.json',
          },
        ],
      })
    ).toThrow('Sandboxed web modules need an HTML entrypoint');
  });

  it('accepts a trusted React module with JavaScript and CSS entrypoints', () => {
    const manifest = parsePackageManifest({
      ...validManifest,
      modules: [
        {
          ...validManifest.modules[0],
          runtime: 'trusted-react',
          entrypoint: 'app.js',
          styleEntrypoint: 'style.css',
        },
      ],
    });

    expect(manifest.modules[0]?.runtime).toBe('trusted-react');
  });

  it('rejects trusted React modules without a JavaScript entrypoint', () => {
    expect(() =>
      parsePackageManifest({
        ...validManifest,
        modules: [
          {
            ...validManifest.modules[0],
            runtime: 'trusted-react',
            entrypoint: 'index.html',
          },
        ],
      })
    ).toThrow('Trusted React modules need a JavaScript entrypoint');
  });

  it('binds permissions and contributions into the signed payload', () => {
    const artifact = {
      integrity: `sha256-${'a'.repeat(64)}`,
      sizeBytes: 10,
      signature: { algorithm: 'ed25519' as const, keyId: 'publisher-key', value: 'signature' },
    };
    const manifest = parsePackageManifest({ ...validManifest, artifact });
    const permissionChanged = parsePackageManifest({
      ...validManifest,
      permissions: ['workspace.write'],
      artifact,
    });

    expect(packageSignaturePayload(permissionChanged)).not.toBe(packageSignaturePayload(manifest));
  });

  it('binds uploaded screenshots into the signed payload', () => {
    const artifact = {
      integrity: `sha256-${'a'.repeat(64)}`,
      sizeBytes: 10,
      signature: { algorithm: 'ed25519' as const, keyId: 'publisher-key', value: 'signature' },
    };
    const manifest = parsePackageManifest({ ...validManifest, artifact });
    const withScreenshot = parsePackageManifest({
      ...validManifest,
      screenshots: [{ url: 'https://cdn.tomny.dev/example/preview.webp' }],
      artifact,
    });

    expect(packageSignaturePayload(withScreenshot)).not.toBe(packageSignaturePayload(manifest));
  });
});
