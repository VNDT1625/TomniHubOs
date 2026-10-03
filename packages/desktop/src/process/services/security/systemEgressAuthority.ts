/**
 * Main-only authority for narrowly defined system egress classes. It is
 * intentionally a closed allowlist; caller-supplied destinations never expand
 * a class policy, whether the route runs before or after Account authentication.
 */
export type SystemEgressClass =
  | 'oidc-auth'
  | 'signed-app-update'
  | 'signed-store-catalog'
  | 'signed-store-artifact'
  | 'opt-in-diagnostics'
  | 'publisher-authority'
  | 'local-office-probe';

export type SystemEgressRequest = Readonly<{
  egressClass: SystemEgressClass;
  destination: string | undefined;
  /** Required for OIDC endpoints; the deployment-owned issuer is Main configuration. */
  oidcIssuer?: string;
  /** Main-owned persisted diagnostics consent, never a renderer value. */
  diagnosticsConsent?: boolean;
  /** Deployment-owned publisher-authority origin; never derived from renderer input. */
  publisherAuthorityOrigin?: string;
  /** Main-owned Store catalog endpoint; never derived from renderer input. */
  storeCatalogUrl?: string;
  /** Packaged desktop admits only the pinned Store release endpoint. */
  isPackaged?: boolean;
  /** Immutable exact artifact URL retained only after remote catalog signature verification. */
  verifiedStoreArtifactUrl?: string;
}>;

export type SystemEgressDecision = Readonly<{
  code:
    | 'SYSTEM_EGRESS_ALLOWED'
    | 'SYSTEM_EGRESS_DESTINATION_INVALID'
    | 'SYSTEM_EGRESS_OIDC_ORIGIN_DENIED'
    | 'SYSTEM_EGRESS_UPDATE_DESTINATION_DENIED'
    | 'SYSTEM_EGRESS_STORE_CATALOG_DESTINATION_DENIED'
    | 'SYSTEM_EGRESS_STORE_ARTIFACT_DESTINATION_DENIED'
    | 'SYSTEM_EGRESS_DIAGNOSTICS_CONSENT_REQUIRED'
    | 'SYSTEM_EGRESS_DIAGNOSTICS_DESTINATION_DENIED'
    | 'SYSTEM_EGRESS_PUBLISHER_AUTHORITY_DESTINATION_DENIED'
    | 'SYSTEM_EGRESS_LOCAL_OFFICE_PROBE_DESTINATION_DENIED';
  decision: 'allow' | 'deny';
  destination?: string;
}>;

export type SystemEgressAuthority = Readonly<{
  authorize(request: SystemEgressRequest): SystemEgressDecision;
}>;

const PACKAGED_UPDATE_HOST = 'github.com';
const PACKAGED_UPDATE_PATH = '/VNDT1625/OmniAgent/releases/download/';
const PACKAGED_STORE_CATALOG_HOST = 'github.com';
const PACKAGED_STORE_CATALOG_PATH = '/VNDT1625/OmniAgent/releases/download/tomni-store-v1/catalog.json';

