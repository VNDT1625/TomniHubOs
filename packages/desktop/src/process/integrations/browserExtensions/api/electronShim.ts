/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Connects the shim to Electron (docs/platform/repotopackage-design.md sections 12.3 and 12.8). Everything Electron
 * is reached through small ports, so the behavior that matters runs under Node in the unit tests with fakes.
 *
 * - Two preload bundles are registered on the Browser profile session by absolute path: `type: 'frame'` (it runs in
 *   every frame of the profile, including ordinary web pages, and exits at once outside `chrome-extension:`) and
 *   `type: 'service-worker'`.
 * - A service worker gets its IPC handler synchronously when it reaches `starting` (spike S-2): the handler is
 *   attached before the worker script runs, and only for a worker whose scope is a loaded extension. A web page's
 *   service worker, or an extension the host did not load, never gets a handler.
 * - Identity is read from the event when a call arrives: `event.serviceWorker.scope` for a worker, and
 *   `event.senderFrame.url` for a page, which must also belong to the Browser profile session. A call from the Hub
 *   window (default session) is refused even if its preload were to expose `ipcRenderer`.
 * - The frame preload asks once, synchronously, whether its page is a loaded extension page; the answer is computed
 *   from the sender, and `returnValue` is always set so a throwing handler cannot hang a page.
 */

import path from 'node:path';
import { access } from 'node:fs/promises';
import {
  SHIM_CALL_CHANNEL,
  SHIM_EVENT_CHANNEL,
  SHIM_EVENT_NAMES,
  SHIM_FRAME_SCRIPT_FILE,
  SHIM_FRAME_SCRIPT_ID,
  SHIM_HELLO_CHANNEL,
  SHIM_WORKER_SCRIPT_FILE,
  SHIM_WORKER_SCRIPT_ID,
  type ApiResult,
} from '@process/integrations/browserExtensions/api/contract';
import { extensionIdFromPageUrl, extensionIdFromScope } from '@process/integrations/browserExtensions/api/identity';
import { createDialogPermissionPrompt } from '@process/integrations/browserExtensions/api/groups/permissionPrompt';
import {
  createExtensionShim,
  type ExtensionShim,
  type ExtensionShimDeps,
} from '@process/integrations/browserExtensions/api/shim';

/** The part of `ServiceWorkerMain` the shim uses. */
export type ShimWorkerPort = Readonly<{
  scope: string;
  ipc: Readonly<{
    handle: (
      channel: string,
      listener: (event: Readonly<{ serviceWorker: Readonly<{ scope: string }> }>, ...args: unknown[]) => unknown
    ) => void;
  }>;
  send: (channel: string, ...args: unknown[]) => void;
  isDestroyed?: () => boolean;
}>;

/** The part of the Browser profile `Session` the shim uses. */
export type ShimSessionPort = Readonly<{
  registerPreloadScript: (script: { type: 'frame' | 'service-worker'; filePath: string; id: string }) => unknown;
  serviceWorkers: Readonly<{
    on: (
      event: 'running-status-changed',
      listener: (details: Readonly<{ versionId: number; runningStatus: string }>) => void
    ) => unknown;
    off?: (
      event: 'running-status-changed',
      listener: (details: Readonly<{ versionId: number; runningStatus: string }>) => void
    ) => unknown;
    getWorkerFromVersionID: (versionId: number) => ShimWorkerPort | undefined;
  }>;
}>;

/** What the shim reads from an `ipcMain` event. */
export type ShimFrameEvent = Readonly<{
  sender: Readonly<{ session: unknown }>;
  senderFrame: Readonly<{ url: string }> | null;
}>;

export type ShimIpcMainPort = Readonly<{
  handle: (channel: string, listener: (event: ShimFrameEvent, ...args: unknown[]) => unknown) => void;
  removeHandler: (channel: string) => void;
  on: (
    channel: string,
    listener: (event: ShimFrameEvent & { returnValue: unknown }, ...args: unknown[]) => void
  ) => void;
  removeListener: (
    channel: string,
    listener: (event: ShimFrameEvent & { returnValue: unknown }, ...args: unknown[]) => void
  ) => void;
}>;

