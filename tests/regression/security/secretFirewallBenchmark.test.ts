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
  firewallCases: number;
  secret: ClassMetrics;
  safe: ClassMetrics;
  privacyFixtures: {
    total: number;
    categories: string[];
    caseIds: string[];
    secretScannerProtectionMetric: 'not-applicable';
  };
  latency: {
    averageMs: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    scansPerSecond: number;
  };
  leakedSecretCaseIds: string[];
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

const classMetrics = (results: CaseResult[], classification: Exclude<SecurityBenchmarkClass, 'pii'>): ClassMetrics => {
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

/**
 * PII-shaped fixtures remain visible as separate privacy inputs. They are
 * deliberately excluded from this secret scanner's numerator and denominator:
 * redactSecretText is not a general PII classifier or cloud-consent control.
 */
export const runSecretFirewallBenchmark = (): SecurityBenchmarkReport => {
  const piiFixtures = SECURITY_BENCHMARK_CASES.filter((benchmarkCase) => benchmarkCase.classification === 'pii');
  const firewallCases = SECURITY_BENCHMARK_CASES.filter((benchmarkCase) => benchmarkCase.classification !== 'pii');
  for (let index = 0; index < 100; index += 1) {
    redactSecretText(firewallCases[index % firewallCases.length]!.input);
  }
  const results = firewallCases.map(evaluateCase);
  const secret = classMetrics(results, 'secret');
  const safe = classMetrics(results, 'safe');
  const durations = results.map((result) => result.durationMs).toSorted((left, right) => left - right);
  const totalDurationMs = durations.reduce((sum, duration) => sum + duration, 0);
  const averageMs = totalDurationMs / durations.length;
  return {
    totalCases: SECURITY_BENCHMARK_CASES.length,
    firewallCases: results.length,
    secret,
    safe,
    privacyFixtures: {
      total: piiFixtures.length,
      categories: [...new Set(piiFixtures.map((benchmarkCase) => benchmarkCase.category))].toSorted(),
      caseIds: piiFixtures.map((benchmarkCase) => benchmarkCase.id),
      secretScannerProtectionMetric: 'not-applicable',
    },
    latency: {
      averageMs: Number(averageMs.toFixed(4)),
      p50Ms: Number(percentile(durations, 0.5).toFixed(4)),
      p95Ms: Number(percentile(durations, 0.95).toFixed(4)),
      maxMs: Number((durations.at(-1) ?? 0).toFixed(4)),
      scansPerSecond: averageMs === 0 ? 0 : Math.round(1_000 / averageMs),
    },
    leakedSecretCaseIds: results
      .filter((result) => result.benchmarkCase.classification === 'secret' && !result.protected)
      .map((result) => result.benchmarkCase.id),
    falsePositiveCaseIds: results.filter((result) => result.falsePositive).map((result) => result.benchmarkCase.id),
  };
};

const report = runSecretFirewallBenchmark();
console.info(`[secret-firewall-benchmark]\n${JSON.stringify(report, null, 2)}`);

describe('Secret Firewall security benchmark', () => {
  it('keeps PII fixtures outside the secret scanner metric', () => {
    expect(report).toMatchObject({
      totalCases: 101,
      firewallCases: 81,
      privacyFixtures: {
        total: 20,
        categories: ['email', 'national-id', 'passport', 'phone', 'postal-address'],
        secretScannerProtectionMetric: 'not-applicable',
      },
    });
    expect(report).not.toHaveProperty('sensitiveCases');
    expect(report).not.toHaveProperty('leakedCases');
  });

  it('removes terminal-control-obfuscated secrets from the returned text', () => {
    const benchmarkCase = SECURITY_BENCHMARK_CASES.find(
      (candidate) => candidate.id === 'secret-terminal-control-obfuscation'
    )!;
    const result = redactSecretText(benchmarkCase.input);

    expect(result.redacted).toBe(true);
    for (const prohibitedRepresentation of benchmarkCase.protectedValues) {
      expect(result.text).not.toContain(prohibitedRepresentation);
    }
  });

  it('blocks at least 95 percent of known secret cases', () => {
    expect(report.secret.protectionRate).toBeGreaterThanOrEqual(0.95);
  });

  it('keeps the safe-control false-positive rate at or below five percent', () => {
    expect(report.safe.falsePositiveRate).toBeLessThanOrEqual(0.05);
  });

  it('keeps p95 synchronous filtering latency below 25 milliseconds per request', () => {
    expect(report.latency.p95Ms).toBeLessThan(25);
  });
});
