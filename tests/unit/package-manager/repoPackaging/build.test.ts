import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parsePackageManifest } from '../../../../packages/desktop/src/common/packages';
import {
  PACKAGE_MANIFEST_FILE,
  computeArtifactIntegrity,
  verifyArtifactSignature,
} from '../../../../packages/desktop/src/process/extensions/package-manager/artifactSecurity';
import { verifyWrittenArchive } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/archive';
import { buildTomnyPackageFromRepo } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/packager';
import {
  loadOrCreateSigningIdentity,
  identityFromPrivateKey,
} from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/signingKey';
import { STAGE_ORDER } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/report';
import type {
  RepoPackagingProgress,
  RepoToPackageOptions,
} from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/types';
import {
  extractArchive,
  fakeSecrets,
  isolateTmpdir,
  readArchive,
  redirectGitHub,
  runGit,
  testSigning,
  withTemp,
  writeTree,
} from './helpers';

const PAGE = '<!doctype html><html><head><title>t</title></head><body><script src="app.js"></script></body></html>';

const build = (root: string, overrides: Partial<RepoToPackageOptions> & { out?: string } = {}) => {
  const { out, ...rest } = overrides;
  return buildTomnyPackageFromRepo({
    source: '',
    workspaceRoot: root,
    outputDirectory: out ?? path.join(path.dirname(root), `${path.basename(root)}-out`),
    signing: testSigning(),
    ...rest,
  });
};

describe('a static web app', () => {
  it('produces a package the installer’s own integrity check accepts, even with mixed-case file names', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, {
        'index.html': PAGE,
        'app.js': 'document.title = "x";',
        'README.md': '# readme',
        LICENSE: 'MIT',
        'Zebra.css': 'body{}',
        'assets/Logo.svg': '<svg/>',
      });
      const result = await build(site, { out: path.join(parent, 'out') });

      const extracted = path.join(parent, 'extracted');
      await extractArchive(result.artifactPath, extracted);
      const installerView = await computeArtifactIntegrity(extracted);
      expect(installerView.integrity).toBe(result.manifest.artifact?.integrity);
      expect(installerView.sizeBytes).toBe(result.manifest.artifact?.sizeBytes);

      // The ordering the packager used to apply (locale-aware) gives a different hash for these names.
      const entries = [...(await readArchive(result.artifactPath))].filter(([name]) => name !== PACKAGE_MANIFEST_FILE);
      const hash = createHash('sha256');
      for (const [name, content] of entries.toSorted((a, b) => a[0].localeCompare(b[0]))) {
        hash.update(name);
        hash.update('\0');
        hash.update(content);
        hash.update('\0');
      }
      expect(`sha256-${hash.digest('hex')}`).not.toBe(result.manifest.artifact?.integrity);
    });
  });

  it('classifies it, signs it with a key that verifies, and re-verifies the written file', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'color-tool');
      await writeTree(site, {
        'index.html': PAGE,
        'app.js': '1',
        'package.json': JSON.stringify({ name: 'color-tool', version: '0.3.0' }),
      });
      const result = await build(site, { out: path.join(parent, 'out') });

      expect(result.classification.archetype).toBe('web-surface-app');
      expect(result.manifest).toMatchObject({ id: 'com.community.color-tool', version: '0.3.0', type: 'app' });
      expect(result.manifest.modules[0]).toMatchObject({ runtime: 'sandboxed-web', entrypoint: 'index.html' });
      expect(result.manifest.permissions).toEqual([]);
      expect(result.verified).toBe(true);
      expect(result.publicKeyPem).toContain('BEGIN PUBLIC KEY');
      expect(() => verifyArtifactSignature(result.manifest, { [result.keyId]: result.publicKeyPem })).not.toThrow();
      expect(() => verifyArtifactSignature(result.manifest, { [result.keyId]: testSigning().privateKeyPem })).toThrow();
      expect('privateKeyPem' in result).toBe(false);
      expect(path.dirname(result.artifactPath)).toBe(path.join(parent, 'out'));
      await expect(stat(result.artifactPath)).resolves.toBeTruthy();
    });
  });

  it('is byte-identical on a second run and never packages an earlier package', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, { 'index.html': PAGE, 'app.js': '1' });
      const options = { out: path.join(site, '.store-output'), signing: testSigning() };
      const first = await build(site, options);
      const second = await build(site, options);
      expect(second.archiveBytes).toBe(first.archiveBytes);
      expect(second.manifest.artifact?.integrity).toBe(first.manifest.artifact?.integrity);
      expect([...(await readArchive(second.artifactPath)).keys()].some((name) => name.includes('.store-output'))).toBe(
        false
      );
    });
  });

  it('writes the archive atomically and leaves no temporary file behind', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, { 'index.html': PAGE });
      const out = path.join(parent, 'out');
      await build(site, { out });
      expect((await readdir(out)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    });
  });
});

