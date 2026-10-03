import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import type { InstalledPackageRecord, PackageCatalogEntry, PackageManifest } from '@/common/packages';
import {
  PACKAGE_APP_GROUP_NATIVE_CHANNELS,
  PUBLISHER_SUBMISSION_NATIVE_CHANNELS,
  PACKAGE_MUTATION_NATIVE_CHANNELS,
  PACKAGE_RUNTIME_NATIVE_CHANNELS,
  PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS,
  PACKAGE_SURFACE_AI_RUNTIME_NATIVE_CHANNELS,
} from '@/common/types/platform/electron';
import {
  createFirstPartyPackageCatalog,
  FIRST_PARTY_PACKAGE_CATALOG,
  FIRST_PARTY_PACKAGE_TRUSTED_KEYS,
  packageSignaturePayload,
} from '@/common/packages';
import {
  computeArtifactIntegrity,
  createPackageManagerService,
  createC4SurfaceAiOperationDispatcher,
  JsonPackageStateStore,
  createPackageRuntimeRegistry,
  createElectronSurfaceAiRuntimeTransportEndpoint,
  registerTrustedPackageMutationIpcBridge,
  registerTrustedPackageRuntimeIpcBridge,
  registerTrustedSurfaceAiRuntimePortHandoffIpcBridge,
  registerTrustedSurfaceAiAccessIpcBridge,
  listVerifiedSurfaceAiRuntimeBindings,
  verifyInstalledPackageSurfaceRuntime,
  registerTrustedPublisherSubmissionIpcBridge,
  type PackageMutationRuntime,
  type PackageStateStore,
} from '@process/extensions/package-manager';
import { createSurfaceAiRuntimeTransportRegistry } from '@process/resources/packageCapability/surfaceAiRuntimeTransport';
import {
  createPackageAppGroupService,
  registerTrustedPackageAppGroupIpcBridge,
  type PackageAppGroupBridgeResult,
} from '@process/extensions/package-app-groups';

const filesystemFailures = vi.hoisted(() => ({
  removePath: undefined as string | undefined,
  renameFromPath: undefined as string | undefined,
  rejectTemporaryRename: false,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rm: (...args: Parameters<typeof actual.rm>): ReturnType<typeof actual.rm> => {
      if (String(args[0]) === filesystemFailures.removePath) {
        return Promise.reject(new Error('simulated downloaded artifact cleanup failure'));
      }
      return actual.rm(...args);
    },
    rename: (...args: Parameters<typeof actual.rename>): ReturnType<typeof actual.rename> => {
      if (String(args[0]) === filesystemFailures.renameFromPath) {
        return Promise.reject(new Error('simulated artifact rollback rename failure'));
      }
      if (filesystemFailures.rejectTemporaryRename && String(args[0]).endsWith('.tmp')) {
        return Promise.reject(new Error('simulated state-store rename failure'));
      }
      return actual.rename(...args);
    },
  };
});

const roots: string[] = [];
const servers: Server[] = [];

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-package-test-'));
  roots.push(root);
  return root;
};

