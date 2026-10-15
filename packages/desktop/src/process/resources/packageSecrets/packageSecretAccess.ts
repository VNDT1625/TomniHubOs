import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SecretDescriptor, SecretResolveRequest } from '@process/agentRuntime/contextTypes';
import type { SecretPayload, SecretVault } from '@process/agentRuntime/secretVault';
import { destinationsOfBinding, type SecretDestinationId } from '@/common/types/platform/sessionSecrets';

/**
 * A Package App has a private place for its own keys (the `package` scope) and no access to the person's general
 * app keys. It can ask for one; only the person's approval turns that into a grant, and a grant names one set.
 */
export type PackageSecretGrant = { packageId: string; handle: string; grantedAt: number };

export type PackageSecretGrantRepository = {
  list(): Promise<PackageSecretGrant[]>;
  save(values: PackageSecretGrant[]): Promise<void>;
};

export type PackageAccessSetView = {
  handle: string;
  label: string;
  note?: string;
  fields: string[];
  destinations: SecretDestinationId[];
};

export type PackageAccessRequest = {
  id: string;
  packageId: string;
  handle: string;
  label: string;
  fields: string[];
  /** Why the package wants it. Written by the package, shown to the person, never trusted. */
  reason: string;
  createdAt: number;
};

export type PackageAccessOverview = {
  granted: Array<PackageAccessSetView & { grantedAt: number }>;
  pending: PackageAccessRequest[];
  /** General app sets the person could still grant. */
  available: PackageAccessSetView[];
};

export type PackageSecretAccess = {
  /** Called by the package. Records a pending request; it grants nothing. */
  requestAccess(
    packageId: string,
    input: { handle: string; reason: string }
  ): Promise<{ requestId?: string; status: 'pending' | 'already-granted' }>;
  overview(packageId: string): Promise<PackageAccessOverview>;
  /** The person approved a pending request (after native approval). */
  approve(packageId: string, requestId: string): Promise<boolean>;
  deny(packageId: string, requestId: string): boolean;
  /** The person granted a set directly (after native approval). */
  grant(packageId: string, handle: string): Promise<boolean>;
  revoke(packageId: string, handle: string): Promise<boolean>;
  /** Forget every grant and request of a package, for example when it is uninstalled. */
  forgetPackage(packageId: string): Promise<number>;
  /**
   * The only way package code reaches a value: its own sets, and general app sets the person granted. A session or
   * company set, or an ungranted app set, is refused.
   */
  resolve(packageId: string, request: Omit<SecretResolveRequest, 'caller'>): Promise<SecretPayload>;
};

/** The only way package code uses a secret: as a variable in a process it starts. */
export const PACKAGE_USE_SURFACE = 'secret-firewall';
export const PACKAGE_USE_PURPOSE = 'opaque-use';
const MAX_PENDING_PER_PACKAGE = 20;
const MAX_GRANTS_PER_PACKAGE = 100;
const MAX_REASON_CHARS = 300;
const DENIED = 'Secret capability is not allowed for this package.';

const isAppScoped = (item: SecretDescriptor): boolean => !item.scope || item.scope.kind === 'app';

type Deps = {
  vault: Pick<SecretVault, 'list' | 'resolve'>;
  repository: PackageSecretGrantRepository;
  now?: () => number;
  createId?: () => string;
};

