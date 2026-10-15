/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tabs } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AssistantSettings from './AssistantSettings';
import SkillsHubSettings from './SkillsHubSettings';
import HooksPage from '@/renderer/pages/integrations/hooks/HooksPage';
import PluginsSettingsTab from './ToolsSettings/PluginsSettingsTab';
import SettingsPageWrapper from './components/SettingsPageWrapper';

/** The four Customize tabs, in display order. */
export type CapabilitiesTab = 'assistants' | 'skills' | 'hooks' | 'plugins';

const CAPABILITIES_TABS: readonly CapabilitiesTab[] = ['assistants', 'skills', 'hooks', 'plugins'];

/**
 * Old tab keys keep working. The former tools and MCP gateway tabs now live inside Plugin; the gateway section is
 * opened from its legacy key.
 */
const LEGACY_TAB_REMAP: Readonly<Record<string, CapabilitiesTab>> = {
  tools: 'plugins',
  'mcp-gateway': 'plugins',
};

/** Resolves a ?tab= value to a current tab, or undefined when it names nothing known. */
export const resolveCapabilitiesTab = (value: string | null): CapabilitiesTab | undefined => {
  if (value === null) return undefined;
  if ((CAPABILITIES_TABS as readonly string[]).includes(value)) return value as CapabilitiesTab;
  return LEGACY_TAB_REMAP[value];
};

const CapabilitiesSettings: React.FC = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');

  const [activeTab, setActiveTab] = useState<CapabilitiesTab>(() => resolveCapabilitiesTab(rawTab) ?? 'assistants');

  useEffect(() => {
    const tab = resolveCapabilitiesTab(searchParams.get('tab'));
    if (tab !== undefined && tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [searchParams, activeTab]);

  const handleTabChange = (key: string) => {
    const tab = resolveCapabilitiesTab(key);
    if (tab === undefined) return;
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  return (
    <SettingsPageWrapper contentClassName='max-w-1200px'>
      <Tabs
        activeTab={activeTab}
        onChange={handleTabChange}
        type='line'
        className='flex flex-col flex-1 min-h-0 [&>.arco-tabs-content]:pt-0'
      >
        <Tabs.TabPane key='assistants' title={t('settings.capabilitiesTab.assistants', { defaultValue: 'Assistants' })}>
          <AssistantSettings withWrapper={false} />
        </Tabs.TabPane>
        <Tabs.TabPane key='skills' title={t('settings.capabilitiesTab.skills', { defaultValue: 'Skills' })}>
          <SkillsHubSettings withWrapper={false} />
        </Tabs.TabPane>
        <Tabs.TabPane key='hooks' title={t('settings.capabilitiesTab.hooks', { defaultValue: 'Hooks' })}>
          <HooksPage />
        </Tabs.TabPane>
        <Tabs.TabPane key='plugins' title={t('settings.capabilitiesTab.plugins', { defaultValue: 'Plugins' })}>
          <PluginsSettingsTab openExternal={rawTab === 'mcp-gateway'} />
        </Tabs.TabPane>
      </Tabs>
    </SettingsPageWrapper>
  );
};

export default CapabilitiesSettings;
