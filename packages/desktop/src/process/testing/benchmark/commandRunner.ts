/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable no-await-in-loop -- Content hashing is deliberately sequential to enforce byte budgets and deterministic evidence order. */

import type { BenchmarkCommandResult } from '@/common/types/benchmark';
import { createHash, type Hash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { lstat, open, readdir, readlink } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

const MAX_COMMAND_OUTPUT_CHARS = 100_000;
const MAX_DIFF_CHARS = 300_000;
const MAX_GIT_PATH_OUTPUT_CHARS = 2_000_000;
const MAX_FINGERPRINT_FILES = 20_000;
const MAX_FINGERPRINT_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_FINGERPRINT_BYTES_PER_FILE = 2 * 1024 * 1024;
const MAX_UNTRACKED_EVIDENCE_FILES = 50;
const MAX_UNTRACKED_EVIDENCE_BYTES_PER_FILE = 64 * 1024;
const PROCESS_TERMINATION_GRACE_MS = 5_000;
const PROCESS_TERMINATION_HARD_LIMIT_MS = 10_000;

const EXCLUDED_FINGERPRINT_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.next',
  '.omni',
  '.tomni',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
]);

const appendBounded = (current: string, chunk: Buffer | string, limit: number): string => {
  if (current.length >= limit) return current;
  const text = chunk.toString();
  const remaining = limit - current.length;
  return current + text.slice(0, remaining);
};

/**
 * Avoid a transient cmd.exe parent for a plainly-tokenized Windows executable.
 * A direct child lets the hard-kill fallback terminate the command even where
 * taskkill is unavailable; shell syntax still uses the shell/tree-kill path.
 */
const tokenizeDirectWindowsCommand = (command: string): string[] | null => {
  const tokens: string[] = [];
  let cursor = 0;
  while (cursor < command.length) {
    while (/\s/u.test(command[cursor] ?? '')) cursor += 1;
    if (cursor >= command.length) break;
    let token = '';
    if (command[cursor] === '"') {
      const closingQuote = command.indexOf('"', cursor + 1);
      if (closingQuote < 0) return null;
      token = command.slice(cursor + 1, closingQuote);
      cursor = closingQuote + 1;
      if (cursor < command.length && !/\s/u.test(command[cursor] ?? '')) return null;
    } else {
      const nextWhitespace = command.slice(cursor).search(/\s/u);
      const end = nextWhitespace < 0 ? command.length : cursor + nextWhitespace;
      token = command.slice(cursor, end);
      cursor = end;
    }
    if (!token || /[&|<>()^%!]/u.test(token)) return null;
    tokens.push(token);
  }
  return tokens.length > 0 && command.trimStart().startsWith('"') ? tokens : null;
};

const abortError = (): DOMException => new DOMException('Operation aborted.', 'AbortError');

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError();
};

const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

const waitForTaskkill = (pid: number): Promise<void> =>
  new Promise((resolve) => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.once('error', () => resolve());
    killer.once('close', () => resolve());
  });

const isStillRunning = (child: ChildProcess): boolean =>
  Boolean(child.pid) &&
  (child.exitCode === null || child.exitCode === undefined) &&
  (child.signalCode === null || child.signalCode === undefined);

const terminateProcessTree = async (child: ChildProcess): Promise<void> => {
  if (!isStillRunning(child)) return;
  if (process.platform === 'win32') {
    await waitForTaskkill(child.pid);
    if (isStillRunning(child)) child.kill('SIGKILL');
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
};

/** Execute an explicit user-provided acceptance command with bounded output and cancellation. */
export const runBenchmarkCommand = (
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<BenchmarkCommandResult> =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let terminationRequested = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    let hardLimitTimer: ReturnType<typeof setTimeout> | undefined;
    const directWindowsCommand = process.platform === 'win32' ? tokenizeDirectWindowsCommand(command) : null;
    const child = directWindowsCommand
      ? spawn(directWindowsCommand[0], directWindowsCommand.slice(1), {
          cwd,
          windowsHide: true,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : spawn(command, {
          cwd,
          detached: process.platform !== 'win32',
          shell: true,
          windowsHide: true,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      if (hardLimitTimer) clearTimeout(hardLimitTimer);
      signal?.removeEventListener('abort', abort);
    };
    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ command, exitCode, durationMs: Date.now() - startedAt, timedOut, stdout, stderr });
    };
    const requestTermination = (reason: 'abort' | 'timeout'): void => {
      if (settled || terminationRequested) return;
      terminationRequested = true;
      timedOut = reason === 'timeout';
      if (timer) clearTimeout(timer);
      forceTimer = setTimeout(() => child.kill('SIGKILL'), PROCESS_TERMINATION_GRACE_MS);
      // A broken platform kill command must not leave the benchmark permanently pending.
      hardLimitTimer = setTimeout(() => finish(null), PROCESS_TERMINATION_HARD_LIMIT_MS);
      void terminateProcessTree(child);
    };
    const abort = (): void => requestTermination('abort');

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk, MAX_COMMAND_OUTPUT_CHARS);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk, MAX_COMMAND_OUTPUT_CHARS);
    });
    child.once('error', (error) => {
      if (terminationRequested) finish(null);
      else {
        settled = true;
        cleanup();
        reject(error);
      }
    });
    child.once('close', (code) => finish(terminationRequested ? null : code));

    timer = setTimeout(() => requestTermination('timeout'), Math.max(1, timeoutMs));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });

