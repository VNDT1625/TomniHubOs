/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  beginReask,
  createInitialRecoveryState,
  DEFAULT_RECOVERY_CONFIG,
  enterCooldown,
  evaluateRecovery,
  markResumeAttempt,
  recordActivity,
  startWatching,
} from '@/renderer/pages/conversation/platforms/tomnyagentic/interruptionRecovery';

const config = DEFAULT_RECOVERY_CONFIG;
const T0 = 1_000_000;

/** Simulate one failed automatic retry: resume is sent, then the turn is interrupted again. */
const failOnce = (state: ReturnType<typeof createInitialRecoveryState>, now: number) =>
  enterCooldown(markResumeAttempt(state, now), now, config);

describe('interruptionRecovery policy', () => {
  it('starts a 30s cancellable countdown on the first interruption', () => {
    const state = enterCooldown(startWatching(createInitialRecoveryState(), T0), T0, config);

    expect(state.phase).toBe('cooldown');
    expect(state.deadlineAt).toBe(T0 + 30_000);
    expect(evaluateRecovery(state, T0 + 29_999, config)).toEqual({ type: 'none' });
    expect(evaluateRecovery(state, T0 + 30_000, config)).toEqual({ type: 'resume' });
  });

  it('allows exactly 5 automatic retries per cycle, then waits 5 minutes before asking again', () => {
    let state = enterCooldown(startWatching(createInitialRecoveryState(), T0), T0, config);
    let now = T0;

    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(state.phase).toBe('cooldown');
      now += 30_000;
      state = failOnce(state, now);
    }

    expect(state.phase).toBe('exhausted');
    expect(state.deadlineAt).toBe(now + 5 * 60_000);
    expect(evaluateRecovery(state, now + 5 * 60_000 - 1, config)).toEqual({ type: 'none' });
    expect(evaluateRecovery(state, now + 5 * 60_000, config)).toEqual({ type: 'reask' });
  });

  it('starts a fresh cycle with a cancellable countdown when it asks again', () => {
    const exhausted = {
      ...createInitialRecoveryState(),
      phase: 'exhausted' as const,
      consecutiveRejections: 5,
      deadlineAt: T0,
    };

    const reasked = beginReask(exhausted, T0, config);

    expect(reasked.phase).toBe('cooldown');
    expect(reasked.asking).toBe(true);
    expect(reasked.consecutiveRejections).toBe(0);
    expect(reasked.deadlineAt).toBe(T0 + 30_000);
  });

  it('ignores stream heartbeats outside the watching phase', () => {
    const cooldown = enterCooldown(startWatching(createInitialRecoveryState(), T0), T0, config);

    expect(recordActivity(cooldown, T0 + 1_000)).toBe(cooldown);
  });

  it('a new turn clears the countdown and keeps the cycle counter', () => {
    const cooldown = {
      ...enterCooldown(startWatching(createInitialRecoveryState(), T0), T0, config),
      consecutiveRejections: 2,
    };

    const restarted = startWatching(cooldown, T0 + 5_000);

    expect(restarted.phase).toBe('watching');
    expect(restarted.deadlineAt).toBe(0);
    expect(restarted.consecutiveRejections).toBe(2);
  });
});
