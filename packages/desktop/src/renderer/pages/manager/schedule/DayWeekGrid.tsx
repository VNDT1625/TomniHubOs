/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Localized hourly calendar grid for day/week views. Events are positioned by
 * time and overlapping blocks share the available horizontal space.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@process/manager/managerTypes';
import {
  CALENDAR_END_HOUR,
  CALENDAR_HOUR_HEIGHT,
  CALENDAR_START_HOUR,
  layoutEventsForDay,
  startOfDay,
} from './scheduleUtils';
import EventCard from './EventCard';
import styles from '../manager.module.css';

type Props = {
  view: 'day' | 'week';
  /** Day-start timestamps to render as columns. */
  days: number[];
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
};

const HOURS = Array.from(
  { length: CALENDAR_END_HOUR - CALENDAR_START_HOUR },
  (_, index) => CALENDAR_START_HOUR + index
);
const GRID_HEIGHT = (CALENDAR_END_HOUR - CALENDAR_START_HOUR) * CALENDAR_HOUR_HEIGHT;

const DayWeekGrid: React.FC<Props> = ({ view, days, events, onEventClick }) => {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language;
  const now = Date.now();
  const today = startOfDay(now);
  const nowMinutes = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  const currentTimeTop = ((nowMinutes - CALENDAR_START_HOUR * 60) / 60) * CALENDAR_HOUR_HEIGHT;
  const showCurrentTime = nowMinutes >= CALENDAR_START_HOUR * 60 && nowMinutes <= CALENDAR_END_HOUR * 60;
  const weekdayFormatter = new Intl.DateTimeFormat(locale, { weekday: view === 'week' ? 'short' : 'long' });
  const dateFormatter = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
  const timeFormatter = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const gridStyle = {
    ['--calendar-days' as string]: String(days.length),
    ['--calendar-height' as string]: `${GRID_HEIGHT}px`,
  } as React.CSSProperties;

  return (
    <div className={styles.calendarViewport}>
      <div
        className={`${styles.calendarGrid} ${view === 'week' ? styles.calendarGridWeek : styles.calendarGridDay}`}
        style={gridStyle}
      >
        <div className={styles.calendarCorner} />
        {days.map((day) => (
          <div
            key={`header-${day}`}
            className={`${styles.calendarDayHeader} ${day === today ? styles.calendarToday : ''}`}
          >
            <span>{weekdayFormatter.format(day)}</span>
            <strong>{dateFormatter.format(day)}</strong>
          </div>
        ))}

        <div className={styles.calendarTimeAxis} style={{ height: GRID_HEIGHT }}>
          {HOURS.map((hour, index) => (
            <span key={hour} style={{ top: index * CALENDAR_HOUR_HEIGHT - 7 }}>
              {timeFormatter.format(new Date(today + hour * 60 * 60_000))}
            </span>
          ))}
        </div>

        {days.map((day) => {
          const layouts = layoutEventsForDay(events, day);
          return (
            <div key={day} className={styles.calendarDayColumn} style={{ height: GRID_HEIGHT }}>
              {HOURS.map((hour, index) => (
                <span
                  key={`${day}-${hour}`}
                  className={styles.calendarHourLine}
                  style={{ top: index * CALENDAR_HOUR_HEIGHT }}
                />
              ))}
              {day === today && showCurrentTime && (
                <span className={styles.calendarCurrentTime} style={{ top: currentTimeTop }} />
              )}
              {layouts.map(({ event, topMinutes, durationMinutes, column, columns }) => {
                const horizontalGap = 4;
                const widthPercent = 100 / columns;
                return (
                  <div
                    key={event.id}
                    className={styles.calendarEventPosition}
                    style={{
                      top: (topMinutes / 60) * CALENDAR_HOUR_HEIGHT + 2,
                      height: Math.max(30, (durationMinutes / 60) * CALENDAR_HOUR_HEIGHT - 4),
                      left: `calc(${column * widthPercent}% + ${horizontalGap}px)`,
                      width: `calc(${widthPercent}% - ${horizontalGap * 2}px)`,
                    }}
                  >
                    <EventCard event={event} compact={view === 'week'} onClick={() => onEventClick(event)} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DayWeekGrid;
