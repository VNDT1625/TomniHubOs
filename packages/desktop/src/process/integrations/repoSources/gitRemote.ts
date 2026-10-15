/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "Check for a newer version" for a Git source (docs/platform/repotopackage-design.md section 9.5, decision D18):
 * `git ls-remote` against the recorded address, compared with the commit that was packaged. It runs only when the
 * user asks, reads no files and downloads no objects.
 *
 * The recorded address is read back from `adapter.json`, so it is treated as untrusted: it goes through the same
 * `parseSource` rules as a clone (https only, allowed hosts only, no credentials, no extra port) before anything
 * is spawned, and git is told to speak https only. Git's own error text is never returned, because it may echo
 * the address.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  gitEnvironment,
  DEFAULT_ALLOWED_GIT_HOSTS,
  parseSource,
} from '@process/extensions/package-manager/repoPackaging/sourceResolver';
import { RepoPackagingError } from '@process/extensions/package-manager/repoPackaging/types';

const execFileAsync = promisify(execFile);

const COMMIT = /^[0-9a-f]{40}$/u;
/** The same ref rule the clone applies (`sourceResolver`), so no ref reaches git that a clone would refuse. */
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u;
const isSafeRef = (ref: string): boolean =>
  REF_PATTERN.test(ref) && !ref.includes('..') && !ref.endsWith('/') && !ref.endsWith('.lock');
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export type GitRemoteRequest = Readonly<{
  /** The recorded clone address (`provenance.url`). */
  url: string;
  /** Branch or tag; the remote's default branch when absent. */
  ref?: string;
  signal?: AbortSignal;
}>;

export type GitRemote = Readonly<{
  /**
   * The commit the remote currently points at for the request, or `undefined` when it cannot be told (the ref was
   * not found, or the answer was not a full commit id). Callers treat `undefined` as "unknown", never as "unchanged".
   */
  resolveCommit: (request: GitRemoteRequest) => Promise<string | undefined>;
}>;

/** Runs git with the given arguments and returns standard output. Replaceable so tests never spawn a process. */
export type GitRunner = (
  args: readonly string[],
  options: Readonly<{ timeoutMs: number; signal?: AbortSignal }>
) => Promise<string>;

/** Arguments of `git ls-remote` for a validated clone address. The ref patterns come after `--`. */
export const buildLsRemoteArgs = (cloneUrl: string, ref: string | undefined): string[] => [
  '-c',
  'protocol.allow=never',
  '-c',
  'protocol.https.allow=always',
  '-c',
  'credential.helper=',
  'ls-remote',
  '--',
  cloneUrl,
  ...(ref === undefined ? ['HEAD'] : [`refs/heads/${ref}`, `refs/tags/${ref}`, `refs/tags/${ref}^{}`]),
];

/**
 * Picks the commit from `git ls-remote` output. For a tag the peeled entry (`^{}`) is the commit that a clone
 * checks out, so it wins over the tag object; then a branch; then a lightweight tag.
 */
export const parseLsRemote = (stdout: string, ref: string | undefined): string | undefined => {
  const byName = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/u)) {
    const [commit, name] = line.split('\t');
    if (commit !== undefined && name !== undefined && COMMIT.test(commit)) byName.set(name.trim(), commit);
  }
  if (ref === undefined) return byName.get('HEAD');
  return byName.get(`refs/tags/${ref}^{}`) ?? byName.get(`refs/heads/${ref}`) ?? byName.get(`refs/tags/${ref}`);
};

const runGit: GitRunner = async (args, options) => {
  const { stdout } = await execFileAsync('git', [...args], {
    timeout: options.timeoutMs,
    signal: options.signal,
    windowsHide: true,
    maxBuffer: MAX_OUTPUT_BYTES,
    env: gitEnvironment(),
  });
  return stdout;
};

export type GitRemoteOptions = Readonly<{
  run?: GitRunner;
  allowedGitHosts?: readonly string[];
  timeoutMs?: number;
}>;

export const createGitRemote = (options: GitRemoteOptions = {}): GitRemote => {
  const run = options.run ?? runGit;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    resolveCommit: async (request) => {
      const parsed = parseSource(request.url, options.allowedGitHosts ?? DEFAULT_ALLOWED_GIT_HOSTS);
      if (parsed.kind !== 'git') {
        throw new RepoPackagingError('SOURCE_INVALID', 'Nguồn đã ghi không phải địa chỉ Git.');
      }
      // The ref recorded at packaging time wins over one inside the address.
      const ref = request.ref ?? parsed.ref;
      if (ref !== undefined && !isSafeRef(ref)) {
        throw new RepoPackagingError('SOURCE_INVALID', 'Tên nhánh hoặc tag đã ghi không hợp lệ.');
      }
      try {
        const stdout = await run(buildLsRemoteArgs(parsed.cloneUrl, ref), { timeoutMs, signal: request.signal });
        return parseLsRemote(stdout, ref);
      } catch (error) {
        const failure = error as { code?: string; killed?: boolean; name?: string };
        if (request.signal?.aborted === true || failure.name === 'AbortError') {
          throw new RepoPackagingError('CANCELLED', 'Đã huỷ kiểm tra bản mới.');
        }
        if (failure.code === 'ENOENT') {
          throw new RepoPackagingError('GIT_UNAVAILABLE', 'Không tìm thấy lệnh git trên máy. Hãy cài Git rồi thử lại.');
        }
        if (failure.killed === true) {
          throw new RepoPackagingError(
            'CLONE_TIMEOUT',
            `Kiểm tra bản mới quá ${Math.round(timeoutMs / 1000)} giây nên đã dừng.`
          );
        }
        throw new RepoPackagingError('CLONE_FAILED', 'Không kiểm tra được bản mới của nguồn.');
      }
    },
  };
};
