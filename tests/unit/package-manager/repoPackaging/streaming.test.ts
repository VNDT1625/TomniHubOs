import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePackageManifest } from '../../../../packages/desktop/src/common/packages';
import {
  PACKAGE_MANIFEST_FILE,
  computeArtifactIntegrity,
} from '../../../../packages/desktop/src/process/extensions/package-manager/artifactSecurity';
import {
  computePayloadIntegrity,
  signManifestWithIntegrity,
  verifyWrittenArchive,
} from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/archive';
import {
  DEFAULT_LIMITS,
  LEGACY_LIMITS,
  screenCandidates,
  screenPayloadStreaming,
} from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/fileScreen';
import { buildTomnyPackageFromRepo } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/packager';
import { identityFromPrivateKey } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/signingKey';
import { crc32Update } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/streaming/crc32';
import {
  checkDiskSpace,
  readFreeSpaceBytes,
} from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/streaming/diskSpace';
import { computeStreamingIntegrity } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/streaming/payload';
import { openZip } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/streaming/zipReader';
import { writeZipArchive } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/streaming/zipWriter';
import type {
  RepoPackagingProgress,
  RepoToPackageOptions,
} from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/types';
import {
  extractArchive,
  fakeSecrets,
  readArchive,
  redirectGitHub,
  runGit,
  testSigning,
  withTemp,
  writeTree,
} from './helpers';

const MIB = 1024 * 1024;
const PAGE = '<!doctype html><html><head><title>t</title></head><body><script src="app.js"></script></body></html>';
const SKILL = '---\nname: demo-skill\ndescription: Does a demo\n---\n\n# Demo\n';

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

/** Creates files in batches so thousands of them do not exhaust file handles. */
const writeMany = async (
  root: string,
  count: number,
  nameOf: (index: number) => string,
  contentOf: (index: number) => Buffer
): Promise<void> => {
  const batch = 64;
  for (let start = 0; start < count; start += batch) {
    const indexes = Array.from({ length: Math.min(batch, count - start) }, (_unused, offset) => start + offset);
    // Batches are sequential on purpose; the files inside a batch are written in parallel.
    // oxlint-disable-next-line no-await-in-loop
    await Promise.all(
      indexes.map(async (index) => {
        const target = path.join(root, ...nameOf(index).split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, contentOf(index));
      })
    );
  }
};

describe('streaming zip primitives', () => {
  it('computes the standard CRC-32 and continues across chunks', () => {
    expect(crc32Update(0, Buffer.from('123456789'))).toBe(0xcb_f4_39_26);
    const half = crc32Update(0, Buffer.from('1234'));
    expect(crc32Update(half, Buffer.from('56789'))).toBe(0xcb_f4_39_26);
  });

  it('refuses an archive beyond the classic ZIP entry limit instead of wrapping the counter', async () => {
    const inputs = Array.from({ length: 65_536 }, (_unused, index) => ({
      name: `f${index}`,
      open: (): never => {
        throw new Error('never opened');
      },
    }));
    await expect(
      writeZipArchive(path.join(tmpdir(), 'never-written.zip'), inputs, { date: new Date(0), level: 6 })
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('reads back its own output and a corrupted entry fails verification', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, {
        'index.html': PAGE,
        'app.js': 'console.log("a long enough line to compress".repeat(5))',
      });
      const signing = testSigning();
      const result = await build(site, { signing });
      const identity = identityFromPrivateKey(signing.privateKeyPem, signing.keyId);
      await expect(verifyWrittenArchive(result.artifactPath, result.manifest, identity)).resolves.toBeUndefined();

      const bytes = await readFile(result.artifactPath);
      const zip = await openZip(result.artifactPath);
      const target = zip.entries.find((entry) => entry.name === 'app.js');
      zip.close();
      expect(target).toBeDefined();
      // Flip a byte inside the stored data of app.js: the local header is 30 bytes plus the name.
      const offset = (target?.raw.relativeOffsetOfLocalHeader ?? 0) + 30 + 'app.js'.length + 2;
      bytes[offset] = (bytes[offset] ?? 0) ^ 0xff;
      const corrupted = path.join(parent, 'corrupted.tomny');
      await writeFile(corrupted, bytes);
      await expect(verifyWrittenArchive(corrupted, result.manifest, identity)).rejects.toMatchObject({
        code: 'VERIFY_FAILED',
      });
    });
  });
});

