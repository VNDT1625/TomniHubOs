/* oxlint-disable no-await-in-loop -- steps of one scenario must run in order */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAdapterDocument, type AdapterDocument } from '@/common/packages/adapter';
import type { PackageManifest } from '@/common/packages';
import type { RepoToPackageResult } from '@process/extensions/package-manager/repoPackaging/types';
import {
  createConnectionRegistry,
  type ConnectionRegistry,
  type LoadedPackage,
} from '@process/integrations/connections/core/registry';
import { createJsonConnectionStateStore } from '@process/integrations/connections/core/state';
import { defineConnectionHost } from '@process/integrations/connections/core/types';
import type { LocalInstallOutcome } from '@process/integrations/connections/wiring/localInstall';
import type { GitRemote } from '@process/integrations/repoSources/gitRemote';
import {
  createSourceUpdater,
  SourceUpdateError,
  type SourceBuildRequest,
  type SourceUpdateDeps,
} from '@process/integrations/repoSources/update';

const PACKAGE_ID = 'local.sample-repo';
const OLD_COMMIT = '1'.repeat(40);
const NEW_COMMIT = '2'.repeat(40);
const URL = 'https://github.com/owner/repo.git';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const documentOf = (connections: unknown[], extra: Record<string, unknown> = {}): AdapterDocument =>
  parseAdapterDocument({
    schemaVersion: 1,
    generatedBy: 'classifier',
    connections,
    provenance: { kind: 'git', url: URL, commit: OLD_COMMIT, ref: 'main', packagedAt: 1 },
    ...extra,
  });

const command = (id: string, description = 'Does a thing') => ({
  kind: 'command',
  id,
  title: id,
  description,
  path: `source/commands/${id}.md`,
  format: 'markdown',
});
const hook = (id: string, script = 'source/hooks/run.js') => ({
  kind: 'hook',
  id,
  event: 'PostToolUse',
  command: 'node',
  args: [script],
});
const cli = (id: string) => ({ kind: 'cli', id, title: id, command: 'tool', display: 'terminal' });

const manifestOf = (version: string, id = PACKAGE_ID): PackageManifest =>
  ({ id, version }) as unknown as PackageManifest;

const resultOf = (
  adapter: AdapterDocument | undefined,
  overrides: { version?: string; commit?: string; verified?: boolean; id?: string; artifactPath?: string } = {}
): RepoToPackageResult =>
  ({
    artifactPath: overrides.artifactPath ?? 'C:/out/new.tomny',
    manifest: manifestOf(overrides.version ?? '1.0.1', overrides.id),
    verified: overrides.verified ?? true,
    provenance: {
      kind: 'git',
      url: URL,
      commit: overrides.commit ?? NEW_COMMIT,
      packagedAt: '2026-10-09T00:00:00.000Z',
    },
    ...(adapter ? { adapter } : {}),
  }) as unknown as RepoToPackageResult;

type World = Readonly<{
  deps: SourceUpdateDeps;
  build: ReturnType<typeof vi.fn<(request: SourceBuildRequest) => Promise<RepoToPackageResult>>>;
  install: ReturnType<typeof vi.fn<(artifactPath: string) => Promise<LocalInstallOutcome>>>;
  discard: ReturnType<typeof vi.fn<(artifactPath: string) => Promise<void>>>;
  resolveCommit: ReturnType<typeof vi.fn<GitRemote['resolveCommit']>>;
  disable: ReturnType<typeof vi.fn<ConnectionRegistry['disable']>>;
}>;

