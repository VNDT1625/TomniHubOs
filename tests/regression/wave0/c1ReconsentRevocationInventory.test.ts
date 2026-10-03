import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type C1ConsentRoute = Readonly<{
  id: string;
  sources: readonly string[];
  currentMarkers: readonly string[];
  materialChangeMarkers: readonly string[];
  revocationMarkers: readonly string[];
}>;

const PROJECT_ROOT = process.cwd();

const C1_CONSENT_ROUTES: readonly C1ConsentRoute[] = [
  {
    id: 'surface-ai-access',
    sources: ['packages/desktop/src/process/resources/packageCapability/surfaceAiAccessBroker.ts'],
    currentMarkers: [
      'export type SurfaceAiAccessConsent = Readonly<{',
      'surface: PackageIdentity;',
      'capability: string;',
      'dataClasses: readonly SurfaceAiDataClass[];',
      'destinationIds: readonly string[];',
      'revoke: (consentId: string) => Promise<boolean>;',
    ],
    materialChangeMarkers: [
      '!sameIdentity(consent.surface, surface.identity)',
      'consent.capability !== operation.capability',
      '!sameStrings(consent.dataClasses, operation.dataClasses)',
      '!sameStrings(consent.destinationIds, operation.destinationIds)',
      'consent.policyVersion !== policyVersion',
      'currentPolicyVersion() !== policyVersion',
      'await assertCurrentAuthorization();',
    ],
    revocationMarkers: [
      'const unsubscribeRevocation = deps.consentStore.onRevoked?.((consentId) => {',
      'if (consentId === consent.consentId) operationAbort.abort();',
      'await flush();',
    ],
  },
  {
    id: 'catalog-package-mutation',
    sources: [
      'packages/desktop/src/process/extensions/package-manager/packageHttpApi.ts',
      'packages/desktop/src/process/extensions/package-manager/catalog-federation/types.ts',
      'packages/desktop/src/process/extensions/package-manager/catalog-federation/actionLedger.ts',
    ],
    currentMarkers: [
      'const consent = createCatalogActionConsentAuthority({ now, randomId });',
      'consentId: request.consentId,',
      'consent.revokeOwner(ownerId);',
      'Keeps short-lived, owner-bound consent grants in trusted host memory.',
    ],
    materialChangeMarkers: [
      'grant.consent.action !== request.action',
      'grant.consent.sourceItemId !== request.sourceItemId',
      'grant.consent.region !== request.region',
    ],
    revocationMarkers: ['const revokeOwner = (ownerId: string): void => {', 'grants.delete(consentId);'],
  },
  {
    id: 'microsoft-store-native-action',
    sources: ['packages/desktop/src/process/extensions/package-manager/catalog-federation/windowsStore.ts'],
    currentMarkers: [
      'const loadTrustedRecord = async',
      'const record = await loadTrustedRecord(request);',
      'const decision = await consent.authorize({',
    ],
    materialChangeMarkers: ['assertLinkedAppMayRun(record, request.region);', 'sourceItemId: consentSubject(record),'],
    revocationMarkers: ['revokeOwner: (ownerId) => {', 'consent.revokeOwner(ownerId);'],
  },
] as const;

const readSource = (path: string): string => {
  const absolutePath = resolve(PROJECT_ROOT, path);
  if (!existsSync(absolutePath)) throw new Error('C1 consent inventory source missing: ' + path);
  return readFileSync(absolutePath, 'utf8');
};

const routeContent = (route: C1ConsentRoute): string => route.sources.map(readSource).join('\n');

const consentRecordDeclaration = (source: string, declaration: string): string => {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error('C1 consent declaration missing: ' + declaration);
  const readonlyEnd = source.indexOf('}>;', start);
  const objectEnd = source.indexOf('};', start);
  const end = readonlyEnd === -1 ? objectEnd : objectEnd === -1 ? readonlyEnd : Math.min(readonlyEnd, objectEnd);
  if (end < 0) throw new Error('C1 consent declaration is not closed: ' + declaration);
  return source.slice(start, end + 3);
};

/**
 * This is independent C1 inventory evidence, not a C1-04 completion claim.
 * It makes the distinct Main-owned re-consent and revocation seams explicit so
 * their current local guarantees are not mistaken for one universal policy
 * revision or active-work cancellation contract.
 */
describe('C1 material-policy re-consent and revocation inventory', () => {
  it('names the bounded current consent routes and their concrete decision inputs', () => {
    expect(C1_CONSENT_ROUTES.map((route) => route.id)).toEqual([
      'surface-ai-access',
      'catalog-package-mutation',
      'microsoft-store-native-action',
    ]);

    for (const route of C1_CONSENT_ROUTES) {
      const source = routeContent(route);
      for (const marker of route.currentMarkers) expect(source, route.id + ': ' + marker).toContain(marker);
      for (const marker of route.materialChangeMarkers) expect(source, route.id + ': ' + marker).toContain(marker);
      for (const marker of route.revocationMarkers) expect(source, route.id + ': ' + marker).toContain(marker);
    }
  });

  it('keeps the demonstrated Surface re-consent and active-revocation seam distinct from the other short-lived action grants', () => {
    const surface = readSource(C1_CONSENT_ROUTES[0].sources[0]);
    const catalog = readSource(C1_CONSENT_ROUTES[1].sources[1]);
    const microsoft = readSource(C1_CONSENT_ROUTES[2].sources[0]);

    expect(surface).toContain('await assertCurrentAuthorization();');
    expect(surface).toContain('operationAbort.abort();');

    for (const source of [catalog, microsoft]) {
      expect(source).not.toContain('operationAbort.abort();');
      expect(source).not.toContain('AbortController');
    }
  });

  it('records the bounded Surface policy binding while keeping the remaining catalog gap explicit', () => {
    const surface = readSource(C1_CONSENT_ROUTES[0].sources[0]);
    const catalog = readSource(C1_CONSENT_ROUTES[1].sources[1]);

    expect(consentRecordDeclaration(surface, 'export type SurfaceAiAccessConsent = Readonly<{')).toContain(
      'policyVersion?: string;'
    );
    expect(surface).toContain('consent.policyVersion !== policyVersion');
    expect(catalog).not.toContain('policyVersion:');
  });
});
