import { readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireSource,
  parseSource,
  sanitizeSubdirectory,
} from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/sourceResolver';
import { isolateTmpdir, redirectGitHub, runGit, withTemp, writeTree } from './helpers';

describe('parsing what the user typed', () => {
  it('reads a plain repository URL into a canonical clone address', () => {
    expect(parseSource('https://github.com/acme/site')).toEqual({
      kind: 'git',
      cloneUrl: 'https://github.com/acme/site.git',
      host: 'github.com',
      ref: undefined,
      subdirectory: undefined,
    });
    expect(parseSource('https://www.GitHub.com/acme/site.git?tab=readme#top')).toMatchObject({
      cloneUrl: 'https://github.com/acme/site.git',
    });
  });

  it('reads a /tree/ URL into a ref and a folder', () => {
    expect(parseSource('https://github.com/acme/site/tree/release/packages/web')).toMatchObject({
      ref: 'release',
      subdirectory: 'packages/web',
    });
    expect(parseSource('https://gitlab.com/acme/site/-/tree/main')).toMatchObject({ ref: 'main' });
  });

  it('treats paths, including Windows drives, as local', () => {
    expect(parseSource('')).toEqual({ kind: 'local', path: '' });
    expect(parseSource('./site')).toEqual({ kind: 'local', path: './site' });
    expect(parseSource('C:\\work\\site')).toEqual({ kind: 'local', path: 'C:\\work\\site' });
    expect(parseSource('docs/api')).toEqual({ kind: 'local', path: 'docs/api' });
  });

  it.each([
    ['plain http', 'http://github.com/acme/site'],
    ['ssh', 'git@github.com:acme/site.git'],
    ['an ssh URL', 'ssh://git@github.com/acme/site.git'],
    ['a file URL', 'file:///etc/passwd'],
    ['the git ext transport', 'ext::sh -c "touch pwned" #.git'],
    ['an option-looking value', '--upload-pack=touch pwned.git'],
    ['embedded credentials', 'https://user:pass@github.com/acme/site'],
    ['a non-default port', 'https://github.com:8443/acme/site'],
    ['a control character', 'https://github.com/acme/site\u0000'],
    ['a repository with no name', 'https://github.com/acme'],
    ['a blob URL', 'https://github.com/acme/site/blob/main/readme.md'],
    ['an invalid owner', 'https://github.com/ac me/site'],
    ['a ref that climbs', 'https://github.com/acme/site/tree/a..b'],
    ['an oversized value', `https://github.com/acme/${'x'.repeat(3000)}`],
  ])('rejects %s', (_label, value) => {
    expect(() => parseSource(value)).toThrowError(
      expect.objectContaining({ code: expect.stringMatching(/^SOURCE_/u) })
    );
  });

  it('only allows hosts on the list, and a custom list replaces the default', () => {
    expect(() => parseSource('https://evil.example/acme/site')).toThrowError(
      expect.objectContaining({ code: 'SOURCE_HOST_NOT_ALLOWED' })
    );
    expect(() => parseSource('https://169.254.169.254/latest/meta-data')).toThrowError(
      expect.objectContaining({ code: 'SOURCE_HOST_NOT_ALLOWED' })
    );
    expect(parseSource('https://git.example.org/acme/site', ['git.example.org'])).toMatchObject({
      host: 'git.example.org',
    });
    expect(() => parseSource('https://github.com/acme/site', ['git.example.org'])).toThrowError(
      expect.objectContaining({ code: 'SOURCE_HOST_NOT_ALLOWED' })
    );
  });

  it('keeps a sub-folder below the source root', () => {
    expect(sanitizeSubdirectory(undefined)).toBeUndefined();
    expect(sanitizeSubdirectory('.')).toBeUndefined();
    expect(sanitizeSubdirectory('packages\\web/')).toBe('packages/web');
    for (const bad of ['../x', 'a/../../x', '/etc', 'C:/x', 'a/./b']) {
      expect(() => sanitizeSubdirectory(bad)).toThrowError(expect.objectContaining({ code: 'SOURCE_INVALID' }));
    }
  });
});

