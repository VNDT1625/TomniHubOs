/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main-thread watchdog (2026-10-16). The pure parts are checked with fakes: frame formatting, the block threshold,
 * lag arithmetic and the enable rules. The worker start is checked only for the disabled and clean-stop paths, because
 * a real stall would block the test runner.
 */
import { describe, expect, it } from 'vitest';
import {
  WATCHDOG_BLOCK_MS,
  currentWatchdogBreadcrumb,
  formatFrames,
  isBlocked,
  lagOf,
  setWatchdogBreadcrumb,
  shouldEnableWatchdog,
  startMainThreadWatchdog,
} from '@process/services/diagnostics/mainThreadWatchdog';

describe('mainThreadWatchdog pure helpers', () => {
  it('formats at most fifteen frames, one line each, with a fallback name and url', () => {
    const frames = Array.from({ length: 20 }, (_unused, index) => ({
      functionName: index === 0 ? '' : `fn${index}`,
      url: index === 1 ? '' : `file:///app/index.js`,
      line: index + 1,
      column: 3,
    }));
    const lines = formatFrames(frames);
    expect(lines).toHaveLength(15);
    expect(lines[0]).toBe('  at (anonymous) (file:///app/index.js:1:3)');
    expect(lines[1]).toBe('  at fn1 (native:2:3)');
    expect(formatFrames(frames, 2)).toHaveLength(2);
  });

  it('treats a heartbeat older than the threshold as blocked, and not before', () => {
    const last = 1_000_000;
    expect(isBlocked(last, last + WATCHDOG_BLOCK_MS)).toBe(false);
    expect(isBlocked(last, last + WATCHDOG_BLOCK_MS + 1)).toBe(true);
  });

  it('reports lag beyond the expected interval and never a negative value', () => {
    expect(lagOf(1_000, 1_250, 250)).toBe(0);
    expect(lagOf(1_000, 3_283, 250)).toBe(2_033);
    expect(lagOf(1_000, 900, 250)).toBe(0);
  });

  it('is on in development, forced on or off by TOMNY_WATCHDOG, and off when packaged', () => {
    expect(shouldEnableWatchdog({}, false)).toBe(true);
    expect(shouldEnableWatchdog({}, true)).toBe(false);
    expect(shouldEnableWatchdog({ TOMNY_WATCHDOG: '1' }, true)).toBe(true);
    expect(shouldEnableWatchdog({ TOMNY_WATCHDOG: '0' }, false)).toBe(false);
  });

  it('keeps the breadcrumb short', () => {
    setWatchdogBreadcrumb('x'.repeat(500));
    expect(currentWatchdogBreadcrumb()).toHaveLength(120);
    setWatchdogBreadcrumb('tool:plugin');
  });
});

describe('startMainThreadWatchdog', () => {
  it('starts nothing when disabled', () => {
    const warnings: string[] = [];
    const handle = startMainThreadWatchdog({
      isPackaged: true,
      env: {} as NodeJS.ProcessEnv,
      warn: (message) => warnings.push(message),
    });
    expect(() => handle.stop()).not.toThrow();
    expect(warnings).toEqual([]);
  });

  it('starts and stops cleanly when enabled, without throwing', async () => {
    const warnings: string[] = [];
    const handle = startMainThreadWatchdog({
      isPackaged: false,
      env: { TOMNY_WATCHDOG: '1' } as NodeJS.ProcessEnv,
      warn: (message) => warnings.push(message),
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    handle.stop();
    expect(warnings.filter((line) => line.includes('blocked'))).toEqual([]);
  });
});
