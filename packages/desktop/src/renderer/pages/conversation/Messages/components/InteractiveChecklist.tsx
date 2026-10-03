/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Button, Card, Checkbox, Progress, Tag, Tooltip } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { CheckOne, Play, PauseOne, CloseOne, Time, Schedule, Caution } from '@icon-park/react';
import classNames from 'classnames';

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'paused' | 'blocked' | 'skipped';

export interface ChecklistItem {
  id: string;
  label: string;
  status: TaskStatus;
  dependsOn?: string[];
  assignee: 'agent' | 'user';
  isLongRunning?: boolean;
  notes?: string;
}

export interface InteractiveChecklistProps {
  title?: string;
  items: ChecklistItem[];
  onUpdateStatus?: (id: string, nextStatus: TaskStatus) => void;
  onConvertToSchedule?: (item: ChecklistItem) => void;
}

/**
 * Computes effective task statuses based on DAG dependencies.
 * If any dependency is not 'done', dependent tasks are marked as 'blocked'.
 */
export function resolveTaskDependencies(
  items: ChecklistItem[]
): Array<ChecklistItem & { effectiveStatus: TaskStatus; blockingDependency?: string }> {
  const statusMap = new Map<string, TaskStatus>();
  for (const item of items) {
    statusMap.set(item.id, item.status);
  }

  return items.map((item) => {
    if (item.status === 'done' || item.status === 'skipped') {
      return { ...item, effectiveStatus: item.status };
    }

    if (item.dependsOn && item.dependsOn.length > 0) {
      for (const depId of item.dependsOn) {
        const depStatus = statusMap.get(depId);
        if (depStatus !== 'done') {
          return {
            ...item,
            effectiveStatus: 'blocked',
            blockingDependency: depId,
          };
        }
      }
    }

    return { ...item, effectiveStatus: item.status };
  });
}

export const InteractiveChecklist: React.FC<InteractiveChecklistProps> = ({
  title = 'Tiến độ công việc & Kế hoạch',
  items,
  onUpdateStatus,
  onConvertToSchedule,
}) => {
  const { t } = useTranslation();

  const resolvedItems = useMemo(() => resolveTaskDependencies(items), [items]);

  const progressPercent = useMemo(() => {
    if (items.length === 0) return 0;
    const completed = items.filter((i) => i.status === 'done' || i.status === 'skipped').length;
    return Math.round((completed / items.length) * 100);
  }, [items]);

  return (
    <Card
      className='w-full max-w-780px my-10px rd-16px b-1 b-solid'
      style={{
        background: 'var(--bg-1)',
        borderColor: 'var(--color-border-2)',
      }}
      data-testid='interactive-checklist'
    >
      <div className='flex flex-col gap-12px'>
        {/* Header with Title and Progress */}
        <div className='flex items-center justify-between gap-12px'>
          <div className='flex items-center gap-8px'>
            <span className='text-16px font-700 text-t-primary'>{title}</span>
            <Tag size='small' color='arcoblue'>
              {progressPercent}% Hoàn thành
            </Tag>
          </div>
          <div className='w-120px'>
            <Progress percent={progressPercent} size='small' showText={false} />
          </div>
        </div>

        {/* Task Items List */}
        <div className='flex flex-col gap-6px'>
          {resolvedItems.map((item) => {
            const isDone = item.effectiveStatus === 'done';
            const isBlocked = item.effectiveStatus === 'blocked';
            const isPaused = item.effectiveStatus === 'paused';
            const isInProgress = item.effectiveStatus === 'in_progress';

            return (
              <div
                key={item.id}
                className={classNames(
                  'flex items-center justify-between gap-8px p-8px rd-8px transition-all b-1 b-solid',
                  {
                    'bg-fill-1 b-transparent': !isBlocked && !isInProgress,
                    'bg-aou-1 b-aou-3': isInProgress,
                    'bg-fill-2 b-dashed b-border-2 opacity-75': isBlocked,
                  }
                )}
                data-testid={`checklist-item-${item.id}`}
              >
                <div className='flex items-center gap-8px min-w-0 flex-1'>
                  {item.assignee === 'user' ? (
                    <Checkbox
                      checked={isDone}
                      disabled={isBlocked}
                      onChange={(checked) => {
                        onUpdateStatus?.(item.id, checked ? 'done' : 'todo');
                      }}
                    />
                  ) : (
                    <div className='flex-shrink-0'>
                      {isDone ? (
                        <CheckOne theme='filled' size='16' fill='rgb(var(--success-6))' />
                      ) : isInProgress ? (
                        <div className='w-16px h-16px rd-full border-2 border-solid border-primary-6 border-t-transparent animate-spin' />
                      ) : isPaused ? (
                        <PauseOne theme='filled' size='16' fill='rgb(var(--warning-6))' />
                      ) : isBlocked ? (
                        <Caution theme='outline' size='16' fill='rgb(var(--danger-6))' />
                      ) : (
                        <div className='w-14px h-14px rd-full b-1 b-solid b-border-3' />
                      )}
                    </div>
                  )}

                  <div className='min-w-0 flex-1'>
                    <div
                      className={classNames('text-13px', {
                        'line-through text-t-tertiary': isDone,
                        'font-600 text-t-primary': isInProgress,
                        'text-t-secondary': isBlocked || isPaused,
                        'text-t-primary': !isDone && !isInProgress && !isBlocked,
                      })}
                    >
                      {item.label}
                    </div>

                    {isBlocked && item.blockingDependency && (
                      <div className='text-11px text-danger-6 mt-2px'>
                        ⚠️ Đang bị chặn bởi bước {item.blockingDependency}
                      </div>
                    )}
                  </div>
                </div>

                {/* Badges & Actions */}
                <div className='flex items-center gap-6px flex-shrink-0'>
                  <Tag size='small' color={item.assignee === 'agent' ? 'purple' : 'gray'}>
                    {item.assignee === 'agent' ? 'Agent' : 'Bạn'}
                  </Tag>

                  {/* Long running task convert to /schedule */}
                  {item.isLongRunning && onConvertToSchedule && !isDone && (
                    <Tooltip content='Tác vụ dài ngày - Chuyển sang lịch định kỳ /schedule'>
                      <Button
                        size='mini'
                        type='text'
                        icon={<Schedule theme='outline' size='14' />}
                        onClick={() => onConvertToSchedule(item)}
                      >
                        /schedule
                      </Button>
                    </Tooltip>
                  )}

                  {/* Agent Task Controls */}
                  {item.assignee === 'agent' && !isDone && !isBlocked && (
                    <>
                      {isInProgress ? (
                        <Button
                          size='mini'
                          type='secondary'
                          icon={<PauseOne theme='outline' size='14' />}
                          onClick={() => onUpdateStatus?.(item.id, 'paused')}
                          title='Tạm dừng'
                        />
                      ) : isPaused ? (
                        <Button
                          size='mini'
                          type='primary'
                          icon={<Play theme='filled' size='14' />}
                          onClick={() => onUpdateStatus?.(item.id, 'in_progress')}
                          title='Tiếp tục'
                        />
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
};

export default InteractiveChecklist;
