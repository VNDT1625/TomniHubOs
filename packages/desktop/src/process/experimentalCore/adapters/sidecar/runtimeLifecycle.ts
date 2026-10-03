/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  RustSidecarClient,
  SidecarUnavailableError,
  isSidecarFallbackEligible,
  type RustSidecarClientConfig,
} from './rustSidecarClient';
import {
  isRustSidecarEnabled,
  resolveRustSidecarExecutable,
  rustSidecarFallbackMode,
  type RustSidecarFallbackMode,
  type RustSidecarResolverOptions,
} from './runtimeResolver';
import type { SidecarFallbackResult, SidecarRequestOptions } from './types';

export type RustSidecarHealth = {
  status: 'pass' | 'warning' | 'error';
  summary: string;
  runtimeVersion?: string;
};

export type RustSidecarLifecycleOptions = RustSidecarResolverOptions & {
  clientVersion: string;
  fallbackMode?: RustSidecarFallbackMode;
  requestTimeoutMs?: number;
  startupTimeoutMs?: number;
};

export type RustSidecarLifecycleDeps = {
  resolveExecutable?: typeof resolveRustSidecarExecutable;
  createClient?: (config: RustSidecarClientConfig) => RustSidecarClient;
};

/** Owns exactly one Rust runtime process for the Electron Main-process lifetime. */
export class RustSidecarLifecycle {
  private client: RustSidecarClient | null = null;
  private initializePromise: Promise<RustSidecarClient | null> | null = null;
  private stopped = false;
  private readonly fallbackMode: RustSidecarFallbackMode;
  private readonly resolveExecutable: typeof resolveRustSidecarExecutable;
  private readonly createClient: (config: RustSidecarClientConfig) => RustSidecarClient;

  constructor(
    private readonly options: RustSidecarLifecycleOptions,
    deps: RustSidecarLifecycleDeps = {}
  ) {
    this.fallbackMode = options.fallbackMode ?? rustSidecarFallbackMode(options.env);
    this.resolveExecutable = deps.resolveExecutable ?? resolveRustSidecarExecutable;
    this.createClient = deps.createClient ?? ((config) => new RustSidecarClient(config));
  }

  async start(): Promise<boolean> {
    // Account-scoped execution may suspend the shared process on sign-out. A
    // subsequent verified session is allowed to start the same lifecycle again.
    this.stopped = false;
    return (await this.getOrStartClient()) !== null;
  }

  async request<T>(method: string, params?: unknown, options: SidecarRequestOptions = {}): Promise<T> {
    const client = await this.getOrStartClient();
    if (!client) throw new SidecarUnavailableError('Bundled Rust sidecar is unavailable.');
    return client.request<T>(method, params, options);
  }

  /** Every accelerated call must provide its TypeScript implementation explicitly. */
  async requestWithFallback<T>(
    method: string,
    params: unknown,
    fallback: (cause: Error) => Promise<T>,
    options: SidecarRequestOptions = {}
  ): Promise<SidecarFallbackResult<T>> {
    try {
      return { source: 'rust', value: await this.request<T>(method, params, options) };
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      if (this.fallbackMode === 'disabled' || !isSidecarFallbackEligible(cause)) throw cause;
      return { source: 'typescript', value: await fallback(cause), cause };
    }
  }

  async health(): Promise<RustSidecarHealth> {
    if (!isRustSidecarEnabled(this.options.env)) {
      return { status: 'warning', summary: 'Rust runtime acceleration is disabled by configuration.' };
    }
    try {
      const client = await this.getOrStartClient();
      if (!client) {
        return {
          status: this.fallbackMode === 'typescript' ? 'warning' : 'error',
          summary:
            this.fallbackMode === 'typescript'
              ? 'Rust runtime is not bundled; explicit TypeScript fallbacks remain active.'
              : 'Rust runtime is not bundled and TypeScript fallback is disabled.',
        };
      }
      await client.request('health.check', undefined, { timeoutMs: 2_000 });
      const runtime = client.getStatus();
      return {
        status: 'pass',
        summary: 'Rust runtime sidecar is healthy.',
        runtimeVersion: runtime.state === 'ready' ? runtime.runtime.runtimeVersion : undefined,
      };
    } catch {
      return {
        status: this.fallbackMode === 'typescript' ? 'warning' : 'error',
        summary:
          this.fallbackMode === 'typescript'
            ? 'Rust runtime health check failed; explicit TypeScript fallbacks remain active.'
            : 'Rust runtime health check failed and TypeScript fallback is disabled.',
      };
    }
  }

  async stop(): Promise<void> {
    // This is a reversible suspension for the Main-owned singleton. The app
    // disposal path also clears the singleton, while an account re-login calls
    // start() to create a fresh client when needed.
    this.stopped = true;
    const client = this.client;
    this.client = null;
    this.initializePromise = null;
    await client?.stop();
  }

  private async getOrStartClient(): Promise<RustSidecarClient | null> {
    if (this.stopped) throw new SidecarUnavailableError('Rust sidecar lifecycle is stopped.');
    if (this.client?.getStatus().state === 'ready') return this.client;
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = this.resolveAndStart();
    try {
      return await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  private async resolveAndStart(): Promise<RustSidecarClient | null> {
    if (!isRustSidecarEnabled(this.options.env)) return null;
    if (!this.client) {
      const resolved = await this.resolveExecutable(this.options);
      if (!resolved) return null;
      this.client = this.createClient({
        command: resolved.command,
        clientVersion: this.options.clientVersion,
        requestTimeoutMs: this.options.requestTimeoutMs,
        startupTimeoutMs: this.options.startupTimeoutMs,
        restartPolicy: 'on-demand',
      });
    }
    await this.client.start();
    return this.client;
  }
}

let mainLifecycle: RustSidecarLifecycle | undefined;

export const getMainRustSidecarLifecycle = (
  options: RustSidecarLifecycleOptions,
  deps: RustSidecarLifecycleDeps = {}
): RustSidecarLifecycle => {
  mainLifecycle ??= new RustSidecarLifecycle(options, deps);
  return mainLifecycle;
};

export const disposeMainRustSidecarLifecycle = async (): Promise<void> => {
  const lifecycle = mainLifecycle;
  mainLifecycle = undefined;
  await lifecycle?.stop();
};