const runGit = (
  cwd: string,
  args: string[],
  signal?: AbortSignal,
  maxChars = MAX_GIT_PATH_OUTPUT_CHARS
): Promise<string> => {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let output = '';
    let stderr = '';
    let aborted = false;
    let settled = false;
    const decoder = new StringDecoder('utf8');
    const child = spawn('git', args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const cleanup = (): void => signal?.removeEventListener('abort', abort);
    const finishReject = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = (): void => {
      aborted = true;
      child.kill();
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      output = appendBounded(output, decoder.write(chunk), maxChars);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk, 8_000);
    });
    child.once('error', finishReject);
    child.once('close', (code) => {
      if (settled) return;
      output = appendBounded(output, decoder.end(), maxChars);
      settled = true;
      cleanup();
      if (aborted || signal?.aborted) reject(abortError());
      else if (code !== 0) reject(new Error(`git ${args[0] ?? ''} failed: ${stderr.trim()}`));
      else resolve(output);
    });
    signal?.addEventListener('abort', abort, { once: true });
  });
};

const digestGitOutput = (cwd: string, args: string[], signal?: AbortSignal): Promise<string> => {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    let stderr = '';
    let aborted = false;
    let settled = false;
    const child = spawn('git', args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const cleanup = (): void => signal?.removeEventListener('abort', abort);
    const finishReject = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = (): void => {
      aborted = true;
      child.kill();
    };
    child.stdout?.on('data', (chunk: Buffer) => hash.update(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk, 8_000);
    });
    child.once('error', finishReject);
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (aborted || signal?.aborted) reject(abortError());
      else if (code !== 0) reject(new Error(`git ${args[0] ?? ''} failed: ${stderr.trim()}`));
      else resolve(hash.digest('hex'));
    });
    signal?.addEventListener('abort', abort, { once: true });
  });
};

const splitNullTerminated = (output: string): string[] => output.split('\0').filter(Boolean);

const comparePaths = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const normalizeRelativePath = (relativePath: string): string => relativePath.replaceAll('\\', '/');

const resolveWorkspacePath = (workspace: string, relativePath: string): string | undefined => {
  const root = path.resolve(workspace);
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return absolute;
};

type FingerprintBudget = { remainingBytes: number };

