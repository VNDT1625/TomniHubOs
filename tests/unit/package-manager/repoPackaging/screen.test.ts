import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  buildOutputRoot,
  classifyPathExclusion,
  findSecretLabels,
  isSafeEntryPath,
  listCandidatePaths,
  loadAndScreenPayload,
  screenCandidates,
} from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/fileScreen';
import { fakeSecrets, runGit, withTemp, writeTree } from './helpers';

describe('name rules', () => {
  it.each([
    ['.env', 'secret-name'],
    ['.env.local', 'secret-name'],
    ['config/.env.production', 'secret-name'],
    ['keys/id_rsa', 'secret-name'],
    ['certs/server.pem', 'secret-name'],
    ['deploy/store.keystore', 'secret-name'],
    ['app/credentials.json', 'secret-name'],
    ['gcp-service-account-prod.json', 'secret-name'],
    ['infra/terraform.tfstate', 'secret-name'],
    ['.ssh/config', 'secret-name'],
    ['home/.aws/credentials', 'secret-name'],
    ['node_modules/pkg/index.js', 'vcs-or-tooling'],
    ['.github/workflows/ci.yml', 'vcs-or-tooling'],
    ['.git/config', 'vcs-or-tooling'],
    ['Thumbs.db', 'vcs-or-tooling'],
    ['package-lock.json', 'lockfile'],
    ['pnpm-lock.yaml', 'lockfile'],
    ['con.txt', 'unsafe-path'],
    ['a/../b.txt', 'unsafe-path'],
  ] as const)('excludes %s as %s', (relativePath, reason) => {
    expect(classifyPathExclusion(relativePath)?.reason).toBe(reason);
  });

  it.each([
    '.env.example',
    '.env.sample',
    '.env.template',
    'src/app.ts',
    'README.md',
    '.gitignore',
    'docs/keyboard.md',
    'src/environment.ts',
    'dist/index.html',
  ])('keeps %s', (relativePath) => {
    expect(classifyPathExclusion(relativePath)).toBeUndefined();
  });

  it('finds build output only as a directory segment', () => {
    expect(buildOutputRoot('dist/assets/app.js')).toBe('dist');
    expect(buildOutputRoot('packages/web/build/index.html')).toBe('packages/web/build');
    expect(buildOutputRoot('src/dist.ts')).toBeUndefined();
    expect(buildOutputRoot('distribution/readme.md')).toBeUndefined();
  });

  it.each(['a.txt', 'src/app.ts', 'dir/sub/file.name.js'])('treats %s as a safe entry path', (value) => {
    expect(isSafeEntryPath(value)).toBe(true);
  });

  it.each([
    '',
    '/etc/passwd',
    '../x',
    'a/./b',
    'a//b',
    'a\\b',
    'C:/Windows/x',
    'aux',
    'nul.txt',
    'a/b.',
    'a/b ',
    'a/b:stream',
    'bad\u0000name',
    `${'x'.repeat(300)}.txt`,
  ])('rejects %j as an entry path', (value) => {
    expect(isSafeEntryPath(value)).toBe(false);
  });
});

describe('credential shapes', () => {
  it.each([
    ['private key block', fakeSecrets.privateKeyBlock],
    ['AWS access key id', `const k = "${fakeSecrets.awsKey}";`],
    ['GitHub token', `token=${fakeSecrets.githubToken}`],
    ['Stripe live key', fakeSecrets.stripeLive],
  ])('detects a %s', (label, text) => {
    expect(findSecretLabels(text)).toContain(label);
  });

  it('reports labels, never the matched text', () => {
    const labels = findSecretLabels(`${fakeSecrets.awsKey} ${fakeSecrets.githubToken}`);
    expect(labels.join(' ')).not.toContain(fakeSecrets.awsKey);
    expect(labels.join(' ')).not.toContain(fakeSecrets.githubToken);
  });

  it('leaves ordinary source and placeholders alone', () => {
    expect(findSecretLabels('const apiKey = process.env.API_KEY; // sk-... AKIA... ghp_...')).toEqual([]);
    expect(findSecretLabels('export const add = (a: number, b: number) => a + b;')).toEqual([]);
  });
});

