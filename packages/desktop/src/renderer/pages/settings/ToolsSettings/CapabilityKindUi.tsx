/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { Switch, Tooltip } from '@arco-design/web-react';
import { Help } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { BUILTIN_IMAGE_GEN_ID, BUILTIN_IMAGE_GEN_NAME, type IMcpServer } from '@/common/config/storage';
import { packageClient } from '@/renderer/pages/hub/packageClient';

/** What a row is: a Plugin (a bundle that can hold MCP servers, skills, hooks and rules) or one MCP server. */
export type CapabilityKind = 'plugin' | 'mcp';

/** Type tag shown on every Plugin or MCP row. The tooltip carries the one-line definition. */
export const CapabilityKindTag: React.FC<{ kind: CapabilityKind }> = ({ kind }) => {
  const { t } = useTranslation();
  const label = kind === 'plugin' ? t('settings.capabilitiesTab.pluginBadge') : t('settings.capabilitiesTab.typeMcp');
  const tip = kind === 'plugin' ? t('settings.capabilitiesTab.tipPlugin') : t('settings.capabilitiesTab.tipMcp');
  return (
    <Tooltip content={tip}>
      <span className={`capability-kind-tag capability-kind-tag--${kind}`} data-testid={`capability-kind-${kind}`}>
        {label}
      </span>
    </Tooltip>
  );
};

/** Always-visible definition line at the top of the Plugin tab. The help icon explains the tool schema. */
export const CapabilityKindExplainer: React.FC = () => {
  const { t } = useTranslation();
  const toolSchemaTip = t('settings.capabilitiesTab.tipToolSchema');
  return (
    <p className='capability-explainer' data-testid='capability-explainer'>
      <span>{t('settings.capabilitiesTab.explainer')}</span>
      <Tooltip content={toolSchemaTip}>
        <span className='capability-explainer__help' role='img' aria-label={toolSchemaTip}>
          <Help size={14} />
        </span>
      </Tooltip>
    </p>
  );
};

/** The three tabs of the plugin hub: built-in servers, installed plugins, and the user's own MCP servers. */
export type HubTab = 'available' | 'installed' | 'custom';

/** The on/off chip shown beside the search box. */
export type HubFilter = 'all' | 'on' | 'off';

/** True when the search is empty, or one of the fields contains it (ignoring case). */
export const matchesHubQuery = (query: string, fields: ReadonlyArray<string | undefined>): boolean => {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return fields.some((field) => field !== undefined && field.toLowerCase().includes(needle));
};

/** True when an item passes the on/off chip. */
export const matchesHubFilter = (enabled: boolean, filter: HubFilter): boolean =>
  filter === 'all' || (filter === 'on' ? enabled : !enabled);

const isImageGenServer = (server: IMcpServer): boolean =>
  server.id === BUILTIN_IMAGE_GEN_ID || server.name === BUILTIN_IMAGE_GEN_NAME;

type HubServerRowProps = {
  server: IMcpServer;
  /** Prefix for test ids, so built-in and own servers are told apart. */
  testPrefix: 'builtin' | 'custom';
  /** True while this server's switch is being saved. */
  pending: boolean;
  /** Flips the server. It must not reject; it reports its own failure. */
  onToggle: (server: IMcpServer) => void;
};

/**
 * One MCP server row in the Available or Custom tab: name, MCP tag, tool count, description and its switch. Image
 * generation has no switch here, because its provider decides whether it is available; its row says so instead.
 */
export const HubServerRow: React.FC<HubServerRowProps> = ({ server, testPrefix, pending, onToggle }) => {
  const { t } = useTranslation();
  const switchable = !isImageGenServer(server);
  return (
    <li className='plugin-hub-row' data-testid={`${testPrefix}-mcp-${server.name}`}>
      <div className='plugin-hub-row__text'>
        <div className='plugin-hub-row__title'>
          <span className='capability-row__name'>{server.name}</span>
          <CapabilityKindTag kind='mcp' />
          {server.tools !== undefined ? (
            <span className='capability-row__count'>
              {t('settings.capabilitiesTab.builtinToolsCount', { count: server.tools.length })}
            </span>
          ) : null}
        </div>
        {server.description ? <p className='capability-row__summary'>{server.description}</p> : null}
        {switchable ? null : (
          <p className='capability-row__hint'>{t('settings.capabilitiesTab.builtinImageGenHint')}</p>
        )}
      </div>
      {switchable ? (
        <Switch
          size='small'
          className='plugin-hub-switch'
          checked={server.enabled}
          loading={pending}
          disabled={pending}
          aria-label={t('settings.capabilitiesTab.hubEnableAria', { name: server.name })}
          data-testid={`${testPrefix}-switch-${server.name}`}
          onChange={() => onToggle(server)}
        />
      ) : null}
    </li>
  );
};