/** A world with fakes only: the registry view says which keys are on, `install` answers with fixed statuses. */
const fakeWorld = (options: {
  installed: AdapterDocument;
  enabled?: string[];
  built: RepoToPackageResult[];
  statuses?: Record<string, string>;
  remoteCommit?: string | undefined;
  installedTrust?: string;
  installedVersion?: string;
  state?: string;
}): World => {
  const builds = [...options.built];
  const build = vi.fn(async (_request: SourceBuildRequest) => {
    const next = builds.shift();
    if (!next) throw new Error('unexpected build');
    return next;
  });
  const install = vi.fn(
    async (_artifactPath: string): Promise<LocalInstallOutcome> => ({
      packageId: PACKAGE_ID,
      version: '1.0.1',
      connections: Object.entries(options.statuses ?? {}).map(([key, status]) => ({ key, status })),
    })
  );
  const discard = vi.fn(async (_artifactPath: string) => undefined);
  const resolveCommit = vi.fn<GitRemote['resolveCommit']>(async () =>
    'remoteCommit' in options ? options.remoteCommit : NEW_COMMIT
  );
  const disable = vi.fn<ConnectionRegistry['disable']>(async (packageId, key) => ({
    packageId,
    packageVersion: '1.0.1',
    connectionKey: key,
    enabled: false,
    status: 'off',
  }));
  const enabled = new Set(options.enabled ?? []);
  const deps: SourceUpdateDeps = {
    packages: {
      status: async () =>
        ({
          state: options.state ?? 'installed',
          installedVersion: options.installedVersion ?? '1.0.0',
          installedTrust: options.installedTrust ?? 'local-built',
        }) as never,
    },
    registry: {
      view: async () =>
        options.installed.connections.map((connection) => {
          const key = `${connection.kind}:${'id' in connection ? connection.id : connection.path}`;
          return {
            connection,
            key,
            state: {
              packageId: PACKAGE_ID,
              packageVersion: '1.0.0',
              connectionKey: key,
              enabled: enabled.has(key),
              status: enabled.has(key) ? 'on' : 'off',
            },
          } as never;
        }),
      disable,
    },
    loadInstalled: async () =>
      ({
        packageId: PACKAGE_ID,
        packageVersion: '1.0.0',
        packageDirectory: 'C:/pkg',
        adapter: options.installed,
      }) as LoadedPackage,
    remote: { resolveCommit },
    build,
    install,
    discardArtifact: discard,
  };
  return { deps, build, install, discard, resolveCommit, disable };
};

describe('source update: preconditions', () => {
  const installed = documentOf([cli('tool')]);

  it('only updates a package that is installed and was built on this machine', async () => {
    for (const [override, code] of [
      [{ state: 'available' }, 'NOT_INSTALLED'],
      [{ installedTrust: 'signed-store' }, 'NOT_LOCAL_BUILT'],
    ] as const) {
      const world = fakeWorld({ installed, built: [], ...override });
      await expect(createSourceUpdater(world.deps).update(PACKAGE_ID)).rejects.toMatchObject({ code });
      expect(world.build).not.toHaveBeenCalled();
    }
  });

  it('refuses a package with no recorded source or a source that is not an address', async () => {
    for (const [provenance, code] of [
      [undefined, 'NO_PROVENANCE'],
      [{ kind: 'local', packagedAt: 1 }, 'SOURCE_NOT_UPDATABLE'],
    ] as const) {
      const document = parseAdapterDocument({
        schemaVersion: 1,
        generatedBy: 'classifier',
        connections: [cli('tool')],
        ...(provenance ? { provenance } : {}),
      });
      const world = fakeWorld({ installed: document, built: [] });
      await expect(createSourceUpdater(world.deps).update(PACKAGE_ID)).rejects.toMatchObject({ code });
    }
  });

  it('does nothing when the remote still points at the packaged commit', async () => {
    const world = fakeWorld({ installed, built: [], remoteCommit: OLD_COMMIT });
    await expect(createSourceUpdater(world.deps).update(PACKAGE_ID)).resolves.toEqual({
      status: 'up-to-date',
      version: '1.0.0',
      commit: OLD_COMMIT,
    });
    expect(world.build).not.toHaveBeenCalled();
    expect(world.install).not.toHaveBeenCalled();
  });

  it('when the remote cannot be asked, trusts the clone: same commit means nothing to install', async () => {
    const world = fakeWorld({
      installed,
      built: [resultOf(installed, { commit: OLD_COMMIT })],
      remoteCommit: undefined,
    });
    await expect(createSourceUpdater(world.deps).update(PACKAGE_ID)).resolves.toMatchObject({ status: 'up-to-date' });
    expect(world.discard).toHaveBeenCalledWith('C:/out/new.tomny');
    expect(world.install).not.toHaveBeenCalled();
  });

  it('check reports update-available, up-to-date or unknown without building anything', async () => {
    const world = fakeWorld({ installed, built: [] });
    const updater = createSourceUpdater(world.deps);
    await expect(updater.check(PACKAGE_ID)).resolves.toEqual({
      status: 'update-available',
      installedCommit: OLD_COMMIT,
      remoteCommit: NEW_COMMIT,
    });
    world.resolveCommit.mockResolvedValueOnce(OLD_COMMIT);
    await expect(updater.check(PACKAGE_ID)).resolves.toMatchObject({ status: 'up-to-date' });
    world.resolveCommit.mockResolvedValueOnce(undefined);
    await expect(updater.check(PACKAGE_ID)).resolves.toMatchObject({ status: 'unknown' });
    expect(world.build).not.toHaveBeenCalled();
    expect(world.resolveCommit).toHaveBeenCalledWith({ url: URL, ref: 'main' });
  });
});

