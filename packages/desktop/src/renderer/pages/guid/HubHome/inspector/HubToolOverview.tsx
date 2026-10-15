/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  hubActivityChannels,
  type HubActivityItem,
  type HubOverviewToolAction,
} from '@/common/types/agent/hubActivity';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { monitorMilestones } from './monitorMilestones';

type Density = 'solo' | 'standard' | 'compact';
type Props = { item: HubActivityItem; density: Density };

/** A compact, numbered view of observed tool actions above the unchanged
 * recent-operations list. The richer trace stays in Inspector > Activity.
 */
export const HubToolOverview: React.FC<Props> = ({ item, density }) => {
  const { t } = useTranslation();
    const [snapshot, setSnapshot] = useState<{ id: string; actions: HubOverviewToolAction[] } | null>(null);
  const [expandedCompactBranch, setExpandedCompactBranch] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  // Last overview payload, so an unchanged 1.4 s poll does not re-render the whole card.
  const lastPayloadRef = useRef('');

  useEffect(() => {
    if (item.kind !== 'agent') return undefined;
    let active = true;
    const refresh = () => {
      void hubActivityChannels.overview
        .invoke({ id: item.id })
        .then((actions) => {
          const payload = item.id + '\n' + JSON.stringify(actions);
          if (active && payload !== lastPayloadRef.current) {
            lastPayloadRef.current = payload;
            setSnapshot({ id: item.id, actions });
          }
        })
        .catch((): void => undefined);
    };
    refresh();
    if (item.status !== 'running' && item.status !== 'needs_input') {
      return () => {
        active = false;
      };
    }
    const interval = window.setInterval(refresh, 1_400);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [item.id, item.kind, item.status]);

  const actions = snapshot?.id === item.id ? snapshot.actions : [];
  const milestones = monitorMilestones(item);
  // Follow only meaningful step/status changes, not every 1.4s snapshot poll.
  const followKey = actions.length
        ? `${item.status}:${actions.map((action) => `${action.id}:${action.state}:${action.label}:${action.children?.map((child) => `${child.id}:${child.state}`).join(',') ?? ''}`).join('|')}`
    : `${item.status}:${milestones.map((step) => `${step.id}:${step.state}`).join('|')}`;

  useLayoutEffect(() => {
    followLatestRef.current = true;
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [item.id]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (container && followLatestRef.current) container.scrollTop = container.scrollHeight;
  }, [followKey]);

  const onFlowScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    followLatestRef.current = container.scrollHeight - container.scrollTop - container.clientHeight <= 24;
  };

  if (!actions.length) {
    return (
      <div className='hub-tool-flow-frame' data-testid='hub-tool-flow-frame'>
        <strong className='hub-tool-flow-title'>
          {t('guid.hubHome.monitor.activity', { defaultValue: 'Tiến trình thực hiện' })}
        </strong>
        <div
          ref={scrollRef}
          className='hub-tool-flow hub-tool-flow--fallback'
          data-testid='hub-tool-flow'
          onScroll={onFlowScroll}
        >
          {milestones.map((step, index) => (
            <React.Fragment key={step.id}>
              {index > 0 && (
                <span className='hub-tool-flow-arrow' aria-hidden='true'>
                  →
                </span>
              )}
              <span
                className={`hub-tool-flow-step hub-log-line--${step.state}`}
                data-testid={`hub-monitor-stage-${step.id}`}
              >
                <span className='hub-tool-flow-number'>({index})</span>{' '}
                {t(`guid.hubHome.monitor.${step.id}`, {
                  defaultValue: (
                    {
                      start: 'Khởi động phiên',
                      answer: 'Đang trả lời',
                      html: 'Đang tạo HTML',
                      polish: 'Đang hoàn thiện phản hồi',
                      finish: 'Đã kết thúc',
                    } as const
                  )[step.id],
                })}
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  }

  const limit = density === 'solo' ? 24 : density === 'standard' ? 12 : 4;
  const recent = actions.slice(-limit);
  const hidden = actions.length - recent.length;
    const nextNumber = Math.max(0, ...actions.flatMap((action) => [action.number, ...(action.children?.map((child) => child.number) ?? [])])) + 1;
  const finished = item.status === 'done' || item.status === 'stopped' || item.status === 'error';
  const lastMilestone = milestones.findLast(
    (step) => step.id === 'html' || step.id === 'answer' || step.id === 'polish'
  );
  const showReply = Boolean(item.preview?.trim() && !finished && !actions.some((entry) => entry.state === 'running'));
  return (
    <div className='hub-tool-flow-frame' data-testid='hub-tool-flow-frame'>
      <strong className='hub-tool-flow-title'>
        {t('guid.hubHome.monitor.activity', { defaultValue: 'Tiến trình thực hiện' })}
      </strong>
      <div ref={scrollRef} className='hub-tool-flow' data-testid='hub-tool-flow' onScroll={onFlowScroll}>
        <span
          className='hub-tool-flow-step hub-tool-flow-step--stage hub-log-line--done'
          data-testid='hub-monitor-stage-start'
        >
          <span className='hub-tool-flow-number'>(0)</span>{' '}
          {t('guid.hubHome.monitor.start', { defaultValue: 'Khởi động phiên' })}
        </span>
        {hidden > 0 && (
          <>
            <span className='hub-tool-flow-arrow' aria-hidden='true'>
              →
            </span>
            <span className='hub-tool-flow-older' data-testid='hub-tool-hidden-count'>
              +{hidden} {t('guid.hubHome.monitor.olderTools', { defaultValue: 'thao tác trước' })}
            </span>
          </>
        )}
        {recent.map((action) => (
          <React.Fragment key={action.id}>
            <span className='hub-tool-flow-arrow' aria-hidden='true'>
              →
            </span>
                                    {(action.children?.length ?? 0) > 1 ? (
              <span
                className={`hub-tool-flow-branch ${density === 'compact' ? 'hub-tool-flow-branch--compact' : ''}`}
                data-testid={`hub-overview-branch-${action.workflowId}${action.workflowStage ? `-${action.workflowStage}` : ''}`}
              >
                {density === 'compact' && (
                  <button
                    type='button'
                    className='hub-tool-flow-branch-toggle'
                    aria-expanded={expandedCompactBranch === action.id}
                    onClick={() => setExpandedCompactBranch((previous) => previous === action.id ? null : action.id)}
                    data-testid={`hub-overview-branch-toggle-${action.workflowId}${action.workflowStage ? `-${action.workflowStage}` : ''}`}
                  >
                    ({action.number}) ↗ {action.children.length} tool ·{' '}
                    {action.children.filter((child) => child.state === 'done').length} ✓ ·{' '}
                    {action.children.filter((child) => child.state === 'error').length} ✕
                  </button>
                )}
                {(density !== 'compact' || expandedCompactBranch === action.id) && (
                  <span className='hub-tool-flow-branch-list'>
                {action.children.map((child, index) => (
                  <span className='hub-tool-flow-branch-row' key={child.id}>
                    <span className='hub-tool-flow-branch-arrow' aria-hidden='true'>
                      {index === 0 ? '↗' : index === action.children!.length - 1 ? '↘' : '→'}
                    </span>
                    <span
                      className={`hub-tool-flow-step hub-tool-flow-step--tool hub-log-line--${child.state}`}
                      title={child.label}
                      data-testid={`hub-overview-tool-${child.number}`}
                    >
                      <span className='hub-tool-flow-number'>({child.number})</span>{' '}
                      <span className='hub-tool-flow-label'>{child.label}</span>
                    </span>
                  </span>
                                ))}
                  </span>
                )}
              </span>
            ) : (
              <span
                className={`hub-tool-flow-step hub-tool-flow-step--tool hub-log-line--${action.children?.[0]?.state ?? action.state}`}
                title={action.children?.[0]?.label ?? action.label}
                data-testid={`hub-overview-tool-${action.children?.[0]?.number ?? action.number}`}
              >
                <span className='hub-tool-flow-number'>({action.children?.[0]?.number ?? action.number})</span>{' '}
                <span className='hub-tool-flow-label'>{action.children?.[0]?.label ?? action.label}</span>
              </span>
            )}
          </React.Fragment>
        ))}
        {showReply && lastMilestone && density !== 'compact' && (
          <>
            <span className='hub-tool-flow-arrow' aria-hidden='true'>
              →
            </span>
            <span className={`hub-tool-flow-step hub-log-line--${lastMilestone.state}`}>
              <span className='hub-tool-flow-number'>({nextNumber})</span>{' '}
              {t(`guid.hubHome.monitor.${lastMilestone.id}`, { defaultValue: 'Đang trả lời' })}
            </span>
          </>
        )}
        {finished && (
          <>
            <span className='hub-tool-flow-arrow' aria-hidden='true'>
              →
            </span>
            <span
              className={`hub-tool-flow-step hub-tool-flow-step--stage hub-log-line--${item.status === 'error' ? 'error' : 'done'}`}
              data-testid='hub-monitor-stage-finish'
            >
              <span className='hub-tool-flow-number'>({nextNumber})</span>{' '}
              {t('guid.hubHome.monitor.finish', { defaultValue: 'Đã kết thúc' })}
            </span>
          </>
        )}
      </div>
    </div>
  );
};
