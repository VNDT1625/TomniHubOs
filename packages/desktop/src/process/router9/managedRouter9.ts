/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, BrowserWindow, safeStorage, shell } from 'electron';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Keep Tomny's owned gateway separate from a user's standalone 9Router
// installation, whose conventional port is 20128.
const DEFAULT_PORT = 20129;
// First boot may initialize SQLite and compile native fallbacks before the
// first auth route responds. Keep polling long enough for that cold path.
const START_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 250;
const MANAGEMENT_TIMEOUT_MS = 10_000;

const STOP_TIMEOUT_MS = 2_000;
const FORCE_STOP_TIMEOUT_MS = 2_000;
const SECRET_FILE = 'model-gateway-secrets.json';
const PREFERENCES_FILE = 'model-gateway-preferences.json';

type ManagedSecrets = {
  dashboardPassword: string;
  jwtSecret: string;
  apiKeySecret: string;
};

type PersistedSecrets = {
  schemaVersion: 1;
  osEncrypted: boolean;
  payload: string;
};

type ManagedRouter9Preferences = {
  schemaVersion: 2;
  autoStart: boolean;
};

export type ManagedRouter9State = 'stopped' | 'starting' | 'running' | 'failed' | 'external';

export type ManagedRouter9Status = {
  state: ManagedRouter9State;
  baseUrl: string;
  dashboardUrl: string;
  port: number;
  owned: boolean;
  runtimeReady: boolean;
  autoStart: boolean;
  upstreamCommit?: string;
  upstreamVersion?: string;
  pid?: number;
  lastError?: string;
};

export type ManagedRouter9Client = {
  id: string;
  name: string;
  key?: string;
  isActive?: boolean;
};

export type ManagedRouter9Provider = {
  id: string;
  provider: string;
  name?: string;
  email?: string;
  isActive?: boolean;
};

export type ManagedRouter9Model = {
  id: string;
  object?: string;
  owned_by?: string;
};

export type ManagedRouter9UsageStats = {
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCachedTokens: number;
  totalCost: number;
  byProvider?: Record<string, unknown>;
  byModel?: Record<string, unknown>;
  byApiKey?: Record<string, ManagedRouter9UsageBucket>;
};

export type ManagedRouter9UsageBucket = {
  requests?: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  cost?: number;
  rawModel?: string;
  provider?: string;
  keyName?: string;
  apiKeyMasked?: string | null;
  lastUsed?: string;
};

export type ManagedRouter9UsageMeasurement = 'provider-reported' | 'gateway-estimated' | 'unknown';

export type ManagedRouter9UsageSession = {
  consumer: string;
  sessionId: string;
  clientTool: string;
  measurement: ManagedRouter9UsageMeasurement;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cost: number;
  providers: string[];
  models: string[];
  lastUsed?: string;
};

export type ManagedRouter9UsageBreakdown = {
  sessions: ManagedRouter9UsageSession[];
};

type RuntimeManifest = {
  upstreamCommit?: string;
  upstreamVersion?: string;
  entry?: string;
};

type ManagedRouter9Deps = {
  resourcesPath: () => string;
  userDataPath: () => string;
  execPath: () => string;
  fetch: typeof fetch;
  newSecret: () => string;
  spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  stopChild: (child: ChildProcess) => Promise<void>;
};

const hasExited = (child: ChildProcess): boolean =>
  child.exitCode !== null && child.exitCode !== undefined
    ? true
    : child.signalCode !== null && child.signalCode !== undefined;

const waitForExit = (child: ChildProcess, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    if (hasExited(child)) {
      resolve(true);
      return;
    }
    const onExit = (): void => {
      clearTimeout(timeoutId);
      resolve(true);
    };
    const timeoutId = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(hasExited(child));
    }, timeoutMs);
    child.once('exit', onExit);
  });

