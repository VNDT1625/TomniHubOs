import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type SourceAssertion = Readonly<{
  path: string;
  requiredMarkers: readonly string[];
}>;

type UnprovenJourneyBoundary = Readonly<{
  action: 'Store search' | 'installation' | 'purchase' | 'AI access';
  requiredProductionOwner: string;
  status: 'unproven';
}>;

const PROJECT_ROOT = process.cwd();

const readSource = (path: string): string => {
  const absolutePath = resolve(PROJECT_ROOT, path);
  if (!existsSync(absolutePath)) throw new Error('C3 Store-action inventory source missing: ' + path);
  return readFileSync(absolutePath, 'utf8');
};

/**
 * This is deliberately limited component evidence. The planner can search signed
 * Store facts and return a non-mutating proposal, but it is not a joined,
 * account-gated production journey from discovery through purchase and AI access.
 */
const CURRENT_COMPONENT_BOUNDARIES: readonly SourceAssertion[] = [
  {
    path: 'packages/desktop/src/process/resources/packageCapability/surfacePlanningService.ts',
    requiredMarkers: [
      'Deterministic Store/Surface planner. It is intentionally incapable of',
      'installation, purchase, consent, or execution',
      "kind: 'propose-install'",
      "const installable = resolution.candidates.find((candidate) => candidate.state === 'installable');",
    ],
  },
  {
    path: 'packages/desktop/src/process/resources/packageCapability/goalSurfacePlanningCoordinator.ts',
    requiredMarkers: [
      'Installation, purchase, consent and Surface execution remain separate',
      'const steps = await options.surfacePlanner.plan({ queries: requirements, requestedAt });',
    ],
  },
  {
    path: 'packages/desktop/src/process/resources/packageCapability/goalCapability/surfaceAiActionExecution.ts',
    requiredMarkers: [
      "if (step.kind !== 'execute-local')",
      'This boundary never installs, purchases, selects a package,',
    ],
  },
  {
    path: 'tests/unit/package-manager/surfacePlanningService.test.ts',
    requiredMarkers: [
      "it('returns a reviewable install proposal rather than installing or purchasing a matching Store Surface'",
      "proposal: { proposalId: 'proposal-install-1', requiresInstall: true, requiresPurchase: true }",
    ],
  },
] as const;

/**
 * Each operation has a separate contract seam, but no single production journey
 * proves that a planner proposal crosses these authorities in the required order.
 * Keep this gap explicit until an account-gated journey has durable receipts.
 */
const UNPROVEN_PRODUCTION_JOURNEY_BOUNDARIES: readonly UnprovenJourneyBoundary[] = [
  {
    action: 'Store search',
    requiredProductionOwner: 'account-gated signed Store search and selected-result receipt',
    status: 'unproven',
  },
  {
    action: 'installation',
    requiredProductionOwner: 'proposal-bound install confirmation and Package Supervisor receipt',
    status: 'unproven',
  },
  {
    action: 'purchase',
    requiredProductionOwner: 'proposal-bound checkout, entitlement, and activation receipt',
    status: 'unproven',
  },
  {
    action: 'AI access',
    requiredProductionOwner: 'separate exact AI-access consent and governed action receipt',
    status: 'unproven',
  },
] as const;

describe('C3 Store search, installation, purchase, and AI-access action inventory', () => {
  it('pins the non-mutating planner and separate AI-access component boundaries', () => {
    for (const assertion of CURRENT_COMPONENT_BOUNDARIES) {
      const source = readSource(assertion.path);
      for (const marker of assertion.requiredMarkers) expect(source, assertion.path + ': ' + marker).toContain(marker);
    }
  });

  it('keeps the four actions explicitly unproven as one production journey', () => {
    expect(UNPROVEN_PRODUCTION_JOURNEY_BOUNDARIES.map((boundary) => boundary.action)).toEqual([
      'Store search',
      'installation',
      'purchase',
      'AI access',
    ]);
    expect(UNPROVEN_PRODUCTION_JOURNEY_BOUNDARIES.every((boundary) => boundary.status === 'unproven')).toBe(true);
  });
});