describe('local sources', () => {
  const acquire = (root: string, source: string, extra: Record<string, unknown> = {}) =>
    acquireSource({ source, workspaceRoot: root, cloneTimeoutMs: 1000, ...extra });

  it('resolves inside the workspace, and an empty source means the workspace itself', async () => {
    await withTemp(async (workspace) => {
      await writeTree(workspace, { 'site/index.html': '<html></html>' });
      const inside = await acquire(workspace, 'site');
      expect(path.basename(inside.root)).toBe('site');
      expect(inside.repositoryName).toBe('site');
      expect(inside.info.kind).toBe('local');
      const whole = await acquire(workspace, '');
      expect(path.basename(whole.root)).toBe(path.basename(workspace));
    });
  });

  it('refuses a folder outside the workspace, however it is spelled', async () => {
    await withTemp(async (parent) => {
      const workspace = path.join(parent, 'workspace');
      await writeTree(parent, { 'workspace/a.txt': 'x', 'other/b.txt': 'y' });
      for (const source of ['../other', path.join(parent, 'other'), 'sub/../../other']) {
        // oxlint-disable-next-line no-await-in-loop
        await expect(acquire(workspace, source)).rejects.toMatchObject({ code: 'SOURCE_OUTSIDE_WORKSPACE' });
      }
    });
  });

  it('refuses a symbolic link that leads outside the workspace', async () => {
    await withTemp(async (parent) => {
      const workspace = path.join(parent, 'workspace');
      await writeTree(parent, { 'workspace/a.txt': 'x', 'other/b.txt': 'y' });
      try {
        await symlink(path.join(parent, 'other'), path.join(workspace, 'link'), 'junction');
      } catch {
        return;
      }
      await expect(acquire(workspace, 'link')).rejects.toMatchObject({ code: 'SOURCE_OUTSIDE_WORKSPACE' });
    });
  });

  it('allows an outside folder only when the caller opts in', async () => {
    await withTemp(async (parent) => {
      await writeTree(parent, { 'workspace/a.txt': 'x', 'other/b.txt': 'y' });
      const allowed = await acquire(path.join(parent, 'workspace'), path.join(parent, 'other'), {
        allowLocalOutsideWorkspace: true,
      });
      expect(path.basename(allowed.root)).toBe('other');
    });
  });

  it('reports a missing folder, a file, and a sub-folder that is not there', async () => {
    await withTemp(async (workspace) => {
      await writeTree(workspace, { 'file.txt': 'x', 'site/index.html': 'x' });
      await expect(acquire(workspace, 'nope')).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
      await expect(acquire(workspace, 'file.txt')).rejects.toMatchObject({ code: 'SOURCE_INVALID' });
      await expect(acquire(workspace, 'site', { subdirectory: 'missing' })).rejects.toMatchObject({
        code: 'SOURCE_NOT_FOUND',
      });
    });
  });

  it('packages a sub-folder as the source root', async () => {
    await withTemp(async (workspace) => {
      await writeTree(workspace, { 'site/packages/web/index.html': 'x' });
      const sub = await acquire(workspace, 'site', { subdirectory: 'packages/web' });
      expect(sub.root.replaceAll('\\', '/')).toMatch(/site\/packages\/web$/u);
      expect(sub.info.subdirectory).toBe('packages/web');
    });
  });

  it('rejects a branch for a local folder', async () => {
    await withTemp(async (workspace) => {
      await writeTree(workspace, { 'a.txt': 'x' });
      await expect(acquire(workspace, '', { ref: 'main' })).rejects.toMatchObject({ code: 'SOURCE_INVALID' });
    });
  });
});