describe('the streaming packager gives the same package as the legacy in-memory writer', () => {
  it('has the same manifest, integrity, entries, headers and warnings on a small tree', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, {
        'index.html': PAGE,
        'app.js': 'document.title = "x";',
        'README.md': '# readme',
        LICENSE: 'MIT',
        'Zebra.css': 'body{}',
        'assets/Logo.svg': '<svg/>',
        'assets/tệp-unicode.txt': 'xin chào',
        'empty.txt': '',
        'tools/run.sh': 'echo hi',
        'data/blob.bin': randomBytes(40_000),
        'zeta/deep/file.txt': 'z'.repeat(5000),
        '.env': 'TOKEN=abc',
        'leak.js': `const key = "${fakeSecrets.awsKey}";`,
      });
      const signing = testSigning();
      const streamed = await build(site, { signing, out: path.join(parent, 'out-new') });
      const legacy = await build(site, { signing, out: path.join(parent, 'out-old'), streamingPackager: false });

      expect(streamed.manifest).toEqual(legacy.manifest);
      expect(streamed.manifest.artifact?.integrity).toBe(legacy.manifest.artifact?.integrity);
      expect(streamed.includedFileCount).toBe(legacy.includedFileCount);
      expect(streamed.excluded).toEqual(legacy.excluded);
      expect(streamed.excludedCounts).toEqual(legacy.excludedCounts);
      expect(streamed.warnings).toEqual(legacy.warnings);
      expect(streamed.classification).toEqual(legacy.classification);
      expect(streamed.verified).toBe(true);
      expect(legacy.verified).toBe(true);

      const newEntries = await readArchive(streamed.artifactPath);
      const oldEntries = await readArchive(legacy.artifactPath);
      expect([...newEntries.keys()]).toEqual([...oldEntries.keys()]);
      for (const [name, content] of oldEntries) expect(newEntries.get(name)?.equals(content)).toBe(true);
      expect(newEntries.has('.env')).toBe(false);
      expect(newEntries.has('leak.js')).toBe(false);

      // Same layout and header fields. The compressed bytes themselves may differ (Node's zlib is not pako), so
      // the central directories are compared, not the files.
      const describeZip = async (artifactPath: string) => {
        const zip = await openZip(artifactPath);
        try {
          // JSZip also writes folder entries stamped with the current time; the streaming writer does not,
          // which makes its archives reproducible. The installer skips folder entries either way.
          return zip.entries
            .filter((entry) => !entry.isDirectory)
            .map((entry) => ({
              name: entry.name,
              crc32: entry.crc32,
              size: entry.uncompressedSize,
              modified: entry.raw.getLastModDate().toISOString(),
              flags: entry.raw.generalPurposeBitFlag,
              // JSZip stores an empty file; the streaming writer deflates it (2 bytes). Both are valid.
              method: entry.uncompressedSize === 0 ? undefined : entry.raw.compressionMethod,
            }));
        } finally {
          zip.close();
        }
      };
      expect(await describeZip(streamed.artifactPath)).toEqual(await describeZip(legacy.artifactPath));
    });
  });

  it('hashes to the digest the installer recomputes after extraction', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, { 'index.html': PAGE, 'app.js': 'x', 'Zebra.css': 'a{}', 'assets/Logo.svg': '<svg/>' });
      const result = await build(site);
      const extracted = path.join(parent, 'extracted');
      await extractArchive(result.artifactPath, extracted);
      const { integrity, sizeBytes } = await computeArtifactIntegrity(extracted);
      expect(result.manifest.artifact?.integrity).toBe(integrity);
      expect(result.manifest.artifact?.sizeBytes).toBe(sizeBytes);
      expect(() => parsePackageManifest(result.manifest)).not.toThrow();

      const payload = [...(await readArchive(result.artifactPath))]
        .filter(([name]) => name !== PACKAGE_MANIFEST_FILE)
        .map(([relativePath, content]) => ({ relativePath, content }));
      expect(computePayloadIntegrity(payload).integrity).toBe(integrity);
      const entries = payload.map((file) => ({
        relativePath: file.relativePath,
        size: file.content.byteLength,
        content: file.content,
      }));
      await expect(computeStreamingIntegrity(entries, undefined)).resolves.toEqual({
        integrity,
        sizeBytes,
      });
    });
  });
});

