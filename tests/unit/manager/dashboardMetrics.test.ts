/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { emptyManagerData, type CalendarEvent, type Note, type Task } from '@/process/manager/managerTypes';
import { buildManagerOverviewMetrics } from '@/renderer/pages/manager/components/dashboardMetrics';

const task = (patch: Partial<Task> & Pick<Task, 'id' | 'title'>): Task => ({
  id: patch.id,
  title: patch.title,
  kind: 'oneoff',
  priority: 'medium',
  status: 'todo',
  tags: [],
  subtasks: [],
  reminders: [],
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const event = (
  patch: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'title' | 'startAt' | 'endAt'>
): CalendarEvent => ({
  id: patch.id,
  title: patch.title,
  startAt: patch.startAt,
  endAt: patch.endAt,
  lockKind: 'fixed',
  source: 'manual',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const note = (patch: Partial<Note> & Pick<Note, 'id'>): Note => ({
  id: patch.id,
  category: 'learn',
  body: '',
  tags: [],
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

describe('buildManagerOverviewMetrics', () => {
  it('puts overdue work before later high-priority work and calculates completion', () => {
    const now = new Date(2026, 6, 18, 12).getTime();
    const data = {
      ...emptyManagerData(),
      tasks: [
        task({ id: 'later', title: 'Later urgent', priority: 'urgent', dueAt: now + 3_600_000 }),
        task({ id: 'overdue', title: 'Overdue medium', priority: 'medium', dueAt: now - 1_000 }),
        task({ id: 'done', title: 'Finished', status: 'done', completedAt: now - 2_000 }),
      ],
    };

    const metrics = buildManagerOverviewMetrics(data, now);

    expect(metrics.focusTasks.map((item) => item.id)).toEqual(['overdue', 'later']);
    expect(metrics.overdueTasks).toBe(1);
    expect(metrics.completionRate).toBe(33);
  });

  it('keeps only today events in the timeline while selecting the next future event', () => {
    const now = new Date(2026, 6, 18, 12).getTime();
    const morning = new Date(2026, 6, 18, 9).getTime();
    const afternoon = new Date(2026, 6, 18, 15).getTime();
    const tomorrow = new Date(2026, 6, 19, 8).getTime();
    const data = {
      ...emptyManagerData(),
      events: [
        event({ id: 'tomorrow', title: 'Tomorrow', startAt: tomorrow, endAt: tomorrow + 3_600_000 }),
        event({ id: 'afternoon', title: 'Afternoon', startAt: afternoon, endAt: afternoon + 3_600_000 }),
        event({ id: 'morning', title: 'Morning', startAt: morning, endAt: morning + 3_600_000 }),
      ],
    };

    const metrics = buildManagerOverviewMetrics(data, now);

    expect(metrics.eventsToday.map((item) => item.id)).toEqual(['morning', 'afternoon']);
    expect(metrics.nextEvent?.id).toBe('afternoon');
  });

  it('returns stable empty metrics and most recently updated notes', () => {
    const empty = buildManagerOverviewMetrics(emptyManagerData(), 100);
    expect(empty.completionRate).toBe(0);
    expect(empty.nextEvent).toBeNull();

    const data = {
      ...emptyManagerData(),
      notes: [note({ id: 'old', updatedAt: 10 }), note({ id: 'new', updatedAt: 20 })],
    };
    expect(buildManagerOverviewMetrics(data, 100).recentNotes.map((item) => item.id)).toEqual(['new', 'old']);
  });
});