export type ElectronShimDeps = Readonly<{
  shim: ExtensionShim;
  /** The Browser profile session; frames from any other session are refused. */
  session: ShimSessionPort;
  ipcMain: ShimIpcMainPort;
  /** Absolute folder that holds the two built preload bundles. */
  preloadDirectory: string;
  fileExists?: (file: string) => Promise<boolean>;
  log?: (message: string, error?: unknown) => void;
}>;

export type ElectronShimHandle = Readonly<{
  /** Worker versions that currently have a handler, for tests. */
  attachedVersions: () => readonly number[];
  dispose: () => void;
}>;

const fileExistsOnDisk = async (file: string): Promise<boolean> => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};

const refused = (message: string): ApiResult => ({ ok: false, code: 'INVALID_CALLER', message });

export const installElectronShim = async (deps: ElectronShimDeps): Promise<ElectronShimHandle> => {
  const log =
    deps.log ?? ((message: string, error?: unknown) => console.error(`[BrowserExtensions] ${message}`, error));
  const exists = deps.fileExists ?? fileExistsOnDisk;
  if (!path.isAbsolute(deps.preloadDirectory))
    throw new Error('The extension preload folder must be an absolute path.');
  const frameFile = path.join(deps.preloadDirectory, SHIM_FRAME_SCRIPT_FILE);
  const workerFile = path.join(deps.preloadDirectory, SHIM_WORKER_SCRIPT_FILE);
  const found = await Promise.all([frameFile, workerFile].map(async (file) => ({ file, present: await exists(file) })));
  const absent = found.find((entry) => !entry.present);
  if (absent) throw new Error(`The extension preload bundle is missing: ${absent.file}`);

  const { shim, session } = deps;
  const attached = new Map<number, { extensionId: string; worker: ShimWorkerPort }>();

  const frameExtensionId = (event: ShimFrameEvent): string | undefined => {
    if (event.sender?.session !== session || event.senderFrame === null) return undefined;
    const id = extensionIdFromPageUrl(event.senderFrame.url);
    return id !== undefined && shim.grants.has(id) ? id : undefined;
  };

  const onFrameCall = (event: ShimFrameEvent, envelope: unknown): Promise<ApiResult> | ApiResult => {
    if (event.sender?.session !== session || event.senderFrame === null) {
      return refused('The caller is not a Tomny browser extension page.');
    }
    return shim.router.handle({ kind: 'frame', url: event.senderFrame.url }, envelope);
  };
  const onHello = (event: ShimFrameEvent & { returnValue: unknown }): void => {
    let known = false;
    try {
      known = frameExtensionId(event) !== undefined;
    } catch {
      known = false;
    }
    // Always set: a synchronous message with no answer would freeze the page that sent it.
    event.returnValue = known;
  };
  deps.ipcMain.handle(SHIM_CALL_CHANNEL, onFrameCall);
  deps.ipcMain.on(SHIM_HELLO_CHANNEL, onHello);

  const onWorkerStatus = (details: Readonly<{ versionId: number; runningStatus: string }>): void => {
    if (details.runningStatus === 'stopped') {
      attached.delete(details.versionId);
      return;
    }
    if (details.runningStatus !== 'starting' || attached.has(details.versionId)) return;
    // Synchronous on purpose: the handler must exist before the worker script runs.
    const worker = session.serviceWorkers.getWorkerFromVersionID(details.versionId);
    if (worker === undefined) return;
    const extensionId = extensionIdFromScope(worker.scope);
    if (extensionId === undefined || !shim.grants.has(extensionId)) return;
    try {
      worker.ipc.handle(SHIM_CALL_CHANNEL, (event, envelope) =>
        shim.router.handle({ kind: 'service-worker', scope: event.serviceWorker.scope }, envelope)
      );
    } catch {
      // The same worker object restarted and still has its handler.
    }
    attached.set(details.versionId, { extensionId, worker });
  };
  session.serviceWorkers.on('running-status-changed', onWorkerStatus);

  const unsubscribeEvents = shim.events.subscribe((event) => {
    if (!SHIM_EVENT_NAMES.includes(event.name)) return;
    for (const entry of attached.values()) {
      if (entry.extensionId !== event.extensionId || entry.worker.isDestroyed?.() === true) continue;
      try {
        entry.worker.send(SHIM_EVENT_CHANNEL, {
          name: event.name,
          payload: event.payload,
          ...(event.args === undefined ? {} : { args: event.args }),
        });
      } catch (error) {
        log(`Could not deliver ${event.name} to a service worker.`, error);
      }
    }
  });

  // Last: a preload must never run while its handler is missing.
  session.registerPreloadScript({ type: 'frame', filePath: frameFile, id: SHIM_FRAME_SCRIPT_ID });
  session.registerPreloadScript({ type: 'service-worker', filePath: workerFile, id: SHIM_WORKER_SCRIPT_ID });

  return {
    attachedVersions: () => [...attached.keys()],
    dispose: () => {
      unsubscribeEvents();
      session.serviceWorkers.off?.('running-status-changed', onWorkerStatus);
      deps.ipcMain.removeHandler(SHIM_CALL_CHANNEL);
      deps.ipcMain.removeListener(SHIM_HELLO_CHANNEL, onHello);
      attached.clear();
    },
  };
};

