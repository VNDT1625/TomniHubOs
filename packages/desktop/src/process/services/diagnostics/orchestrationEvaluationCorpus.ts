/**
 * Frozen C3 routing corpus. A Surface is a package app; every Surface has a
 * human UI and only an AI-enabled Surface can be selected by this evaluator.
 * This module is evaluation-only: it neither learns from live users nor makes
 * runtime routing, installation, or permission decisions.
 */
export const ORCHESTRATION_EVALUATION_SCHEMA_VERSION = 2 as const;

export type SurfaceExecutionState = 'ready-local' | 'ready-remote' | 'installable';
export type SurfacePrivacyClass = 'local-only' | 'remote-allowed';
export type EvaluationStepStatus = 'execute' | 'propose-install' | 'blocked';
export type EvaluationPlanMode = 'local' | 'remote' | 'hybrid' | 'proposal-only' | 'blocked';

export type OrchestrationEvaluationSurface = Readonly<{
  aiEnabled: boolean;
  capabilities: readonly string[];
  /** Local and installable Surfaces must be compatible with the current device. */
  deviceCompatible: boolean;
  estimatedCostMB: number;
  healthy: boolean;
  id: string;
  privacyClass: SurfacePrivacyClass;
  state: SurfaceExecutionState;
}>;

export type OrchestrationEvaluationStep = Readonly<{
  capability: string;
  id: string;
  privacy: SurfacePrivacyClass;
  requireInstalledSurface?: boolean;
  requireOffline?: boolean;
}>;

export type OrchestrationEvaluationGoal = Readonly<{
  id: string;
  maxEstimatedCostMB: number;
  remoteAllowed: boolean;
  /**
   * Frozen capability decomposition for the goal. Steps may not introduce an
   * undeclared capability, so evaluation never picks a Surface before the
   * task has been decomposed.
   */
  requiredCapabilities: readonly string[];
  steps: readonly OrchestrationEvaluationStep[];
  surfaces: readonly OrchestrationEvaluationSurface[];
}>;

export type ExpectedOrchestrationDecision = Readonly<{
  status: EvaluationStepStatus;
  stepId: string;
  surfaceId?: string;
}>;

export type OrchestrationEvaluationCase = Readonly<{
  expected: readonly ExpectedOrchestrationDecision[];
  goal: OrchestrationEvaluationGoal;
  id: string;
  title: string;
}>;

export type OrchestrationEvaluationCorpus = Readonly<{
  cases: readonly OrchestrationEvaluationCase[];
  corpusVersion: string;
  schemaVersion: typeof ORCHESTRATION_EVALUATION_SCHEMA_VERSION;
  /** Maximum wrong decisions permitted by the frozen evaluation corpus. */
  wrongRoutingFloor: number;
}>;

export type OrchestrationPlanStep = Readonly<{
  excludedSurfaceIds: readonly string[];
  status: EvaluationStepStatus;
  stepId: string;
  surfaceId?: string;
}>;

export type OrchestrationPlan = Readonly<{
  estimatedCostMB: number;
  goalId: string;
  mode: EvaluationPlanMode;
  steps: readonly OrchestrationPlanStep[];
}>;

export type OrchestrationEvaluationResult = Readonly<{
  caseId: string;
  expected: readonly ExpectedOrchestrationDecision[];
  passed: boolean;
  plan: OrchestrationPlan;
}>;

export type OrchestrationEvaluationScore = Readonly<{
  corpusVersion: string;
  metrics: Readonly<{
    capabilityCoverage: Readonly<{
      denominator: number;
      passed: number;
    }>;
    wrongRouting: Readonly<{
      denominator: number;
      floor: number;
      observed: number;
      passed: boolean;
    }>;
  }>;
  passed: number;
  results: readonly OrchestrationEvaluationResult[];
  schemaVersion: typeof ORCHESTRATION_EVALUATION_SCHEMA_VERSION;
  total: number;
}>;

const stateRank: Readonly<Record<SurfaceExecutionState, number>> = {
  'ready-local': 0,
  'ready-remote': 1,
  installable: 2,
};

const isNonNegativeInteger = (value: number): boolean => Number.isInteger(value) && value >= 0;

