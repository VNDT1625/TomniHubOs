/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Progress, Tag } from '@arco-design/web-react';
import { Book, Calendar, CheckOne, Cpu, DashboardOne, FolderClose, Schedule, Search, Time } from '@icon-park/react';
import type { Priority } from '@process/manager/managerTypes';
import type { UseManagerStore } from '../useManagerStore';
import type { ManagerSection } from './ManagerSidebar';
import type { UseManagerCore } from './useManagerCore';
import { buildManagerOverviewMetrics } from './dashboardMetrics';
import styles from '../manager.module.css';

export type OverviewViewProps = {
  store: UseManagerStore;
  core: UseManagerCore;
  onNavigate: (section: ManagerSection) => void;
  onSearch: () => void;
};

const priorityColor = (priority: Priority): 'red' | 'orange' | 'blue' | 'gray' => {
  if (priority === 'urgent') return 'red';
  if (priority === 'high') return 'orange';
  if (priority === 'medium') return 'blue';
  return 'gray';
};

const formatTime = (timestamp: number): string =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(timestamp);

const formatDateTime = (timestamp: number): string =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    timestamp
  );

const OverviewView: React.FC<OverviewViewProps> = ({ store, core, onNavigate, onSearch }) => {
  const { t } = useTranslation();
  const metrics = useMemo(() => buildManagerOverviewMetrics(store.data), [store.data]);
  const availableTargets = core.targets.filter((target) => target.available).length;
  const enabledSchedules = core.scheduledTasks.filter((task) => task.enabled).length;

  const healthKey =
    core.status === 'unavailable'
      ? 'offline'
      : (core.doctor?.status ?? (core.status === 'loading' ? 'loading' : 'healthy'));

  return (
    <div className={styles.dashboardScroll}>
      <section className={styles.dashboardHero}>
        <div className={styles.dashboardHeroCopy}>
          <div className={styles.dashboardEyebrow}>
            <DashboardOne theme='outline' size='15' />
            {t('manager.workspace.todayCommand')}
          </div>
          <h1 className={styles.dashboardTitle}>{t('manager.workspace.overviewTitle')}</h1>
          <p className={styles.dashboardSubtitle}>{t('manager.workspace.overviewSubtitle')}</p>
        </div>
        <div className={styles.dashboardHeroActions}>
          <Button type='secondary' icon={<Search theme='outline' size='16' />} onClick={onSearch}>
            {t('manager.palette.button')}
          </Button>
          <Button type='primary' icon={<Calendar theme='outline' size='16' />} onClick={() => onNavigate('tasks')}>
            {t('manager.tasks.create')}
          </Button>
        </div>
      </section>

      <section className={styles.metricGrid}>
        <Button type='text' long className={styles.metricCard} onClick={() => onNavigate('tasks')}>
          <span className={styles.metricIcon}>
            <Calendar theme='outline' size='18' />
          </span>
          <span className={styles.metricValue}>{metrics.activeTasks}</span>
          <span className={styles.metricLabel}>{t('manager.workspace.metrics.activeTasks')}</span>
          <span className={styles.metricMeta}>
            {t('manager.workspace.metrics.overdue', { count: metrics.overdueTasks })}
          </span>
        </Button>
        <Button type='text' long className={styles.metricCard} onClick={() => onNavigate('schedule')}>
          <span className={styles.metricIcon}>
            <Schedule theme='outline' size='18' />
          </span>
          <span className={styles.metricValue}>{metrics.eventsToday.length}</span>
          <span className={styles.metricLabel}>{t('manager.workspace.metrics.eventsToday')}</span>
          <span className={styles.metricMeta}>
            {metrics.nextEvent
              ? t('manager.workspace.metrics.nextAt', { time: formatTime(metrics.nextEvent.startAt) })
              : t('manager.workspace.metrics.clearDay')}
          </span>
        </Button>
        <Button type='text' long className={styles.metricCard} onClick={() => onNavigate('learn')}>
          <span className={styles.metricIcon}>
            <Book theme='outline' size='18' />
          </span>
          <span className={styles.metricValue}>{store.data.notes.length}</span>
          <span className={styles.metricLabel}>{t('manager.workspace.metrics.notes')}</span>
          <span className={styles.metricMeta}>{t('manager.workspace.metrics.knowledgeBase')}</span>
        </Button>
        <Button type='text' long className={styles.metricCard} onClick={() => onNavigate('core')}>
          <span className={styles.metricIcon}>
            <Cpu theme='outline' size='18' />
          </span>
          <span className={styles.metricValue}>{core.activeRuns.length}</span>
          <span className={styles.metricLabel}>{t('manager.workspace.metrics.activeRuns')}</span>
          <span className={styles.metricMeta}>{t(`manager.core.status.${healthKey}`)}</span>
        </Button>
      </section>

      <section className={styles.dashboardGrid}>
        <div className={styles.dashboardPanel}>
          <div className={styles.dashboardPanelHeader}>
            <div>
              <div className={styles.dashboardPanelTitle}>{t('manager.workspace.focus.title')}</div>
              <div className={styles.dashboardPanelSubtitle}>{t('manager.workspace.focus.subtitle')}</div>
            </div>
            <Button type='text' size='small' onClick={() => onNavigate('tasks')}>
              {t('manager.workspace.viewAll')}
            </Button>
          </div>

          <div className={styles.progressSummary}>
            <div className={styles.progressSummaryTop}>
              <span>{t('manager.workspace.focus.completion')}</span>
              <strong>{metrics.completionRate}%</strong>
            </div>
            <Progress percent={metrics.completionRate} showText={false} size='small' />
          </div>

          <div className={styles.dashboardList}>
            {metrics.focusTasks.length === 0 ? (
              <div className={styles.dashboardEmpty}>
                <CheckOne theme='outline' size='22' />
                <span>{t('manager.workspace.focus.empty')}</span>
                <Button size='mini' type='secondary' onClick={() => onNavigate('tasks')}>
                  {t('manager.tasks.create')}
                </Button>
              </div>
            ) : (
              metrics.focusTasks.map((task) => (
                <div key={task.id} className={styles.dashboardListRow}>
                  <div className={styles.dashboardListIcon}>
                    <Calendar theme='outline' size='15' />
                  </div>
                  <div className={styles.dashboardListCopy}>
                    <div className={styles.dashboardListTitle}>{task.title}</div>
                    <div className={styles.dashboardListMeta}>
                      {task.dueAt ? formatDateTime(task.dueAt) : t('manager.tasks.noDue')}
                    </div>
                  </div>
                  <Tag size='small' color={priorityColor(task.priority)}>
                    {t(`manager.priority.${task.priority}`)}
                  </Tag>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={styles.dashboardPanel}>
          <div className={styles.dashboardPanelHeader}>
            <div>
              <div className={styles.dashboardPanelTitle}>{t('manager.workspace.timeline.title')}</div>
              <div className={styles.dashboardPanelSubtitle}>{t('manager.workspace.timeline.subtitle')}</div>
            </div>
            <Button type='text' size='small' onClick={() => onNavigate('schedule')}>
              {t('manager.workspace.viewCalendar')}
            </Button>
          </div>
          <div className={styles.dashboardList}>
            {metrics.eventsToday.length === 0 ? (
              <div className={styles.dashboardEmpty}>
                <Time theme='outline' size='22' />
                <span>{t('manager.workspace.timeline.empty')}</span>
                <Button size='mini' type='secondary' onClick={() => onNavigate('schedule')}>
                  {t('manager.schedule.create')}
                </Button>
              </div>
            ) : (
              metrics.eventsToday.slice(0, 5).map((event) => (
                <div key={event.id} className={styles.timelineRow}>
                  <div className={styles.timelineTime}>{formatTime(event.startAt)}</div>
                  <div className={styles.timelineLine} />
                  <div className={styles.dashboardListCopy}>
                    <div className={styles.dashboardListTitle}>{event.title}</div>
                    <div className={styles.dashboardListMeta}>
                      {event.location || t(`manager.schedule.${event.lockKind}`)}
                    </div>
                  </div>
                  <Tag size='small'>{t(`manager.schedule.${event.lockKind}`)}</Tag>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={styles.dashboardPanel}>
          <div className={styles.dashboardPanelHeader}>
            <div>
              <div className={styles.dashboardPanelTitle}>{t('manager.workspace.recent.title')}</div>
              <div className={styles.dashboardPanelSubtitle}>{t('manager.workspace.recent.subtitle')}</div>
            </div>
            <Button type='text' size='small' onClick={() => onNavigate('learn')}>
              {t('manager.workspace.viewAll')}
            </Button>
          </div>
          <div className={styles.dashboardList}>
            {metrics.recentNotes.length === 0 ? (
              <div className={styles.dashboardEmpty}>
                <FolderClose theme='outline' size='22' />
                <span>{t('manager.workspace.recent.empty')}</span>
                <Button size='mini' type='secondary' onClick={() => onNavigate('learn')}>
                  {t('manager.notes.create')}
                </Button>
              </div>
            ) : (
              metrics.recentNotes.map((note) => (
                <div key={note.id} className={styles.dashboardListRow}>
                  <div className={styles.dashboardListIcon}>
                    {note.category === 'learn' ? (
                      <Book theme='outline' size='15' />
                    ) : note.category === 'data' ? (
                      <FolderClose theme='outline' size='15' />
                    ) : (
                      <Calendar theme='outline' size='15' />
                    )}
                  </div>
                  <div className={styles.dashboardListCopy}>
                    <div className={styles.dashboardListTitle}>{note.title || t('manager.notes.untitled')}</div>
                    <div className={styles.dashboardListMeta}>{t(`manager.notes.cat.${note.category}`)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={`${styles.dashboardPanel} ${styles.corePulsePanel}`}>
          <div className={styles.dashboardPanelHeader}>
            <div>
              <div className={styles.dashboardPanelTitle}>{t('manager.workspace.corePulse.title')}</div>
              <div className={styles.dashboardPanelSubtitle}>{t('manager.workspace.corePulse.subtitle')}</div>
            </div>
            <Button type='text' size='small' onClick={() => onNavigate('core')}>
              {t('manager.workspace.openCore')}
            </Button>
          </div>
          <div className={styles.corePulseGrid}>
            <div>
              <span>{t('manager.workspace.corePulse.targets')}</span>
              <strong>{availableTargets}</strong>
            </div>
            <div>
              <span>{t('manager.workspace.corePulse.sessions')}</span>
              <strong>{core.sessions.length}</strong>
            </div>
            <div>
              <span>{t('manager.workspace.corePulse.automations')}</span>
              <strong>{enabledSchedules}</strong>
            </div>
          </div>
          <div className={styles.corePulseStatus}>
            <span
              className={`${styles.coreDot} ${styles[`coreDot${healthKey.charAt(0).toUpperCase()}${healthKey.slice(1)}`] ?? ''}`}
            />
            <span>{t(`manager.core.status.${healthKey}`)}</span>
            {core.doctor && (
              <span className={styles.corePulseRate}>
                {t('manager.workspace.corePulse.completion', {
                  rate: Math.round(core.doctor.metrics.completionRate * 100),
                })}
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default OverviewView;