describe('listing', () => {
  it('honours .gitignore inside a repository and includes untracked files', async () => {
    await withTemp(async (root) => {
      runGit(root, 'init', '-q');
      await writeTree(root, {
        '.gitignore': 'ignored/\n*.log\n',
        'src/app.ts': 'export {}',
        'ignored/skip.ts': 'x',
        'debug.log': 'x',
        'notes/new.md': '# new',
      });
      const { paths, usedGit } = await listCandidatePaths(root, DEFAULT_LIMITS, undefined);
      expect(usedGit).toBe(true);
      expect(paths.toSorted()).toEqual(['.gitignore', 'notes/new.md', 'src/app.ts']);
    });
  });

  it('does not apply another repository’s ignore rules to a folder that merely sits inside it', async () => {
    await withTemp(async (parent) => {
      runGit(parent, 'init', '-q');
      await writeTree(parent, { '.gitignore': 'child/\n', 'child/a.ts': 'x', 'child/b.ts': 'y' });
      const { paths, usedGit } = await listCandidatePaths(path.join(parent, 'child'), DEFAULT_LIMITS, undefined);
      expect(usedGit).toBe(false);
      expect(paths.toSorted()).toEqual(['a.ts', 'b.ts']);
    });
  });

  it('walks a plain folder, skipping dependency and build-tool folders but keeping published output', async () => {
    await withTemp(async (root) => {
      await writeTree(root, {
        'index.html': '<html></html>',
        'dist/index.html': '<html></html>',
        'node_modules/pkg/index.js': 'x',
        'target/debug/big.rlib': 'x',
        'venv/lib/x.py': 'x',
      });
      const { paths, usedGit } = await listCandidatePaths(root, DEFAULT_LIMITS, undefined);
      expect(usedGit).toBe(false);
      expect(paths.toSorted()).toEqual(['dist/index.html', 'index.html']);
    });
  });

  it('stops a runaway tree instead of listing it', async () => {
    await withTemp(async (root) => {
      await writeTree(root, Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`f${index}.txt`, 'x'])));
      await expect(listCandidatePaths(root, { ...DEFAULT_LIMITS, maxFiles: 5 }, undefined)).rejects.toMatchObject({
        code: 'TOO_MANY_FILES',
      });
    });
  });

  it('honours cancellation', async () => {
    await withTemp(async (root) => {
      await writeTree(root, { 'a.txt': 'x' });
      const controller = new AbortController();
      controller.abort();
      await expect(listCandidatePaths(root, DEFAULT_LIMITS, controller.signal)).rejects.toMatchObject({
        code: 'CANCELLED',
      });
    });
  });
});

describe('metadata screening', () => {
  it('drops oversized files, files under the output folder, and unsafe names, and reports each', async () => {
    await withTemp(async (root) => {
      await writeTree(root, {
        'keep.txt': 'ok',
        'big.bin': Buffer.alloc(2048),
        '.store-output/old.tomny': 'previous package',
        'out/pkg.tomny': 'previous package',
        '.env': 'A=1',
      });
      const screened = await screenCandidates(
        root,
        ['keep.txt', 'big.bin', '.store-output/old.tomny', 'out/pkg.tomny', '.env', 'con.txt'],
        { ...DEFAULT_LIMITS, maxFileBytes: 1024 },
        path.join(root, 'out')
      );
      expect(screened.files.map((file) => file.relativePath)).toEqual(['keep.txt']);
      const reasons = Object.fromEntries(screened.excluded.map((entry) => [entry.path, entry.reason]));
      expect(reasons).toEqual({
        'big.bin': 'too-large',
        '.store-output/old.tomny': 'vcs-or-tooling',
        'out/pkg.tomny': 'output-directory',
        '.env': 'secret-name',
        'con.txt': 'unsafe-path',
      });
    });
  });

  it('never follows a symbolic link', async () => {
    await withTemp(async (root) => {
      await writeTree(root, { 'real.txt': 'ok', 'outside/secret.txt': 'secret' });
      try {
        await symlink(path.join(root, 'outside', 'secret.txt'), path.join(root, 'link.txt'));
      } catch {
        return; // Creating symbolic links needs a privilege some machines do not grant.
      }
      const screened = await screenCandidates(root, ['real.txt', 'link.txt'], DEFAULT_LIMITS, undefined);
      expect(screened.files.map((file) => file.relativePath)).toEqual(['real.txt']);
      expect(screened.excluded).toContainEqual({ path: 'link.txt', reason: 'symlink' });
    });
  });

  it('skips files that disappeared between listing and reading', async () => {
    await withTemp(async (root) => {
      await writeTree(root, { 'a.txt': 'x' });
      const screened = await screenCandidates(root, ['a.txt', 'gone.txt'], DEFAULT_LIMITS, undefined);
      expect(screened.files.map((file) => file.relativePath)).toEqual(['a.txt']);
    });
  });
});

