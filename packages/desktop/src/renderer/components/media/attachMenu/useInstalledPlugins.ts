/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import {
  installedPluginsOf,
  pluginEnableOutcome,
  type InstalledPlugin,
  type PluginEnableOutcome,
} from './attachMenuModel';

/**
 * Every MCP connection of every installed package, on or off: the Plugin column lists them all, so a plugin that is off can
 * be picked and turned on. Reads the connection state through the package connections bridge; fails closed to an empty list.
 */
export const loadInstalledPlugins = async (): Promise<InstalledPlugin[]> => {
  const api = window.electronAPI?.packageConnections;
  if (!api) return [];
  let rows: Awaited<ReturnType<typeof ipcBridge.packagePlatform.list.invoke>>;
  try {
    rows = await ipcBridge.packagePlatform.list.invoke(undefined);
  } catch {
    return [];
  }
  const lists = await Promise.all(
    rows
      .filter((row) => row.state === 'installed')
      .map(async (row) => {
        try {
          const result = await api.list({ packageId: row.manifest.id });
          return result.ok === true ? installedPluginsOf(row.manifest.id, result.data) : [];
        } catch {
          return [];
        }
      })
  );
  return lists.flat();
};

/**
 * The installed plugins for the attach menu. Refreshes when packages change (the same event the rest of the Hub listens
 * to), so a plugin turned on in the menu or in Settings shows its new state.
 */
export const useInstalledPlugins = (): InstalledPlugin[] => {
  const { data, mutate } = useSWR('attach-menu-installed-plugins', loadInstalledPlugins);
  useEffect(() => {
    const refresh = () => {
      void mutate();
    };
    window.addEventListener('tomni-packages-changed', refresh);
    return () => window.removeEventListener('tomni-packages-changed', refresh);
  }, [mutate]);
  return data ?? [];
};

/** What asking the package switch to turn a picked plugin on produced: an outcome, or the bridge was unavailable. */
export type PluginEnableRequest = PluginEnableOutcome | { kind: 'unavailable' };

/**
 * Turns a picked plugin's package on through the package switch, which shows its own approval. Notifies the Hub after the
 * attempt so every menu and the Hub reload their catalogs.
 */
export const requestPluginEnable = async (packageId: string): Promise<PluginEnableRequest> => {
  const api = window.electronAPI?.packageConnections;
  if (!api) return { kind: 'unavailable' };
  try {
    return pluginEnableOutcome(await api.setPackageEnabled({ packageId, enabled: true }));
  } catch {
    return { kind: 'unavailable' };
  } finally {
    window.dispatchEvent(new Event('tomni-packages-changed'));
  }
};

/**
 * The pick action for an off plugin, shared by the Home "..." menu and the chat "+" menu. One switch runs at a time, and both
 * menus report the outcome with the same messages.
 */
export const useEnableInstalledPlugin = (): ((packageId: string) => Promise<void>) => {
  const { t } = useTranslation();
  const [enablingPackage, setEnablingPackage] = useState<string>();
  return async (packageId: string): Promise<void> => {
    if (enablingPackage !== undefined) return;
    setEnablingPackage(packageId);
    try {
      const outcome = await requestPluginEnable(packageId);
      if (outcome.kind === 'failed') Message.error(t('guid.hubHome.connections.failed', { code: outcome.code }));
      else if (outcome.kind === 'stayed-off') Message.warning(outcome.reason);
      else if (outcome.kind === 'unavailable') Message.error(t('guid.hubHome.connections.unavailable'));
    } finally {
      setEnablingPackage(undefined);
    }
  };
};
