/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runs one package CLI to completion with hard limits (docs/platform/repotopackage-design.md section 15.1).
 *
 * - `file` is an absolute path chosen by Main from `PATH`; `args` are plain tokens passed as an array. There is never
 *   a shell: on Windows a `.cmd`/`.bat` shim (the form npm installs) goes through `cmd.exe /d /s /c` with a command
 *   line built here from tokens that cannot hold a cmd metacharacter, and a shim whose own path could is refused.
 * - It stops at the timeout or when the caller aborts, killing the whole process tree.
 * - Output is merged stdout and stderr, kept only up to the byte cap; the rest is dropped while the program runs on.
 */

import { execFile, spawn } from 'node:child_process';

export type CliExecRequest = Readonly<{
  file: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}>;

export type CliExecResult = Readonly<{
  exitCode: number | null;
  /** Raw merged output, at most `maxOutputBytes`. Callers scrub it before showing it to anyone. */
  output: string;
  truncated: boolean;
  timedOut: boolean;
  cancelled: boolean;
  /** The program could not be started (not a failure of the program itself). */
  startError?: string;
}>;

export type CliExecPort = (request: CliExecRequest) => Promise<CliExecResult>;

const IS_WINDOWS = process.platform === 'win32';
const BATCH_FILE = /\.(?:cmd|bat)$/iu;
// A path that cmd.exe would read as syntax even inside quotes.
const BATCH_UNSAFE_PATH = /["%&^|<>!\r\n]/u;
const KILL_WAIT_MS = 3000;

const killTree = (pid: number | undefined): void => {
  if (pid === undefined) return;
  if (IS_WINDOWS) {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 }, () => undefined);
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
};

export const nodeCliExec: CliExecPort = (request) =>
  new Promise<CliExecResult>((resolve) => {
    let file = request.file;
    let args = [...request.args];
    let verbatim = false;
    if (IS_WINDOWS && BATCH_FILE.test(file)) {
      if (BATCH_UNSAFE_PATH.test(file)) {
        resolve({
          exitCode: null,
          output: '',
          truncated: false,
          timedOut: false,
          cancelled: false,
          startError: 'The program is a batch file whose path holds a character cmd.exe would treat as syntax.',
        });
        return;
      }
      file = process.env['ComSpec'] ?? 'cmd.exe';
      args = ['/d', '/s', '/c', `""${request.file}" ${request.args.join(' ')}"`];
      verbatim = true;
    }

    const chunks: Buffer[] = [];
    let kept = 0;
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    let finished = false;
    let failsafe: NodeJS.Timeout | undefined;

    const finish = (result: Pick<CliExecResult, 'exitCode'> & { startError?: string }): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(failsafe);
      request.signal?.removeEventListener('abort', onAbort);
      resolve({
        exitCode: result.exitCode,
        output: Buffer.concat(chunks).toString('utf8'),
        truncated,
        timedOut,
        cancelled,
        ...(result.startError === undefined ? {} : { startError: result.startError }),
      });
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, args, {
        cwd: request.cwd,
        env: { ...request.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: !IS_WINDOWS,
        windowsHide: true,
        windowsVerbatimArguments: verbatim,
        shell: false,
      });
    } catch (error) {
      resolve({
        exitCode: null,
        output: '',
        truncated: false,
        timedOut: false,
        cancelled: false,
        startError: error instanceof Error ? error.message : 'The program could not be started.',
      });
      return;
    }

    const stop = (): void => {
      killTree(child.pid);
      // A program that ignores the kill must not hold the caller forever.
      failsafe = setTimeout(() => finish({ exitCode: null }), KILL_WAIT_MS);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, request.timeoutMs);
    const onAbort = (): void => {
      cancelled = true;
      stop();
    };
    if (request.signal?.aborted === true) onAbort();
    else request.signal?.addEventListener('abort', onAbort, { once: true });

    const collect = (chunk: Buffer): void => {
      if (truncated) return;
      const room = request.maxOutputBytes - kept;
      if (chunk.length > room) {
        if (room > 0) chunks.push(chunk.subarray(0, room));
        kept = request.maxOutputBytes;
        truncated = true;
        return;
      }
      chunks.push(chunk);
      kept += chunk.length;
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.once('error', (error) => finish({ exitCode: null, startError: error.message }));
    child.once('close', (code) => finish({ exitCode: code }));
  });
