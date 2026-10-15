/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Code shared by the two preload entries of the `chrome.*` shim (docs/platform/repotopackage-design.md sections 12.3
 * and 12.8).
 *
 * The three `*InWorld` functions are serialized by Electron (`contextBridge.executeInMainWorld` sends
 * `func.toString()`) and run in the page or service worker. They therefore must not reference anything outside their
 * own body: no imports, no helpers from this file, no closure variables. A unit test evaluates their source text in an
 * empty realm to keep that true.
 *
 * Rules the installer follows (spike S-2):
 * - it only fills gaps: a member the browser already provides is never replaced;
 * - the namespace objects it creates carry no secret and no identity: every call goes to Main, which derives the
 *   extension from the sender;
 * - a page's `chrome` may not exist yet when the frame preload runs, so it is created when missing.
 */

import { SHIM_CALL_CHANNEL, type ApiResult } from '@/process/integrations/browserExtensions/api/contract';

/** The part of `ipcRenderer` the call bridge uses. */
export type InvokeRenderer = Readonly<{ invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }>;

/** Sends one call to Main and always resolves with a plain `ApiResult` (an unreachable Main becomes `FAILED`). */
export const createCall =
  (renderer: InvokeRenderer) =>
  async (method: string, args: unknown[]): Promise<ApiResult> => {
    try {
      const result = await renderer.invoke(SHIM_CALL_CHANNEL, { method, args });
      if (typeof result === 'object' && result !== null && typeof (result as { ok?: unknown }).ok === 'boolean') {
        return result as ApiResult;
      }
      return { ok: false, code: 'FAILED', message: 'Unexpected reply from the extension API bridge.' };
    } catch {
      return { ok: false, code: 'FAILED', message: 'The extension API bridge is unavailable.' };
    }
  };

/**
 * Runs in the main world. Adds `chrome.<path>.<method>` (promise and callback styles) and `chrome.<path>.<event>`
 * (`addListener`, `removeListener`, `hasListener`, `hasListeners`) for every namespace in `namespaces`, skipping any
 * member that already exists. Also publishes `globalThis[Symbol.for('tomny.ext.dispatch')](name, payload)`, which the
 * worker preload calls to deliver an event.
 */
export const installShimInWorld = (
  call: (method: string, args: unknown[]) => Promise<{ ok: boolean; value?: unknown; message?: string }>,
  namespaces: readonly {
    path: string;
    methods: readonly string[];
    events: readonly string[];
    replace?: readonly string[];
  }[]
): void => {
  type Bag = Record<string | symbol, unknown>;
  const root = globalThis as unknown as Bag;
  if (typeof root.chrome !== 'object' || root.chrome === null) root.chrome = {};
  const chromeObject = root.chrome as Bag;
  const listeners = new Map<string, Set<(...values: unknown[]) => void>>();

  const setLastError = (message: string): void => {
    try {
      const runtime = chromeObject.runtime as Bag | undefined;
      if (runtime) runtime.lastError = { message };
    } catch {
      // lastError is best effort.
    }
  };
  const clearLastError = (): void => {
    try {
      const runtime = chromeObject.runtime as Bag | undefined;
      if (runtime) runtime.lastError = undefined;
    } catch {
      // lastError is best effort.
    }
  };

  const makeMethod =
    (fullName: string) =>
    (...args: unknown[]): unknown => {
      const last = args.length > 0 ? args[args.length - 1] : undefined;
      const callback = typeof last === 'function' ? (args.pop() as (value?: unknown) => void) : undefined;
      const promise = (async () => {
        const result = await call(fullName, args);
        if (result && result.ok) return result.value;
        throw new Error(
          result && typeof result.message === 'string' ? result.message : 'The extension API call failed.'
        );
      })();
      if (!callback) return promise;
      promise.then(
        (value) => {
          callback(value);
        },
        (error: unknown) => {
          const message = (error as { message?: unknown } | null)?.message;
          setLastError(typeof message === 'string' ? message : 'The extension API call failed.');
          try {
            callback();
          } finally {
            clearLastError();
          }
        }
      );
      return undefined;
    };

  const makeEvent = (fullName: string) => {
    const set = new Set<(...values: unknown[]) => void>();
    listeners.set(fullName, set);
    return {
      addListener: (listener: unknown): void => {
        if (typeof listener === 'function') set.add(listener as (...values: unknown[]) => void);
      },
      removeListener: (listener: unknown): void => {
        set.delete(listener as (...values: unknown[]) => void);
      },
      hasListener: (listener: unknown): boolean => set.has(listener as (...values: unknown[]) => void),
      hasListeners: (): boolean => set.size > 0,
    };
  };

  // The object at a dotted path such as `storage.sync`, created on the way when missing.
  const objectAt = (dotted: string): Bag | undefined => {
    let parent: Bag = chromeObject;
    for (const part of dotted.split('.')) {
      if (typeof parent[part] !== 'object' || parent[part] === null) {
        try {
          parent[part] = {};
        } catch {
          return undefined;
        }
      }
      parent = parent[part] as Bag;
    }
    return parent;
  };

  for (const namespace of namespaces) {
    const target = objectAt(namespace.path);
    if (target === undefined) continue;
    const replaced = namespace.replace ?? [];
    for (const member of namespace.methods) {
      if (typeof target[member] === 'function' && !replaced.includes(member)) continue;
      try {
        target[member] = makeMethod(`${namespace.path}.${member}`);
      } catch {
        // A frozen namespace keeps what it has.
      }
    }
    for (const member of namespace.events) {
      if (target[member] !== undefined && !replaced.includes(member)) continue;
      try {
        target[member] = makeEvent(`${namespace.path}.${member}`);
      } catch {
        // A frozen namespace keeps what it has.
      }
    }
  }

  root[Symbol.for('tomny.ext.dispatch')] = (name: unknown, payload: unknown, args?: unknown): void => {
    const set = typeof name === 'string' ? listeners.get(name) : undefined;
    if (!set) return;
    for (const listener of Array.from(set)) {
      try {
        if (Array.isArray(args)) listener(...args);
        else listener(payload);
      } catch (error) {
        try {
          console.error(error);
        } catch {
          // Nothing to do when the console is gone.
        }
      }
    }
  };
};

