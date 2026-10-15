/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_NOTIFICATION_RULES,
  type HubNotification,
  type NotificationRules,
} from '@/common/types/platform/notificationHub';
import { createRamWatcher, decideAlert, inQuietHours } from '@process/system/hubActivity/notifications/alertPolicy';

const rules = (patch: Partial<NotificationRules> = {}): NotificationRules => ({
  ...DEFAULT_NOTIFICATION_RULES,
  ...patch,
});
const quiet = (start: string, end: string) => rules({ quietHours: { enabled: true, start, end } });
const at = (hours: number, minutes = 0) => new Date(2026, 9, 5, hours, minutes);

const item = (patch: Partial<HubNotification>): HubNotification => ({
  id: 'n',
  source: 'agent',
  sourceLabel: 'Agent',
  title: 'Title',
  body: '',
  createdAt: 0,
  level: 'P1',
  category: 'work',
  classifiedBy: 'rules',
  reason: 'default',
  read: false,
  ...patch,
});

describe('quiet hours', () => {
  it('handles a window that crosses midnight', () => {
    const night = quiet('22:00', '07:00');
    expect(inQuietHours(night, at(23, 30))).toBe(true);
    expect(inQuietHours(night, at(6, 59))).toBe(true);
    expect(inQuietHours(night, at(7, 0))).toBe(false);
    expect(inQuietHours(night, at(12))).toBe(false);
  });

  it('handles a daytime window and ignores disabled or empty ones', () => {
    expect(inQuietHours(quiet('13:00', '14:00'), at(13, 30))).toBe(true);
    expect(inQuietHours(quiet('13:00', '14:00'), at(14, 0))).toBe(false);
    expect(inQuietHours(quiet('08:00', '08:00'), at(8, 0))).toBe(false);
    expect(inQuietHours(rules(), at(23))).toBe(false);
  });
});

describe('alert decision', () => {
  const noon = { now: at(12), focused: false };

  it('lets urgent items through quiet hours but silently', () => {
    const decision = decideAlert(item({ level: 'P0' }), quiet('00:00', '23:59'), noon);
    expect(decision).toEqual({ banner: true, sound: false, attention: false });
    expect(decideAlert(item({ level: 'P0' }), rules({ systemAlertsForP0: false }), noon).banner).toBe(false);
  });

  it('shows important items only while Tomny is in the background and outside quiet hours', () => {
    expect(decideAlert(item({ level: 'P1' }), rules(), noon)).toEqual({ banner: true, sound: true, attention: false });
    expect(decideAlert(item({ level: 'P1' }), rules(), { ...noon, focused: true }).banner).toBe(false);
    expect(decideAlert(item({ level: 'P1' }), quiet('11:00', '13:00'), noon).banner).toBe(false);
    expect(decideAlert(item({ level: 'P2' }), rules(), noon).banner).toBe(false);
  });

  it('mutes the sound when asked and brings the window forward only for input requests', () => {
    expect(decideAlert(item({ level: 'P1' }), rules({ sound: false }), noon).sound).toBe(false);
    const input = item({ level: 'P0', reason: 'needs-input' });
    expect(decideAlert(input, rules(), noon).attention).toBe(true);
    expect(decideAlert(input, rules(), { ...noon, focused: true }).attention).toBe(false);
    expect(decideAlert(input, rules({ bringToFrontOnInput: false }), noon).attention).toBe(false);
  });
});

describe('RAM watcher', () => {
  const high = { usedPercent: 90, usedGb: 14.4, totalGb: 16 };
  const low = { usedPercent: 50, usedGb: 8, totalGb: 16 };

  it('ignores a single spike and alerts once per half hour', () => {
    const onAlert = vi.fn();
    const watch = createRamWatcher(onAlert);
    watch(high, 0);
    watch(low, 60_000);
    watch(high, 120_000);
    expect(onAlert).not.toHaveBeenCalled();
    watch(high, 180_000);
    expect(onAlert).toHaveBeenCalledTimes(1);
    watch(high, 240_000);
    expect(onAlert).toHaveBeenCalledTimes(1);
    watch(high, 31 * 60_000);
    expect(onAlert).toHaveBeenCalledTimes(2);
    expect(onAlert.mock.calls[0]?.[0]).toEqual(high);
  });
});
