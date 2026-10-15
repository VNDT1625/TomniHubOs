/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { redactSecretText } from '@process/agentRuntime/agentMesh/security/secretFirewall';
import type { RepoProcessLogLine } from './repoProcessPorts';

export const MAX_LOG_LINES = 1000;
export const MAX_LOG_LINE_CHARS = 2000;
const MIN_SECRET_LENGTH = 4;
const REDACTED = '[redacted]';

export type RepoProcessLog = Readonly<{
  append: (stream: 'stdout' | 'stderr', chunk: string) => void;
  /** Emits a pending partial line. */
  flush: () => void;
  /** Values that must never appear in stored output (declared secrets). */
  addSecret: (value: string) => void;
  lines: () => readonly RepoProcessLogLine[];
}>;

/**
 * Bounded ring of scrubbed output lines. Scrubbing happens before a line is stored, so nothing downstream (renderer,
 * model context, evidence) can see a secret that the process printed. Each line is capped, and so is the partial line
 * waiting for its newline.
 */
export const createRepoProcessLog = (now: () => number, maxLines: number = MAX_LOG_LINES): RepoProcessLog => {
  const ring: RepoProcessLogLine[] = [];
  const pending: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
  const secrets = new Set<string>();

  const scrub = (text: string): string => {
    let result = text;
    for (const secret of secrets) result = result.split(secret).join(REDACTED);
    return redactSecretText(result).text;
  };

  const push = (stream: 'stdout' | 'stderr', raw: string): void => {
    const text = scrub(raw.length > MAX_LOG_LINE_CHARS ? raw.slice(0, MAX_LOG_LINE_CHARS) : raw);
    ring.push({ stream, text, at: now() });
    if (ring.length > maxLines) ring.splice(0, ring.length - maxLines);
  };

  const append = (stream: 'stdout' | 'stderr', chunk: string): void => {
    const parts = (pending[stream] + chunk).split(/\r?\n/u);
    pending[stream] = parts.pop() ?? '';
    for (const part of parts) push(stream, part);
    // A line without a newline must not grow without bound, and must not hold a secret open across the cap.
    while (pending[stream].length >= MAX_LOG_LINE_CHARS) {
      push(stream, pending[stream].slice(0, MAX_LOG_LINE_CHARS));
      pending[stream] = pending[stream].slice(MAX_LOG_LINE_CHARS);
    }
  };

  return {
    append,
    flush: () => {
      for (const stream of ['stdout', 'stderr'] as const) {
        if (pending[stream] !== '') push(stream, pending[stream]);
        pending[stream] = '';
      }
    },
    addSecret: (value) => {
      if (value.length >= MIN_SECRET_LENGTH) secrets.add(value);
    },
    lines: () => ring.slice(),
  };
};