/** Runs in the main world of a service worker: hands one event to the listeners the installer collected. */
export const dispatchEventInWorld = (name: string, payload: unknown, args?: unknown): void => {
  const dispatch = (globalThis as unknown as Record<symbol, unknown>)[Symbol.for('tomny.ext.dispatch')];
  if (typeof dispatch === 'function') (dispatch as (n: string, p: unknown, a?: unknown) => void)(name, payload, args);
};

/** Runs in the main world of a service worker: the origin the worker script runs at, for the guard in the preload. */
export const readWorkerOriginInWorld = (): string => {
  const location = (globalThis as unknown as { location?: { protocol?: string; hostname?: string } }).location;
  return location ? `${location.protocol ?? ''}//${location.hostname ?? ''}` : '';
};

/**
 * Runs in the main world of a service worker: switches on the given static rulesets of this extension, unless some are
 * already on. `chrome.declarativeNetRequest` can be missing for a moment at `starting`, so it waits briefly. Resolves
 * with a short status for the log; it never rejects.
 */
export const applyStaticRulesetsInWorld = async (enableRulesetIds: readonly string[]): Promise<string> => {
  const root = globalThis as unknown as {
    chrome?: {
      declarativeNetRequest?: {
        getEnabledRulesets?: () => Promise<string[]>;
        updateEnabledRulesets?: (options: { enableRulesetIds: string[] }) => Promise<void>;
      };
    };
  };
  const api = () => root.chrome?.declarativeNetRequest;
  try {
    for (let attempt = 0; attempt < 20 && !(api()?.updateEnabledRulesets && api()?.getEnabledRulesets); attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- polling for the API to appear
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });
    }
    const dnr = api();
    if (!dnr || !dnr.updateEnabledRulesets || !dnr.getEnabledRulesets) return 'unavailable';
    if (enableRulesetIds.length === 0) return 'nothing-to-enable';
    const already = await dnr.getEnabledRulesets();
    if (already.length > 0) return 'already-enabled';
    await dnr.updateEnabledRulesets({ enableRulesetIds: [...enableRulesetIds] });
    return 'enabled';
  } catch (error) {
    const message = (error as { message?: unknown } | null)?.message;
    return `error: ${typeof message === 'string' ? message : 'unknown'}`;
  }
};
