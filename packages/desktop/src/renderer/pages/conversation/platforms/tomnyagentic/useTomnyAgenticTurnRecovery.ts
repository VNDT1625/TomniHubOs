/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  beginReask,
  beginVerifying,
  createInitialRecoveryState,
  DEFAULT_RECOVERY_CONFIG,
  enterCooldown,
  evaluateRecovery,
  markRecovered,
  markResumeAttempt,
  recordActivity,
  startWatching,
  stopWatching,
  type RecoveryConfig,
  type RecoveryState,
} from './interruptionRecovery';

export type TurnRecoveryPayload = { input: string; files: string[] };

/**
 * What the UI should show while recovery is pending. `null` means nothing to show.
 * - countdown: an automatic retry fires at `deadlineAt` unless the user cancels.
 * - exhausted: the automatic retries were used up; the user is asked again at `deadlineAt`.
 */
export type TurnRecoveryView =
  | { kind: 'countdown'; asking: boolean; attempt: number; maxAttempts: number; deadlineAt: number }
  | { kind: 'exhausted'; maxAttempts: number; deadlineAt: number };

type UseTomnyAgenticTurnRecoveryOptions = {
  conversation_id: string;
  /** Whether the UI currently believes a turn is running (isBusy). */
  running: boolean;
  /** Recovery is only meaningful once the running state has been hydrated. */
  isHydrated: boolean;
  /**
   * Silently re-send a "continue" turn on the same conversation. The backend
   * keeps the conversation context, so a minimal continue prompt is enough to
   * pick up where the interrupted turn left off. Should resolve once the turn
   * has been (re)started.
   */
  resume: (payload: TurnRecoveryPayload) => Promise<void> | void;
  /**
   * Build the payload used to resume. Returning null disables recovery for this
   * turn (e.g. nothing to continue).
   */
  getResumePayload: () => TurnRecoveryPayload | null;
  config?: RecoveryConfig;
};

const TICK_INTERVAL_MS = 1_000;

const toView = (state: RecoveryState, config: RecoveryConfig): TurnRecoveryView | null => {
  if (state.phase === 'cooldown') {
    return {
      kind: 'countdown',
      asking: state.asking,
      attempt: Math.min(state.consecutiveRejections + 1, config.maxConsecutiveRejections),
      maxAttempts: config.maxConsecutiveRejections,
      deadlineAt: state.deadlineAt,
    };
  }
  if (state.phase === 'exhausted') {
    return { kind: 'exhausted', maxAttempts: config.maxConsecutiveRejections, deadlineAt: state.deadlineAt };
  }
  return null;
};

const isSameView = (a: TurnRecoveryView | null, b: TurnRecoveryView | null): boolean => {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind || a.deadlineAt !== b.deadlineAt) return false;
  if (a.kind === 'countdown' && b.kind === 'countdown') {
    return a.asking === b.asking && a.attempt === b.attempt;
  }
  return true;
};

/**
 * Renderer-driven recovery loop for tomnyagentic turns. Watches the live stream for a
 * running turn. When the turn is interrupted unintentionally (not a user stop, not a
 * clean completion), it shows a cancellable countdown and then silently re-sends a
 * continue turn. Up to `maxConsecutiveRejections` automatic retries per cycle; then it
 * waits `reaskDelayMs` and asks the user again.
 *
 * All state lives in memory. A freshly started app never auto-resumes: the first
 * hydration of a conversation only adopts its status, it does not arm recovery.
 */
