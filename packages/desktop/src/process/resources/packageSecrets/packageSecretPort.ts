import type { SecretVault } from '@process/agentRuntime/secretVault';
import type { PackageSecretAccess } from './packageSecretAccess';

/** What package code may know about a set: where it lives and its variable names. Never a value. */
export type PackageSecretInfo = {
  handle: string;
  label: string;
  note?: string;
  fields: string[];
  /** `own` lives in the package's private space; `granted` is a general app set the person allowed it to use. */
  origin: 'own' | 'granted';
  updatedAt: number;
};

/**
 * The Main-side API one Package App uses for secrets: a private space of its own, plus the general app sets the
 * person granted. A package that wants more calls `requestAccess`, which grants nothing by itself.
 */
export type PackageSecretPort = {
  list(): Promise<PackageSecretInfo[]>;
  /** Keep a key in the package's own space. The value never comes back out except through `resolve`. */
  store(input: { label: string; note?: string; values: Record<string, string> }): Promise<{ handle: string }>;
  resolve(handle: string, fields: readonly string[]): Promise<Record<string, string>>;
  requestAccess(handle: string, reason: string): Promise<{ requestId?: string; status: 'pending' | 'already-granted' }>;
};

type Shared = { vault: SecretVault; access: PackageSecretAccess };
let shared: Shared | undefined;

/** Main binds the vault and the access store once at startup. */
export const configurePackageSecretPorts = (value: Shared | undefined): void => {
  shared = value;
};

const PROCESS_USE = { surface: 'secret-firewall', purpose: 'opaque-use' } as const;
/** Per package; the vault as a whole holds a few hundred sets. */
export const MAX_OWN_SETS = 50;

/** The port of one package. Without Main's wiring every call fails closed or lists nothing. */
export const getPackageSecretPort = (packageId: string): PackageSecretPort => ({
  async list() {
    if (!shared) return [];
    const [sets, overview] = await Promise.all([shared.vault.list(), shared.access.overview(packageId)]);
    const now = Date.now();
    const live = (item: { revokedAt?: number; expiresAt?: number }): boolean =>
      item.revokedAt === undefined && (item.expiresAt === undefined || item.expiresAt > now);
    const granted = new Set(overview.granted.map((item) => item.handle));
    return sets.flatMap((item): PackageSecretInfo[] => {
      if (!live(item)) return [];
      const own = item.scope?.kind === 'package' && item.scope.packageId === packageId;
      const allowed = own || ((!item.scope || item.scope.kind === 'app') && granted.has(item.handle));
      if (!allowed) return [];
      const usable =
        item.binding.surfaces.includes(PROCESS_USE.surface) && item.binding.purposes.includes(PROCESS_USE.purpose);
      if (!usable) return [];
      return [
        {
          handle: item.handle,
          label: item.label,
          ...(item.note ? { note: item.note } : {}),
          fields: [...item.fields],
          origin: own ? 'own' : 'granted',
          updatedAt: item.updatedAt,
        },
      ];
    });
  },
  async store({ label, note, values }) {
    if (!shared) throw new Error('Package secrets are unavailable.');
    // A package cannot fill the shared vault: it may keep a bounded number of sets of its own.
    const owned = (await shared.vault.list()).filter(
      (item) => item.scope?.kind === 'package' && item.scope.packageId === packageId
    );
    if (owned.length >= MAX_OWN_SETS) throw new Error('The package has reached its secret limit.');
    const fields = Object.keys(values);
    const descriptor = await shared.vault.put(
      {
        label,
        ...(note ? { note } : {}),
        kind: 'credential',
        fields,
        binding: { surfaces: [PROCESS_USE.surface], purposes: [PROCESS_USE.purpose] },
        scope: { kind: 'package', packageId },
      },
      values
    );
    return { handle: descriptor.handle };
  },
  async resolve(handle, fields) {
    if (!shared) throw new Error('Package secrets are unavailable.');
    return shared.access.resolve(packageId, { handle, fields: [...fields], ...PROCESS_USE });
  },
  async requestAccess(handle, reason) {
    if (!shared) throw new Error('Package secrets are unavailable.');
    return shared.access.requestAccess(packageId, { handle, reason });
  },
});
