/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Decides which files of a repository may enter a package.
 *
 * Nothing here executes repository code. Files are excluded, never rewritten, and every exclusion
 * is reported so the user can see exactly what was left out and why. Secret values are never
 * copied into a report: findings carry a label and a path only.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gitEnvironment } from './sourceResolver';
import {
  RepoPackagingError,
  type ExcludeReason,
  type ExcludedFile,
  type PackagingWarning,
  type RepoPackagingLimits,
} from './types';

const execFileAsync = promisify(execFile);

/**
 * Limits of the streaming packager: only the size of a single file is capped (decision D4). A larger file
 * is left out and reported as `too-large`.
 */
export const DEFAULT_LIMITS: RepoPackagingLimits = {
  maxFileBytes: 20 * 1024 * 1024,
  cloneTimeoutMs: 180_000,
};

/** The caps of the legacy in-memory path (`streamingPackager: false`); delete with that path. */
export const LEGACY_LIMITS: RepoPackagingLimits = {
  ...DEFAULT_LIMITS,
  maxFiles: 10_000,
  maxPayloadBytes: 100 * 1024 * 1024,
};

const MAX_SCANNED_BYTES = 1024 * 1024;
const MAX_PATH_LENGTH = 240;
const STAT_CONCURRENCY = 64;
const SCREEN_CONCURRENCY = 16;
const LIST_TIMEOUT_MS = 30_000;
const LIST_MAX_BUFFER = 256 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8192;

/** Directories that are tooling or version-control state, never package content. */
const TOOLING_DIRECTORIES: ReadonlySet<string> = new Set([
  '.git',
  '.svn',
  '.hg',
  '.github',
  '.gitlab',
  '.vscode',
  '.idea',
  'node_modules',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.gradle',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'coverage',
  '.nyc_output',
  '.store-output',
  'venv',
  '.venv',
  '.terraform',
  '.tmp',
]);

/** Directories that hold credentials by convention. */
const SECRET_DIRECTORIES: ReadonlySet<string> = new Set(['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker']);

/** Directories a build tool writes. They are excluded unless they hold the app's entry page. */
export const BUILD_OUTPUT_DIRECTORIES: ReadonlySet<string> = new Set(['dist', 'build', 'out', 'target', '.output']);

/** Directories the fallback walker never enters; the git-based listing already honours `.gitignore`. */
const WALK_SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  ...TOOLING_DIRECTORIES,
  ...SECRET_DIRECTORIES,
  'target',
]);

const SECRET_BASENAMES: ReadonlySet<string> = new Set([
  '.env',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.pypirc',
  '.netrc',
  '_netrc',
  '.git-credentials',
  '.dockercfg',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials',
  'credentials.json',
  'credentials.yaml',
  'credentials.yml',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  'secrets.toml',
  '.htpasswd',
  'terraform.tfstate',
]);

const SECRET_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.jks',
  '.keystore',
  '.ppk',
  '.kdbx',
  '.tfvars',
  '.tfstate',
]);

