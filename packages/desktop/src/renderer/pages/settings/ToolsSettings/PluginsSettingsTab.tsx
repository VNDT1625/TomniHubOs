/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { mcpService } from '@/common/adapter/ipcBridge';
import type { IMcpServer } from '@/common/config/storage';
import type { PackageListing } from '@/common/packages';
import type { PackageConnectionView } from '@/common/types/platform/packageConnections';
import { Input, Message, Modal } from '@arco-design/web-react';
import ToolsModalContent from '@/renderer/components/settings/SettingsModal/contents/ToolsModalContent';
import SkillDocumentModal from '@/renderer/components/skills/SkillDocumentModal';
import { isPackageListingInstalled } from '@/renderer/pages/hub/installedPackageApps';
import { packageClient } from '@/renderer/pages/hub/packageClient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMcpServers } from '@/renderer/hooks/mcp';
import { packageOwnerOfMcpServer } from '@process/resources/mcpRegistry/packageMcpSync';
import ExternalMcpGatewaySettings from './ExternalMcpGatewaySettings';
import {
  CapabilityKindExplainer,
  HubPluginCard,
  HubServerRow,
  matchesHubFilter,
  matchesHubQuery,
  type HubFilter,
  type HubPluginSkill,
  type HubTab,
} from './CapabilityKindUi';

/** The skill fields the hub reads from the skill listing. */
type HubSkill = { name: string; description?: string; source?: string; packageId?: string };

/** Which hub tabs exist, in display order, with their labels key. */
const HUB_TABS: readonly HubTab[] = ['available', 'installed', 'custom'];

/** The on/off chips, in display order. */
const HUB_FILTERS: readonly HubFilter[] = ['all', 'on', 'off'];

type PluginsSettingsTabProps = {
  /** Opens and scrolls to the external-apps section (legacy ?tab=mcp-gateway links). */
  openExternal?: boolean;
};

/**
 * Settings, Customize, Plugin: one plugin hub card with three tabs. "Available" lists the built-in Tomny servers,
 * "Installed" lists installed plugins as cluster cards (their MCP servers, skills and hooks are counted there and
 * nowhere else), and "Custom" lists the user's own MCP servers that belong to no plugin. The outbound gateway for
 * external apps sits in a collapsed section below, because it is a different direction (other apps use Tomny).
 */
