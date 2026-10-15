/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

export const SCHEDULE_COMMAND_NAME = 'schedule';

export type ScheduleFrequency = 'manual' | 'hourly' | 'daily' | 'weekdays' | 'weekly';
export type ScheduleWeekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

/** What `/schedule` fills into the new-task form. The user still picks the agent and confirms. */
export type ScheduleDraft = Readonly<{
  prompt: string;
  frequency: ScheduleFrequency;
  /** `HH:mm`, 24-hour. */
  time: string;
  weekday: ScheduleWeekday;
}>;

const SCHEDULE_COMMAND_RE = /^\s*\/schedule(?:\s+([\s\S]*))?$/iu;
const END = String.raw`(?=[\s,.;:]|$)`;

const DAY_WORDS: ReadonlyArray<readonly [ScheduleWeekday, string]> = [
  ['MON', String.raw`mon(?:day)?|thứ\s*(?:2|hai)|t2`],
  ['TUE', String.raw`tue(?:s|sday)?|thứ\s*(?:3|ba)|t3`],
  ['WED', String.raw`wed(?:nesday)?|thứ\s*(?:4|tư)|t4`],
  ['THU', String.raw`thu(?:rs|rsday)?|thứ\s*(?:5|năm)|t5`],
  ['FRI', String.raw`fri(?:day)?|thứ\s*(?:6|sáu)|t6`],
  ['SAT', String.raw`sat(?:urday)?|thứ\s*(?:7|bảy)|t7`],
  ['SUN', String.raw`sun(?:day)?|chủ\s*nhật|cn`],
];

const EVERY = String.raw`(?:every\s+|each\s+|on\s+|mỗi\s+|hằng\s+|hàng\s+|vào\s+)?`;

const FREQUENCY_RULES: ReadonlyArray<readonly [RegExp, (match: RegExpExecArray) => Partial<ScheduleDraft>]> = [
  [
    new RegExp(String.raw`^(?:hourly|every\s+hour|mỗi\s+giờ|hằng\s+giờ|hàng\s+giờ)${END}`, 'iu'),
    () => ({ frequency: 'hourly' }),
  ],
  [
    new RegExp(
      String.raw`^${EVERY}(?:weekdays?|ngày\s+thường|ngày\s+làm\s+việc|thứ\s*2\s*-\s*(?:thứ\s*)?6|t2\s*-\s*t6|mon\s*-\s*fri)${END}`,
      'iu'
    ),
    () => ({ frequency: 'weekdays' }),
  ],
  [
    new RegExp(String.raw`^(?:daily|every\s*day|each\s+day|hằng\s+ngày|hàng\s+ngày|mỗi\s+ngày)${END}`, 'iu'),
    () => ({ frequency: 'daily' }),
  ],
  ...DAY_WORDS.map(
    ([weekday, words]) =>
      [
        new RegExp(String.raw`^${EVERY}(?:${words})${END}`, 'iu'),
        () => ({ frequency: 'weekly' as const, weekday }),
      ] as const
  ),
  [
    new RegExp(String.raw`^(?:weekly|every\s+week|hằng\s+tuần|hàng\s+tuần|mỗi\s+tuần)${END}`, 'iu'),
    () => ({ frequency: 'weekly' }),
  ],
];

const TIME_RE = new RegExp(
  String.raw`^(?:at\s+|lúc\s+)?(\d{1,2})(?::(\d{2})|h(\d{2})?|\s*(am|pm))(?:\s*(am|pm|sáng|trưa|chiều|tối))?${END}`,
  'iu'
);

const readTime = (match: RegExpExecArray): string | undefined => {
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? match[3] ?? '0');
  const suffix = (match[4] ?? match[5] ?? '').toLowerCase();
  if (suffix === 'pm' || suffix === 'chiều' || suffix === 'tối') {
    if (hour < 12) hour += 12;
  } else if (suffix === 'am' || suffix === 'sáng') {
    if (hour === 12) hour = 0;
  } else if (suffix === 'trưa' && hour < 11) {
    hour += 12;
  }
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

/**
 * Reads `/schedule [when] [time] <what to do>`, for example `/schedule daily 9:00 summarise my inbox`,
 * `/schedule thứ 2 8h30 báo cáo tuần` or `/schedule weekdays 6pm check the build`. Returns null when the
 * message is not a schedule command. Words it does not recognise are left in the task text, so nothing
 * the user typed is lost; with no schedule words the draft is a manual task.
 */
export const parseScheduleCommand = (input: string): ScheduleDraft | null => {
  const match = SCHEDULE_COMMAND_RE.exec(input);
  if (!match) return null;
  let rest = (match[1] ?? '').trim();
  let frequency: ScheduleFrequency | undefined;
  let weekday: ScheduleWeekday | undefined;
  let time: string | undefined;

  for (let progressed = true; progressed && rest;) {
    progressed = false;
    if (!frequency) {
      for (const [rule, read] of FREQUENCY_RULES) {
        const found = rule.exec(rest);
        if (!found) continue;
        const value = read(found);
        frequency = value.frequency;
        weekday = value.weekday ?? weekday;
        rest = rest.slice(found[0].length).replace(/^[\s,]+/u, '');
        progressed = true;
        break;
      }
    }
    if (!time) {
      const found = TIME_RE.exec(rest);
      const value = found ? readTime(found) : undefined;
      if (found && value) {
        time = value;
        rest = rest.slice(found[0].length).replace(/^[\s,]+/u, '');
        progressed = true;
      }
    }
  }

  return {
    prompt: rest.trim(),
    frequency: frequency ?? (time ? 'daily' : 'manual'),
    time: time ?? '09:00',
    weekday: weekday ?? 'MON',
  };
};
