import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type PackageManifest = Readonly<{
  scripts?: Readonly<Record<string, string>>;
}>;

const PROJECT_ROOT = process.cwd();

const readProjectFile = (relativePath: string): string => readFileSync(resolve(PROJECT_ROOT, relativePath), 'utf8');

const packageScripts = (): Readonly<Record<string, string>> => {
  const manifest = JSON.parse(readProjectFile('package.json')) as PackageManifest;
  return manifest.scripts ?? {};
};

/**
 * Independent C4-05 inventory evidence. It deliberately distinguishes the
 * demonstrated local broker races from the still-disabled packaged pilot.
 */
describe('C4 revocation and active-lease cancellation inventory', () => {
  it('keeps local integration and receipt-recovery race coverage explicit', () => {
    const revocationJourney = readProjectFile('tests/integration/package-manager/revocationCancelsSurfaceAi.test.ts');
    const brokerUnit = readProjectFile('tests/unit/foundation/surfaceAiAccessBroker.test.ts');

    expect(revocationJourney).toContain(
      'cancels a live Package Manager-backed Surface invocation, releases its leases, and denies a subsequent invocation'
    );
    expect(revocationJourney).toContain(
      'await expect(consentAuthority.revoke(confirmation.consent.consentId)).resolves.toBe(true);'
    );
    expect(revocationJourney).toContain("childReceipt: { status: 'cancelled' }");
    expect(revocationJourney).toContain("parentReceipt: { status: 'cancelled' }");
    expect(revocationJourney).toContain('expect(kernel.resourceAdapter.getActiveLeases()).toEqual([]);');
    expect(revocationJourney).toContain("eventType: 'lease.released'");
    expect(revocationJourney).toContain("code: 'SURFACE_AI_ACCESS_CONSENT_EXPIRED'");

    expect(brokerUnit).toContain(
      'does not invoke a queued child when durable consent is revoked after its lease is granted'
    );
    expect(brokerUnit).toContain(
      'does not invoke a Surface when consent is revoked while durable receipt recovery is pending'
    );
    expect(brokerUnit).toContain(
      'rechecks a durable consent revoked during asynchronous Trust preflight before invoking the Surface'
    );
  });

  it('does not mislabel those local tests as a production signed-pilot proof', () => {
    const releaseGate = readProjectFile('tests/regression/wave0/c2SurfaceAiReleaseGate.test.ts');
    const bootstrap = readProjectFile('packages/desktop/src/process/bridge/index.ts');
    const scripts = packageScripts();

    expect(releaseGate).toContain(
      'keeps every production invocation factory behind the one unpackaged Main-owned C4 pilot switch'
    );
    expect(releaseGate).toContain("!app.isPackaged && process.env.TOMNY_ENABLE_DEV_C4_LOCAL_SURFACE_AI_PILOT === '1'");
    expect(bootstrap).toContain("!app.isPackaged && process.env.TOMNY_ENABLE_DEV_C4_LOCAL_SURFACE_AI_PILOT === '1'");
    expect(scripts).not.toHaveProperty('test:e2e:packaged-c4');
  });
});
