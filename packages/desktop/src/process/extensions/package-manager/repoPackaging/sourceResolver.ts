/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turns the text a user typed into a folder that is safe to read.
 *
 * Local sources must stay inside the workspace. Remote sources must be `https` Git URLs on an
 * allowed host; they are cloned shallowly with every transport except https disabled, and the
 * URL is always passed after `--` so it can never be read as a Git option.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { RepoPackagingError, type RepoSourceInfo } from './types';

const execFileAsync = promisify(execFile);

export const DEFAULT_ALLOWED_GIT_HOSTS: readonly string[] = [
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'codeberg.org',
];

const MAX_SOURCE_LENGTH = 2048;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u;
const CONTROL_CHARACTERS = /\p{Cc}/u;
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/u;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const REPOSITORY_SEGMENT = /^[A-Za-z0-9._~-]{1,100}$/u;
const STDERR_TAIL = 400;

export type ParsedSource =
  | Readonly<{ kind: 'local'; path: string }>
  | Readonly<{
      kind: 'git';
      cloneUrl: string;
      host: string;
      ref?: string;
      subdirectory?: string;
    }>;

const invalid = (message: string): RepoPackagingError => new RepoPackagingError('SOURCE_INVALID', message);

const isInside = (parent: string, candidate: string): boolean => {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

/** Accepts a forward-slash folder path below the source root; rejects anything that could climb out. */
export const sanitizeSubdirectory = (raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined;
  const normalized = raw.trim().replaceAll('\\', '/');
  if (normalized === '' || normalized === '.') return undefined;
  if (CONTROL_CHARACTERS.test(normalized) || normalized.startsWith('/') || WINDOWS_DRIVE.test(normalized)) {
    throw invalid('Thư mục con không hợp lệ.');
  }
  const segments = normalized.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '..' || segment === '.'))
    throw invalid('Thư mục con không được chứa "..".');
  return segments.join('/');
};

const validateRef = (ref: string | undefined): string | undefined => {
  if (ref === undefined || ref.trim() === '') return undefined;
  const trimmed = ref.trim();
  if (!REF_PATTERN.test(trimmed) || trimmed.includes('..') || trimmed.endsWith('/') || trimmed.endsWith('.lock')) {
    throw invalid('Tên nhánh hoặc tag không hợp lệ.');
  }
  return trimmed;
};

/**
 * Splits `owner/repo[.git][/tree/<ref>[/<folder>]]` (and GitLab's `/-/tree/`) into its parts.
 * Branch names that contain `/` cannot be recovered from a web URL; pass the ref explicitly instead.
 */
const parseRepositoryPath = (
  segments: readonly string[]
): { owner: string; repo: string; ref?: string; folder?: string } => {
  const [owner, rawRepo, ...rest] = segments;
  const repo = rawRepo?.replace(/\.git$/iu, '');
  if (!owner || !repo || !REPOSITORY_SEGMENT.test(owner) || !REPOSITORY_SEGMENT.test(repo)) {
    throw invalid('Địa chỉ repository phải có dạng https://<máy chủ>/<chủ sở hữu>/<repo>.');
  }
  if (rest.length === 0) return { owner, repo };
  const marker = rest[0] === '-' ? rest.slice(1) : rest;
  if (marker[0] !== 'tree' || marker.length < 2) {
    throw invalid('Chỉ hỗ trợ địa chỉ repository hoặc địa chỉ thư mục /tree/<nhánh>/<thư mục>.');
  }
  const [, ref, ...folder] = marker;
  return { owner, repo, ref, folder: folder.length > 0 ? folder.join('/') : undefined };
};

