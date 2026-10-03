import { describe, expect, it } from 'vitest';
import {
  assertCommerceOrderTransition,
  createCapabilityActivationProposal,
  isPackageCompatible,
  packageSignaturePayload,
  parseAcquisitionGrant,
  parseCapabilityQuery,
  parseCapabilityResolution,
  parseCommissionEntry,
  parseCommerceOrder,
  parseCommerceOrderLifecycle,
  parsePaymentEvent,
  parsePublisherPayable,
  parseRefund,
  parsePackageSyscallEnvelope,
  parseProductOffer,
  resolveCapability,
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
      resolvePackageAppGroup(document.groups[0]!, [{ packageId: 'com.tomni.ide', appId: 'ide', moduleId: 'ide' }])
        .members
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

  it('fails closed on unknown fields, malformed identities, unsafe runtime declarations, duplicate dependency ids, and oversized nested values', () => {
    expect(() => parsePackageManifest({ ...validManifest, unrecognized: true })).toThrow();
    expect(() =>
      parsePackageManifest({
        ...validManifest,
        publisherId: 'Com.Tomni',
        modules: [{ ...validManifest.modules[0], unrecognized: true }],
      })
    ).toThrow();
    expect(() =>
      parsePackageManifest({
        ...validManifest,
        modules: [{ ...validManifest.modules[0], runtime: 'native-node', entrypoint: 'main.js' }],
      })
    ).toThrow();
    expect(() =>
      parsePackageManifest({
        ...validManifest,
        dependencies: [
          { id: 'org.example.dependency', version: '^1.0.0' },
          { id: 'org.example.dependency', version: '^2.0.0' },
        ],
      })
    ).toThrow('Dependency ids must be unique');
    expect(() =>
      parsePackageManifest({
        ...validManifest,
        modules: [{ ...validManifest.modules[0], id: 'main', title: 'a'.repeat(121) }],
      })
    ).toThrow();
  });

  it('accepts only the fixed Design VIU Main contribution declaration', () => {
    const mainContributions = [{ schemaVersion: 1, id: 'design-viu-v1' }] as const;
    expect(
      parsePackageManifest({
        ...validManifest,
        id: 'com.tomni.design-studio',
        publisherId: 'com.tomni',
        mainContributions,
      }).mainContributions
    ).toEqual(mainContributions);
    expect(() => parsePackageManifest({ ...validManifest, mainContributions })).toThrow(
      /reserved for com\.tomni\.design-studio/i
    );
    expect(() =>
      parsePackageManifest({
        ...validManifest,
        id: 'com.tomni.design-studio',
        publisherId: 'com.tomni',
        mainContributions: [{ schemaVersion: 1, id: 'design-viu-v1', module: 'evil.js' }],
      })
    ).toThrow();
    expect(() =>
      parsePackageManifest({
        ...validManifest,
        id: 'com.tomni.design-studio',
        publisherId: 'com.tomni',
        mainContributions: [
          { schemaVersion: 1, id: 'design-viu-v1' },
          { schemaVersion: 1, id: 'design-viu-v1' },
        ],
      })
    ).toThrow(/unique/i);
  });

  it('requires every declared permission to use one canonical, unique identifier', () => {
    expect(() => parsePackageManifest({ ...validManifest, permissions: ['workspace.read', 'workspace.read'] })).toThrow(
      'Package permissions must be unique'
    );
    expect(() => parsePackageManifest({ ...validManifest, permissions: ['Workspace.Read'] })).toThrow();
  });

  it('makes AI Surface operations explicit, bounded, and non-duplicated', () => {
    const manifest = parsePackageManifest({
      ...validManifest,
      aiAccess: {
        schemaVersion: 1,
        operations: [
          {
            id: 'workspace.write-file',
            capability: 'workspace.write',
            inputSchemaVersion: 1,
            dataClasses: ['workspace', 'artifact'],
            destinationIds: ['local-workspace'],
          },
        ],
      },
    });
    expect(manifest.aiAccess?.operations[0]?.id).toBe('workspace.write-file');
    expect(() =>
      parsePackageManifest({
        ...validManifest,
        aiAccess: {
          schemaVersion: 1,
          operations: [
            {
              id: 'workspace.write-file',
              capability: 'workspace.write',
              inputSchemaVersion: 1,
              dataClasses: ['workspace'],
              destinationIds: [],
            },
            {
              id: 'workspace.write-file',
              capability: 'workspace.write',
              inputSchemaVersion: 1,
              dataClasses: ['workspace'],
              destinationIds: [],
            },
          ],
        },
      })
    ).toThrow('AI operation ids must be unique');
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
    const withMainContribution = parsePackageManifest({
      ...validManifest,
      id: 'com.tomni.design-studio',
      publisherId: 'com.tomni',
      artifact,
      mainContributions: [{ schemaVersion: 1, id: 'design-viu-v1' }],
    });
    expect(packageSignaturePayload(withMainContribution)).not.toBe(packageSignaturePayload(manifest));
  });

  it('freezes strict resolver contracts without authorizing installation', () => {
    const requester = { packageId: 'com.tomni.workflow', packageVersion: '1.0.0', publisherId: 'com.tomni' };
    const query = parseCapabilityQuery({
      schemaVersion: 1,
      queryId: 'query_1',
      requester,
      capability: 'web.research',
      purpose: 'Research sources for a TikTok planning task.',
      dataLocation: 'remote-allowed',
      requireUi: false,
      requireOffline: false,
      idempotencyKey: 'query_1_attempt_0',
    });
    const resolution = parseCapabilityResolution({
      schemaVersion: 1,
      queryId: query.queryId,
      candidates: [
        {
          schemaVersion: 1,
          candidateId: 'remote_web',
          package: { packageId: 'com.tomni.web', packageVersion: '1.0.0', publisherId: 'com.tomni' },
          capability: 'web.research',
          state: 'ready-remote',
          trusted: true,
          compatible: true,
          healthy: true,
          dataLocation: 'remote-allowed',
          supportsUi: true,
          supportsOffline: false,
          reasonCodes: ['REMOTE_AVAILABLE'],
        },
      ],
      selectedCandidateId: 'remote_web',
      evaluatedAt: '2026-08-14T00:00:00.000Z',
    });

    expect(resolution.selectedCandidateId).toBe('remote_web');
    expect(() => parseCapabilityResolution({ ...resolution, selectedCandidateId: 'absent' })).toThrow();
    expect(() => parseCapabilityQuery({ ...query, unapproved: true })).toThrow();
    expect(() =>
      parsePackageSyscallEnvelope({
        schemaVersion: 1,
        caller: requester,
        runId: 'run_1',
        capabilityGrantId: 'grant_1',
        syscall: 'web.research',
        idempotencyKey: 'run_1_step_0',
        timeoutMs: 0,
        cancellationToken: 'cancel_1',
        resourceBudgetMb: 128,
      })
    ).toThrow();
  });

  it('resolves local, remote, installable, and unavailable capabilities without activation side effects', () => {
    const requester = { packageId: 'com.tomni.workflow', packageVersion: '1.0.0', publisherId: 'com.tomni' };
    const query = parseCapabilityQuery({
      schemaVersion: 1,
      queryId: 'query_capability_1',
      requester,
      capability: 'web.research',
      purpose: 'Find primary sources for a user-requested topic.',
      dataLocation: 'remote-allowed',
      requireUi: false,
      requireOffline: false,
      idempotencyKey: 'query_capability_1_attempt_0',
    });
    const local = {
      schemaVersion: 1,
      candidateId: 'local_web',
      package: { packageId: 'com.tomni.web', packageVersion: '1.0.0', publisherId: 'com.tomni' },
      capability: 'web.research',
      state: 'ready-local' as const,
      trusted: true,
      compatible: true,
      healthy: true,
      dataLocation: 'local-only' as const,
      supportsUi: true,
      supportsOffline: true,
      reasonCodes: ['LOCAL_HEALTHY'],
    };
    const remote = {
      schemaVersion: 1,
      candidateId: 'remote_web',
      package: { packageId: 'com.tomni.web-remote', packageVersion: '1.0.0', publisherId: 'com.tomni' },
      capability: 'web.research',
      state: 'ready-remote' as const,
      trusted: true,
      compatible: true,
      healthy: true,
      dataLocation: 'remote-allowed' as const,
      supportsUi: true,
      supportsOffline: false,
      reasonCodes: ['REMOTE_HEALTHY'],
    };
    const installable = {
      schemaVersion: 1,
      candidateId: 'install_web',
      package: { packageId: 'com.tomni.web-offline', packageVersion: '1.0.0', publisherId: 'com.tomni' },
      capability: 'web.research',
      state: 'installable' as const,
      trusted: true,
      compatible: true,
      healthy: false,
      dataLocation: 'local-only' as const,
      supportsUi: true,
      supportsOffline: true,
      reasonCodes: ['CATALOG_AVAILABLE'],
    };
    const untrusted = {
      schemaVersion: 1,
      candidateId: 'untrusted_web',
      package: { packageId: 'org.example.web', packageVersion: '1.0.0', publisherId: 'org.example' },
      capability: 'web.research',
      state: 'ready-remote' as const,
      trusted: false,
      compatible: true,
      healthy: true,
      dataLocation: 'remote-allowed' as const,
      supportsUi: true,
      supportsOffline: false,
      reasonCodes: ['UNTRUSTED_SOURCE'],
    };

    const resolution = resolveCapability(query, [remote, installable, untrusted, local], '2026-08-14T00:00:00.000Z');

    expect(resolution.selectedCandidateId).toBe('local_web');
    expect(resolution.candidates.map(({ candidateId, state }) => ({ candidateId, state }))).toEqual([
      { candidateId: 'local_web', state: 'ready-local' },
      { candidateId: 'remote_web', state: 'ready-remote' },
      { candidateId: 'install_web', state: 'installable' },
      { candidateId: 'untrusted_web', state: 'unavailable' },
    ]);
    expect(resolution.candidates.find(({ candidateId }) => candidateId === 'install_web')?.reasonCodes).toContain(
      'INSTALL_REVIEW_REQUIRED'
    );
    expect(resolution.candidates.find(({ candidateId }) => candidateId === 'untrusted_web')?.reasonCodes).toContain(
      'UNTRUSTED'
    );
    expect(
      createCapabilityActivationProposal(resolution, 'install_web', {
        proposalId: 'proposal_install_web',
        requestedAt: '2026-08-14T00:00:00.000Z',
        requiresPurchase: true,
      })
    ).toMatchObject({
      candidate: { candidateId: 'install_web' },
      requiresInstall: true,
      requiresPurchase: true,
      requiredConsent: ['install', 'permissions', 'purchase', 'offline-data'],
    });
    expect(() =>
      createCapabilityActivationProposal(resolution, 'local_web', { proposalId: 'proposal_local' })
    ).toThrow();

    const localOnlyResolution = resolveCapability(
      { ...query, dataLocation: 'local-only' },
      [remote],
      '2026-08-14T00:00:00.000Z'
    );
    expect(localOnlyResolution.selectedCandidateId).toBeUndefined();
    expect(localOnlyResolution.candidates[0]?.reasonCodes).toContain('DATA_LOCATION_DISALLOWED');
  });

  it('freezes integer Store commerce records and reconciles the third-party 15/85 fixture', () => {
    const packageIdentity = { packageId: 'com.tomni.video', packageVersion: '1.0.0', publisherId: 'org.creator' };
    const offer = parseProductOffer({
      schemaVersion: 1,
      offerId: 'offer_video',
      productId: 'product_video',
      package: packageIdentity,
      sellerKind: 'third-party',
      price: { currency: 'USD', amountMinor: 1000 },
      taxTreatment: 'exclusive',
      revision: 'rev_1',
      active: true,
    });
    const commission = parseCommissionEntry({
      schemaVersion: 1,
      commissionId: 'commission_1',
      orderId: 'order_1',
      gross: offer.price,
      tax: { currency: 'USD', amountMinor: 0 },
      refunded: { currency: 'USD', amountMinor: 0 },
      publisherPayable: { currency: 'USD', amountMinor: 850 },
      tomniCommission: { currency: 'USD', amountMinor: 150 },
      rateBasisPoints: 1500,
    });

    expect(commission.publisherPayable.amountMinor).toBe(850);
    expect(() => parseProductOffer({ ...offer, price: { currency: 'USD', amountMinor: 10.5 } })).toThrow();
    expect(() =>
      parseCommissionEntry({ ...commission, tomniCommission: { currency: 'USD', amountMinor: 149 } })
    ).toThrow();
    expect(assertCommerceOrderTransition('payment-pending', 'paid')).toBe('paid');
    expect(() => assertCommerceOrderTransition('paid', 'payment-pending')).toThrow();
  });

  it('rejects fractional, scientific-string, and unsafe money at every public Store money boundary', () => {
    const packageIdentity = { packageId: 'com.tomni.video', packageVersion: '1.0.0', publisherId: 'com.tomni' };
    const price = { currency: 'USD', amountMinor: 1000 };
    const offer = {
      schemaVersion: 1,
      offerId: 'offer_money_contract',
      productId: 'product_money_contract',
      package: packageIdentity,
      sellerKind: 'first-party',
      price,
      taxTreatment: 'exclusive',
      revision: 'revision_money_contract',
      active: true,
    };
    const order = {
      schemaVersion: 1,
      orderId: 'order_money_contract',
      accountId: 'account_money_contract',
      offer,
      state: 'paid',
      idempotencyKey: 'order_money_contract',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:02:00.000Z',
    };
    const authorized = {
      schemaVersion: 1,
      paymentEventId: 'payment_authorized_money_contract',
      orderId: order.orderId,
      providerEventId: 'provider_authorized_money_contract',
      kind: 'authorized',
      amount: price,
      idempotencyKey: 'payment_authorized_money_contract',
      occurredAt: '2026-08-14T00:01:00.000Z',
    };
    const captured = {
      ...authorized,
      paymentEventId: 'payment_captured_money_contract',
      providerEventId: 'provider_captured_money_contract',
      kind: 'captured',
      idempotencyKey: 'payment_captured_money_contract',
      occurredAt: '2026-08-14T00:02:00.000Z',
    };
    const refund = {
      schemaVersion: 1,
      refundId: 'refund_money_contract',
      orderId: order.orderId,
      paymentEventId: captured.paymentEventId,
      amount: price,
      reasonCode: 'customer_request',
      idempotencyKey: 'refund_money_contract',
      createdAt: '2026-08-14T00:03:00.000Z',
    };
    const commission = {
      schemaVersion: 1,
      commissionId: 'commission_money_contract',
      orderId: order.orderId,
      gross: price,
      tax: { currency: 'USD', amountMinor: 0 },
      refunded: { currency: 'USD', amountMinor: 0 },
      publisherPayable: { currency: 'USD', amountMinor: 850 },
      tomniCommission: { currency: 'USD', amountMinor: 150 },
      rateBasisPoints: 1500,
    };
    const payable = {
      schemaVersion: 1,
      payableId: 'payable_money_contract',
      publisherId: packageIdentity.publisherId,
      commissionId: commission.commissionId,
      amount: commission.publisherPayable,
      state: 'accrued',
    };
    const entitlement = {
      schemaVersion: 1,
      entitlementId: 'entitlement_money_contract',
      accountId: order.accountId,
      offerId: offer.offerId,
      package: packageIdentity,
      state: 'active',
      issuedAt: captured.occurredAt,
    };
    type MoneyParserCase = Readonly<{
      parse: (value: unknown) => unknown;
      invalidValue: (amountMinor: unknown) => unknown;
    }>;
    const parserCases: readonly MoneyParserCase[] = [
      { parse: parseProductOffer, invalidValue: (amountMinor) => ({ ...offer, price: { ...price, amountMinor } }) },
      {
        parse: parseCommerceOrder,
        invalidValue: (amountMinor) => ({ ...order, offer: { ...offer, price: { ...price, amountMinor } } }),
      },
      { parse: parsePaymentEvent, invalidValue: (amountMinor) => ({ ...captured, amount: { ...price, amountMinor } }) },
      { parse: parseRefund, invalidValue: (amountMinor) => ({ ...refund, amount: { ...price, amountMinor } }) },
      {
        parse: parseCommissionEntry,
        invalidValue: (amountMinor) => ({ ...commission, gross: { ...price, amountMinor } }),
      },
      {
        parse: parsePublisherPayable,
        invalidValue: (amountMinor) => ({ ...payable, amount: { ...price, amountMinor } }),
      },
      {
        parse: parseCommerceOrderLifecycle,
        invalidValue: (amountMinor) => ({
          order: { ...order, offer: { ...offer, price: { ...price, amountMinor } } },
          paymentEvents: [authorized, captured],
          refunds: [],
          entitlement,
        }),
      },
    ];

    for (const amountMinor of [10.5, '1e3', Number.MAX_SAFE_INTEGER + 1] as const) {
      for (const parserCase of parserCases) {
        expect(() => parserCase.parse(parserCase.invalidValue(amountMinor))).toThrow();
      }
    }
  });

  it('requires ordered ordinary-payment evidence before entitlement and reverses the grant on refund', () => {
    const packageIdentity = { packageId: 'com.tomni.video', packageVersion: '1.0.0', publisherId: 'com.tomni' };
    const offer = {
      schemaVersion: 1,
      offerId: 'offer_video',
      productId: 'product_video',
      package: packageIdentity,
      sellerKind: 'first-party',
      price: { currency: 'USD', amountMinor: 1200 },
      taxTreatment: 'exclusive',
      revision: 'rev_1',
      active: true,
    };
    const order = {
      schemaVersion: 1,
      orderId: 'order_video',
      accountId: 'account_1',
      offer,
      state: 'paid',
      idempotencyKey: 'order_video_create',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:02:00.000Z',
    };
    const authorized = {
      schemaVersion: 1,
      paymentEventId: 'payment_authorized',
      orderId: order.orderId,
      providerEventId: 'provider_authorized',
      kind: 'authorized',
      amount: offer.price,
      idempotencyKey: 'payment_authorized',
      occurredAt: '2026-08-14T00:01:00.000Z',
    };
    const captured = {
      ...authorized,
      paymentEventId: 'payment_captured',
      providerEventId: 'provider_captured',
      kind: 'captured',
      idempotencyKey: 'payment_captured',
      occurredAt: '2026-08-14T00:02:00.000Z',
    };
    const entitlement = {
      schemaVersion: 1,
      entitlementId: 'entitlement_video',
      accountId: order.accountId,
      offerId: offer.offerId,
      package: packageIdentity,
      state: 'active',
      issuedAt: captured.occurredAt,
    };
    const activeGrant = {
      schemaVersion: 1,
      grantId: 'grant_video',
      accountId: order.accountId,
      offerId: offer.offerId,
      package: packageIdentity,
      entitlementId: entitlement.entitlementId,
      policyVersion: 'store_1',
      expiresAt: '2026-09-14T00:00:00.000Z',
    };

    expect(
      parseCommerceOrderLifecycle({
        order,
        paymentEvents: [authorized, captured],
        refunds: [],
        entitlement,
        activeGrant,
      })
    ).toMatchObject({
      order: { state: 'paid' },
      entitlement: { state: 'active' },
      activeGrant: { grantId: 'grant_video' },
    });

    expect(() =>
      parseCommerceOrderLifecycle({
        order,
        paymentEvents: [authorized, captured],
        refunds: [],
        entitlement: { ...entitlement, issuedAt: authorized.occurredAt },
      })
    ).toThrow();

    const refunded = parseCommerceOrderLifecycle({
      order: { ...order, state: 'refunded', updatedAt: '2026-08-14T00:04:00.000Z' },
      paymentEvents: [
        authorized,
        captured,
        {
          ...captured,
          paymentEventId: 'payment_refunded',
          providerEventId: 'provider_refunded',
          kind: 'refunded',
          idempotencyKey: 'payment_refunded',
          occurredAt: '2026-08-14T00:03:00.000Z',
        },
      ],
      refunds: [
        {
          schemaVersion: 1,
          refundId: 'refund_video',
          orderId: order.orderId,
          paymentEventId: captured.paymentEventId,
          amount: offer.price,
          reasonCode: 'customer_request',
          idempotencyKey: 'refund_video',
          createdAt: '2026-08-14T00:04:00.000Z',
        },
      ],
      entitlement: { ...entitlement, state: 'revoked' },
    });
    expect(refunded.entitlement?.state).toBe('revoked');
    expect(refunded.activeGrant).toBeUndefined();

    expect(() =>
      parseCommerceOrderLifecycle({
        order,
        paymentEvents: [authorized, { ...captured, providerEventId: authorized.providerEventId }],
        refunds: [],
        entitlement,
      })
    ).toThrow();
    expect(() => parseCommerceOrderLifecycle({ ...refunded, activeGrant })).toThrow();
    expect(() =>
      parseCommerceOrderLifecycle({
        ...refunded,
        refunds: [{ ...refunded.refunds[0], amount: { currency: 'USD', amountMinor: 1 } }],
      })
    ).toThrow();
  });

  it('requires bounded commercial admission metadata without making it a technical capability grant', () => {
    expect(
      parseAcquisitionGrant({
        schemaVersion: 1,
        grantId: 'acquisition_1',
        accountId: 'account_1',
        offerId: 'offer_1',
        package: { packageId: 'com.tomni.video', packageVersion: '1.0.0', publisherId: 'com.tomni' },
        entitlementId: 'entitlement_1',
        policyVersion: 'store_1',
        offlineRule: 'validated-install-retained',
      }).offlineRule
    ).toBe('validated-install-retained');
    expect(() =>
      parseAcquisitionGrant({
        schemaVersion: 1,
        grantId: 'acquisition_1',
        accountId: 'account_1',
        offerId: 'offer_1',
        package: { packageId: 'com.tomni.video', packageVersion: '1.0.0', publisherId: 'com.tomni' },
        entitlementId: 'entitlement_1',
        policyVersion: 'store_1',
        capabilityGrantId: 'must-not-exist',
      })
    ).toThrow();
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
