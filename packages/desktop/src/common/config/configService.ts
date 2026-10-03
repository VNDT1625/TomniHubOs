import type { ConfigKey, ConfigKeyMap } from './configKeys';
import { getBaseUrl } from '../adapter/httpBridge';
import { systemSettings } from '../adapter/ipcBridge';

type Subscriber = (value: unknown) => void;

function hasNativeIpc(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as unknown as { electronAPI?: unknown }).electronAPI);
}

function configValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

async function fetchJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`ConfigService ${method} ${path} failed (${response.status}): ${errorBody}`);
  }
  const contentType = response.headers.get('Content-Type');
  if (!contentType?.includes('application/json')) {
    return undefined as T;
  }
  const json = await response.json();
  if (json && typeof json === 'object' && 'data' in json) {
    return json.data as T;
  }
  return json as T;
}

class ConfigServiceImpl {
  private cache = new Map<string, unknown>();
  private subscribers = new Map<string, Set<Subscriber>>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // Idempotent: concurrent callers share the same in-flight promise, and a
  // resolved init returns immediately. Modules that need persisted settings on
  // module load (theme/colorScheme/language) await whenReady() before reading.
  initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      if (hasNativeIpc()) {
        try {
          const data = await systemSettings.getClientConfig.invoke();
          this.cache.clear();
          if (data && typeof data === 'object') {
            for (const [key, value] of Object.entries(data)) {
              this.cache.set(key, value);
            }
          }
          this.initialized = true;
          return;
        } catch (error) {
          console.warn('[ConfigService] Native IPC initialize failed, falling back to HTTP:', error);
        }
      }
      const data = await fetchJson<Record<string, unknown>>('GET', '/api/settings/client');
      this.cache.clear();
      if (data) {
        for (const [key, value] of Object.entries(data)) {
          this.cache.set(key, value);
        }
      }
      this.initialized = true;
    })();
    this.initPromise.catch(() => {
      // Allow a future caller to retry after a transient failure
      this.initPromise = null;
    });
    return this.initPromise;
  }

  whenReady(): Promise<void> {
    return this.initialize();
  }

  get<K extends ConfigKey>(key: K): ConfigKeyMap[K] | undefined {
    return this.cache.get(key) as ConfigKeyMap[K] | undefined;
  }

  async refresh<K extends ConfigKey>(key: K): Promise<ConfigKeyMap[K] | undefined> {
    let nextValue: ConfigKeyMap[K] | undefined;
    if (hasNativeIpc()) {
      try {
        const data = await systemSettings.getClientConfig.invoke();
        nextValue = data?.[key] as ConfigKeyMap[K] | undefined;
      } catch (error) {
        console.warn('[ConfigService] Native IPC refresh failed, falling back to HTTP:', error);
        const data = await fetchJson<Record<string, unknown>>('GET', '/api/settings/client');
        nextValue = data?.[key] as ConfigKeyMap[K] | undefined;
      }
    } else {
      const data = await fetchJson<Record<string, unknown>>('GET', '/api/settings/client');
      nextValue = data?.[key] as ConfigKeyMap[K] | undefined;
    }
    const previousValue = this.get(key);

    if (!configValuesEqual(previousValue, nextValue)) {
      if (nextValue === undefined) {
        this.cache.delete(key);
      } else {
        this.cache.set(key, nextValue);
      }
      this.notify(key, nextValue);
    }

    return nextValue;
  }

  async set<K extends ConfigKey>(key: K, value: ConfigKeyMap[K]): Promise<void> {
    this.cache.set(key, value);
    this.notify(key, value);
    if (hasNativeIpc()) {
      try {
        await systemSettings.setClientConfig.invoke({ key, value });
        return;
      } catch (error) {
        console.warn('[ConfigService] Native IPC set failed, falling back to HTTP:', error);
      }
    }
    await fetchJson<void>('PUT', '/api/settings/client', { [key]: value });
  }

  setLocal<K extends ConfigKey>(key: K, value: ConfigKeyMap[K]): void {
    this.cache.set(key, value);
    this.notify(key, value);
  }

  async remove(key: ConfigKey): Promise<void> {
    this.cache.delete(key);
    this.notify(key, undefined);
    if (hasNativeIpc()) {
      try {
        await systemSettings.removeClientConfig.invoke({ key });
        return;
      } catch (error) {
        console.warn('[ConfigService] Native IPC remove failed, falling back to HTTP:', error);
      }
    }
    await fetchJson<void>('PUT', '/api/settings/client', { [key]: null });
  }

  async setBatch(entries: Partial<{ [K in ConfigKey]: ConfigKeyMap[K] }>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) {
      this.cache.set(key, value);
      this.notify(key as ConfigKey, value);
    }
    if (hasNativeIpc()) {
      try {
        await systemSettings.setBatchClientConfig.invoke({ entries: entries as Record<string, unknown> });
        return;
      } catch (error) {
        console.warn('[ConfigService] Native IPC setBatch failed, falling back to HTTP:', error);
      }
    }
    await fetchJson<void>('PUT', '/api/settings/client', entries);
  }

  subscribe(key: ConfigKey, callback: Subscriber): () => void {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key)!.add(callback);
    return () => {
      this.subscribers.get(key)?.delete(callback);
    };
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  reset(): void {
    this.cache.clear();
    this.subscribers.clear();
    this.initialized = false;
    this.initPromise = null;
  }

  private notify(key: ConfigKey, value: unknown): void {
    const subs = this.subscribers.get(key);
    if (subs) {
      for (const cb of subs) {
        cb(value);
      }
    }
  }
}

export const configService = new ConfigServiceImpl();
