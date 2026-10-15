/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */
import type { HubActivityItem } from '@/common/types/agent/hubActivity';
import { HubMiniChat } from './HubMiniChat';
import { HubToolTrace } from './HubToolTrace';
import { Bot, ExternalLink, Monitor, Users } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

export type HubInspectorMode = 'chat' | 'activity' | 'live' | 'subagents';

type Props = {
  item: HubActivityItem;
  mode: HubInspectorMode;
  onOpenItem?: (item: HubActivityItem) => void;
};

/** Read-only activity projections. Never manufactures tool input/output or a browser instance. */
export const HubExecutionPanel: React.FC<Props> = ({ item, mode, onOpenItem }) => {
  const { t } = useTranslation();
  const [memberId, setMemberId] = useState('');
  const teamSteps = item.kind === 'team' ? item.steps : [];
  const member = teamSteps.find((step) => step.id === memberId) ?? teamSteps[0];
  const tLabel = (key: string, fallback: string) => t(key, { defaultValue: fallback });

  return (
    <section className='hub-inspector-detail' data-testid={`hub-inspector-${mode}`}>
      <header className='hub-inspector-detail-head'>
        <strong>{item.title}</strong>
        <span>{t(`guid.hubHome.live.status.${item.status}`)}</span>
        {item.route && onOpenItem && (
          <button type='button' title={tLabel('guid.hubHome.live.open', 'Mở Session')} onClick={() => onOpenItem(item)}>
            <ExternalLink size={14} />
          </button>
        )}
      </header>
      {mode === 'chat' && (
        <div className='hub-inspector-detail-body'>
          <HubMiniChat item={item} />
        </div>
      )}
      {mode === 'activity' && <HubToolTrace item={item} />}
      {mode === 'live' && (
        <div className='hub-inspector-detail-body'>
          <div className='hub-inspector-heading'>
            <Monitor size={14} /> {tLabel('guid.hubHome.inspector.controlledApps', 'Ứng dụng được điều khiển')}
          </div>
          {item.kind === 'app' ? (
            <div className='hub-inspector-surface'>
              <strong>{item.title}</strong>
              <span>{item.task ?? item.workspace ?? t(`guid.hubHome.live.status.${item.status}`)}</span>
              {item.route && onOpenItem && (
                <button type='button' onClick={() => onOpenItem(item)}>
                  {tLabel('guid.hubHome.inspector.openApp', 'Mở ứng dụng')} <ExternalLink size={13} />
                </button>
              )}
            </div>
          ) : (
            <p className='hub-inspector-muted'>
              {tLabel(
                'guid.hubHome.inspector.noSurface',
                'Chưa có Browser, IDE hoặc package app được liên kết để quan sát trực tiếp cho Agent này.'
              )}
            </p>
          )}
        </div>
      )}
      {mode === 'subagents' && (
        <div className='hub-inspector-detail-body'>
          <div className='hub-inspector-heading'>
            <Users size={14} /> {tLabel('guid.hubHome.inspector.members', 'Agent trong nhóm')}
          </div>
          {teamSteps.length > 0 ? (
            <>
              <label className='hub-inspector-member-select'>
                {tLabel('guid.hubHome.inspector.selectMember', 'Quan sát Agent')}
                <select value={member?.id ?? ''} onChange={(event) => setMemberId(event.currentTarget.value)}>
                  {teamSteps.map((step) => (
                    <option key={step.id} value={step.id}>
                      {step.label}
                    </option>
                  ))}
                </select>
              </label>
              {member && (
                <div className='hub-inspector-surface'>
                  <div className='hub-inspector-heading'>
                    <Bot size={14} /> <strong>{member.label}</strong>
                  </div>
                  <span>{tLabel(`guid.hubHome.inspector.state.${member.state}`, member.state)}</span>
                  <span className='hub-inspector-muted'>
                    {tLabel(
                      'guid.hubHome.inspector.memberTrace',
                      'Ngữ cảnh, tool trace và Chat riêng sẽ xuất hiện khi Subagent cung cấp session ID và quyền truy cập.'
                    )}
                  </span>
                </div>
              )}
            </>
          ) : (
            <p className='hub-inspector-muted'>
              {tLabel('guid.hubHome.inspector.noMembers', 'Không có Subagent được ghi nhận.')}
            </p>
          )}
        </div>
      )}
    </section>
  );
};
