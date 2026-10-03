import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();

const readSource = (relativePath: string): string => readFileSync(resolve(PROJECT_ROOT, relativePath), 'utf8');

describe('C4 denied AI access usability inventory', () => {
  it('keeps the current broker and renderer component evidence explicit', () => {
    const brokerJourney = readSource('tests/integration/package-manager/deniedAiAccessKeepsSurfaceUsable.test.ts');
    const brokerUnit = readSource('tests/unit/foundation/surfaceAiAccessBroker.test.ts');
    const storeRenderer = readSource('tests/unit/package-manager/StoreProductDetail.dom.test.tsx');

    expect(brokerJourney).toContain('C4 denied AI access preserves the user Surface');
    expect(brokerJourney).toContain("code: 'SURFACE_AI_ACCESS_CONSENT_UNAVAILABLE'");
    expect(brokerJourney).toContain('expect(invokeSurface).not.toHaveBeenCalled();');
    expect(brokerJourney).toContain('expect(runtimeRegistry.ownsRuntime(ownerId, packageId, runtimeId)).toBe(true);');
    expect(brokerJourney).toContain("state: 'installed',");
    expect(brokerJourney).toContain('enabled: true,');
    expect(brokerUnit).toContain(
      'denies the Surface operation before invocation when the shared Trust policy rejects its exact package'
    );
    expect(brokerUnit).toContain("code: 'SURFACE_AI_ACCESS_TRUST_DENIED'");
    expect(storeRenderer).toContain(
      'opens a signed enabled Surface while its separately declared AI operation remains unconsented'
    );
    expect(storeRenderer).toContain('keeps the installed Surface open action visible after the user denies AI access');
  });

  it('does not mislabel local component coverage as packaged end-to-end coverage', () => {
    const releaseGate = readSource('tests/regression/wave0/c2SurfaceAiReleaseGate.test.ts');
    const accessBroker = readSource(
      'packages/desktop/src/process/resources/packageCapability/surfaceAiAccessBroker.ts'
    );
    const localJourney = readSource('tests/integration/c4LocalSurfaceAiJourney.test.ts');

    expect(releaseGate).toContain("!app.isPackaged && process.env.TOMNY_ENABLE_DEV_C4_LOCAL_SURFACE_AI_PILOT === '1'");
    expect(accessBroker).toContain(
      "if (deps.enabled?.() !== true) throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_DISABLED');"
    );
    expect(localJourney).toContain("vi.mock('electron'");
    expect(localJourney).toContain('C4 local reviewed Surface journey');
  });
});
