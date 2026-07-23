/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Manager control centre.
 *
 * The shell keeps navigation visible, adds a day-level overview and projects
 * the native Tomny Core into a dedicated operational surface. Existing task,
 * note and schedule views remain the feature owners for editing workflows.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Spin } from '@arco-design/web-react';
import { Schedule, Search, Theme } from '@icon-park/react';
import type { ManagerAppearance } from '@process/manager/managerTypes';
import { useManagerStore } from './useManagerStore';
import TasksView from './tasks/TasksView';
import DailyView from './notes/DailyView';
import LearnView from './notes/LearnView';
import DataView from './notes/DataView';
import ScheduleView from './schedule/ScheduleView';
import { appearanceStyle } from './components/appearance';
import AppearanceModal from './components/AppearanceModal';
import CommandPalette, { type ManagerTab } from './components/CommandPalette';
import ManagerSidebar, { type ManagerSection } from './components/ManagerSidebar';
import OverviewView from './components/OverviewView';
import CoreView from './components/CoreView';
import { useManagerCore } from './components/useManagerCore';
import { buildManagerOverviewMetrics } from './components/dashboardMetrics';
import styles from './manager.module.css';

const fallbackAppearance: ManagerAppearance = {
  accent: 'blue',
  font: 'default',
  density: 'comfortable',
  fontSize: 14,
  tintedBackground: false,
};

const BridgeNotice: React.FC<{ onRetry: () => void }> = ({ onRetry }) => {
  const { t } = useTranslation();
  return (
    <div className={styles.bridgeNotice}>
      <Schedule theme='outline' size='40' />
      <div>{t('manager.bridgeUnavailable')}</div>
      <Button type='primary' onClick={onRetry}>
        {t('manager.retry')}
      </Button>
    </div>
  );
};

const ManagerPage: React.FC = () => {
  const { t } = useTranslation();
  const store = useManagerStore();
  const core = useManagerCore();
  const [section, setSection] = useState<ManagerSection>('overview');
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);

  const appearance = store.data.settings.appearance ?? fallbackAppearance;
  const overview = useMemo(() => buildManagerOverviewMetrics(store.data), [store.data]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((visible) => !visible);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navigateFromPalette = (tab: ManagerTab, id?: string) => {
    if (tab === 'tasks') {
      setSection('tasks');
      return;
    }
    if (tab === 'schedule') {
      setSection('schedule');
      return;
    }

    const note = id ? store.data.notes.find((candidate) => candidate.id === id) : undefined;
    const category = note?.category ?? 'daily';
    setSection(category === 'learn' ? 'learn' : category === 'data' ? 'data' : 'daily');
    if (id) setFocusNoteId(id);
  };

  const sectionLabel = useMemo(() => {
    if (section === 'overview') return t('manager.workspace.nav.overview');
    if (section === 'tasks') return t('manager.tabs.tasks');
    if (section === 'schedule') return t('manager.tabs.schedule');
    if (section === 'core') return t('manager.workspace.nav.core');
    return t(`manager.notes.cat.${section}`);
  }, [section, t]);

  const sectionDescription = useMemo(() => {
    if (section === 'overview') return t('manager.workspace.descriptions.overview');
    if (section === 'tasks') return t('manager.workspace.descriptions.tasks');
    if (section === 'schedule') return t('manager.workspace.descriptions.schedule');
    if (section === 'core') return t('manager.workspace.descriptions.core');
    return t(`manager.workspace.descriptions.${section}`);
  }, [section, t]);

  return (
    <div className={styles.root} style={appearanceStyle(appearance)}>
      <div className={styles.managerShell}>
        {store.status === 'ready' && (
          <ManagerSidebar
            active={section}
            onChange={setSection}
            onSearch={() => setPaletteOpen(true)}
            onAppearance={() => setAppearanceOpen(true)}
            counts={{
              tasks: overview.activeTasks,
              overdue: overview.overdueTasks,
              notes: store.data.notes.filter((note) => note.category === 'data').length,
              eventsToday: overview.eventsToday.length,
              activeRuns: core.activeRuns.length,
            }}
            coreStatus={core.status}
            coreHealth={core.doctor?.status}
          />
        )}

        <main className={styles.managerContent}>
          {store.status === 'loading' && (
            <div className={styles.managerLoading}>
              <Spin tip={t('manager.loading')} />
            </div>
          )}

          {store.status === 'unavailable' && <BridgeNotice onRetry={store.reload} />}

          {store.status === 'ready' && (
            <>
              <header className={styles.managerTopbar}>
                <div className={styles.managerTopbarCopy}>
                  <div className={styles.managerBreadcrumb}>
                    <span>{t('manager.title')}</span>
                    <span>/</span>
                    <strong>{sectionLabel}</strong>
                  </div>
                  <div className={styles.managerSectionDescription}>{sectionDescription}</div>
                </div>
                <div className={styles.managerTopbarActions}>
                  <Button
                    type='text'
                    icon={<Search theme='outline' size='16' />}
                    onClick={() => setPaletteOpen(true)}
                    aria-label={t('manager.palette.tooltip')}
                  />
                  <Button
                    type='text'
                    icon={<Theme theme='outline' size='16' />}
                    onClick={() => setAppearanceOpen(true)}
                    aria-label={t('manager.appearance.title')}
                  />
                </div>
              </header>

              <div className={styles.managerSectionBody}>
                {section === 'overview' && (
                  <OverviewView
                    store={store}
                    core={core}
                    onNavigate={setSection}
                    onSearch={() => setPaletteOpen(true)}
                  />
                )}
                {section === 'tasks' && <TasksView store={store} />}
                {section === 'daily' && <DailyView store={store} />}
                {section === 'learn' && (
                  <LearnView store={store} focusId={focusNoteId} onFocusConsumed={() => setFocusNoteId(null)} />
                )}
                {section === 'data' && <DataView store={store} />}
                {section === 'schedule' && <ScheduleView store={store} />}
                {section === 'core' && <CoreView core={core} />}
              </div>
            </>
          )}
        </main>
      </div>

      {appearanceOpen && <AppearanceModal store={store} onClose={() => setAppearanceOpen(false)} />}
      <CommandPalette
        visible={paletteOpen}
        tasks={store.data.tasks}
        notes={store.data.notes}
        events={store.data.events}
        onClose={() => setPaletteOpen(false)}
        onNavigate={navigateFromPalette}
      />
    </div>
  );
};

export default ManagerPage;
