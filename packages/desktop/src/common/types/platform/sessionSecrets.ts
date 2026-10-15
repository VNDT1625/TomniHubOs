/**
 * Secret sets in the app vault, managed by the person for one scope: the selected conversation ("Khóa bí mật" in the
 * Hub rail, temporary) or one company group chat (company settings, permanent). Values are written, never listed;
 * the only path that returns a value is `reveal`, which needs native approval and leaves a content-free receipt.
 */
export const SESSION_SECRETS_CHANNELS = {
  list: 'core.session-secrets.list',
  save: 'core.session-secrets.save',
  remove: 'core.session-secrets.remove',
  reveal: 'core.session-secrets.reveal',
  dismissRequest: 'core.session-secrets.dismiss-request',
} as const;

export const COMPANY_SECRETS_CHANNELS = {
  list: 'core.company-secrets.list',
  save: 'core.company-secrets.save',
  remove: 'core.company-secrets.remove',
  reveal: 'core.company-secrets.reveal',
  dismissRequest: 'core.company-secrets.dismiss-request',
} as const;

export const PACKAGE_SECRETS_CHANNELS = {
  list: 'core.package-secrets.list',
  save: 'core.package-secrets.save',
  remove: 'core.package-secrets.remove',
  reveal: 'core.package-secrets.reveal',
  dismissRequest: 'core.package-secrets.dismiss-request',
} as const;

/** Keys a package kept before the app vault existed, offered for an explicit, approved import. */
export const PACKAGE_SECRETS_LEGACY_CHANNEL = 'core.package-secrets.legacy';

/** The person's decisions about which general app secrets a Package App may use. */
export const PACKAGE_SECRETS_ACCESS_CHANNEL = 'core.package-secrets.access';

/** Where the app may type a set's values. `process` covers managed-process variables and deployment secrets. */
export const SECRET_DESTINATIONS = ['browser', 'terminal', 'process'] as const;
export type SecretDestinationId = (typeof SECRET_DESTINATIONS)[number];
export const SECRET_DESTINATION_ORDER: readonly SecretDestinationId[] = SECRET_DESTINATIONS;

/** The vault surface and purpose each destination is bound to. */
export const SECRET_DESTINATION_ROUTES: Readonly<Record<SecretDestinationId, { surface: string; purpose: string }>> = {
  browser: { surface: 'browser', purpose: 'browser-fill' },
  terminal: { surface: 'terminal', purpose: 'terminal-input' },
  process: { surface: 'secret-firewall', purpose: 'opaque-use' },
};

/** What a stored binding allows, for display and for the agent's listing. An internal credential allows nothing. */
export const destinationsOfBinding = (binding: {
  surfaces: readonly string[];
  purposes: readonly string[];
  targets?: readonly string[];
}): { destinations: SecretDestinationId[]; hosts?: string[] } => {
  const destinations = SECRET_DESTINATION_ORDER.filter(
    (destination) =>
      binding.surfaces.includes(SECRET_DESTINATION_ROUTES[destination].surface) &&
      binding.purposes.includes(SECRET_DESTINATION_ROUTES[destination].purpose)
  );
  return destinations.includes('browser') && binding.targets?.length
    ? { destinations, hosts: [...binding.targets] }
    : { destinations };
};

export const SECRET_SET_LIMITS = {
  maxVariables: 24,
  maxValueChars: 8192,
  maxLabelChars: 120,
  maxNoteChars: 500,
  maxNameChars: 128,
  maxHosts: 20,
} as const;

export type SecretScopeKind = 'app' | 'session' | 'company' | 'package';

/** Metadata only: there is deliberately no field that can carry a value. */
export type SecretSetView = {
  handle: string;
  label: string;
  note?: string;
  fields: string[];
  scope: SecretScopeKind;
  destinations: SecretDestinationId[];
  /** Exact hostnames, present when `browser` is a destination. */
  hosts?: string[];
  updatedAt: number;
};

/** A secret an agent asked for with `tomny_secret_request`; the person fills in the values. */
export type SecretRequestView = {
  id: string;
  label: string;
  note: string;
  fields: string[];
  destinations: SecretDestinationId[];
  hosts?: string[];
  createdAt: number;
};

export type SecretsListing = {
  sets: SecretSetView[];
  requests: SecretRequestView[];
  /** False when OS-protected storage is missing; permanent scopes then cannot save. */
  keychainAvailable: boolean;
};

export type SecretSetInput = {
  /** Omit to create; give a handle of this scope to replace every value of that set. */
  handle?: string;
  /** An agent request this set fulfils; it is dismissed once the set is saved. */
  requestId?: string;
  label: string;
  note?: string;
  destinations: SecretDestinationId[];
  hosts?: string[];
  variables: Array<{ name: string; value: string }>;
};

export type SecretsResult<T> = { ok: true; data: T } | { ok: false; error: string };

type WithScopeId<Key extends string> = { [K in Key]: string };

/** The renderer-facing surface of one scoped bridge. `Key` is `sessionId`, `companyId` or `packageId`. */
export type ScopedSecretsNativeAPI<Key extends 'sessionId' | 'companyId' | 'packageId'> = {
  list: (request: WithScopeId<Key>) => Promise<SecretsResult<SecretsListing>>;
  save: (request: WithScopeId<Key> & { set: SecretSetInput }) => Promise<SecretsResult<SecretSetView>>;
  remove: (request: WithScopeId<Key> & { handle: string }) => Promise<SecretsResult<boolean>>;
  reveal: (request: WithScopeId<Key> & { handle: string; field: string }) => Promise<SecretsResult<string>>;
  dismissRequest: (request: WithScopeId<Key> & { requestId: string }) => Promise<SecretsResult<boolean>>;
};

export type SessionSecretsNativeAPI = ScopedSecretsNativeAPI<'sessionId'>;
export type CompanySecretsNativeAPI = ScopedSecretsNativeAPI<'companyId'>;

export type LegacySecretsStatus = { pending: number };
export type LegacySecretsImportReport = { imported: number; existing: number; skipped: number; failed: number };

export type PackageAccessSetView = {
  handle: string;
  label: string;
  note?: string;
  fields: string[];
  destinations: SecretDestinationId[];
};
export type PackageAccessPendingView = {
  id: string;
  handle: string;
  label: string;
  fields: string[];
  /** Written by the package; shown to the person, never trusted. */
  reason: string;
  createdAt: number;
};
export type PackageAccessOverviewView = {
  granted: Array<PackageAccessSetView & { grantedAt: number }>;
  pending: PackageAccessPendingView[];
  /** General app sets the person could still grant. */
  available: PackageAccessSetView[];
};

export type PackageSecretsNativeAPI = ScopedSecretsNativeAPI<'packageId'> & {
  access: {
    overview: (request: { packageId: string }) => Promise<SecretsResult<PackageAccessOverviewView>>;
    approve: (request: { packageId: string; requestId: string }) => Promise<SecretsResult<boolean>>;
    deny: (request: { packageId: string; requestId: string }) => Promise<SecretsResult<boolean>>;
    grant: (request: { packageId: string; handle: string }) => Promise<SecretsResult<boolean>>;
    revoke: (request: { packageId: string; handle: string }) => Promise<SecretsResult<boolean>>;
  };
  legacy: {
    status: (request: { packageId: string }) => Promise<SecretsResult<LegacySecretsStatus>>;
    import: (request: { packageId: string }) => Promise<SecretsResult<LegacySecretsImportReport>>;
  };
};