const parseHttpsDestination = (value: string | undefined): URL | undefined => {
  if (value === undefined || value.length === 0 || value.length > 2_048) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const parseSentryDestination = (value: string | undefined): URL | undefined => {
  if (value === undefined || value.length === 0 || value.length > 2_048) return undefined;
  try {
    const parsed = new URL(value);
    // Sentry DSNs encode a public project key as the URL user name. Passwords
    // remain forbidden, and the DSN itself never reaches renderer code.
    return parsed.protocol === 'https:' && !parsed.password && !parsed.hash ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const parseLocalOfficeProbeDestination = (value: string | undefined): URL | undefined => {
  if (value === undefined || value.length === 0 || value.length > 2_048) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const isSentryDestination = (destination: URL): boolean =>
  destination.hostname === 'sentry.io' || destination.hostname.endsWith('.sentry.io');

const isLoopbackOfficeProbeDestination = (destination: URL): boolean =>
  (destination.protocol === 'http:' || destination.protocol === 'https:') &&
  !destination.username &&
  !destination.password &&
  !destination.hash &&
  ['127.0.0.1', 'localhost', '[::1]'].includes(destination.hostname);

const isPrivateOrLocalStoreCatalogHost = (hostname: string): boolean => {
  const host = hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;

  const ipv4 = host.split('.').map((part) => Number(part));
  if (ipv4.length !== 4 || ipv4.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return (
      host === '::' ||
      host === '::1' ||
      host.startsWith('::ffff:') ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      /^fe[89ab]/.test(host)
    );
  }

  const [first, second] = ipv4;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
};

/**
 * This authority deliberately has no generic network class. New system egress
 * needs an explicit policy and a dedicated call site at the final Main seam.
 */
export const createSystemEgressAuthority = (): SystemEgressAuthority => ({
  authorize(request) {
    const destination =
      request.egressClass === 'opt-in-diagnostics'
        ? parseSentryDestination(request.destination)
        : request.egressClass === 'local-office-probe'
          ? parseLocalOfficeProbeDestination(request.destination)
          : parseHttpsDestination(request.destination);
    if (!destination) {
      return { decision: 'deny', code: 'SYSTEM_EGRESS_DESTINATION_INVALID' };
    }

    switch (request.egressClass) {
      case 'oidc-auth': {
        const issuer = parseHttpsDestination(request.oidcIssuer);
        if (!issuer || issuer.origin !== destination.origin) {
          return { decision: 'deny', code: 'SYSTEM_EGRESS_OIDC_ORIGIN_DENIED' };
        }
        return { decision: 'allow', code: 'SYSTEM_EGRESS_ALLOWED', destination: destination.toString() };
      }
      case 'signed-app-update':
        if (
          destination.hostname !== PACKAGED_UPDATE_HOST ||
          destination.port ||
          !destination.pathname.startsWith(PACKAGED_UPDATE_PATH)
        ) {
          return { decision: 'deny', code: 'SYSTEM_EGRESS_UPDATE_DESTINATION_DENIED' };
        }
        return { decision: 'allow', code: 'SYSTEM_EGRESS_ALLOWED', destination: destination.toString() };
      case 'signed-store-catalog': {
        const configuredCatalog = parseHttpsDestination(request.storeCatalogUrl);
        if (
          !configuredCatalog ||
          configuredCatalog.toString() !== destination.toString() ||
          isPrivateOrLocalStoreCatalogHost(destination.hostname) ||
          (request.isPackaged === true &&
            (destination.hostname !== PACKAGED_STORE_CATALOG_HOST ||
              destination.port ||
              destination.pathname !== PACKAGED_STORE_CATALOG_PATH))
        ) {
          return { decision: 'deny', code: 'SYSTEM_EGRESS_STORE_CATALOG_DESTINATION_DENIED' };
        }
        return { decision: 'allow', code: 'SYSTEM_EGRESS_ALLOWED', destination: destination.toString() };
      }
      case 'signed-store-artifact': {
        const verifiedArtifact = parseHttpsDestination(request.verifiedStoreArtifactUrl);
        if (
          !verifiedArtifact ||
          verifiedArtifact.toString() !== destination.toString() ||
          isPrivateOrLocalStoreCatalogHost(destination.hostname)
        ) {
          return { decision: 'deny', code: 'SYSTEM_EGRESS_STORE_ARTIFACT_DESTINATION_DENIED' };
        }
        return { decision: 'allow', code: 'SYSTEM_EGRESS_ALLOWED', destination: destination.toString() };
      }
      case 'opt-in-diagnostics':
        if (request.diagnosticsConsent !== true) {
          return { decision: 'deny', code: 'SYSTEM_EGRESS_DIAGNOSTICS_CONSENT_REQUIRED' };
        }
        if (!isSentryDestination(destination)) {
          return { decision: 'deny', code: 'SYSTEM_EGRESS_DIAGNOSTICS_DESTINATION_DENIED' };
        }
        return { decision: 'allow', code: 'SYSTEM_EGRESS_ALLOWED', destination: destination.toString() };
      case 'publisher-authority': {
        const configuredOrigin = parseHttpsDestination(request.publisherAuthorityOrigin);
        if (!configuredOrigin || configuredOrigin.origin !== destination.origin) {
          return { decision: 'deny', code: 'SYSTEM_EGRESS_PUBLISHER_AUTHORITY_DESTINATION_DENIED' };
        }
        return { decision: 'allow', code: 'SYSTEM_EGRESS_ALLOWED', destination: destination.toString() };
      }
      case 'local-office-probe':
        if (!isLoopbackOfficeProbeDestination(destination)) {
          return { decision: 'deny', code: 'SYSTEM_EGRESS_LOCAL_OFFICE_PROBE_DESTINATION_DENIED' };
        }
        return { decision: 'allow', code: 'SYSTEM_EGRESS_ALLOWED', destination: destination.toString() };
      default:
        // Runtime callers may bypass TypeScript's closed union; unknown classes never inherit authority.
        return { decision: 'deny', code: 'SYSTEM_EGRESS_DESTINATION_INVALID' };
    }
  },
});

export const systemEgressAuthority = createSystemEgressAuthority();
