import { describe, expect, it } from 'vitest';

import {
  createCoreEvaluationRunner,
  type CoreEvaluationCoreAggregate,
} from '@/process/services/diagnostics/coreEvaluation/runner';

const candidate = {
  artifactDigest: `sha256-${'a'.repeat(64)}`,
  sourceRevision: 'release-2026.08.20',
  rollbackTarget: 'release-2026.08.19',
} as const;

const PROVENANCE_KIND_BY_CORE = {
  security: 'synthetic-adversarial',
  'user-intelligence': 'synthetic-causal',
  orchestration: 'synthetic-routing',
} as const;

const aggregate = (core: CoreEvaluationCoreAggregate['core']): CoreEvaluationCoreAggregate => ({
  core,
  corpus: {
    corpusSchemaVersion: 1,
    corpusVersion: 'frozen-v1',
    corpusDigest: `sha256-${'b'.repeat(64)}`,
    provenance: { kind: PROVENANCE_KIND_BY_CORE[core], sourceId: 'tomni.evaluation' },
    consentPolicyVersion: 'synthetic-no-personal-data-v1',
    deletionLedgerVersion: 'synthetic-deletion-ledger-v1',
    heldout: true,
  },
  metrics: [{ id: 'safe', numerator: 1, denominator: 1, comparator: 'gte', floor: 1, passed: true }],
});

describe('core evaluation runner', () => {
  it('produces deterministic, aggregate-only candidate evidence with promotion permanently disabled', async () => {
    const runner = createCoreEvaluationRunner();

    const first = await runner.run(candidate);
    const second = await runner.run(candidate);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      status: 'candidate-only',
      codes: [],
      containsUserData: false,
      trainingPerformed: false,
      promotionAllowed: false,
    });
    expect(JSON.stringify(first)).not.toContain('Synthetic context');
    expect(JSON.stringify(first)).not.toContain('Synthetic reason');
    expect(first.cores).toHaveLength(3);
    expect(first.cores.every((core) => core.corpus.heldout)).toBe(true);
  });

  it('starts the three evaluation seams concurrently', async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = (core: CoreEvaluationCoreAggregate['core']) => async () => {
      started.push(core);
      await gate;
      return aggregate(core);
    };
    const runner = createCoreEvaluationRunner({
      security: run('security'),
      userIntelligence: run('user-intelligence'),
      orchestration: run('orchestration'),
    });

    const pending = runner.run(candidate);
    await Promise.resolve();
    expect(started).toEqual(['security', 'user-intelligence', 'orchestration']);
    release();

    await expect(pending).resolves.toMatchObject({ status: 'candidate-only' });
  });

  it('fails closed for safety floors or incomplete corpus metadata', async () => {
    const unsafe = {
      ...aggregate('security'),
      metrics: [{ ...aggregate('security').metrics[0], numerator: 0, passed: true }],
    };
    const incomplete = {
      ...aggregate('user-intelligence'),
      corpus: { ...aggregate('user-intelligence').corpus, deletionLedgerVersion: '' },
    };
    const runner = createCoreEvaluationRunner({
      security: () => unsafe,
      userIntelligence: () => incomplete,
      orchestration: () => aggregate('orchestration'),
    });

    await expect(runner.run(candidate)).resolves.toMatchObject({
      status: 'rejected',
      codes: ['CORE_EVALUATION_METADATA_MISSING', 'CORE_EVALUATION_SAFETY_FLOOR_FAILED'],
      promotionAllowed: false,
    });
  });

  it('rejects candidate identifiers that could carry raw input', async () => {
    const runner = createCoreEvaluationRunner();

    await expect(runner.run({ ...candidate, sourceRevision: 'raw user text' })).resolves.toMatchObject({
      status: 'rejected',
      codes: ['CORE_EVALUATION_CANDIDATE_INVALID'],
      cores: [],
    });
  });
});