describe('source update: what is trusted and installed', () => {
  const installed = documentOf([cli('tool')]);

  it('builds the recorded source again under the same id, ref and folder', async () => {
    const withFolder = parseAdapterDocument({
      schemaVersion: 1,
      generatedBy: 'classifier',
      connections: [cli('tool')],
      provenance: { kind: 'git', url: URL, ref: 'v2', subdirectory: 'pkg/app', packagedAt: 1 },
    });
    const world = fakeWorld({ installed: withFolder, built: [resultOf(withFolder)], remoteCommit: undefined });
    await createSourceUpdater(world.deps).update(PACKAGE_ID, { preview: true });
    expect(world.build).toHaveBeenCalledWith({
      source: URL,
      packageId: PACKAGE_ID,
      ref: 'v2',
      subdirectory: 'pkg/app',
    });
  });

  it('never installs an archive that was not re-verified or has another id', async () => {
    for (const [override, code] of [
      [{ verified: false }, 'UNVERIFIED_ARCHIVE'],
      [{ id: 'com.someone.else' }, 'PACKAGE_MISMATCH'],
    ] as const) {
      const world = fakeWorld({ installed, built: [resultOf(installed, override)] });
      await expect(createSourceUpdater(world.deps).update(PACKAGE_ID)).rejects.toMatchObject({ code });
      expect(world.install).not.toHaveBeenCalled();
      expect(world.discard).toHaveBeenCalledWith('C:/out/new.tomny');
    }
  });

  it('keeps the repository version when it went up, and counts the patch up when it did not', async () => {
    const raised = fakeWorld({ installed, built: [resultOf(installed, { version: '2.0.0' })] });
    const first = await createSourceUpdater(raised.deps).update(PACKAGE_ID, { preview: true });
    expect(first).toMatchObject({ status: 'preview', toVersion: '2.0.0' });
    expect(raised.build).toHaveBeenCalledTimes(1);

    const same = fakeWorld({
      installed,
      built: [
        resultOf(installed, { version: '1.0.0', artifactPath: 'C:/out/first.tomny' }),
        resultOf(installed, { version: '1.0.1', artifactPath: 'C:/out/second.tomny' }),
      ],
    });
    const second = await createSourceUpdater(same.deps).update(PACKAGE_ID, { preview: true });
    expect(second).toMatchObject({ status: 'preview', toVersion: '1.0.1', fromVersion: '1.0.0' });
    expect(same.build).toHaveBeenNthCalledWith(2, expect.objectContaining({ version: '1.0.1' }));
    expect(same.discard).toHaveBeenCalledWith('C:/out/first.tomny');
  });

  it('fails instead of installing when no higher version can be had', async () => {
    const world = fakeWorld({
      installed,
      built: [resultOf(installed, { version: '1.0.0' }), resultOf(installed, { version: '1.0.0' })],
    });
    await expect(createSourceUpdater(world.deps).update(PACKAGE_ID)).rejects.toMatchObject({
      code: 'VERSION_UNAVAILABLE',
    });
    expect(world.install).not.toHaveBeenCalled();
  });

  it('a preview plans and discards the archive without installing', async () => {
    const next = documentOf([cli('tool'), cli('extra')]);
    const world = fakeWorld({ installed, built: [resultOf(next, { version: '1.1.0' })] });
    const outcome = await createSourceUpdater(world.deps).update(PACKAGE_ID, { preview: true });
    expect(outcome).toMatchObject({ status: 'preview', fromCommit: OLD_COMMIT, toCommit: NEW_COMMIT });
    expect(outcome.status === 'preview' && outcome.plan.counts.added).toBe(1);
    expect(world.install).not.toHaveBeenCalled();
    expect(world.discard).toHaveBeenCalledTimes(1);
  });

  it('a build with no adapter is planned from its manifest, not treated as "everything removed"', async () => {
    const world = fakeWorld({ installed: documentOf([]), built: [resultOf(undefined, { version: '1.0.1' })] });
    const outcome = await createSourceUpdater(world.deps).update(PACKAGE_ID, { preview: true });
    expect(outcome.status === 'preview' && outcome.plan.connections).toEqual([]);
  });

  it('removes the archive even when the install fails, and does not hide the failure', async () => {
    const world = fakeWorld({ installed, built: [resultOf(installed)] });
    world.install.mockRejectedValueOnce(new Error('install failed'));
    await expect(createSourceUpdater(world.deps).update(PACKAGE_ID)).rejects.toThrow('install failed');
    expect(world.discard).toHaveBeenCalledWith('C:/out/new.tomny');
  });

  it('refuses a second update of the same package while one runs, and recovers afterwards', async () => {
    const world = fakeWorld({ installed, built: [resultOf(installed), resultOf(installed)] });
    let release: (() => void) | undefined;
    world.install.mockImplementationOnce(
      () =>
        new Promise<LocalInstallOutcome>((resolve) => {
          release = () => resolve({ packageId: PACKAGE_ID, version: '1.0.1', connections: [] });
        })
    );
    const updater = createSourceUpdater(world.deps);
    const first = updater.update(PACKAGE_ID);
    await vi.waitFor(() => expect(world.install).toHaveBeenCalled());
    await expect(updater.update(PACKAGE_ID)).rejects.toMatchObject({ code: 'UPDATE_IN_PROGRESS' });
    release?.();
    await first;
    await expect(updater.update(PACKAGE_ID, { preview: true })).resolves.toMatchObject({ status: 'preview' });
  });

  it('stops before building when already cancelled', async () => {
    const world = fakeWorld({ installed, built: [] });
    const controller = new AbortController();
    controller.abort();
    await expect(
      createSourceUpdater(world.deps).update(PACKAGE_ID, { signal: controller.signal })
    ).rejects.toBeInstanceOf(SourceUpdateError);
    expect(world.build).not.toHaveBeenCalled();
  });
});

