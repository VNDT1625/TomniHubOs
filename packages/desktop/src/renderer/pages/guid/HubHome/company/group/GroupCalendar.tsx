/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CompanyGroup } from '../companyGroups';
import { createEvent, latestOccurrence, MAX_EVENTS, occurrencesBetween, type EventRepeat } from './groupMeta';
import { useGroupMeta } from './useGroupChat';

type GroupCalendarProps = { groupKey: string; group: CompanyGroup };

const DAY_MS = 86_400_000;
const REPEATS: readonly EventRepeat[] = ['none', 'daily', 'weekdays', 'weekly'];

const startOfWeek = (at: number): number => {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  const offset = (date.getDay() + 6) % 7; // Monday first
  return date.getTime() - offset * DAY_MS;
};

/** `datetime-local` value for an epoch ms, in local time. */
const toLocalInput = (at: number): string => {
  const date = new Date(at - new Date(at).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
};

/**
 * Group calendar: a week view of the group's events and a form to add one. When
 * an event is due its attendees (or Laya's pick) are called in the group chat, or
 * its workflow runs.
 */
export const GroupCalendar: React.FC<GroupCalendarProps> = ({ groupKey, group }) => {
  const { t, i18n } = useTranslation();
  const [meta, updateMeta] = useGroupMeta(groupKey);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(Date.now()));
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(() => toLocalInput(Date.now() + 60 * 60_000));
  const [repeat, setRepeat] = useState<EventRepeat>('none');
  const [attendees, setAttendees] = useState<string[]>([]);
  const [workflowId, setWorkflowId] = useState('');
  const [note, setNote] = useState('');
  const members = [group.leader, ...group.members];

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => weekStart + index * DAY_MS), [weekStart]);
  const byDay = useMemo(
    () =>
      days.map((day) =>
        meta.events
          .flatMap((event) => occurrencesBetween(event, day, day + DAY_MS).map((at) => ({ event, at })))
          .toSorted((a, b) => a.at - b.at)
      ),
    [days, meta.events]
  );
  const dayLabel = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'numeric' });
  const timeLabel = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const today = startOfWeek(Date.now()) === weekStart ? new Date().setHours(0, 0, 0, 0) : -1;
  const startsAt = new Date(when).getTime();
  const canAdd = title.trim().length > 0 && Number.isFinite(startsAt) && meta.events.length < MAX_EVENTS;

  const add = (): void => {
    if (!canAdd) return;
    const event = createEvent(
      {
        title: title.trim(),
        note: note.trim() || undefined,
        startsAt,
        repeat,
        attendees,
        workflowId: workflowId || undefined,
      },
      Date.now()
    );
    updateMeta((current) => ({ ...current, events: [...current.events, event] }));
    setTitle('');
    setNote('');
  };

  return (
    <div className='hub-company-pane-body' data-testid='hub-company-calendar'>
      <div className='hub-company-week-nav'>
        <button
          type='button'
          className='hub-company-icon-btn'
          aria-label={t('company.center.group.cal.prevWeek')}
          onClick={() => setWeekStart((current) => current - 7 * DAY_MS)}
        >
          <ChevronLeft size={14} strokeWidth={1.75} aria-hidden='true' />
        </button>
        <button type='button' className='hub-q-btn' onClick={() => setWeekStart(startOfWeek(Date.now()))}>
          {t('company.center.group.cal.today')}
        </button>
        <button
          type='button'
          className='hub-company-icon-btn'
          aria-label={t('company.center.group.cal.nextWeek')}
          onClick={() => setWeekStart((current) => current + 7 * DAY_MS)}
        >
          <ChevronRight size={14} strokeWidth={1.75} aria-hidden='true' />
        </button>
      </div>

      <ol className='hub-company-week'>
        {days.map((day, index) => (
          <li key={day} className={day === today ? 'hub-active' : undefined}>
            <div className='hub-company-week-day'>{dayLabel.format(day)}</div>
            {byDay[index].length === 0 ? (
              <div className='hub-company-hint'>—</div>
            ) : (
              byDay[index].map(({ event, at }) => (
                <div
                  key={`${event.id}-${at}`}
                  className={`hub-company-week-event${event.enabled ? '' : ' hub-company-week-event--off'}`}
                >
                  <span>{timeLabel.format(at)}</span> {event.title}
                </div>
              ))
            )}
          </li>
        ))}
      </ol>

      <div className='hub-company-block'>
        <h3>{t('company.center.group.cal.add')}</h3>
        <label>
          {t('company.center.group.cal.title')}
          <input
            className='hub-company-field'
            value={title}
            maxLength={200}
            data-testid='hub-company-event-title'
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          {t('company.center.group.cal.time')}
          <input
            className='hub-company-field'
            type='datetime-local'
            value={when}
            onChange={(event) => setWhen(event.target.value)}
          />
        </label>
        <label>
          {t('company.center.group.cal.repeat')}
          <select
            className='hub-company-field'
            value={repeat}
            onChange={(event) => setRepeat(event.target.value as EventRepeat)}
          >
            {REPEATS.map((value) => (
              <option key={value} value={value}>
                {t(`company.center.group.cal.repeats.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <div className='hub-company-subtitle'>{t('company.center.group.cal.attendees')}</div>
        <p className='hub-company-hint'>{t('company.center.group.cal.attendeesHint')}</p>
        <div className='hub-company-checks'>
          {members.map((role) => (
            <label key={role.id} className='hub-company-check'>
              <input
                type='checkbox'
                checked={attendees.includes(role.id)}
                onChange={() =>
                  setAttendees((current) =>
                    current.includes(role.id) ? current.filter((id) => id !== role.id) : [...current, role.id]
                  )
                }
              />
              {role.name}
            </label>
          ))}
        </div>
        <label>
          {t('company.center.group.cal.workflow')}
          <select
            className='hub-company-field'
            value={workflowId}
            onChange={(event) => setWorkflowId(event.target.value)}
          >
            <option value=''>{t('company.center.group.cal.noWorkflow')}</option>
            {meta.workflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('company.center.group.cal.note')}
          <textarea
            className='hub-company-field'
            rows={2}
            value={note}
            maxLength={2000}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className='hub-company-form-actions'>
          <button
            type='button'
            className='hub-q-btn hub-q-btn--primary'
            disabled={!canAdd}
            data-testid='hub-company-event-add'
            onClick={add}
          >
            {t('company.center.group.cal.save')}
          </button>
        </div>
        <p className='hub-company-hint'>{t('company.center.group.cal.runsWhileOpen')}</p>
      </div>

      {meta.events.length > 0 && (
        <div className='hub-company-block'>
          <h3>{t('company.center.group.cal.all')}</h3>
          <ul className='hub-company-items'>
            {meta.events.map((event) => (
              <li key={event.id}>
                <div>
                  <strong>{event.title}</strong>
                  <small>
                    {new Date(event.startsAt).toLocaleString(i18n.language)} ·{' '}
                    {t(`company.center.group.cal.repeats.${event.repeat}`)}
                  </small>
                </div>
                <button
                  type='button'
                  className='hub-q-btn'
                  onClick={() =>
                    updateMeta((current) => ({
                      ...current,
                      events: current.events.map((item) =>
                        item.id !== event.id
                          ? item
                          : item.enabled
                            ? { ...item, enabled: false }
                            : // Resuming does not replay the occurrences that passed while paused.
                              {
                                ...item,
                                enabled: true,
                                lastFiredAt: latestOccurrence(item, Date.now()) ?? item.lastFiredAt,
                              }
                      ),
                    }))
                  }
                >
                  {event.enabled ? t('company.center.group.cal.pause') : t('company.center.group.cal.resume')}
                </button>
                <button
                  type='button'
                  className='hub-company-icon-btn'
                  aria-label={t('company.center.group.remove')}
                  onClick={() =>
                    updateMeta((current) => ({
                      ...current,
                      events: current.events.filter((item) => item.id !== event.id),
                    }))
                  }
                >
                  <Trash2 size={14} strokeWidth={1.75} aria-hidden='true' />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
