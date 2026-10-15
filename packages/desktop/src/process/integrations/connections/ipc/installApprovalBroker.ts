/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The in-app confirmation of the code-running connections of a package that was just installed (docs/platform/
 * repotopackage-design.md section 9.4). Main sends one request to the main window and waits for one answer:
 * - only one request per package is pending; a second one is refused (Cancel);
 * - the answer must echo the request id and exactly the key set Main sent; anything else is ignored;
 * - no answer within the timeout, a closed window or a failed send is Cancel;
 * - without a window `ask` resolves to `undefined`, and the caller falls back to the native dialog.
 * The renderer only chooses approve, cancel or (start-again question only) dismiss, plus the start-again choice; Main recomputes every approval hash later.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { InstallApprovalPrompt, InstallApprovalRequest } from '@/common/types/platform/packageConnections';
import type {
  InstallActivationAnswer,
  InstallActivationRequest,
} from '@process/integrations/connections/wiring/installActivation';
import { buildInstallApprovalRequest } from '@process/integrations/connections/wiring/installApprovalView';

export const INSTALL_APPROVAL_TIMEOUT_MS = 5 * 60_000;

const CANCEL: InstallActivationAnswer = { approved: false, autoStart: false };

/** Strict: a response carrying any other field is refused whole. */
const RESPONSE = z
  .object({
    requestId: z.string().uuid(),
    decision: z.enum(['approve', 'cancel', 'dismiss']),
    autoStart: z.boolean(),
    keys: z.array(z.string().min(3).max(300)).max(200),
  })
  .strict();

type Entry = Readonly<{
  packageId: string;
  keys: readonly string[];
  /** The exact request that was sent, so a renderer that reloads can be shown it again. */
  payload: InstallApprovalRequest;
  settle: (answer: InstallActivationAnswer | undefined) => void;
  timer: ReturnType<typeof setTimeout>;
}>;

export type InstallApprovalBrokerDeps = Readonly<{
  /** Sends the request to the main window only. False when no window can show it. */
  send: (request: InstallApprovalRequest) => boolean;
  timeoutMs?: number;
}>;

export type InstallApprovalBroker = Readonly<{
  /**
   * Resolves to the person's answer, Cancel on timeout or refusal, or `undefined` when no window can show the request.
   * `prompt` defaults to the install confirmation; only `start-again` offers "do not ask again".
   */
  ask: (
    request: InstallActivationRequest,
    packageName: string,
    prompt?: InstallApprovalPrompt
  ) => Promise<InstallActivationAnswer | undefined>;
  /** Accepts a renderer answer only when it matches a pending request exactly. Returns whether it was accepted. */
  respond: (payload: unknown) => boolean;
  /** Requests still waiting for an answer, as they were sent. A reloaded window asks for them to show the dialog again. */
  pending: () => readonly InstallApprovalRequest[];
  /** Cancels every pending request (app shutdown or bridge teardown). */
  dispose: () => void;
}>;

/** The answered keys are exactly the shown keys: no extra key, no missing key, no duplicate. */
const sameKeys = (answered: readonly string[], shown: readonly string[]): boolean => {
  const given = new Set(answered);
  const expected = new Set(shown);
  return (
    given.size === answered.length &&
    expected.size === shown.length &&
    given.size === expected.size &&
    answered.every((key) => expected.has(key))
  );
};

export const createInstallApprovalBroker = (deps: InstallApprovalBrokerDeps): InstallApprovalBroker => {
  const timeoutMs = deps.timeoutMs ?? INSTALL_APPROVAL_TIMEOUT_MS;
  const pending = new Map<string, Entry>();

  const finish = (requestId: string, answer: InstallActivationAnswer | undefined): boolean => {
    const entry = pending.get(requestId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    pending.delete(requestId);
    entry.settle(answer);
    return true;
  };

  return {
    ask: (request, packageName, prompt = 'install') => {
      for (const entry of pending.values()) {
        if (entry.packageId === request.packageId) return Promise.resolve(CANCEL);
      }
      const payload = buildInstallApprovalRequest({
        requestId: randomUUID(),
        packageId: request.packageId,
        packageName,
        items: request.items,
        prompt,
      });
      return new Promise<InstallActivationAnswer | undefined>((resolve) => {
        const timer = setTimeout(() => finish(payload.requestId, CANCEL), timeoutMs);
        pending.set(payload.requestId, {
          packageId: request.packageId,
          keys: payload.keys,
          payload,
          settle: resolve,
          timer,
        });
        let sent = false;
        try {
          sent = deps.send(payload);
        } catch {
          sent = false;
        }
        if (!sent) finish(payload.requestId, undefined);
      });
    },
    respond: (payload) => {
      const parsed = RESPONSE.safeParse(payload);
      if (!parsed.success) return false;
      const entry = pending.get(parsed.data.requestId);
      if (!entry || !sameKeys(parsed.data.keys, entry.keys)) return false;
      const { decision } = parsed.data;
      if (decision === 'dismiss') {
        // "Do not ask again" exists only on the start-again question; an install question cannot carry it.
        if (entry.payload.prompt !== 'start-again') return false;
        return finish(parsed.data.requestId, { approved: false, autoStart: false, dismissed: true });
      }
      const approved = decision === 'approve';
      return finish(parsed.data.requestId, { approved, autoStart: approved && parsed.data.autoStart });
    },
    pending: () => [...pending.values()].map((entry) => entry.payload),
    dispose: () => {
      for (const requestId of pending.keys()) finish(requestId, CANCEL);
    },
  };
};
