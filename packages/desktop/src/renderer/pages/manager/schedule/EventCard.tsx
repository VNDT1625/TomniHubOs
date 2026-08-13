/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A single calendar event block. Fixed events get a lock icon + warning rail;
 * flexible events use the Manager accent. Rendered as an Arco button so keyboard
 * and screen-reader interaction match the rest of the desktop UI.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@arco-design/web-react';
import { Lock, Unlock } from '@icon-park/react';
import type { CalendarEvent } from '@process/manager/managerTypes';
import { formatTimeRange } from './scheduleUtils';
import styles from '../manager.module.css';

const EventCard: React.FC<{ event: CalendarEvent; onClick: () => void; compact?: boolean }> = ({
  event,
  onClick,
  compact,
}) => {
  const { i18n } = useTranslation();
  const fixed = event.lockKind === 'fixed';
  const timeRange = formatTimeRange(event.startAt, event.endAt, i18n.resolvedLanguage || i18n.language);
  const eventStyle = {
    ['--calendar-event-rail' as string]: fixed ? 'var(--warning)' : 'var(--mgr-accent, var(--primary))',
  } as React.CSSProperties;

  return (
    <Button
      type='text'
      long
      className={`${styles.calendarEventButton} ${fixed ? styles.calendarEventFixed : styles.calendarEventFlexible}`}
      style={eventStyle}
      onClick={onClick}
      aria-label={`${event.title}, ${timeRange}`}
    >
      <span className={styles.calendarEventHeading}>
        {fixed ? (
          <Lock theme='outline' size='11' className='text-warning shrink-0' />
        ) : (
          <Unlock theme='outline' size='11' className={styles.calendarEventAccentIcon} />
        )}
        <strong>{event.title}</strong>
      </span>
      <span className={styles.calendarEventTime}>{timeRange}</span>
      {!compact && event.location && <span className={styles.calendarEventLocation}>{event.location}</span>}
    </Button>
  );
};

export default EventCard;
