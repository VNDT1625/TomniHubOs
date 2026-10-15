import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeArtifactIntegrity, isSetupOutputPath } from '@process/extensions/package-manager/artifactSecurity';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A pristine package folder: shipped files only, plus the manifest (which is never hashed). */
const pristinePayload = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tomny-setup-output-'));
  dirs.push(dir);
  await mkdir(path.join(dir, 'source', 'server'), { recursive: true });
  await mkdir(path.join(dir, 'source', '.claude-plugin'), { recursive: true });
  await mkdir(path.join(dir, 'adapter'), { recursive: true });
  await writeFile(path.join(dir, 'source', 'server', 'index.js'), 'process.stdin.resume();');
  await writeFile(path.join(dir, 'source', '.claude-plugin', 'plugin.json'), '{"name":"shipped"}');
  await writeFile(path.join(dir, 'adapter', 'adapter.json'), '{"connections":[]}');
  await writeFile(path.join(dir, 'tomny-package.json'), '{"id":"fixture"}');
  return dir;
};

/** What setup and runtime self-healing leave behind: a dependency tree and rewritten plugin metadata. */
const addSetupOutput = async (dir: string): Promise<void> => {
  await mkdir(path.join(dir, 'source', 'node_modules', 'dep'), { recursive: true });
  await writeFile(path.join(dir, 'source', 'node_modules', 'dep', 'index.js'), 'module.exports = 1;');
};

describe('setup output rule v1 (artifact integrity)', () => {
  it('a sealed payload with setup output hashes exactly like the pristine payload', async () => {
    const dir = await pristinePayload();
    const shipped = await computeArtifactIntegrity(dir);
    await addSetupOutput(dir);
    expect(await computeArtifactIntegrity(dir, undefined, { setupOutputs: 'exclude' })).toEqual(shipped);
  });

  it('a modified shipped file is still a mismatch, even with setup output present', async () => {
    const dir = await pristinePayload();
    const shipped = await computeArtifactIntegrity(dir);
    await addSetupOutput(dir);
    await writeFile(path.join(dir, 'source', '.claude-plugin', 'plugin.json'), '{"name":"rewritten"}');
    expect(await computeArtifactIntegrity(dir, undefined, { setupOutputs: 'exclude' })).not.toEqual(shipped);
  });

  it('an extra file outside source/node_modules is still a mismatch', async () => {
    const dir = await pristinePayload();
    const shipped = await computeArtifactIntegrity(dir);
    await writeFile(path.join(dir, 'source', 'server', 'extra.js'), 'injected');
    expect(await computeArtifactIntegrity(dir, undefined, { setupOutputs: 'exclude' })).not.toEqual(shipped);
  });

  it('include mode (archive verification) still hashes every file, setup output included', async () => {
    const dir = await pristinePayload();
    const shipped = await computeArtifactIntegrity(dir);
    await addSetupOutput(dir);
    expect(await computeArtifactIntegrity(dir)).not.toEqual(shipped);
  });

  it('an archive that carries setup output is refused at install', async () => {
    const dir = await pristinePayload();
    await addSetupOutput(dir);
    await expect(computeArtifactIntegrity(dir, undefined, { setupOutputs: 'reject' })).rejects.toThrow(
      'cannot contain setup output'
    );
  });

  it('a served file under setup output is never verified content', async () => {
    const dir = await pristinePayload();
    await addSetupOutput(dir);
    await expect(
      computeArtifactIntegrity(
        dir,
        { relativePath: 'source/node_modules/dep/index.js', content: 'module.exports = 2;' },
        { setupOutputs: 'exclude' }
      )
    ).rejects.toThrow('not part of the verified payload');
  });

  it('matches only the top-level setup output directory', () => {
    expect(isSetupOutputPath('source/node_modules/dep/index.js')).toBe(true);
    expect(isSetupOutputPath('source/node_modules')).toBe(true);
    expect(isSetupOutputPath('source/node_modules2/index.js')).toBe(false);
    expect(isSetupOutputPath('source/server/node_modules/index.js')).toBe(false);
    expect(isSetupOutputPath('adapter/adapter.json')).toBe(false);
  });
});
