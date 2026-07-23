import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@/process/manager/managerTypes';
import {
  CALENDAR_START_HOUR,
  countConflicts,
  layoutEventsForDay,
  startOfDay,
} from '@/renderer/pages/manager/schedule/scheduleUtils';

const event = (id: string, dayStart: number, startHour: number, endHour: number): CalendarEvent => ({
  id,
  title: id,
  startAt: dayStart + startHour * 60 * 60_000,
  endAt: dayStart + endHour * 60 * 60_000,
  lockKind: 'flexible',
  source: 'manual',
  createdAt: dayStart,
  updatedAt: dayStart,
});

describe('schedule time-grid layout', () => {
  const dayStart = startOfDay(new Date(2026, 6, 20, 12).getTime());

  it('places non-overlapping events in the full day column', () => {
    const layouts = layoutEventsForDay(
      [event('morning', dayStart, 8, 9), event('afternoon', dayStart, 14, 15)],
      dayStart
    );

    expect(layouts.map(({ column, columns }) => ({ column, columns }))).toEqual([
      { column: 0, columns: 1 },
      { column: 0, columns: 1 },
    ]);
    expect(layouts[0].topMinutes).toBe((8 - CALENDAR_START_HOUR) * 60);
  });

  it('places overlapping events in deterministic side-by-side columns', () => {
    const layouts = layoutEventsForDay([event('first', dayStart, 9, 11), event('second', dayStart, 10, 12)], dayStart);

    expect(layouts).toHaveLength(2);
    expect(layouts[0]).toMatchObject({ column: 0, columns: 2 });
    expect(layouts[1]).toMatchObject({ column: 1, columns: 2 });
  });

  it('clips events to the visible calendar range', () => {
    const layouts = layoutEventsForDay([event('early', dayStart, 5, 6.5), event('late', dayStart, 21.5, 23)], dayStart);

    expect(layouts[0]).toMatchObject({ topMinutes: 0, durationMinutes: 30 });
    expect(layouts[1]).toMatchObject({ topMinutes: 15.5 * 60, durationMinutes: 30 });
  });

  it('counts every overlapping pair for the conflict warning', () => {
    const events = [event('a', dayStart, 9, 12), event('b', dayStart, 10, 11), event('c', dayStart, 10.5, 13)];

    expect(countConflicts(events)).toBe(3);
  });
});