const isStepSatisfiedBySurface = (
  step: OrchestrationEvaluationStep,
  surface: OrchestrationEvaluationSurface,
  remoteAllowed: boolean,
  remainingBudgetMB: number
): boolean => {
  if (!surface.aiEnabled || !surface.healthy || !surface.capabilities.includes(step.capability)) return false;
  if (surface.state !== 'ready-remote' && !surface.deviceCompatible) return false;
  if (!isNonNegativeInteger(surface.estimatedCostMB) || surface.estimatedCostMB > remainingBudgetMB) return false;
  if (step.privacy === 'local-only' && surface.privacyClass !== 'local-only') return false;
  if (
    (step.requireOffline || step.requireInstalledSurface || step.privacy === 'local-only') &&
    surface.state !== 'ready-local' &&
    surface.state !== 'installable'
  ) {
    return false;
  }
  return remoteAllowed || surface.state !== 'ready-remote';
};

const sortSurfaces = (surfaces: readonly OrchestrationEvaluationSurface[]): readonly OrchestrationEvaluationSurface[] =>
  [...surfaces].toSorted((left, right) => {
    const rank = stateRank[left.state] - stateRank[right.state];
    return rank !== 0 ? rank : left.id.localeCompare(right.id);
  });

const planModeFor = (
  steps: readonly OrchestrationPlanStep[],
  surfaces: readonly OrchestrationEvaluationSurface[]
): EvaluationPlanMode => {
  if (steps.some((step) => step.status === 'blocked')) return 'blocked';
  const statesBySurfaceId = new Map(surfaces.map((surface) => [surface.id, surface.state]));
  const executionLocations = new Set(
    steps
      .filter(
        (step): step is OrchestrationPlanStep & { status: 'execute'; surfaceId: string } => step.status === 'execute'
      )
      .map((step) => (statesBySurfaceId.get(step.surfaceId) === 'ready-remote' ? 'remote' : 'local'))
  );
  if (executionLocations.size === 2) return 'hybrid';
  if (executionLocations.has('local')) return 'local';
  if (executionLocations.has('remote')) return 'remote';
  return 'proposal-only';
};

/**
 * Produces a deterministic candidate plan without calling a Surface. The
 * state carried by each corpus Surface is the sole local/cloud signal, keeping
 * this training/evaluation artifact independent from runtime contracts.
 */
export const buildOrchestrationEvaluationPlan = (goal: OrchestrationEvaluationGoal): OrchestrationPlan => {
  assertGoal(goal);
  let remainingBudgetMB = goal.maxEstimatedCostMB;
  const steps = goal.steps.map((step) => {
    const eligible = sortSurfaces(
      goal.surfaces.filter((surface) => isStepSatisfiedBySurface(step, surface, goal.remoteAllowed, remainingBudgetMB))
    );
    const chosen = eligible.find((surface) => surface.state !== 'installable');
    const excludedSurfaceIds = goal.surfaces
      .filter((surface) => !eligible.some((candidate) => candidate.id === surface.id))
      .map((surface) => surface.id)
      .toSorted();

    if (chosen !== undefined) {
      remainingBudgetMB -= chosen.estimatedCostMB;
      return { excludedSurfaceIds, status: 'execute' as const, stepId: step.id, surfaceId: chosen.id };
    }

    const installable = eligible.find((surface) => surface.state === 'installable');
    if (installable !== undefined) {
      return { excludedSurfaceIds, status: 'propose-install' as const, stepId: step.id, surfaceId: installable.id };
    }

    return { excludedSurfaceIds, status: 'blocked' as const, stepId: step.id };
  });

  return {
    estimatedCostMB: goal.maxEstimatedCostMB - remainingBudgetMB,
    goalId: goal.id,
    mode: planModeFor(steps, goal.surfaces),
    steps,
  };
};

