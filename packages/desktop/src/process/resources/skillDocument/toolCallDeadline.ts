/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hard upper bound for one agent-facing call (2026-10-15). A call that does not settle in time rejects with a
 * {@link ToolCallDeadlineError} whose message the agent can read, so the run continues instead of waiting on the
 * call forever. The abandoned work receives an aborted signal and its late result is ignored.
 * Process boundary: Main-process module, no DOM APIs.
 */

/** Default hard bound for one tool call, in milliseconds. */
export const TOOL_CALL_DEADLINE_MS = 60_000;

/** Raised when a bounded call does not settle before its deadline. The message is written for the agent. */
export class ToolCallDeadlineError extends Error {
  readonly deadlineMs: number;

  constructor(label: string, deadlineMs: number) {
    super(
      `${label} did not finish within ${Math.round(deadlineMs / 1000)}s and was stopped. Do not retry the same call; continue without it or choose another capability.`
    );
    this.name = 'ToolCallDeadlineError';
    this.deadlineMs = deadlineMs;
  }
}

/**
 * Runs `work` and rejects with {@link ToolCallDeadlineError} when it has not settled within `deadlineMs`.
 * The signal passed to `work` aborts at the deadline so the work can release what it holds.
 */
export const runWithDeadline = async <T>(
  label: string,
  work: (signal: AbortSignal) => Promise<T>,
  deadlineMs: number = TOOL_CALL_DEADLINE_MS
): Promise<T> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ToolCallDeadlineError(label, deadlineMs));
    }, deadlineMs);
  });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};