const SAFE_ENV_SUFFIX = /\.(example|sample|template|dist|defaults|schema)$/u;
const ENV_FILE = /^\.env(\..+)?$/u;
const SERVICE_ACCOUNT = /service[-_]?account.*\.json$/u;
const LOCKFILES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
]);
const TOOLING_FILES: ReadonlySet<string> = new Set(['.ds_store', 'thumbs.db']);

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/u;
const UNSAFE_CHARACTERS = /[\p{Cc}\\:*?"<>|]/u;

/** A relative path is safe to place in an archive when it cannot climb, alias, or confuse a filesystem. */
export const isSafeEntryPath = (relativePath: string): boolean => {
  if (relativePath === '' || relativePath.length > MAX_PATH_LENGTH || relativePath.startsWith('/')) return false;
  if (UNSAFE_CHARACTERS.test(relativePath)) return false;
  return relativePath.split('/').every((segment) => {
    if (segment === '' || segment === '.' || segment === '..') return false;
    if (segment.endsWith('.') || segment.endsWith(' ')) return false;
    return !WINDOWS_RESERVED_NAME.test(segment.toLowerCase().split('.')[0] ?? '');
  });
};

export type PathExclusion = Readonly<{ reason: ExcludeReason; detail: string }>;

/** Name-based exclusion. Build output is handled separately because it may hold the app itself. */
export const classifyPathExclusion = (relativePath: string): PathExclusion | undefined => {
  if (!isSafeEntryPath(relativePath)) return { reason: 'unsafe-path', detail: 'path cannot be stored safely' };
  const segments = relativePath.toLowerCase().split('/');
  const base = segments[segments.length - 1] ?? '';
  for (const directory of segments.slice(0, -1)) {
    if (SECRET_DIRECTORIES.has(directory)) return { reason: 'secret-name', detail: `inside ${directory}/` };
    if (TOOLING_DIRECTORIES.has(directory)) return { reason: 'vcs-or-tooling', detail: `inside ${directory}/` };
  }
  if (ENV_FILE.test(base) && !SAFE_ENV_SUFFIX.test(base)) return { reason: 'secret-name', detail: 'environment file' };
  if (SECRET_BASENAMES.has(base)) return { reason: 'secret-name', detail: 'credential file name' };
  if (SERVICE_ACCOUNT.test(base)) return { reason: 'secret-name', detail: 'service-account key' };
  const extension = path.extname(base);
  if (SECRET_EXTENSIONS.has(extension)) return { reason: 'secret-name', detail: `${extension} key material` };
  if (LOCKFILES.has(base)) return { reason: 'lockfile', detail: 'dependency lockfile' };
  if (TOOLING_FILES.has(base)) return { reason: 'vcs-or-tooling', detail: 'operating-system metadata' };
  return undefined;
};

/** First directory of the path when it is a build-output folder. */
export const buildOutputRoot = (relativePath: string): string | undefined => {
  const segments = relativePath.split('/');
  const index = segments.slice(0, -1).findIndex((segment) => BUILD_OUTPUT_DIRECTORIES.has(segment.toLowerCase()));
  return index < 0 ? undefined : segments.slice(0, index + 1).join('/');
};

const isInside = (parent: string, candidate: string): boolean => {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

const listWithGit = async (root: string, signal: AbortSignal | undefined): Promise<string[] | undefined> => {
  // Only a repository's own top level: inside a folder that merely sits below some other repository,
  // `git ls-files` would apply that unrelated repository's ignore rules.
  if (!existsSync(path.join(root, '.git'))) return undefined;
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-c', 'core.quotepath=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
        cwd: root,
        timeout: LIST_TIMEOUT_MS,
        maxBuffer: LIST_MAX_BUFFER,
        windowsHide: true,
        encoding: 'buffer',
        signal,
        env: gitEnvironment(),
      }
    );
    const paths = stdout
      .toString('utf8')
      .split('\0')
      .filter((entry) => entry !== '');
    return [...new Set(paths)];
  } catch {
    return undefined;
  }
};