describe('no total caps, a cap per file', () => {
  it('packages more than 10 000 files, while the legacy path still refuses them', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, { 'index.html': PAGE, 'app.js': 'x' });
      await writeMany(
        site,
        10_500,
        (index) => `parts/p${index % 50}/f${index}.txt`,
        (index) => Buffer.from(`file ${index}`)
      );
      const result = await build(site);
      expect(result.includedFileCount).toBe(10_502);
      expect(result.verified).toBe(true);
      const zip = await openZip(result.artifactPath);
      expect(zip.entries).toHaveLength(10_503);
      zip.close();

      expect(DEFAULT_LIMITS.maxFiles).toBeUndefined();
      expect(LEGACY_LIMITS.maxFiles).toBe(10_000);
      await expect(build(site, { streamingPackager: false, out: path.join(parent, 'legacy') })).rejects.toMatchObject({
        code: 'TOO_MANY_FILES',
      });
    });
  }, 300_000);

  it('leaves out a file over 20 MB, reports it, and keeps the rest', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, { 'index.html': PAGE, 'app.js': 'x' });
      await writeFile(path.join(site, 'huge.bin'), Buffer.alloc(21 * MIB, 7));
      await writeFile(path.join(site, 'ok.bin'), Buffer.alloc(19 * MIB, 3));
      const result = await build(site);
      expect(result.excluded).toContainEqual(expect.objectContaining({ path: 'huge.bin', reason: 'too-large' }));
      expect(result.excludedCounts['too-large']).toBe(1);
      const entries = await readArchive(result.artifactPath);
      expect(entries.has('huge.bin')).toBe(false);
      expect(entries.get('ok.bin')?.byteLength).toBe(19 * MIB);
      expect(result.verified).toBe(true);
    });
  }, 60_000);

  it('records an oversized file as an unrecognized open item when the repository travels under source/', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'skill');
      await writeTree(repo, { 'SKILL.md': SKILL, 'notes.md': 'hello' });
      await writeFile(path.join(repo, 'model.bin'), Buffer.alloc(22 * MIB, 1));
      const result = await build(repo);
      expect(result.adapter?.openItems).toContainEqual(
        expect.objectContaining({ kind: 'unrecognized', path: 'source/model.bin' })
      );
      expect([...(await readArchive(result.artifactPath)).keys()]).not.toContain('source/model.bin');
    });
  }, 60_000);
});

describe('safety filters still apply', () => {
  it('keeps secrets, links, tooling folders and unsafe paths out of the streamed archive', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, {
        'index.html': PAGE,
        'app.js': 'x',
        '.env': 'A=1',
        'keys/server.pem': 'not a real key',
        'src/leak.js': `const token = "${fakeSecrets.githubToken}";`,
        'src/keep.js': 'const ok = 1;',
        '.git/config': '[core]',
        'node_modules/dep/index.js': 'x',
        '.ssh/id_rsa': 'x',
      });
      await writeTree(path.join(parent, 'outside'), { 'secret.txt': 'outside the workspace' });
      let linked = true;
      try {
        await symlink(path.join(parent, 'outside', 'secret.txt'), path.join(site, 'link.txt'));
      } catch {
        linked = false;
      }
      const result = await build(site);
      const names = [...(await readArchive(result.artifactPath)).keys()];
      expect(names).toEqual(expect.arrayContaining(['index.html', 'app.js', 'src/keep.js']));
      for (const forbidden of ['.env', 'keys/server.pem', 'src/leak.js', '.git/config', '.ssh/id_rsa', 'link.txt']) {
        expect(names).not.toContain(forbidden);
      }
      expect(names.some((name) => name.startsWith('node_modules/'))).toBe(false);
      expect(result.excluded).toContainEqual(
        expect.objectContaining({ path: 'src/leak.js', reason: 'secret-content' })
      );
      expect(result.excluded).toContainEqual(expect.objectContaining({ path: '.env', reason: 'secret-name' }));
      if (linked) expect(result.excluded).toContainEqual({ path: 'link.txt', reason: 'symlink' });
      expect(result.warnings.map((warning) => warning.code)).toContain('SECRET_IN_SOURCE');
    });
  });

  it('refuses unsafe paths before they can reach the archive', async () => {
    await withTemp(async (parent) => {
      await writeTree(parent, { 'a.txt': 'fine' });
      const screened = await screenCandidates(
        parent,
        ['a.txt', 'con.txt', 'a/../b.txt', '/abs.txt', 'dir/trailing.', 'back\\slash.txt'],
        DEFAULT_LIMITS,
        undefined
      );
      expect(screened.files.map((file) => file.relativePath)).toEqual(['a.txt']);
      expect(screened.excluded.filter((entry) => entry.reason === 'unsafe-path')).toHaveLength(5);
      const payload = await screenPayloadStreaming(screened.files, undefined);
      expect(payload.files.map((file) => file.relativePath)).toEqual(['a.txt']);
    });
  });

  it('removes the temporary file and writes nothing when cancelled while writing', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, { 'index.html': PAGE, 'app.js': 'x' });
      await writeMany(
        site,
        300,
        (index) => `d/f${index}.txt`,
        (index) => Buffer.from(`file ${index}`)
      );
      const controller = new AbortController();
      const out = path.join(parent, 'out');
      await expect(
        build(site, {
          out,
          signal: controller.signal,
          onProgress: (event: RepoPackagingProgress) => {
            if (event.stage === 'write' && event.status === 'started') controller.abort();
          },
        })
      ).rejects.toMatchObject({ code: 'CANCELLED' });
      expect(await readdir(out).catch((): string[] => [])).toEqual([]);
    });
  });
});

