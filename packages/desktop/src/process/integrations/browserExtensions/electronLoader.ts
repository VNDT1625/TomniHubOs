/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The real {@link ExtensionLoaderPort}: loads into the persistent Browser profile session (design 12.1). It is the
 * only place in the host that touches Electron, and Electron is imported lazily so a unit test (or any code that only
 * builds the connection registry) never needs it.
 *
 * `allowFileAccess: false` keeps content scripts away from `file://` pages. The Hub window lives in the default
 * session and so can never receive an extension.
 */

import path from 'node:path';
import {
  createExtensionHostManager,
  type ExtensionHostManager,
  type ExtensionLoaderPort,
} from '@process/integrations/browserExtensions/host';
import { createExtensionStore } from '@process/integrations/browserExtensions/store';
import {
  EXTENSION_PREFS_FILE,
  sharedExtensionUserState,
} from '@process/integrations/browserExtensions/state/userState';

/** Folder under `userData` that holds the working copies (`<packageId>/<connectionId>`). */
export const EXTENSIONS_DIRECTORY = 'tomny-extensions';
/** Kept next to, not inside, the folder above: a package id is free to be called `state.json`. */
export const EXTENSIONS_STATE_FILE = 'tomny-extensions-state.json';

const profileSession = async () =>
  (await import('@process/integrations/browserExtensions/profile')).getBrowserProfileSession();

export const createElectronExtensionLoader = (): ExtensionLoaderPort => {
  return {
    load: async (directory) => {
      const loaded = await (await profileSession()).extensions.loadExtension(directory, { allowFileAccess: false });
      return { id: loaded.id, name: loaded.name, version: loaded.version };
    },
    unload: async (extensionId) => {
      (await profileSession()).extensions.removeExtension(extensionId);
    },
  };
};

/**
 * Builds the manager for this application: working copies under `<userData>/tomny-extensions`, Electron loader. `userData` is
 * read here (not at import) so the app can be ready first.
 */
export const createDefaultExtensionHostManager = async (
  onLoadError: (packageId: string, connectionId: string, reason: string) => void | Promise<void>
): Promise<ExtensionHostManager> => {
  const { app } = await import('electron');
  const workingRoot = path.join(app.getPath('userData'), EXTENSIONS_DIRECTORY);
  const store = createExtensionStore(path.join(app.getPath('userData'), EXTENSIONS_STATE_FILE));
  await store.initialize();
  // The person's pins and site access choices; read once here, the strip and the host share the same copy.
  const userState = await sharedExtensionUserState(path.join(app.getPath('userData'), EXTENSION_PREFS_FILE));
  // Registers the Chrome API shim (preload bundles and IPC handlers) before the first extension is loaded. When its
  // bundles are missing this resolves to undefined and extensions run with Electron's own APIs only.
  const { installDefaultElectronShim } = await import('@process/integrations/browserExtensions/api/electronShim');
  // The Hub services the shim maps onto (tabs, context menus, profile cookies). A missing one only switches off its API.
  const { createDefaultShimPorts } = await import('@process/integrations/browserExtensions/wiring/electronPorts');
  const built = await createDefaultShimPorts((message, error) =>
    console.error(`[BrowserExtensions] ${message}`, error)
  );
  const shim = await installDefaultElectronShim(built === undefined ? {} : { ports: built.ports });
  if (shim === undefined) built?.dispose();
  const manager = createExtensionHostManager({
    loader: createElectronExtensionLoader(),
    store,
    workingRoot,
    onLoadError,
    siteAccessOf: (extensionId, declared) => userState.configOf(extensionId, declared),
    ...(shim === undefined ? {} : { shim: shim.port }),
  });
  return {
    ...manager,
    dispose: async () => {
      await manager.dispose();
      shim?.dispose();
    },
  };
};