/** Classifies the text after the command: a Windows/relative/absolute path, or an https Git URL. */
export const parseSource = (raw: string, allowedHosts: readonly string[] = DEFAULT_ALLOWED_GIT_HOSTS): ParsedSource => {
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'local', path: '' };
  if (trimmed.length > MAX_SOURCE_LENGTH) throw invalid('Nguồn quá dài.');
  if (CONTROL_CHARACTERS.test(trimmed)) throw invalid('Nguồn chứa ký tự điều khiển.');
  if (trimmed.startsWith('-')) throw invalid('Nguồn không được bắt đầu bằng dấu "-".');
  if (WINDOWS_DRIVE.test(trimmed)) return { kind: 'local', path: trimmed };
  if (/^git@/iu.test(trimmed) || /^ssh:/iu.test(trimmed)) {
    throw invalid('SSH không được hỗ trợ vì cần khoá riêng của bạn. Hãy dùng địa chỉ https://.');
  }
  if (!URL_SCHEME.test(trimmed)) return { kind: 'local', path: trimmed };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw invalid('Địa chỉ URL không hợp lệ.');
  }
  if (url.protocol !== 'https:') throw invalid('Chỉ hỗ trợ địa chỉ https://.');
  if (url.username !== '' || url.password !== '')
    throw invalid('Địa chỉ không được chứa tên người dùng hoặc mật khẩu.');
  if (url.port !== '' && url.port !== '443') throw invalid('Chỉ hỗ trợ cổng 443.');

  const host = url.hostname.toLowerCase().replace(/^www\./u, '');
  const allowed = allowedHosts.map((entry) => entry.toLowerCase());
  if (!allowed.includes(host)) {
    throw new RepoPackagingError('SOURCE_HOST_NOT_ALLOWED', `Máy chủ "${host}" không nằm trong danh sách được phép.`, {
      host,
      allowed,
    });
  }

  const parsed = parseRepositoryPath(url.pathname.split('/').filter((segment) => segment !== ''));
  return {
    kind: 'git',
    cloneUrl: `https://${host}/${parsed.owner}/${parsed.repo}.git`,
    host,
    ref: validateRef(parsed.ref),
    subdirectory: sanitizeSubdirectory(parsed.folder),
  };
};

export type AcquiredSource = Readonly<{
  /** Folder to package. */
  root: string;
  /** Name the repository is known by, used when the manifest does not name it. */
  repositoryName: string;
  info: RepoSourceInfo;
  /** Removes anything that was created for this source. Always safe to call more than once. */
  cleanup: () => Promise<void>;
}>;

const redactUrls = (text: string): string => text.replace(/https?:\/\/[^@\s/]+@/giu, 'https://***@');

export const gitEnvironment = (): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_EXEC_PATH', 'GIT_CONFIG_PARAMETERS']) {
    delete environment[name];
  }
  return {
    ...environment,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
  };
};

const removeDirectory = (directory: string): Promise<void> =>
  rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch((): undefined => undefined);

const cloneRepository = async (
  cloneUrl: string,
  destination: string,
  ref: string | undefined,
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<void> => {
  const args = [
    '-c',
    'protocol.allow=never',
    '-c',
    'protocol.https.allow=always',
    '-c',
    'credential.helper=',
    '-c',
    'core.symlinks=false',
    '-c',
    'core.autocrlf=false',
    '-c',
    'http.lowSpeedLimit=1000',
    '-c',
    'http.lowSpeedTime=30',
    'clone',
    '--quiet',
    '--depth',
    '1',
    '--single-branch',
    '--no-tags',
    '--no-recurse-submodules',
    ...(ref === undefined ? [] : ['--branch', ref]),
    '--',
    cloneUrl,
    destination,
  ];
  try {
    await execFileAsync('git', args, {
      timeout: timeoutMs,
      signal,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: gitEnvironment(),
    });
  } catch (error) {
    const failure = error as { code?: string; killed?: boolean; name?: string; stderr?: string };
    if (signal?.aborted || failure.name === 'AbortError') {
      throw new RepoPackagingError('CANCELLED', 'Đã huỷ tải repository.');
    }
    if (failure.code === 'ENOENT') {
      throw new RepoPackagingError('GIT_UNAVAILABLE', 'Không tìm thấy lệnh git trên máy. Hãy cài Git rồi thử lại.');
    }
    if (failure.killed === true) {
      throw new RepoPackagingError(
        'CLONE_TIMEOUT',
        `Tải repository quá ${Math.round(timeoutMs / 1000)} giây nên đã dừng.`
      );
    }
    const stderr = redactUrls(String(failure.stderr ?? ''))
      .trim()
      .slice(-STDERR_TAIL);
    throw new RepoPackagingError(
      'CLONE_FAILED',
      `Không tải được repository${stderr ? `: ${stderr}` : '. Repository riêng tư chưa được hỗ trợ.'}`
    );
  }
};

const readCommit = async (repository: string): Promise<string | undefined> => {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repository, 'rev-parse', 'HEAD'], {
      timeout: 10_000,
      windowsHide: true,
      env: gitEnvironment(),
    });
    const commit = stdout.trim();
    return /^[0-9a-f]{7,64}$/u.test(commit) ? commit : undefined;
  } catch {
    return undefined;
  }
};

