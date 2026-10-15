/* oxlint-disable no-await-in-loop -- steps of one scenario must run in order */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseAdapterDocument } from '@/common/packages/adapter';
import type { PackageTrust } from '@/common/packages/types';
import { createConnectionRegistry, type ConnectionRegistry } from '@process/integrations/connections/core/registry';
import { createJsonConnectionStateStore } from '@process/integrations/connections/core/state';
import { ConnectionError } from '@process/integrations/connections/core/types';
import { createCommandHost } from '@process/integrations/connections/hosts/data/commandHost';
import { createCliHosts, type CliProgramProbe } from '@process/integrations/connections/hosts/exec/cliHost';

const PACKAGE_ID = 'com.community.revoked-demo';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const connections = [
  {
    kind: 'tool',
    id: 'fmt',
    title: 'Formatter',
    description: 'Formats the workspace',
    command: 'prettier',
    args: ['run'],
  },
  {
    kind: 'cli',
    id: 'ctx7',
    title: 'Context7 CLI',
    command: 'ctx7',
    args: ['docs'],
    display: 'terminal',
    source: 'npm',
    package: 'ctx7',
  },
  { kind: 'command', id: 'hi', title: 'Say hi', path: 'source/commands/hi.md', format: 'markdown' },
];

/** A package with two code connections (tool, cli) and one data connection (command), and a movable trust tier. */
const makeWorld = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-revoked-trust-'));
  roots.push(root);
  const packageDirectory = path.join(root, 'pkg');
  await mkdir(path.join(packageDirectory, 'source', 'commands'), { recursive: true });
  await writeFile(path.join(packageDirectory, 'source', 'commands', 'hi.md'), '# Say hi\n\nSay hello.\n');
  const store = createJsonConnectionStateStore(path.join(root, 'state.json'));
  await store.initialize();
  const adapter = parseAdapterDocument({ schemaVersion: 1, generatedBy: 'classifier', connections });
  const programProbe = vi.fn<CliProgramProbe>(async () => ({ ok: true }));
  let trust: PackageTrust = 'local-built';
  const registry = createConnectionRegistry({
    store,
    hosts: [...createCliHosts({ programProbe }), createCommandHost()],
    loadPackage: async (packageId) =>
      packageId === PACKAGE_ID ? { packageId, packageVersion: '1.0.0', packageDirectory, adapter, trust } : undefined,
    listInstalledPackageIds: async () => [PACKAGE_ID],
  });
  await registry.syncPackage(PACKAGE_ID);
  return {
    registry,
    store,
    setTrust: (value: PackageTrust) => {
      trust = value;
    },
  };
};

const turnOn = async (registry: ConnectionRegistry, key: string) => {
  const approval = await registry.describe(PACKAGE_ID, key);
  return registry.enable(PACKAGE_ID, key, approval.approvalHash);
};

describe('connections of a package whose local signing key was revoked', () => {
  it('switches its code connections off and keeps its data connections on, with a notice', async () => {
    const world = await makeWorld();
    await turnOn(world.registry, 'tool:fmt');
    await turnOn(world.registry, 'cli:ctx7');
    await turnOn(world.registry, 'command:hi');

    world.setTrust('unsigned-revoked');
    await world.registry.reconcile();

    const tool = world.store.get(PACKAGE_ID, 'tool:fmt');
    const cli = world.store.get(PACKAGE_ID, 'cli:ctx7');
    const command = world.store.get(PACKAGE_ID, 'command:hi');
    expect([tool?.enabled, tool?.status]).toEqual([false, 'needs-input']);
    expect(tool?.reason).toBeTruthy();
    expect([cli?.enabled, cli?.status]).toEqual([false, 'needs-input']);
    expect([command?.enabled, command?.status]).toEqual([true, 'on']);
    expect(command?.reason).toBeTruthy();
    expect((await world.registry.enabledOfKind('tool')).length).toBe(0);
    expect((await world.registry.enabledOfKind('command')).map((found) => found.key)).toEqual(['command:hi']);
  });

  it('refuses to turn a code connection on while the package is unsigned-revoked', async () => {
    const world = await makeWorld();
    world.setTrust('unsigned-revoked');
    await world.registry.reconcile();

    await expect(turnOn(world.registry, 'tool:fmt')).rejects.toBeInstanceOf(ConnectionError);
    await expect(turnOn(world.registry, 'cli:ctx7')).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(world.store.get(PACKAGE_ID, 'tool:fmt')?.enabled ?? false).toBe(false);
  });

  it('keeps code connections off after the package is signed again, until they are approved again', async () => {
    const world = await makeWorld();
    await turnOn(world.registry, 'tool:fmt');
    world.setTrust('unsigned-revoked');
    await world.registry.reconcile();

    world.setTrust('local-built');
    await world.registry.syncPackage(PACKAGE_ID);

    expect(world.store.get(PACKAGE_ID, 'tool:fmt')).toMatchObject({ enabled: false, status: 'off' });
    expect(world.store.get(PACKAGE_ID, 'command:hi')?.reason).toBeUndefined();
    await expect(turnOn(world.registry, 'tool:fmt')).resolves.toMatchObject({ enabled: true, status: 'on' });
  });
});
