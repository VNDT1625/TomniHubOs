import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostContext } from '@process/integrations/connections/core/types';
import { createInstalledAppProbe } from '@process/integrations/runtime/installedAppProbe';
import { createLauncherBindings } from '@process/integrations/runtime/launcherBindings';
import { createLauncherHost } from '@process/integrations/connections/hosts/exec/launcherHost';

const roots: string[] = [];
const fixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-launcher-'));
  roots.push(root);
  const executable = path.join(root, process.platform === 'win32' ? 'demo.exe' : 'demo');
  const name = path.basename(executable);
  await writeFile(executable, '');
  const probe = createInstalledAppProbe({
    platform: process.platform,
    env: { PATH: root },
    existsFile: async (candidate) => candidate === executable,
    queryAppPath: async () => [executable, executable, path.join(root, 'wrong.exe')],
    shortcutTargets: async () => [],
  });
  const bindings = createLauncherBindings(path.join(root, 'bindings.json'), probe);
  const context: HostContext = {
    packageId: 'local.demo',
    packageVersion: '1.0.0',
    packageDirectory: root,
    readPackageFile: async () => Buffer.alloc(0),
  };
  const connection = {
    kind: 'launcher',
    id: 'app',
    title: 'Demo app',
    target: { kind: 'installed', executable: name, release: { owner: 'acme', repo: 'demo', assetPattern: '*.exe' } },
  };
  return { root, executable, name, probe, bindings, context, connection };
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('T5.6 launcher discovery and binding', () => {
  it('discovers validated executables on PATH, deduplicates candidates and refuses unrelated names', async () => {
    const f = await fixture();
    expect(await f.probe.find(f.name)).toEqual([f.executable]);
    expect(await f.probe.verify('other.exe', f.executable)).toBe(false);
    expect(await f.probe.find('../../etc/passwd')).toEqual([]);
  });
  it('reports needs-input until Main binds an executable; never selects a candidate automatically', async () => {
    const f = await fixture();
    const host = createLauncherHost({ probe: f.probe, bindings: f.bindings });
    const missing = await host.check(f.context, f.connection as never);
    expect(missing).toMatchObject({ ok: false, needsInput: true });
    await expect(host.enable(f.context, f.connection as never)).rejects.toThrow(/Choose/);
    const before = await host.describe(f.context, f.connection as never);
    expect(before.lines.some((line) => line.value === 'not linked')).toBe(true);
    expect(await f.bindings.bind(f.context.packageId, f.connection.id, f.name, f.executable)).toBe(true);
    expect(await host.check(f.context, f.connection as never)).toEqual({ ok: true });
    const subject = await host.describe(f.context, f.connection as never);
    expect(subject.lines.some((line) => line.value === f.executable)).toBe(true);
    expect(subject.lines.some((line) => line.value === 'https://github.com/acme/demo/releases/latest')).toBe(true);
    expect(await host.enable(f.context, f.connection as never)).toEqual({
      installed: ['launcher:local.demo:app'],
    });
    await host.disable(f.context, f.connection as never, []);
    expect(await f.bindings.get('local.demo', 'app')).toBe(f.executable);
  });
  it('rejects arbitrary paths and preserves user binding across a second store instance', async () => {
    const f = await fixture();
    expect(await f.bindings.bind('local.demo', 'app', f.name, path.join(f.root, 'wrong.exe'))).toBe(false);
    expect(await f.bindings.bind('local.demo', 'app', f.name, f.executable)).toBe(true);
    const restarted = createLauncherBindings(path.join(f.root, 'bindings.json'), f.probe);
    expect(await restarted.get('local.demo', 'app')).toBe(f.executable);
    await restarted.forget('local.demo', 'app');
    expect(await f.bindings.get('local.demo', 'app')).toBeUndefined();
  });
});