/** Scores frozen synthetic cases; the score is an auditable training signal, never live preference learning. */
export const scoreOrchestrationEvaluationCorpus = (
  corpus: OrchestrationEvaluationCorpus
): OrchestrationEvaluationScore => {
  assertCorpus(corpus);
  const results = corpus.cases.map((evaluationCase) => {
    const plan = buildOrchestrationEvaluationPlan(evaluationCase.goal);
    const actual = plan.steps.map(({ status, stepId, surfaceId }) => ({
      status,
      stepId,
      ...(surfaceId ? { surfaceId } : {}),
    }));
    const passed = decisionsMatch(actual, evaluationCase.expected);
    return { caseId: evaluationCase.id, expected: evaluationCase.expected, passed, plan };
  });
  const expectedDecisions = corpus.cases.flatMap((evaluationCase) => evaluationCase.expected);
  const actualDecisions = results.flatMap((result) =>
    result.plan.steps.map(({ status, stepId, surfaceId }) => ({
      status,
      stepId,
      ...(surfaceId ? { surfaceId } : {}),
    }))
  );
  const wrongRouting = actualDecisions.filter(
    (decision, index) => !decisionsMatch([decision], [expectedDecisions[index] as ExpectedOrchestrationDecision])
  ).length;
  const capabilityCoverageDenominator = corpus.cases.reduce(
    (total, evaluationCase) => total + evaluationCase.goal.requiredCapabilities.length,
    0
  );

  return {
    corpusVersion: corpus.corpusVersion,
    metrics: {
      capabilityCoverage: {
        denominator: capabilityCoverageDenominator,
        passed: capabilityCoverageDenominator,
      },
      wrongRouting: {
        denominator: expectedDecisions.length,
        floor: corpus.wrongRoutingFloor,
        observed: wrongRouting,
        passed: wrongRouting <= corpus.wrongRoutingFloor,
      },
    },
    passed: results.filter((result) => result.passed).length,
    results,
    schemaVersion: ORCHESTRATION_EVALUATION_SCHEMA_VERSION,
    total: results.length,
  };
};

const decisionsMatch = (
  actual: readonly ExpectedOrchestrationDecision[],
  expected: readonly ExpectedOrchestrationDecision[]
): boolean =>
  actual.length === expected.length &&
  actual.every(
    (decision, index) =>
      decision.stepId === expected[index]?.stepId &&
      decision.status === expected[index]?.status &&
      decision.surfaceId === expected[index]?.surfaceId
  );

const assertGoal = (goal: OrchestrationEvaluationGoal): void => {
  if (
    !goal.id ||
    !isNonNegativeInteger(goal.maxEstimatedCostMB) ||
    goal.steps.length === 0 ||
    goal.requiredCapabilities.length === 0
  ) {
    throw new Error('Invalid orchestration evaluation goal.');
  }
  assertUnique(
    goal.steps.map((step) => step.id),
    'step ids'
  );
  assertUnique(
    goal.surfaces.map((surface) => surface.id),
    'surface ids'
  );
  assertUnique(goal.requiredCapabilities, 'required capabilities');
  for (const step of goal.steps) {
    if (!step.id || !step.capability || !goal.requiredCapabilities.includes(step.capability)) {
      throw new Error('Evaluation steps require a declared id and capability.');
    }
  }
  const stepCapabilities = new Set(goal.steps.map((step) => step.capability));
  if (goal.requiredCapabilities.some((capability) => !stepCapabilities.has(capability))) {
    throw new Error('Evaluation goals require a step for every declared capability.');
  }
};

const assertCorpus = (corpus: OrchestrationEvaluationCorpus): void => {
  if (
    corpus.schemaVersion !== ORCHESTRATION_EVALUATION_SCHEMA_VERSION ||
    !corpus.corpusVersion ||
    corpus.cases.length === 0 ||
    !isNonNegativeInteger(corpus.wrongRoutingFloor)
  ) {
    throw new Error('Invalid orchestration evaluation corpus version.');
  }
  assertUnique(
    corpus.cases.map((evaluationCase) => evaluationCase.id),
    'case ids'
  );
  for (const evaluationCase of corpus.cases) {
    assertGoal(evaluationCase.goal);
    if (evaluationCase.expected.length !== evaluationCase.goal.steps.length) {
      throw new Error(`Evaluation case ${evaluationCase.id} must expect every step.`);
    }
  }
};