const hashFileSignature = async (
  hash: Hash,
  workspace: string,
  relativePath: string,
  budget: FingerprintBudget,
  signal?: AbortSignal
): Promise<void> => {
  throwIfAborted(signal);
  const normalizedPath = normalizeRelativePath(relativePath);
  hash.update(`path\0${normalizedPath}\0`);
  const absolutePath = resolveWorkspacePath(workspace, relativePath);
  if (!absolutePath) {
    hash.update('unsafe-path\0');
    return;
  }
  try {
    const stats = await lstat(absolutePath);
    throwIfAborted(signal);
    hash.update(`mode\0${stats.mode & 0o777}\0size\0${stats.size}\0`);
    if (stats.isSymbolicLink()) {
      hash.update(`symlink\0${await readlink(absolutePath)}\0`);
      return;
    }
    if (!stats.isFile()) {
      hash.update('non-file\0');
      return;
    }

    const sampleBytes = Math.min(stats.size, MAX_FINGERPRINT_BYTES_PER_FILE, budget.remainingBytes);
    if (sampleBytes <= 0) {
      hash.update('content-budget-exhausted\0');
      return;
    }
    const handle = await open(absolutePath, 'r');
    try {
      if (sampleBytes === stats.size) {
        const buffer = Buffer.alloc(sampleBytes);
        const { bytesRead } = await handle.read(buffer, 0, sampleBytes, 0);
        hash.update('full\0').update(buffer.subarray(0, bytesRead));
        budget.remainingBytes -= bytesRead;
      } else {
        const headBytes = Math.ceil(sampleBytes / 2);
        const tailBytes = sampleBytes - headBytes;
        const head = Buffer.alloc(headBytes);
        const tail = Buffer.alloc(tailBytes);
        const headRead = await handle.read(head, 0, headBytes, 0);
        const tailRead =
          tailBytes > 0 ? await handle.read(tail, 0, tailBytes, Math.max(0, stats.size - tailBytes)) : { bytesRead: 0 };
        hash
          .update('sample\0')
          .update(head.subarray(0, headRead.bytesRead))
          .update('\0tail\0')
          .update(tail.subarray(0, tailRead.bytesRead));
        budget.remainingBytes -= headRead.bytesRead + tailRead.bytesRead;
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    throwIfAborted(signal);
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
    hash.update(`unreadable\0${code}\0`);
  }
};

const hashWorkspaceFiles = async (
  hash: Hash,
  workspace: string,
  relativePaths: string[],
  signal?: AbortSignal
): Promise<void> => {
  const paths = [...new Set(relativePaths.map(normalizeRelativePath))].toSorted(comparePaths);
  const selected = paths.slice(0, MAX_FINGERPRINT_FILES);
  hash.update(`file-count\0${paths.length}\0selected\0${selected.length}\0`);
  const budget: FingerprintBudget = { remainingBytes: MAX_FINGERPRINT_TOTAL_BYTES };
  for (const relativePath of selected) {
    await hashFileSignature(hash, workspace, relativePath, budget, signal);
  }
  if (paths.length > selected.length) hash.update(`omitted-files\0${paths.length - selected.length}\0`);
};

const collectWorkspaceFiles = async (
  workspace: string,
  signal?: AbortSignal
): Promise<{ paths: string[]; truncated: boolean }> => {
  const paths: string[] = [];
  let truncated = false;
  const visit = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
    throwIfAborted(signal);
    if (truncated) return;
    const entries = (await readdir(absoluteDirectory, { withFileTypes: true })).toSorted((left, right) =>
      comparePaths(left.name, right.name)
    );
    for (const entry of entries) {
      throwIfAborted(signal);
      if (entry.isDirectory() && EXCLUDED_FINGERPRINT_DIRECTORIES.has(entry.name.toLowerCase())) continue;
      const relativePath = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      if (entry.isDirectory()) await visit(path.join(absoluteDirectory, entry.name), relativePath);
      else paths.push(normalizeRelativePath(relativePath));
      if (paths.length >= MAX_FINGERPRINT_FILES) {
        truncated = true;
        return;
      }
    }
  };
  await visit(path.resolve(workspace), '');
  return { paths, truncated };
};

const nonGitWorkspaceFingerprint = async (workspace: string, signal?: AbortSignal): Promise<string> => {
  const hash = createHash('sha256').update('benchmark-source-v2\0non-git\0');
  const collected = await collectWorkspaceFiles(workspace, signal);
  await hashWorkspaceFiles(hash, workspace, collected.paths, signal);
  hash.update(`walk-truncated\0${collected.truncated}\0`);
  return hash.digest('hex');
};

/** Fingerprint repository content and index state before an agent starts editing it. */
export const benchmarkSourceFingerprint = async (workspace: string, signal?: AbortSignal): Promise<string> => {
  throwIfAborted(signal);
  try {
    const head = (await runGit(workspace, ['rev-parse', 'HEAD'], signal)).trim();
    const statusDigest = await digestGitOutput(
      workspace,
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      signal
    );
    const stagedDigest = await digestGitOutput(
      workspace,
      ['diff', '--cached', '--raw', '--no-abbrev', '-z', 'HEAD'],
      signal
    );
    const unstagedPaths = splitNullTerminated(
      await runGit(workspace, ['diff', '--name-only', '-z', '--no-ext-diff'], signal)
    );
    const untrackedPaths = splitNullTerminated(
      await runGit(workspace, ['ls-files', '--others', '--exclude-standard', '-z'], signal)
    );
    const hash = createHash('sha256')
      .update('benchmark-source-v2\0git\0')
      .update(`head\0${head}\0status\0${statusDigest}\0staged\0${stagedDigest}\0`);
    await hashWorkspaceFiles(hash, workspace, [...unstagedPaths, ...untrackedPaths], signal);
    return hash.digest('hex');
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw abortError();
    return nonGitWorkspaceFingerprint(workspace, signal);
  }
};

const isSensitiveEvidencePath = (relativePath: string): boolean => {
  const name = path.basename(relativePath).toLowerCase();
  return (
    name === '.env' ||
    name.startsWith('.env.') ||
    /(?:credential|secret|token|private[-_.]?key)/u.test(name) ||
    /\.(?:key|keystore|p12|pem|pfx)$/u.test(name)
  );
};

const renderUntrackedEvidence = async (
  workspace: string,
  relativePaths: string[],
  signal?: AbortSignal
): Promise<string> => {
  const selected = [...new Set(relativePaths.map(normalizeRelativePath))]
    .toSorted(comparePaths)
    .slice(0, MAX_UNTRACKED_EVIDENCE_FILES);
  let evidence = '';
  for (const relativePath of selected) {
    throwIfAborted(signal);
    const absolutePath = resolveWorkspacePath(workspace, relativePath);
    evidence = appendBounded(evidence, `\n### Untracked: ${relativePath}\n`, MAX_DIFF_CHARS);
    if (!absolutePath) {
      evidence = appendBounded(evidence, '[content omitted: unsafe path]\n', MAX_DIFF_CHARS);
      continue;
    }
    try {
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        evidence = appendBounded(evidence, `[symlink -> ${await readlink(absolutePath)}]\n`, MAX_DIFF_CHARS);
        continue;
      }
      if (!stats.isFile()) {
        evidence = appendBounded(evidence, '[content omitted: not a regular file]\n', MAX_DIFF_CHARS);
        continue;
      }
      if (isSensitiveEvidencePath(relativePath)) {
        evidence = appendBounded(
          evidence,
          `[content omitted: sensitive filename, ${stats.size} bytes]\n`,
          MAX_DIFF_CHARS
        );
        continue;
      }
      const bytesToRead = Math.min(stats.size, MAX_UNTRACKED_EVIDENCE_BYTES_PER_FILE);
      const buffer = Buffer.alloc(bytesToRead);
      const handle = await open(absolutePath, 'r');
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
      await handle.close();
      const content = buffer.subarray(0, bytesRead);
      const digest = createHash('sha256').update(content).digest('hex');
      if (content.includes(0)) {
        evidence = appendBounded(
          evidence,
          `[binary content omitted: ${stats.size} bytes, sample sha256 ${digest}]\n`,
          MAX_DIFF_CHARS
        );
        continue;
      }
      const text = content.toString('utf8').replaceAll('\r\n', '\n');
      const patch = text
        .split('\n')
        .map((line) => `+${line}`)
        .join('\n');
      evidence = appendBounded(evidence, `--- /dev/null\n+++ b/${relativePath}\n${patch}\n`, MAX_DIFF_CHARS);
      if (stats.size > bytesRead) {
        evidence = appendBounded(
          evidence,
          `[truncated after ${bytesRead} of ${stats.size} bytes, sample sha256 ${digest}]\n`,
          MAX_DIFF_CHARS
        );
      }
    } catch (error) {
      throwIfAborted(signal);
      const message = error instanceof Error ? error.message : String(error);
      evidence = appendBounded(evidence, `[unable to read: ${message}]\n`, MAX_DIFF_CHARS);
    }
  }
  if (relativePaths.length > selected.length) {
    evidence = appendBounded(
      evidence,
      `\n[${relativePaths.length - selected.length} additional untracked files omitted]\n`,
      MAX_DIFF_CHARS
    );
  }
  return evidence;
};