const stopChild = async (child: ChildProcess): Promise<void> => {
  if (hasExited(child)) return;
  const gracefulExit = waitForExit(child, STOP_TIMEOUT_MS);
  try {
    child.kill();
  } catch {
    // Continue to the process-tree fallback below.
  }
  if (await gracefulExit) return;

  const pid = child.pid;
  if (process.platform === 'win32' && pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      let timeoutId: NodeJS.Timeout | undefined;
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        if (timeoutId) clearTimeout(timeoutId);
        resolve();
      };
      killer.once('error', finish);
      killer.once('exit', finish);
      timeoutId = setTimeout(() => {
        try {
          killer.kill();
        } catch {
          // The owned gateway exit probe below remains authoritative.
        }
        finish();
      }, FORCE_STOP_TIMEOUT_MS);
    });
  } else if (pid) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // The final exit probe below decides whether termination succeeded.
      }
    }
  } else {
    try {
      child.kill('SIGKILL');
    } catch {
      // The final exit probe below decides whether termination succeeded.
    }
  }

  if (!(await waitForExit(child, FORCE_STOP_TIMEOUT_MS))) {
    throw new Error(`Model gateway process ${pid ?? 'unknown'} did not terminate.`);
  }
};

const defaultDeps: ManagedRouter9Deps = {
  resourcesPath: () => (app.isPackaged ? process.resourcesPath : path.join(process.cwd(), 'resources')),
  userDataPath: () => app.getPath('userData'),
  execPath: () => process.execPath,
  fetch,
  newSecret: () => randomBytes(32).toString('base64url'),
  spawn: (command, args, options) => spawn(command, args, options),
  stopChild,
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const parseJson = async <T>(response: Response): Promise<T> => {
  const body = (await response.json().catch((): undefined => undefined)) as T | { error?: string } | undefined;
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'error' in body ? body.error : undefined;
    throw new Error(detail || `9Router management request failed with HTTP ${response.status}.`);
  }
  return body as T;
};

/** Lifecycle and management facade for the pinned, bundled 9Router core. */
export class ManagedRouter9Service {
  readonly #deps: ManagedRouter9Deps;
  #child: ChildProcess | undefined;
  #state: ManagedRouter9State = 'stopped';
  #lastError: string | undefined;
  #cookie: string | undefined;
  #dashboardWindow: BrowserWindow | undefined;
  #logTail: string[] = [];
  #startPromise: Promise<ManagedRouter9Status> | undefined;
  #stopPromise: Promise<ManagedRouter9Status> | undefined;
  #shuttingDown = false;

  constructor(deps: Partial<ManagedRouter9Deps> = {}) {
    this.#deps = { ...defaultDeps, ...deps };
  }

  #runtimeDir(): string {
    return path.join(this.#deps.resourcesPath(), 'bundled-model-gateway', `${process.platform}-${process.arch}`);
  }

  #dataDir(): string {
    return path.join(this.#deps.userDataPath(), 'tomni-model-gateway');
  }

