/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { LayaPredictionResult, LayaPredictor, LayaQuestion } from './layaSemanticEgressModel';

const WARMUP_TIMEOUT_MS = 30_000;

export type LayaSidecarConfig = Readonly<{
  pythonPath?: string;
  scriptPath?: string;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
}>;

type PendingRequest = {
  resolve: (result: LayaPredictionResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/**
 * Where the sidecar script lives: an explicit override, the working directory (development), or next to the
 * packaged app's resources. The first one that exists wins; the working-directory path is the last resort.
 */
export const resolveLayaScriptPath = (): string => {
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  const candidates = [
    process.env.TOMNY_LAYA_SIDECAR,
    path.resolve(process.cwd(), 'scripts/laya_sidecar.py'),
    resources ? path.join(resources, 'scripts', 'laya_sidecar.py') : undefined,
    resources ? path.join(resources, 'app.asar.unpacked', 'scripts', 'laya_sidecar.py') : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));
  return (
    candidates.find((candidate) => existsSync(candidate)) ?? path.resolve(process.cwd(), 'scripts/laya_sidecar.py')
  );
};

export class LayaSidecarClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private isReady = false;
  private readyPromise: Promise<void> | null = null;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly config: Required<LayaSidecarConfig>;
  private warmup: {
    state: Readonly<Record<string, string>>;
    questions: Readonly<Record<string, LayaQuestion>>;
  } | null = null;

  public constructor(config: LayaSidecarConfig = {}) {
    this.config = {
      pythonPath: config.pythonPath ?? 'python',
      scriptPath: config.scriptPath ?? resolveLayaScriptPath(),
      startupTimeoutMs: config.startupTimeoutMs ?? 180_000,
      requestTimeoutMs: config.requestTimeoutMs ?? 5_000,
    };
  }

  /** True once the model has loaded and requests are served without waiting. */
  public get ready(): boolean {
    return this.isReady;
  }

  /** A representative request answered once at startup. Without it the first real request pays the warm-up. */
  public setWarmup(state: Readonly<Record<string, string>>, questions: Readonly<Record<string, LayaQuestion>>): void {
    this.warmup = { state, questions };
  }

  private async warmUp(): Promise<void> {
    if (!this.warmup) return;
    await this.send(this.warmup.state, this.warmup.questions, undefined, WARMUP_TIMEOUT_MS);
  }

  public async start(): Promise<void> {
    if (this.isReady) {
      return;
    }
    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = new Promise<void>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams | null = null;
      const startupTimer = setTimeout(() => {
        this.readyPromise = null;
        this.isReady = false;
        try {
          if (child) child.kill();
        } catch {
          /* ignore */
        }
        this.process = null;
        reject(new Error(`[LayaSidecarClient] Startup timed out after ${this.config.startupTimeoutMs}ms`));
      }, this.config.startupTimeoutMs);

      try {
        child = spawn(this.config.pythonPath, [this.config.scriptPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PYTHONUNBUFFERED: '1' },
        });

        this.process = child;

        const rl = readline.createInterface({
          input: child.stdout,
          crlfDelay: Infinity,
        });

        rl.on('line', (line: string) => {
          const trimmed = line.trim();
          if (!trimmed) return;

          try {
            const data = JSON.parse(trimmed);

            // Startup handshake
            if (data.status === 'ready') {
              clearTimeout(startupTimer);
              // Answer one request before reporting ready: the first inference after loading is much slower than
              // the rest, and a person would be waiting on it.
              void this.warmUp().then(() => {
                if (this.process !== child) {
                  reject(new Error('[LayaSidecarClient] Process exited during warm-up'));
                  return;
                }
                this.isReady = true;
                resolve();
              });
              return;
            }

            // Handle predict response
            const reqId = data.id;
            if (reqId && this.pendingRequests.has(reqId)) {
              const pending = this.pendingRequests.get(reqId)!;
              this.pendingRequests.delete(reqId);
              clearTimeout(pending.timer);

              if (data.status === 'ok') {
                pending.resolve({
                  answers: data.answers ?? {},
                });
              } else {
                pending.reject(new Error(data.error ?? 'Unknown Laya sidecar error'));
              }
            }
          } catch {
            // Ignore malformed line
          }
        });

        child.stderr.on('data', () => {
          // Diagnostic log
        });

        child.on('error', (err) => {
          clearTimeout(startupTimer);
          this.isReady = false;
          this.readyPromise = null;
          this.process = null;
          reject(err);
        });

        child.on('exit', (code) => {
          clearTimeout(startupTimer);
          this.isReady = false;
          this.process = null;
          this.readyPromise = null;
          // Reject all remaining pending requests
          for (const [, pending] of this.pendingRequests.entries()) {
            clearTimeout(pending.timer);
            pending.reject(new Error(`[LayaSidecarClient] Process exited unexpectedly with code ${code}`));
          }
          this.pendingRequests.clear();
        });
      } catch (err) {
        clearTimeout(startupTimer);
        this.readyPromise = null;
        reject(err);
      }
    });

    return this.readyPromise;
  }

  private waitUntilReady(signal?: AbortSignal): Promise<void> {
    const starting = this.start();
    if (!signal) {
      return starting;
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => reject(new Error('Operation aborted while the sidecar was starting'));
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      starting.then(
        () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });
  }

  public async predict(
    state: Readonly<Record<string, string>>,
    questions: Readonly<Record<string, LayaQuestion>>,
    signal?: AbortSignal
  ): Promise<LayaPredictionResult> {
    if (!this.isReady) {
      try {
        // Startup keeps running in the background after the caller gives up, so a slow cold start is not restarted.
        await this.waitUntilReady(signal);
      } catch (err) {
        throw new Error(`[LayaSidecarClient] Sidecar not ready: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return this.send(state, questions, signal, this.config.requestTimeoutMs);
  }

  private send(
    state: Readonly<Record<string, string>>,
    questions: Readonly<Record<string, LayaQuestion>>,
    signal: AbortSignal | undefined,
    timeoutMs: number
  ): Promise<LayaPredictionResult> {
    if (!this.process || !this.process.stdin.writable) {
      return Promise.reject(new Error('[LayaSidecarClient] Sidecar stdin is not writable'));
    }

    const id = randomUUID();

    return new Promise<LayaPredictionResult>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Operation aborted'));
        return;
      }

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`[LayaSidecarClient] Request ${id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const onAbort = () => {
        this.pendingRequests.delete(id);
        clearTimeout(timer);
        reject(new Error('Operation aborted'));
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.pendingRequests.set(id, {
        resolve: (val) => {
          if (signal) signal.removeEventListener('abort', onAbort);
          resolve(val);
        },
        reject: (err) => {
          if (signal) signal.removeEventListener('abort', onAbort);
          reject(err);
        },
        timer,
      });

      const payload = JSON.stringify({
        id,
        action: 'predict',
        state,
        questions,
      });

      this.process!.stdin.write(payload + '\n');
    });
  }

  public stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.isReady = false;
      this.readyPromise = null;
    }
  }
}

let sharedClient: LayaSidecarClient | null = null;

export const getSharedLayaSidecarClient = (): LayaSidecarClient => {
  if (!sharedClient) {
    sharedClient = new LayaSidecarClient();
  }
  return sharedClient;
};

export const createLayaSidecarPredictor = (client: LayaSidecarClient = getSharedLayaSidecarClient()): LayaPredictor => {
  return (state, questions, signal) => client.predict(state, questions, signal);
};

/**
 * For the chat path, where a person is waiting. While the model is still loading (tens of seconds on the first
 * start) it fails at once instead of making every stage wait for it, so the deterministic checks answer right
 * away. Starting is kicked off in the background, so later messages find it ready.
 */
export const createLayaPipelinePredictor = (
  client: LayaSidecarClient = getSharedLayaSidecarClient()
): LayaPredictor => {
  return (state, questions, signal) => {
    if (!client.ready) {
      void client.start().catch((): void => undefined);
      return Promise.reject(new Error('[LayaSidecarClient] Sidecar is still starting'));
    }
    return client.predict(state, questions, signal);
  };
};