describe('content screening', () => {
  const load = async (root: string, relativePaths: readonly string[], limits = DEFAULT_LIMITS) => {
    const screened = await screenCandidates(root, relativePaths, limits, undefined);
    return loadAndScreenPayload(screened.files, limits, undefined);
  };

  it('leaves out a file containing a credential shape and warns without echoing it', async () => {
    await withTemp(async (root) => {
      await writeTree(root, {
        'src/ok.js': 'export const ok = 1;',
        'src/leak.js': `const key = "${fakeSecrets.awsKey}";`,
        'src/token.js': `const t = "${fakeSecrets.githubToken}";`,
      });
      const result = await load(root, ['src/ok.js', 'src/leak.js', 'src/token.js']);
      expect(result.payload.map((file) => file.relativePath)).toEqual(['src/ok.js']);
      expect(result.excluded.map((entry) => entry.path).toSorted()).toEqual(['src/leak.js', 'src/token.js']);
      expect(result.warnings.filter((warning) => warning.code === 'SECRET_IN_SOURCE')).toHaveLength(2);
      const report = JSON.stringify([result.excluded, result.warnings]);
      expect(report).not.toContain(fakeSecrets.awsKey);
      expect(report).not.toContain(fakeSecrets.githubToken);
    });
  });

  it('warns about install-time scripts, runtime-decoded code and executables without blocking them', async () => {
    // Inert fixture text for the detector; it is written to a temp file and never executed.
    const decodedAtRuntime = ['ev', 'al(atob("YWxlcnQoMSk="));'].join('');
    await withTemp(async (root) => {
      await writeTree(root, {
        'package.json': JSON.stringify({ scripts: { postinstall: 'node setup.js', test: 'vitest' } }),
        'dist/run.js': decodedAtRuntime,
        'bin/tool.exe': Buffer.from([0x4d, 0x5a, 0, 0]),
        'bin/setup.sh': '#!/bin/sh\necho hi\n',
      });
      const result = await load(root, ['package.json', 'dist/run.js', 'bin/tool.exe', 'bin/setup.sh']);
      const codes = result.warnings.map((warning) => warning.code).toSorted();
      expect(codes).toEqual(['EXECUTABLE_CONTENT', 'LIFECYCLE_SCRIPT', 'OBFUSCATED_CODE']);
      expect(result.warnings.find((warning) => warning.code === 'LIFECYCLE_SCRIPT')?.message).toContain('postinstall');
      expect(result.warnings.find((warning) => warning.code === 'EXECUTABLE_CONTENT')?.message).toContain(
        '2 executable'
      );
      expect(result.payload).toHaveLength(4);
    });
  });

  it('does not scan binary files for credential text', async () => {
    await withTemp(async (root) => {
      await writeTree(root, {
        'asset.bin': Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(fakeSecrets.awsKey)]),
      });
      const result = await load(root, ['asset.bin']);
      expect(result.payload).toHaveLength(1);
      expect(result.excluded).toEqual([]);
    });
  });

  it('enforces the total size cap while reading', async () => {
    await withTemp(async (root) => {
      await writeTree(root, { 'a.bin': Buffer.alloc(600), 'b.bin': Buffer.alloc(600) });
      await expect(load(root, ['a.bin', 'b.bin'], { ...DEFAULT_LIMITS, maxPayloadBytes: 1000 })).rejects.toMatchObject({
        code: 'PAYLOAD_TOO_LARGE',
      });
    });
  });

  it('honours cancellation between files', async () => {
    await withTemp(async (root) => {
      await writeFile(path.join(root, 'a.txt'), 'x');
      await mkdir(path.join(root, 'd'));
      const screened = await screenCandidates(root, ['a.txt'], DEFAULT_LIMITS, undefined);
      const controller = new AbortController();
      controller.abort();
      await expect(loadAndScreenPayload(screened.files, DEFAULT_LIMITS, controller.signal)).rejects.toMatchObject({
        code: 'CANCELLED',
      });
    });
  });
});
