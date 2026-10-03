/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import type { LayaPredictionResult, LayaPredictor, LayaQuestion } from './layaSemanticEgressModel';

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

export class LayaSidecarClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private isReady = false;
  private readyPromise: Promise<void> | null = null;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly config: Required<LayaSidecarConfig>;

  public constructor(config: LayaSidecarConfig = {}) {
    this.config = {
      pythonPath: config.pythonPath ?? 'python',
      scriptPath: config.scriptPath ?? path.resolve(process.cwd(), 'scripts/laya_sidecar.py'),
      startupTimeoutMs: config.startupTimeoutMs ?? 60_000,
      requestTimeoutMs: config.requestTimeoutMs ?? 5_000,
    };
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
              this.isReady = true;
              clearTimeout(startupTimer);
              resolve();
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

  public async predict(
    state: Readonly<Record<string, string>>,
    questions: Readonly<Record<string, LayaQuestion>>,
    signal?: AbortSignal
  ): Promise<LayaPredictionResult> {
    if (!this.isReady) {
      try {
        await this.start();
      } catch (err) {
        throw new Error(`[LayaSidecarClient] Sidecar not ready: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!this.process || !this.process.stdin.writable) {
      throw new Error('[LayaSidecarClient] Sidecar stdin is not writable');
    }

    const id = randomUUID();

    return new Promise<LayaPredictionResult>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Operation aborted'));
        return;
      }

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`[LayaSidecarClient] Request ${id} timed out after ${this.config.requestTimeoutMs}ms`));
      }, this.config.requestTimeoutMs);

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
