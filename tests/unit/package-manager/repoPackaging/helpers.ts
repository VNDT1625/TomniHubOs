import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';

export const SRC = '../../../../packages/desktop/src';

export const withTemp = async <T>(run: (directory: string) => Promise<T>): Promise<T> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tomni-rp-test-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
};

/**
 * Points the temporary folder at a private one, so a test that lists leftovers is not confused by other test
 * files cloning at the same time. Returns a function that restores the previous setting and removes it.
 */
export const isolateTmpdir = (): (() => void) => {
  const keys = ['TEMP', 'TMP', 'TMPDIR'] as const;
  const previous = keys.map((key) => process.env[key]);
  const folder = mkdtempSync(path.join(tmpdir(), 'tomni-rp-tmp-'));
  for (const key of keys) process.env[key] = folder;
  return () => {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
    rmSync(folder, { recursive: true, force: true });
  };
};

export const writeTree = async (root: string, files: Readonly<Record<string, string | Buffer>>): Promise<void> => {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, ...relativePath.split('/'));
    // Sequential on purpose: some trees share parent directories.
    // oxlint-disable-next-line no-await-in-loop
    await mkdir(path.dirname(target), { recursive: true });
    // oxlint-disable-next-line no-await-in-loop
    await writeFile(target, content);
  }
};

export const testSigning = (keyId = 'test-key'): { privateKeyPem: string; keyId: string } => ({
  privateKeyPem: generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  keyId,
});

/** Reads every stored file of a `.tomny` archive. */
export const readArchive = async (artifactPath: string): Promise<Map<string, Buffer>> => {
  const zip = await JSZip.loadAsync(await readFile(artifactPath));
  const entries = new Map<string, Buffer>();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    // oxlint-disable-next-line no-await-in-loop
    entries.set(entry.name, Buffer.from(await entry.async('uint8array')));
  }
  return entries;
};

/** Extracts an archive to disk exactly as an installer would see it. */
export const extractArchive = async (artifactPath: string, destination: string): Promise<void> => {
  await writeTree(destination, Object.fromEntries(await readArchive(artifactPath)));
};

export const runGit = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

/**
 * Makes `https://github.com/<owner>/<repo>.git` resolve to a local bare repository, so the real clone
 * code (with every hardening flag) runs without touching the network. Returns a restore function.
 */
export const redirectGitHub = (owner: string, repo: string, bareRepository: string): (() => void) => {
  const previous = { ...process.env };
  process.env.GIT_CONFIG_COUNT = '2';
  process.env.GIT_CONFIG_KEY_0 = `url.${pathToFileURL(bareRepository).href}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = `https://github.com/${owner}/${repo}.git`;
  process.env.GIT_CONFIG_KEY_1 = 'protocol.file.allow';
  process.env.GIT_CONFIG_VALUE_1 = 'always';
  return () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  };
};

/** Credential-shaped strings built at runtime so this file never contains one literally. */
export const fakeSecrets = {
  awsKey: ['AKIA', 'IOSFODNN7EXAMPLE'].join(''),
  githubToken: `ghp_${'a1b2c3'.repeat(7)}`,
  privateKeyBlock: `-----BEGIN ${'RSA'} PRIVATE KEY-----\nMIIFAKEFAKEFAKE\n-----END ${'RSA'} PRIVATE KEY-----\n`,
  stripeLive: `sk_live_${'x9'.repeat(14)}`,
};