/** Finds the folder that holds both bundles: dynamically imported main code lands in `out/main/chunks`. */
export const findPreloadDirectory = async (
  candidates: readonly string[],
  fileExists: (file: string) => Promise<boolean> = fileExistsOnDisk
): Promise<string | undefined> => {
  for (const candidate of candidates) {
    // oxlint-disable-next-line no-await-in-loop -- candidates are tried in order and the first hit wins
    const found = await Promise.all(
      [SHIM_FRAME_SCRIPT_FILE, SHIM_WORKER_SCRIPT_FILE].map((file) => fileExists(path.join(candidate, file)))
    );
    if (found.every(Boolean)) return candidate;
  }
  return undefined;
};

/**
 * The real thing: Electron, the Browser profile session and a native question for `permissions.request`. Called once,
 * before the first extension is loaded. Resolves to undefined (and logs why) when the preload bundles are missing; the
 * extensions then run with Electron's own APIs only and no extra privilege.
 */
export const installDefaultElectronShim = async (
  options: Pick<ExtensionShimDeps, 'optionalGrants' | 'audit' | 'log' | 'ports'> = {}
): Promise<ExtensionShim | undefined> => {
  const log =
    options.log ?? ((message: string, error?: unknown) => console.error(`[BrowserExtensions] ${message}`, error));
  try {
    const { dialog, ipcMain } = await import('electron');
    const { getBrowserProfileSession } = await import('@process/integrations/browserExtensions/profile');
    const preloadDirectory = await findPreloadDirectory([
      path.resolve(__dirname, '..', 'preload'),
      path.resolve(__dirname, '..', '..', 'preload'),
    ]);
    if (preloadDirectory === undefined)
      throw new Error('The extension preload bundles were not found next to the main bundle.');
    const shim = createExtensionShim({
      ...options,
      prompt: createDialogPermissionPrompt((box) => dialog.showMessageBox({ ...box, buttons: [...box.buttons] })),
    });
    await installElectronShim({
      shim,
      session: getBrowserProfileSession(),
      ipcMain,
      preloadDirectory,
      log,
    });
    return shim;
  } catch (error) {
    log('The Chrome API shim could not be installed; extensions run without it.', error);
    return undefined;
  }
};
