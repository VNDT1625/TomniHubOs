/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { HookSettingsRow, HookSettingsSource } from '@/common/integrations/hooks/hookSettings';
import {
  PluginOriginGroup,
  groupByPlugin,
  usePluginNames,
} from '@/renderer/pages/settings/ToolsSettings/CapabilityKindUi';
import HookRow from './HookRow';

type HookSourceSectionProps = {
  source: HookSettingsSource;
  hooks: HookSettingsRow[];
  enabled: boolean;
  busy: boolean;
  onToggleSource: (source: HookSettingsSource, enabled: boolean) => void;
  onReview: (hook: HookSettingsRow) => void;
  onSetEnabled: (hook: HookSettingsRow, enabled: boolean) => void;
  onRemove: (hook: HookSettingsRow) => void;
};

/**
 * The hooks of one source. User and workspace hooks keep their source switch: turning it off stops all of them on the
 * next call. Package hooks follow their plugin instead: they are grouped per plugin, collapsed by default, and have no
 * switch or actions of their own. The plugin's detail page is where they are turned on, reviewed or removed.
 */
const HookSourceSection: React.FC<HookSourceSectionProps> = ({
  source,
  hooks,
  enabled,
  busy,
  onToggleSource,
  onReview,
  onSetEnabled,
  onRemove,
}) => {
  const { t } = useTranslation();
  const headingId = useId();
  const navigate = useNavigate();
  const pluginNames = usePluginNames();
  const followsPlugin = source === 'package';

  const renderRows = (rows: HookSettingsRow[]) => (
    <ul className='hooks-list'>
      {rows.map((hook) => (
        <HookRow
          key={hook.id}
          hook={hook}
          busy={busy}
          readOnly={followsPlugin}
          onReview={onReview}
          onSetEnabled={onSetEnabled}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );

  const renderBody = () => {
    if (hooks.length === 0) return <p className='hooks-empty'>{t('settings.hooks.sourceEmpty')}</p>;
    if (!followsPlugin) return renderRows(hooks);
    const groups = groupByPlugin(hooks, (hook) => hook.pluginId);
    const withoutPlugin = hooks.filter((hook) => hook.pluginId === undefined);
    return (
      <>
        {groups.map((group) => (
          <PluginOriginGroup
            key={group.pluginId}
            pluginId={group.pluginId}
            testId={`hook-plugin-group-${group.pluginId}`}
            label={t('settings.capabilitiesTab.fromPluginHooks', {
              name: pluginNames[group.pluginId] ?? group.pluginId,
              count: group.items.length,
            })}
            onManage={(pluginId) => navigate(`/store/package/${encodeURIComponent(pluginId)}`)}
          >
            {renderRows(group.items)}
          </PluginOriginGroup>
        ))}
        {withoutPlugin.length > 0 ? renderRows(withoutPlugin) : null}
      </>
    );
  };

  return (
    <section className='hooks-section' aria-labelledby={headingId} data-testid={`hook-source-${source}`}>
      <header className='hooks-section-head'>
        <h3 id={headingId} className='hooks-section-title'>
          {t(`settings.hooks.source.${source}`)}
        </h3>
        {followsPlugin ? null : (
          <label className='hooks-switch'>
            <input
              type='checkbox'
              role='switch'
              checked={enabled}
              disabled={busy}
              onChange={(event) => onToggleSource(source, event.target.checked)}
            />
            <span>{t('settings.hooks.sourceSwitch')}</span>
          </label>
        )}
      </header>
      <p className='hooks-hint'>{t(`settings.hooks.sourceHint.${source}`)}</p>
      {renderBody()}
    </section>
  );
};

export default HookSourceSection;