export const useTomnyAgenticTurnRecovery = (options: UseTomnyAgenticTurnRecoveryOptions) => {
  const { conversation_id, running, isHydrated, config = DEFAULT_RECOVERY_CONFIG } = options;

  const stateRef = useRef<RecoveryState>(createInitialRecoveryState());
  const [view, setView] = useState<TurnRecoveryView | null>(null);
  // Set the moment the user clicks stop or cancels recovery, so an in-flight check
  // can never mistake a deliberate cancel for an unintentional interruption.
  const userStoppedRef = useRef(false);
  // Guards the async liveness-check / resume so the ticker doesn't fire twice.
  const busyRef = useRef(false);
  const runningRef = useRef(running);
  const hydratedRef = useRef(false);

  const latest = useRef({
    resume: options.resume,
    getResumePayload: options.getResumePayload,
    config,
  });
  useEffect(() => {
    latest.current = {
      resume: options.resume,
      getResumePayload: options.getResumePayload,
      config,
    };
  }, [options.resume, options.getResumePayload, config]);

  /** Single write path for recovery state: keeps the ref and the rendered view in sync. */
  const commit = useCallback((next: RecoveryState) => {
    stateRef.current = next;
    const nextView = toView(next, latest.current.config);
    setView((prev) => (isSameView(prev, nextView) ? prev : nextView));
  }, []);

  /** An unintentional interruption: start the countdown (or the exhausted wait). */
  const interrupt = useCallback(() => {
    if (userStoppedRef.current) return;
    if (!['watching', 'verifying'].includes(stateRef.current.phase)) return;
    commit(enterCooldown(stateRef.current, Date.now(), latest.current.config));
  }, [commit]);

  /** Send the continue turn now. A failed send counts as an interruption again. */
  const runResume = useCallback((): void => {
    if (busyRef.current) return;
    const payload = latest.current.getResumePayload();
    if (!payload) {
      commit(stopWatching());
      return;
    }
    busyRef.current = true;
    commit(markResumeAttempt(stateRef.current, Date.now()));
    void (async () => {
      try {
        await latest.current.resume(payload);
      } catch {
        interrupt();
      } finally {
        busyRef.current = false;
      }
    })();
  }, [commit, interrupt]);

  /** Called by the SendBox stop handler so recovery never fights a user cancel. */
  const notifyUserStop = useCallback(() => {
    userStoppedRef.current = true;
    commit(stopWatching());
  }, [commit]);

  /** User dismissed the countdown or exhausted prompt: stop until the next turn. */
  const cancelRecovery = useCallback(() => {
    userStoppedRef.current = true;
    commit(stopWatching());
  }, [commit]);

  /** User asked to retry now: starts a fresh cycle immediately. */
  const retryRecoveryNow = useCallback(() => {
    userStoppedRef.current = false;
    stateRef.current = { ...stateRef.current, consecutiveRejections: 0 };
    runResume();
  }, [runResume]);

  // Single stream subscription: heartbeat + interruption detection.
  useEffect(() => {
    const unsubscribe = ipcBridge.conversation.responseStream.on((message) => {
      if (message.conversation_id !== conversation_id) return;

      // Any stream event is a heartbeat: the backend is alive and working.
      stateRef.current = recordActivity(stateRef.current, Date.now());

      // The backend reported an error for this turn (provider/API-key failure,
      // network drop). A finish may be intermediate, so we leave it to the watcher.
      if (message.type === 'error') interrupt();
    });
    return unsubscribe;
  }, [conversation_id, interrupt]);

  // Turn-completion subscription: authoritative stop cause from the backend.
  useEffect(() => {
    const unsubscribe = ipcBridge.conversation.turnCompleted.on((event) => {
      if (event.session_id !== conversation_id) return;

      if (event.state === 'stopped') {
        // Deliberate stop (user or backend cancel) — never resume.
        commit(stopWatching());
        return;
      }
      if (event.state === 'ai_waiting_input') {
        // Normal completion — the next genuine interruption starts a fresh cycle.
        commit(markRecovered());
        return;
      }
      if (event.state === 'error') interrupt();
    });
    return unsubscribe;
  }, [conversation_id, commit, interrupt]);

  // Arm/disarm watching as the running state flips.
  useEffect(() => {
    const wasRunning = runningRef.current;
    runningRef.current = running;
    const wasHydrated = hydratedRef.current;
    hydratedRef.current = isHydrated;
    if (!isHydrated) return;
    // First hydration of this conversation (including after an app restart, where
    // the backend may still report a stale 'running' status): adopt the state, never arm.
    if (!wasHydrated) return;

    if (running && !wasRunning) {
      // A new turn started by the user. Clear the stop flag and start watching.
      userStoppedRef.current = false;
      commit(startWatching(stateRef.current, Date.now()));
    } else if (!running && wasRunning) {
      // The UI says the turn ended, but that alone does not prove a clean finish.
      // Verify briefly; a late clean turnCompleted resets the cycle, otherwise the
      // ticker polls the backend and treats it as an interruption.
      if (stateRef.current.phase === 'watching') {
        commit(beginVerifying(stateRef.current, Date.now()));
      }
    }
  }, [running, isHydrated, commit]);

  // Recovery ticker: confirm liveness on stall, count down, then resume or re-ask.
  useEffect(() => {
    const timer = setInterval(() => {
      if (busyRef.current) return;
      const current = stateRef.current;
      const action = evaluateRecovery(current, Date.now(), latest.current.config);
      if (action.type === 'none') return;

      if (action.type === 'check-liveness') {
        busyRef.current = true;
        void (async () => {
          try {
            const res = await getConversationOrNull(conversation_id);
            // Still running on the backend → not a real stall, just quiet work.
            if (res?.status === 'running') {
              stateRef.current = recordActivity(stateRef.current, Date.now());
              return;
            }
            interrupt();
          } catch {
            // The liveness poll itself failed (backend unreachable): treat as an interruption.
            interrupt();
          } finally {
            busyRef.current = false;
          }
        })();
        return;
      }

      if (action.type === 'resume') {
        runResume();
        return;
      }

      if (action.type === 'reask') {
        commit(beginReask(current, Date.now(), latest.current.config));
      }
    }, TICK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [conversation_id, commit, interrupt, runResume]);

  // Reset all recovery state when the conversation changes.
  useEffect(() => {
    stateRef.current = createInitialRecoveryState();
    userStoppedRef.current = false;
    busyRef.current = false;
    setView(null);
    return () => {
      stateRef.current = createInitialRecoveryState();
    };
  }, [conversation_id]);

  return { notifyUserStop, recovery: view, cancelRecovery, retryRecoveryNow };
};
