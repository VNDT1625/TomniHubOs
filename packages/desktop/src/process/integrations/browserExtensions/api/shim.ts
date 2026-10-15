/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `chrome.*` shim without Electron (docs/platform/repotopackage-design.md section 12.3): grant registry, router,
 * the API groups and the event bus, behind the {@link ExtensionShimPort} that the extension host drives.
 *
 * Adding an API group means: write its `ApiMethod` list under `groups/`, add it to {@link createExtensionShim}, and
 * (when the preload installs it) add its namespace to `SHIM_NAMESPACES` in `contract.ts`. A unit test compares the
 * preload spec with the router so the two cannot drift.
 */

import { EXTENSION_ID_PATTERN } from '@process/integrations/browserExtensions/api/contract';
import {
  createGrantRegistry,
  grantSeedFromManifest,
  type ExtensionGrantSeed,
} from '@process/integrations/browserExtensions/api/grants';
import {
  defaultSiteAccessConfig,
  effectiveSiteAccess,
  type SiteAccessConfig,
} from '@/common/integrations/extensions/siteAccess';
import type { GrantRegistry, OptionalGrantStore } from '@process/integrations/browserExtensions/api/grants';
import { createActionApi, type ActionStore } from '@process/integrations/browserExtensions/api/groups/ui/action';
import {
  createContextMenusApi,
  type ContextMenusPort,
} from '@process/integrations/browserExtensions/api/groups/browser/contextMenus';
import { createCookiesApi, type CookiesPort } from '@process/integrations/browserExtensions/api/groups/data/cookies';
import {
  createDownloadsApi,
  type DownloadsPort,
} from '@process/integrations/browserExtensions/api/groups/data/downloads';
import {
  createStorageSyncApi,
  type SyncStoragePort,
} from '@process/integrations/browserExtensions/api/groups/data/storageSync';
import { createWindowsApi, type WindowsPort } from '@process/integrations/browserExtensions/api/groups/browser/windows';
import {
  createWebNavigationApi,
  type WebNavigationPort,
} from '@process/integrations/browserExtensions/api/groups/browser/webNavigation';
import {
  createNotificationsApi,
  type NotificationsPort,
} from '@process/integrations/browserExtensions/api/groups/ui/notifications';
import { createCommandsApi, type CommandsPort } from '@process/integrations/browserExtensions/api/groups/ui/commands';
import { createTabsApi, type TabsPort } from '@process/integrations/browserExtensions/api/groups/browser/tabs';
import { createDeclarativeNetRequestApi } from '@process/integrations/browserExtensions/api/groups/declarativeNetRequest';
import {
  createPermissionsApi,
  denyAllPrompt,
  type PermissionPromptPort,
} from '@process/integrations/browserExtensions/api/groups/permissions';
import {
  createApiRouter,
  type ApiAuditEntry,
  type ApiRouter,
} from '@process/integrations/browserExtensions/api/router';
import {
  createExtensionEventBus,
  type ApiGroup,
  type ExtensionEventBus,
  type ExtensionShimPort,
} from '@process/integrations/browserExtensions/api/types';

/** What the Hub offers the groups that need more than the extension's own grants. A group without its port answers UNSUPPORTED. */
export type ShimPorts = Readonly<{
  tabs?: TabsPort;
  contextMenus?: ContextMenusPort;
  cookies?: CookiesPort;
  windows?: WindowsPort;
  webNavigation?: WebNavigationPort;
  notifications?: NotificationsPort;
  downloads?: DownloadsPort;
  /** The local store behind `chrome.storage.sync`. Absent: the sync API answers UNSUPPORTED. */
  syncStorage?: SyncStoragePort;
  commands?: CommandsPort;
}>;

export type ExtensionShimDeps = Readonly<{
  ports?: ShimPorts;
  /** Asks the person for an optional permission. Defaults to refusing. */
  prompt?: PermissionPromptPort;
  /** Keeps optional grants across restarts. Defaults to memory only. */
  optionalGrants?: OptionalGrantStore;
  audit?: (entry: ApiAuditEntry) => void;
  log?: (message: string, error?: unknown) => void;
}>;

