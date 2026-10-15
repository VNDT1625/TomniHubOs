/**
 * Spawns one hook process with bounded output, a hard timeout and whole-tree termination
 * (design section 11.6 items 5 and 6). Never throws.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { MAX_HOOK_STREAM_BYTES, capStream } from '@/common/integrations/hooks';

/** How long to keep draining the pipes after the process exited (an orphan may hold them open). */
const PIPE_GRACE_MS = 250;
/** Upper bound for waiting on `taskkill` and for the child to report its exit after a kill. */
const KILL_WAIT_MS = 3000;

/** A fully resolved command line. `shell` means `file` is a whole command string for the shell. */
export type HookSpawnSpec = {
  file: string;
  args: string[];
  shell: boolean;
  env: NodeJS.ProcessEnv;
  cwd: string;
};

export type HookProcessOutcome = {
  startError?: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  timedOut: boolean;
  aborted: boolean;
};

const emptyOutcome = (): HookProcessOutcome => ({
  exitCode: null,
  stdout: '',
  stderr: '',
  stdoutBytes: 0,
  stderrBytes: 0,
  stdoutTruncated: false,
  stderrTruncated: false,
  timedOut: false,
  aborted: false,
});

/** Keeps at most 64 KB of a stream while still counting (and discarding) everything after it. */
const createCapture = (): {
  push: (chunk: Buffer) => void;
  text: () => string;
  total: () => number;
  truncated: () => boolean;
} => {
  const chunks: Buffer[] = [];
  let kept = 0;
  let total = 0;
  return {
    push: (chunk) => {
      total += chunk.length;
      if (kept >= MAX_HOOK_STREAM_BYTES) return;
      const room = MAX_HOOK_STREAM_BYTES - kept;
      const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
      chunks.push(piece);
      kept += piece.length;
    },
    text: () => capStream(Buffer.concat(chunks).toString('utf8').replace(/�$/, '')),
    total: () => total,
    truncated: () => total > MAX_HOOK_STREAM_BYTES,
  };
};

const waitFor = (ms: number, until: Promise<unknown>): Promise<void> =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    void until.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Kills a process and everything it started. Windows: `taskkill /PID <pid> /T /F`. POSIX: the child
 * leads its own process group (spawned detached), so the whole group gets SIGKILL.
 */
export const killProcessTree = async (child: Pick<ChildProcess, 'pid' | 'kill'>): Promise<void> => {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      const done = new Promise<void>((resolve) => {
        killer.once('error', () => resolve());
        killer.once('exit', () => resolve());
      });
      await waitFor(KILL_WAIT_MS, done);
      try {
        killer.kill();
      } catch {
        // taskkill already finished.
      }
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // The group or process may already be gone; fall back to killing the direct child.
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // Already exited.
  }
};

/**
 * Runs the process, writes `stdin` and closes it, reads at most 64 KB per stream (the rest is drained
 * and dropped so the child never blocks on a full pipe), and enforces `timeoutMs`.
 */
export const runHookProcess = (
  spec: HookSpawnSpec,
  stdin: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<HookProcessOutcome> =>
  new Promise<HookProcessOutcome>((resolve) => {
    const outcome = emptyOutcome();
    const stdout = createCapture();
    const stderr = createCapture();
    let child: ChildProcess;
    try {
      child = spawn(spec.file, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        shell: spec.shell,
        windowsHide: true,
        // A POSIX group leader lets us kill the whole tree; on Windows taskkill /T walks the tree instead.
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ ...outcome, startError: error instanceof Error ? error.message : String(error) });
      return;
    }

    let finished = false;
    let exited = false;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    let killGuardTimer: NodeJS.Timeout | undefined;

    const onAbort = (): void => {
      outcome.aborted = true;
      void killProcessTree(child);
    };

    const finish = (): void => {
      if (finished) return;
      finished = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (graceTimer) clearTimeout(graceTimer);
      if (killGuardTimer) clearTimeout(killGuardTimer);
      signal?.removeEventListener('abort', onAbort);
      child.stdout?.destroy();
      child.stderr?.destroy();
      outcome.stdout = stdout.text();
      outcome.stderr = stderr.text();
      outcome.stdoutBytes = stdout.total();
      outcome.stderrBytes = stderr.total();
      outcome.stdoutTruncated = stdout.truncated();
      outcome.stderrTruncated = stderr.truncated();
      if (outcome.timedOut || outcome.aborted) outcome.exitCode = null;
      resolve(outcome);
    };

    child.on('error', (error) => {
      // Before a pid exists the process never started (ENOENT, EACCES, bad cwd).
      if (child.pid === undefined && !finished) {
        outcome.startError = error.message;
        finish();
      }
    });
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.stdout?.on('error', () => undefined);
    child.stderr?.on('error', () => undefined);
    child.on('exit', (code) => {
      exited = true;
      outcome.exitCode = code;
      graceTimer = setTimeout(finish, PIPE_GRACE_MS);
    });
    child.on('close', finish);

    // A hook that does not read stdin raises EPIPE; that is not an error.
    child.stdin?.on('error', () => undefined);
    try {
      child.stdin?.end(stdin);
    } catch {
      // Ignore: the process may already be gone.
    }

    timeoutTimer = setTimeout(() => {
      if (exited || finished) return;
      outcome.timedOut = true;
      void killProcessTree(child);
      // If the kill is not reported, do not wait forever.
      killGuardTimer = setTimeout(finish, KILL_WAIT_MS);
    }, timeoutMs);

    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
