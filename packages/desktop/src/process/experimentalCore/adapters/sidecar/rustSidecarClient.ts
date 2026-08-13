/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import {
  TOMNY_SIDECAR_PROTOCOL,
  TOMNY_SIDECAR_PROTOCOL_VERSION,
  type SidecarFallbackResult,
  type SidecarInitializeResult,
  type SidecarRequest,
  type SidecarRequestOptions,
  type SidecarResponse,
  type SidecarRestartPolicy,
} from './types';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 5_000;
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;

export class SidecarUnavailableError extends Error {
  readonly name = 'SidecarUnavailableError';
}

export class SidecarProtocolError extends Error {
  readonly name = 'SidecarProtocolError';
}

export class SidecarTimeoutError extends Error {
  readonly name = 'SidecarTimeoutError';
}

export class SidecarRemoteError extends Error {
  readonly name = 'SidecarRemoteError';

  constructor(
    message: string,
    readonly code: string,
    readonly data?: unknown
  ) {
    super(message);
  }
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

export type RustSidecarClientConfig = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  restartPolicy?: SidecarRestartPolicy;
  requestTimeoutMs?: number;
  startupTimeoutMs?: number;
  clientVersion?: string;
};

export type RustSidecarClientDeps = {
  spawnProcess?: typeof spawn;
  createRequestId?: () => string;
};

export type RustSidecarStatus =
  | { state: 'stopped' | 'starting'; runtime?: undefined }
  | { state: 'ready'; runtime: SidecarInitializeResult };

const toError = (value: unknown): Error => (value instanceof Error ? value : new Error(String(value)));

export const isSidecarFallbackEligible = (error: Error): boolean =>
  error instanceof SidecarUnavailableError ||
  error instanceof SidecarProtocolError ||
  error instanceof SidecarTimeoutError;