export const createPackageSecretAccess = (deps: Deps): PackageSecretAccess => {
  const now = deps.now ?? Date.now;
  const createId = deps.createId ?? randomUUID;
  const pending = new Map<string, PackageAccessRequest[]>();
  let tail: Promise<unknown> = Promise.resolve();
  const mutate = <T>(run: () => Promise<T>): Promise<T> => {
    const next = tail.then(run, run);
    tail = next.catch((): undefined => undefined);
    return next;
  };

  // A package only ever uses a set as a process variable, so a set that cannot be used that way is not grantable.
  const usable = (item: SecretDescriptor): boolean =>
    item.revokedAt === undefined &&
    (item.expiresAt === undefined || item.expiresAt > now()) &&
    item.binding.surfaces.includes(PACKAGE_USE_SURFACE) &&
    item.binding.purposes.includes(PACKAGE_USE_PURPOSE) &&
    destinationsOfBinding(item.binding).destinations.length > 0;
  const setPending = (packageId: string, list: PackageAccessRequest[]): void => {
    if (list.length === 0) pending.delete(packageId);
    else pending.set(packageId, list);
  };
  const appSets = async (): Promise<SecretDescriptor[]> =>
    (await deps.vault.list()).filter((item) => isAppScoped(item) && usable(item));
  const view = (item: SecretDescriptor): PackageAccessSetView => ({
    handle: item.handle,
    label: item.label,
    ...(item.note ? { note: item.note } : {}),
    fields: [...item.fields],
    destinations: destinationsOfBinding(item.binding).destinations,
  });
  const grantsOf = async (packageId: string): Promise<PackageSecretGrant[]> =>
    (await deps.repository.list()).filter((grant) => grant.packageId === packageId);

  const addGrant = (packageId: string, handle: string) =>
    mutate(async () => {
      // Grants for sets that no longer exist are dropped, so they cannot fill the cap or come back with a recovered handle.
      const known = new Set((await deps.vault.list()).map((item) => item.handle));
      const stored = await deps.repository.list();
      const all = stored.filter((grant) => known.has(grant.handle));
      if (all.length !== stored.length) await deps.repository.save(all);
      if (all.some((grant) => grant.packageId === packageId && grant.handle === handle)) return true;
      if (all.filter((grant) => grant.packageId === packageId).length >= MAX_GRANTS_PER_PACKAGE) return false;
      await deps.repository.save([...all, { packageId, handle, grantedAt: now() }]);
      return true;
    });

  return {
    async requestAccess(packageId, input) {
      const target = (await appSets()).find((item) => item.handle === input.handle);
      if (!target) throw new Error(DENIED);
      if ((await grantsOf(packageId)).some((grant) => grant.handle === target.handle)) {
        return { status: 'already-granted' };
      }
      const reason = input.reason.trim().slice(0, MAX_REASON_CHARS);
      if (!reason) throw new Error('A reason is required.');
      const current = pending.get(packageId) ?? [];
      const existing = current.find((request) => request.handle === target.handle);
      if (existing) {
        existing.reason = reason;
        return { requestId: existing.id, status: 'pending' };
      }
      const request: PackageAccessRequest = {
        id: createId(),
        packageId,
        handle: target.handle,
        label: target.label,
        fields: [...target.fields],
        reason,
        createdAt: now(),
      };
      pending.set(packageId, [...current, request].slice(-MAX_PENDING_PER_PACKAGE));
      return { requestId: request.id, status: 'pending' };
    },
    async overview(packageId) {
      const sets = await appSets();
      const grants = await grantsOf(packageId);
      const grantedHandles = new Set(grants.map((grant) => grant.handle));
      return {
        granted: grants.flatMap((grant) => {
          const set = sets.find((item) => item.handle === grant.handle);
          return set ? [{ ...view(set), grantedAt: grant.grantedAt }] : [];
        }),
        pending: (pending.get(packageId) ?? [])
          .filter((request) => sets.some((item) => item.handle === request.handle))
          .map((request) => structuredClone(request)),
        available: sets.filter((item) => !grantedHandles.has(item.handle)).map(view),
      };
    },
    async approve(packageId, requestId) {
      const request = (pending.get(packageId) ?? []).find((item) => item.id === requestId);
      if (!request) return false;
      if (!(await appSets()).some((item) => item.handle === request.handle)) return false;
      if (!(await addGrant(packageId, request.handle))) return false;
      setPending(
        packageId,
        (pending.get(packageId) ?? []).filter((item) => item.id !== requestId)
      );
      return true;
    },
    deny(packageId, requestId) {
      const current = pending.get(packageId) ?? [];
      const next = current.filter((item) => item.id !== requestId);
      if (next.length === current.length) return false;
      setPending(packageId, next);
      return true;
    },
    async grant(packageId, handle) {
      if (!(await appSets()).some((item) => item.handle === handle)) return false;
      const granted = await addGrant(packageId, handle);
      if (granted) {
        setPending(
          packageId,
          (pending.get(packageId) ?? []).filter((item) => item.handle !== handle)
        );
      }
      return granted;
    },
    revoke: (packageId, handle) =>
      mutate(async () => {
        const all = await deps.repository.list();
        const next = all.filter((grant) => !(grant.packageId === packageId && grant.handle === handle));
        if (next.length === all.length) return false;
        await deps.repository.save(next);
        return true;
      }),
    forgetPackage: (packageId) =>
      mutate(async () => {
        pending.delete(packageId);
        const all = await deps.repository.list();
        const next = all.filter((grant) => grant.packageId !== packageId);
        if (next.length !== all.length) await deps.repository.save(next);
        return all.length - next.length;
      }),
    async resolve(packageId, request) {
      const target = (await deps.vault.list()).find((item) => item.handle === request.handle);
      if (!target) throw new Error(DENIED);
      if (target.scope?.kind === 'package') {
        if (target.scope.packageId !== packageId) throw new Error(DENIED);
        return deps.vault.resolve({ ...request, caller: { packageId } });
      }
      if (!isAppScoped(target)) throw new Error(DENIED);
      if (!(await grantsOf(packageId)).some((grant) => grant.handle === request.handle)) throw new Error(DENIED);
      return deps.vault.resolve({ ...request });
    },
  };
};

const isGrant = (value: unknown): value is PackageSecretGrant => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PackageSecretGrant>;
  return typeof item.packageId === 'string' && typeof item.handle === 'string' && typeof item.grantedAt === 'number';
};

/** Atomic 0600 persistence of the grants (handles only, never a value). */
export const createFileGrantRepository = (filePath: string): PackageSecretGrantRepository => ({
  async list() {
    try {
      const value: unknown = JSON.parse(await fs.promises.readFile(filePath, 'utf-8'));
      return Array.isArray(value) ? value.filter(isGrant) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return [];
      throw error;
    }
  },
  async save(values) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(values), { encoding: 'utf-8', mode: 0o600 });
    await fs.promises.rename(temporary, filePath);
  },
});