const assertUnique = (values: readonly string[], label: string): void => {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} are not allowed.`);
};

export const ORCHESTRATION_EVALUATION_CORPUS: OrchestrationEvaluationCorpus = {
  schemaVersion: ORCHESTRATION_EVALUATION_SCHEMA_VERSION,
  corpusVersion: 'c3-surface-routing-v2',
  wrongRoutingFloor: 0,
  cases: [
    {
      id: 'local-ai-surface-wins',
      title: 'Installed AI-enabled Surface wins over ready remote Surface',
      goal: {
        id: 'goal-local-first',
        maxEstimatedCostMB: 64,
        remoteAllowed: true,
        requiredCapabilities: ['code.edit'],
        steps: [{ id: 'edit-code', capability: 'code.edit', privacy: 'remote-allowed' }],
        surfaces: [
          {
            id: 'remote:ide',
            state: 'ready-remote',
            aiEnabled: true,
            healthy: true,
            capabilities: ['code.edit'],
            deviceCompatible: true,
            privacyClass: 'remote-allowed',
            estimatedCostMB: 18,
          },
          {
            id: 'surface.ide',
            state: 'ready-local',
            aiEnabled: true,
            healthy: true,
            capabilities: ['code.edit'],
            deviceCompatible: true,
            privacyClass: 'local-only',
            estimatedCostMB: 12,
          },
        ],
      },
      expected: [{ stepId: 'edit-code', status: 'execute', surfaceId: 'surface.ide' }],
    },
    {
      id: 'installed-ui-requires-proposal',
      title: 'A local interactive Surface requirement proposes installation before a remote fallback',
      goal: {
        id: 'goal-installed-video',
        maxEstimatedCostMB: 64,
        remoteAllowed: true,
        requiredCapabilities: ['video.edit'],
        steps: [
          { id: 'edit-video', capability: 'video.edit', privacy: 'remote-allowed', requireInstalledSurface: true },
        ],
        surfaces: [
          {
            id: 'remote:video',
            state: 'ready-remote',
            aiEnabled: true,
            healthy: true,
            capabilities: ['video.edit'],
            deviceCompatible: true,
            privacyClass: 'remote-allowed',
            estimatedCostMB: 10,
          },
          {
            id: 'surface.video',
            state: 'installable',
            aiEnabled: true,
            healthy: true,
            capabilities: ['video.edit'],
            deviceCompatible: true,
            privacyClass: 'local-only',
            estimatedCostMB: 16,
          },
        ],
      },
      expected: [{ stepId: 'edit-video', status: 'propose-install', surfaceId: 'surface.video' }],
    },
    {
      id: 'governed-hybrid-plan',
      title: 'A hybrid plan uses local IDE and bounded remote research',
      goal: {
        id: 'goal-hybrid-product',
        maxEstimatedCostMB: 48,
        remoteAllowed: true,
        requiredCapabilities: ['code.edit', 'web.research'],
        steps: [
          { id: 'implement', capability: 'code.edit', privacy: 'local-only' },
          { id: 'research', capability: 'web.research', privacy: 'remote-allowed' },
        ],
        surfaces: [
          {
            id: 'remote:research-expensive',
            state: 'ready-remote',
            aiEnabled: true,
            healthy: true,
            capabilities: ['web.research'],
            deviceCompatible: true,
            privacyClass: 'remote-allowed',
            estimatedCostMB: 40,
          },
          {
            id: 'remote:research',
            state: 'ready-remote',
            aiEnabled: true,
            healthy: true,
            capabilities: ['web.research'],
            deviceCompatible: true,
            privacyClass: 'remote-allowed',
            estimatedCostMB: 16,
          },
          {
            id: 'surface.ide',
            state: 'ready-local',
            aiEnabled: true,
            healthy: true,
            capabilities: ['code.edit'],
            deviceCompatible: true,
            privacyClass: 'local-only',
            estimatedCostMB: 20,
          },
          {
            id: 'surface.notes',
            state: 'ready-local',
            aiEnabled: false,
            healthy: true,
            capabilities: ['code.edit'],
            deviceCompatible: true,
            privacyClass: 'local-only',
            estimatedCostMB: 1,
          },
        ],
      },
      expected: [
        { stepId: 'implement', status: 'execute', surfaceId: 'surface.ide' },
        { stepId: 'research', status: 'execute', surfaceId: 'remote:research' },
      ],
    },
  ],
};
