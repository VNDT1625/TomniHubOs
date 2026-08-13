import { describe, expect, it } from 'vitest';

import { redactSecretText } from '@process/agentRuntime/agentMesh/security';
import {
  SECURITY_BENCHMARK_CASES,
  type SecurityBenchmarkCase,
  type SecurityBenchmarkClass,
} from './secretFirewallCases';

type ClassMetrics = {
  total: number;
  protected: number;
  leaked: number;
  protectionRate: number;
  falsePositives: number;
  falsePositiveRate: number;
};

type CaseResult = {
  benchmarkCase: SecurityBenchmarkCase;
  protected: boolean;
  falsePositive: boolean;
  durationMs: number;
};

type SecurityBenchmarkReport = {
  totalCases: number;
  sensitiveCases: number;
  protectedCases: number;
  leakedCases: number;
  overallProtectionRate: number;
  falsePositives: number;
  falsePositiveRate: number;
  byClass: Record<SecurityBenchmarkClass, ClassMetrics>;
  latency: {
    averageMs: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    scansPerSecond: number;
  };
  leakedCaseIds: string[];
  falsePositiveCaseIds: string[];
};

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 1 : Number((numerator / denominator).toFixed(4));

const percentile = (sorted: number[], value: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1);
  return sorted[index] ?? 0;
};

const evaluateCase = (benchmarkCase: SecurityBenchmarkCase): CaseResult => {
  const startedAt = performance.now();
  const result = redactSecretText(benchmarkCase.input);
  const durationMs = performance.now() - startedAt;
  const leaked = benchmarkCase.protectedValues.some((value) => result.text.includes(value));
  const isSafe = benchmarkCase.classification === 'safe';
  return {
    benchmarkCase,
    protected: !isSafe && !leaked,
    falsePositive: isSafe && (result.redacted || result.text !== benchmarkCase.input),
    durationMs,
  };
};

const classMetrics = (results: CaseResult[], classification: SecurityBenchmarkClass): ClassMetrics => {
  const selected = results.filter((result) => result.benchmarkCase.classification === classification);
  const protectedCount = selected.filter((result) => result.protected).length;
  const leaked = classification === 'safe' ? 0 : selected.length - protectedCount;
  const falsePositives = selected.filter((result) => result.falsePositive).length;
  return {
    total: selected.length,
    protected: protectedCount,
    leaked,
    protectionRate: classification === 'safe' ? 1 : ratio(protectedCount, selected.length),
    falsePositives,
    falsePositiveRate: ratio(falsePositives, selected.length),
  };
};

export const runSecretFirewallBenchmark = (): SecurityBenchmarkReport => {
  for (let index = 0; index < 100; index += 1) {
    redactSecretText(SECURITY_BENCHMARK_CASES[index % SECURITY_BENCHMARK_CASES.length]!.input);
  }
  const results = SECURITY_BENCHMARK_CASES.map(evaluateCase);
  const byClass = {
    secret: classMetrics(results, 'secret'),
    pii: classMetrics(results, 'pii'),
    safe: classMetrics(results, 'safe'),
  };
  const sensitiveCases = byClass.secret.total + byClass.pii.total;
  const protectedCases = byClass.secret.protected + byClass.pii.protected;
  const durations = results.map((result) => result.durationMs).toSorted((left, right) => left - right);
  const totalDurationMs = durations.reduce((sum, duration) => sum + duration, 0);
  const averageMs = totalDurationMs / durations.length;
  return {
    totalCases: results.length,
    sensitiveCases,
    protectedCases,
    leakedCases: sensitiveCases - protectedCases,
    overallProtectionRate: ratio(protectedCases, sensitiveCases),
    falsePositives: byClass.safe.falsePositives,
    falsePositiveRate: byClass.safe.falsePositiveRate,
    byClass,
    latency: {
      averageMs: Number(averageMs.toFixed(4)),
      p50Ms: Number(percentile(durations, 0.5).toFixed(4)),
      p95Ms: Number(percentile(durations, 0.95).toFixed(4)),
      maxMs: Number((durations.at(-1) ?? 0).toFixed(4)),
      scansPerSecond: averageMs === 0 ? 0 : Math.round(1_000 / averageMs),
    },
    leakedCaseIds: results
      .filter((result) => result.benchmarkCase.classification !== 'safe' && !result.protected)
      .map((result) => result.benchmarkCase.id),
    falsePositiveCaseIds: results.filter((result) => result.falsePositive).map((result) => result.benchmarkCase.id),
  };
};

const report = runSecretFirewallBenchmark();
console.info(`[secret-firewall-benchmark]\n${JSON.stringify(report, null, 2)}`);

describe('Secret Firewall security benchmark', () => {
  it('measures exactly 100 synthetic cases across secrets, PII, and safe controls', () => {
    expect(report.totalCases).toBe(100);
    expect(report.byClass).toMatchObject({ secret: { total: 60 }, pii: { total: 20 }, safe: { total: 20 } });
  });

  it('blocks at least 95 percent of known secret cases', () => {
    expect(report.byClass.secret.protectionRate).toBeGreaterThanOrEqual(0.95);
  });

  it('keeps the safe-control false-positive rate at or below five percent', () => {
    expect(report.byClass.safe.falsePositiveRate).toBeLessThanOrEqual(0.05);
  });

  it('keeps p95 synchronous filtering latency below 25 milliseconds per request', () => {
    expect(report.latency.p95Ms).toBeLessThan(25);
  });
});