/** One skill of an installed plugin, as the expanded plugin card lists it. */
export type HubPluginSkill = { name: string; description?: string };

type HubPluginCardProps = {
  packageId: string;
  name: string;
  description?: string;
  counts: { mcp: number; skills: number; hooks: number };
  enabled: boolean;
  /** True while this plugin's switches are being saved. */
  busy: boolean;
  /** Whether the plugin has code-running connections; the start-again switch shows only then. */
  hasCodeItems: boolean;
  autoStart: boolean;
  expanded: boolean;
  skills: readonly HubPluginSkill[];
  hookTitles: readonly string[];
  onToggleEnabled: (enabled: boolean) => void;
  onToggleAutoStart: (autoStart: boolean) => void;
  onToggleExpanded: () => void;
  onViewSkill: (skillName: string) => void;
  onRemove: () => void;
};

/**
 * One installed plugin as a cluster card: name, Plugin tag, a two-line description, the MCP / skill / hook counts, the
 * whole-plugin switch, the start-again switch, a "details" toggle that lists its skills and hooks, and remove.
 */
export const HubPluginCard: React.FC<HubPluginCardProps> = ({
  packageId,
  name,
  description,
  counts,
  enabled,
  busy,
  hasCodeItems,
  autoStart,
  expanded,
  skills,
  hookTitles,
  onToggleEnabled,
  onToggleAutoStart,
  onToggleExpanded,
  onViewSkill,
  onRemove,
}) => {
  const { t } = useTranslation();
  const chips: Array<{ key: string; label: string }> = [];
  if (counts.mcp > 0) chips.push({ key: 'mcp', label: `${t('settings.capabilitiesTab.typeMcp')} ${counts.mcp}` });
  if (counts.skills > 0)
    chips.push({ key: 'skills', label: `${t('settings.capabilitiesTab.skills')} ${counts.skills}` });
  if (counts.hooks > 0) chips.push({ key: 'hooks', label: `${t('settings.capabilitiesTab.hooks')} ${counts.hooks}` });

  return (
    <li className='plugin-hub-plugin' data-testid={`plugin-package-${packageId}`}>
      <div className='plugin-hub-plugin__head'>
        <div className='plugin-hub-plugin__text'>
          <div className='plugin-hub-plugin__title'>
            <Link className='plugin-hub-plugin__name' to={`/store/package/${encodeURIComponent(packageId)}`}>
              {name}
            </Link>
            <CapabilityKindTag kind='plugin' />
          </div>
          {description ? <p className='plugin-hub-plugin__desc'>{description}</p> : null}
          {chips.length > 0 ? (
            <div className='plugin-hub-plugin__chips'>
              {chips.map((chip) => (
                <span key={chip.key} className='capability-row__count'>
                  {chip.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <Switch
          className='plugin-hub-switch'
          checked={enabled}
          loading={busy}
          disabled={busy}
          aria-label={t('settings.capabilitiesTab.hubEnableAria', { name })}
          data-testid={`plugin-enable-${packageId}`}
          onChange={(next: boolean) => onToggleEnabled(next)}
        />
      </div>
      {hasCodeItems ? (
        <div className='plugin-hub-plugin__auto'>
          <Switch
            size='small'
            className='plugin-hub-switch'
            checked={autoStart}
            disabled={busy}
            aria-label={t('guid.hubHome.connections.autoStart')}
            data-testid={`plugin-autostart-${packageId}`}
            onChange={(next: boolean) => onToggleAutoStart(next)}
          />
          <span className='plugin-hub-plugin__auto-label'>{t('guid.hubHome.connections.autoStart')}</span>
          <span className='plugin-hub-plugin__caption'>{t('settings.capabilitiesTab.hubAutoStartCaption')}</span>
        </div>
      ) : null}
      <div className='plugin-hub-plugin__actions'>
        <button
          type='button'
          className='capability-group__link'
          aria-expanded={expanded}
          data-testid={`plugin-details-toggle-${packageId}`}
          onClick={onToggleExpanded}
        >
          {expanded ? t('settings.capabilitiesTab.hubCollapse') : t('settings.capabilitiesTab.hubDetails')}
        </button>
        <button
          type='button'
          className='capability-group__link plugin-hub-plugin__remove'
          data-testid={`plugin-remove-${packageId}`}
          onClick={onRemove}
        >
          {t('settings.capabilitiesTab.removePlugin')}
        </button>
      </div>
      {expanded ? (
        <div className='plugin-hub-plugin__detail' data-testid={`plugin-detail-${packageId}`}>
          <div className='plugin-hub-plugin__group-title'>{t('settings.capabilitiesTab.skills')}</div>
          {skills.length === 0 ? null : (
            <ul className='plugin-hub-plugin__items'>
              {skills.map((skill) => (
                <li key={skill.name} className='plugin-hub-plugin__item' data-testid={`plugin-skill-${skill.name}`}>
                  <span className='plugin-hub-plugin__item-text'>
                    <span className='capability-row__name'>{skill.name}</span>
                    {skill.description ? <span className='capability-row__summary'>{skill.description}</span> : null}
                  </span>
                  <button
                    type='button'
                    className='capability-group__link'
                    data-testid={`plugin-skill-view-${skill.name}`}
                    onClick={() => onViewSkill(skill.name)}
                  >
                    {t('settings.capabilitiesTab.viewSkill')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className='plugin-hub-plugin__group-title'>{t('settings.capabilitiesTab.hooks')}</div>
          {hookTitles.length === 0 ? null : (
            <ul className='plugin-hub-plugin__items'>
              {hookTitles.map((title, index) => (
                <li key={`${index}-${title}`} className='plugin-hub-plugin__item'>
                  <span className='capability-row__name'>{title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
};

/** Items grouped by the installed plugin that owns them, in first-seen order. Items with no owner are left out. */
export function groupByPlugin<T>(
  items: readonly T[],
  pluginOf: (item: T) => string | undefined
): Array<{ pluginId: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const pluginId = pluginOf(item);
    if (pluginId === undefined) continue;
    const bucket = groups.get(pluginId);
    if (bucket) bucket.push(item);
    else groups.set(pluginId, [item]);
  }
  return [...groups].map(([pluginId, grouped]) => ({ pluginId, items: grouped }));
}

/** Display names of the installed plugins by id. An id with no name yet is shown as its id. */
export const usePluginNames = (): Readonly<Record<string, string>> => {
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => packageClient.list({ installedOnly: true }))
      .then((items) => {
        if (cancelled) return;
        setNames(
          Object.fromEntries(
            items.map((item): [string, string] => {
              const manifest = item.installedManifest ?? item.manifest;
              return [manifest.id, manifest.name];
            })
          )
        );
      })
      .catch(() => {
        if (!cancelled) setNames({});
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return names;
};

type PluginOriginGroupProps = {
  pluginId: string;
  /** Already translated, for example "From plugin: Context Mode · 9 skills". */
  label: string;
  testId: string;
  onManage: (pluginId: string) => void;
  children: React.ReactNode;
};

/**
 * Items that came from one installed plugin, collapsed by default. They have no switch of their own: the plugin's
 * switch decides. "Manage in plugin" and "Remove plugin" both open the plugin's detail page, where they are done.
 */
export const PluginOriginGroup: React.FC<PluginOriginGroupProps> = ({
  pluginId,
  label,
  testId,
  onManage,
  children,
}) => {
  const { t } = useTranslation();
  const openDetail = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onManage(pluginId);
  };
  return (
    <details className='capability-group' data-testid={testId}>
      <summary className='capability-group__summary'>
        <span className='capability-group__title'>{label}</span>
        <span className='capability-group__actions'>
          <button type='button' className='capability-group__link' onClick={openDetail}>
            {t('settings.capabilitiesTab.manageInPlugin')}
          </button>
          <button type='button' className='capability-group__link' onClick={openDetail}>
            {t('settings.capabilitiesTab.removePlugin')}
          </button>
        </span>
      </summary>
      <div className='capability-group__body'>
        <p className='capability-row__hint'>{t('settings.capabilitiesTab.pluginGroupNote')}</p>
        {children}
      </div>
    </details>
  );
};