describe('disk space check', () => {
  it('stops with DISK_SPACE_LOW and the numbers when the drive is too small, before writing anything', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, { 'index.html': PAGE, 'app.js': 'x'.repeat(1000) });
      const out = path.join(parent, 'out');
      const error = await build(site, { out, freeSpaceBytes: async () => 10 * MIB }).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: 'DISK_SPACE_LOW' });
      const failure = error as { message: string; details: Record<string, number> };
      expect(failure.message).toContain('10.0 MB');
      expect(failure.message).toContain('GB');
      expect(failure.details.freeBytes).toBe(10 * MIB);
      expect(failure.details.requiredBytes).toBe(2 * (failure.details.estimatedBytes ?? 0) + 1024 * MIB);
      await expect(readdir(out)).rejects.toMatchObject({ code: 'ENOENT' });

      // The rule is 2 x estimate + 1 GB: exactly that much is enough, one byte less is not.
      const required = failure.details.requiredBytes ?? 0;
      await expect(build(site, { out, freeSpaceBytes: async () => required })).resolves.toMatchObject({
        verified: true,
      });
      await expect(
        build(site, { out: path.join(parent, 'out2'), freeSpaceBytes: async () => required - 1 })
      ).rejects.toMatchObject({ code: 'DISK_SPACE_LOW' });
    });
  });

  it('does not block, but warns, when the free space cannot be read', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, { 'index.html': PAGE, 'app.js': 'x' });
      const result = await build(site, {
        freeSpaceBytes: () => Promise.reject(new Error('statfs is not available')),
      });
      expect(result.verified).toBe(true);
      expect(result.warnings.map((warning) => warning.code)).toContain('DISK_SPACE_UNKNOWN');
      await expect(checkDiskSpace(parent, 1, async () => Number.NaN)).resolves.toHaveLength(1);
    });
  });

  it('reads the real free space of an existing folder and of one that is not created yet', async () => {
    await withTemp(async (parent) => {
      expect(await readFreeSpaceBytes(parent)).toBeGreaterThan(0);
      expect(await readFreeSpaceBytes(path.join(parent, 'not', 'created', 'yet'))).toBeGreaterThan(0);
      await expect(checkDiskSpace(parent, 0, async () => 2 * 1024 * MIB)).resolves.toEqual([]);
    });
  });
});

