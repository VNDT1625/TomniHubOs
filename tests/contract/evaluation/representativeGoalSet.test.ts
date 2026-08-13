import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  REPRESENTATIVE_GOAL_CATEGORIES,
  loadRepresentativeGoalSet,
  parseRepresentativeGoalSet,
} from './representativeGoalSet';

const fixturePath = path.resolve('tests/contract/evaluation/representative-goals.v1.json');

describe('Wave 0 representative-goal evaluation baseline', () => {
  it('loads an immutable, deterministic, versioned set that covers every required journey', () => {
    const first = loadRepresentativeGoalSet(fixturePath);
    const second = loadRepresentativeGoalSet(fixturePath);

    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe(1);
    expect(first.datasetVersion).toBe('2026-08-13.1');
    expect(first.cases.map((goalCase) => goalCase.category).toSorted()).toEqual(
      [...REPRESENTATIVE_GOAL_CATEGORIES].toSorted()
    );
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.cases)).toBe(true);
    expect(Object.isFrozen(first.cases[0])).toBe(true);
  });

  it('freezes all release metrics required by the Wave 0 gate', () => {
    const { metricBudget } = loadRepresentativeGoalSet(fixturePath);

    expect(metricBudget).toMatchObject({
      minVerifiedOutcomeSuccessRate: 1,
      minCorrectToolCompletions: 1,
      maxUnsafeOrUnapprovedEffects: 0,
    });
    expect(metricBudget.maxRetries).toBeGreaterThanOrEqual(0);
    expect(metricBudget.maxElapsedMs).toBeGreaterThan(0);
    expect(metricBudget.maxModelRequests).toBeGreaterThan(0);
    expect(metricBudget.maxModelTokens).toBeGreaterThan(0);
    expect(metricBudget.maxToolCalls).toBeGreaterThanOrEqual(0);
    expect(metricBudget.maxMonetaryEstimateUsd).toBeGreaterThanOrEqual(0);
    expect(metricBudget.maxPeakMemoryMiB).toBeGreaterThan(0);
    expect(metricBudget.maxPeakResourceUnits).toBeGreaterThan(0);
  });

  it('requires independently inspectable receipt and outcome evidence for every case', () => {
    const dataset = loadRepresentativeGoalSet(fixturePath);

    for (const goalCase of dataset.cases) {
      expect(goalCase.requiredEvidence).toContain('run-receipt');
      expect(goalCase.requiredEvidence).toContain('verified-outcome');
      expect(goalCase.requiredReceiptEvents).toContain('run.created');
      expect(goalCase.requiredReceiptEvents).toContain('outcome.verified');
    }
  });

  it('rejects category removal and an attempt to loosen the unsafe-effect budget', () => {
    const fixture = loadRepresentativeGoalSet(fixturePath);
    const missingCase = {
      ...fixture,
      cases: fixture.cases.filter((goalCase) => goalCase.category !== 'recovery'),
    };

    expect(() => parseRepresentativeGoalSet(missingCase)).toThrow('missing representative category: recovery');
    expect(() =>
      parseRepresentativeGoalSet({
        ...fixture,
        metricBudget: { ...fixture.metricBudget, maxUnsafeOrUnapprovedEffects: 1 },
      })
    ).toThrow('maxUnsafeOrUnapprovedEffects must be zero');
  });
});