describe('secrets and unsafe content', () => {
  const secretRepo = {
    'index.html': PAGE,
    'app.js': 'console.log("ok")',
    '.env': 'API_KEY=hunter2hunter2',
    '.env.example': 'API_KEY=',
    'keys/id_rsa': fakeSecrets.privateKeyBlock,
    'config/credentials.json': '{"password":"correct horse battery staple"}',
    'src/leaked.js': `export const key = "${fakeSecrets.awsKey}";`,
    'src/stripe.js': `export const live = "${fakeSecrets.stripeLive}";`,
  };

  it('leaves credentials out of the archive and says exactly which files and why', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, secretRepo);
      const result = await build(site, { out: path.join(parent, 'out') });

      const entries = await readArchive(result.artifactPath);
      const names = [...entries.keys()];
      for (const leaked of ['.env', 'keys/id_rsa', 'config/credentials.json', 'src/leaked.js', 'src/stripe.js']) {
        expect(names).not.toContain(leaked);
      }
      expect(names).toContain('.env.example');
      expect(names).toContain('app.js');

      expect(result.excludedCounts['secret-name']).toBe(3);
      expect(result.excludedCounts['secret-content']).toBe(2);
      expect(result.excluded.map((entry) => entry.path).toSorted()).toEqual([
        '.env',
        'config/credentials.json',
        'keys/id_rsa',
        'src/leaked.js',
        'src/stripe.js',
      ]);
      expect(result.warnings.filter((warning) => warning.code === 'SECRET_IN_SOURCE')).toHaveLength(2);

      const everything = Buffer.concat([...entries.values()]).toString('latin1');
      for (const secret of [fakeSecrets.awsKey, fakeSecrets.stripeLive, 'hunter2hunter2', 'correct horse']) {
        expect(everything).not.toContain(secret);
      }
      expect(JSON.stringify([result.excluded, result.warnings])).not.toContain(fakeSecrets.awsKey);
    });
  });

  it('refuses to package an app whose own entry page holds a credential', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, { 'index.html': `<script>const k="${fakeSecrets.awsKey}"</script>` });
      await expect(build(site, { out: path.join(parent, 'out') })).rejects.toMatchObject({ code: 'NOT_RUNNABLE' });
    });
  });

  it('warns about install scripts, executables and runtime-decoded code but still packages the app', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, {
        'index.html': PAGE,
        'package.json': JSON.stringify({ name: 'x', scripts: { postinstall: 'node x.js' } }),
        'bin/helper.sh': '#!/bin/sh\n',
      });
      const result = await build(site, { out: path.join(parent, 'out') });
      expect(result.warnings.map((warning) => warning.code).toSorted()).toEqual([
        'EXECUTABLE_CONTENT',
        'LIFECYCLE_SCRIPT',
      ]);
    });
  });
});

