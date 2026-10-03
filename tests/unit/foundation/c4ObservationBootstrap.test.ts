import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const bridgeSource = readFileSync(resolve(process.cwd(), 'packages/desktop/src/process/bridge/index.ts'), 'utf8');
const packageBridgeSource = readFileSync(
  resolve(process.cwd(), 'packages/desktop/src/process/extensions/package-manager/packageBridge.ts'),
  'utf8'
);

describe('C4 local Surface AI observation bootstrap', () => {
  it('creates the observation root only in the unpackaged pilot and passes it through the Main-only dispatcher factory', () => {
    const pilotBlock = bridgeSource.indexOf('if (planCache !== undefined)');
    const observationStore = bridgeSource.indexOf(
      'const c4SurfaceAiObservationStore = createSurfaceAiObservationStore'
    );
    const actionBridge = bridgeSource.indexOf('registerHubGoalSurfaceActionBridge({');

    expect(bridgeSource).toContain("!app.isPackaged && process.env.TOMNY_ENABLE_DEV_C4_LOCAL_SURFACE_AI_PILOT === '1'");
    expect(observationStore).toBeGreaterThan(pilotBlock);
    expect(actionBridge).toBeGreaterThan(pilotBlock);
    expect(bridgeSource).toContain('} else {\n      // Keep the preload query deterministic outside the pilot');
    expect(bridgeSource.indexOf('const c4ObservationRecovery =')).toBeGreaterThan(observationStore);
    expect(bridgeSource).toContain('await c4ObservationRecovery;');
    expect(bridgeSource).toContain("path.join(app.getPath('userData'), 'tomny-state', 'c4-surface-ai-observations')");
    expect(bridgeSource).toContain('observationStore: c4SurfaceAiObservationStore');
    expect(packageBridgeSource).toContain(
      "observationStore?: Pick<SurfaceAiObservationStore, 'open' | 'recordProgress' | 'recordResult'>"
    );
    expect(packageBridgeSource).toContain('observationStore: input.observationStore');
  });

  it('completes restart recovery before registering a dispatcher and fails closed on a recovery error', () => {
    const recoveryCoordinator = bridgeSource.indexOf(
      'const c4ObservationRecoveryCoordinator =\n        createSurfaceAiObservationRecoveryCoordinator'
    );
    const recoveryStart = bridgeSource.indexOf(
      'const c4ObservationRecovery = c4ObservationRecoveryCoordinator.recoverAfterRestart()'
    );
    const dispatcherFactory = bridgeSource.indexOf('createDispatcher: async ({ readiness, trust }) => {');
    const recoveryAwait = bridgeSource.indexOf('await c4ObservationRecovery;', dispatcherFactory);
    const recoveryFailureGuard = bridgeSource.indexOf(
      'if (c4ObservationRecoveryError !== undefined) throw c4ObservationRecoveryError;',
      recoveryAwait
    );
    const dispatcherRegistration = bridgeSource.indexOf(
      'return await packageStore.surfaceAi.createDispatcher({',
      recoveryFailureGuard
    );
    const recoveryEvidenceAwait = bridgeSource.indexOf('await c4ObservationRecovery;', dispatcherRegistration);
    const recoveryEvidenceFailureGuard = bridgeSource.indexOf(
      'if (c4ObservationRecoveryError !== undefined) throw c4ObservationRecoveryError;',
      recoveryEvidenceAwait
    );

    expect(recoveryCoordinator).toBeGreaterThan(-1);
    expect(recoveryStart).toBeGreaterThan(recoveryCoordinator);
    expect(dispatcherFactory).toBeGreaterThan(recoveryStart);
    expect(recoveryAwait).toBeGreaterThan(dispatcherFactory);
    expect(recoveryFailureGuard).toBeGreaterThan(recoveryAwait);
    expect(dispatcherRegistration).toBeGreaterThan(recoveryFailureGuard);
    expect(recoveryEvidenceAwait).toBeGreaterThan(dispatcherRegistration);
    expect(recoveryEvidenceFailureGuard).toBeGreaterThan(recoveryEvidenceAwait);
  });
});