export type ExtensionShim = Readonly<{
  port: ExtensionShimPort;
  router: ApiRouter;
  grants: GrantRegistry;
  events: ExtensionEventBus;
  /** Toolbar state of every extension (title, popup, badge) and the way to report a click; T4.5 reads it. */
  action: ActionStore;
  /** Stops listening to the ports. */
  dispose: () => void;
}>;

export const createExtensionShim = (deps: ExtensionShimDeps = {}): ExtensionShim => {
  const log =
    deps.log ?? ((message: string, error?: unknown) => console.error(`[BrowserExtensions] ${message}`, error));
  const grants = createGrantRegistry({
    ...(deps.optionalGrants === undefined ? {} : { store: deps.optionalGrants }),
    log: (message) => log(message),
  });
  const events = createExtensionEventBus();
  const context = { grants, events };
  const ports = deps.ports ?? {};
  const action = createActionApi(context, ports.tabs);
  const groups: readonly ApiGroup[] = [
    { methods: createPermissionsApi({ prompt: deps.prompt ?? denyAllPrompt, events }) },
    { methods: createDeclarativeNetRequestApi() },
    createTabsApi(context, ports.tabs),
    createContextMenusApi(context, ports.contextMenus),
    action,
    createCookiesApi(context, ports.cookies),
    createWindowsApi(context, ports.windows, ports.tabs),
    createWebNavigationApi(context, ports.webNavigation, ports.tabs),
    createNotificationsApi(context, ports.notifications),
    createDownloadsApi(context, ports.downloads),
    createStorageSyncApi(context, ports.syncStorage),
    createCommandsApi(context, ports.commands),
  ];
  const router = createApiRouter({
    grants,
    methods: groups.flatMap((group) => group.methods),
    audit:
      deps.audit ??
      ((entry) => {
        log(
          `API ${entry.method} ${entry.outcome}${entry.code === undefined ? '' : ` (${entry.code})`}`,
          entry.extensionId
        );
      }),
  });

  // Each attached extension keeps its manifest seed and the person's site access. The grants registry is rebuilt from
  // them: a broad host permission is active only under `all-sites`, or for a site the person allowed.
  const attached = new Map<string, Readonly<{ seed: ExtensionGrantSeed; siteAccess: SiteAccessConfig }>>();
  const applySiteAccess = (extensionId: string): void => {
    const entry = attached.get(extensionId);
    if (entry === undefined) return;
    const view = effectiveSiteAccess({
      declared: entry.seed.hostPermissions,
      optional: entry.seed.optionalHostPermissions,
      config: entry.siteAccess,
    });
    grants.register({ ...entry.seed, hostPermissions: view.active });
  };

  const port: ExtensionShimPort = {
    attach: (input) => {
      const { extensionId, packageId, connectionId, manifest } = input;
      if (!EXTENSION_ID_PATTERN.test(extensionId)) throw new Error('The extension id is not well formed.');
      const seed = grantSeedFromManifest({ extensionId, packageId, connectionId }, manifest);
      if (seed === undefined) throw new Error('The extension manifest cannot be used by the Chrome API shim.');
      attached.set(extensionId, {
        seed,
        siteAccess: input.siteAccess ?? defaultSiteAccessConfig(seed.hostPermissions),
      });
      applySiteAccess(extensionId);
    },
    detach: (extensionId) => {
      attached.delete(extensionId);
      grants.unregister(extensionId);
    },
    setSiteAccess: (extensionId, siteAccess) => {
      const entry = attached.get(extensionId);
      if (entry === undefined) return;
      attached.set(extensionId, { ...entry, siteAccess });
      applySiteAccess(extensionId);
    },
  };
  return {
    port,
    router,
    grants,
    events,
    action: action.store,
    dispose: () => {
      for (const group of groups) group.dispose?.();
    },
  };
};