const PluginsSettingsTab: React.FC<PluginsSettingsTabProps> = ({ openExternal = false }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<HubTab>('available');
  const [filter, setFilter] = useState<HubFilter>('all');
  const [query, setQuery] = useState('');
  /** Id of the server, or `pkg:<id>` of the plugin, whose switch is being saved. */
  const [pendingKey, setPendingKey] = useState<string | undefined>(undefined);
  const [expandedId, setExpandedId] = useState<string | undefined>(undefined);
  const [viewing, setViewing] = useState<{ name: string; packageId: string } | undefined>(undefined);
  const [revision, setRevision] = useState(0);
  const [packages, setPackages] = useState<PackageListing[]>([]);
  const [connectionsByPackage, setConnectionsByPackage] = useState<Record<string, PackageConnectionView[]>>({});
  const [skills, setSkills] = useState<HubSkill[]>([]);
  const [externalOpen, setExternalOpen] = useState(openExternal);
  const externalRef = useRef<HTMLDetailsElement>(null);
  const { mcpServers, saveMcpServers } = useMcpServers();

  /** Flips one MCP server (built-in or the user's own). The Main registry persists it; the cache mirrors the result. */
  const toggleServer = useCallback(
    async (server: IMcpServer) => {
      setPendingKey(server.id);
      try {
        const updated = await mcpService.toggleServer.invoke({ id: server.id });
        await saveMcpServers((prev) => prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
      } catch (error) {
        console.error('[PluginsSettingsTab] Failed to toggle MCP server:', error);
        Message.error(t('settings.mcpSyncError'));
      } finally {
        setPendingKey(undefined);
      }
    },
    [saveMcpServers, t]
  );

  /** Installed packages, their connections (for the counts and switches) and the skill listing, loaded together. */
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const items = await packageClient.list({ installedOnly: true }).catch((): PackageListing[] => []);
      const installed = items.filter((item) => isPackageListingInstalled(item));
      const [entries, listed] = await Promise.all([
        Promise.all(
          installed.map(async (item) => {
            const packageId = (item.installedManifest ?? item.manifest).id;
            const response = await window.electronAPI?.packageConnections?.list({ packageId }).catch((): undefined => undefined);
            return [packageId, response?.ok === true ? response.data : []] as const;
          })
        ),
        ipcBridge.fs.listAvailableSkills.invoke().catch((): HubSkill[] => []),
      ]);
      if (cancelled) return;
      setPackages(installed);
      setConnectionsByPackage(Object.fromEntries(entries));
      setSkills(listed);
    };
    void load().catch(() => {
      if (!cancelled) {
        setPackages([]);
        setConnectionsByPackage({});
        setSkills([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [revision]);

  // A package connected or removed by the main process (for example from /repotopackage in chat) is listed as it is now.
  useEffect(() => {
    const onChanged = (): void => setRevision((value) => value + 1);
    window.addEventListener('tomni-packages-changed', onChanged);
    return () => window.removeEventListener('tomni-packages-changed', onChanged);
  }, []);

  useEffect(() => {
    if (!openExternal) return;
    setExternalOpen(true);
    externalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [openExternal]);

  const connectionsOf = (packageId: string): PackageConnectionView[] => connectionsByPackage[packageId] ?? [];
  const pluginEnabled = (packageId: string): boolean => connectionsOf(packageId).some((item) => item.enabled);

  /** The whole-plugin switch: the same package master switch the Store page uses. */
  const setPluginEnabled = async (packageId: string, enabled: boolean): Promise<void> => {
    const api = window.electronAPI?.packageConnections;
    if (!api) return;
    setPendingKey(`pkg:${packageId}`);
    try {
      const result = await api.setPackageEnabled({ packageId, enabled });
      if (result.ok === false) {
        Message.error(t('guid.hubHome.connections.failed', { code: result.error }));
      } else if (enabled && result.data.stayedOff.length > 0) {
        Message.info(t('guid.hubHome.connections.stayedOff', { count: result.data.stayedOff.length }));
      }
    } catch {
      Message.error(t('guid.hubHome.connections.unavailable'));
    } finally {
      setPendingKey(undefined);
      setRevision((value) => value + 1);
    }
  };

  /** The start-again switch: the start-again choice of each code-running connection, through the same bridge. */
  const setPluginAutoStart = async (packageId: string, autoStart: boolean): Promise<void> => {
    const api = window.electronAPI?.packageConnections;
    if (!api) return;
    const codeItems = connectionsOf(packageId).filter((item) => item.runsCode === true);
    setPendingKey(`pkg:${packageId}`);
    try {
      const results = await Promise.all(
        codeItems.map((item) => api.setAutoStart({ packageId, connectionKey: item.key, autoStart }))
      );
      const failed = results.find((result) => result.ok === false);
      if (failed && failed.ok === false) Message.error(t('guid.hubHome.connections.failed', { code: failed.error }));
    } catch {
      Message.error(t('guid.hubHome.connections.unavailable'));
    } finally {
      setPendingKey(undefined);
      setRevision((value) => value + 1);
    }
  };

  /** Removes a plugin after the person confirms. Main does the removal; the hub then reloads. */
  const removePlugin = (packageId: string, name: string): void => {
    Modal.confirm({
      title: t('settings.capabilitiesTab.removeConfirmTitle'),
      content: t('settings.capabilitiesTab.removeConfirmContent', { name }),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        try {
          await packageClient.uninstall(packageId);
          setExpandedId((current) => (current === packageId ? undefined : current));
          window.dispatchEvent(new CustomEvent('tomni-packages-changed'));
        } catch (error) {
          Message.error(error instanceof Error ? error.message : String(error));
          setRevision((value) => value + 1);
        }
      },
    });
  };

  const builtinServers = mcpServers.filter((server) => server.builtin === true);
  const customServers = mcpServers.filter(
    (server) => server.builtin !== true && packageOwnerOfMcpServer(server) === undefined
  );
  const visibleBuiltins = builtinServers.filter(
    (server) => matchesHubQuery(query, [server.name, server.description]) && matchesHubFilter(server.enabled, filter)
  );
  const visibleCustom = customServers.filter(
    (server) => matchesHubQuery(query, [server.name, server.description]) && matchesHubFilter(server.enabled, filter)
  );
  const visiblePackages = packages.filter((item) => {
    const manifest = item.installedManifest ?? item.manifest;
    return (
      matchesHubQuery(query, [manifest.name, manifest.description]) &&
      matchesHubFilter(pluginEnabled(manifest.id), filter)
    );
  });
  const packageName = (packageId: string): string => {
    const match = packages.find((item) => (item.installedManifest ?? item.manifest).id === packageId);
    return match ? (match.installedManifest ?? match.manifest).name : packageId;
  };

  const tabLabels: Record<HubTab, string> = {
    available: t('settings.capabilitiesTab.hubTabAvailable'),
    installed: t('settings.capabilitiesTab.hubTabInstalled'),
    custom: t('settings.capabilitiesTab.hubTabCustom'),
  };
  const tabCounts: Record<HubTab, number> = {
    available: builtinServers.length,
    installed: packages.length,
    custom: customServers.length,
  };

  const renderAvailable = (): React.ReactNode => {
    if (builtinServers.length === 0)
      return <div className='capability-empty'>{t('settings.capabilitiesTab.builtinEmpty')}</div>;
    if (visibleBuiltins.length === 0)
      return <div className='capability-empty'>{t('settings.capabilitiesTab.hubNoMatch')}</div>;
    return (
      <ul className='plugin-hub-list' data-testid='hub-available-list'>
        {visibleBuiltins.map((server) => (
          <HubServerRow
            key={server.id}
            server={server}
            testPrefix='builtin'
            pending={pendingKey === server.id}
            onToggle={(target) => void toggleServer(target)}
          />
        ))}
      </ul>
    );
  };

  const renderInstalled = (): React.ReactNode => {
    if (packages.length === 0)
      return <div className='capability-empty'>{t('settings.capabilitiesTab.packagesEmpty')}</div>;
    if (visiblePackages.length === 0)
      return <div className='capability-empty'>{t('settings.capabilitiesTab.hubNoMatch')}</div>;
    return (
      <ul className='plugin-hub-list' data-testid='plugin-package-list'>
        {visiblePackages.map((item) => {
          const manifest = item.installedManifest ?? item.manifest;
          const connections = connectionsOf(manifest.id);
          const codeItems = connections.filter((connection) => connection.runsCode === true);
          const packageSkills: HubPluginSkill[] = skills
            .filter((skill) => skill.source === 'package' && skill.packageId === manifest.id)
            .map((skill) => ({ name: skill.name, description: skill.description }));
          return (
            <HubPluginCard
              key={manifest.id}
              packageId={manifest.id}
              name={manifest.name}
              description={manifest.description}
              counts={{
                mcp: mcpServers.filter((server) => packageOwnerOfMcpServer(server) === manifest.id).length,
                skills: connections.filter((connection) => connection.kind === 'skill').length,
                hooks: connections.filter((connection) => connection.kind === 'hook').length,
              }}
              enabled={pluginEnabled(manifest.id)}
              busy={pendingKey === `pkg:${manifest.id}`}
              hasCodeItems={codeItems.length > 0}
              autoStart={codeItems.length > 0 && codeItems.every((connection) => connection.autoStart === true)}
              expanded={expandedId === manifest.id}
              skills={packageSkills}
              hookTitles={connections
                .filter((connection) => connection.kind === 'hook')
                .map((connection) => connection.title)}
              onToggleEnabled={(next) => void setPluginEnabled(manifest.id, next)}
              onToggleAutoStart={(next) => void setPluginAutoStart(manifest.id, next)}
              onToggleExpanded={() => setExpandedId((current) => (current === manifest.id ? undefined : manifest.id))}
              onViewSkill={(skillName) => setViewing({ name: skillName, packageId: manifest.id })}
              onRemove={() => removePlugin(manifest.id, manifest.name)}
            />
          );
        })}
      </ul>
    );
  };

  const renderCustom = (): React.ReactNode => {
    if (customServers.length === 0)
      return <div className='capability-empty'>{t('settings.capabilitiesTab.hubEmptyCustom')}</div>;
    if (visibleCustom.length === 0)
      return <div className='capability-empty'>{t('settings.capabilitiesTab.hubNoMatch')}</div>;
    return (
      <ul className='plugin-hub-list' data-testid='hub-custom-list'>
        {visibleCustom.map((server) => (
          <HubServerRow
            key={server.id}
            server={server}
            testPrefix='custom'
            pending={pendingKey === server.id}
            onToggle={(target) => void toggleServer(target)}
          />
        ))}
      </ul>
    );
  };

  const panels: Record<HubTab, React.ReactNode> = {
    available: renderAvailable(),
    installed: renderInstalled(),
    custom: renderCustom(),
  };

  return (
    <div className='flex flex-col gap-24px min-h-0' data-testid='plugins-settings-tab'>
      <header className='flex flex-col gap-4px'>
        <div className='text-14px text-t-primary'>
          {t('settings.capabilitiesTab.plugins', { defaultValue: 'Plugins' })}
        </div>
        <div className='text-12px text-t-secondary'>
          {t('settings.capabilitiesTab.pluginsDescription', {
            defaultValue: 'MCP servers and installed packages that give Tomny extra tools.',
          })}
        </div>
      </header>

      <CapabilityKindExplainer />

      <section className='plugin-hub' data-testid='plugin-hub'>
        <div className='plugin-hub__tabs' role='tablist'>
          {HUB_TABS.map((key) => (
            <button
              key={key}
              type='button'
              role='tab'
              aria-selected={tab === key}
              className='plugin-hub__tab'
              data-testid={`plugin-hub-tab-${key}`}
              onClick={() => setTab(key)}
            >
              {tabLabels[key]} ({tabCounts[key]})
            </button>
          ))}
        </div>
        <div className='plugin-hub__toolbar'>
          <Input
            className='plugin-hub__search'
            allowClear
            value={query}
            placeholder={t('settings.capabilitiesTab.hubSearchPlaceholder')}
            aria-label={t('settings.capabilitiesTab.hubSearchPlaceholder')}
            data-testid='plugin-hub-search'
            onChange={(value: string) => setQuery(value)}
          />
          <div className='plugin-hub__chips' role='group'>
            {HUB_FILTERS.map((key) => (
              <button
                key={key}
                type='button'
                aria-pressed={filter === key}
                className='plugin-hub__chip'
                data-testid={`plugin-hub-filter-${key}`}
                onClick={() => setFilter(key)}
              >
                {key === 'all'
                  ? t('settings.capabilitiesTab.hubFilterAll')
                  : key === 'on'
                    ? t('settings.capabilitiesTab.statusOn')
                    : t('settings.capabilitiesTab.statusOff')}
              </button>
            ))}
          </div>
        </div>
        <div className='plugin-hub__scroll' role='tabpanel' data-testid='plugin-hub-scroll'>
          {panels[tab]}
          {tab === 'custom' ? (
            <details className='plugin-hub__manage' data-testid='plugin-hub-manage'>
              <summary className='plugin-hub__manage-summary'>
                {t('settings.capabilitiesTab.userMcpTitle')}
              </summary>
              <ToolsModalContent />
            </details>
          ) : null}
        </div>
      </section>

      {viewing ? (
        <SkillDocumentModal
          name={viewing.name}
          packageId={viewing.packageId}
          packageName={packageName(viewing.packageId)}
          onClose={() => setViewing(undefined)}
        />
      ) : null}

      <details
        ref={externalRef}
        className='plugins-external'
        data-testid='plugins-external-section'
        open={externalOpen}
        onToggle={(event) => setExternalOpen(event.currentTarget.open)}
      >
        <summary className='plugins-external__summary'>
          <span className='text-13px text-t-primary font-medium'>
            {t('settings.capabilitiesTab.externalTitle', { defaultValue: 'For external apps to use Tomny' })}
          </span>
          <span className='text-12px text-t-secondary'>
            {t('settings.capabilitiesTab.externalDescription', {
              defaultValue: 'Lets Claude Desktop, Cursor and other apps call Tomny through MCP.',
            })}
          </span>
        </summary>
        <div className='plugins-external__body'>
          <ExternalMcpGatewaySettings />
        </div>
      </details>
    </div>
  );
};

export default PluginsSettingsTab;