const resolveInside = async (root: string, subdirectory: string | undefined): Promise<string> => {
  if (subdirectory === undefined) return root;
  const candidate = path.resolve(root, ...subdirectory.split('/'));
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new RepoPackagingError('SOURCE_NOT_FOUND', `Không thấy thư mục con "${subdirectory}".`);
  }
  if (!isInside(root, resolved)) throw invalid('Thư mục con nằm ngoài repository.');
  if (!(await stat(resolved)).isDirectory()) throw invalid(`"${subdirectory}" không phải là thư mục.`);
  return resolved;
};

const resolveLocal = async (
  parsedPath: string,
  workspaceRoot: string | undefined,
  allowOutside: boolean,
  subdirectory: string | undefined
): Promise<AcquiredSource> => {
  const base = workspaceRoot === undefined ? process.cwd() : workspaceRoot;
  let real: string;
  try {
    real = await realpath(path.resolve(base, parsedPath));
  } catch {
    throw new RepoPackagingError('SOURCE_NOT_FOUND', `Không thấy thư mục "${parsedPath === '' ? '.' : parsedPath}".`);
  }
  if (!(await stat(real)).isDirectory()) throw invalid('Nguồn phải là một thư mục.');
  if (workspaceRoot !== undefined && !allowOutside) {
    const realWorkspace = await realpath(workspaceRoot);
    if (!isInside(realWorkspace, real)) {
      throw new RepoPackagingError(
        'SOURCE_OUTSIDE_WORKSPACE',
        'Thư mục nằm ngoài workspace hiện tại. Hãy mở thư mục đó làm workspace hoặc dùng địa chỉ https://.'
      );
    }
  }
  const root = await resolveInside(real, subdirectory);
  return {
    root,
    repositoryName: path.basename(root),
    info: { kind: 'local', display: root, ...(subdirectory ? { subdirectory } : {}) },
    cleanup: async () => undefined,
  };
};

export type AcquireOptions = Readonly<{
  source: string;
  workspaceRoot?: string;
  allowLocalOutsideWorkspace?: boolean;
  ref?: string;
  subdirectory?: string;
  allowedGitHosts?: readonly string[];
  cloneTimeoutMs: number;
  signal?: AbortSignal;
}>;

/** Resolves a local folder or clones a remote repository into a private temporary folder. */
export const acquireSource = async (options: AcquireOptions): Promise<AcquiredSource> => {
  const parsed = parseSource(options.source, options.allowedGitHosts);
  const explicitSubdirectory = sanitizeSubdirectory(options.subdirectory);
  const explicitRef = validateRef(options.ref);

  if (parsed.kind === 'local') {
    if (explicitRef !== undefined) throw invalid('Chỉ dùng được nhánh hoặc tag với repository trên mạng.');
    return resolveLocal(
      parsed.path,
      options.workspaceRoot,
      options.allowLocalOutsideWorkspace === true,
      explicitSubdirectory
    );
  }

  const ref = explicitRef ?? parsed.ref;
  const subdirectory = explicitSubdirectory ?? parsed.subdirectory;
  const temporary = await mkdtemp(path.join(tmpdir(), 'tomni-repo-packager-'));
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    await removeDirectory(temporary);
  };
  try {
    const repository = path.join(temporary, 'repo');
    await cloneRepository(parsed.cloneUrl, repository, ref, options.cloneTimeoutMs, options.signal);
    const real = await realpath(repository);
    const root = await resolveInside(real, subdirectory);
    const commit = await readCommit(real);
    return {
      root,
      repositoryName: path.posix.basename(new URL(parsed.cloneUrl).pathname).replace(/\.git$/u, ''),
      info: {
        kind: 'git',
        display: parsed.cloneUrl,
        ...(ref ? { ref } : {}),
        ...(commit ? { commit } : {}),
        ...(subdirectory ? { subdirectory } : {}),
      },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
};