describe('source update: safeguard if the registry leaves changed code on', () => {
  it('switches off a changed code-running connection that the registry reported as on', async () => {
    const installed = documentOf([hook('runner'), cli('tool')]);
    const next = documentOf([hook('runner', 'source/hooks/other.js'), cli('tool')]);
    const world = fakeWorld({
      installed,
      enabled: ['hook:runner', 'cli:tool'],
      built: [resultOf(next)],
      statuses: { 'hook:runner': 'on', 'cli:tool': 'on' },
    });
    const outcome = await createSourceUpdater(world.deps).update(PACKAGE_ID);
    expect(world.disable).toHaveBeenCalledTimes(1);
    expect(world.disable).toHaveBeenCalledWith(PACKAGE_ID, 'hook:runner');
    const byKey = new Map(outcome.status === 'updated' ? outcome.connections.map((item) => [item.key, item]) : []);
    expect(byKey.get('hook:runner')).toMatchObject({
      finalStatus: 'off',
      reapprovalRequired: true,
      switchedOffBySafeguard: true,
    });
    expect(byKey.get('cli:tool')).toMatchObject({ finalStatus: 'on', reapprovalRequired: false });
  });

  it('leaves it alone when the registry already turned it off', async () => {
    const installed = documentOf([hook('runner')]);
    const next = documentOf([hook('runner', 'source/hooks/other.js')]);
    const world = fakeWorld({
      installed,
      enabled: ['hook:runner'],
      built: [resultOf(next)],
      statuses: { 'hook:runner': 'needs-input' },
    });
    const outcome = await createSourceUpdater(world.deps).update(PACKAGE_ID);
    expect(world.disable).not.toHaveBeenCalled();
    expect(outcome.status === 'updated' && outcome.connections[0]).toMatchObject({
      finalStatus: 'needs-input',
      reapprovalRequired: true,
      switchedOffBySafeguard: false,
    });
  });
});

