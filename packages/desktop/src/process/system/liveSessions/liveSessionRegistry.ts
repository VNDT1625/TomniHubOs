/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  LIVE_SESSION_LIMITS,
  normalizeActions,
  normalizeSessions,
  type LiveSession,
  type LiveSessionActions,
  type LiveSessionApp,
  type LiveSessionsSnapshot,
} from '@/common/liveSessions/model';

const DEFAULT_THROTTLE_MS = 200;

export type LiveSessionRegistryOptions = { now?: () => number; throttleMs?: number };

/**
 * Main-owned, in-memory list of the sessions each app keeps alive. An app's
 * report replaces its whole list; an empty list removes the app. Malformed
 * input is ignored without an error, so a broken package never disturbs Hub.
 */
export class LiveSessionRegistry {
  private readonly apps = new Map<
    string,
    { sessions: LiveSession[]; updatedAt: number; actions: LiveSessionActions | undefined }
  >();
  private readonly listeners = new Set<(snapshot: LiveSessionsSnapshot) => void>();
  private readonly now: () => number;
  private readonly throttleMs: number;
  private pending: ReturnType<typeof setTimeout> | undefined;

  public constructor(options: LiveSessionRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  }

  /** True when the report was valid and applied. */
  public report(appId: string, input: unknown, actions?: unknown): boolean {
    if (typeof appId !== 'string' || appId.length === 0 || appId.length > LIVE_SESSION_LIMITS.id) return false;
    const sessions = normalizeSessions(input);
    if (sessions === undefined) return false;
    if (sessions.length === 0) this.apps.delete(appId);
    else this.apps.set(appId, { sessions, updatedAt: this.now(), actions: normalizeActions(actions) });
    this.schedule();
    return true;
  }

  public clear(appId: string): void {
    if (this.apps.delete(appId)) this.schedule();
  }

  public snapshot(): LiveSessionsSnapshot {
    const apps = [...this.apps.entries()]
      .map(([appId, entry]): LiveSessionApp => {
        const app: LiveSessionApp = { appId, sessions: entry.sessions, updatedAt: entry.updatedAt };
        if (entry.actions) app.actions = { ...entry.actions };
        return app;
      })
      .toSorted((left, right) => right.updatedAt - left.updatedAt);
    return { generatedAt: this.now(), apps };
  }

  public subscribe(listener: (snapshot: LiveSessionsSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public dispose(): void {
    if (this.pending) clearTimeout(this.pending);
    this.pending = undefined;
    this.listeners.clear();
  }

  private schedule(): void {
    if (this.pending || this.listeners.size === 0) return;
    this.pending = setTimeout(() => {
      this.pending = undefined;
      const snapshot = this.snapshot();
      for (const listener of this.listeners) {
        try {
          listener(snapshot);
        } catch {
          // A failing listener must not stop the others.
        }
      }
    }, this.throttleMs);
    this.pending.unref?.();
  }
}

let shared: LiveSessionRegistry | undefined;

/** The process-wide registry every source reports to. */
export const getLiveSessionRegistry = (): LiveSessionRegistry => {
  shared ??= new LiveSessionRegistry();
  return shared;
};