  #origin(): string {
    return `http://127.0.0.1:${DEFAULT_PORT}`;
  }

  async #manifest(): Promise<RuntimeManifest | undefined> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.#runtimeDir(), 'manifest.json'), 'utf8')) as RuntimeManifest;
    } catch {
      return undefined;
    }
  }

  async #preferences(): Promise<ManagedRouter9Preferences> {
    try {
      const value = JSON.parse(await fs.readFile(path.join(this.#dataDir(), PREFERENCES_FILE), 'utf8')) as {
        schemaVersion?: unknown;
        autoStart?: unknown;
      };
      if (value.schemaVersion === 2) {
        return { schemaVersion: 2, autoStart: value.autoStart === true };
      }
      if (value.schemaVersion === 1) {
        const migrated: ManagedRouter9Preferences = { schemaVersion: 2, autoStart: false };
        await this.#writePreferences(migrated);
        return migrated;
      }
      return { schemaVersion: 2, autoStart: false };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[ModelGateway] Ignoring invalid preferences:', error);
      }
      return { schemaVersion: 2, autoStart: false };
    }
  }

  async #writePreferences(value: ManagedRouter9Preferences): Promise<void> {
    await fs.mkdir(this.#dataDir(), { recursive: true });
    const destination = path.join(this.#dataDir(), PREFERENCES_FILE);
    const temp = `${destination}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temp, destination);
  }

  async #secrets(): Promise<ManagedSecrets> {
    const secretPath = path.join(this.#dataDir(), SECRET_FILE);
    try {
      const stored = JSON.parse(await fs.readFile(secretPath, 'utf8')) as PersistedSecrets;
      const bytes = Buffer.from(stored.payload, 'base64');
      const clear = stored.osEncrypted ? safeStorage.decryptString(bytes) : bytes.toString('utf8');
      const parsed = JSON.parse(clear) as ManagedSecrets;
      if (parsed.dashboardPassword && parsed.jwtSecret && parsed.apiKeySecret) return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('Tomny model-gateway credentials could not be decrypted safely.', { cause: error });
      }
    }

    const value: ManagedSecrets = {
      dashboardPassword: this.#deps.newSecret(),
      jwtSecret: this.#deps.newSecret(),
      apiKeySecret: this.#deps.newSecret(),
    };
    const clear = JSON.stringify(value);
    let osEncrypted = false;
    let bytes: Uint8Array = Buffer.from(clear, 'utf8');
    try {
      if (safeStorage.isEncryptionAvailable()) {
        bytes = safeStorage.encryptString(clear);
        osEncrypted = true;
      }
    } catch {
      // The file is still mode 0600 when the OS keychain is unavailable.
    }
    await fs.mkdir(this.#dataDir(), { recursive: true });
    const temp = `${secretPath}.${process.pid}.tmp`;
    await fs.writeFile(
      temp,
      `${JSON.stringify({ schemaVersion: 1, osEncrypted, payload: Buffer.from(bytes).toString('base64') }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 }
    );
    await fs.rename(temp, secretPath);
    return value;
  }

  async #probe(): Promise<boolean> {
    try {
      const response = await this.#deps.fetch(`${this.#origin()}/api/auth/status`, {
        signal: AbortSignal.timeout(1_500),
        headers: { 'user-agent': 'Tomny-Model-Gateway/1' },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async status(): Promise<ManagedRouter9Status> {
    const [manifest, preferences] = await Promise.all([this.#manifest(), this.#preferences()]);
    const live = await this.#probe();
    if (live && !this.#child && this.#state !== 'starting') this.#state = 'external';
    if (!live && this.#state === 'external') this.#state = 'stopped';
    if (!live && this.#state === 'running' && !this.#child) this.#state = 'stopped';
    return {
      state: live && this.#child ? 'running' : this.#state,
      baseUrl: `${this.#origin()}/v1`,
      dashboardUrl: this.#origin(),
      port: DEFAULT_PORT,
      owned: Boolean(this.#child),
      runtimeReady: Boolean(manifest),
      autoStart: preferences.autoStart,
      upstreamCommit: manifest?.upstreamCommit,
      upstreamVersion: manifest?.upstreamVersion,
      pid: this.#child?.pid,
      lastError: this.#lastError,
    };
  }

  async setAutoStart(autoStart: boolean): Promise<ManagedRouter9Status> {
    await this.#writePreferences({ schemaVersion: 2, autoStart });
    return this.status();
  }

  async startIfEnabled(): Promise<ManagedRouter9Status> {
    const preferences = await this.#preferences();
    return preferences.autoStart ? this.start() : this.status();
  }

  start(): Promise<ManagedRouter9Status> {
    if (this.#shuttingDown) return Promise.reject(new Error('Model gateway is shutting down.'));
    if (this.#startPromise) return this.#startPromise;
    this.#startPromise = this.#start().finally(() => {
      this.#startPromise = undefined;
    });
    return this.#startPromise;
  }

  async #start(): Promise<ManagedRouter9Status> {
    if (this.#shuttingDown) throw new Error('Model gateway is shutting down.');
    const alreadyRunning = await this.#probe();
    if (this.#shuttingDown) throw new Error('Model gateway is shutting down.');
    if (alreadyRunning) return this.status();
    const manifest = await this.#manifest();
    if (!manifest) {
      throw new Error('Bundled model gateway is missing. Run `bun run prepare:model-gateway`, then restart Tomny.');
    }
    const entry = path.join(this.#runtimeDir(), manifest.entry || 'custom-server.js');
    await fs.access(entry);
    const secrets = await this.#secrets();
    if (this.#shuttingDown) throw new Error('Model gateway is shutting down.');
    this.#state = 'starting';
    this.#lastError = undefined;
    this.#cookie = undefined;
    this.#logTail = [];

    const child = this.#deps.spawn(this.#deps.execPath(), [entry], {
      cwd: this.#runtimeDir(),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        HOSTNAME: '127.0.0.1',
        PORT: String(DEFAULT_PORT),
        DATA_DIR: this.#dataDir(),
        INITIAL_PASSWORD: secrets.dashboardPassword,
        JWT_SECRET: secrets.jwtSecret,
        API_KEY_SECRET: secrets.apiKeySecret,
      },
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    });
    // Keep the owned child referenced so normal Electron shutdown cannot finish
    // before the shared cleanup terminates its detached process group.
    this.#child = child;
    child.once('exit', (code, signal) => {
      if (this.#child !== child) return;
      this.#child = undefined;
      this.#cookie = undefined;
      if (this.#state !== 'stopped') {
        this.#state = 'failed';
        this.#lastError = `Model gateway exited (${signal || code || 'unknown'}). ${this.#logTail.slice(-4).join(' ')}`;
      }
    });

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop -- readiness probes must be sequential.
      const ready = await this.#probe();
      if (this.#shuttingDown) throw new Error('Model gateway is shutting down.');
      if (ready) {
        this.#state = 'running';
        // eslint-disable-next-line no-await-in-loop -- login follows the successful probe.
        await this.#login();
        return this.status();
      }
      if (this.#child !== child) break;
      // eslint-disable-next-line no-await-in-loop -- deliberate polling backoff.
      await sleep(POLL_INTERVAL_MS);
    }
    this.#state = 'failed';
    this.#lastError = `Model gateway did not become ready. ${this.#logTail.slice(-6).join(' ')}`;
    throw new Error(this.#lastError);
  }

  stop(): Promise<ManagedRouter9Status> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopPromise = this.#stop().finally(() => {
      this.#stopPromise = undefined;
    });
    return this.#stopPromise;
  }

  async #stop(): Promise<ManagedRouter9Status> {
    const child = this.#child;
    this.#cookie = undefined;
    this.#dashboardWindow?.close();
    this.#dashboardWindow = undefined;
    this.#state = 'stopped';
    if (child) {
      await this.#deps.stopChild(child);
      if (this.#child === child) this.#child = undefined;
    }
    return this.status();
  }

  async shutdown(): Promise<ManagedRouter9Status> {
    this.#shuttingDown = true;
    const starting = this.#startPromise;
    let firstStopError: unknown;
    try {
      await this.stop();
    } catch (error) {
      firstStopError = error;
    }
    await starting?.catch((): undefined => undefined);
    try {
      return await this.stop();
    } catch (error) {
      const failures = firstStopError === undefined ? [error] : [firstStopError, error];
      // eslint-disable-next-line preserve-caught-error -- AggregateError retains both termination failures.
      throw new AggregateError(failures, 'Failed to stop the owned model gateway process.', { cause: error });
    }
  }

  async #login(): Promise<string> {
    if (this.#cookie) return this.#cookie;
    const secrets = await this.#secrets();
    const response = await this.#deps.fetch(`${this.#origin()}/api/auth/login`, {
      method: 'POST',
      signal: AbortSignal.timeout(MANAGEMENT_TIMEOUT_MS),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: secrets.dashboardPassword }),
    });
    await parseJson<{ success: true }>(response);
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('9Router did not return a dashboard session cookie.');
    this.#cookie = cookie;
    return cookie;
  }

  async #management<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    await this.start();
    const cookie = await this.#login();
    const request = (): Promise<Response> =>
      this.#deps.fetch(`${this.#origin()}${pathname}`, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(MANAGEMENT_TIMEOUT_MS),
        headers: { 'content-type': 'application/json', cookie, ...init.headers },
      });
    let response = await request();
    if (response.status === 401) {
      this.#cookie = undefined;
      const renewed = await this.#login();
      response = await this.#deps.fetch(`${this.#origin()}${pathname}`, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(MANAGEMENT_TIMEOUT_MS),
        headers: { 'content-type': 'application/json', cookie: renewed, ...init.headers },
      });
    }
    return parseJson<T>(response);
  }

  async listClients(): Promise<ManagedRouter9Client[]> {
    const result = await this.#management<{ keys?: ManagedRouter9Client[] }>('/api/keys');
    return Array.isArray(result.keys) ? result.keys : [];
  }

  async issueClient(name: string): Promise<ManagedRouter9Client> {
    const normalized = name.trim();
    if (!normalized) throw new Error('Client name is required.');
    return this.#management<ManagedRouter9Client>('/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name: normalized }),
    });
  }

  async ensureClient(name: string): Promise<ManagedRouter9Client> {
    const existing = (await this.listClients()).find((client) => client.name === name && client.isActive !== false);
    if (existing?.key) return existing;
    return this.issueClient(name);
  }

  async revokeClient(id: string): Promise<void> {
    if (!id.trim()) throw new Error('Client id is required.');
    await this.#management(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  listProviders(): Promise<{ connections?: ManagedRouter9Provider[] }> {
    return this.#management('/api/providers');
  }

  listUsageLogs(): Promise<string[]> {
    return this.#management('/api/usage/request-logs');
  }

  usageStats(): Promise<ManagedRouter9UsageStats> {
    return this.#management('/api/usage/stats');
  }

  usageBreakdown(): Promise<ManagedRouter9UsageBreakdown> {
    return this.#management('/api/usage/tomni-breakdown?period=30d');
  }

  async listModels(clientKey?: string): Promise<ManagedRouter9Model[]> {
    await this.start();
    const response = await this.#deps.fetch(`${this.#origin()}/v1/models`, {
      signal: AbortSignal.timeout(MANAGEMENT_TIMEOUT_MS),
      headers: clientKey ? { authorization: `Bearer ${clientKey}` } : undefined,
    });
    const result = await parseJson<{ data?: ManagedRouter9Model[] }>(response);
    return Array.isArray(result.data) ? result.data : [];
  }

  async openDashboard(section: 'providers' | 'usage' | 'endpoint' = 'providers'): Promise<void> {
    await this.start();
    const cookie = await this.#login();
    const separator = cookie.indexOf('=');
    if (separator <= 0) throw new Error('9Router returned an invalid dashboard session cookie.');
    const name = cookie.slice(0, separator);
    const value = cookie.slice(separator + 1);
    const existing = this.#dashboardWindow;
    const dashboard =
      existing && !existing.isDestroyed()
        ? existing
        : new BrowserWindow({
            width: 1180,
            height: 780,
            minWidth: 900,
            minHeight: 620,
            title: 'Tomny Model Gateway',
            show: false,
            webPreferences: {
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
              partition: 'persist:tomni-model-gateway',
            },
          });
    this.#dashboardWindow = dashboard;
    dashboard.on('closed', (): void => {
      if (this.#dashboardWindow === dashboard) this.#dashboardWindow = undefined;
    });
    dashboard.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });
    await dashboard.webContents.session.cookies.set({
      url: this.#origin(),
      name,
      value,
      httpOnly: true,
      sameSite: 'lax',
    });
    await dashboard.loadURL(`${this.#origin()}/dashboard/${section}`);
    dashboard.show();
    dashboard.focus();
  }
}

let shared: ManagedRouter9Service | undefined;

export const getManagedRouter9Service = (): ManagedRouter9Service => {
  shared ??= new ManagedRouter9Service();
  return shared;
};

export const resetManagedRouter9ServiceForTests = (): void => {
  shared = undefined;
};
