/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { runScheduleCommand, takePendingScheduleDraft } from '@/renderer/pages/cron/scheduleDraft';
import { emitter } from '@/renderer/utils/emitter';

afterEach(() => {
  takePendingScheduleDraft();
  window.location.hash = '';
});

describe('/schedule hand-off to the Schedule page', () => {
  it('leaves ordinary messages alone', () => {
    expect(runScheduleCommand('hello')).toBe(false);
    expect(takePendingScheduleDraft()).toBeNull();
  });

  it('opens the Schedule page with a one-time draft', () => {
    expect(runScheduleCommand('/schedule daily 9:00 summarise')).toBe(true);
    expect(window.location.hash).toBe('#/scheduled');
    expect(takePendingScheduleDraft()).toMatchObject({ frequency: 'daily', prompt: 'summarise' });
    expect(takePendingScheduleDraft()).toBeNull();
  });

  it('tells an already open Schedule page to show the draft', () => {
    window.location.hash = '#/scheduled';
    const listener = vi.fn();
    emitter.on('cron.schedule-draft', listener);
    expect(runScheduleCommand('/schedule hourly ping')).toBe(true);
    emitter.off('cron.schedule-draft', listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(takePendingScheduleDraft()).toMatchObject({ frequency: 'hourly', prompt: 'ping' });
  });
});
