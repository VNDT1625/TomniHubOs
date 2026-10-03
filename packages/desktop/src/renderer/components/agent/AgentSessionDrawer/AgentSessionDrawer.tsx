/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Drawer, Tabs } from '@arco-design/web-react';
import { Brain, Lock, Write } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AgentContextPanel from './AgentContextPanel';
import AgentMemoryPanel from './AgentMemoryPanel';
import AgentSecretPanel from './AgentSecretPanel';
import type { AgentSessionDrawerProps, SessionDrawerTab } from './types';

export const AgentSessionDrawer: React.FC<AgentSessionDrawerProps> = ({
  visible,
  onClose,
  initialTab = 'save',
  conversationId,
  repository,
  previewData,
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SessionDrawerTab>(initialTab);

  useEffect(() => {
    if (visible && initialTab) {
      setActiveTab(initialTab);
    }
  }, [visible, initialTab]);

  return (
    <Drawer
      width={540}
      visible={visible}
      onCancel={onClose}
      footer={null}
      title={
        <div className='flex items-center gap-8px'>
          <span className='flex-center size-26px rd-8px bg-primary-light-1 text-primary'>
            <Brain theme='outline' size={16} />
          </span>
          <div className='flex flex-col'>
            <span className='text-14px font-600 text-t-primary leading-tight'>
              {t('ide.memory.title', { defaultValue: 'Agent Intelligence & Context' })}
            </span>
            <span className='text-11px text-t-tertiary leading-tight'>
              {conversationId
                ? t('ide.memory.liveSession', { defaultValue: 'Live Session & Memory Control' })
                : t('ide.memory.preSession', { defaultValue: 'Pre-session & Initial Configuration' })}
            </span>
          </div>
        </div>
      }
    >
      <div className='flex flex-col h-full min-h-0 gap-14px'>
        <Tabs activeTab={activeTab} onChange={(key) => setActiveTab(key as SessionDrawerTab)} className='shrink-0'>
          <Tabs.TabPane
            key='save'
            title={
              <span className='flex items-center gap-6px'>
                <Write theme='outline' size={13} />
                <span>{t('ide.memory.tabs.save', { defaultValue: 'Notes & Memory' })}</span>
              </span>
            }
          />
          <Tabs.TabPane
            key='context'
            title={
              <span className='flex items-center gap-6px'>
                <Brain theme='outline' size={13} />
                <span>{t('ide.memory.tabs.context', { defaultValue: 'Context' })}</span>
              </span>
            }
          />
          <Tabs.TabPane
            key='secret'
            title={
              <span className='flex items-center gap-6px'>
                <Lock theme='outline' size={13} />
                <span>{t('ide.memory.tabs.secret', { defaultValue: 'Secrets' })}</span>
              </span>
            }
          />
        </Tabs>

        <div className='flex-1 overflow-hidden min-h-0'>
          {activeTab === 'save' && <AgentMemoryPanel sessionId={conversationId} active={visible} />}
          {activeTab === 'context' && (
            <AgentContextPanel conversationId={conversationId} active={visible} previewData={previewData} />
          )}
          {activeTab === 'secret' && <AgentSecretPanel repository={repository} active={visible} />}
        </div>
      </div>
    </Drawer>
  );
};

export default AgentSessionDrawer;
