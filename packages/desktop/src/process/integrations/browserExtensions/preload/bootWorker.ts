/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the service-worker preload does (docs/platform/repotopackage-design.md sections 12.3 and 12.8).
 *
 * Electron runs a `type: 'service-worker'` preload in every service worker of the Browser profile session, so it
 * first checks, in the worker's main world, that the script runs at a `chrome-extension://` origin and leaves
 * otherwise. Then it:
 *
 * 1. installs the missing `chrome.*` members (`installShimInWorld`);
 * 2. forwards Main's events to the listeners it collected;
 * 3. asks Main which static `declarativeNetRequest` rulesets of this extension to enable (Electron enables none) and
 *    enables them through the extension's own API.
 *
 * The preload realm has no `chrome` and no `self` (spike S-2), so everything that touches them goes through
 * `executeInMainWorld`. Electron's objects are passed in, so this runs under Node in the unit tests.
 */

import {
  INTERNAL_DNR_PLAN_METHOD,
  SHIM_EVENT_CHANNEL,
  SHIM_EVENT_NAMES,
  SHIM_NAMESPACES,
} from '@/process/integrations/browserExtensions/api/contract';
import {
  applyStaticRulesetsInWorld,
  createCall,
  dispatchEventInWorld,
  installShimInWorld,
  readWorkerOriginInWorld,
  type InvokeRenderer,
} from '@/process/integrations/browserExtensions/preload/bridge';

type WorldScript = { func: (...args: never[]) => unknown; args: unknown[] };

export type WorkerEnvironment = Readonly<{
  ipcRenderer: InvokeRenderer &
    Readonly<{ on: (channel: string, listener: (event: unknown, message: unknown) => void) => unknown }>;
  contextBridge: Readonly<{ executeInMainWorld: (script: WorldScript) => unknown }>;
}>;

const asFunction = (func: unknown): WorldScript['func'] => func as WorldScript['func'];

const isEventMessage = (message: unknown): message is { name: string; payload: unknown; args?: unknown } =>
  typeof message === 'object' &&
  message !== null &&
  typeof (message as { name?: unknown }).name === 'string' &&
  SHIM_EVENT_NAMES.includes((message as { name: string }).name);

/** Resolves with what was done: `skipped` (not an extension worker), `installed`, or `installed+rulesets:<status>`. */
export const bootWorker = async (environment: WorkerEnvironment): Promise<string> => {
  const { contextBridge, ipcRenderer } = environment;
  let origin: unknown;
  try {
    origin = contextBridge.executeInMainWorld({ func: asFunction(readWorkerOriginInWorld), args: [] });
  } catch {
    return 'skipped';
  }
  if (typeof origin !== 'string' || !origin.startsWith('chrome-extension://')) return 'skipped';

  const call = createCall(ipcRenderer);
  try {
    contextBridge.executeInMainWorld({ func: asFunction(installShimInWorld), args: [call, SHIM_NAMESPACES] });
  } catch {
    return 'skipped';
  }
  ipcRenderer.on(SHIM_EVENT_CHANNEL, (_event, message) => {
    if (!isEventMessage(message)) return;
    try {
      contextBridge.executeInMainWorld({
        func: asFunction(dispatchEventInWorld),
        args:
          message.args === undefined ? [message.name, message.payload] : [message.name, message.payload, message.args],
      });
    } catch {
      // A listener that cannot be reached is not worth stopping the worker for.
    }
  });

  const plan = await call(INTERNAL_DNR_PLAN_METHOD, []);
  if (!plan.ok) return 'installed';
  const ids = (plan.value as { enableRulesetIds?: unknown } | null)?.enableRulesetIds;
  if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === 'string')) return 'installed';
  try {
    const status = await contextBridge.executeInMainWorld({
      func: asFunction(applyStaticRulesetsInWorld),
      args: [ids],
    });
    return `installed+rulesets:${typeof status === 'string' ? status : 'unknown'}`;
  } catch {
    return 'installed+rulesets:error';
  }
};