describe('provenance', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('describes a local folder without a URL and with a valid timestamp', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, { 'index.html': PAGE, 'app.js': 'x' });
      const before = Date.now();
      const result = await build(site);
      expect(result.provenance.kind).toBe('local');
      expect(result.provenance.url).toBeUndefined();
      expect(result.provenance.commit).toBeUndefined();
      const packagedAt = Date.parse(result.provenance.packagedAt);
      expect(new Date(packagedAt).toISOString()).toBe(result.provenance.packagedAt);
      expect(packagedAt).toBeGreaterThanOrEqual(before);
    });
  });

  it('carries the URL, the 40-character commit, the ref and the subdirectory of a Git source', async () => {
    await withTemp(async (parent) => {
      const work = path.join(parent, 'work');
      const bare = path.join(parent, 'site.git');
      await writeTree(work, { 'web/index.html': PAGE, 'web/app.js': 'x', 'README.md': 'root' });
      runGit(work, 'init', '-q', '-b', 'main');
      runGit(work, 'add', '-A');
      runGit(work, 'commit', '-q', '-m', 'init');
      runGit(parent, 'clone', '-q', '--bare', work, bare);
      restore = redirectGitHub('acme', 'site', bare);

      const result = await buildTomnyPackageFromRepo({
        source: 'https://github.com/acme/site',
        ref: 'main',
        subdirectory: 'web',
        outputDirectory: path.join(parent, 'out'),
        signing: testSigning(),
      });
      expect(result.provenance).toEqual({
        kind: 'git',
        url: 'https://github.com/acme/site.git',
        commit: runGit(bare, 'rev-parse', 'main'),
        ref: 'main',
        subdirectory: 'web',
        packagedAt: result.provenance.packagedAt,
      });
      expect(result.provenance.commit).toMatch(/^[0-9a-f]{40}$/u);
    });
  });
});

describe('a large tree', () => {
  it('explains a package over the 200 MB the manifest schema still allows, instead of dumping the schema error', async () => {
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, { 'index.html': PAGE, 'app.js': 'x' });
      const signing = testSigning();
      const result = await build(site, { signing });
      const identity = identityFromPrivateKey(signing.privateKeyPem, signing.keyId);
      expect(() =>
        signManifestWithIntegrity(result.manifest, { integrity: 'sha256-00', sizeBytes: 300 * MIB }, identity)
      ).toThrow(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));
    });
  });

  // Memory is measured as growth over the level just before packaging, so it shows what packaging itself
  // adds; it is a relative measurement of this process, not an absolute bound for the whole application.
  it('packages about 190 MiB (3 000 files) in a small amount of extra memory', async () => {
    const files = 3000;
    const blockBytes = 16 * 1024;
    await withTemp(async (parent) => {
      const site = path.join(parent, 'site');
      await writeTree(site, { 'index.html': PAGE });
      // Each file repeats one random block, so the data is distinct per file yet the archive stays small on disk.
      await writeMany(
        site,
        files,
        (index) => `assets/d${index % 32}/f${index}.bin`,
        () => {
          const block = randomBytes(blockBytes);
          return Buffer.concat([block, block, block, block]);
        }
      );

      globalThis.gc?.();
      const base = process.memoryUsage();
      let peakRss = base.rss;
      let peakHeap = base.heapUsed + base.arrayBuffers;
      const sampler = setInterval(() => {
        const sample = process.memoryUsage();
        peakRss = Math.max(peakRss, sample.rss);
        peakHeap = Math.max(peakHeap, sample.heapUsed + sample.arrayBuffers);
      }, 20);
      let result: Awaited<ReturnType<typeof build>>;
      try {
        result = await build(site);
      } finally {
        clearInterval(sampler);
      }

      const rssGrowth = peakRss - base.rss;
      const heapGrowth = peakHeap - (base.heapUsed + base.arrayBuffers);
      process.stdout.write(
        `[memory] 3000 files / 187.5 MiB: rss +${(rssGrowth / MIB).toFixed(1)} MB, heap+arrayBuffers +${(heapGrowth / MIB).toFixed(1)} MB
`
      );
      expect(result.includedFileCount).toBe(files + 1);
      expect(result.manifest.artifact?.sizeBytes).toBe(files * blockBytes * 4 + PAGE.length);
      expect(result.manifest.artifact?.sizeBytes).toBeGreaterThan(180 * MIB);
      expect(result.verified).toBe(true);
      expect(rssGrowth).toBeLessThan(150 * MIB);
      expect(heapGrowth).toBeLessThan(150 * MIB);
      expect((await stat(result.artifactPath)).size).toBe(result.archiveBytes);
    });
  }, 300_000);
});