describe('cloning', () => {
  let restore: (() => void) | undefined;
  let restoreTmp: (() => void) | undefined;
  beforeEach(() => {
    restoreTmp = isolateTmpdir();
  });
  afterEach(() => {
    restore?.();
    restore = undefined;
    restoreTmp?.();
    restoreTmp = undefined;
  });

  const temporaryClones = async (): Promise<string[]> =>
    (await readdir(tmpdir())).filter((name) => name.startsWith('tomni-repo-packager-'));

  const makeBareRepository = async (root: string): Promise<string> => {
    const work = path.join(root, 'work');
    const bare = path.join(root, 'site.git');
    await writeTree(work, { 'index.html': '<html>v1</html>', 'src/app.js': 'export {}' });
    runGit(work, 'init', '-q', '-b', 'main');
    runGit(work, 'add', '-A');
    runGit(work, 'commit', '-q', '-m', 'one');
    runGit(work, 'checkout', '-q', '-b', 'feature');
    await writeFile(path.join(work, 'feature.txt'), 'feature');
    runGit(work, 'add', '-A');
    runGit(work, 'commit', '-q', '-m', 'feature');
    runGit(work, 'checkout', '-q', 'main');
    runGit(root, 'clone', '-q', '--bare', work, bare);
    return bare;
  };

  it('clones shallowly through the hardened command and reports the commit and name', async () => {
    await withTemp(async (root) => {
      const bare = await makeBareRepository(root);
      restore = redirectGitHub('acme', 'site', bare);
      const before = await temporaryClones();
      const source = await acquireSource({ source: 'https://github.com/acme/site', cloneTimeoutMs: 60_000 });
      try {
        expect(source.repositoryName).toBe('site');
        expect(source.info).toMatchObject({ kind: 'git', display: 'https://github.com/acme/site.git' });
        expect(source.info.commit).toBe(runGit(bare, 'rev-parse', 'main'));
        await expect(stat(path.join(source.root, 'index.html'))).resolves.toBeTruthy();
      } finally {
        await source.cleanup();
      }
      await expect(stat(source.root)).rejects.toMatchObject({ code: 'ENOENT' });
      await source.cleanup(); // Idempotent.
      expect(await temporaryClones()).toEqual(before);
    });
  });

  it('clones the branch that was asked for', async () => {
    await withTemp(async (root) => {
      restore = redirectGitHub('acme', 'site', await makeBareRepository(root));
      const source = await acquireSource({
        source: 'https://github.com/acme/site',
        ref: 'feature',
        cloneTimeoutMs: 60_000,
      });
      try {
        await expect(stat(path.join(source.root, 'feature.txt'))).resolves.toBeTruthy();
        expect(source.info.ref).toBe('feature');
      } finally {
        await source.cleanup();
      }
    });
  });

  it('can package a sub-folder of the clone', async () => {
    await withTemp(async (root) => {
      restore = redirectGitHub('acme', 'site', await makeBareRepository(root));
      const source = await acquireSource({
        source: 'https://github.com/acme/site/tree/main/src',
        cloneTimeoutMs: 60_000,
      });
      try {
        expect(source.root.replaceAll('\\', '/')).toMatch(/\/repo\/src$/u);
        expect(source.info.subdirectory).toBe('src');
      } finally {
        await source.cleanup();
      }
    });
  });

  it('removes its temporary folder when the clone fails, and says why', async () => {
    await withTemp(async (root) => {
      restore = redirectGitHub('acme', 'site', path.join(root, 'does-not-exist.git'));
      const before = await temporaryClones();
      await expect(
        acquireSource({ source: 'https://github.com/acme/site', cloneTimeoutMs: 60_000 })
      ).rejects.toMatchObject({ code: 'CLONE_FAILED' });
      expect(await temporaryClones()).toEqual(before);
    });
  });

  it('stops before cloning when cancellation was requested', async () => {
    const controller = new AbortController();
    controller.abort();
    const before = await temporaryClones();
    await expect(
      acquireSource({ source: 'https://github.com/acme/site', cloneTimeoutMs: 60_000, signal: controller.signal })
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(await temporaryClones()).toEqual(before);
  });

  it('never reaches the network for a refused host', async () => {
    await expect(
      acquireSource({ source: 'https://evil.example/acme/site', cloneTimeoutMs: 1000 })
    ).rejects.toMatchObject({ code: 'SOURCE_HOST_NOT_ALLOWED' });
  });
});
