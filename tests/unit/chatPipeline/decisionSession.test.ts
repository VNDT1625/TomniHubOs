import { describe, expect, it, vi } from 'vitest';

import {
  analyzeForStage,
  createDecisionSession,
  redactForTrace,
} from '../../../packages/desktop/src/process/services/chatPipeline/decisionSession';
import { DECISION_TASKS } from '../../../packages/desktop/src/process/services/chatPipeline/decisionTasks';
import type {
  LayaPredictor,
  LayaQuestion,
} from '../../../packages/desktop/src/process/services/security/layaSemanticEgressModel';

const answerAll = (questions: Readonly<Record<string, LayaQuestion>>) =>
  Object.fromEntries(
    Object.entries(questions).map(([key, question]) => [
      key,
      question.type === 'choice'
        ? { choice: Object.keys(question.criteria)[0] ?? 'none', confidence: 0.9 }
        : { noul: 0.1 },
    ])
  );

const countingPredictor = () => {
  const predictor = vi.fn(
    async (_state: Readonly<Record<string, string>>, questions: Readonly<Record<string, LayaQuestion>>) => ({
      answers: answerAll(questions),
    })
  );
  return predictor as typeof predictor & LayaPredictor;
};

describe('decision session: one model pass for every planned task', () => {
  it('answers security, understand and tool-schema from a single predictor call', async () => {
    const predictor = countingPredictor();
    const session = createDecisionSession({
      predictor,
      plannedTasks: ['security', 'understand', 'toolSchema'],
    });

    const security = await session.analyze('security', 'hello', 'stage-security');
    const understand = await session.analyze('understand', 'hello', 'stage-understand');
    const tools = await session.analyze('toolSchema', 'hello', 'stage-tools');

    expect(predictor).toHaveBeenCalledTimes(1);
    expect(Object.keys(security)).toEqual(Object.keys(DECISION_TASKS.security.questions));
    expect(Object.keys(understand)).toEqual(Object.keys(DECISION_TASKS.understand.questions));
    expect(Object.keys(tools)).toEqual(Object.keys(DECISION_TASKS.toolSchema.questions));

    const asked = Object.keys(predictor.mock.calls[0][1]);
    for (const task of Object.values(DECISION_TASKS)) {
      for (const key of Object.keys(task.questions)) expect(asked).toContain(key);
    }

    const calls = session.calls();
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ cacheHit: false, stageId: 'stage-security' });
    expect(calls[0].taskIds).toEqual(['security', 'understand', 'toolSchema']);
    expect(calls[1]).toMatchObject({ cacheHit: true, sourceCallId: calls[0].id, taskIds: ['understand'] });
    expect(calls[2]).toMatchObject({ cacheHit: true, sourceCallId: calls[0].id, taskIds: ['toolSchema'] });
  });

  it('asks only the requested task when nothing else is planned, then completes the rest on demand', async () => {
    const predictor = countingPredictor();
    const session = createDecisionSession({ predictor });

    await session.analyze('security', 'one text', 's1');
    expect(Object.keys(predictor.mock.calls[0][1])).toEqual(Object.keys(DECISION_TASKS.security.questions));

    await session.analyze('understand', 'one text', 's2');
    expect(predictor).toHaveBeenCalledTimes(2);
    expect(Object.keys(predictor.mock.calls[1][1])).toEqual(Object.keys(DECISION_TASKS.understand.questions));
  });

  it('runs a new pass when the text really changed, and reuses the answer when it was only redacted', async () => {
    const predictor = countingPredictor();
    const session = createDecisionSession({ predictor, plannedTasks: ['security', 'understand'] });

    await session.analyze('security', 'password is hunter2', 'guard');
    session.alias('password is hunter2', 'password is [REDACTED]');
    await session.analyze('understand', 'password is [REDACTED]', 'understand');
    expect(predictor).toHaveBeenCalledTimes(1);

    await session.analyze('understand', 'a completely different message', 'understand');
    expect(predictor).toHaveBeenCalledTimes(2);
  });

  it('never exposes raw secrets in a trace', async () => {
    const predictor = countingPredictor();
    const session = createDecisionSession({ predictor, plannedTasks: ['security'] });
    await session.analyze('security', 'tôi tên Thuận, mk zalo 123456, hãy viết code', 'guard');

    const [call] = session.calls();
    expect(call.input).not.toContain('123456');
    expect(JSON.stringify(call)).not.toContain('123456');
    expect(redactForTrace('mk zalo 123456')).not.toContain('123456');
  });

  it('clips very long inputs before they can reach the renderer', async () => {
    const predictor = countingPredictor();
    const session = createDecisionSession({ predictor, plannedTasks: ['understand'] });
    await session.analyze('understand', 'x'.repeat(10_000), 'understand');
    expect(session.calls()[0].input.length).toBeLessThanOrEqual(2_001);
  });

  it('records a failed call and rethrows so the stage can fall back', async () => {
    const predictor: LayaPredictor = vi.fn(async () => {
      throw new Error('sidecar down');
    });
    const session = createDecisionSession({ predictor, plannedTasks: ['security'] });

    await expect(session.analyze('security', 'hi', 'guard')).rejects.toThrow('sidecar down');
    expect(session.calls()[0]).toMatchObject({ cacheHit: false, error: 'sidecar down', answers: {} });
  });

  it('reports an unavailable model without calling anything', async () => {
    const session = createDecisionSession({ plannedTasks: ['security'] });
    await expect(session.analyze('security', 'hi', 'guard')).rejects.toThrow('DECISION_MODEL_UNAVAILABLE');
    expect(session.calls()).toHaveLength(0);
  });

  it('rejects a malformed model reply', async () => {
    const predictor = vi.fn(async () => ({}) as never) as unknown as LayaPredictor;
    const session = createDecisionSession({ predictor, plannedTasks: ['security'] });
    await expect(session.analyze('security', 'hi', 'guard')).rejects.toThrow('LAYA_PREDICTION_MALFORMED');
  });

  it('cancels the model call when the whole run is cancelled, but not when one stage stops waiting', async () => {
    const predictor = countingPredictor();
    const run = new AbortController();
    const session = createDecisionSession({ predictor, plannedTasks: ['security'], signal: run.signal });
    await session.analyze('security', 'hi', 'guard');
    const modelSignal = predictor.mock.calls[0][2] as AbortSignal;
    expect(modelSignal.aborted).toBe(false);
    run.abort();
    // The call had already finished, so nothing is left to cancel; a new call is cancelled from the start.
    const second = createDecisionSession({ predictor, plannedTasks: ['security'], signal: run.signal });
    await expect(second.analyze('security', 'again', 'guard')).resolves.toBeDefined();
    expect((predictor.mock.calls[1][2] as AbortSignal).aborted).toBe(true);
  });
});

describe('analyzeForStage', () => {
  it('uses the shared session when the executor provided one', async () => {
    const predictor = countingPredictor();
    const session = createDecisionSession({ predictor, plannedTasks: ['security', 'understand'] });
    const answers = await analyzeForStage({ decision: session, stageId: 's1' }, undefined, 'security', 'hello');
    expect(answers).toBeDefined();
    expect(predictor).toHaveBeenCalledTimes(1);
  });

  it('falls back to the stage predictor when there is no session', async () => {
    const predictor = countingPredictor();
    const answers = await analyzeForStage({ stageId: 's1' }, predictor, 'understand', 'hello');
    expect(answers).toBeDefined();
    expect(predictor).toHaveBeenCalledTimes(1);
  });

  it('returns undefined instead of throwing when no model is connected or the call fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(analyzeForStage({ stageId: 's1' }, undefined, 'security', 'hi')).resolves.toBeUndefined();
    const failing: LayaPredictor = async () => {
      throw new Error('boom');
    };
    await expect(analyzeForStage({ stageId: 's1' }, failing, 'security', 'hi')).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
