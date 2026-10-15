/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure decision logic for recovering a tomnyagentic conversation that was
 * interrupted *unintentionally* (network drop, provider/API-key error, backend
 * crash) before its turn finished.
 *
 * Policy (user-facing contract):
 *  - Every automatic retry is preceded by a visible countdown (`countdownMs`).
 *    The user can cancel during the countdown or retry immediately.
 *  - At most `maxConsecutiveRejections` automatic retries per cycle. When a
 *    cycle is exhausted, the loop waits `reaskDelayMs` and asks the user again,
 *    which starts a new cycle (its own countdown, cancellable).
 *  - All state is in memory only. A restarted app never resumes on its own.
 *
 * This module is intentionally pure and deterministic (no timers, no I/O) so the
 * recovery policy can be unit-tested; the renderer hook drives it with real
 * clocks and the real stream / HTTP calls.
 */

/**
 * Whether a given stop cause is an *unintentional* interruption that should be
 * offered for recovery. A user stop or a normal completion must never be resumed.
 */
export type TurnStopCause =
  | 'user-stop' // user clicked stop (or backend reported state==='stopped')
  | 'completed' // turn finished normally (finish + backend no longer running)
  | 'error' // backend emitted an error event for this turn
  | 'backend-dead' // liveness poll failed / backend no longer reachable
  | 'silent-stall'; // UI thinks running but no activity and backend not running

export const isRecoverableStopCause = (cause: TurnStopCause): boolean =>
  cause === 'error' || cause === 'backend-dead' || cause === 'silent-stall';

export type RecoveryConfig = {
  /**
   * While the UI believes a turn is running, no stream activity for this long
   * triggers a liveness check (poll the backend to confirm it really stopped).
   */
  stallTimeoutMs: number;
  /**
   * When the UI's running flag drops without a clean-completion signal, wait this
   * long for a late `turnCompleted` event before polling the backend to decide
   * whether the turn was interrupted.
   */
  verifyGraceMs: number;
  /** Countdown shown (and cancellable) before each automatic retry. */
  countdownMs: number;
  /** Automatic retries per cycle before the loop gives up for now. */
  maxConsecutiveRejections: number;
  /** After a cycle gives up, how long to wait before asking the user again. */
  reaskDelayMs: number;
};

export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  stallTimeoutMs: 45_000,
  verifyGraceMs: 4_000,
  countdownMs: 30_000,
  maxConsecutiveRejections: 5,
  reaskDelayMs: 5 * 60_000,
};

export type RecoveryPhase =
  | 'idle' // not watching (no running turn, or recovery disabled)
  | 'watching' // a turn is running; watching for stall / interruption
  | 'verifying' // running dropped; waiting briefly to verify clean finish vs interruption
  | 'cooldown' // countdown before an automatic retry (cancellable)
  | 'exhausted'; // cycle used up; waiting before asking the user again

export type RecoveryState = {
  phase: RecoveryPhase;
  /** Timestamp of the last observed stream activity (used while watching). */
  lastActivityAt: number;
  /** Timestamp verification started (used while in verifying). */
  verifyingStartedAt: number;
  /** When the current countdown (cooldown) or re-ask wait (exhausted) ends. */
  deadlineAt: number;
  /** True when the current countdown is a re-ask after a cycle was exhausted. */
  asking: boolean;
  /** Automatic retries attempted (and failed) in the current cycle. */
  consecutiveRejections: number;
};

export const createInitialRecoveryState = (): RecoveryState => ({
  phase: 'idle',
  lastActivityAt: 0,
  verifyingStartedAt: 0,
  deadlineAt: 0,
  asking: false,
  consecutiveRejections: 0,
});

export type RecoveryAction =
  | { type: 'none' }
  | { type: 'check-liveness' } // stalled/uncertain -> confirm backend really stopped
  | { type: 'resume' } // countdown elapsed -> silently re-send the continue turn
  | { type: 'reask' }; // cycle exhausted and wait elapsed -> ask the user again

/** Decide what the recovery loop should do right now. Pure: does not mutate state. */
export const evaluateRecovery = (state: RecoveryState, now: number, config: RecoveryConfig): RecoveryAction => {
  if (state.phase === 'watching') {
    return now - state.lastActivityAt >= config.stallTimeoutMs ? { type: 'check-liveness' } : { type: 'none' };
  }
  if (state.phase === 'verifying') {
    return now - state.verifyingStartedAt >= config.verifyGraceMs ? { type: 'check-liveness' } : { type: 'none' };
  }
  if (state.phase === 'cooldown') {
    return now >= state.deadlineAt ? { type: 'resume' } : { type: 'none' };
  }
  if (state.phase === 'exhausted') {
    return now >= state.deadlineAt ? { type: 'reask' } : { type: 'none' };
  }
  return { type: 'none' };
};

// --- Deterministic state transitions (kept pure for testability) ---

/** Begin watching a freshly started turn. Keeps the cycle counter. */
export const startWatching = (state: RecoveryState, now: number): RecoveryState => ({
  ...state,
  phase: 'watching',
  lastActivityAt: now,
  verifyingStartedAt: 0,
  deadlineAt: 0,
  asking: false,
});

/** Running flag dropped without a clean-completion signal: verify briefly. */
export const beginVerifying = (state: RecoveryState, now: number): RecoveryState => ({
  ...state,
  phase: 'verifying',
  verifyingStartedAt: now,
});

/** Record stream activity (heartbeat) while watching. */
export const recordActivity = (state: RecoveryState, now: number): RecoveryState =>
  state.phase === 'watching' ? { ...state, lastActivityAt: now } : state;

/**
 * An unintentional interruption was confirmed. Start the countdown before the
 * next automatic retry, or enter the exhausted wait once the cycle is used up.
 */
export const enterCooldown = (state: RecoveryState, now: number, config: RecoveryConfig): RecoveryState => {
  if (state.consecutiveRejections >= config.maxConsecutiveRejections) {
    return { ...state, phase: 'exhausted', verifyingStartedAt: 0, deadlineAt: now + config.reaskDelayMs };
  }
  return {
    ...state,
    phase: 'cooldown',
    verifyingStartedAt: 0,
    deadlineAt: now + config.countdownMs,
  };
};

/** The countdown ended and an automatic retry is being sent. Counts as one attempt. */
export const markResumeAttempt = (state: RecoveryState, now: number): RecoveryState => ({
  ...state,
  phase: 'watching',
  lastActivityAt: now,
  verifyingStartedAt: 0,
  deadlineAt: 0,
  consecutiveRejections: state.consecutiveRejections + 1,
});

/** The exhausted wait ended: start a fresh cycle with a countdown the user can cancel. */
export const beginReask = (state: RecoveryState, now: number, config: RecoveryConfig): RecoveryState => ({
  ...state,
  phase: 'cooldown',
  verifyingStartedAt: 0,
  deadlineAt: now + config.countdownMs,
  asking: true,
  consecutiveRejections: 0,
});

/** A turn completed successfully: clear the cycle and stop watching. */
export const markRecovered = (): RecoveryState => createInitialRecoveryState();

/** Stop recovery entirely (user cancel, conversation switch, nothing to resume). */
export const stopWatching = (): RecoveryState => createInitialRecoveryState();
