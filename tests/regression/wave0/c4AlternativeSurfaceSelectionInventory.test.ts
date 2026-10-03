import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();

const readSource = (relativePath: string): string => readFileSync(resolve(PROJECT_ROOT, relativePath), 'utf8');

describe('C4 alternative Surface selection inventory', () => {
  it('keeps planner-component evidence separate from the disabled packaged selection-to-execution journey', () => {
    const plannerSource = readSource(
      'packages/desktop/src/process/resources/packageCapability/surfacePlanningService.ts'
    );
    const bootstrapSource = readSource('packages/desktop/src/process/bridge/index.ts');

    expect(plannerSource).toContain('Deterministic Store/Surface planner. It is intentionally incapable of');
    expect(plannerSource).toContain('installation, purchase, consent, or execution');
    expect(plannerSource).toContain("if (selected?.state === 'ready-local')");
    expect(plannerSource).toContain("return { kind: 'execute-local', query, resolution, candidate: selected };");

    const plannerBootstrap = bootstrapSource.indexOf('const goalSurfacePlanner = createGoalSurfacePlanningRuntime({');
    const planningBridge = bootstrapSource.indexOf('registerHubGoalSurfacePlanningBridge({', plannerBootstrap);
    const pilotSwitch = bootstrapSource.indexOf(
      "!app.isPackaged && process.env.TOMNY_ENABLE_DEV_C4_LOCAL_SURFACE_AI_PILOT === '1'"
    );
    const planCache = bootstrapSource.indexOf(
      'const planCache = c4LocalSurfaceAiPilotEnabled ? createHubGoalSurfacePlanCache() : undefined;'
    );
    const pilotActionBranch = bootstrapSource.indexOf('if (planCache !== undefined)');
    const actionBridge = bootstrapSource.indexOf('registerHubGoalSurfaceActionBridge({', pilotActionBranch);

    expect(plannerBootstrap).toBeGreaterThan(-1);
    expect(planningBridge).toBeGreaterThan(plannerBootstrap);
    expect(pilotSwitch).toBeGreaterThan(-1);
    expect(planCache).toBeGreaterThan(plannerBootstrap);
    expect(pilotActionBranch).toBeGreaterThan(planCache);
    expect(actionBridge).toBeGreaterThan(pilotActionBranch);
    expect(bootstrapSource.slice(pilotActionBranch, actionBridge)).toContain(
      'const controller = createSurfaceAiActionController({'
    );
    expect(bootstrapSource.slice(pilotSwitch - 64, pilotSwitch + 160)).toContain('!app.isPackaged');
  });
});