afterEach(async () => {
  filesystemFailures.removePath = undefined;
  filesystemFailures.renameFromPath = undefined;
  filesystemFailures.rejectTemporaryRename = false;
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const appGroupMember = { packageId: 'com.tomni.ide', appId: 'ide', moduleId: 'ide', role: 'core' } as const;

const runtimeOpenRequest = (
  packageId: string,
  runtimeId: string,
  identity: Partial<Pick<PackageManifest, 'version' | 'publisherId'>> & { moduleId?: string } = {}
) => ({
  packageId,
  runtimeId,
  packageVersion: identity.version ?? '1.0.0',
  publisherId: identity.publisherId ?? 'org.example',
  moduleId: identity.moduleId ?? 'surface',
});

class TestMainMessagePort {
  public readonly sent: unknown[] = [];
  public closed = false;
  public started = false;
  private readonly listeners = new Map<string, Set<(event?: { data: unknown }) => void>>();

  public start(): void {
    this.started = true;
  }

  public postMessage(message: unknown): void {
    this.sent.push(message);
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  public on(event: string, listener: (event?: { data: unknown }) => void): this {
    const entries = this.listeners.get(event) ?? new Set<(event?: { data: unknown }) => void>();
    entries.add(listener);
    this.listeners.set(event, entries);
    return this;
  }

  public once(event: string, listener: (event?: { data: unknown }) => void): this {
    const once = (value?: { data: unknown }): void => {
      this.removeListener(event, once);
      listener(value);
    };
    return this.on(event, once);
  }

  public removeListener(event: string, listener: (event?: { data: unknown }) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  public emit(event: string, value?: { data: unknown }): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }

  public emitMessage(data: unknown): void {
    this.emit('message', { data });
  }
}

describe('package app group state', () => {
  it('keeps user and workspace group documents isolated after a durable reload', async () => {
    const root = await tempRoot();
    let sequence = 0;
    const service = createPackageAppGroupService({
      filePath: path.join(root, 'tomny-state', 'package-app-groups.json'),
      randomId: () => `id-${++sequence}`,
    });

    const user = await service.create({ scope: { kind: 'user' }, name: 'Studio', members: [appGroupMember] });
    await service.create({
      scope: { kind: 'workspace', workspaceId: 'workspace-demo' },
      name: 'Workspace tools',
      members: [appGroupMember],
    });

    const reloaded = createPackageAppGroupService({
      filePath: path.join(root, 'tomny-state', 'package-app-groups.json'),
    });
    expect((await reloaded.read({ scope: { kind: 'user' } })).groups).toEqual(user.groups);
    expect((await reloaded.read({ scope: { kind: 'workspace', workspaceId: 'workspace-demo' } })).groups).toHaveLength(
      1
    );
  });

  it('rejects a partial group ordering without changing persisted order', async () => {
    const root = await tempRoot();
    let sequence = 0;
    const service = createPackageAppGroupService({
      filePath: path.join(root, 'package-app-groups.json'),
      randomId: () => `id-${++sequence}`,
    });
    await service.create({ scope: { kind: 'user' }, name: 'Studio', members: [appGroupMember] });

    await expect(service.reorder({ scope: { kind: 'user' }, groupIds: [] })).rejects.toThrow('APP_GROUP_ORDER_INVALID');
    expect((await service.read({ scope: { kind: 'user' } })).groups.map((group) => group.name)).toEqual(['Studio']);
  });

  it('quarantines malformed persisted state instead of accepting it', async () => {
    const root = await tempRoot();
    const filePath = path.join(root, 'package-app-groups.json');
    const malformed = JSON.stringify({ schemaVersion: 1, user: { groups: [] } });
    await writeFile(filePath, malformed, 'utf8');

    const service = createPackageAppGroupService({ filePath });
    expect((await service.read({ scope: { kind: 'user' } })).groups).toEqual([]);
    const quarantined = (await readdir(root)).find((entry) => entry.startsWith('package-app-groups.json.corrupt-'));
    expect(quarantined).toBeDefined();
    expect(await readFile(path.join(root, quarantined!), 'utf8')).toBe(malformed);
  });

  it.each([
    [
      'a state without a schema version',
      JSON.stringify({
        user: { schemaVersion: 1, groups: [] },
        workspaces: {},
      }),
    ],
    [
      'a future state schema version',
      JSON.stringify({
        schemaVersion: 2,
        user: { schemaVersion: 1, groups: [] },
        workspaces: {},
      }),
    ],
    ['a partially written state file', '{schemaVersion:1,user:'],
  ])('quarantines %s without treating it as a migratable state', async (_description, serialized) => {
    const root = await tempRoot();
    const filePath = path.join(root, 'package-app-groups.json');
    await writeFile(filePath, serialized, 'utf8');

    const service = createPackageAppGroupService({ filePath });
    expect((await service.read({ scope: { kind: 'user' } })).groups).toEqual([]);

    const quarantined = (await readdir(root)).find((entry) => entry.startsWith('package-app-groups.json.corrupt-'));
    expect(quarantined).toBeDefined();
    expect(await readFile(path.join(root, quarantined!), 'utf8')).toBe(serialized);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({
      schemaVersion: 1,
      user: { schemaVersion: 1, groups: [] },
      workspaces: {},
    });
  });

  it('keeps the last valid group document when a later atomic write fails', async () => {
    const root = await tempRoot();
    let sequence = 0;
    const service = createPackageAppGroupService({
      filePath: path.join(root, 'package-app-groups.json'),
      randomId: () => {
        sequence += 1;
        return sequence === 5 ? 'missing\\temporary' : `id-${sequence}`;
      },
    });
    await service.create({ scope: { kind: 'user' }, name: 'First', members: [appGroupMember] });

    await expect(
      service.create({ scope: { kind: 'user' }, name: 'Second', members: [appGroupMember] })
    ).rejects.toThrow();
    expect((await service.read({ scope: { kind: 'user' } })).groups.map((group) => group.name)).toEqual(['First']);
  });

  it('cleans the temporary group state file when its atomic rename fails', async () => {
    const root = await tempRoot();
    const filePath = path.join(root, 'package-app-groups.json');
    let sequence = 0;
    const service = createPackageAppGroupService({
      filePath,
      randomId: () => `id-${++sequence}`,
    });
    await service.create({ scope: { kind: 'user' }, name: 'First', members: [appGroupMember] });

    filesystemFailures.rejectTemporaryRename = true;
    await expect(
      service.create({ scope: { kind: 'user' }, name: 'Second', members: [appGroupMember] })
    ).rejects.toThrow('simulated state-store rename failure');
    filesystemFailures.rejectTemporaryRename = false;

    expect((await readdir(root)).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
    const reloaded = createPackageAppGroupService({ filePath });
    expect((await reloaded.read({ scope: { kind: 'user' } })).groups.map((group) => group.name)).toEqual(['First']);
  });

  it('rejects malformed or untrusted native app-group invocations before mutation', async () => {
    const root = await tempRoot();
    const service = createPackageAppGroupService({ filePath: path.join(root, 'package-app-groups.json') });
    const handlers = new Map<
      string,
      (sender: { trusted: boolean }, payload: unknown) => Promise<PackageAppGroupBridgeResult<unknown>>
    >();
    const dispose = registerTrustedPackageAppGroupIpcBridge({
      service,
      host: {
        handle: (channel, handler) => handlers.set(channel, handler),
        removeHandler: (channel) => handlers.delete(channel),
      },
      verifySender: (sender) => sender.trusted,
    });

    const create = handlers.get(PACKAGE_APP_GROUP_NATIVE_CHANNELS.create)!;
    expect(await create({ trusted: true }, { scope: { kind: 'user' }, name: 'Studio', members: [] })).toEqual({
      ok: false,
      code: 'APP_GROUP_REQUEST_INVALID',
    });
    expect(
      await create({ trusted: false }, { scope: { kind: 'user' }, name: 'Studio', members: [appGroupMember] })
    ).toEqual({
      ok: false,
      code: 'APP_GROUP_BRIDGE_UNAUTHORIZED',
    });
    expect((await service.read({ scope: { kind: 'user' } })).groups).toEqual([]);
    dispose();
  });
});

const bundledCatalog = (): PackageCatalogEntry[] => [
  {
    delivery: 'bundled-legacy',
    trust: 'trusted-first-party',
    manifest: {
      schemaVersion: 1,
      id: 'com.tomni.studio',
      publisherId: 'com.tomni',
      name: 'Studio',
      description: 'Studio suite',
      type: 'app',
      bundleKind: 'suite',
      version: '1.0.0',
      engines: { tomni: '>=1.0.0' },
      modules: [{ id: 'ide', title: 'IDE', surface: 'studio/ide', pinnable: true }],
      permissions: ['workspace.read'],
      dependencies: [],
      tags: ['ide'],
    },
  },
];

const contributionCatalog = (hostApiVersion = '^1.0.0'): PackageCatalogEntry[] => [
  {
    delivery: 'bundled-legacy',
    trust: 'trusted-first-party',
    manifest: {
      schemaVersion: 1,
      id: 'com.tomni.ide',
      publisherId: 'com.tomni',
      name: 'IDE',
      description: 'IDE contribution host',
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=1.0.0' },
      modules: [{ id: 'ide', title: 'IDE', surface: 'apps/ide', pinnable: true }],
      permissions: [],
      dependencies: [],
      contributions: {
        version: 1,
        apps: [{ id: 'ide', title: 'IDE', moduleId: 'ide' }],
        ide: {
          hostApiVersion: '^1.0.0',
          activityGroups: [
            { id: 'codebase', title: 'Codebase', order: 10 },
            { id: 'agent-ops', title: 'Agent operations', order: 20 },
          ],
        },
      },
      tags: ['ide'],
    },
  },
  {
    delivery: 'bundled-package',
    trust: 'signed-store',
    manifest: {
      schemaVersion: 1,
      id: 'org.example.wiki',
      publisherId: 'org.example',
      name: 'Wiki',
      description: 'Remote Store IDE extension',
      type: 'ui',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=1.0.0' },
      modules: [{ id: 'wiki', title: 'Wiki', surface: 'apps/wiki', pinnable: true }],
      permissions: [],
      dependencies: [{ id: 'com.tomni.ide', version: '^1.0.0' }],
      contributions: {
        version: 1,
        ide: {
          hostApiVersion,
          subtabs: [
            {
              id: 'wiki',
              title: 'Wiki',
              activityGroupId: 'codebase',
              moduleId: 'wiki',
              activation: 'on-open',
            },
          ],
          commands: [{ id: 'wiki.open', title: 'Open Wiki' }],
        },
      },
      tags: ['wiki'],
    },
  },
];

describe('package manager service', () => {
  it('keeps a package active until every owner runtime has closed', () => {
    const registry = createPackageRuntimeRegistry();
    registry.open('renderer-1', runtimeOpenRequest('org.example.app', 'runtime-1'));
    registry.open('renderer-2', runtimeOpenRequest('org.example.app', 'runtime-2'));

    expect(registry.isRuntimeActive('org.example.app', 'runtime-1')).toBe(true);
    expect(registry.isRuntimeActive('org.example.app', 'runtime-missing')).toBe(false);
    expect(registry.ownsRuntime('renderer-1', 'org.example.app', 'runtime-1')).toBe(true);
    expect(registry.ownsRuntime('renderer-2', 'org.example.app', 'runtime-1')).toBe(false);
    expect(registry.getRuntimeBinding('renderer-1', 'org.example.app', 'runtime-1')).toEqual({
      ...runtimeOpenRequest('org.example.app', 'runtime-1'),
      ownerId: 'renderer-1',
    });
    expect(registry.listRuntimeBindings('org.example.app')).toEqual([
      { ...runtimeOpenRequest('org.example.app', 'runtime-1'), ownerId: 'renderer-1' },
      { ...runtimeOpenRequest('org.example.app', 'runtime-2'), ownerId: 'renderer-2' },
    ]);
    expect(() => registry.open('renderer-1', runtimeOpenRequest('org.example.app', 'runtime-1'))).not.toThrow();
    expect(() => registry.open('renderer-2', runtimeOpenRequest('org.example.app', 'runtime-1'))).toThrow(
      'PACKAGE_RUNTIME_ID_CONFLICT'
    );
    registry.close('renderer-1', { packageId: 'org.example.app', runtimeId: 'runtime-1' });
    expect(registry.isActive('org.example.app')).toBe(true);
    expect(registry.isRuntimeActive('org.example.app', 'runtime-1')).toBe(false);
    expect(registry.ownsRuntime('renderer-1', 'org.example.app', 'runtime-1')).toBe(false);
    registry.close('renderer-2', { packageId: 'org.example.app', runtimeId: 'runtime-2' });
    expect(registry.isActive('org.example.app')).toBe(false);
  });

  it('revokes crashed renderer runtimes without closing another owner', () => {
    const registry = createPackageRuntimeRegistry();
    registry.open('renderer-1', runtimeOpenRequest('org.example.app', 'runtime-1'));
    registry.open('renderer-2', runtimeOpenRequest('org.example.app', 'runtime-2'));

    registry.revokeOwner('renderer-1');
    registry.close('renderer-1', { packageId: 'org.example.app', runtimeId: 'missing' });
    expect(registry.isActive('org.example.app')).toBe(true);
    registry.revokeOwner('renderer-2');
    expect(registry.isActive('org.example.app')).toBe(false);
  });

  it('invalidates every runtime for a Store-revoked Package App', () => {
    const registry = createPackageRuntimeRegistry();
    const invalidations: Array<{ runtimeId: string; reason: string }> = [];
    registry.onInvalidated(({ runtimeId, reason }) => invalidations.push({ runtimeId, reason }));
    registry.open('renderer-1', runtimeOpenRequest('org.example.app', 'runtime-1'));
    registry.open('renderer-2', runtimeOpenRequest('org.example.app', 'runtime-2'));

    registry.revokePackage('org.example.app');

    expect(registry.isActive('org.example.app')).toBe(false);
    expect(registry.isRuntimeActive('org.example.app', 'runtime-1')).toBe(false);
    expect(registry.isRuntimeActive('org.example.app', 'runtime-2')).toBe(false);
    expect(invalidations).toEqual([
      { runtimeId: 'runtime-1', reason: 'package-revoked' },
      { runtimeId: 'runtime-2', reason: 'package-revoked' },
    ]);
  });

  it('emits exact owner-bound invalidation when a Surface runtime closes or its window becomes unavailable', () => {
    const registry = createPackageRuntimeRegistry();
    const invalidations: Array<{ packageId: string; runtimeId: string; ownerId: string; reason: string }> = [];
    registry.onInvalidated((event) => invalidations.push(event));
    registry.open('renderer-1', runtimeOpenRequest('org.example.app', 'runtime-1'));
    registry.open('renderer-1', runtimeOpenRequest('org.example.app', 'runtime-2'));

    registry.close('renderer-1', { packageId: 'org.example.app', runtimeId: 'runtime-1' });
    registry.revokeOwner('renderer-1');

    expect(invalidations).toEqual([
      { packageId: 'org.example.app', runtimeId: 'runtime-1', ownerId: 'renderer-1', reason: 'runtime-closed' },
      { packageId: 'org.example.app', runtimeId: 'runtime-2', ownerId: 'renderer-1', reason: 'owner-unavailable' },
    ]);
  });

  it('cleans renderer runtime ownership when the IPC owner becomes unavailable', async () => {
    type Sender = { ownerId: string; trusted: boolean };
    const registry = createPackageRuntimeRegistry();
    const handlers = new Map<string, (sender: Sender, payload: unknown) => Promise<void>>();
    let notifyOwnerUnavailable: ((ownerId: string) => void) | undefined;
    const dispose = registerTrustedPackageRuntimeIpcBridge({
      host: {
        handle: (channel, handler) => handlers.set(channel, handler),
        removeHandler: (channel) => handlers.delete(channel),
      },
      registry,
      verifySender: (sender) => sender.trusted,
      identifySender: (sender) => sender.ownerId,
      subscribeOwnerUnavailable: (listener) => {
        notifyOwnerUnavailable = listener;
        return () => {
          notifyOwnerUnavailable = undefined;
        };
      },
    });
    const sender = { ownerId: 'renderer-1', trusted: true };
    await handlers.get(PACKAGE_RUNTIME_NATIVE_CHANNELS.open)!(sender, {
      ...runtimeOpenRequest('org.example.app', 'runtime-1'),
    });
    expect(registry.isActive('org.example.app')).toBe(true);

    notifyOwnerUnavailable?.(sender.ownerId);
    expect(registry.isActive('org.example.app')).toBe(false);
    dispose();
    expect(handlers.size).toBe(0);
  });

  it('hands a Main-owned port to one exact verified runtime and closes it when delivery fails', async () => {
    type Sender = { trusted: boolean };
    const handlers = new Map<string, (sender: Sender, payload: unknown) => Promise<void>>();
    const transport = createSurfaceAiRuntimeTransportRegistry();
    const port1 = new TestMainMessagePort();
    const port2 = new TestMainMessagePort();
    const claim = {
      packageId: 'org.example.surface',
      packageVersion: '1.0.0',
      publisherId: 'org.example',
      runtimeId: 'runtime-1',
      moduleId: 'workspace',
      artifactIntegrity: `sha256-${'d'.repeat(64)}`,
    } as const;
    const binding = {
      surface: {
        packageId: claim.packageId,
        packageVersion: claim.packageVersion,
        publisherId: claim.publisherId,
      },
      ownerId: 'electron:1',
      runtimeId: claim.runtimeId,
      moduleId: claim.moduleId,
      artifactIntegrity: claim.artifactIntegrity,
    } as const;
    let delivered:
      | { requestId: string; connectionId: string; binding: typeof binding; port: TestMainMessagePort }
      | undefined;
    const dispose = registerTrustedSurfaceAiRuntimePortHandoffIpcBridge({
      host: {
        handle: (channel, handler) => handlers.set(channel, handler),
        removeHandler: (channel) => handlers.delete(channel),
      },
      transportRegistry: transport,
      verifySender: (sender) => sender.trusted,
      resolveBinding: async (_sender, receivedClaim) =>
        JSON.stringify(receivedClaim) === JSON.stringify(claim) ? binding : undefined,
      createChannel: () => ({ port1, port2 }),
      toEndpoint: (port) => createElectronSurfaceAiRuntimeTransportEndpoint(port as never),
      closePort: (port) => port.close(),
      deliverPort: (_sender, handoff, port) => {
        delivered = { ...handoff, port };
      },
      createConnectionId: () => 'connection-1',
    });

    await handlers.get(PACKAGE_SURFACE_AI_RUNTIME_NATIVE_CHANNELS.requestPortHandoff)!(
      { trusted: true },
      {
        requestId: 'request-1',
        binding: claim,
      }
    );

    expect(port1.started).toBe(true);
    expect(delivered).toEqual({ requestId: 'request-1', connectionId: 'connection-1', binding, port: port2 });
    port1.emitMessage({ type: 'ready', schemaVersion: 1, sequence: 0, binding });
    expect(transport.isActive(binding)).toBe(true);
    transport.invalidate({ ownerId: binding.ownerId, runtimeId: binding.runtimeId });
    expect(port1.closed).toBe(true);

    await expect(
      handlers.get(PACKAGE_SURFACE_AI_RUNTIME_NATIVE_CHANNELS.requestPortHandoff)!(
        { trusted: true },
        {
          requestId: 'request-spoofed',
          binding: { ...claim, moduleId: 'forged-module' },
        }
      )
    ).rejects.toThrow('PACKAGE_SURFACE_AI_PORT_HANDOFF_RUNTIME_UNAVAILABLE');
    expect(port2.sent).toEqual([]);

    dispose();
    expect(handlers.size).toBe(0);
  });

  it('records Surface AI access only through an exact account-owned consent challenge', async () => {
    type Sender = { trusted: boolean; ownerId?: string };
    const handlers = new Map<string, (sender: Sender, payload: unknown) => Promise<unknown>>();
    const requestChallenge = vi.fn(async (ownerId: string, accountId: string, request: unknown) => {
      expect(ownerId).toBe('electron:1');
      expect(accountId).toBe('account-1');
      expect(request).toEqual({ packageId: 'org.example.surface', operationId: 'workspace.write' });
      return {
        challengeId: 'challenge-1',
        packageId: 'org.example.surface',
        packageVersion: '1.0.0',
        publisherId: 'org.example',
        operationId: 'workspace.write',
        capability: 'workspace.write',
        dataClasses: ['workspace'],
        destinationIds: ['local'],
        secretUse: false,
        expiresAt: '2026-08-20T00:00:00.000Z',
      };
    });
    const confirmChallenge = vi.fn(async (_ownerId: string, _accountId: string, request: unknown) => {
      expect(request).toEqual({ challengeId: 'challenge-1', approved: true });
      return { approved: true, consentId: 'consent-1', expiresAt: '2026-08-20T01:00:00.000Z' };
    });
    const revokeConsent = vi.fn(async (accountId: string, consentId: string) => {
      expect(accountId).toBe('account-1');
      expect(consentId).toBe('consent-1');
      return true;
    });
    const listConsents = vi.fn(async (accountId: string, packageId: string) => {
      expect(accountId).toBe('account-1');
      expect(packageId).toBe('org.example.surface');
      return [
        {
          consentId: 'consent-1',
          packageId,
          packageVersion: '1.0.0',
          operationId: 'workspace.write',
          expiresAt: '2026-08-20T01:00:00.000Z',
        },
      ];
    });
    const dispose = registerTrustedSurfaceAiAccessIpcBridge({
      host: {
        handle: (channel, handler) => handlers.set(channel, handler),
        removeHandler: (channel) => handlers.delete(channel),
      },
      verifySender: (sender) => sender.trusted,
      identifyOwner: (sender) => sender.ownerId,
      requireAuthenticatedAccount: () => ({ accountId: 'account-1' }),
      runtime: { requestChallenge, confirmChallenge, revokeConsent, listConsents },
    });
    const sender = { trusted: true, ownerId: 'electron:1' };

    await expect(
      handlers.get(PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS.requestChallenge)!(sender, {
        packageId: 'org.example.surface',
        operationId: 'workspace.write',
      })
    ).resolves.toMatchObject({ ok: true, challenge: { challengeId: 'challenge-1' } });
    await expect(
      handlers.get(PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS.confirmChallenge)!(sender, {
        challengeId: 'challenge-1',
        approved: true,
      })
    ).resolves.toEqual({ ok: true, approved: true, consentId: 'consent-1', expiresAt: '2026-08-20T01:00:00.000Z' });
    await expect(
      handlers.get(PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS.revokeConsent)!(sender, { consentId: 'consent-1' })
    ).resolves.toEqual({ ok: true, revoked: true });
    await expect(
      handlers.get(PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS.listConsents)!(sender, {
        packageId: 'org.example.surface',
      })
    ).resolves.toEqual({
      ok: true,
      consents: [
        {
          consentId: 'consent-1',
          packageId: 'org.example.surface',
          packageVersion: '1.0.0',
          operationId: 'workspace.write',
          expiresAt: '2026-08-20T01:00:00.000Z',
        },
      ],
    });
    await expect(
      handlers.get(PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS.requestChallenge)!({ trusted: false }, {})
    ).resolves.toEqual({ ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_SENDER_UNTRUSTED' });
    await expect(
      handlers.get(PACKAGE_SURFACE_AI_ACCESS_NATIVE_CHANNELS.requestChallenge)!(sender, {
        packageId: 'org.example.surface',
        operationId: 'workspace.write',
        forged: true,
      })
    ).resolves.toEqual({ ok: false, code: 'PACKAGE_SURFACE_AI_ACCESS_REQUEST_INVALID' });
    expect(requestChallenge).toHaveBeenCalledTimes(1);
    expect(confirmChallenge).toHaveBeenCalledTimes(1);
    expect(revokeConsent).toHaveBeenCalledTimes(1);
    expect(listConsents).toHaveBeenCalledTimes(1);
    dispose();
    expect(handlers.size).toBe(0);
  });

  it('binds a sandbox runtime only to the exact current reviewed Surface identity', async () => {
    const manifest: PackageManifest = {
      schemaVersion: 1,
      id: 'org.example.surface',
      publisherId: 'org.example',
      name: 'Reviewed Surface',
      description: 'A reviewed local Surface.',
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=1.0.0' },
      modules: [
        {
          id: 'workspace',
          title: 'Workspace',
          surface: 'apps/workspace',
          pinnable: true,
          runtime: 'sandboxed-web',
          entrypoint: 'index.html',
        },
      ],
      permissions: [],
      dependencies: [],
      tags: ['workspace'],
      artifact: {
        integrity: `sha256-${'c'.repeat(64)}`,
        sizeBytes: 123,
        signature: { algorithm: 'ed25519', keyId: 'reviewed-key', value: 'signature' },
      },
    };
    const review = {
      schemaVersion: 1 as const,
      disposition: 'auto-approved' as const,
      fingerprint: 'review-1',
      reviewedAt: '2030-01-01T00:00:00.000Z',
    };
    const listingFor = (overrides: Partial<PackageListing> = {}): PackageListing => ({
      manifest: structuredClone(manifest),
      delivery: 'downloaded-package',
      trust: 'signed-store',
      publicationReview: review,
      state: 'installed',
      installedVersion: manifest.version,
      installedManifest: structuredClone(manifest),
      installedTrust: 'signed-store',
      installedPublicationReview: review,
      updateAvailable: false,
      compatible: true,
      enabled: true,
      ...overrides,
    });
    const runtimeService = (
      listing: PackageListing,
      moduleRegistered = true
    ): Pick<PackageManagerService, 'status' | 'contributions'> => ({
      status: async () => structuredClone(listing),
      contributions: async () => ({
        snapshot: {
          revision: 1,
          packageIds: [manifest.id],
          apps: moduleRegistered
            ? [
                {
                  id: 'workspace',
                  title: 'Workspace',
                  moduleId: 'workspace',
                  key: `${manifest.id}/workspace`,
                  packageId: manifest.id,
                  packageVersion: manifest.version,
                },
              ]
            : [],
          activityGroups: [],
          subtabs: [],
          commands: [],
          settings: [],
        },
        diagnostics: [],
      }),
    });
    const request = runtimeOpenRequest(manifest.id, 'runtime-1', { ...manifest, moduleId: 'workspace' });

    await expect(verifyInstalledPackageSurfaceRuntime(runtimeService(listingFor()), request)).resolves.toBeUndefined();
    await expect(
      verifyInstalledPackageSurfaceRuntime(runtimeService(listingFor()), { ...request, moduleId: 'forged-module' })
    ).rejects.toThrow('PACKAGE_RUNTIME_SURFACE_MODULE_INVALID');
    await expect(
      verifyInstalledPackageSurfaceRuntime(runtimeService(listingFor()), { ...request, packageVersion: '2.0.0' })
    ).rejects.toThrow('PACKAGE_RUNTIME_SURFACE_INACTIVE');
    await expect(
      verifyInstalledPackageSurfaceRuntime(runtimeService(listingFor({ enabled: false })), request)
    ).rejects.toThrow('PACKAGE_RUNTIME_SURFACE_INACTIVE');
    await expect(
      verifyInstalledPackageSurfaceRuntime(runtimeService(listingFor({ state: 'available', enabled: false })), request)
    ).rejects.toThrow('PACKAGE_RUNTIME_SURFACE_INACTIVE');
    await expect(
      verifyInstalledPackageSurfaceRuntime(runtimeService(listingFor({ revoked: true })), request)
    ).rejects.toThrow('PACKAGE_RUNTIME_SURFACE_REVOKED');
    await expect(verifyInstalledPackageSurfaceRuntime(runtimeService(listingFor()), request)).resolves.toBeUndefined();
    const registry = createPackageRuntimeRegistry();
    registry.open('renderer-1', request);
    registry.open('renderer-2', { ...request, runtimeId: 'runtime-2' });
    await expect(
      listVerifiedSurfaceAiRuntimeBindings(runtimeService(listingFor()), registry, manifest.id)
    ).resolves.toEqual([
      {
        surface: { packageId: manifest.id, packageVersion: manifest.version, publisherId: manifest.publisherId },
        ownerId: 'renderer-1',
        runtimeId: 'runtime-1',
        moduleId: 'workspace',
        artifactIntegrity: manifest.artifact?.integrity,
      },
      {
        surface: { packageId: manifest.id, packageVersion: manifest.version, publisherId: manifest.publisherId },
        ownerId: 'renderer-2',
        runtimeId: 'runtime-2',
        moduleId: 'workspace',
        artifactIntegrity: manifest.artifact?.integrity,
      },
    ]);
    await expect(
      listVerifiedSurfaceAiRuntimeBindings(runtimeService(listingFor({ revoked: true })), registry, manifest.id)
    ).resolves.toEqual([]);
    await expect(verifyInstalledPackageSurfaceRuntime(runtimeService(listingFor(), false), request)).rejects.toThrow(
      'PACKAGE_RUNTIME_SURFACE_UNREGISTERED'
    );
    await expect(
      createC4SurfaceAiOperationDispatcher({
        service: runtimeService(listingFor({ revoked: true })),
        runtimeRegistry: registry,
        transportRegistry: createSurfaceAiRuntimeTransportRegistry(),
        consentStore: {} as never,
        enabled: () => false,
        kernel: {} as never,
        trust: {} as never,
        readiness: {
          selection: {
            surface: { packageId: manifest.id, packageVersion: manifest.version, publisherId: manifest.publisherId },
            operation: {
              id: 'workspace-write',
              capability: 'workspace.write',
              inputSchemaVersion: 1,
              dataClasses: ['workspace'],
              destinationIds: [],
            },
          },
          consent: {} as never,
          runtime: {
            surface: { packageId: manifest.id, packageVersion: manifest.version, publisherId: manifest.publisherId },
            ownerId: 'renderer-1',
            runtimeId: 'runtime-1',
            moduleId: 'workspace',
            artifactIntegrity: manifest.artifact!.integrity,
          },
        },
      })
    ).rejects.toThrow('SURFACE_AI_ACCESS_SURFACE_UNAVAILABLE');
  });

  it('atomically blocks runtime opens while a package mutation reservation is held', () => {
    const registry = createPackageRuntimeRegistry();
    registry.open('renderer-1', runtimeOpenRequest('org.example.app', 'runtime-1'));
    expect(registry.reserveMutation('org.example.app')).toBeUndefined();
    registry.revokeOwner('renderer-1');

    const lease = registry.reserveMutation('org.example.app');
    expect(lease).toBeDefined();
    expect(() => registry.open('renderer-2', runtimeOpenRequest('org.example.app', 'runtime-2'))).toThrow(
      /mutation.*active/i
    );

    lease?.release();
    registry.open('renderer-2', runtimeOpenRequest('org.example.app', 'runtime-2'));
    expect(registry.isActive('org.example.app')).toBe(true);
    lease?.release();
  });

  it('releases the runtime mutation reservation after sandbox uninstall fails', async () => {
    const rootDir = await tempRoot();
    const packageId = 'org.example.atomic-uninstall';
    const baseManifest = bundledCatalog()[0]!.manifest;
    const registry = createPackageRuntimeRegistry();
    const durableStore = new JsonPackageStateStore(path.join(rootDir, 'installed.json'));
    const removeStarted = Promise.withResolvers<void>();
    const allowRemove = Promise.withResolvers<void>();
    const stateStore: PackageStateStore = {
      initialize: () => durableStore.initialize(),
      list: () => durableStore.list(),
      get: (id) => durableStore.get(id),
      save: (record) => durableStore.save(record),
      remove: async (id) => {
        removeStarted.resolve();
        await allowRemove.promise;
        throw new Error(`Durable remove failed for ${id}.`);
      },
    };
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [
        {
          delivery: 'bundled-legacy',
          trust: 'trusted-first-party',
          manifest: {
            ...baseManifest,
            id: packageId,
            name: 'Atomic uninstall sandbox',
            modules: [
              {
                id: 'sandbox',
                title: 'Sandbox',
                surface: 'sandboxed/main',
                pinnable: true,
                runtime: 'sandboxed-web',
                entrypoint: 'sandboxed/index.html',
              },
            ],
          },
        },
      ],
      stateStore,
      isPackageSandboxActive: (id) => registry.isActive(id),
      reservePackageSandboxMutation: (id) => registry.reserveMutation(id),
    });
    await service.initialize();
    await service.install(packageId);

    const uninstalling = service.uninstall(packageId);
    await removeStarted.promise;
    expect(() => registry.open('renderer-1', runtimeOpenRequest(packageId, 'runtime-1'))).toThrow(/mutation.*active/i);

    allowRemove.resolve();
    await expect(uninstalling).rejects.toThrow(/durable remove failed/i);
    registry.open('renderer-1', runtimeOpenRequest(packageId, 'runtime-1'));
    expect(registry.isActive(packageId)).toBe(true);
  });

  it('finds the IDE through the Studio suite and installs/uninstalls it idempotently', async () => {
    const rootDir = await tempRoot();
    const service = createPackageManagerService({ rootDir, appVersion: '1.2.0', catalog: bundledCatalog() });
    await service.initialize();

    expect((await service.search({ query: 'IDE' }))[0]?.manifest.id).toBe('com.tomni.studio');
    expect((await service.status('com.tomni.studio')).state).toBe('available');

    await service.install('com.tomni.studio');
    await service.install('com.tomni.studio');
    expect((await service.status('com.tomni.studio')).state).toBe('installed');

    await service.uninstall('com.tomni.studio');
    await service.uninstall('com.tomni.studio');
    expect((await service.status('com.tomni.studio')).state).toBe('available');
  });

  it('prioritizes matching ready installed packages without returning unrelated installations', async () => {
    const rootDir = await tempRoot();
    const base = bundledCatalog()[0]!;
    const installedIde: PackageCatalogEntry = {
      ...base,
      manifest: {
        ...base.manifest,
        id: 'org.example.zulu-ide',
        name: 'Zulu IDE',
        description: 'A development surface',
        tags: ['development'],
      },
    };
    const availableIde: PackageCatalogEntry = {
      ...base,
      manifest: {
        ...base.manifest,
        id: 'org.example.alpha-ide',
        name: 'Alpha IDE',
        description: 'A development surface',
        tags: ['development'],
      },
    };
    const unrelatedInstalled: PackageCatalogEntry = {
      ...base,
      manifest: {
        ...base.manifest,
        id: 'org.example.calendar',
        name: 'Aardvark Calendar',
        description: 'Schedule management',
        modules: [{ id: 'calendar', title: 'Calendar', surface: 'apps/calendar', pinnable: true }],
        tags: ['calendar'],
      },
    };
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [installedIde, availableIde, unrelatedInstalled],
    });
    await service.initialize();
    await service.install(installedIde.manifest.id);
    await service.install(unrelatedInstalled.manifest.id);

    expect((await service.search({ query: 'ide' })).map(({ manifest }) => manifest.id)).toEqual([
      installedIde.manifest.id,
      availableIde.manifest.id,
    ]);
  });

  it('does not promote disabled installed packages above matching installable packages', async () => {
    const rootDir = await tempRoot();
    const base = bundledCatalog()[0]!;
    const installedIde: PackageCatalogEntry = {
      ...base,
      manifest: {
        ...base.manifest,
        id: 'org.example.zulu-ide',
        name: 'Zulu IDE',
      },
    };
    const availableIde: PackageCatalogEntry = {
      ...base,
      manifest: {
        ...base.manifest,
        id: 'org.example.alpha-ide',
        name: 'Alpha IDE',
      },
    };
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [installedIde, availableIde],
    });
    await service.initialize();
    await service.install(installedIde.manifest.id);
    await service.disable(installedIde.manifest.id);

    expect((await service.search({ query: 'ide' })).map(({ manifest }) => manifest.id)).toEqual([
      availableIde.manifest.id,
      installedIde.manifest.id,
    ]);
  });

  it('disables and re-enables an installed optional package without removing its durable installation', async () => {
    const rootDir = await tempRoot();
    const entry = bundledCatalog()[0]!;
    const service = createPackageManagerService({ rootDir, appVersion: '1.2.0', catalog: [entry] });
    await service.initialize();
    await service.install(entry.manifest.id);

    await expect(service.disable(entry.manifest.id)).resolves.toMatchObject({
      state: 'installed',
      enabled: false,
    });
    await expect(service.enable(entry.manifest.id)).resolves.toMatchObject({
      state: 'installed',
      enabled: true,
    });
    expect((await service.status(entry.manifest.id)).installedVersion).toBe(entry.manifest.version);
  });

  it('requires a live Store grant for paid package activation without changing free-package or technical trust paths', async () => {
    const rootDir = await tempRoot();
    const packageId = 'com.tomni.paid-workflow';
    const baseManifest = bundledCatalog()[0]!.manifest;
    const manifest: PackageManifest = {
      ...baseManifest,
      id: packageId,
      name: 'Paid workflow',
      version: '1.0.0',
    };
    const packageIdentity = {
      packageId,
      packageVersion: manifest.version,
      publisherId: manifest.publisherId,
    };
    const paidLifecycle = (accountId = 'account-1') => ({
      order: {
        schemaVersion: 1,
        orderId: 'order-1',
        accountId,
        offer: {
          schemaVersion: 1,
          offerId: 'offer-1',
          productId: 'product-1',
          package: packageIdentity,
          sellerKind: 'first-party',
          price: { currency: 'USD', amountMinor: 500 },
          taxTreatment: 'exclusive',
          revision: 'revision-1',
          active: true,
        },
        state: 'paid',
        idempotencyKey: `order-${accountId}`,
        createdAt: '2030-01-01T00:00:00.000Z',
        updatedAt: '2030-01-01T00:02:00.000Z',
      },
      paymentEvents: [
        {
          schemaVersion: 1,
          paymentEventId: `authorized-${accountId}`,
          orderId: 'order-1',
          providerEventId: `provider-authorized-${accountId}`,
          kind: 'authorized',
          amount: { currency: 'USD', amountMinor: 500 },
          idempotencyKey: `payment-authorized-${accountId}`,
          occurredAt: '2030-01-01T00:01:00.000Z',
        },
        {
          schemaVersion: 1,
          paymentEventId: `captured-${accountId}`,
          orderId: 'order-1',
          providerEventId: `provider-captured-${accountId}`,
          kind: 'captured',
          amount: { currency: 'USD', amountMinor: 500 },
          idempotencyKey: `payment-captured-${accountId}`,
          occurredAt: '2030-01-01T00:02:00.000Z',
        },
      ],
      refunds: [],
      entitlement: {
        schemaVersion: 1,
        entitlementId: `entitlement-${accountId}`,
        accountId,
        offerId: 'offer-1',
        package: packageIdentity,
        state: 'active',
        issuedAt: '2030-01-01T00:02:00.000Z',
      },
      activeGrant: {
        schemaVersion: 1,
        grantId: `grant-${accountId}`,
        accountId,
        offerId: 'offer-1',
        package: packageIdentity,
        entitlementId: `entitlement-${accountId}`,
        policyVersion: 'store-policy-1',
        expiresAt: '2031-01-01T00:00:00.000Z',
      },
    });
    const refundedLifecycle = () => {
      const lifecycle = paidLifecycle();
      return {
        ...lifecycle,
        order: { ...lifecycle.order, state: 'refunded' as const, updatedAt: '2030-01-01T00:04:00.000Z' },
        paymentEvents: [
          ...lifecycle.paymentEvents,
          {
            schemaVersion: 1,
            paymentEventId: 'refunded-payment-1',
            orderId: 'order-1',
            providerEventId: 'provider-refunded-1',
            kind: 'refunded' as const,
            amount: { currency: 'USD', amountMinor: 500 },
            idempotencyKey: 'payment-refunded-1',
            occurredAt: '2030-01-01T00:03:00.000Z',
          },
        ],
        refunds: [
          {
            schemaVersion: 1,
            refundId: 'refund-1',
            orderId: 'order-1',
            paymentEventId: 'captured-account-1',
            amount: { currency: 'USD', amountMinor: 500 },
            reasonCode: 'requested',
            idempotencyKey: 'refund-request-1',
            createdAt: '2030-01-01T00:04:00.000Z',
          },
        ],
        entitlement: { ...lifecycle.entitlement, state: 'revoked' as const },
        activeGrant: undefined,
      };
    };
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [{ manifest, delivery: 'bundled-legacy', trust: 'trusted-first-party' }],
      now: () => Date.parse('2029-01-01T00:00:00.000Z'),
      paidPackageActivationRequirement: (entry) =>
        entry.manifest.id === packageId ? { accountId: 'account-1', offerId: 'offer-1' } : undefined,
    });
    await service.initialize();

    await expect(service.install(packageId)).rejects.toThrow(/acquisition grant/i);
    await expect(service.install(packageId, { lifecycle: paidLifecycle('account-2') })).rejects.toThrow(
      /acquisition grant/i
    );
    await expect(service.install(packageId, { lifecycle: refundedLifecycle() })).rejects.toThrow(/acquisition grant/i);
    expect((await service.status(packageId)).state).toBe('available');

    await expect(service.install(packageId, { lifecycle: paidLifecycle() })).resolves.toMatchObject({
      state: 'installed',
      enabled: true,
      installedTrust: 'trusted-first-party',
    });
    await service.disable(packageId);
    await expect(service.enable(packageId)).rejects.toThrow(/acquisition grant/i);
    await expect(service.enable(packageId, { lifecycle: paidLifecycle() })).resolves.toMatchObject({ enabled: true });
  });

  it('fails closed when a signed paid catalog offer has no account-bound commercial authority', async () => {
    const rootDir = await tempRoot();
    const base = bundledCatalog()[0]!;
    const entry: PackageCatalogEntry = {
      ...base,
      offer: {
        schemaVersion: 1,
        offerId: 'offer-paid-catalog-1',
        productId: 'product-paid-catalog',
        package: {
          packageId: base.manifest.id,
          packageVersion: base.manifest.version,
          publisherId: base.manifest.publisherId,
        },
        sellerKind: 'first-party',
        price: { currency: 'USD', amountMinor: 1 },
        taxTreatment: 'exclusive',
        revision: 'offer-revision-1',
        active: true,
      },
    };
    const service = createPackageManagerService({ rootDir, appVersion: '1.2.0', catalog: [entry] });
    await service.initialize();

    await expect(service.install(entry.manifest.id)).rejects.toThrow(/commercial authority/i);
    await expect(service.status(entry.manifest.id)).resolves.toMatchObject({ offer: entry.offer, state: 'available' });

    expect(() =>
      createPackageManagerService({
        rootDir: path.join(rootDir, 'mismatched-offer'),
        appVersion: '1.2.0',
        catalog: [
          {
            ...entry,
            offer: { ...entry.offer!, package: { ...entry.offer!.package, packageVersion: '9.9.9' } },
          },
        ],
      })
    ).toThrow(/different package identity/i);
  });

  it('refuses to remove core packages or packages with an active sandbox', async () => {
    const rootDir = await tempRoot();
    const baseManifest = bundledCatalog()[0]!.manifest;
    const catalog: PackageCatalogEntry[] = [
      {
        delivery: 'bundled-legacy',
        trust: 'trusted-first-party',
        installScope: 'core',
        manifest: { ...baseManifest, id: 'com.tomni.core', name: 'Core' },
      },
      {
        delivery: 'bundled-legacy',
        trust: 'trusted-first-party',
        manifest: {
          ...baseManifest,
          id: 'org.example.sandbox',
          name: 'Sandboxed',
          modules: [
            {
              id: 'sandbox',
              title: 'Sandboxed',
              surface: 'sandboxed/main',
              pinnable: true,
              runtime: 'sandboxed-web',
              entrypoint: 'sandboxed/index.html',
            },
          ],
        },
      },
    ];
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog,
      isPackageSandboxActive: (id) => id === 'org.example.sandbox',
      reservePackageSandboxMutation: () => ({ release: () => undefined }),
    });
    await service.initialize();
    await service.install('com.tomni.core');
    await service.install('org.example.sandbox');

    await expect(service.uninstall('com.tomni.core')).rejects.toThrow(/core package/i);
    await expect(service.uninstall('org.example.sandbox')).rejects.toThrow(/sandbox is active/i);
    await expect(service.status('com.tomni.core')).resolves.toMatchObject({ state: 'installed' });
    await expect(service.status('org.example.sandbox')).resolves.toMatchObject({ state: 'installed' });
  });

  it('fails closed when sandbox activity cannot be determined', async () => {
    const rootDir = await tempRoot();
    const baseManifest = bundledCatalog()[0]!.manifest;
    const packageId = 'org.example.sandbox-unknown';
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [
        {
          delivery: 'bundled-legacy',
          trust: 'trusted-first-party',
          manifest: {
            ...baseManifest,
            id: packageId,
            name: 'Sandbox with unknown activity',
            modules: [
              {
                id: 'sandbox',
                title: 'Sandbox',
                surface: 'sandboxed/main',
                pinnable: true,
                runtime: 'sandboxed-web',
                entrypoint: 'sandboxed/index.html',
              },
            ],
          },
        },
      ],
    });
    await service.initialize();
    await service.install(packageId);

    await expect(service.uninstall(packageId)).rejects.toThrow(/sandbox activity.*unavailable/i);
    await expect(service.status(packageId)).resolves.toMatchObject({ state: 'installed' });
  });

  it('preserves an active core dependency and provenance when an update activation fails', async () => {
    const rootDir = await tempRoot();
    const base = bundledCatalog()[0]!;
    const core: PackageCatalogEntry = {
      ...base,
      installScope: 'core',
      manifest: { ...base.manifest, id: 'com.tomni.core', name: 'Core' },
    };
    const extensionVersionOne: PackageCatalogEntry = {
      ...base,
      manifest: {
        ...base.manifest,
        id: 'org.example.extension',
        publisherId: 'org.example',
        name: 'Extension',
        version: '1.0.0',
        dependencies: [{ id: core.manifest.id, version: '^1.0.0' }],
      },
    };
    const extensionVersionTwo: PackageCatalogEntry = {
      ...extensionVersionOne,
      manifest: {
        ...extensionVersionOne.manifest,
        version: '2.0.0',
        dependencies: [{ id: core.manifest.id, version: '^2.0.0' }],
      },
    };
    let currentCatalog: PackageCatalogEntry[] = [core, extensionVersionOne];
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: currentCatalog,
      catalogLoader: async () => currentCatalog,
    });
    await service.initialize();
    await service.install(core.manifest.id);
    await service.install(extensionVersionOne.manifest.id);
    const persistedBefore = JSON.parse(await readFile(path.join(rootDir, 'installed.json'), 'utf8')) as {
      packages: InstalledPackageRecord[];
    };
    const coreProvenance = persistedBefore.packages.find(({ id }) => id === core.manifest.id)?.provenance;

    currentCatalog = [core, extensionVersionTwo];
    await service.refreshCatalog();

    await expect(service.install(extensionVersionTwo.manifest.id)).rejects.toMatchObject({
      message: 'PACKAGE_DEPENDENCY_INCOMPATIBLE_VERSION',
      failure: { phase: 'install', code: 'PACKAGE_DEPENDENCY_INCOMPATIBLE_VERSION' },
    });
    await expect(service.status(extensionVersionTwo.manifest.id)).resolves.toMatchObject({
      state: 'installed',
      installedVersion: '1.0.0',
      enabled: true,
      lastError: 'PACKAGE_DEPENDENCY_INCOMPATIBLE_VERSION',
    });
    expect((await service.contributions()).snapshot.packageIds).toEqual(['com.tomni.core', 'org.example.extension']);

    await expect(service.status(core.manifest.id)).resolves.toMatchObject({ state: 'installed', enabled: true });

    const persistedAfter = JSON.parse(await readFile(path.join(rootDir, 'installed.json'), 'utf8')) as {
      packages: InstalledPackageRecord[];
    };
    expect(persistedAfter.packages.find(({ id }) => id === core.manifest.id)?.provenance).toEqual(coreProvenance);
  });

  it('fails closed before an install can activate a cyclic catalog dependency', async () => {
    const rootDir = await tempRoot();
    const base = bundledCatalog()[0]!;
    const alpha: PackageCatalogEntry = {
      ...base,
      manifest: {
        ...base.manifest,
        id: 'org.example.alpha',
        publisherId: 'org.example',
        name: 'Alpha',
        dependencies: [{ id: 'org.example.beta', version: '^1.0.0' }],
      },
    };
    const beta: PackageCatalogEntry = {
      ...base,
      manifest: {
        ...base.manifest,
        id: 'org.example.beta',
        publisherId: 'org.example',
        name: 'Beta',
        dependencies: [{ id: alpha.manifest.id, version: '^1.0.0' }],
      },
    };
    const service = createPackageManagerService({ rootDir, appVersion: '1.2.0', catalog: [alpha, beta] });
    await service.initialize();

    await expect(service.install(alpha.manifest.id)).rejects.toMatchObject({
      message: 'PACKAGE_DEPENDENCY_CYCLE',
      failure: { phase: 'install', code: 'PACKAGE_DEPENDENCY_CYCLE' },
    });
    await expect(service.status(alpha.manifest.id)).resolves.toMatchObject({
      state: 'failed',
      enabled: false,
      lastError: 'PACKAGE_DEPENDENCY_CYCLE',
    });
    await expect(service.status(beta.manifest.id)).resolves.toMatchObject({ state: 'available', enabled: false });
    expect((await service.contributions()).snapshot.packageIds).toEqual([]);
  });

  it('projects Store contributions across install, restart and uninstall', async () => {
    const rootDir = await tempRoot();
    const catalog = contributionCatalog();
    const service = createPackageManagerService({ rootDir, appVersion: '1.2.0', catalog });
    await service.initialize();
    await service.install('com.tomni.ide');
    await service.install('org.example.wiki');

    const installedContributions = await service.contributions();
    expect(installedContributions.diagnostics).toEqual([]);
    expect(installedContributions.snapshot.subtabs).toEqual([
      expect.objectContaining({ key: 'org.example.wiki/wiki', packageId: 'org.example.wiki' }),
    ]);

    const restarted = createPackageManagerService({ rootDir, appVersion: '1.2.0', catalog });
    await restarted.initialize();
    const restoredContributions = await restarted.contributions();
    expect(restoredContributions.snapshot.packageIds).toEqual(installedContributions.snapshot.packageIds);
    expect(restoredContributions.snapshot.subtabs).toEqual(installedContributions.snapshot.subtabs);

    await restarted.uninstall('org.example.wiki');
    expect((await restarted.contributions()).snapshot.subtabs).toEqual([]);
  });

  it('durably quarantines an exact Store-revoked Surface, removes it, and invalidates active sandbox runtimes', async () => {
    const rootDir = await tempRoot();
    const registry = createPackageRuntimeRegistry();
    const baseEntry = contributionCatalog()[0]!;
    const activeEntry: PackageCatalogEntry = {
      ...baseEntry,
      manifest: {
        ...baseEntry.manifest,
        modules: [{ ...baseEntry.manifest.modules[0]!, runtime: 'sandboxed-web', entrypoint: 'index.html' }],
        artifact: {
          integrity: `sha256-${'a'.repeat(64)}`,
          sizeBytes: 0,
          signature: { algorithm: 'ed25519', keyId: 'test-key', value: 'test-signature' },
        },
      },
    };
    let currentCatalog: PackageCatalogEntry[] = [activeEntry];
    const createService = () =>
      createPackageManagerService({
        rootDir,
        appVersion: '1.2.0',
        catalog: currentCatalog,
        catalogLoader: async () => currentCatalog,
        isPackageSandboxActive: (packageId) => registry.isActive(packageId),
        reservePackageSandboxMutation: (packageId) => registry.reserveMutation(packageId),
        revokePackageSandbox: (packageId) => registry.revokePackage(packageId),
      });
    const service = createService();
    await service.initialize();
    await service.install(activeEntry.manifest.id);
    expect((await service.contributions()).snapshot.apps).toEqual([
      expect.objectContaining({ packageId: activeEntry.manifest.id, id: 'ide' }),
    ]);
    registry.open(
      'renderer-1',
      runtimeOpenRequest(activeEntry.manifest.id, 'ide-runtime', { ...activeEntry.manifest, moduleId: 'ide' })
    );

    currentCatalog = [
      {
        ...activeEntry,
        revocation: {
          schemaVersion: 1,
          reasonCode: 'MALWARE_DETECTED',
          revokedAt: '2030-01-01T00:00:00.000Z',
        },
      },
    ];
    await service.refreshCatalog();

    await expect(service.status(activeEntry.manifest.id)).resolves.toMatchObject({
      state: 'quarantined',
      enabled: false,
      lastError: 'PACKAGE_CATALOG_REVOKED',
    });
    expect((await service.contributions()).snapshot.apps).toEqual([]);
    expect(registry.isActive(activeEntry.manifest.id)).toBe(false);
    await expect(service.enable(activeEntry.manifest.id)).rejects.toThrow(/revoked by the Store catalog/i);

    const restarted = createService();
    await restarted.initialize();
    await expect(restarted.status(activeEntry.manifest.id)).resolves.toMatchObject({
      state: 'quarantined',
      enabled: false,
      lastError: 'PACKAGE_CATALOG_REVOKED',
    });
    expect((await restarted.contributions()).snapshot.apps).toEqual([]);
  });

  it('does not quarantine a different installed artifact that merely shares a revoked package identity and version', async () => {
    const rootDir = await tempRoot();
    const baseEntry = contributionCatalog()[0]!;
    const installedEntry: PackageCatalogEntry = {
      ...baseEntry,
      manifest: { ...baseEntry.manifest, description: 'Installed artifact content.' },
    };
    const revokedCatalogEntry: PackageCatalogEntry = {
      ...baseEntry,
      revocation: {
        schemaVersion: 1,
        reasonCode: 'MALWARE_DETECTED',
        revokedAt: '2030-01-01T00:00:00.000Z',
      },
    };
    let currentCatalog = [installedEntry];
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: currentCatalog,
      catalogLoader: async () => currentCatalog,
    });
    await service.initialize();
    await service.install(installedEntry.manifest.id);

    currentCatalog = [revokedCatalogEntry];
    await service.refreshCatalog();

    await expect(service.status(installedEntry.manifest.id)).resolves.toMatchObject({
      state: 'installed',
      enabled: true,
    });
    expect((await service.contributions()).snapshot.apps).toEqual([
      expect.objectContaining({ packageId: installedEntry.manifest.id }),
    ]);
  });

  it('isolates listener errors and sends immutable, non-sensitive lifecycle snapshots after durable commits', async () => {
    const rootDir = await tempRoot();
    const service = createPackageManagerService({ rootDir, appVersion: '1.2.0', catalog: contributionCatalog() });
    const revisions: number[] = [];
    const observedPackageIds: string[] = [];
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    service.onStateChanged((event) => {
      (event as { id: string }).id = 'tampered-package';
    });
    service.onStateChanged(() => {
      throw new Error('state listener secret=do-not-log');
    });
    service.onStateChanged(({ id }) => observedPackageIds.push(id));
    service.onContributionsChanged((event) => {
      (event as { revision: number }).revision = -1;
    });
    service.onContributionsChanged(() => {
      throw new Error('contribution listener secret=do-not-log');
    });
    service.onContributionsChanged(({ revision }) => revisions.push(revision));

    await service.initialize();
    await expect(service.install('com.tomni.ide')).resolves.toMatchObject({ state: 'installed' });
    await expect(service.install('org.example.wiki')).resolves.toMatchObject({ state: 'installed' });
    await expect(service.uninstall('org.example.wiki')).resolves.toMatchObject({ state: 'available' });

    expect(observedPackageIds).toContain('com.tomni.ide');
    expect(observedPackageIds).not.toContain('tampered-package');
    expect(revisions).toEqual([1, 2, 3, 4]);
    expect(errorLog.mock.calls).toEqual(
      expect.arrayContaining([
        ['[PackagePlatform] State listener failed.'],
        ['[PackagePlatform] Contribution listener failed.'],
      ])
    );
    expect(errorLog.mock.calls.every((call) => call.length === 1)).toBe(true);
    expect((await service.contributions()).snapshot.subtabs).toEqual([]);
  });

  it('does not publish contributions until the durable state commit completes', async () => {
    const rootDir = await tempRoot();
    const records = new Map<string, InstalledPackageRecord>();
    let blockExtensionSave = false;
    let releaseSave = (): void => undefined;
    let markSaveStarted = (): void => undefined;
    const saveStarted = new Promise<void>((resolve) => {
      markSaveStarted = resolve;
    });
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const stateStore: PackageStateStore = {
      initialize: async () => undefined,
      list: () => [...records.values()].map((record) => structuredClone(record)),
      get: (id) => {
        const record = records.get(id);
        return record ? structuredClone(record) : undefined;
      },
      save: async (record) => {
        if (blockExtensionSave && record.id === 'org.example.wiki') {
          markSaveStarted();
          await saveGate;
        }
        records.set(record.id, structuredClone(record));
      },
      remove: async (id) => {
        records.delete(id);
      },
    };
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: contributionCatalog(),
      stateStore,
    });
    await service.initialize();
    await service.install('com.tomni.ide');
    blockExtensionSave = true;

    const installing = service.install('org.example.wiki');
    await saveStarted;
    expect((await service.contributions()).snapshot.subtabs).toEqual([]);
    releaseSave();
    await installing;
    expect((await service.contributions()).snapshot.subtabs).toHaveLength(1);
  });

  it('restores Json state-store memory when an atomic flush fails', async () => {
    const rootDir = await tempRoot();
    const filePath = path.join(rootDir, 'installed.json');
    const store = new JsonPackageStateStore(filePath);
    await store.initialize();
    const record: InstalledPackageRecord = {
      id: 'com.tomni.ide',
      version: '1.0.0',
      state: 'installed',
      delivery: 'bundled-legacy',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
      manifest: contributionCatalog()[0]!.manifest,
      trust: 'trusted-first-party',
    };
    await store.save(record);
    filesystemFailures.rejectTemporaryRename = true;
    try {
      await expect(store.remove(record.id)).rejects.toThrow();
      expect(store.get(record.id)).toEqual(record);
      await expect(store.save({ ...record, id: 'com.tomni.other' })).rejects.toThrow();
      expect(store.get('com.tomni.other')).toBeUndefined();
    } finally {
      filesystemFailures.rejectTemporaryRename = false;
    }
  });

  it('keeps the active registry and cleans the temporary file after an atomic rename failure', async () => {
    const rootDir = await tempRoot();
    const filePath = path.join(rootDir, 'installed.json');
    const store = new JsonPackageStateStore(filePath);
    await store.initialize();
    const manifest = contributionCatalog()[0]!.manifest;
    const record: InstalledPackageRecord = {
      id: manifest.id,
      version: manifest.version,
      state: 'installed',
      delivery: 'bundled-legacy',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
      manifest,
      trust: 'trusted-first-party',
    };
    await store.save(record);

    filesystemFailures.rejectTemporaryRename = true;
    await expect(store.remove(record.id)).rejects.toThrow('simulated state-store rename failure');
    filesystemFailures.rejectTemporaryRename = false;

    expect(store.get(record.id)).toEqual(record);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({ packages: [record] });
    expect((await readdir(rootDir)).some((name) => name.endsWith('.tmp'))).toBe(false);

    const restarted = new JsonPackageStateStore(filePath);
    await restarted.initialize();
    expect(restarted.get(record.id)).toEqual(record);
  });

  it('quarantines duplicate and identity-mismatched installed-state records', async () => {
    const rootDir = await tempRoot();
    const manifest = contributionCatalog()[0]!.manifest;
    const record: InstalledPackageRecord = {
      id: manifest.id,
      version: manifest.version,
      state: 'installed',
      delivery: 'bundled-legacy',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
      manifest,
      trust: 'trusted-first-party',
    };
    const cases: Array<{ name: string; packages: InstalledPackageRecord[] }> = [
      { name: 'duplicate', packages: [record, { ...record, updatedAt: 2 }] },
      { name: 'mismatched', packages: [{ ...record, id: 'org.example.mismatched-state' }] },
    ];

    for (const testCase of cases) {
      const filePath = path.join(rootDir, `installed-${testCase.name}.json`);
      await writeFile(filePath, JSON.stringify({ schemaVersion: 1, packages: testCase.packages }));
      const store = new JsonPackageStateStore(filePath);

      await store.initialize();

      expect(store.list()).toEqual([]);
      expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({ schemaVersion: 1, packages: [] });
      expect((await readdir(rootDir)).some((name) => name.startsWith(`${path.basename(filePath)}.corrupt-`))).toBe(
        true
      );
    }
  });

  it('preserves valid installed records when another persisted manifest is malformed', async () => {
    const rootDir = await tempRoot();
    const filePath = path.join(rootDir, 'installed.json');
    const manifest = contributionCatalog()[0]!.manifest;
    const valid: InstalledPackageRecord = {
      id: manifest.id,
      version: manifest.version,
      state: 'installed',
      delivery: 'bundled-legacy',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
      manifest,
      trust: 'trusted-first-party',
    };
    const malformed = {
      ...valid,
      id: 'org.example.malformed',
      manifest: { ...manifest, id: 'org.example.malformed', description: 'x'.repeat(256 * 1024 + 1) },
    };
    const corruptedState = JSON.stringify({ schemaVersion: 1, packages: [valid, malformed] });
    const recover = async (): Promise<void> => {
      await writeFile(filePath, corruptedState);
      const store = new JsonPackageStateStore(filePath);
      await store.initialize();
      expect(store.list()).toEqual([valid]);
      expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({ schemaVersion: 1, packages: [valid] });
    };

    for (let recovery = 0; recovery < 9; recovery += 1) await recover();

    const backups = (await readdir(rootDir)).filter((name) => name.startsWith(`${path.basename(filePath)}.corrupt-`));
    expect(backups).toHaveLength(8);
    expect(new Set(backups).size).toBe(8);
  });

  it('preserves an existing corrupt-state backup when quarantining another file', async () => {
    const rootDir = await tempRoot();
    const filePath = path.join(rootDir, 'installed.json');
    const previousBackup = filePath + '.corrupt-42';
    const malformed = '{broken';
    await writeFile(filePath, malformed);
    await writeFile(previousBackup, 'older backup');

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(42);
    try {
      for (let recovery = 0; recovery < 9; recovery += 1) {
        await writeFile(filePath, malformed);
        const store = new JsonPackageStateStore(filePath);
        await store.initialize();
      }

      expect(await readFile(previousBackup, 'utf8')).toBe('older backup');
      const newBackups = (await readdir(rootDir)).filter((name) =>
        name.startsWith(path.basename(filePath) + '.corrupt-42-')
      );
      expect(newBackups).toHaveLength(8);
      await expect(readFile(path.join(rootDir, newBackups[0]!), 'utf8')).resolves.toBe(malformed);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('isolates an invalid extension at startup and persists its diagnostic state', async () => {
    const rootDir = await tempRoot();
    const catalog = contributionCatalog('^2.0.0');
    const timestamp = 10;
    const installedRecords: InstalledPackageRecord[] = catalog.map((entry) => ({
      id: entry.manifest.id,
      version: entry.manifest.version,
      state: 'installed',
      delivery: entry.delivery,
      enabled: true,
      installedAt: timestamp,
      updatedAt: timestamp,
      manifest: structuredClone(entry.manifest),
      trust: entry.trust,
    }));
    await mkdir(rootDir, { recursive: true });
    await writeFile(
      path.join(rootDir, 'installed.json'),
      JSON.stringify({ schemaVersion: 1, packages: installedRecords })
    );

    const service = createPackageManagerService({ rootDir, appVersion: '1.2.0', catalog, now: () => 20 });
    await service.initialize();
    const state = await service.contributions();
    expect(state.snapshot.packageIds).toEqual(['com.tomni.ide']);
    expect(state.diagnostics).toEqual([
      expect.objectContaining({ packageId: 'org.example.wiki', code: 'host-api-incompatible' }),
    ]);
    expect(await service.status('org.example.wiki')).toMatchObject({
      state: 'quarantined',
      enabled: false,
      lastError: 'PACKAGE_QUARANTINED',
    });

    const persisted = JSON.parse(await readFile(path.join(rootDir, 'installed.json'), 'utf8')) as {
      packages: InstalledPackageRecord[];
    };
    expect(persisted.packages.find(({ id }) => id === 'org.example.wiki')).toMatchObject({
      state: 'quarantined',
      enabled: false,
      lastError: expect.stringContaining('host-api-incompatible'),
    });
  });

  it('preserves sandbox repair state when activity is active, unavailable, or probe fails', async () => {
    const rootDir = await tempRoot();
    const id = 'org.example.reconcile-active-sandbox';
    const currentVersion = '2.0.0';
    const previousVersion = '1.0.0';
    const previousPayloadRoot = path.join(rootDir, 'packages', id, previousVersion);
    await mkdir(previousPayloadRoot, { recursive: true });
    await writeFile(path.join(previousPayloadRoot, 'index.html'), '<main>Previous sandbox</main>');

    const artifact = await computeArtifactIntegrity(previousPayloadRoot);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const signedManifest = (version: string): PackageManifest => {
      const unsignedManifest: PackageManifest = {
        ...bundledCatalog()[0]!.manifest,
        id,
        publisherId: 'org.example',
        name: 'Repair sandbox',
        version,
        modules: [
          {
            id: 'sandbox',
            title: 'Sandbox',
            surface: 'sandboxed/main',
            pinnable: true,
            runtime: 'sandboxed-web',
            entrypoint: 'index.html',
          },
        ],
        artifact: {
          ...artifact,
          signature: { algorithm: 'ed25519', keyId: 'test-key', value: '' },
        },
      };
      const signature = sign(null, Buffer.from(packageSignaturePayload(unsignedManifest)), privateKey).toString(
        'base64'
      );
      return {
        ...unsignedManifest,
        artifact: {
          ...unsignedManifest.artifact!,
          signature: { algorithm: 'ed25519', keyId: 'test-key', value: signature },
        },
      };
    };
    const previousManifest = signedManifest(previousVersion);
    const currentManifest = signedManifest(currentVersion);
    await writeFile(path.join(previousPayloadRoot, 'tomny-package.json'), JSON.stringify(previousManifest));

    let record: InstalledPackageRecord = {
      id,
      version: currentVersion,
      previousVersion,
      state: 'installed',
      delivery: 'downloaded-package',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
      manifest: currentManifest,
      trust: 'signed-store',
      provenance: {
        source: 'store',
        scope: 'optional',
        version: currentVersion,
        integrity: currentManifest.artifact!.integrity,
      },
    };
    const installedRecord = structuredClone(record);
    const stateStore: PackageStateStore = {
      initialize: async () => undefined,
      list: () => [structuredClone(record)],
      get: (packageId) => (packageId === id ? structuredClone(record) : undefined),
      save: async (nextRecord) => {
        record = structuredClone(nextRecord);
      },
      remove: async () => undefined,
    };
    const createRepairService = (activityProbe?: (packageId: string) => boolean | Promise<boolean>) =>
      createPackageManagerService({
        rootDir,
        appVersion: '2.1.0',
        catalog: [{ manifest: currentManifest, delivery: 'downloaded-package', trust: 'signed-store' }],
        stateStore,
        trustedKeys: { 'test-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
        ...(activityProbe ? { isPackageSandboxActive: activityProbe } : {}),
      });
    const expectRepairStateUnchanged = (): void => {
      expect(record).toEqual(installedRecord);
    };

    const activeProbe = vi.fn((packageId: string) => packageId === id);
    await expect(createRepairService(activeProbe).initialize()).rejects.toThrow(/sandbox is active/i);
    expectRepairStateUnchanged();
    expect(activeProbe).toHaveBeenCalledWith(id);

    record = structuredClone(installedRecord);
    await expect(createRepairService().initialize()).rejects.toThrow(/sandbox activity.*unavailable/i);
    expectRepairStateUnchanged();

    record = structuredClone(installedRecord);
    const thrownProbeError = new Error('sandbox activity probe threw');
    await expect(
      createRepairService(() => {
        throw thrownProbeError;
      }).initialize()
    ).rejects.toBe(thrownProbeError);
    expectRepairStateUnchanged();

    record = structuredClone(installedRecord);
    const rejectedProbeError = new Error('sandbox activity probe rejected');
    await expect(createRepairService(() => Promise.reject(rejectedProbeError)).initialize()).rejects.toBe(
      rejectedProbeError
    );
    expectRepairStateUnchanged();
    await expect(readFile(path.join(previousPayloadRoot, 'index.html'), 'utf8')).resolves.toContain('Previous sandbox');
  });

  it('quarantines an optional package with an inconsistent owned payload without deleting it', async () => {
    const rootDir = await tempRoot();
    const id = 'org.example.reconcile-optional';
    const version = '1.0.0';
    const registryManifest: PackageManifest = { ...bundledCatalog()[0]!.manifest, id, version };
    const diskManifest: PackageManifest = { ...registryManifest, version: '2.0.0' };
    const payloadRoot = path.join(rootDir, 'packages', id, version);
    const sentinelPath = path.join(payloadRoot, 'keep-for-repair.txt');
    await mkdir(payloadRoot, { recursive: true });
    await writeFile(path.join(payloadRoot, 'tomny-package.json'), JSON.stringify(diskManifest));
    await writeFile(sentinelPath, 'preserve this payload');

    let record: InstalledPackageRecord = {
      id,
      version,
      state: 'installed',
      delivery: 'downloaded-package',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
      manifest: registryManifest,
      trust: 'signed-store',
      provenance: { source: 'store', scope: 'optional', version },
    };
    const stateStore: PackageStateStore = {
      initialize: async () => undefined,
      list: () => [structuredClone(record)],
      get: (packageId) => (packageId === id ? structuredClone(record) : undefined),
      save: async (nextRecord) => {
        record = structuredClone(nextRecord);
      },
      remove: async () => undefined,
    };
    const catalog: PackageCatalogEntry[] = [
      { manifest: registryManifest, delivery: 'downloaded-package', trust: 'signed-store' },
    ];
    const service = createPackageManagerService({ rootDir, appVersion: '1.2.0', catalog, stateStore });

    await service.initialize();

    expect(record).toMatchObject({
      state: 'quarantined',
      enabled: false,
      lastError: 'PACKAGE_PAYLOAD_INCONSISTENT',
    });
    await expect(service.status(id)).resolves.toMatchObject({
      state: 'quarantined',
      enabled: false,
      lastError: 'PACKAGE_PAYLOAD_INCONSISTENT',
    });
    expect((await service.contributions()).diagnostics).toEqual([
      {
        packageId: id,
        code: 'payload-inconsistent',
        failure: { phase: 'restore', code: 'PACKAGE_PAYLOAD_INCONSISTENT' },
      },
    ]);
    await expect(readFile(sentinelPath, 'utf8')).resolves.toBe('preserve this payload');
  });

  it('fails a core package closed into repair-required without deleting its payload', async () => {
    const rootDir = await tempRoot();
    const id = 'com.tomni.reconcile-core';
    const version = '1.0.0';
    const registryManifest: PackageManifest = { ...bundledCatalog()[0]!.manifest, id, version };
    const diskManifest: PackageManifest = { ...registryManifest, version: '2.0.0' };
    const payloadRoot = path.join(rootDir, 'packages', id, version);
    const sentinelPath = path.join(payloadRoot, 'keep-for-repair.txt');
    await mkdir(payloadRoot, { recursive: true });
    await writeFile(path.join(payloadRoot, 'tomny-package.json'), JSON.stringify(diskManifest));
    await writeFile(sentinelPath, 'preserve core payload');

    let record: InstalledPackageRecord = {
      id,
      version,
      state: 'installed',
      delivery: 'downloaded-package',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
      manifest: registryManifest,
      trust: 'signed-store',
      provenance: { source: 'store', scope: 'core', version },
    };
    const stateStore: PackageStateStore = {
      initialize: async () => undefined,
      list: () => [structuredClone(record)],
      get: (packageId) => (packageId === id ? structuredClone(record) : undefined),
      save: async (nextRecord) => {
        record = structuredClone(nextRecord);
      },
      remove: async () => undefined,
    };
    const catalog: PackageCatalogEntry[] = [
      {
        manifest: registryManifest,
        delivery: 'downloaded-package',
        trust: 'signed-store',
        installScope: 'core',
      },
    ];
    const service = createPackageManagerService({ rootDir, appVersion: '1.2.0', catalog, stateStore });

    await service.initialize();

    expect(record).toMatchObject({
      state: 'failed',
      enabled: false,
      lastError: 'PACKAGE_CORE_REPAIR_REQUIRED',
    });
    await expect(service.status(id)).resolves.toMatchObject({
      state: 'failed',
      enabled: false,
      lastError: 'PACKAGE_CORE_REPAIR_REQUIRED',
    });
    expect((await service.contributions()).diagnostics).toEqual([
      {
        packageId: id,
        code: 'core-repair-required',
        failure: { phase: 'restore', code: 'PACKAGE_CORE_REPAIR_REQUIRED' },
      },
    ]);
    await expect(readFile(sentinelPath, 'utf8')).resolves.toBe('preserve core payload');
  });

  it('quarantines every persisted package in an activation dependency cycle at startup', async () => {
    const rootDir = await tempRoot();
    const base = bundledCatalog()[0]!;
    const alpha: PackageCatalogEntry = {
      ...base,
      manifest: {
        ...base.manifest,
        id: 'org.example.alpha',
        publisherId: 'org.example',
        name: 'Alpha',
        dependencies: [{ id: 'org.example.beta', version: '^1.0.0' }],
      },
    };
    const beta: PackageCatalogEntry = {
      ...base,
      manifest: {
        ...base.manifest,
        id: 'org.example.beta',
        publisherId: 'org.example',
        name: 'Beta',
        dependencies: [{ id: alpha.manifest.id, version: '^1.0.0' }],
      },
    };
    const installedRecords: InstalledPackageRecord[] = [alpha, beta].map((entry) => ({
      id: entry.manifest.id,
      version: entry.manifest.version,
      state: 'installed',
      delivery: entry.delivery,
      enabled: true,
      installedAt: 10,
      updatedAt: 10,
      manifest: structuredClone(entry.manifest),
      trust: entry.trust,
    }));
    await mkdir(rootDir, { recursive: true });
    await writeFile(
      path.join(rootDir, 'installed.json'),
      JSON.stringify({ schemaVersion: 1, packages: installedRecords })
    );

    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [alpha, beta],
      now: () => 20,
    });
    await service.initialize();

    expect((await service.contributions()).diagnostics).toEqual([
      {
        packageId: alpha.manifest.id,
        code: 'dependency-cycle',
        failure: { phase: 'restore', code: 'PACKAGE_DEPENDENCY_CYCLE' },
      },
      {
        packageId: beta.manifest.id,
        code: 'dependency-cycle',
        failure: { phase: 'restore', code: 'PACKAGE_DEPENDENCY_CYCLE' },
      },
    ]);
    await expect(service.status(alpha.manifest.id)).resolves.toMatchObject({ state: 'quarantined', enabled: false });
    await expect(service.status(beta.manifest.id)).resolves.toMatchObject({ state: 'quarantined', enabled: false });
  });

  it('rejects com.tomni namespace packages that only have Store trust', async () => {
    const rootDir = await tempRoot();
    const entry = contributionCatalog()[0]!;
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [{ ...entry, trust: 'signed-store' }],
    });
    await service.initialize();
    await expect(service.install('com.tomni.ide')).rejects.toThrow(/protected com\.tomni namespace/i);
    expect((await service.contributions()).snapshot.packageIds).toEqual([]);
  });

  it('keeps installed metadata across catalog updates and after a product is delisted', async () => {
    const rootDir = await tempRoot();
    const versionOne = bundledCatalog()[0]!;
    const versionTwo: PackageCatalogEntry = {
      ...versionOne,
      manifest: {
        ...versionOne.manifest,
        version: '2.0.0',
        modules: [{ ...versionOne.manifest.modules[0]!, entrypoint: 'v2.html' }],
      },
    };
    let remoteCatalog: PackageCatalogEntry[] = [versionOne];
    const service = createPackageManagerService({
      rootDir,
      appVersion: '2.1.0',
      catalog: [],
      catalogLoader: async () => remoteCatalog,
    });
    await service.initialize();
    await service.install(versionOne.manifest.id);

    remoteCatalog = [versionTwo];
    await service.refreshCatalog();
    const update = await service.status(versionOne.manifest.id);
    expect(update.updateAvailable).toBe(true);
    expect(update.installedManifest?.version).toBe('1.0.0');
    expect(update.installedTrust).toBe(versionOne.trust);
    expect(update.manifest.version).toBe('2.0.0');

    await service.install(versionOne.manifest.id);
    remoteCatalog = [];
    await service.refreshCatalog();
    const delisted = await service.status(versionOne.manifest.id);
    expect(delisted.installedVersion).toBe('2.0.0');
    expect((await service.list({ installedOnly: true }))[0]?.manifest.id).toBe(versionOne.manifest.id);

    await service.uninstall(versionOne.manifest.id);
    expect(await service.list()).toHaveLength(0);
  });

  it('refuses to downgrade an installed package when a stale catalog is loaded', async () => {
    const rootDir = await tempRoot();
    const versionOne = bundledCatalog()[0]!;
    const versionTwo: PackageCatalogEntry = {
      ...versionOne,
      manifest: { ...versionOne.manifest, version: '2.0.0' },
    };
    let remoteCatalog: PackageCatalogEntry[] = [versionTwo];
    const service = createPackageManagerService({
      rootDir,
      appVersion: '2.1.0',
      catalog: [],
      catalogLoader: async () => remoteCatalog,
    });
    await service.initialize();
    await service.install(versionTwo.manifest.id);

    remoteCatalog = [versionOne];
    await service.refreshCatalog();

    await expect(service.install(versionOne.manifest.id)).rejects.toThrow(/downgrade/i);
    expect((await service.status(versionOne.manifest.id)).installedVersion).toBe('2.0.0');
  });

  it('keeps an installed package dependency protected after the catalog publishes a newer manifest', async () => {
    const rootDir = await tempRoot();
    const base = bundledCatalog()[0]!;
    const core: PackageCatalogEntry = {
      ...base,
      manifest: {
        ...base.manifest,
        id: 'org.example.dependency-core',
        publisherId: 'org.example',
        name: 'Dependency core',
      },
    };
    const dependentVersionOne: PackageCatalogEntry = {
      ...base,
      manifest: {
        ...base.manifest,
        id: 'org.example.dependent',
        publisherId: 'org.example',
        name: 'Dependent',
        dependencies: [{ id: core.manifest.id, version: '^1.0.0' }],
      },
    };
    const dependentVersionTwo: PackageCatalogEntry = {
      ...dependentVersionOne,
      manifest: {
        ...dependentVersionOne.manifest,
        version: '2.0.0',
        dependencies: [],
      },
    };
    let remoteCatalog: PackageCatalogEntry[] = [core, dependentVersionOne];
    const service = createPackageManagerService({
      rootDir,
      appVersion: '2.1.0',
      catalog: [],
      catalogLoader: async () => remoteCatalog,
    });
    await service.initialize();
    await service.install(core.manifest.id);
    await service.install(dependentVersionOne.manifest.id);

    remoteCatalog = [core, dependentVersionTwo];
    await service.refreshCatalog();

    await expect(service.uninstall(core.manifest.id)).rejects.toThrow(/required by installed package/i);
    await expect(service.status(core.manifest.id)).resolves.toMatchObject({ state: 'installed' });
  });

  it.each(['missing', 'mismatched'] as const)(
    'fails closed when the durable installed manifest is %s instead of trusting a changed catalog runtime',
    async (manifestState) => {
      const rootDir = await tempRoot();
      const base = bundledCatalog()[0]!;
      const id = 'org.example.ambiguous-uninstall';
      const installedVersion = '1.0.0';
      const catalogEntry: PackageCatalogEntry = {
        ...base,
        manifest: {
          ...base.manifest,
          id,
          publisherId: 'org.example',
          version: installedVersion,
          modules: [{ ...base.manifest.modules[0]!, id: 'changed-catalog-runtime' }],
        },
      };
      let record: InstalledPackageRecord = {
        id,
        version: installedVersion,
        state: 'installed',
        delivery: 'bundled-legacy',
        enabled: true,
        installedAt: 1,
        updatedAt: 1,
        ...(manifestState === 'mismatched' ? { manifest: { ...catalogEntry.manifest, version: '9.0.0' } } : {}),
      };
      const remove = vi.fn(async () => undefined);
      const stateStore: PackageStateStore = {
        initialize: async () => undefined,
        list: () => [structuredClone(record)],
        get: (packageId) => (packageId === id ? structuredClone(record) : undefined),
        save: async (nextRecord) => {
          record = structuredClone(nextRecord);
        },
        remove,
      };
      const service = createPackageManagerService({
        rootDir,
        appVersion: '2.1.0',
        catalog: [catalogEntry],
        stateStore,
      });
      await service.initialize();
      record = { ...record, state: 'installed', enabled: true };
      const beforeUninstall = structuredClone(record);

      await expect(service.uninstall(id)).rejects.toThrow(/durable installed manifest.*unavailable/i);
      expect(remove).not.toHaveBeenCalled();
      expect(record).toEqual(beforeUninstall);
    }
  );

  it('keeps an active installed sandbox protected after the catalog publishes a newer manifest', async () => {
    const rootDir = await tempRoot();
    const base = bundledCatalog()[0]!;
    const sandboxVersionOne: PackageCatalogEntry = {
      ...base,
      manifest: {
        ...base.manifest,
        id: 'org.example.sandboxed-update',
        publisherId: 'org.example',
        name: 'Sandboxed update',
        modules: [
          {
            id: 'sandbox',
            title: 'Sandbox',
            surface: 'sandboxed/main',
            pinnable: true,
            runtime: 'sandboxed-web',
            entrypoint: 'sandboxed/index.html',
          },
        ],
      },
    };
    const sandboxVersionTwo: PackageCatalogEntry = {
      ...sandboxVersionOne,
      manifest: {
        ...sandboxVersionOne.manifest,
        version: '2.0.0',
        modules: base.manifest.modules,
      },
    };
    let remoteCatalog: PackageCatalogEntry[] = [sandboxVersionOne];
    const registry = createPackageRuntimeRegistry();
    const service = createPackageManagerService({
      rootDir,
      appVersion: '2.1.0',
      catalog: [],
      catalogLoader: async () => remoteCatalog,
      isPackageSandboxActive: (id) => registry.isActive(id),
      reservePackageSandboxMutation: (id) => registry.reserveMutation(id),
    });
    await service.initialize();
    await service.install(sandboxVersionOne.manifest.id);
    registry.open(
      'renderer-1',
      runtimeOpenRequest(sandboxVersionOne.manifest.id, 'runtime-1', { ...sandboxVersionOne.manifest, moduleId: 'ide' })
    );

    remoteCatalog = [sandboxVersionTwo];
    await service.refreshCatalog();

    await expect(service.install(sandboxVersionOne.manifest.id)).rejects.toThrow(/sandbox is active/i);
    await expect(service.status(sandboxVersionOne.manifest.id)).resolves.toMatchObject({
      state: 'installed',
      installedVersion: '1.0.0',
    });

    registry.close('renderer-1', { packageId: sandboxVersionOne.manifest.id, runtimeId: 'runtime-1' });
    await service.install(sandboxVersionOne.manifest.id);
    await expect(service.status(sandboxVersionOne.manifest.id)).resolves.toMatchObject({
      state: 'installed',
      installedVersion: '2.0.0',
    });
    registry.open(
      'renderer-1',
      runtimeOpenRequest(sandboxVersionOne.manifest.id, 'runtime-2', { ...sandboxVersionOne.manifest, moduleId: 'ide' })
    );
    expect(registry.isActive(sandboxVersionOne.manifest.id)).toBe(true);
  });

  it('rejects an incompatible package without changing installed state', async () => {
    const rootDir = await tempRoot();
    const service = createPackageManagerService({ rootDir, appVersion: '0.5.0', catalog: bundledCatalog() });
    await service.initialize();

    await expect(service.install('com.tomni.studio')).rejects.toThrow(/not compatible/i);
    expect((await service.status('com.tomni.studio')).state).toBe('failed');
  });

  it('verifies a signed artifact before returning an asset, including a change during the read', async () => {
    const rootDir = await tempRoot();
    const sourceDirectory = await tempRoot();
    await mkdir(path.join(sourceDirectory, 'dist'), { recursive: true });
    await mkdir(path.join(sourceDirectory, 'runtime'), { recursive: true });
    await writeFile(path.join(sourceDirectory, 'dist', 'main.js'), 'export const ready = true;\n');
    await writeFile(path.join(sourceDirectory, 'runtime', 'sample.cjs'), 'process.exitCode = 0;\n');
    await writeFile(path.join(sourceDirectory, 'payload.bin'), Buffer.from([0xff, 0x00, 0x80]));
    await writeFile(path.join(sourceDirectory, 'index.html'), '<main>Sample</main>');

    const artifact = await computeArtifactIntegrity(sourceDirectory);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const unsignedManifest: PackageManifest = {
      schemaVersion: 1,
      id: 'com.tomni.sample',
      publisherId: 'com.tomni',
      name: 'Sample',
      description: 'Signed Store sample',
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=1.0.0' },
      modules: [
        {
          id: 'main',
          title: 'Sample',
          surface: 'sample/main',
          pinnable: true,
          runtime: 'sandboxed-web',
          entrypoint: 'index.html',
        },
      ],
      permissions: [],
      dependencies: [],
      tags: ['sample'],
      artifact: {
        ...artifact,
        signature: { algorithm: 'ed25519', keyId: 'test-key', value: '' },
      },
    };
    const signature = sign(null, Buffer.from(packageSignaturePayload(unsignedManifest)), privateKey).toString('base64');
    const manifest: PackageManifest = {
      ...unsignedManifest,
      artifact: {
        ...unsignedManifest.artifact!,
        signature: { algorithm: 'ed25519', keyId: 'test-key', value: signature },
      },
    };
    await writeFile(path.join(sourceDirectory, 'tomny-package.json'), JSON.stringify(manifest));

    const catalog: PackageCatalogEntry[] = [
      { manifest, delivery: 'downloaded-package', trust: 'signed-first-party', sourceDirectory },
    ];
    const failingRoot = await tempRoot();
    const failingStore: PackageStateStore = {
      initialize: async () => undefined,
      list: () => [],
      get: () => undefined,
      save: async () => {
        throw new Error('durable state unavailable');
      },
      remove: async () => undefined,
    };
    const failingService = createPackageManagerService({
      rootDir: failingRoot,
      appVersion: '1.2.0',
      catalog,
      stateStore: failingStore,
      trustedKeys: { 'test-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    });
    await failingService.initialize();
    await expect(failingService.install(manifest.id)).rejects.toThrow(/rollback was incomplete/i);
    await expect(access(path.join(failingRoot, 'packages', manifest.id, manifest.version))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await failingService.contributions()).snapshot.packageIds).toEqual([]);

    const trustedKeys: Record<string, string> = {
      'test-key': publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    };
    let installedFile = '';
    let mutateAssetDuringRead = false;
    let returnTamperedAssetAfterRestoringDisk = false;
    let blockAssetRead = false;
    let releaseBlockedAssetRead: (() => void) | undefined;
    let signalAssetReadStarted: (() => void) | undefined;
    let assetReadFileCalls = 0;
    let sandboxCheckReached = false;
    let releaseSandboxCheck: (() => void) | undefined;
    let quiesceCalls = 0;
    let releaseHeldRuntime: (() => void) | undefined;
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog,
      trustedKeys,
      readAssetFile: async (assetPath) => {
        assetReadFileCalls += 1;
        if (mutateAssetDuringRead && assetPath === installedFile) {
          await writeFile(assetPath, 'export const swappedDuringRead = true;\n');
        }
        if (returnTamperedAssetAfterRestoringDisk && assetPath === installedFile) {
          const original = await readFile(assetPath, 'utf8');
          await writeFile(assetPath, 'export const ready = false;\n');
          const tampered = await readFile(assetPath, 'utf8');
          await writeFile(assetPath, original);
          return tampered;
        }
        if (blockAssetRead && assetPath === installedFile) {
          signalAssetReadStarted?.();
          await new Promise<void>((resolve) => {
            releaseBlockedAssetRead = resolve;
          });
        }
        return readFile(assetPath, 'utf8');
      },
      isPackageSandboxActive: async () => {
        sandboxCheckReached = true;
        await new Promise<void>((resolve) => {
          releaseSandboxCheck = resolve;
        });
        return false;
      },
      reservePackageSandboxMutation: () => ({ release: () => undefined }),
      quiescePackageRuntime: async () => {
        quiesceCalls += 1;
        releaseHeldRuntime?.();
      },
    });
    await service.initialize();
    await service.install(manifest.id);

    const runtimeLease = await service.acquireVerifiedRuntimeEntry(manifest.id, 'runtime/sample.cjs');
    expect(runtimeLease.entryPath).toBe(
      path.join(rootDir, 'packages', manifest.id, manifest.version, 'runtime', 'sample.cjs')
    );
    expect(runtimeLease.identity).toMatchObject({
      packageId: manifest.id,
      packageVersion: manifest.version,
      publisherId: manifest.publisherId,
      artifactIntegrity: manifest.artifact?.integrity,
    });
    await expect(service.acquireVerifiedRuntimeEntry(manifest.id, '../runtime/sample.cjs')).rejects.toThrow(
      /path is invalid/i
    );
    runtimeLease.release();

    installedFile = path.join(rootDir, 'packages', manifest.id, manifest.version, 'dist', 'main.js');
    expect(await readFile(installedFile, 'utf8')).toContain('ready');
    delete trustedKeys['test-key'];
    await expect(service.readAsset(manifest.id, 'dist/main.js')).rejects.toThrow(/not trusted/i);
    await expect(service.status(manifest.id)).resolves.toMatchObject({ state: 'quarantined', enabled: false });
    trustedKeys['test-key'] = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    await service.install(manifest.id);

    await writeFile(installedFile, 'export const compromised = true;\n');

    await expect(service.readAsset(manifest.id, 'dist/main.js')).rejects.toThrow(/integrity/i);
    await expect(service.status(manifest.id)).resolves.toMatchObject({
      state: 'quarantined',
      enabled: false,
      lastError: 'PACKAGE_PAYLOAD_INCONSISTENT',
    });
    expect((await service.contributions()).snapshot.packageIds).not.toContain(manifest.id);
    const restarted = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog,
      trustedKeys: { 'test-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    });
    await restarted.initialize();
    expect((await restarted.status(manifest.id)).state).toBe('quarantined');
    await expect(restarted.readAsset(manifest.id, 'dist/main.js')).rejects.toThrow(/not installed/i);

    await restarted.install(manifest.id);
    expect((await restarted.status(manifest.id)).state).toBe('installed');
    await expect(restarted.readAsset(manifest.id, 'dist/main.js')).resolves.toMatchObject({
      content: expect.stringContaining('ready'),
    });
    await expect(restarted.readAsset(manifest.id, 'payload.bin')).rejects.toThrow(/integrity/i);

    await service.install(manifest.id);
    mutateAssetDuringRead = true;
    await expect(service.readAsset(manifest.id, 'dist/main.js')).rejects.toThrow(/integrity/i);
    mutateAssetDuringRead = false;
    await writeFile(installedFile, 'export const ready = true;\n');
    await service.install(manifest.id);
    returnTamperedAssetAfterRestoringDisk = true;
    await expect(service.readAsset(manifest.id, 'dist/main.js')).rejects.toThrow(/integrity/i);
    returnTamperedAssetAfterRestoringDisk = false;
    await service.install(manifest.id);
    const heldRuntimeLease = await service.acquireVerifiedRuntimeEntry(manifest.id, 'runtime/sample.cjs');
    releaseHeldRuntime = heldRuntimeLease.release;
    const quiesceCallsBeforeUninstall = quiesceCalls;
    blockAssetRead = true;
    assetReadFileCalls = 0;
    const assetReadStarted = new Promise<void>((resolve) => {
      signalAssetReadStarted = resolve;
    });
    const assetRead = service.readAsset(manifest.id, 'dist/main.js');
    await assetReadStarted;
    const duplicateAssetRead = service.readAsset(manifest.id, 'dist/main.js');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(assetReadFileCalls).toBe(1);
    const uninstall = service.uninstall(manifest.id);
    const readAfterUninstallQueued = service.readAsset(manifest.id, 'dist/main.js');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(sandboxCheckReached).toBe(false);

    releaseBlockedAssetRead!();
    await expect(assetRead).resolves.toMatchObject({ content: expect.stringContaining('ready') });
    await expect(duplicateAssetRead).resolves.toMatchObject({ content: expect.stringContaining('ready') });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(quiesceCalls).toBe(quiesceCallsBeforeUninstall + 1);
    expect(sandboxCheckReached).toBe(true);
    releaseSandboxCheck!();
    await expect(uninstall).resolves.toMatchObject({ state: 'available' });
    await expect(readAfterUninstallQueued).rejects.toThrow(/not installed/i);
  });

  it('records downloaded-package provenance and removes only its owned payloads', async () => {
    const rootDir = await tempRoot();
    const sourceDirectory = await tempRoot();
    await mkdir(path.join(sourceDirectory, 'dist'), { recursive: true });
    await writeFile(path.join(sourceDirectory, 'dist', 'main.js'), 'export const downloaded = true;\n');

    const artifact = await computeArtifactIntegrity(sourceDirectory);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const unsignedManifest: PackageManifest = {
      schemaVersion: 1,
      id: 'com.tomni.downloaded',
      publisherId: 'com.tomni',
      name: 'Downloaded',
      description: 'Network package',
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=1.0.0' },
      modules: [{ id: 'main', title: 'Downloaded', surface: 'downloaded/main', pinnable: true }],
      permissions: [],
      dependencies: [],
      tags: ['downloaded'],
      artifact: {
        ...artifact,
        signature: { algorithm: 'ed25519', keyId: 'download-key', value: '' },
      },
    };
    const signature = sign(null, Buffer.from(packageSignaturePayload(unsignedManifest)), privateKey).toString('base64');
    const manifest: PackageManifest = {
      ...unsignedManifest,
      artifact: {
        ...unsignedManifest.artifact!,
        signature: { algorithm: 'ed25519', keyId: 'download-key', value: signature },
      },
    };
    const archive = new JSZip();
    archive.file('dist/main.js', await readFile(path.join(sourceDirectory, 'dist', 'main.js')));
    archive.file('tomny-package.json', JSON.stringify(manifest));
    const archiveBytes = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        'content-length': String(archiveBytes.byteLength),
        'content-type': 'application/zip',
      });
      response.end(archiveBytes);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test package server did not start.');

    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [
        {
          manifest,
          delivery: 'downloaded-package',
          trust: 'signed-first-party',
          artifactUrl: `http://127.0.0.1:${address.port}/download.tomni-package`,
        },
      ],
      trustedKeys: { 'download-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
      allowLocalArtifactUrls: true,
    });
    await service.initialize();
    await service.install(manifest.id);

    await expect(
      readFile(path.join(rootDir, 'packages', manifest.id, manifest.version, 'dist', 'main.js'), 'utf8')
    ).resolves.toContain('downloaded');
    await expect(readdir(path.join(rootDir, '.downloads'))).resolves.toHaveLength(0);
    const packageRoot = path.join(rootDir, 'packages', manifest.id);
    const ownedPayload = path.join(packageRoot, manifest.version);
    const unownedPayload = path.join(packageRoot, 'operator-notes.txt');
    await writeFile(unownedPayload, 'retain this non-package file');
    const persisted = JSON.parse(await readFile(path.join(rootDir, 'installed.json'), 'utf8')) as {
      packages: InstalledPackageRecord[];
    };
    expect(persisted.packages.find(({ id }) => id === manifest.id)?.provenance).toEqual({
      source: 'store',
      scope: 'optional',
      version: manifest.version,
      integrity: manifest.artifact!.integrity,
    });

    await service.uninstall(manifest.id);

    await expect(access(ownedPayload)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(unownedPayload, 'utf8')).resolves.toBe('retain this non-package file');
  });

  it('rolls back a promoted download when registry persistence and temporary cleanup both fail', async () => {
    const rootDir = await tempRoot();
    const packageId = 'com.tomni.calculator';
    const version = '1.0.0';
    const transactionId = 'cleanup-failure';
    const artifactBytes = await readFile(
      path.resolve('store-artifacts', 'com.tomni.calculator-1.0.0.tomni-package.json')
    );
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        'content-length': String(artifactBytes.byteLength),
        'content-type': 'application/vnd.tomni.package+json',
      });
      response.end(artifactBytes);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test package server did not start.');

    const failingStore: PackageStateStore = {
      initialize: async () => undefined,
      list: () => [],
      get: () => undefined,
      save: async () => {
        throw new Error('durable state unavailable');
      },
      remove: async () => undefined,
    };
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: createFirstPartyPackageCatalog(
        'http://127.0.0.1:' + address.port + '/com.tomni.calculator-1.0.0.tomni-package.json'
      ),
      stateStore: failingStore,
      trustedKeys: FIRST_PARTY_PACKAGE_TRUSTED_KEYS,
      allowLocalArtifactUrls: true,
      randomId: () => transactionId,
    });
    await service.initialize();

    const downloadedSource = path.join(rootDir, '.downloads', packageId + '-' + version + '-' + transactionId);
    filesystemFailures.removePath = downloadedSource;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(service.install(packageId)).rejects.toThrow(/rollback was incomplete/i);
      await expect(access(path.join(rootDir, 'packages', packageId, version))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(access(downloadedSource)).resolves.toBeUndefined();
      expect((await service.contributions()).snapshot.packageIds).toEqual([]);
      expect(errorSpy).toHaveBeenCalledWith(
        '[PackagePlatform] Failed to finalize downloaded artifact cleanup:',
        expect.any(Error)
      );
    } finally {
      errorSpy.mockRestore();
      filesystemFailures.removePath = undefined;
    }

    const restarted = createPackageManagerService({ rootDir, appVersion: '1.2.0', catalog: [] });
    await restarted.initialize();
    await expect(readdir(path.join(rootDir, '.downloads'))).resolves.toEqual([]);
  });

  it('removes a partially extracted download when archive extraction fails', async () => {
    const rootDir = await tempRoot();
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const unsignedManifest: PackageManifest = {
      ...bundledCatalog()[0]!.manifest,
      id: 'com.tomni.partial-download',
      name: 'Partial Download',
      artifact: {
        integrity: `sha256-${'0'.repeat(64)}`,
        sizeBytes: 6,
        signature: { algorithm: 'ed25519', keyId: 'partial-download-key', value: '' },
      },
    };
    const manifest: PackageManifest = {
      ...unsignedManifest,
      artifact: {
        ...unsignedManifest.artifact!,
        signature: {
          ...unsignedManifest.artifact!.signature,
          value: sign(null, Buffer.from(packageSignaturePayload(unsignedManifest)), privateKey).toString('base64'),
        },
      },
    };
    const bundle = Buffer.from(
      JSON.stringify({
        format: 'tomni-package-bundle-v1',
        manifest,
        files: {
          'partial.txt': Buffer.from('ok').toString('base64'),
          'partial.txt/child.txt': Buffer.from('stop').toString('base64'),
        },
      })
    );
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        'content-length': String(bundle.byteLength),
        'content-type': 'application/vnd.tomni.package+json',
      });
      response.end(bundle);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test package server did not start.');
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [
        {
          manifest,
          delivery: 'downloaded-package',
          trust: 'signed-first-party',
          artifactUrl: `http://127.0.0.1:${address.port}/partial.tomni-package.json`,
        },
      ],
      trustedKeys: {
        'partial-download-key': publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
      allowLocalArtifactUrls: true,
    });
    await service.initialize();

    await expect(service.install(manifest.id)).rejects.toBeInstanceOf(Error);
    await expect(readdir(path.join(rootDir, '.downloads'))).resolves.toEqual([]);
    await expect(access(path.join(rootDir, 'packages', manifest.id))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('installs the first-party Calculator runtime and preserves an unowned prior version on removal', async () => {
    const rootDir = await tempRoot();
    const artifactBytes = await readFile(
      path.resolve('store-artifacts', 'com.tomni.calculator-1.0.0.tomni-package.json')
    );
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        'content-length': String(artifactBytes.byteLength),
        'content-type': 'application/vnd.tomni.package+json',
      });
      response.end(artifactBytes);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test package server did not start.');

    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: createFirstPartyPackageCatalog(
        `http://127.0.0.1:${address.port}/com.tomni.calculator-1.0.0.tomni-package.json`
      ),
      trustedKeys: FIRST_PARTY_PACKAGE_TRUSTED_KEYS,
      allowLocalArtifactUrls: true,
      isPackageSandboxActive: () => false,
      reservePackageSandboxMutation: () => ({ release: () => undefined }),
    });
    await service.initialize();
    await service.install('com.tomni.calculator');

    const runtime = await service.readAsset('com.tomni.calculator', 'index.html');
    expect(runtime.content).toContain('<title>Calculator</title>');

    const previousVersion = path.join(rootDir, 'packages', 'com.tomni.calculator', '0.9.0');
    await mkdir(previousVersion, { recursive: true });
    await writeFile(path.join(previousVersion, 'legacy.txt'), 'old package version');
    await service.uninstall('com.tomni.calculator');
    await expect(service.readAsset('com.tomni.calculator', 'index.html')).rejects.toThrow(/not installed/i);
    await expect(readFile(path.join(previousVersion, 'legacy.txt'), 'utf8')).resolves.toBe('old package version');
  });

  it('installs, opens, and fully removes every signed first-party application bundle', async () => {
    const rootDir = await tempRoot();
    const packageIds = ['com.tomni.design-studio', 'com.tomni.document-studio', 'com.tomni.studio'] as const;

    const artifacts = new Map<string, Buffer>();
    for (const packageId of packageIds) {
      artifacts.set(
        `/${packageId}-1.0.0.tomni-package.json`,
        await readFile(path.resolve('store-artifacts', `${packageId}-1.0.0.tomni-package.json`))
      );
    }
    const server = createServer((request, response) => {
      const artifact = artifacts.get(request.url ?? '');
      if (!artifact) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'content-length': String(artifact.byteLength),
        'content-type': 'application/vnd.tomni.package+json',
      });
      response.end(artifact);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test package server did not start.');
    const catalog = FIRST_PARTY_PACKAGE_CATALOG.filter((entry) =>
      packageIds.includes(entry.manifest.id as (typeof packageIds)[number])
    ).map((entry) => ({
      ...entry,
      artifactUrl: `http://127.0.0.1:${address.port}/${entry.manifest.id}-1.0.0.tomni-package.json`,
    }));
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog,
      trustedKeys: FIRST_PARTY_PACKAGE_TRUSTED_KEYS,
      allowLocalArtifactUrls: true,
    });
    await service.initialize();

    for (const packageId of packageIds) {
      await service.install(packageId);
      const runtime = await service.readAsset(packageId, 'app.js');
      expect(runtime.contentType).toBe('application/javascript');
      expect(runtime.content.length).toBeGreaterThan(1024 * 1024);
      await service.uninstall(packageId);
      await expect(service.readAsset(packageId, 'app.js')).rejects.toThrow(/not installed/i);
      await expect(access(path.join(rootDir, 'packages', packageId))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  }, 60_000);

  it('preserves the extracted Document package through update, restart, disable, rollback, and uninstall', async () => {
    const rootDir = await tempRoot();
    const sourceBundle = JSON.parse(
      await readFile(path.resolve('store-artifacts', 'com.tomni.document-studio-1.0.0.tomni-package.json'), 'utf8')
    ) as {
      format: 'tomni-package-bundle-v1';
      manifest: PackageManifest;
      files: Record<string, string>;
    };
    expect(sourceBundle.format).toBe('tomni-package-bundle-v1');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const artifactFor = (version: string): Buffer => {
      const unsignedManifest: PackageManifest = {
        ...sourceBundle.manifest,
        version,
        artifact: {
          ...sourceBundle.manifest.artifact!,
          signature: { algorithm: 'ed25519', keyId: 'ide-lifecycle-key', value: '' },
        },
      };
      const manifest: PackageManifest = {
        ...unsignedManifest,
        artifact: {
          ...unsignedManifest.artifact!,
          signature: {
            ...unsignedManifest.artifact!.signature,
            value: sign(null, Buffer.from(packageSignaturePayload(unsignedManifest)), privateKey).toString('base64'),
          },
        },
      };
      return Buffer.from(JSON.stringify({ ...sourceBundle, manifest }));
    };
    const artifacts = new Map([
      ['/com.tomni.document-studio-1.0.0.tomni-package.json', artifactFor('1.0.0')],
      ['/com.tomni.document-studio-1.1.0.tomni-package.json', artifactFor('1.1.0')],
    ]);
    const server = createServer((request, response) => {
      const artifact = artifacts.get(request.url ?? '');
      if (!artifact) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'content-length': String(artifact.byteLength),
        'content-type': 'application/vnd.tomni.package+json',
      });
      response.end(artifact);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Document lifecycle package server did not start.');

    let catalogVersion = '1.0.0';
    const catalogEntry = (): PackageCatalogEntry => {
      const manifest = JSON.parse(
        artifacts.get(`/com.tomni.document-studio-${catalogVersion}.tomni-package.json`)!.toString('utf8')
      ).manifest as PackageManifest;
      return {
        manifest,
        delivery: 'downloaded-package',
        trust: 'signed-first-party',
        artifactUrl: `http://127.0.0.1:${address.port}/com.tomni.document-studio-${catalogVersion}.tomni-package.json`,
      };
    };
    const createService = () =>
      createPackageManagerService({
        rootDir,
        appVersion: '1.2.0',
        catalog: [catalogEntry()],
        catalogLoader: async () => [catalogEntry()],
        trustedKeys: { 'ide-lifecycle-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
        firstPartyTrustedKeys: { 'ide-lifecycle-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
        allowLocalArtifactUrls: true,
      });
    let service = createService();
    await service.initialize();
    await expect(service.install('com.tomni.document-studio')).resolves.toMatchObject({
      installedVersion: '1.0.0',
      enabled: true,
    });
    await expect(service.readAsset('com.tomni.document-studio', 'app.js')).resolves.toMatchObject({
      contentType: 'application/javascript',
    });

    catalogVersion = '1.1.0';
    await expect(service.refreshCatalog()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ installedVersion: '1.0.0', updateAvailable: true })])
    );
    await expect(service.install('com.tomni.document-studio')).resolves.toMatchObject({
      installedVersion: '1.1.0',
      previousVersion: '1.0.0',
    });
    service = createService();
    await service.initialize();
    await expect(service.disable('com.tomni.document-studio')).resolves.toMatchObject({ enabled: false });
    await expect(service.enable('com.tomni.document-studio')).resolves.toMatchObject({ enabled: true });
    await expect(service.rollback('com.tomni.document-studio')).resolves.toMatchObject({
      installedVersion: '1.0.0',
      previousVersion: '1.1.0',
    });
    await expect(service.uninstall('com.tomni.document-studio')).resolves.toMatchObject({ state: 'available' });
    await expect(service.readAsset('com.tomni.document-studio', 'app.js')).rejects.toThrow(/not installed/i);
    await expect(access(path.join(rootDir, 'packages', 'com.tomni.document-studio'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }, 60_000);

  it('refuses to elevate a generic store-signed rollback payload into the protected Tomni namespace', async () => {
    const rootDir = await tempRoot();
    const id = 'com.tomni.rollback-keyring';
    const genericStorePair = generateKeyPairSync('ed25519');
    const pinnedFirstPartyPair = generateKeyPairSync('ed25519');
    const genericStoreKey = genericStorePair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const pinnedFirstPartyKey = pinnedFirstPartyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const writeSignedPayload = async (
      version: string,
      keyId: string,
      privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']
    ): Promise<PackageManifest> => {
      const payloadRoot = path.join(rootDir, 'packages', id, version);
      await mkdir(payloadRoot, { recursive: true });
      await writeFile(path.join(payloadRoot, 'index.html'), `<main>${version}</main>`);
      const artifact = await computeArtifactIntegrity(payloadRoot);
      const unsignedManifest: PackageManifest = {
        ...bundledCatalog()[0]!.manifest,
        id,
        publisherId: 'com.tomni',
        name: 'Rollback keyring test',
        version,
        artifact: {
          ...artifact,
          signature: { algorithm: 'ed25519', keyId, value: '' },
        },
      };
      const manifest: PackageManifest = {
        ...unsignedManifest,
        artifact: {
          ...unsignedManifest.artifact!,
          signature: {
            ...unsignedManifest.artifact!.signature,
            value: sign(null, Buffer.from(packageSignaturePayload(unsignedManifest)), privateKey).toString('base64'),
          },
        },
      };
      await writeFile(path.join(payloadRoot, 'tomny-package.json'), JSON.stringify(manifest));
      return manifest;
    };
    const activeManifest = await writeSignedPayload('2.0.0', 'tomni-pinned-key', pinnedFirstPartyPair.privateKey);
    const rollbackManifest = await writeSignedPayload('1.0.0', 'generic-store-key', genericStorePair.privateKey);
    let record: InstalledPackageRecord = {
      id,
      version: activeManifest.version,
      previousVersion: rollbackManifest.version,
      previousManifest: rollbackManifest,
      // Simulates a modified durable registry. The signature is valid, but its key is not pinned for Tomni.
      previousTrust: 'signed-first-party',
      previousProvenance: {
        source: 'store',
        scope: 'optional',
        version: rollbackManifest.version,
        integrity: rollbackManifest.artifact!.integrity,
      },
      state: 'installed',
      delivery: 'downloaded-package',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
      manifest: activeManifest,
      trust: 'signed-first-party',
      provenance: {
        source: 'store',
        scope: 'optional',
        version: activeManifest.version,
        integrity: activeManifest.artifact!.integrity,
      },
    };
    const stateStore: PackageStateStore = {
      initialize: async () => undefined,
      list: () => [structuredClone(record)],
      get: (packageId) => (packageId === id ? structuredClone(record) : undefined),
      save: async (nextRecord) => {
        record = structuredClone(nextRecord);
      },
      remove: async () => undefined,
    };
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [{ manifest: activeManifest, delivery: 'downloaded-package', trust: 'signed-first-party' }],
      stateStore,
      trustedKeys: {
        'generic-store-key': genericStoreKey,
        'tomni-pinned-key': pinnedFirstPartyKey,
      },
      firstPartyTrustedKeys: { 'tomni-pinned-key': pinnedFirstPartyKey },
    });
    await service.initialize();

    await expect(service.rollback(id)).rejects.toThrow(/protected com\.tomni namespace/i);
    expect(record).toMatchObject({
      version: '2.0.0',
      previousVersion: '1.0.0',
      trust: 'signed-first-party',
      previousTrust: 'signed-first-party',
    });
  });

  it('restores every installed version when the durable uninstall transaction fails', async () => {
    const rootDir = await tempRoot();
    const id = 'com.tomni.rollback';
    const packageRoot = path.join(rootDir, 'packages', id);
    const currentFile = path.join(packageRoot, '1.0.0', 'current.txt');
    const previousFile = path.join(packageRoot, '0.9.0', 'previous.txt');
    await mkdir(path.dirname(currentFile), { recursive: true });
    await mkdir(path.dirname(previousFile), { recursive: true });
    await writeFile(currentFile, 'current');
    await writeFile(previousFile, 'previous');

    let record: InstalledPackageRecord | undefined = {
      id,
      version: '1.0.0',
      previousVersion: '0.9.0',
      state: 'installed',
      delivery: 'downloaded-package',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
    };
    let packageRootWasMissingDuringRemove = false;
    const stateStore: PackageStateStore = {
      initialize: async () => undefined,
      list: () => (record ? [structuredClone(record)] : []),
      get: (packageId) => (record?.id === packageId ? structuredClone(record) : undefined),
      save: async (nextRecord) => {
        record = structuredClone(nextRecord);
      },
      remove: async () => {
        try {
          await access(packageRoot);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') packageRootWasMissingDuringRemove = true;
        }
        throw new Error('registry unavailable');
      },
    };
    const catalog: PackageCatalogEntry[] = [
      {
        manifest: { ...bundledCatalog()[0]!.manifest, id },
        delivery: 'downloaded-package',
        trust: 'signed-first-party',
      },
    ];
    const service = createPackageManagerService({ rootDir, appVersion: '1.2.0', catalog, stateStore });
    await service.initialize();

    await expect(service.uninstall(id)).rejects.toThrow(/registry unavailable/i);
    expect(packageRootWasMissingDuringRemove).toBe(true);
    await expect(readFile(currentFile, 'utf8')).resolves.toBe('current');
    await expect(readFile(previousFile, 'utf8')).resolves.toBe('previous');
  });

  it('quarantines a sandbox when uninstall artifact rollback cannot restore the current version', async () => {
    const rootDir = await tempRoot();
    const id = 'org.example.sandbox-rollback';
    const currentVersion = '2.0.0';
    const previousVersion = '1.0.0';
    const packageRoot = path.join(rootDir, 'packages', id);
    const currentFile = path.join(packageRoot, currentVersion, 'current.txt');
    const previousFile = path.join(packageRoot, previousVersion, 'previous.txt');
    await mkdir(path.dirname(currentFile), { recursive: true });
    await mkdir(path.dirname(previousFile), { recursive: true });
    await writeFile(currentFile, 'current');
    await writeFile(previousFile, 'previous');

    const manifest: PackageManifest = {
      ...bundledCatalog()[0]!.manifest,
      id,
      publisherId: 'org.example',
      name: 'Rollback sandbox',
      version: currentVersion,
      modules: [
        {
          id: 'sandbox',
          title: 'Sandbox',
          surface: 'sandboxed/main',
          pinnable: true,
          runtime: 'sandboxed-web',
          entrypoint: 'index.html',
        },
      ],
    };
    let record: InstalledPackageRecord | undefined = {
      id,
      version: currentVersion,
      previousVersion,
      state: 'installed',
      delivery: 'downloaded-package',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
      manifest,
      trust: 'signed-store',
      provenance: { source: 'store', scope: 'optional', version: currentVersion },
    };
    const stateStore: PackageStateStore = {
      initialize: async () => undefined,
      list: () => (record ? [structuredClone(record)] : []),
      get: (packageId) => (record?.id === packageId ? structuredClone(record) : undefined),
      save: async (nextRecord) => {
        record = structuredClone(nextRecord);
      },
      remove: async () => {
        throw new Error('registry unavailable');
      },
    };
    const transactionIds = ['current-transaction', 'previous-transaction'];
    let transactionIndex = 0;
    const currentTrash = path.join(rootDir, '.trash', `${id}-${currentVersion}-${transactionIds[0]}`);
    const previousTrash = path.join(rootDir, '.trash', `${id}-${previousVersion}-${transactionIds[1]}`);
    const sandboxActivity = vi.fn(() => false);
    const service = createPackageManagerService({
      rootDir,
      appVersion: '2.1.0',
      catalog: [{ manifest, delivery: 'downloaded-package', trust: 'signed-store' }],
      stateStore,
      randomId: () => transactionIds[transactionIndex++]!,
      isPackageSandboxActive: sandboxActivity,
      reservePackageSandboxMutation: () => ({ release: () => undefined }),
    });
    await service.initialize();
    record = {
      ...record!,
      state: 'installed',
      enabled: true,
      updatedAt: 1,
      lastError: undefined,
    };
    filesystemFailures.renameFromPath = currentTrash;

    await expect(service.uninstall(id)).rejects.toThrow(/rollback was incomplete/i);

    expect(sandboxActivity).toHaveBeenCalledWith(id);
    expect(record).toMatchObject({
      id,
      version: currentVersion,
      previousVersion,
      state: 'quarantined',
      enabled: false,
      lastError: 'PACKAGE_PAYLOAD_INCONSISTENT',
    });
    await expect(access(currentFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(currentTrash, 'current.txt'), 'utf8')).resolves.toBe('current');
    await expect(readFile(previousFile, 'utf8')).resolves.toBe('previous');
    await expect(access(previousTrash)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a correctly signed package whose payload hash does not match', async () => {
    const rootDir = await tempRoot();
    const sourceDirectory = await tempRoot();
    await writeFile(path.join(sourceDirectory, 'payload.txt'), 'tampered payload');
    const actualArtifact = await computeArtifactIntegrity(sourceDirectory);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const unsignedManifest: PackageManifest = {
      ...bundledCatalog()[0]!.manifest,
      id: 'com.tomni.bad-hash',
      artifact: {
        integrity: `sha256-${'0'.repeat(64)}`,
        sizeBytes: actualArtifact.sizeBytes,
        signature: { algorithm: 'ed25519', keyId: 'hash-key', value: '' },
      },
    };
    const manifest: PackageManifest = {
      ...unsignedManifest,
      artifact: {
        ...unsignedManifest.artifact!,
        signature: {
          ...unsignedManifest.artifact!.signature,
          value: sign(null, Buffer.from(packageSignaturePayload(unsignedManifest)), privateKey).toString('base64'),
        },
      },
    };
    await writeFile(path.join(sourceDirectory, 'tomny-package.json'), JSON.stringify(manifest));
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [{ manifest, delivery: 'downloaded-package', trust: 'signed-first-party', sourceDirectory }],
      trustedKeys: { 'hash-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    });
    await service.initialize();

    await expect(service.install(manifest.id)).rejects.toThrow(/integrity/i);
    await expect(access(path.join(rootDir, 'packages', manifest.id))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects symlinked artifact entries on every platform and leaves no partial install', async () => {
    const rootDir = await tempRoot();
    const sourceDirectory = await tempRoot();
    const symlinkTarget = await tempRoot();
    await symlink(
      symlinkTarget,
      path.join(sourceDirectory, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const unsignedManifest: PackageManifest = {
      ...bundledCatalog()[0]!.manifest,
      id: 'com.tomni.unsafe',
      artifact: {
        integrity: `sha256-${'0'.repeat(64)}`,
        sizeBytes: 0,
        signature: { algorithm: 'ed25519', keyId: 'symlink-key', value: '' },
      },
    };
    const manifest: PackageManifest = {
      ...unsignedManifest,
      artifact: {
        ...unsignedManifest.artifact!,
        signature: {
          ...unsignedManifest.artifact!.signature,
          value: sign(null, Buffer.from(packageSignaturePayload(unsignedManifest)), privateKey).toString('base64'),
        },
      },
    };
    await writeFile(path.join(sourceDirectory, 'tomny-package.json'), JSON.stringify(manifest));
    const catalog: PackageCatalogEntry[] = [
      { manifest, delivery: 'downloaded-package', trust: 'signed-first-party', sourceDirectory },
    ];
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog,
      trustedKeys: { 'symlink-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    });
    await service.initialize();

    await expect(service.install('com.tomni.unsafe')).rejects.toThrow(/symbolic link/i);
    expect((await service.status('com.tomni.unsafe')).state).toBe('failed');
    await expect(access(path.join(rootDir, 'packages', 'com.tomni.unsafe'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes only interrupted transaction directories during startup recovery', async () => {
    const rootDir = await tempRoot();
    const outside = await tempRoot();
    const outsideFile = path.join(outside, 'retain.txt');
    await writeFile(outsideFile, 'operator data');
    await mkdir(path.join(rootDir, '.staging', 'partial-install'), { recursive: true });
    await writeFile(path.join(rootDir, '.staging', 'partial-install', 'payload.js'), 'partial');
    await symlink(
      outside,
      path.join(rootDir, '.staging', 'outside-link'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await mkdir(path.join(rootDir, '.downloads', 'partial-download'), { recursive: true });
    await writeFile(path.join(rootDir, '.downloads', 'partial-download', 'payload.tmp'), 'partial');
    await mkdir(path.join(rootDir, '.trash', 'failed-finalization'), { recursive: true });
    await writeFile(path.join(rootDir, '.trash', 'failed-finalization', 'stale.txt'), 'stale');

    const service = createPackageManagerService({ rootDir, appVersion: '1.2.0', catalog: [] });
    await service.initialize();

    await expect(readdir(path.join(rootDir, '.staging'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.downloads'))).resolves.toEqual([]);
    await expect(readdir(path.join(rootDir, '.trash'))).resolves.toEqual([]);
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('operator data');
  });

  it('refuses to unlink a symlinked payload during uninstall and preserves durable provenance', async () => {
    const rootDir = await tempRoot();
    const outside = await tempRoot();
    const id = 'com.tomni.symlinked-payload';
    const version = '1.0.0';
    const payloadPath = path.join(rootDir, 'packages', id, version);
    const outsideFile = path.join(outside, 'retain.txt');
    await writeFile(outsideFile, 'operator data');
    await mkdir(path.dirname(payloadPath), { recursive: true });
    await symlink(outside, payloadPath, process.platform === 'win32' ? 'junction' : 'dir');

    const provenance = {
      source: 'store' as const,
      scope: 'optional' as const,
      version,
      integrity: `sha256-${'a'.repeat(64)}`,
    };
    let record: InstalledPackageRecord = {
      id,
      version,
      state: 'installed',
      delivery: 'downloaded-package',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
      provenance,
    };
    const stateStore: PackageStateStore = {
      initialize: async () => undefined,
      list: () => [structuredClone(record)],
      get: (packageId) => (packageId === id ? structuredClone(record) : undefined),
      save: async (nextRecord) => {
        record = structuredClone(nextRecord);
      },
      remove: async () => undefined,
    };
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [
        {
          manifest: { ...bundledCatalog()[0]!.manifest, id, version },
          delivery: 'downloaded-package',
          trust: 'signed-store',
        },
      ],
      stateStore,
    });
    await service.initialize();
    const provenanceBeforeUninstall = structuredClone(record.provenance);

    await expect(service.uninstall(id)).rejects.toThrow(/symbolic link/i);

    expect(record).toMatchObject({ state: 'quarantined', enabled: false, provenance: provenanceBeforeUninstall });
    await expect(access(payloadPath)).resolves.toBeUndefined();
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('operator data');
  });

  it('quarantines a symlinked package root before uninstall can unlink it', async () => {
    const rootDir = await tempRoot();
    const outside = await tempRoot();
    const id = 'com.tomni.symlinked-package-root';
    const version = '1.0.0';
    const packageRoot = path.join(rootDir, 'packages', id);
    const outsideFile = path.join(outside, 'retain.txt');
    await writeFile(outsideFile, 'operator data');
    await mkdir(path.join(outside, version), { recursive: true });
    await mkdir(path.dirname(packageRoot), { recursive: true });
    await symlink(outside, packageRoot, process.platform === 'win32' ? 'junction' : 'dir');

    let record: InstalledPackageRecord = {
      id,
      version,
      state: 'installed',
      delivery: 'downloaded-package',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
      provenance: {
        source: 'store',
        scope: 'optional',
        version,
        integrity: `sha256-${'b'.repeat(64)}`,
      },
    };
    const stateStore: PackageStateStore = {
      initialize: async () => undefined,
      list: () => [structuredClone(record)],
      get: (packageId) => (packageId === id ? structuredClone(record) : undefined),
      save: async (nextRecord) => {
        record = structuredClone(nextRecord);
      },
      remove: async () => undefined,
    };
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [
        {
          manifest: { ...bundledCatalog()[0]!.manifest, id, version },
          delivery: 'downloaded-package',
          trust: 'signed-store',
        },
      ],
      stateStore,
    });
    await service.initialize();

    await expect(service.uninstall(id)).resolves.toMatchObject({
      state: 'quarantined',
      enabled: false,
      lastError: 'PACKAGE_PAYLOAD_INCONSISTENT',
    });

    expect(record).toMatchObject({ state: 'quarantined', enabled: false });
    await expect(access(packageRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('operator data');
  });

  it('quarantines a signed artifact that differs from its durable installed identity', async () => {
    const rootDir = await tempRoot();
    const id = 'com.tomni.replaced-signed';
    const version = '1.0.0';
    const packageRoot = path.join(rootDir, 'packages', id, version);
    await mkdir(packageRoot, { recursive: true });
    await writeFile(path.join(packageRoot, 'app.js'), 'export const replacement = true;\n');
    const artifact = await computeArtifactIntegrity(packageRoot);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const diskUnsigned: PackageManifest = {
      ...bundledCatalog()[0]!.manifest,
      id,
      version,
      description: 'Replacement artifact',
      artifact: {
        ...artifact,
        signature: { algorithm: 'ed25519', keyId: 'replacement-key', value: '' },
      },
    };
    const diskManifest: PackageManifest = {
      ...diskUnsigned,
      artifact: {
        ...diskUnsigned.artifact!,
        signature: {
          ...diskUnsigned.artifact!.signature,
          value: sign(null, Buffer.from(packageSignaturePayload(diskUnsigned)), privateKey).toString('base64'),
        },
      },
    };
    const registryUnsigned: PackageManifest = {
      ...diskUnsigned,
      description: 'Durably installed artifact',
    };
    const registryManifest: PackageManifest = {
      ...registryUnsigned,
      artifact: {
        ...registryUnsigned.artifact!,
        signature: {
          ...registryUnsigned.artifact!.signature,
          value: sign(null, Buffer.from(packageSignaturePayload(registryUnsigned)), privateKey).toString('base64'),
        },
      },
    };
    await writeFile(path.join(packageRoot, 'tomny-package.json'), JSON.stringify(diskManifest));
    let record: InstalledPackageRecord = {
      id,
      version,
      manifest: registryManifest,
      trust: 'signed-store',
      state: 'installed',
      delivery: 'downloaded-package',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
    };
    const stateStore: PackageStateStore = {
      initialize: async () => undefined,
      list: () => [structuredClone(record)],
      get: (packageId) => (packageId === id ? structuredClone(record) : undefined),
      save: async (nextRecord) => {
        record = structuredClone(nextRecord);
      },
      remove: async () => undefined,
    };
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [{ manifest: diskManifest, delivery: 'downloaded-package', trust: 'signed-store' }],
      stateStore,
      trustedKeys: { 'replacement-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    });

    await service.initialize();

    expect(record.state).toBe('quarantined');
    expect(record.enabled).toBe(false);
  });

  it('does not elevate durable Store trust from the current catalog during payload recovery', async () => {
    const rootDir = await tempRoot();
    const id = 'com.tomni.no-trust-escalation';
    const version = '1.0.0';
    const packageRoot = path.join(rootDir, 'packages', id, version);
    await mkdir(packageRoot, { recursive: true });
    await writeFile(path.join(packageRoot, 'app.js'), 'export const ready = true;\n');
    const artifact = await computeArtifactIntegrity(packageRoot);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const unsignedManifest: PackageManifest = {
      ...bundledCatalog()[0]!.manifest,
      id,
      publisherId: 'com.tomni',
      version,
      artifact: {
        ...artifact,
        signature: { algorithm: 'ed25519', keyId: 'store-trust-key', value: '' },
      },
    };
    const manifest: PackageManifest = {
      ...unsignedManifest,
      artifact: {
        ...unsignedManifest.artifact!,
        signature: {
          ...unsignedManifest.artifact!.signature,
          value: sign(null, Buffer.from(packageSignaturePayload(unsignedManifest)), privateKey).toString('base64'),
        },
      },
    };
    await writeFile(path.join(packageRoot, 'tomny-package.json'), JSON.stringify(manifest));

    const provenance = {
      source: 'store' as const,
      scope: 'optional' as const,
      version,
      integrity: manifest.artifact!.integrity,
    };
    let record: InstalledPackageRecord = {
      id,
      version,
      manifest,
      trust: 'signed-store',
      provenance,
      state: 'installed',
      delivery: 'downloaded-package',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
    };
    const stateStore: PackageStateStore = {
      initialize: async () => undefined,
      list: () => [structuredClone(record)],
      get: (packageId) => (packageId === id ? structuredClone(record) : undefined),
      save: async (nextRecord) => {
        record = structuredClone(nextRecord);
      },
      remove: async () => undefined,
    };
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [{ manifest, delivery: 'downloaded-package', trust: 'signed-first-party' }],
      stateStore,
      trustedKeys: { 'store-trust-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    });

    await service.initialize();

    expect(record.trust).toBe('signed-store');
    expect(record.provenance).toEqual(provenance);
  });

  it('downgrades persisted first-party trust when no trusted catalog policy backs it', async () => {
    const rootDir = await tempRoot();
    const id = 'com.tomni.legacy-signed';
    const version = '1.0.0';
    const packageRoot = path.join(rootDir, 'packages', id, version);
    await mkdir(packageRoot, { recursive: true });
    await writeFile(path.join(packageRoot, 'app.js'), 'export const ready = true;\n');
    const artifact = await computeArtifactIntegrity(packageRoot);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const unsignedManifest: PackageManifest = {
      ...bundledCatalog()[0]!.manifest,
      id,
      publisherId: 'com.tomni',
      version,
      artifact: {
        ...artifact,
        signature: { algorithm: 'ed25519', keyId: 'legacy-store-key', value: '' },
      },
    };
    const manifest: PackageManifest = {
      ...unsignedManifest,
      artifact: {
        ...unsignedManifest.artifact!,
        signature: {
          ...unsignedManifest.artifact!.signature,
          value: sign(null, Buffer.from(packageSignaturePayload(unsignedManifest)), privateKey).toString('base64'),
        },
      },
    };
    await writeFile(path.join(packageRoot, 'tomny-package.json'), JSON.stringify(manifest));

    let record: InstalledPackageRecord = {
      id,
      version,
      manifest,
      trust: 'signed-first-party',
      state: 'installed',
      delivery: 'downloaded-package',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
    };
    const stateStore: PackageStateStore = {
      initialize: async () => undefined,
      list: () => [structuredClone(record)],
      get: (packageId) => (packageId === id ? structuredClone(record) : undefined),
      save: async (nextRecord) => {
        record = structuredClone(nextRecord);
      },
      remove: async () => undefined,
    };
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog: [],
      stateStore,
      trustedKeys: { 'legacy-store-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    });

    await service.initialize();

    expect(record.trust).toBe('signed-store');
  });

  it('redacts package mutation runtime metadata from the IPC error', async () => {
    const handlers = new Map<string, (sender: { id: string }, payload: unknown) => Promise<unknown>>();
    const runtime: PackageMutationRuntime = {
      requestConsent: () => ({
        consentId: 'consent-1',
        expiresAt: '2030-01-01T00:00:00.000Z',
      }),
      preparePermissionConsent: async () => ({ required: false }),
      approvePermissionConsent: async () => ({
        receiptId: 'permission-receipt-1',
        packageId: 'org.example.extension',
        from: { version: '1.0.0', revision: `sha256-${'a'.repeat(64)}` },
        to: { version: '1.1.0', revision: `sha256-${'b'.repeat(64)}` },
        permissions: { added: ['network.fetch'], removed: [], changed: [] },
        issuedAt: '2030-01-01T00:00:00.000Z',
        expiresAt: '2030-01-01T00:02:00.000Z',
      }),
      execute: async () => {
        throw new Error('C:\\sensitive-package-root\\metadata.json');
      },
      recoverPendingActions: async () => ({ recovered: [], failed: [] }),
      revokeOwner: () => undefined,
    };
    const dispose = registerTrustedPackageMutationIpcBridge({
      host: {
        handle: (channel, handler) => {
          handlers.set(channel, handler);
        },
        removeHandler: (channel) => {
          handlers.delete(channel);
        },
      },
      runtime,
      verifySender: (sender) => sender.id === 'renderer-1',
      identifySender: (sender) => sender.id,
    });
    const handler = handlers.get(PACKAGE_MUTATION_NATIVE_CHANNELS.execute);

    expect(handler).toBeDefined();
    await expect(
      handler!(
        { id: 'renderer-1' },
        {
          id: 'org.example.extension',
          action: 'install',
          idempotencyKey: 'request-1',
          region: 'VN',
          consentId: 'consent-1',
        }
      )
    ).rejects.toMatchObject({
      name: 'PackageOperationError',
      message: 'PACKAGE_OPERATION_FAILED',
      failure: { phase: 'install', code: 'PACKAGE_OPERATION_FAILED' },
    });
    dispose();
  });

  it('rejects a package source placed inside its installation root', async () => {
    const rootDir = await tempRoot();
    const sourceDirectory = path.join(rootDir, 'attacker-controlled-source');
    await mkdir(sourceDirectory, { recursive: true });
    const manifest = bundledCatalog()[0]!.manifest;
    const catalog: PackageCatalogEntry[] = [
      {
        manifest: { ...manifest, id: 'com.tomni.recursive' },
        delivery: 'downloaded-package',
        trust: 'signed-first-party',
        sourceDirectory,
      },
    ];
    const service = createPackageManagerService({ rootDir, appVersion: '1.2.0', catalog });
    await service.initialize();

    await expect(service.install('com.tomni.recursive')).rejects.toThrow(/outside the package installation root/i);
  });

  describe('publisher submission native bridge', () => {
    type TestEvent = Readonly<{ id: string }>;
    type TestHandler = (event: TestEvent, payload: unknown) => Promise<unknown>;

    const createHarness = (
      input: Readonly<{
        trusted?: boolean;
        account?: boolean;
        available?: boolean;
        choice?: Readonly<{ cancelled: boolean; filePath?: string }>;
      }> = {}
    ) => {
      const handlers = new Map<string, TestHandler>();
      const verifySender = vi.fn(() => input.trusted ?? true);
      const requireAuthenticatedAccount = vi.fn(() => {
        if (input.account === false) throw new Error('offline');
      });
      const isAvailable = vi.fn(() => input.available ?? true);
      const chooseArchive = vi.fn(
        async () => input.choice ?? { cancelled: false, filePath: 'C:\\MainOnly\\package.tomny' }
      );
      const staging = vi.fn(async (_filePath: string) => undefined);
      const boundary = vi.fn(async (_idempotencyKey: string) => ({
        submissionId: 'submission-1',
        packageId: 'com.example.package',
        version: '1.0.0',
        status: 'human-review-required' as const,
        submittedAt: '2026-08-20T00:00:00.000Z',
      }));
      const submit = vi.fn(async (request: Readonly<{ idempotencyKey: string; filePath: string }>) => {
        await staging(request.filePath);
        return boundary(request.idempotencyKey);
      });
      const dispose = registerTrustedPublisherSubmissionIpcBridge<TestEvent>({
        host: {
          handle: (channel, handler) => handlers.set(channel, handler),
          removeHandler: (channel) => handlers.delete(channel),
        },
        verifySender,
        requireAuthenticatedAccount,
        isAvailable,
        chooseArchive,
        submit,
      });
      const handler = handlers.get(PUBLISHER_SUBMISSION_NATIVE_CHANNELS.pickAndSubmit);
      if (!handler) throw new Error('publisher submission handler was not registered');
      return {
        handler,
        verifySender,
        requireAuthenticatedAccount,
        isAvailable,
        chooseArchive,
        staging,
        boundary,
        submit,
        dispose,
      };
    };

    it('rejects renderer paths and untrusted/account/configured requests before the native picker', async () => {
      const invalid = createHarness();
      await expect(
        invalid.handler({ id: 'renderer' }, { idempotencyKey: 'request-1', filePath: 'C:\\renderer\\package.tomny' })
      ).resolves.toEqual({ ok: false, code: 'PUBLISHER_SUBMISSION_REQUEST_INVALID' });
      expect(invalid.verifySender).not.toHaveBeenCalled();
      expect(invalid.chooseArchive).not.toHaveBeenCalled();
      invalid.dispose();

      const untrusted = createHarness({ trusted: false });
      await expect(untrusted.handler({ id: 'renderer' }, { idempotencyKey: 'request-1' })).resolves.toEqual({
        ok: false,
        code: 'PUBLISHER_SUBMISSION_SENDER_UNTRUSTED',
      });
      expect(untrusted.requireAuthenticatedAccount).not.toHaveBeenCalled();
      expect(untrusted.chooseArchive).not.toHaveBeenCalled();
      untrusted.dispose();

      const noAccount = createHarness({ account: false });
      await expect(noAccount.handler({ id: 'renderer' }, { idempotencyKey: 'request-1' })).resolves.toEqual({
        ok: false,
        code: 'PUBLISHER_SUBMISSION_ACCOUNT_REQUIRED',
      });
      expect(noAccount.isAvailable).not.toHaveBeenCalled();
      expect(noAccount.chooseArchive).not.toHaveBeenCalled();
      noAccount.dispose();

      const unavailable = createHarness({ available: false });
      await expect(unavailable.handler({ id: 'renderer' }, { idempotencyKey: 'request-1' })).resolves.toEqual({
        ok: false,
        code: 'PUBLISHER_SUBMISSION_UNAVAILABLE',
      });
      expect(unavailable.chooseArchive).not.toHaveBeenCalled();
      unavailable.dispose();
    });

    it('uses Main-selected files for staging and the submission boundary, and keeps cancellation opaque', async () => {
      const happy = createHarness();
      await expect(happy.handler({ id: 'renderer' }, { idempotencyKey: 'request-1' })).resolves.toEqual({
        ok: true,
        receipt: {
          submissionId: 'submission-1',
          packageId: 'com.example.package',
          version: '1.0.0',
          status: 'human-review-required',
          submittedAt: '2026-08-20T00:00:00.000Z',
        },
      });
      expect(happy.staging).toHaveBeenCalledWith('C:\\MainOnly\\package.tomny');
      expect(happy.boundary).toHaveBeenCalledWith('request-1');
      happy.dispose();

      const cancelled = createHarness({ choice: { cancelled: true } });
      await expect(cancelled.handler({ id: 'renderer' }, { idempotencyKey: 'request-1' })).resolves.toEqual({
        ok: false,
        code: 'PUBLISHER_SUBMISSION_CANCELLED',
      });
      expect(cancelled.submit).not.toHaveBeenCalled();
      cancelled.dispose();

      const invalidChoice = createHarness({ choice: { cancelled: false, filePath: '' } });
      await expect(invalidChoice.handler({ id: 'renderer' }, { idempotencyKey: 'request-1' })).resolves.toEqual({
        ok: false,
        code: 'PUBLISHER_SUBMISSION_FAILED',
      });
      expect(invalidChoice.submit).not.toHaveBeenCalled();
      invalidChoice.dispose();
    });
  });
});