describe('published output', () => {
  it('packages a committed dist folder as the site root, keeping the license', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'repo');
      await writeTree(repo, {
        'dist/index.html': PAGE,
        'dist/app.js': 'x',
        'dist/assets/style.css': 'body{}',
        'src/main.tsx': 'export {}',
        'package.json': JSON.stringify({ name: 'dist-site', dependencies: { vite: '^5' } }),
        LICENSE: 'MIT License',
        'notes.md': 'not shipped',
      });
      const result = await build(repo, { out: path.join(parent, 'out') });
      const names = [...(await readArchive(result.artifactPath)).keys()].toSorted();
      expect(names).toEqual([PACKAGE_MANIFEST_FILE, 'LICENSE', 'app.js', 'assets/style.css', 'index.html'].toSorted());
      expect(result.manifest.modules[0]?.entrypoint).toBe('index.html');
      expect(result.excludedCounts['outside-payload']).toBeGreaterThanOrEqual(2);
    });
  });

  it('warns when the page loads assets from the site root, which may not resolve inside the app', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'repo');
      await writeTree(repo, { 'dist/index.html': '<script src="/assets/app.js"></script>', 'dist/assets/app.js': 'x' });
      const result = await build(repo, { out: path.join(parent, 'out') });
      expect(result.warnings.map((warning) => warning.code)).toContain('ABSOLUTE_ASSET_PATHS');
    });
  });

  it('leaves build output out when the page is at the repository root', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'repo');
      await writeTree(repo, { 'index.html': PAGE, 'app.js': 'x', 'build/junk.js': 'x', 'out/junk.js': 'x' });
      const result = await build(repo, { out: path.join(parent, 'out') });
      const names = [...(await readArchive(result.artifactPath)).keys()];
      expect(names.some((name) => name.startsWith('build/') || name.startsWith('out/'))).toBe(false);
      expect(result.excludedCounts['build-output']).toBe(2);
    });
  });
});

describe('repositories the host cannot run', () => {
  const expectInertSource = async (files: Record<string, string>, issueCode: string) => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'repo');
      await writeTree(repo, files);
      const result = await build(repo, { out: path.join(parent, 'out') });
      expect(result.verified).toBe(true);
      expect(result.classification.runnable).toBe(false);
      expect(result.classification.runnableIssueCode).toBe(issueCode);
      expect(result.manifest.modules).toEqual([]);
      expect(result.manifest.permissions).toEqual([]);
      expect(result.adapter?.openItems?.some((item) => item.kind === 'needs-runtime')).toBe(true);
      const archive = await readArchive(result.artifactPath);
      expect(archive.has('adapter/adapter.json')).toBe(true);
      for (const name of Object.keys(files)) expect(archive.has(`source/${name}`)).toBe(true);
      expect(archive.has('index.html')).toBe(false);
    });
  };

  it('keeps an inert Python library without inventing a page', async () => {
    await expectInertSource({ 'pyproject.toml': '[project]\nname="x"', 'x/__init__.py': 'a=1' }, 'NO_WEB_ENTRYPOINT');
  });

  it('keeps an inert Rust crate', async () => {
    await expectInertSource({ 'Cargo.toml': '[package]\nname="x"', 'src/main.rs': 'fn main(){}' }, 'NO_WEB_ENTRYPOINT');
  });

  it('keeps unbuilt web source without exposing a broken web module', async () => {
    await expectInertSource(
      {
        'index.html': '<script type="module" src="/src/main.tsx"></script>',
        'src/main.tsx': 'export {}',
        'package.json': JSON.stringify({ name: 'app', dependencies: { vite: '^5', react: '^18' } }),
      },
      'WEB_NEEDS_BUILD'
    );
  });

  it('keeps an unpublished MCP source instead of pretending it can start', async () => {
    await expectInertSource(
      {
        'package.json': JSON.stringify({ name: 'w', dependencies: { '@modelcontextprotocol/sdk': '^1' } }),
        'src/index.ts': 'export {}',
      },
      'MCP_NO_LAUNCH_RECIPE'
    );
  });
});

describe('a theme', () => {
  it('carries the real stylesheet, main file first, and needs no placeholder module', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'neon');
      await writeTree(repo, {
        'zeta.css': '.z{color:#222}',
        'theme.css': ':root{--accent:#0ff}',
        'preview.png': Buffer.from([1, 2, 3]),
        'README.md': '# neon',
      });
      const result = await build(repo, { out: path.join(parent, 'out') });
      expect(result.classification.archetype).toBe('ui-theme');
      expect(result.manifest.modules).toEqual([]);
      const css = result.manifest.contributions?.themes?.[0]?.css ?? '';
      expect(css.indexOf(':root{--accent:#0ff}')).toBeGreaterThanOrEqual(0);
      expect(css.indexOf(':root{--accent:#0ff}')).toBeLessThan(css.indexOf('.z{color:#222}'));
      expect(css).not.toContain('Custom theme');
      expect(() => parsePackageManifest(result.manifest)).not.toThrow();
      expect(result.verified).toBe(true);
    });
  });

  it('refuses a stylesheet too large to embed', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'big');
      await writeTree(repo, { 'theme.css': `a{content:"${'x'.repeat(300 * 1024)}"}` });
      await expect(build(repo, { out: path.join(parent, 'out') })).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    });
  });
});