const walkDirectory = async (
  root: string,
  maxEntries: number | undefined,
  signal: AbortSignal | undefined
): Promise<string[]> => {
  const paths: string[] = [];
  const pending: string[] = [''];
  while (pending.length > 0) {
    if (signal?.aborted) throw new RepoPackagingError('CANCELLED', 'Đã huỷ đóng gói.');
    const relativeDirectory = pending.pop() ?? '';
    // Reading a directory is inherently sequential here: the next directories depend on this one.
    // oxlint-disable-next-line no-await-in-loop
    const entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativeDirectory === '' ? entry.name : `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!WALK_SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) pending.push(relativePath);
        continue;
      }
      paths.push(relativePath);
      if (maxEntries !== undefined && paths.length > maxEntries) {
        throw new RepoPackagingError('TOO_MANY_FILES', `Repository có hơn ${maxEntries} tệp nên không thể đóng gói.`);
      }
    }
  }
  return paths;
};

/** Lists candidate files with forward-slash paths, honouring `.gitignore` when the folder is a repository. */
export const listCandidatePaths = async (
  root: string,
  limits: RepoPackagingLimits,
  signal: AbortSignal | undefined
): Promise<{ paths: string[]; usedGit: boolean }> => {
  const fromGit = await listWithGit(root, signal);
  if (fromGit !== undefined) return { paths: fromGit, usedGit: true };
  const maxEntries = limits.maxFiles === undefined ? undefined : limits.maxFiles * 4;
  return { paths: await walkDirectory(root, maxEntries, signal), usedGit: false };
};

// ---------------------------------------------------------------------------
// Name and metadata screening
// ---------------------------------------------------------------------------

export type ScreenedFile = Readonly<{ relativePath: string; absolutePath: string; size: number }>;

export type MetadataScreen = Readonly<{ files: ScreenedFile[]; excluded: ExcludedFile[] }>;

const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      // Each worker handles one item at a time by design; the pool provides the parallelism.
      // oxlint-disable-next-line no-await-in-loop
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
};

/**
 * Applies the name rules and reads file metadata. Symbolic links are never followed, oversized
 * files are dropped, and anything under `outputDirectory` is skipped so a package can never contain
 * an earlier package.
 */
export const screenCandidates = async (
  root: string,
  paths: readonly string[],
  limits: RepoPackagingLimits,
  outputDirectory: string | undefined
): Promise<MetadataScreen> => {
  const excluded: ExcludedFile[] = [];
  const nameKept: string[] = [];
  for (const relativePath of paths) {
    const absolutePath = path.join(root, ...relativePath.split('/'));
    if (outputDirectory !== undefined && isInside(outputDirectory, absolutePath)) {
      excluded.push({ path: relativePath, reason: 'output-directory' });
      continue;
    }
    const exclusion = classifyPathExclusion(relativePath);
    if (exclusion) excluded.push({ path: relativePath, reason: exclusion.reason, detail: exclusion.detail });
    else nameKept.push(relativePath);
  }

  const statted = await mapWithConcurrency(nameKept, STAT_CONCURRENCY, async (relativePath) => {
    const absolutePath = path.join(root, ...relativePath.split('/'));
    try {
      const stats = await lstat(absolutePath);
      return { relativePath, absolutePath, stats };
    } catch {
      return undefined;
    }
  });

  const files: ScreenedFile[] = [];
  for (const entry of statted) {
    if (entry === undefined) continue;
    const { relativePath, absolutePath, stats } = entry;
    if (stats.isSymbolicLink()) {
      excluded.push({ path: relativePath, reason: 'symlink' });
    } else if (!stats.isFile()) {
      continue;
    } else if (stats.size > limits.maxFileBytes) {
      excluded.push({ path: relativePath, reason: 'too-large', detail: `${Math.round(stats.size / 1024 / 1024)} MB` });
    } else {
      files.push({ relativePath, absolutePath, size: stats.size });
    }
  }
  files.sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  );
  return { files, excluded };
};

// ---------------------------------------------------------------------------
// Content screening
// ---------------------------------------------------------------------------

type SecretPattern = Readonly<{ label: string; pattern: RegExp }>;

/** High-confidence credential shapes. A match excludes the file; the matched text is never kept. */
export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { label: 'private key block', pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/u },
  { label: 'AWS access key id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u },
  { label: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/u },
  { label: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/u },
  { label: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/u },
  { label: 'Stripe live key', pattern: /\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}\b/u },
  { label: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/u },
  { label: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/u },
  { label: 'OpenAI API key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}/u },
];

/** Labels of the credential shapes present in `text`; never the matched values. */
export const findSecretLabels = (text: string): string[] =>
  SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);

const OBFUSCATION_PATTERNS: readonly RegExp[] = [
  /\beval\s*\(\s*(?:atob|unescape|decodeURIComponent)\s*\(/u,
  /\bnew\s+Function\s*\(\s*(?:atob|unescape)\s*\(/u,
];
const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(['.js', '.mjs', '.cjs', '.html', '.htm']);
const EXECUTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.msi',
  '.bat',
  '.cmd',
  '.ps1',
  '.sh',
  '.jar',
  '.apk',
  '.scr',
]);
const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly'] as const;

export type PayloadFile = Readonly<{ relativePath: string; content: Buffer }>;

export type PayloadScreen = Readonly<{
  payload: PayloadFile[];
  excluded: ExcludedFile[];
  warnings: PackagingWarning[];
}>;

const looksBinary = (content: Buffer): boolean => content.subarray(0, BINARY_SNIFF_BYTES).includes(0);

const lifecycleWarnings = (relativePath: string, text: string): PackagingWarning[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const scripts = (parsed as { scripts?: unknown } | null)?.scripts;
  if (typeof scripts !== 'object' || scripts === null) return [];
  return LIFECYCLE_SCRIPTS.filter((name) => typeof (scripts as Record<string, unknown>)[name] === 'string').map(
    (name): PackagingWarning => ({
      code: 'LIFECYCLE_SCRIPT',
      message: `${relativePath} declares an "${name}" script. Packaging never runs it.`,
      path: relativePath,
    })
  );
};

type ContentVerdict = Readonly<{
  /** Set when the content holds a credential shape; the file must then be left out. */
  secret?: Readonly<{ excluded: ExcludedFile; warning: PackagingWarning }>;
  warnings: PackagingWarning[];
  executable: boolean;
}>;

/**
 * Inspects one file's bytes: credential shapes (which exclude it), obfuscation and lifecycle-script warnings.
 * Content over 1 MB or with binary markers is not read as text. Shared by the streaming and legacy loaders.
 */
const inspectContent = (relativePath: string, content: Buffer): ContentVerdict => {
  const extension = path.extname(relativePath).toLowerCase();
  const warnings: PackagingWarning[] = [];
  if (content.byteLength <= MAX_SCANNED_BYTES && !looksBinary(content)) {
    const text = content.toString('utf8');
    const labels = findSecretLabels(text);
    if (labels.length > 0) {
      const detail = labels.join(', ');
      return {
        secret: {
          excluded: { path: relativePath, reason: 'secret-content', detail },
          warning: {
            code: 'SECRET_IN_SOURCE',
            message: `${relativePath} contains ${detail} and was left out. The package may be incomplete.`,
            path: relativePath,
          },
        },
        warnings,
        executable: false,
      };
    }
    if (SCRIPT_EXTENSIONS.has(extension) && OBFUSCATION_PATTERNS.some((pattern) => pattern.test(text))) {
      warnings.push({
        code: 'OBFUSCATED_CODE',
        message: `${relativePath} decodes and evaluates text at runtime. Review it before trusting the package.`,
        path: relativePath,
      });
    }
    if (path.posix.basename(relativePath) === 'package.json') {
      warnings.push(...lifecycleWarnings(relativePath, text));
    }
  }
  return { warnings, executable: EXECUTABLE_EXTENSIONS.has(extension) };
};

const executableWarning = (executables: readonly string[]): PackagingWarning[] =>
  executables.length === 0
    ? []
    : [
        {
          code: 'EXECUTABLE_CONTENT',
          message: `The package contains ${executables.length} executable or script file(s), for example ${executables.slice(0, 3).join(', ')}. They are stored inertly and never run by packaging.`,
          path: executables[0],
        },
      ];

/**
 * Reads the payload once, excludes files that contain credential shapes, and collects warnings for
 * constructs a reviewer should look at. The total size cap is enforced while reading.
 *
 * Legacy path: it holds every file in memory. The streaming packager uses {@link screenPayloadStreaming}.
 */
export const loadAndScreenPayload = async (
  files: readonly ScreenedFile[],
  limits: RepoPackagingLimits,
  signal: AbortSignal | undefined
): Promise<PayloadScreen> => {
  const payload: PayloadFile[] = [];
  const excluded: ExcludedFile[] = [];
  const warnings: PackagingWarning[] = [];
  const executables: string[] = [];
  let totalBytes = 0;

  for (const file of files) {
    if (signal?.aborted) throw new RepoPackagingError('CANCELLED', 'Đã huỷ đóng gói.');
    // Reads are sequential so the size cap can stop the run before more of the repository is loaded.
    // oxlint-disable-next-line no-await-in-loop
    const content = await readFile(file.absolutePath);
    const verdict = inspectContent(file.relativePath, content);
    if (verdict.secret) {
      excluded.push(verdict.secret.excluded);
      warnings.push(verdict.secret.warning);
      continue;
    }
    warnings.push(...verdict.warnings);
    if (verdict.executable) executables.push(file.relativePath);

    totalBytes += content.byteLength;
    if (limits.maxPayloadBytes !== undefined && totalBytes > limits.maxPayloadBytes) {
      throw new RepoPackagingError(
        'PAYLOAD_TOO_LARGE',
        `Nội dung vượt giới hạn ${Math.round(limits.maxPayloadBytes / 1024 / 1024)} MB.`
      );
    }
    payload.push({ relativePath: file.relativePath, content });
  }

  warnings.push(...executableWarning(executables));
  return { payload, excluded, warnings };
};

export type StreamedPayloadScreen = Readonly<{
  /** Files that may enter the package, still on disk. */
  files: ScreenedFile[];
  excluded: ExcludedFile[];
  warnings: PackagingWarning[];
}>;

/**
 * Screens the payload without keeping it in memory. Only files up to 1 MB are read (a few at a time) for
 * credential shapes; larger files are never read as text, exactly as in the legacy loader. There is no total
 * size or file-count cap: each file was already capped by {@link screenCandidates}.
 */
export const screenPayloadStreaming = async (
  files: readonly ScreenedFile[],
  signal: AbortSignal | undefined
): Promise<StreamedPayloadScreen> => {
  const verdicts = await mapWithConcurrency(files, SCREEN_CONCURRENCY, async (file): Promise<ContentVerdict> => {
    if (signal?.aborted) throw new RepoPackagingError('CANCELLED', 'Đã huỷ đóng gói.');
    // A file larger than the text-scan window cannot be a text hit, so it is not opened at all.
    if (file.size > MAX_SCANNED_BYTES) {
      return { warnings: [], executable: EXECUTABLE_EXTENSIONS.has(path.extname(file.relativePath).toLowerCase()) };
    }
    return inspectContent(file.relativePath, await readFile(file.absolutePath));
  });

  const kept: ScreenedFile[] = [];
  const excluded: ExcludedFile[] = [];
  const warnings: PackagingWarning[] = [];
  const executables: string[] = [];
  for (const [index, file] of files.entries()) {
    const verdict = verdicts[index] as ContentVerdict;
    if (verdict.secret) {
      excluded.push(verdict.secret.excluded);
      warnings.push(verdict.secret.warning);
      continue;
    }
    warnings.push(...verdict.warnings);
    if (verdict.executable) executables.push(file.relativePath);
    kept.push(file);
  }
  warnings.push(...executableWarning(executables));
  return { files: kept, excluded, warnings };
};
