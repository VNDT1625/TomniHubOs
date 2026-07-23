/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure date helpers, conflict detection and time-grid layout for the Schedule tab.
 * Renderer-only.
 */

import type { CalendarEvent } from '@process/manager/managerTypes';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
export const CALENDAR_START_HOUR = 6;
export const CALENDAR_END_HOUR = 22;
export const CALENDAR_HOUR_HEIGHT = 64;

export type CalendarEventLayout = {
  event: CalendarEvent;
  topMinutes: number;
  durationMinutes: number;
  column: number;
  columns: number;
};

type WorkingLayout = {
  event: CalendarEvent;
  startAt: number;
  endAt: number;
};

/** Start of the local day for `ts`. */
export const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Start of the local week (Monday) for `ts`. */
export const startOfWeek = (ts: number): number => {
  const d = new Date(startOfDay(ts));
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d.getTime();
};

/** The seven day-start timestamps of the week containing `ts`. */
export const weekDays = (ts: number): number[] => {
  const start = startOfWeek(ts);
  return Array.from({ length: 7 }, (_, i) => start + i * DAY_MS);
};

/** Events overlapping a [from, to) range, sorted by start. */
export const eventsInRange = (events: CalendarEvent[], from: number, to: number): CalendarEvent[] =>
  events.filter((event) => event.endAt > from && event.startAt < to).toSorted((a, b) => a.startAt - b.startAt);

/** Count overlapping event pairs in a list (for the conflict warning). */
export const countConflicts = (events: CalendarEvent[]): number => {
  const sorted = events.toSorted((a, b) => a.startAt - b.startAt);
  let conflicts = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (sorted[j].startAt >= sorted[i].endAt) break;
      conflicts += 1;
    }
  }
  return conflicts;
};

/**
 * Lay out one day's visible events for an hourly calendar grid.
 * Overlapping events are assigned deterministic side-by-side columns.
 */
export const layoutEventsForDay = (
  events: CalendarEvent[],
  dayStart: number,
  startHour = CALENDAR_START_HOUR,
  endHour = CALENDAR_END_HOUR
): CalendarEventLayout[] => {
  const dayEnd = dayStart + DAY_MS;
  const visibleStart = dayStart + startHour * 60 * MINUTE_MS;
  const visibleEnd = dayStart + endHour * 60 * MINUTE_MS;
  const visible = eventsInRange(events, dayStart, dayEnd)
    .map<WorkingLayout>((event) => ({
      event,
      startAt: Math.max(event.startAt, visibleStart),
      endAt: Math.min(event.endAt, visibleEnd),
    }))
    .filter((item) => item.endAt > item.startAt)
    .toSorted((a, b) => a.startAt - b.startAt || a.endAt - b.endAt);

  const clusters: WorkingLayout[][] = [];
  let currentCluster: WorkingLayout[] = [];
  let currentClusterEnd = 0;

  visible.forEach((item) => {
    if (currentCluster.length > 0 && item.startAt >= currentClusterEnd) {
      clusters.push(currentCluster);
      currentCluster = [];
      currentClusterEnd = 0;
    }
    currentCluster.push(item);
    currentClusterEnd = Math.max(currentClusterEnd, item.endAt);
  });
  if (currentCluster.length > 0) clusters.push(currentCluster);

  return clusters.flatMap((cluster) => {
    const columnEnds: number[] = [];
    const assigned = cluster.map((item) => {
      let column = columnEnds.findIndex((endAt) => endAt <= item.startAt);
      if (column === -1) column = columnEnds.length;
      columnEnds[column] = item.endAt;
      return { item, column };
    });
    const columns = Math.max(1, columnEnds.length);

    return assigned.map(({ item, column }) => ({
      event: item.event,
      topMinutes: (item.startAt - visibleStart) / MINUTE_MS,
      durationMinutes: Math.max(15, (item.endAt - item.startAt) / MINUTE_MS),
      column,
      columns,
    }));
  });
};

/** Format a time range like "09:00–10:30". */
export const formatTimeRange = (startAt: number, endAt: number, locale?: string): string => {
  const formatter = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  return `${formatter.format(startAt)}–${formatter.format(endAt)}`;
};