/** Main-process NDJSON client for the local Rust runtime sidecar. */
export class RustSidecarClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private generation = 0;
  private state: RustSidecarStatus = { state: 'stopped' };
  private startPromise: Promise<SidecarInitializeResult> | null = null;
  private stdoutBuffer = '';
  private stderrTail = '';

  private failedUnexpectedly = false;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly spawnProcess: typeof spawn;
  private readonly createRequestId: () => string;

  constructor(
    private readonly config: RustSidecarClientConfig,
    deps: RustSidecarClientDeps = {}
  ) {
    if (!config.command.trim()) throw new Error('Rust sidecar command must not be empty.');
    this.spawnProcess = deps.spawnProcess ?? spawn;
    this.createRequestId = deps.createRequestId ?? randomUUID;
  }

  getStatus(): RustSidecarStatus {
    return this.state;
  }

  async start(): Promise<SidecarInitializeResult> {
    if (this.state.state === 'ready') return this.state.runtime;
    if (this.startPromise) return this.startPromise;

    this.failedUnexpectedly = false;
    this.state = { state: 'starting' };
    this.startPromise = this.spawnAndNegotiate();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async request<T>(method: string, params?: unknown, options: SidecarRequestOptions = {}): Promise<T> {
    if (!method.trim()) throw new Error('Rust sidecar method must not be empty.');
    if (this.failedUnexpectedly && this.config.restartPolicy === 'never') {
      throw new SidecarUnavailableError('Rust sidecar stopped and automatic restart is disabled.');
    }
    await this.start();
    return this.rawRequest<T>(method, params, options);
  }

  /** TypeScript fallback is opt-in at each call site; the client never silently changes engines. */
  async requestWithFallback<T>(
    method: string,
    params: unknown,
    fallback: (cause: Error) => Promise<T>,
    options: SidecarRequestOptions = {}
  ): Promise<SidecarFallbackResult<T>> {
    try {
      return { source: 'rust', value: await this.request<T>(method, params, options) };
    } catch (error) {
      const cause = toError(error);
      if (!isSidecarFallbackEligible(cause)) throw cause;
      return { source: 'typescript', value: await fallback(cause), cause };
    }
  }

  async restart(): Promise<SidecarInitializeResult> {
    this.failedUnexpectedly = false;
    this.terminate(new SidecarUnavailableError('Rust sidecar was restarted.'));
    return this.start();
  }

  async stop(): Promise<void> {
    this.failedUnexpectedly = false;
    this.terminate(new SidecarUnavailableError('Rust sidecar was stopped.'));
  }

  private async spawnAndNegotiate(): Promise<SidecarInitializeResult> {
    const generation = ++this.generation;
    this.stdoutBuffer = '';
    this.stderrTail = '';

    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnProcess(this.config.command, this.config.args ?? [], {
        cwd: this.config.cwd,
        env: { ...process.env, ...this.config.env },
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      this.failedUnexpectedly = true;
      this.state = { state: 'stopped' };
      throw new SidecarUnavailableError(`Unable to start Rust sidecar: ${toError(error).message}`);
    }

    this.child = child;
    child.stdout.on('data', (chunk: Buffer | string) => this.onStdout(generation, chunk));
    child.stderr.on('data', (chunk: Buffer | string) => this.onStderr(generation, chunk));
    child.once('error', (error) => this.onProcessFailure(generation, error));
    child.once('exit', (code, signal) => {
      const detail = signal ? `signal ${signal}` : `exit code ${String(code)}`;
      this.onProcessFailure(generation, new Error(detail));
    });

    try {
      const initialized = await this.rawRequest<SidecarInitializeResult>(
        'core.initialize',
        {
          protocol: TOMNY_SIDECAR_PROTOCOL,
          minimumProtocolVersion: TOMNY_SIDECAR_PROTOCOL_VERSION,
          maximumProtocolVersion: TOMNY_SIDECAR_PROTOCOL_VERSION,
          clientVersion: this.config.clientVersion ?? 'tomny-desktop',
        },
        { timeoutMs: this.config.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS }
      );
      this.assertInitializeResult(initialized);
      this.state = { state: 'ready', runtime: initialized };
      return initialized;
    } catch (error) {
      this.failedUnexpectedly = true;
      this.terminate(toError(error));
      throw error;
    }
  }

  private rawRequest<T>(method: string, params: unknown, options: SidecarRequestOptions): Promise<T> {
    const child = this.child;
    if (!child || child.killed) {
      return Promise.reject(new SidecarUnavailableError('Rust sidecar is not running.'));
    }
    if (options.signal?.aborted) return Promise.reject(this.abortError());

    const id = this.createRequestId();
    const timeoutMs = options.timeoutMs ?? this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const message: SidecarRequest = {
      protocol: TOMNY_SIDECAR_PROTOCOL,
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };

    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const onAbort = (): void => {
        this.cancelRequest(id);
        rejectPending(this.abortError());
      };
      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      };
      const rejectPending = (error: Error): void => {
        if (!this.pending.delete(id)) return;
        cleanup();
        reject(error);
      };

      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timer = setTimeout(() => {
          this.cancelRequest(id);
          rejectPending(
            new SidecarTimeoutError(`Rust sidecar request '${method}' timed out after ${String(timeoutMs)} ms.`)
          );
        }, timeoutMs);
      }
      options.signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        cleanup,
      });

      try {
        this.write(message);
      } catch (error) {
        rejectPending(new SidecarUnavailableError(`Unable to write to Rust sidecar: ${toError(error).message}`));
      }
    });
  }

  private cancelRequest(requestId: string): void {
    if (!this.child || this.child.killed) return;
    const notification: SidecarRequest = {
      protocol: TOMNY_SIDECAR_PROTOCOL,
      id: this.createRequestId(),
      method: 'core.cancel',
      params: { requestId },
    };
    try {
      this.write(notification);
    } catch {
      // The pending request still receives its deterministic timeout/cancellation error.
    }
  }

  private write(message: SidecarRequest): void {
    if (!this.child || this.child.killed || !this.child.stdin.writable) {
      throw new SidecarUnavailableError('Rust sidecar stdin is unavailable.');
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onStdout(generation: number, chunk: Buffer | string): void {
    if (generation !== this.generation) return;
    this.stdoutBuffer += chunk.toString();
    if (Buffer.byteLength(this.stdoutBuffer, 'utf8') > MAX_LINE_BYTES) {
      this.onProcessFailure(generation, new SidecarProtocolError('Rust sidecar emitted an oversized frame.'));
      return;
    }

    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) this.onLine(generation, line);
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  private onStderr(generation: number, chunk: Buffer | string): void {
    if (generation !== this.generation) return;
    this.stderrTail = `${this.stderrTail}${chunk.toString()}`.slice(-MAX_STDERR_BYTES);
  }

  private onLine(generation: number, line: string): void {
    if (generation !== this.generation) return;
    let response: SidecarResponse;
    try {
      response = JSON.parse(line) as SidecarResponse;
    } catch {
      this.onProcessFailure(generation, new SidecarProtocolError('Rust sidecar emitted invalid JSON.'));
      return;
    }
    if (
      response.protocol !== TOMNY_SIDECAR_PROTOCOL ||
      typeof response.id !== 'string' ||
      typeof response.ok !== 'boolean'
    ) {
      this.onProcessFailure(generation, new SidecarProtocolError('Rust sidecar emitted an invalid response envelope.'));
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    pending.cleanup();
    if (!response.ok) {
      const remoteError = response.error ?? { code: 'UNKNOWN', message: 'Rust sidecar request failed.' };
      pending.reject(new SidecarRemoteError(remoteError.message, remoteError.code, remoteError.details));
      return;
    }
    pending.resolve(response.result);
  }

  private onProcessFailure(generation: number, error: Error): void {
    if (generation !== this.generation) return;

    this.failedUnexpectedly = true;
    const stderr = this.stderrTail.trim();
    const suffix = stderr ? `: ${stderr}` : '';
    const failure =
      error instanceof SidecarProtocolError
        ? error
        : new SidecarUnavailableError(`Rust sidecar stopped unexpectedly (${error.message})${suffix}`);
    this.terminate(failure);
  }

  private terminate(error: Error): void {
    const child = this.child;
    this.child = null;
    this.state = { state: 'stopped' };
    this.generation += 1;
    if (child && !child.killed) child.kill('SIGTERM');
    for (const request of this.pending.values()) {
      request.cleanup();
      request.reject(error);
    }
    this.pending.clear();
  }

  private assertInitializeResult(result: SidecarInitializeResult): void {
    if (
      result?.protocol !== TOMNY_SIDECAR_PROTOCOL ||
      result.protocolVersion !== TOMNY_SIDECAR_PROTOCOL_VERSION ||
      typeof result.runtimeVersion !== 'string' ||
      !Array.isArray(result.capabilities)
    ) {
      throw new SidecarProtocolError(
        `Rust sidecar protocol mismatch; desktop requires ${TOMNY_SIDECAR_PROTOCOL} v${String(TOMNY_SIDECAR_PROTOCOL_VERSION)}.`
      );
    }
  }

  private abortError(): Error {
    const error = new Error('Rust sidecar request was cancelled.');
    error.name = 'AbortError';
    return error;
  }
}
