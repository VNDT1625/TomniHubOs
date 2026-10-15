import { afterEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureCanonicalWorkspaceMetadata } from '@package-apps/ide/process/workspace/workspaceMetadataMigration';

const roots: string[] = [];

const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-metadata-'));
  roots.push(root);
  return root;
};

const write = async (root: string, relativePath: string, content: string): Promise<void> => {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ensureCanonicalWorkspaceMetadata', () => {
  it('moves a known .omni subtree into the canonical root and retires its source', async () => {
    const root = await makeRoot();
    await write(root, '.omni/specs/plan/requirements.md', '# Requirements');

    await expect(ensureCanonicalWorkspaceMetadata(root)).resolves.toMatchObject({ status: 'migrated' });
    await expect(readFile(path.join(root, '.tomni/specs/plan/requirements.md'), 'utf8')).resolves.toBe(
      '# Requirements'
    );
    await expect(lstat(path.join(root, '.omni'))).rejects.toThrow();
  });

  it('uses .omni before .tomny when canonical content is absent', async () => {
    const root = await makeRoot();
    await write(root, '.omni/wiki/wiki.json', '{\"source\":\"omni\"}');
    await write(root, '.tomny/wiki/wiki.json', '{\"source\":\"tomny\"}');

    const result = await ensureCanonicalWorkspaceMetadata(root);

    expect(result.status).toBe('conflicted');
    await expect(readFile(path.join(root, '.tomni/wiki/wiki.json'), 'utf8')).resolves.toBe('{\"source\":\"omni\"}');
    await expect(readFile(path.join(root, '.tomni/migration/metadata-v1.json'), 'utf8')).resolves.toContain('tomny');
  });

  it('preserves a legacy conflict without overwriting canonical content', async () => {
    const root = await makeRoot();
    await write(root, '.tomni/understand/summary.json', '{\"source\":\"canonical\"}');
    await write(root, '.omni/understand/summary.json', '{\"source\":\"legacy\"}');

    const result = await ensureCanonicalWorkspaceMetadata(root);

    expect(result.status).toBe('conflicted');
    await expect(readFile(path.join(root, '.tomni/understand/summary.json'), 'utf8')).resolves.toBe(
      '{\"source\":\"canonical\"}'
    );
    const conflictPath = result.entries[0]?.conflictPath;
    await expect(readFile(path.join(root, conflictPath as string), 'utf8')).resolves.toBe('{\"source\":\"legacy\"}');
    await expect(lstat(path.join(root, '.omni'))).rejects.toThrow();
  });

  it('retains an empty canonical file instead of overwriting it from legacy metadata', async () => {
    const root = await makeRoot();
    await write(root, '.tomni/wiki/wiki.json', '');
    await write(root, '.omni/wiki/wiki.json', '{"source":"legacy"}');

    await expect(ensureCanonicalWorkspaceMetadata(root)).resolves.toMatchObject({ status: 'conflicted' });
    await expect(readFile(path.join(root, '.tomni/wiki/wiki.json'), 'utf8')).resolves.toBe('');
  });

  it('preserves unknown legacy root entries under recovery metadata', async () => {
    const root = await makeRoot();
    await write(root, '.tomny/plugin-cache/state.json', '{\"version\":1}');

    await expect(ensureCanonicalWorkspaceMetadata(root)).resolves.toMatchObject({ status: 'migrated' });
    await expect(readFile(path.join(root, '.tomni/legacy-root/tomny/plugin-cache/state.json'), 'utf8')).resolves.toBe(
      '{\"version\":1}'
    );
  });

  it('resumes after a staged file already exists', async () => {
    const root = await makeRoot();
    await write(root, '.omni/wiki/wiki.json', '{\"version\":1}');
    await write(root, '.tomni/migration/staging/resume/wiki/wiki.json', '{\"version\":1}');

    await expect(ensureCanonicalWorkspaceMetadata(root)).resolves.toMatchObject({ status: 'migrated' });
    await expect(readFile(path.join(root, '.tomni/wiki/wiki.json'), 'utf8')).resolves.toBe('{\"version\":1}');
  });

  it('keeps every legacy source until the completion manifest is durable', async () => {
    const root = await makeRoot();
    await write(root, '.omni/specs/plan/requirements.md', '# Requirements');
    const migrationDirectory = path.join(root, '.tomni', 'migration');
    await mkdir(path.join(migrationDirectory, 'metadata-v1.json'), { recursive: true });

    const result = await ensureCanonicalWorkspaceMetadata(root);

    expect(result.status).toBe('failed');
    await expect(readFile(path.join(root, '.omni/specs/plan/requirements.md'), 'utf8')).resolves.toBe('# Requirements');
    await expect(readFile(path.join(root, '.tomni/specs/plan/requirements.md'), 'utf8')).resolves.toBe(
      '# Requirements'
    );
  });

  it('keeps both legacy roots when either source tree is unsafe', async () => {
    const root = await makeRoot();
    await write(root, '.omni/specs/plan/requirements.md', '# Requirements');
    await write(root, '.tomny/wiki/wiki.json', '{"source":"tomny"}');
    const outside = path.join(root, 'outside.json');
    await writeFile(outside, 'outside', 'utf8');
    await symlink(outside, path.join(root, '.tomny', 'wiki', 'unsafe.json'));

    await expect(ensureCanonicalWorkspaceMetadata(root)).resolves.toMatchObject({ status: 'failed' });
    await expect(readFile(path.join(root, '.omni/specs/plan/requirements.md'), 'utf8')).resolves.toBe('# Requirements');
    await expect(readFile(path.join(root, '.tomny/wiki/wiki.json'), 'utf8')).resolves.toBe('{"source":"tomny"}');
  });

  it('keeps a legacy root when it contains a symlink', async () => {
    const root = await makeRoot();
    const outside = path.join(root, 'outside.json');
    await writeFile(outside, '{\"secret\":true}', 'utf8');
    const legacy = path.join(root, '.omni', 'wiki');
    await mkdir(legacy, { recursive: true });
    await symlink(outside, path.join(legacy, 'wiki.json'));

    await expect(ensureCanonicalWorkspaceMetadata(root)).resolves.toMatchObject({ status: 'failed' });
    await expect(lstat(path.join(legacy, 'wiki.json'))).resolves.toMatchObject({
      isSymbolicLink: expect.any(Function),
    });
  });

  it('does not retire a previously staged source when another source is unsafe', async () => {
    const root = await makeRoot();
    await write(root, '.omni/specs/plan/requirements.md', '# Requirements');
    const outside = path.join(root, 'outside.json');
    await writeFile(outside, 'outside', 'utf8');
    const unsafeDirectory = path.join(root, '.omni', 'wiki');
    await mkdir(unsafeDirectory, { recursive: true });
    await symlink(outside, path.join(unsafeDirectory, 'wiki.json'));

    await expect(ensureCanonicalWorkspaceMetadata(root)).resolves.toMatchObject({ status: 'failed' });
    await expect(readFile(path.join(root, '.omni/specs/plan/requirements.md'), 'utf8')).resolves.toBe('# Requirements');
  });
});
