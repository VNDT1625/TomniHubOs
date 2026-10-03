import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type SourceAssertion = Readonly<{
  path: string;
  requiredMarkers: readonly string[];
}>;

type UnprovenReleaseCoverage = Readonly<{
  id: string;
  owner: string;
  status: 'fixture-only' | 'not-reachable';
}>;

const PROJECT_ROOT = process.cwd();
const PROCESS_ROOT = 'packages/desktop/src/process';

const readSource = (path: string): string => {
  const absolutePath = resolve(PROJECT_ROOT, path);
  if (!existsSync(absolutePath)) throw new Error('C3 local/cloud boundary inventory source missing: ' + path);
  return readFileSync(absolutePath, 'utf8');
};

/**
 * These are deterministic conformance fixtures, not a package-backed release
 * journey. They demonstrate routing policy and a no-fallback rejection only.
 */
const CURRENT_CONFORMANCE_FIXTURE_EVIDENCE: readonly SourceAssertion[] = [
  {
    path: `${PROCESS_ROOT}/services/diagnostics/orchestrationEvaluationCorpus.ts`,
    requiredMarkers: [
      'This module is evaluation-only: it neither learns from live users nor makes',
      'runtime routing, installation, or permission decisions.',
      "export type EvaluationPlanMode = 'local' | 'remote' | 'hybrid' | 'proposal-only' | 'blocked';",
      'export const buildOrchestrationEvaluationPlan = (goal: OrchestrationEvaluationGoal): OrchestrationPlan => {',
    ],
  },
  {
    path: 'tests/integration/c3CoreConformance.test.ts',
    requiredMarkers: [
      "provenance: { kind: 'synthetic-routing', sourceId: 'c3-surface-routing-v2' },",
      "it('keeps causal scope and cloud consent constraints from becoming projections, and offline work from silently routing remote'",
      "it('fails an unavailable explicit local selection without substituting a remote target or egress execution'",
      'expect(remoteExecution).not.toHaveBeenCalled();',
    ],
  },
] as const;

/**
 * The currently reachable AI-to-Surface action is intentionally C4 local-only.
 * An execute-remote planning result therefore has no corresponding package action
 * admission in this composition path.
 */
const CURRENT_LOCAL_ONLY_ACTION_BOUNDARY: SourceAssertion = {
  path: `${PROCESS_ROOT}/resources/packageCapability/goalCapability/surfaceAiActionExecution.ts`,
  requiredMarkers: [
    "if (step.kind !== 'execute-local') throw new SurfaceAiActionExecutionError('SURFACE_AI_ACTION_STEP_INVALID');",
    "constraints: ['offline_only', 'private_only', `target:${input.targetId}`],",
    'or enables a cloud Surface placement.',
  ],
};

/**
 * These are release/package gaps, deliberately retained as explicit inventory
 * entries so a passing evaluator or child-receipt fixture is not reported as
 * C3/C5 product proof.
 */
const NAMED_UNPROVEN_RELEASE_PACKAGE_COVERAGE: readonly UnprovenReleaseCoverage[] = [
  {
    id: 'cloud-package-action-admission',
    owner: 'C5B remote Surface action admission and exact-consent composition',
    status: 'not-reachable',
  },
  {
    id: 'remote-session-identity-presentation-artifact-lifecycle',
    owner: 'C5B authenticated remote session and artifact-transfer journey',
    status: 'fixture-only',
  },
  {
    id: 'packaged-local-cloud-hybrid-release-journey',
    owner: 'C5B/C5C packaged clean-machine release harness',
    status: 'not-reachable',
  },
] as const;

describe('C3 local execution and cloud fallback boundary inventory', () => {
  it('pins the current synthetic routing and explicit-local no-fallback fixture without treating it as runtime coverage', () => {
    for (const assertion of CURRENT_CONFORMANCE_FIXTURE_EVIDENCE) {
      const content = readSource(assertion.path);
      for (const marker of assertion.requiredMarkers) expect(content, assertion.path + ': ' + marker).toContain(marker);
    }
  });

  it('keeps local-only action composition and missing package/release coverage explicit', () => {
    const localActionSource = readSource(CURRENT_LOCAL_ONLY_ACTION_BOUNDARY.path);
    for (const marker of CURRENT_LOCAL_ONLY_ACTION_BOUNDARY.requiredMarkers) {
      expect(localActionSource, CURRENT_LOCAL_ONLY_ACTION_BOUNDARY.path + ': ' + marker).toContain(marker);
    }
    expect(localActionSource).not.toContain("step.kind !== 'execute-remote'");
    expect(NAMED_UNPROVEN_RELEASE_PACKAGE_COVERAGE).toEqual([
      {
        id: 'cloud-package-action-admission',
        owner: 'C5B remote Surface action admission and exact-consent composition',
        status: 'not-reachable',
      },
      {
        id: 'remote-session-identity-presentation-artifact-lifecycle',
        owner: 'C5B authenticated remote session and artifact-transfer journey',
        status: 'fixture-only',
      },
      {
        id: 'packaged-local-cloud-hybrid-release-journey',
        owner: 'C5B/C5C packaged clean-machine release harness',
        status: 'not-reachable',
      },
    ]);
  });
});
