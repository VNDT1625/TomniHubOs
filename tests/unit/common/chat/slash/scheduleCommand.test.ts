/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseScheduleCommand } from '@/common/chat/slash/scheduleCommand';

describe('/schedule parser', () => {
  it('ignores messages that are not schedule commands', () => {
    expect(parseScheduleCommand('schedule daily 9:00 x')).toBeNull();
    expect(parseScheduleCommand('/scheduler daily')).toBeNull();
    expect(parseScheduleCommand('please /schedule daily')).toBeNull();
  });

  it.each([
    ['/schedule daily 9:00 summarise my inbox', 'daily', '09:00', 'MON', 'summarise my inbox'],
    ['/schedule hằng ngày lúc 7h30 tóm tắt email', 'daily', '07:30', 'MON', 'tóm tắt email'],
    ['/schedule weekdays 6pm check the build', 'weekdays', '18:00', 'MON', 'check the build'],
    ['/schedule thứ 6 5h chiều báo cáo tuần', 'weekly', '17:00', 'FRI', 'báo cáo tuần'],
    ['/schedule every monday at 8:15 plan the week', 'weekly', '08:15', 'MON', 'plan the week'],
    ['/schedule chủ nhật 21:00 dọn thư mục tải về', 'weekly', '21:00', 'SUN', 'dọn thư mục tải về'],
    ['/schedule hourly kiểm tra server', 'hourly', '09:00', 'MON', 'kiểm tra server'],
    ['/schedule 22:45 back up notes', 'daily', '22:45', 'MON', 'back up notes'],
    ['/schedule 12am rotate logs', 'daily', '00:00', 'MON', 'rotate logs'],
  ])('reads %s', (input, frequency, time, weekday, prompt) => {
    expect(parseScheduleCommand(input)).toEqual({ frequency, time, weekday, prompt });
  });

  it('keeps unrecognised words in the task and falls back to a manual task', () => {
    expect(parseScheduleCommand('/schedule money report for 3 teams')).toEqual({
      frequency: 'manual',
      time: '09:00',
      weekday: 'MON',
      prompt: 'money report for 3 teams',
    });
    expect(parseScheduleCommand('/schedule')).toEqual({
      frequency: 'manual',
      time: '09:00',
      weekday: 'MON',
      prompt: '',
    });
  });

  it('rejects impossible times instead of guessing', () => {
    expect(parseScheduleCommand('/schedule daily 25:00 x')).toEqual({
      frequency: 'daily',
      time: '09:00',
      weekday: 'MON',
      prompt: '25:00 x',
    });
  });
});
