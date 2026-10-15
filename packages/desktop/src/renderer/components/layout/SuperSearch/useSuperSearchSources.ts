/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import type { PackageListing } from '@/common/packages';
import { HUB_APPS } from '@/renderer/pages/guid/HubHome/catalog';
import { getRunnablePackageModules } from '@/renderer/pages/hub/PackageAppHost';
import { packageClient } from '@/renderer/pages/hub/packageClient';
import type { SuperSearchConfig } from './engine/config';
import type { SearchProvider } from './engine/types';
import {
  createConnectedProvider,
  discoverSearchTools,
  type ConnectedInvoker,
  type ConnectedServerInfo,
} from './providers/connectedProvider';
import { buildAppEntries, createAppsProvider } from './providers/appsProvider';
import { buildLocalEntries } from './providers/localCorpus';
import { createLocalProvider } from './providers/localProvider';
import {
  createCustomProvider,
  createEngineProvider,
  createWebProvider,
  WEB_ENGINES,
  type WebLabels,
} from './providers/webSources';
import type { SuperSearchMode } from './useSuperSearch';

const aliasFromName = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 8);
  return slug.length > 0 ? slug : 'mcp';
};

export type UseSuperSearchSourcesOptions = {
  mode: SuperSearchMode;
  config: SuperSearchConfig;
  /** Live data (conversations, connected servers) is loaded each time the panel becomes active. */
  active: boolean;
  /** Host-supplied executor for connected search tools. Absent = connected sources report "unavailable". */
  invokeConnected?: ConnectedInvoker;
};

/**
 * Builds the provider list for the current mode. In the Browser app only the general search engines
 * are offered; elsewhere the in-app, web, per-site and connected sources are.
 */
export const useSuperSearchSources = ({
  mode,
  config,
  active,
  invokeConnected,
}: UseSuperSearchSourcesOptions): SearchProvider[] => {
  const { t } = useTranslation();
  const [conversations, setConversations] = useState<TChatConversation[]>([]);
  const [servers, setServers] = useState<ConnectedServerInfo[]>([]);
  const [listings, setListings] = useState<PackageListing[]>([]);

  useEffect(() => {
    if (!active || mode !== 'hub') return undefined;
    let cancelled = false;
    void ipcBridge.database.getUserConversations
      .invoke({ limit: 100 })
      .then((res: { items?: TChatConversation[] }) => {
        if (!cancelled && res?.items) setConversations(res.items);
      })
      .catch(() => {});
    void ipcBridge.mcpService.listServers
      .invoke()
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setServers(list);
      })
      .catch(() => {});
    // The same package listing feeds the Store and the shell launcher; a failure just leaves built-in apps.
    void Promise.resolve()
      .then(() => packageClient.list())
      .then((items) => {
        if (!cancelled && Array.isArray(items)) setListings(items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, mode]);

  return useMemo(() => {
    const labels: WebLabels = {
      webLabel: t('common.superSearch.source.web'),
      searchWith: (engine, query) => t('common.superSearch.web.searchWith', { engine, query }),
      openSite: (site) => t('common.superSearch.web.openSite', { site }),
    };
    if (mode === 'browser') {
      return WEB_ENGINES.filter((engine) => engine.isSearchEngine).map((engine) =>
        createEngineProvider(engine, labels)
      );
    }
    const translate = (key: string): string => t(key);
    return [
      createLocalProvider(t('common.superSearch.source.local'), () =>
        buildLocalEntries({ t: translate, conversations })
      ),
      createAppsProvider(t('common.superSearch.source.apps'), () =>
        buildAppEntries({
          builtIns: HUB_APPS.map((app) => ({
            id: app.id,
            packageId: app.packageId,
            moduleId: app.moduleId,
            category: app.category,
            path: app.path,
            title: t(app.labelKey),
            description: t(app.descriptionKey),
          })),
          listings,
          runnableModulesOf: getRunnablePackageModules,
        })
      ),
      createWebProvider(labels, config.browserEngine),
      ...WEB_ENGINES.map((engine) => createEngineProvider(engine, labels)),
      ...config.custom.map((definition) => createCustomProvider(definition, labels)),
      ...discoverSearchTools(servers).map((tool) =>
        createConnectedProvider(tool, invokeConnected, aliasFromName(tool.serverName))
      ),
    ];
  }, [t, mode, conversations, servers, listings, config.browserEngine, config.custom, invokeConnected]);
};
