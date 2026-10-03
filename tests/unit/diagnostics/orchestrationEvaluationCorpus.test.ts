import { describe, expect, it } from 'vitest';
import {
  buildOrchestrationEvaluationPlan,
  ORCHESTRATION_EVALUATION_CORPUS,
  ORCHESTRATION_EVALUATION_SCHEMA_VERSION,
  scoreOrchestrationEvaluationCorpus,
  type OrchestrationEvaluationCorpus,
  type OrchestrationEvaluationGoal,
} from '@/process/services/diagnostics/orchestrationEvaluationCorpus';

describe('orchestration evaluation corpus', () => {
  it('scores the frozen local, install-proposal, and hybrid Surface cases deterministically', () => {
    const first = scoreOrchestrationEvaluationCorpus(ORCHESTRATION_EVALUATION_CORPUS);
    const second = scoreOrchestrationEvaluationCorpus(ORCHESTRATION_EVALUATION_CORPUS);

    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe(ORCHESTRATION_EVALUATION_SCHEMA_VERSION);
    expect(first.corpusVersion).toBe('c3-surface-routing-v2');
    expect(first).toMatchObject({ passed: 3, total: 3 });
    expect(first.metrics).toEqual({
      capabilityCoverage: { denominator: 4, passed: 4 },
      wrongRouting: { denominator: 4, floor: 0, observed: 0, passed: true },
    });
    expect(first.results.map((result) => result.plan.mode)).toEqual(['local', 'proposal-only', 'hybrid']);
  });

  it('records a wrong-Surface decision against the frozen zero-error routing floor', () => {
    const [firstCase, ...remainingCases] = ORCHESTRATION_EVALUATION_CORPUS.cases;
    if (firstCase === undefined) throw new Error('Frozen corpus requires a local-first case.');
    const wrongExpectedRoute: OrchestrationEvaluationCorpus = {
      ...ORCHESTRATION_EVALUATION_CORPUS,
      cases: [
        {
          ...firstCase,
          expected: firstCase.expected.map((decision) =>
            decision.stepId === 'edit-code' ? { ...decision, surfaceId: 'remote:ide' } : decision
          ),
        },
        ...remainingCases,
      ],
    };

    expect(scoreOrchestrationEvaluationCorpus(wrongExpectedRoute).metrics.wrongRouting).toEqual({
      denominator: 4,
      floor: 0,
      observed: 1,
      passed: false,
    });
  });

  it('prefers an installed AI-enabled Surface and never proposes install while a governed local route exists', () => {
    const goal: OrchestrationEvaluationGoal = {
      id: 'installed-first',
      maxEstimatedCostMB: 32,
      remoteAllowed: true,
      requiredCapabilities: ['code.edit'],
      steps: [{ id: 'edit', capability: 'code.edit', privacy: 'remote-allowed' }],
      surfaces: [
        {
          aiEnabled: true,
          capabilities: ['code.edit'],
          deviceCompatible: true,
          estimatedCostMB: 3,
          healthy: true,
          id: 'surface.ide',
          privacyClass: 'local-only',
          state: 'ready-local',
        },
        {
          aiEnabled: true,
          capabilities: ['code.edit'],
          deviceCompatible: true,
          estimatedCostMB: 2,
          healthy: true,
          id: 'remote:ide',
          privacyClass: 'remote-allowed',
          state: 'ready-remote',
        },
        {
          aiEnabled: true,
          capabilities: ['code.edit'],
          deviceCompatible: true,
          estimatedCostMB: 2,
          healthy: true,
          id: 'surface.ide-installable',
          privacyClass: 'local-only',
          state: 'installable',
        },
      ],
    };

    expect(buildOrchestrationEvaluationPlan(goal).steps).toEqual([
      { excludedSurfaceIds: [], status: 'execute', stepId: 'edit', surfaceId: 'surface.ide' },
    ]);
  });

  it('blocks an AI-disabled, capability-missing, privacy-incompatible, or over-budget Surface instead of routing around a hard constraint', () => {
    const goal: OrchestrationEvaluationGoal = {
      id: 'hard-constraints',
      maxEstimatedCostMB: 10,
      remoteAllowed: true,
      requiredCapabilities: ['code.edit'],
      steps: [{ id: 'private-edit', capability: 'code.edit', privacy: 'local-only' }],
      surfaces: [
        {
          aiEnabled: false,
          capabilities: ['code.edit'],
          deviceCompatible: true,
          estimatedCostMB: 1,
          healthy: true,
          id: 'surface.disabled-ai',
          privacyClass: 'local-only',
          state: 'ready-local',
        },
        {
          aiEnabled: true,
          capabilities: ['code.edit'],
          deviceCompatible: true,
          estimatedCostMB: 1,
          healthy: true,
          id: 'remote:private-leak',
          privacyClass: 'remote-allowed',
          state: 'ready-remote',
        },
        {
          aiEnabled: true,
          capabilities: ['code.edit'],
          deviceCompatible: true,
          estimatedCostMB: 11,
          healthy: true,
          id: 'surface.over-budget',
          privacyClass: 'local-only',
          state: 'ready-local',
        },
        {
          aiEnabled: true,
          capabilities: ['code.review'],
          deviceCompatible: true,
          estimatedCostMB: 1,
          healthy: true,
          id: 'surface.missing-capability',
          privacyClass: 'local-only',
          state: 'ready-local',
        },
      ],
    };

    expect(buildOrchestrationEvaluationPlan(goal)).toEqual({
      estimatedCostMB: 0,
      goalId: 'hard-constraints',
      mode: 'blocked',
      steps: [
        {
          excludedSurfaceIds: [
            'remote:private-leak',
            'surface.disabled-ai',
            'surface.missing-capability',
            'surface.over-budget',
          ],
          status: 'blocked',
          stepId: 'private-edit',
        },
      ],
    });
  });

  it('proposes an install only when local/remote execution cannot satisfy an offline requirement', () => {
    const goal: OrchestrationEvaluationGoal = {
      id: 'offline-install',
      maxEstimatedCostMB: 20,
      remoteAllowed: true,
      requiredCapabilities: ['code.edit'],
      steps: [{ id: 'offline-edit', capability: 'code.edit', privacy: 'local-only', requireOffline: true }],
      surfaces: [
        {
          aiEnabled: true,
          capabilities: ['code.edit'],
          deviceCompatible: true,
          estimatedCostMB: 3,
          healthy: true,
          id: 'remote:ide',
          privacyClass: 'remote-allowed',
          state: 'ready-remote',
        },
        {
          aiEnabled: true,
          capabilities: ['code.edit'],
          deviceCompatible: true,
          estimatedCostMB: 4,
          healthy: true,
          id: 'surface.ide',
          privacyClass: 'local-only',
          state: 'installable',
        },
      ],
    };

    expect(buildOrchestrationEvaluationPlan(goal).steps).toEqual([
      {
        excludedSurfaceIds: ['remote:ide'],
        status: 'propose-install',
        stepId: 'offline-edit',
        surfaceId: 'surface.ide',
      },
    ]);
  });

  it('rejects an undeclared step capability before Surface resolution', () => {
    const goal: OrchestrationEvaluationGoal = {
      id: 'undeclared-capability',
      maxEstimatedCostMB: 10,
      remoteAllowed: true,
      requiredCapabilities: ['web.research'],
      steps: [{ id: 'edit', capability: 'code.edit', privacy: 'remote-allowed' }],
      surfaces: [
        {
          aiEnabled: true,
          capabilities: ['code.edit'],
          deviceCompatible: true,
          estimatedCostMB: 1,
          healthy: true,
          id: 'surface.ide',
          privacyClass: 'local-only',
          state: 'ready-local',
        },
      ],
    };

    expect(() => buildOrchestrationEvaluationPlan(goal)).toThrow('declared id and capability');
  });

  it('never proposes a device-incompatible local Surface or silently falls back to remote for an offline task', () => {
    const goal: OrchestrationEvaluationGoal = {
      id: 'offline-device-denial',
      maxEstimatedCostMB: 20,
      remoteAllowed: true,
      requiredCapabilities: ['code.edit'],
      steps: [{ id: 'offline-edit', capability: 'code.edit', privacy: 'local-only', requireOffline: true }],
      surfaces: [
        {
          aiEnabled: true,
          capabilities: ['code.edit'],
          deviceCompatible: false,
          estimatedCostMB: 4,
          healthy: true,
          id: 'surface.incompatible-ide',
          privacyClass: 'local-only',
          state: 'installable',
        },
        {
          aiEnabled: true,
          capabilities: ['code.edit'],
          deviceCompatible: true,
          estimatedCostMB: 2,
          healthy: true,
          id: 'remote:ide',
          privacyClass: 'remote-allowed',
          state: 'ready-remote',
        },
      ],
    };

    expect(buildOrchestrationEvaluationPlan(goal).steps).toEqual([
      {
        excludedSurfaceIds: ['remote:ide', 'surface.incompatible-ide'],
        status: 'blocked',
        stepId: 'offline-edit',
      },
    ]);
  });
});