/** Capture bounded staged, unstaged, and untracked evidence after the benchmark. */
export const captureBenchmarkDiff = async (
  workspace: string,
  signal?: AbortSignal
): Promise<{ diff: string; changedFiles: string[] }> => {
  try {
    const [stagedDiff, unstagedDiff, stagedNames, unstagedNames, untrackedOutput] = await Promise.all([
      runGit(workspace, ['diff', '--cached', '--no-ext-diff', '--binary'], signal, MAX_DIFF_CHARS),
      runGit(workspace, ['diff', '--no-ext-diff', '--binary'], signal, MAX_DIFF_CHARS),
      runGit(workspace, ['diff', '--cached', '--name-only', '-z'], signal),
      runGit(workspace, ['diff', '--name-only', '-z'], signal),
      runGit(workspace, ['ls-files', '--others', '--exclude-standard', '-z'], signal),
    ]);
    const untracked = splitNullTerminated(untrackedOutput);
    const changedFiles = [
      ...new Set([...splitNullTerminated(stagedNames), ...splitNullTerminated(unstagedNames), ...untracked]),
    ]
      .map(normalizeRelativePath)
      .toSorted(comparePaths);
    let diff = '';
    if (stagedDiff) diff = appendBounded(diff, `# Staged changes\n${stagedDiff}`, MAX_DIFF_CHARS);
    if (unstagedDiff) diff = appendBounded(diff, `\n# Unstaged changes\n${unstagedDiff}`, MAX_DIFF_CHARS);
    if (diff.length < MAX_DIFF_CHARS && untracked.length > 0) {
      const evidence = await renderUntrackedEvidence(workspace, untracked, signal);
      diff = appendBounded(diff, `\n# Untracked files${evidence}`, MAX_DIFF_CHARS);
    }
    return { diff, changedFiles };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw abortError();
    return { diff: '', changedFiles: [] };
  }
};
