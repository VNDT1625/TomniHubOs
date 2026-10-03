/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Tabs } from '@arco-design/web-react';
import ModelModalContent from '@/renderer/components/settings/SettingsModal/contents/ModelModalContent';
import AgentModalContent from '@/renderer/components/settings/SettingsModal/contents/AgentModalContent';
import Router9ConnectorPanel from '@/renderer/pages/settings/router9/Router9ConnectorPanel';
import SettingsPageWrapper from './components/SettingsPageWrapper';

/**
 * AI Core Settings — Gộp Model Providers, 9Router và Agent Mesh vào một trung tâm điều khiển AI duy nhất.
 */
const ModeSettings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('models');

  return (
    <SettingsPageWrapper contentClassName='max-w-1100px'>
      <Tabs
        activeTab={activeTab}
        onChange={setActiveTab}
        type='line'
        className='flex flex-col flex-1 min-h-0 [&>.arco-tabs-content]:pt-0'
      >
        <Tabs.TabPane key='models' title='Mô hình & Providers'>
          <ModelModalContent />
        </Tabs.TabPane>
        <Tabs.TabPane key='router9' title='9Router Gateway'>
          <Router9ConnectorPanel />
        </Tabs.TabPane>
        <Tabs.TabPane key='agents' title='Agent CLI & Mesh'>
          <AgentModalContent />
        </Tabs.TabPane>
      </Tabs>
    </SettingsPageWrapper>
  );
};

export default ModeSettings;