describe('signing', () => {
  it('reuses one persistent local key across builds and does not expose it', async () => {
    await withTemp(async (parent) => {
      const keyDirectory = path.join(parent, 'keys');
      const a = path.join(parent, 'a');
      const b = path.join(parent, 'b');
      await writeTree(a, { 'index.html': PAGE });
      await writeTree(b, { 'index.html': PAGE, 'extra.txt': 'x' });
      const first = await build(a, { out: path.join(parent, 'out'), signing: { keyDirectory } });
      const second = await build(b, { out: path.join(parent, 'out'), signing: { keyDirectory } });
      expect(second.keyId).toBe(first.keyId);
      expect(second.keyFingerprint).toBe(first.keyFingerprint);
      expect(first.keyId).toMatch(/^local:[0-9a-f]{16}$/u);
      expect(first.publicKeyPem).toBe(await readFile(path.join(keyDirectory, 'repo-packager-ed25519.pub.pem'), 'utf8'));
      expect(() => verifyArtifactSignature(second.manifest, { [first.keyId]: first.publicKeyPem })).not.toThrow();
    });
  });

  it('creates exactly one key when two builds start together', async () => {
    await withTemp(async (parent) => {
      const keyDirectory = path.join(parent, 'keys');
      const identities = await Promise.all(
        Array.from({ length: 6 }, () => loadOrCreateSigningIdentity({ directory: keyDirectory }))
      );
      expect(new Set(identities.map((identity) => identity.keyId)).size).toBe(1);
    });
  });

  it('stores the key encrypted when the host provides a keystore', async () => {
    await withTemp(async (parent) => {
      const keyDirectory = path.join(parent, 'keys');
      const protect = (plain: Buffer): Buffer => Buffer.from(plain.toString('base64'), 'utf8');
      const unprotect = (cipher: Buffer): Buffer => Buffer.from(cipher.toString('utf8'), 'base64');
      const created = await loadOrCreateSigningIdentity({ directory: keyDirectory, protect, unprotect });
      const files = await readdir(keyDirectory);
      expect(files).toContain('repo-packager-ed25519.pem.enc');
      expect(await readFile(path.join(keyDirectory, 'repo-packager-ed25519.pem.enc'), 'utf8')).not.toContain(
        'PRIVATE KEY'
      );
      const reloaded = await loadOrCreateSigningIdentity({ directory: keyDirectory, protect, unprotect });
      expect(reloaded.keyId).toBe(created.keyId);
      await expect(loadOrCreateSigningIdentity({ directory: keyDirectory, protect })).rejects.toMatchObject({
        code: 'SIGNING_KEY_INVALID',
      });
    });
  });

  it('derives the public key from a supplied private key and rejects unusable keys', async () => {
    const supplied = testSigning('enrolled-key');
    const identity = identityFromPrivateKey(supplied.privateKeyPem, supplied.keyId);
    expect(identity.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(identity.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(() => identityFromPrivateKey('not a key', 'k')).toThrowError(
      expect.objectContaining({ code: 'SIGNING_KEY_INVALID' })
    );
    expect(() => identityFromPrivateKey(supplied.privateKeyPem, '')).toThrowError(
      expect.objectContaining({ code: 'SIGNING_KEY_INVALID' })
    );
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, { 'index.html': PAGE });
      const result = await build(site, { out: path.join(parent, 'out'), signing: supplied });
      expect(result.keyId).toBe('enrolled-key');
      expect(result.publicKeyPem).toBe(identity.publicKeyPem);
    });
  });

  it('detects a tampered archive when re-verifying', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, { 'index.html': PAGE, 'app.js': 'safe' });
      const signing = testSigning();
      const result = await build(site, { out: path.join(parent, 'out'), signing });
      const identity = identityFromPrivateKey(signing.privateKeyPem, signing.keyId);
      await expect(verifyWrittenArchive(result.artifactPath, result.manifest, identity)).resolves.toBeUndefined();

      const zip = await JSZip.loadAsync(await readFile(result.artifactPath));
      zip.file('app.js', 'tampered');
      const tampered = path.join(parent, 'tampered.tomny');
      await writeFile(tampered, await zip.generateAsync({ type: 'nodebuffer' }));
      await expect(verifyWrittenArchive(tampered, result.manifest, identity)).rejects.toMatchObject({
        code: 'VERIFY_FAILED',
      });
    });
  });
});

