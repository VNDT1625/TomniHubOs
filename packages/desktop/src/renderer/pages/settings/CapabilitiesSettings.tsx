/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tabs } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import SkillsHubSettings from './SkillsHubSettings';
import ToolsModalContent from '@/renderer/components/settings/SettingsModal/contents/ToolsModalContent';
import ExternalMcpGatewaySettings from './ToolsSettings/ExternalMcpGatewaySettings';
import SettingsPageWrapper from './components/SettingsPageWrapper';

type CapabilitiesTab = 'skills' | 'tools' | 'mcp-gateway';

const isCapabilitiesTab = (value: string | null): value is CapabilitiesTab =>
  value === 'skills' || value === 'tools' || value === 'mcp-gateway';

const CapabilitiesSettings: React.FC = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState<CapabilitiesTab>(() => {
    const tabParam = searchParams.get('tab');
    return isCapabilitiesTab(tabParam) ? tabParam : 'skills';
  });

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (isCapabilitiesTab(tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [searchParams, activeTab]);

  const handleTabChange = (key: string) => {
    if (isCapabilitiesTab(key)) {
      setActiveTab(key);
      const next = new URLSearchParams(searchParams);
      next.set('tab', key);
      setSearchParams(next, { replace: true });
    }
  };

  return (
    <SettingsPageWrapper contentClassName='max-w-1200px'>
      <Tabs
        activeTab={activeTab}
        onChange={handleTabChange}
        type='line'
        className='flex flex-col flex-1 min-h-0 [&>.arco-tabs-content]:pt-0'
      >
        <Tabs.TabPane key='skills' title={t('settings.capabilitiesTab.skills', { defaultValue: 'Kỹ năng (Skills)' })}>
          <SkillsHubSettings withWrapper={false} />
        </Tabs.TabPane>
        <Tabs.TabPane key='tools' title='Năng lực & Tools'>
          <ToolsModalContent />
        </Tabs.TabPane>
        <Tabs.TabPane key='mcp-gateway' title='MCP Connectors'>
          <ExternalMcpGatewaySettings />
        </Tabs.TabPane>
      </Tabs>
    </SettingsPageWrapper>
  );
};

export default CapabilitiesSettings;