/**
 * Criterion C6 against the real connection registry: the planner and the registry are two independent checks of the
 * same rule, and the observed result must agree with the plan.
 */
describe('criterion C6 with the real connection registry', () => {
  const describeHost = (kind: 'command' | 'hook' | 'cli') =>
    defineConnectionHost({
      kind,
      check: async () => ({ ok: true }),
      describe: async (_context, connection) => ({
        kind,
        title: String((connection as { id: string }).id),
        lines: [{ label: 'Kết nối', value: JSON.stringify(connection) }],
        files: kind === 'hook' ? ['source/hooks/run.js'] : [],
      }),
      enable: async (_context, connection) => ({ installed: [String((connection as { id: string }).id)] }),
      disable: async () => undefined,
    });

  const setup = async (
    options: { unchangedAdapter?: boolean; beforeInstall?: (directory: string) => Promise<void> } = {}
  ) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tomny-update-c6-'));
    roots.push(directory);
    await mkdir(path.join(directory, 'source', 'hooks'), { recursive: true });
    await writeFile(path.join(directory, 'source', 'hooks', 'run.js'), 'console.log(1)');

    const oldAdapter = documentOf([
      command('same'),
      command('docs', 'old text'),
      hook('runner'),
      hook('steady'),
      cli('gone'),
      cli('untouched'),
    ]);
    const moved = { provenance: { kind: 'git', url: URL, commit: NEW_COMMIT, ref: 'main', packagedAt: 2 } };
    const newAdapter = options.unchangedAdapter
      ? documentOf(oldAdapter.connections as unknown[], moved)
      : documentOf(
          [
            command('same'),
            command('docs', 'new text'),
            hook('runner', 'source/hooks/other.js'),
            hook('steady'),
            cli('fresh'),
            cli('untouched'),
          ],
          moved
        );

    let loaded: LoadedPackage = {
      packageId: PACKAGE_ID,
      packageVersion: '1.0.0',
      packageDirectory: directory,
      adapter: oldAdapter,
    };
    const store = createJsonConnectionStateStore(path.join(directory, 'connections.json'));
    await store.initialize();
    const registry = createConnectionRegistry({
      store,
      hosts: [describeHost('command'), describeHost('hook'), describeHost('cli')],
      loadPackage: async () => loaded,
      listInstalledPackageIds: async () => [PACKAGE_ID],
      now: () => 1_000,
    });

    await registry.syncPackage(PACKAGE_ID);
    for (const key of ['command:same', 'command:docs', 'hook:runner', 'hook:steady', 'cli:gone', 'cli:untouched']) {
      const approval = await registry.describe(PACKAGE_ID, key);
      await registry.enable(PACKAGE_ID, key, approval.approvalHash);
    }

    const install = vi.fn(async (_artifactPath: string): Promise<LocalInstallOutcome> => {
      await options.beforeInstall?.(directory);
      // What the package manager does on update: the new version replaces the old one, then the registry syncs.
      loaded = { ...loaded, packageVersion: '1.0.1', adapter: newAdapter };
      const views = await registry.syncPackage(PACKAGE_ID);
      return {
        packageId: PACKAGE_ID,
        version: '1.0.1',
        connections: views.map((view) => ({ key: view.key, status: view.state.status })),
      };
    });
    const deps: SourceUpdateDeps = {
      packages: {
        status: async () => ({ state: 'installed', installedVersion: '1.0.0', installedTrust: 'local-built' }) as never,
      },
      registry,
      loadInstalled: async () => loaded,
      remote: { resolveCommit: async () => NEW_COMMIT },
      build: async () => resultOf(newAdapter),
      install,
    };
    return { directory, registry, store, deps, install };
  };

  it('keeps unchanged connections on, follows data, turns changed code off, adds off and removes', async () => {
    const t = await setup();
    const outcome = await createSourceUpdater(t.deps).update(PACKAGE_ID);
    expect(outcome.status).toBe('updated');
    if (outcome.status !== 'updated') return;

    const states = new Map(t.store.list(PACKAGE_ID).map((state) => [state.connectionKey, state]));
    expect(states.get('command:same')).toMatchObject({ enabled: true, status: 'on' });
    expect(states.get('hook:steady')).toMatchObject({ enabled: true, status: 'on' });
    expect(states.get('cli:untouched')).toMatchObject({ enabled: true, status: 'on' });
    expect(states.get('command:docs')).toMatchObject({ enabled: true, status: 'on' });
    expect(states.get('hook:runner')).toMatchObject({ enabled: false, status: 'needs-input' });
    expect(states.get('cli:fresh')).toMatchObject({ enabled: false, status: 'off' });
    expect(states.has('cli:gone')).toBe(false);

    const byKey = new Map(outcome.connections.map((item) => [item.key, item]));
    expect(byKey.get('hook:runner')).toMatchObject({
      change: 'code-changed',
      reapprovalRequired: true,
      switchedOffBySafeguard: false,
    });
    expect(byKey.get('command:docs')).toMatchObject({
      change: 'data-changed',
      finalStatus: 'on',
      reapprovalRequired: false,
    });
    expect(byKey.get('cli:gone')).toMatchObject({ change: 'removed', finalStatus: 'removed' });
    expect(byKey.get('cli:fresh')).toMatchObject({ change: 'added', finalStatus: 'off' });
    expect(outcome.plan.needsReapproval).toEqual(['hook:runner']);
  });

  it('the old approval cannot switch the changed connection back on; the new one can', async () => {
    const t = await setup();
    const staleHash = (await t.registry.describe(PACKAGE_ID, 'hook:runner')).approvalHash;
    await createSourceUpdater(t.deps).update(PACKAGE_ID);

    await expect(t.registry.enable(PACKAGE_ID, 'hook:runner', staleHash)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
    const fresh = await t.registry.describe(PACKAGE_ID, 'hook:runner');
    expect(fresh.approvalHash).not.toBe(staleHash);
    await expect(t.registry.enable(PACKAGE_ID, 'hook:runner', fresh.approvalHash)).resolves.toMatchObject({
      enabled: true,
      status: 'on',
    });
  });

  it('a script changed on disk under unchanged connections is caught by the registry and reported', async () => {
    const t = await setup({
      unchangedAdapter: true,
      beforeInstall: (directory) =>
        writeFile(path.join(directory, 'source', 'hooks', 'run.js'), 'console.log("changed")'),
    });
    const outcome = await createSourceUpdater(t.deps).update(PACKAGE_ID);
    if (outcome.status !== 'updated') throw new Error('expected an update');
    // The plan sees no change in the adapter text; the approval hash covers the script bytes, so the registry
    // turns both hooks off, and the observed result says so.
    expect(outcome.plan.counts.unchanged).toBe(6);
    for (const key of ['hook:runner', 'hook:steady']) {
      expect(outcome.connections.find((item) => item.key === key)).toMatchObject({
        change: 'unchanged',
        finalStatus: 'needs-input',
        reapprovalRequired: true,
      });
    }
    expect(outcome.connections.find((item) => item.key === 'command:same')).toMatchObject({ finalStatus: 'on' });
  });

  it('a package that did not move installs nothing and leaves every connection as it was', async () => {
    const t = await setup();
    const unchanged: SourceUpdateDeps = { ...t.deps, remote: { resolveCommit: async () => OLD_COMMIT } };
    await expect(createSourceUpdater(unchanged).update(PACKAGE_ID)).resolves.toMatchObject({ status: 'up-to-date' });
    expect(t.install).not.toHaveBeenCalled();
    expect(t.store.list(PACKAGE_ID).every((state) => state.enabled)).toBe(true);
  });
});