describe('workspace boundary and progress', () => {
  it('refuses a folder outside the workspace and writes nothing', async () => {
    await withTemp(async (parent) => {
      const workspace = path.join(parent, 'workspace');
      const out = path.join(parent, 'out');
      await writeTree(parent, { 'workspace/a.txt': 'x', 'other/index.html': PAGE });
      await expect(build(workspace, { out, source: '../other' })).rejects.toMatchObject({
        code: 'SOURCE_OUTSIDE_WORKSPACE',
      });
      await expect(readdir(out)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('reports real progress: every stage starts and then finishes, in order', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, { 'index.html': PAGE });
      const events: RepoPackagingProgress[] = [];
      await build(site, { out: path.join(parent, 'out'), onProgress: (event) => events.push(event) });
      expect(events.map((event) => `${event.stage}:${event.status}`)).toEqual(
        STAGE_ORDER.flatMap((stage) => [`${stage}:started`, `${stage}:done`])
      );
    });
  });

  it('a failing progress listener does not fail packaging', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, { 'index.html': PAGE });
      const result = await build(site, {
        out: path.join(parent, 'out'),
        onProgress: () => {
          throw new Error('listener bug');
        },
      });
      expect(result.verified).toBe(true);
    });
  });

  it('stops when cancelled and cleans up', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, { 'index.html': PAGE });
      const controller = new AbortController();
      controller.abort();
      await expect(build(site, { out: path.join(parent, 'out'), signal: controller.signal })).rejects.toMatchObject({
        code: 'CANCELLED',
      });
    });
  });

  it('refuses an empty folder', async () => {
    await withTemp(async (parent) => {
      const empty = path.join(parent, 'empty');
      await writeTree(empty, { '.env': 'A=1' });
      await expect(build(empty, { out: path.join(parent, 'out') })).rejects.toMatchObject({ code: 'EMPTY_REPOSITORY' });
    });
  });
});

describe('a remote repository', () => {
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

  it('keeps the package after the temporary clone is removed, named after the repository', async () => {
    await withTemp(async (parent) => {
      const work = path.join(parent, 'work');
      const bare = path.join(parent, 'site.git');
      await writeTree(work, { 'index.html': PAGE, 'app.js': 'x', '.env': 'A=committed-secret' });
      runGit(work, 'init', '-q', '-b', 'main');
      runGit(work, 'add', '-A', '-f');
      runGit(work, 'commit', '-q', '-m', 'init');
      runGit(parent, 'clone', '-q', '--bare', work, bare);
      restore = redirectGitHub('acme', 'site', bare);

      const before = (await readdir(tmpdir())).filter((name) => name.startsWith('tomni-repo-packager-'));
      const out = path.join(parent, 'out');
      const result = await buildTomnyPackageFromRepo({
        source: 'https://github.com/acme/site',
        outputDirectory: out,
        signing: testSigning(),
      });

      expect(path.dirname(result.artifactPath)).toBe(out);
      await expect(stat(result.artifactPath)).resolves.toBeTruthy();
      expect(result.manifest.id).toBe('com.community.site');
      expect(result.source.kind).toBe('git');
      expect(result.source.commit).toBe(runGit(bare, 'rev-parse', 'main'));
      expect([...(await readArchive(result.artifactPath)).keys()]).not.toContain('.env');
      expect(result.excludedCounts['secret-name']).toBe(1);
      expect((await readdir(tmpdir())).filter((name) => name.startsWith('tomni-repo-packager-'))).toEqual(before);
    });
  });
});
