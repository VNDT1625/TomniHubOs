/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HubNotification, NotificationRules } from '@/common/types/platform/notificationHub';

export type AlertDecision = {
  /** Show an OS notification. */
  banner: boolean;
  /** Play the OS notification sound with it. */
  sound: boolean;
  /** Draw attention to the Tomny window (restore and flash it). */
  attention: boolean;
};

const minutesOf = (time: string): number => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

/** True when `now` falls inside the quiet window; a window may cross midnight (22:00 → 07:00). */
export const inQuietHours = (rules: NotificationRules, now: Date): boolean => {
  if (!rules.quietHours.enabled) return false;
  const start = minutesOf(rules.quietHours.start);
  const end = minutesOf(rules.quietHours.end);
  if (start === end) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
};

/**
 * What a new notification may do outside the drawer. Urgent items always may
 * (when allowed); important ones only while Tomny is in the background; quiet
 * hours keep everything but urgent items silent and off the screen.
 */
export const decideAlert = (
  notification: HubNotification,
  rules: NotificationRules,
  context: { now: Date; focused: boolean }
): AlertDecision => {
  // Triage decides first: only items it marked `interrupt` may leave the drawer.
  if (notification.delivery && notification.delivery !== 'interrupt') {
    return { banner: false, sound: false, attention: false };
  }
  const quiet = inQuietHours(rules, context.now);
  const urgent = notification.level === 'P0';
  const banner = urgent ? rules.systemAlertsForP0 : notification.level === 'P1' && !context.focused && !quiet;
  const asksForInput = urgent && notification.reason === 'needs-input';
  return {
    banner,
    sound: banner && rules.sound && !quiet,
    attention: asksForInput && rules.bringToFrontOnInput && !context.focused,
  };
};

export const RAM_ALERT_PERCENT = 85;
/** Consecutive high samples before alerting, so a short spike stays quiet. */
const RAM_ALERT_SAMPLES = 2;
/** At most one RAM notification per window. */
const RAM_ALERT_WINDOW_MS = 30 * 60_000;

export type RamSample = { usedPercent: number; usedGb: number; totalGb: number };

/**
 * Turns periodic memory samples into at most one alert per half hour once
 * usage has stayed above the threshold for two samples in a row.
 */
export const createRamWatcher = (onAlert: (sample: RamSample, windowKey: string) => void) => {
  let high = 0;
  let lastWindow = '';
  return (sample: RamSample, now: number): void => {
    high = sample.usedPercent >= RAM_ALERT_PERCENT ? high + 1 : 0;
    if (high < RAM_ALERT_SAMPLES) return;
    const windowKey = String(Math.floor(now / RAM_ALERT_WINDOW_MS));
    if (windowKey === lastWindow) return;
    lastWindow = windowKey;
    onAlert(sample, windowKey);
  };
};
