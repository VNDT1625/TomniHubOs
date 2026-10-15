/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

import { createDecisionSession } from '@process/services/chatPipeline/decisionSession';
import type { LayaPredictor } from '@process/services/security/layaSemanticEgressModel';

const answersFor = (questions: Record<string, unknown>) =>
  Object.fromEntries(Object.keys(questions).map((key) => [key, { noul: 0.5 }]));

/** A model that answers after `delayMs` and, like the real client, gives up when its signal aborts. */
const slowModel = (delayMs: number): LayaPredictor =>
  vi.fn(
    (_state, questions, signal) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ answers: answersFor(questions) as never }), delayMs);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Operation aborted'));
        });
      })
  ) as unknown as LayaPredictor;

describe('a model call outlives the stage that started it', () => {
  it('lets the next stage use the answer when the first stage stopped waiting', async () => {
    const predictor = slowModel(120);
    const session = createDecisionSession({ predictor, plannedTasks: ['security', 'understand'] });

    const stageDeadline = new AbortController();
    setTimeout(() => stageDeadline.abort(), 30);
    await expect(session.analyze('security', 'fix the bug', 's-security', stageDeadline.signal)).rejects.toThrow(
      'DECISION_STAGE_ABORTED'
    );

    // The second stage asks about the same text: it joins the call already running instead of repeating it.
    const understood = await session.analyze('understand', 'fix the bug', 's-understand');
    expect(Object.keys(understood)).toContain('intent');
    expect(predictor).toHaveBeenCalledTimes(1);

    const calls = session.calls();
    expect(calls).toHaveLength(2);
    expect(calls[0].error).toBeUndefined();
    expect(calls[1]).toMatchObject({ cacheHit: true, stageId: 's-understand' });
  });

  it('serves the stage that gave up from the cache once the call has finished', async () => {
    const predictor = slowModel(40);
    const session = createDecisionSession({ predictor, plannedTasks: ['security', 'understand'] });
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 5);
    await expect(session.analyze('security', 'hello', 's1', abort.signal)).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await expect(session.analyze('security', 'hello', 's1')).resolves.toBeDefined();
    expect(predictor).toHaveBeenCalledTimes(1);
  });
});

describe('model failures are classified, not shown as raw messages', () => {
  const failing = (error: Error): LayaPredictor => (async () => Promise.reject(error)) as LayaPredictor;

  it('reports a model that is still loading', async () => {
    const session = createDecisionSession({
      predictor: failing(new Error('[LayaSidecarClient] Sidecar is still starting')),
      plannedTasks: ['security'],
    });
    await expect(session.analyze('security', 'hi', 's')).rejects.toThrow('still starting');
    expect(session.calls()[0]).toMatchObject({ errorCode: 'starting' });
  });

  it('reports a call that ran past its own deadline as a timeout, not as "Operation aborted"', async () => {
    const session = createDecisionSession({
      predictor: slowModel(10_000),
      plannedTasks: ['security'],
      callDeadlineMs: 40,
    });
    await expect(session.analyze('security', 'hi', 's')).rejects.toThrow();
    expect(session.calls()[0]).toMatchObject({ errorCode: 'timeout' });
  });

  it('reports a cancelled run as cancelled', async () => {
    const run = new AbortController();
    const session = createDecisionSession({
      predictor: slowModel(10_000),
      plannedTasks: ['security'],
      signal: run.signal,
    });
    const pending = session.analyze('security', 'hi', 's');
    setTimeout(() => run.abort(), 10);
    await expect(pending).rejects.toThrow();
    expect(session.calls()[0]).toMatchObject({ errorCode: 'cancelled' });
  });

  it('reports a model that says it is unavailable, with the stable code', async () => {
    const session = createDecisionSession({
      predictor: failing(new Error('DECISION_MODEL_UNAVAILABLE')),
      plannedTasks: ['security'],
    });
    await expect(session.analyze('security', 'hi', 's')).rejects.toThrow('DECISION_MODEL_UNAVAILABLE');
    expect(session.calls()[0]).toMatchObject({ errorCode: 'unavailable' });
  });

  it('falls back to "failed" for anything else, with the detail clipped', async () => {
    const session = createDecisionSession({
      predictor: failing(new Error('x'.repeat(500))),
      plannedTasks: ['security'],
    });
    await expect(session.analyze('security', 'hi', 's')).rejects.toThrow();
    const [call] = session.calls();
    expect(call.errorCode).toBe('failed');
    expect(call.error?.length).toBeLessThanOrEqual(200);
  });

  it('never leaves an unhandled rejection when nobody is waiting for a failed call', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const session = createDecisionSession({ predictor: failing(new Error('boom')), plannedTasks: ['security'] });
      const abort = new AbortController();
      abort.abort();
      await expect(session.analyze('security', 'hi', 's', abort.signal)).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
