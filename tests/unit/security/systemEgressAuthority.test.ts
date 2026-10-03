import { describe, expect, it } from 'vitest';

import { createSystemEgressAuthority } from '@process/services/security/systemEgressAuthority';

describe('SystemEgressAuthority', () => {
  it('denies pre-login diagnostics by default while admitting only the pinned signed update feed', () => {
    const authority = createSystemEgressAuthority();

    expect(
      authority.authorize({
        egressClass: 'opt-in-diagnostics',
        destination: 'https://public-key@o0.ingest.sentry.io/1',
        diagnosticsConsent: false,
      })
    ).toEqual({ decision: 'deny', code: 'SYSTEM_EGRESS_DIAGNOSTICS_CONSENT_REQUIRED' });
    expect(
      authority.authorize({
        egressClass: 'signed-app-update',
        destination: 'https://github.com/VNDT1625/OmniAgent/releases/download/latest/',
      })
    ).toEqual({
      decision: 'allow',
      code: 'SYSTEM_EGRESS_ALLOWED',
      destination: 'https://github.com/VNDT1625/OmniAgent/releases/download/latest/',
    });
  });

  it('keeps OIDC on the configured issuer origin and rejects non-release update destinations', () => {
    const authority = createSystemEgressAuthority();

    expect(
      authority.authorize({
        egressClass: 'oidc-auth',
        destination: 'https://cdn.accounts.tomni.example/jwks',
        oidcIssuer: 'https://accounts.tomni.example/',
      }).code
    ).toBe('SYSTEM_EGRESS_OIDC_ORIGIN_DENIED');
    expect(
      authority.authorize({
        egressClass: 'signed-app-update',
        destination: 'https://github.com/VNDT1625/OmniAgent/archive/main.zip',
      }).code
    ).toBe('SYSTEM_EGRESS_UPDATE_DESTINATION_DENIED');
  });

  it('allows only canonical public Store catalog endpoints and pins packaged refreshes to the signed release', () => {
    const authority = createSystemEgressAuthority();
    const pinnedCatalog = 'https://github.com/VNDT1625/OmniAgent/releases/download/tomni-store-v1/catalog.json';

    expect(
      authority.authorize({
        egressClass: 'signed-store-catalog',
        destination: pinnedCatalog,
        storeCatalogUrl: pinnedCatalog,
        isPackaged: true,
      })
    ).toMatchObject({ decision: 'allow', code: 'SYSTEM_EGRESS_ALLOWED' });
    expect(
      authority.authorize({
        egressClass: 'signed-store-catalog',
        destination: 'https://store.example/catalog.json',
        storeCatalogUrl: 'https://store.example/catalog.json',
        isPackaged: true,
      })
    ).toEqual({ decision: 'deny', code: 'SYSTEM_EGRESS_STORE_CATALOG_DESTINATION_DENIED' });
    expect(
      authority.authorize({
        egressClass: 'signed-store-catalog',
        destination: 'https://localhost/catalog.json',
        storeCatalogUrl: 'https://localhost/catalog.json',
      })
    ).toEqual({ decision: 'deny', code: 'SYSTEM_EGRESS_STORE_CATALOG_DESTINATION_DENIED' });
    expect(
      authority.authorize({
        egressClass: 'signed-store-catalog',
        destination: pinnedCatalog,
        storeCatalogUrl: 'https://github.com/VNDT1625/OmniAgent/releases/download/other/catalog.json',
        isPackaged: true,
      })
    ).toEqual({ decision: 'deny', code: 'SYSTEM_EGRESS_STORE_CATALOG_DESTINATION_DENIED' });
  });

  it('admits only the exact public artifact retained from a verified Store catalog', () => {
    const authority = createSystemEgressAuthority();
    const artifact = 'https://artifacts.example/releases/com.example.notes-1.0.0.tomni';

    expect(
      authority.authorize({
        egressClass: 'signed-store-artifact',
        destination: artifact,
        verifiedStoreArtifactUrl: artifact,
      })
    ).toMatchObject({ decision: 'allow', code: 'SYSTEM_EGRESS_ALLOWED' });
    expect(
      authority.authorize({
        egressClass: 'signed-store-artifact',
        destination: 'https://attacker.example/replaced.tomni',
        verifiedStoreArtifactUrl: artifact,
      })
    ).toEqual({ decision: 'deny', code: 'SYSTEM_EGRESS_STORE_ARTIFACT_DESTINATION_DENIED' });
    expect(
      authority.authorize({
        egressClass: 'signed-store-artifact',
        destination: 'https://127.0.0.1/private.tomni',
        verifiedStoreArtifactUrl: 'https://127.0.0.1/private.tomni',
      })
    ).toEqual({ decision: 'deny', code: 'SYSTEM_EGRESS_STORE_ARTIFACT_DESTINATION_DENIED' });
  });

  it('admits publisher authority only on its deployment-configured HTTPS origin', () => {
    const authority = createSystemEgressAuthority();

    expect(
      authority.authorize({
        egressClass: 'publisher-authority',
        destination: 'https://publisher.tomni.example/v1/authority',
        publisherAuthorityOrigin: 'https://publisher.tomni.example/desktop/publisher-authority',
      })
    ).toMatchObject({ decision: 'allow', code: 'SYSTEM_EGRESS_ALLOWED' });
    expect(
      authority.authorize({
        egressClass: 'publisher-authority',
        destination: 'https://untrusted.example/v1/authority',
        publisherAuthorityOrigin: 'https://publisher.tomni.example/desktop/publisher-authority',
      })
    ).toEqual({ decision: 'deny', code: 'SYSTEM_EGRESS_PUBLISHER_AUTHORITY_DESTINATION_DENIED' });
  });

  it('admits the explicitly bounded local Office probe while rejecting non-loopback destinations', () => {
    const authority = createSystemEgressAuthority();

    expect(
      authority.authorize({
        egressClass: 'local-office-probe',
        destination: 'http://127.0.0.1:19000/health',
      })
    ).toMatchObject({ decision: 'allow', code: 'SYSTEM_EGRESS_ALLOWED' });
    expect(
      authority.authorize({
        egressClass: 'local-office-probe',
        destination: 'https://localhost:9443/',
      })
    ).toMatchObject({ decision: 'allow', code: 'SYSTEM_EGRESS_ALLOWED' });
    expect(
      authority.authorize({
        egressClass: 'local-office-probe',
        destination: 'http://office.example.test:19000/',
      })
    ).toEqual({ decision: 'deny', code: 'SYSTEM_EGRESS_LOCAL_OFFICE_PROBE_DESTINATION_DENIED' });
    expect(
      authority.authorize({
        egressClass: 'local-office-probe',
        destination: 'http://user:password@127.0.0.1:19000/',
      })
    ).toEqual({ decision: 'deny', code: 'SYSTEM_EGRESS_LOCAL_OFFICE_PROBE_DESTINATION_DENIED' });
  });

  it('fails closed when an invalid egress class reaches the runtime boundary', () => {
    const authority = createSystemEgressAuthority();

    expect(
      authority.authorize({
        egressClass: 'unknown-system-route',
        destination: 'https://example.test/',
      } as never)
    ).toEqual({ decision: 'deny', code: 'SYSTEM_EGRESS_DESTINATION_INVALID' });
  });
});
