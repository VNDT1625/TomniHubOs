/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Message, Progress, Spin, Tag } from '@arco-design/web-react';
import { CheckOne, CloseOne, Cpu, PlayOne, Refresh, Schedule, Time } from '@icon-park/react';
import type { UseManagerCore } from './useManagerCore';
import type { ManagerCoreDoctorReport, ManagerCoreScheduledTask } from './managerCoreClient';
import styles from '../manager.module.css';
import tomnyAgenticIcon from '@/renderer/assets/tomny-agentic-icon.svg';

const formatDateTime = (timestamp: number): string =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    timestamp
  );

const CoreView: React.FC<{ core: UseManagerCore }> = ({ core }) => {
  const { t } = useTranslation();
  const describeSchedule = (task: ManagerCoreScheduledTask): string => {
    if (task.schedule.kind === 'cron') return task.schedule.expression;
    if (task.schedule.kind === 'once') return formatDateTime(task.schedule.at);
    if (task.schedule.kind === 'interval') {
      return t('manager.core.automations.intervalMinutes', { count: Math.round(task.schedule.everyMs / 60_000) });
    }
    return t('manager.core.automations.manual');
  };
  const [busyId, setBusyId] = useState<string | null>(null);
  const availableTargets = core.targets.filter((target) => target.available);
  const groupedChecks = useMemo(() => {
    const checks = core.doctor?.checks ?? [];
    const visibleChecks = checks.some((check) => check.status !== 'pass')
      ? checks.filter((check) => check.status !== 'pass')
      : checks.slice(0, 5);
    const groups = new Map<string, { check: ManagerCoreDoctorReport['checks'][number]; count: number }>();
    visibleChecks.forEach((check) => {
      const key = `${check.status}:${check.summary}`;
      const current = groups.get(key);
      if (current) {
        current.count += 1;
      } else {
        groups.set(key, { check, count: 1 });
      }
    });
    return [...groups.values()];
  }, [core.doctor]);
  const completionPercent = Math.round((core.doctor?.metrics.completionRate ?? 0) * 100);

  const runSchedule = async (id: string) => {
    setBusyId(id);
    const ok = await core.runScheduledTask(id);
    setBusyId(null);
    Message[ok ? 'success' : 'error'](t(ok ? 'manager.core.actions.runSuccess' : 'manager.core.actions.failed'));
  };

  const cancelRun = async (requestId: string) => {
    setBusyId(requestId);
    const ok = await core.cancelRun(requestId);
    setBusyId(null);
    Message[ok ? 'success' : 'error'](t(ok ? 'manager.core.actions.cancelSuccess' : 'manager.core.actions.failed'));
  };

  if (core.status === 'loading' && !core.lastUpdatedAt) {
    return (
      <div className={styles.coreLoading}>
        <Spin tip={t('manager.core.loading')} />
      </div>
    );
  }

  return (
    <div className={styles.dashboardScroll}>
      <section className={styles.coreHeader}>
        <div className={styles.coreIdentity}>
          <img src={tomnyAgenticIcon} alt='' className={styles.coreIdentityIcon} />
          <div>
            <div className={styles.dashboardEyebrow}>
              <Cpu theme='outline' size='15' />
              Tomny Agentic · {t('manager.core.nativeRuntime')}
            </div>
            <h1 className={styles.dashboardTitle}>{t('manager.core.title')}</h1>
            <p className={styles.dashboardSubtitle}>{t('manager.core.subtitle')}</p>
          </div>
        </div>
        <Button
          type='secondary'
          icon={<Refresh theme='outline' size='16' />}
          loading={core.status === 'loading'}
          onClick={() => void core.refresh()}
        >
          {t('manager.core.actions.refresh')}
        </Button>
      </section>

      {core.status === 'unavailable' && (
        <div className={styles.coreUnavailable}>
          <Cpu theme='outline' size='22' />
          <div>
            <strong>{t('manager.core.unavailableTitle')}</strong>
            <span>{t('manager.core.unavailableDescription')}</span>
          </div>
        </div>
      )}

      <section className={styles.coreMetricGrid}>
        <div className={styles.coreMetricCard}>
          <span>{t('manager.core.metrics.health')}</span>
          <strong>
            {t(`manager.core.status.${core.doctor?.status ?? (core.status === 'unavailable' ? 'offline' : 'loading')}`)}
          </strong>
          <small>{t('manager.core.metrics.checked', { count: core.doctor?.checks.length ?? 0 })}</small>
        </div>
        <div className={styles.coreMetricCard}>
          <span>{t('manager.core.metrics.targets')}</span>
          <strong>{availableTargets.length}</strong>
          <small>{t('manager.core.metrics.ofTotal', { total: core.targets.length })}</small>
        </div>
        <div className={styles.coreMetricCard}>
          <span>{t('manager.core.metrics.activeRuns')}</span>
          <strong>{core.activeRuns.length}</strong>
          <small>{t('manager.core.metrics.sessions', { count: core.sessions.length })}</small>
        </div>
        <div className={styles.coreMetricCard}>
          <span>{t('manager.core.metrics.automations')}</span>
          <strong>{core.scheduledTasks.filter((task) => task.enabled).length}</strong>
          <small>{t('manager.core.metrics.scheduledTotal', { count: core.scheduledTasks.length })}</small>
        </div>
      </section>

      <section className={styles.coreLayout}>
        <div className={styles.dashboardPanel}>
          <div className={styles.dashboardPanelHeader}>
            <div>
              <div className={styles.dashboardPanelTitle}>{t('manager.core.health.title')}</div>
              <div className={styles.dashboardPanelSubtitle}>{t('manager.core.health.subtitle')}</div>
            </div>
            {core.doctor && (
              <Tag
                color={
                  core.doctor.status === 'healthy' ? 'green' : core.doctor.status === 'degraded' ? 'orange' : 'red'
                }
              >
                {t(`manager.core.status.${core.doctor.status}`)}
              </Tag>
            )}
          </div>
          <div className={styles.coreCompletion}>
            <div>
              <span>{t('manager.core.health.completionRate')}</span>
              <strong>{completionPercent}%</strong>
            </div>
            <Progress percent={completionPercent} showText={false} />
          </div>
          <div className={styles.coreCheckList}>
            {groupedChecks.map(({ check, count }) => (
              <div key={`${check.status}:${check.summary}`} className={styles.coreCheckRow}>
                <span className={check.status === 'pass' ? styles.coreCheckPass : styles.coreCheckProblem}>
                  {check.status === 'pass' ? (
                    <CheckOne theme='outline' size='15' />
                  ) : (
                    <CloseOne theme='outline' size='15' />
                  )}
                </span>
                <div className={styles.coreCheckCopy}>
                  <strong>{check.summary}</strong>
                  <small>{check.targetId || check.id}</small>
                </div>
                {count > 1 && <Tag size='small'>{count}×</Tag>}
              </div>
            ))}
            {!core.doctor && <div className={styles.dashboardEmpty}>{t('manager.core.health.noReport')}</div>}
          </div>
        </div>

        <div className={styles.dashboardPanel}>
          <div className={styles.dashboardPanelHeader}>
            <div>
              <div className={styles.dashboardPanelTitle}>{t('manager.core.runs.title')}</div>
              <div className={styles.dashboardPanelSubtitle}>{t('manager.core.runs.subtitle')}</div>
            </div>
          </div>
          <div className={styles.dashboardList}>
            {core.activeRuns.length === 0 ? (
              <div className={styles.dashboardEmpty}>
                <CheckOne theme='outline' size='22' />
                <span>{t('manager.core.runs.empty')}</span>
              </div>
            ) : (
              core.activeRuns.map((run) => (
                <div key={run.requestId} className={styles.coreRunRow}>
                  <div className={styles.coreRunPulse} />
                  <div className={styles.dashboardListCopy}>
                    <div className={styles.dashboardListTitle}>{run.targetId}</div>
                    <div className={styles.dashboardListMeta}>
                      {t('manager.core.runs.started', { time: formatDateTime(run.startedAt) })}
                    </div>
                    {run.partialText && <div className={styles.coreRunPreview}>{run.partialText}</div>}
                  </div>
                  <Button
                    type='secondary'
                    status='danger'
                    size='small'
                    loading={busyId === run.requestId}
                    icon={<CloseOne theme='outline' size='13' />}
                    onClick={() => void cancelRun(run.requestId)}
                  >
                    {t('manager.core.actions.cancel')}
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={`${styles.dashboardPanel} ${styles.coreWidePanel}`}>
          <div className={styles.dashboardPanelHeader}>
            <div>
              <div className={styles.dashboardPanelTitle}>{t('manager.core.automations.title')}</div>
              <div className={styles.dashboardPanelSubtitle}>{t('manager.core.automations.subtitle')}</div>
            </div>
          </div>
          <div className={styles.coreTable}>
            {core.scheduledTasks.length === 0 ? (
              <div className={styles.dashboardEmpty}>
                <Schedule theme='outline' size='22' />
                <span>{t('manager.core.automations.empty')}</span>
              </div>
            ) : (
              core.scheduledTasks.map((task) => (
                <div key={task.id} className={styles.coreAutomationRow}>
                  <div className={styles.dashboardListIcon}>
                    <Schedule theme='outline' size='15' />
                  </div>
                  <div className={styles.dashboardListCopy}>
                    <div className={styles.dashboardListTitle}>{task.name}</div>
                    <div className={styles.dashboardListMeta}>
                      {describeSchedule(task)} · {task.target.targetId}
                    </div>
                  </div>
                  <Tag size='small' color={task.enabled ? 'green' : 'gray'}>
                    {t(`manager.core.automations.${task.enabled ? 'enabled' : 'disabled'}`)}
                  </Tag>
                  <div className={styles.coreAutomationTime}>
                    <Time theme='outline' size='13' />
                    {task.runtime.nextRunAt
                      ? formatDateTime(task.runtime.nextRunAt)
                      : t('manager.core.automations.manual')}
                  </div>
                  <Button
                    type='secondary'
                    size='small'
                    loading={busyId === task.id}
                    icon={<PlayOne theme='outline' size='13' />}
                    onClick={() => void runSchedule(task.id)}
                  >
                    {t('manager.core.actions.runNow')}
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={`${styles.dashboardPanel} ${styles.coreWidePanel}`}>
          <div className={styles.dashboardPanelHeader}>
            <div>
              <div className={styles.dashboardPanelTitle}>{t('manager.core.targets.title')}</div>
              <div className={styles.dashboardPanelSubtitle}>{t('manager.core.targets.subtitle')}</div>
            </div>
          </div>
          <div className={styles.coreTargetGrid}>
            {core.targets.map((target) => (
              <div key={target.id} className={styles.coreTargetCard}>
                <span
                  className={`${styles.coreDot} ${target.available ? styles.coreDotHealthy : styles.coreDotUnavailable}`}
                />
                <div>
                  <strong>{target.name}</strong>
                  <small>
                    {target.kind} · {t('manager.core.targets.models', { count: target.models.length })}
                  </small>
                  {target.detail && <p>{target.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default CoreView;
