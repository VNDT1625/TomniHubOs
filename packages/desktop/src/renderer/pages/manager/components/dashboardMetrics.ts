/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CalendarEvent, ManagerData, Note, Priority, Task } from '@process/manager/managerTypes';

export type ManagerOverviewMetrics = {
  activeTasks: number;
  overdueTasks: number;
  dueTodayTasks: number;
  completedTasks: number;
  completionRate: number;
  eventsToday: CalendarEvent[];
  nextEvent: CalendarEvent | null;
  focusTasks: Task[];
  recentNotes: Note[];
};

const priorityRank: Record<Priority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export const startOfLocalDay = (timestamp: number): number => {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export const isSameLocalDay = (left: number, right: number): boolean =>
  startOfLocalDay(left) === startOfLocalDay(right);

/** Build the compact day-level projection used by the Manager overview. */
export const buildManagerOverviewMetrics = (
  data: Pick<ManagerData, 'tasks' | 'notes' | 'events'>,
  now = Date.now()
): ManagerOverviewMetrics => {
  const active = data.tasks.filter((task) => task.status !== 'done');
  const completed = data.tasks.filter((task) => task.status === 'done');
  const overdue = active.filter((task) => typeof task.dueAt === 'number' && task.dueAt < now);
  const dueToday = active.filter((task) => typeof task.dueAt === 'number' && isSameLocalDay(task.dueAt, now));
  const total = data.tasks.length;

  const eventsToday = data.events
    .filter((event) => isSameLocalDay(event.startAt, now))
    .toSorted((left, right) => left.startAt - right.startAt);

  const nextEvent =
    data.events.filter((event) => event.endAt >= now).toSorted((left, right) => left.startAt - right.startAt)[0] ??
    null;

  const focusTasks = active
    .toSorted((left, right) => {
      const leftOverdue = typeof left.dueAt === 'number' && left.dueAt < now ? 1 : 0;
      const rightOverdue = typeof right.dueAt === 'number' && right.dueAt < now ? 1 : 0;
      if (leftOverdue !== rightOverdue) return rightOverdue - leftOverdue;
      const priorityDelta = priorityRank[right.priority] - priorityRank[left.priority];
      if (priorityDelta !== 0) return priorityDelta;
      return (left.dueAt ?? Number.MAX_SAFE_INTEGER) - (right.dueAt ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, 5);

  const recentNotes = data.notes.toSorted((left, right) => right.updatedAt - left.updatedAt).slice(0, 4);

  return {
    activeTasks: active.length,
    overdueTasks: overdue.length,
    dueTodayTasks: dueToday.length,
    completedTasks: completed.length,
    completionRate: total === 0 ? 0 : Math.round((completed.length / total) * 100),
    eventsToday,
    nextEvent,
    focusTasks,
    recentNotes,
  };
};
