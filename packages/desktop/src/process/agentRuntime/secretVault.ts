import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SecretDescriptor, SecretResolveRequest } from './contextTypes';

export type SecretPayload = Record<string, string>;
export type SecretDescriptorInput = Omit<SecretDescriptor, 'handle' | 'createdAt' | 'updatedAt'>;
export type StoredSecret = SecretDescriptor & { encryptedPayload: string };
export type SecretVaultCodec = {
  available(): boolean;
  encrypt(plainText: string): string;
  decrypt(cipherText: string): string;
};
export type SecretVaultRepository = {
  list(): Promise<StoredSecret[]>;
  save(values: StoredSecret[]): Promise<void>;
};
export type SecretVault = {
  put(input: SecretDescriptorInput, payload: SecretPayload): Promise<SecretDescriptor>;
  replace(handle: string, input: SecretDescriptorInput, payload: SecretPayload): Promise<SecretDescriptor>;
  recover(
    handle: string,
    input: SecretDescriptorInput,
    payload: SecretPayload
  ): Promise<{ descriptor: SecretDescriptor; created: boolean }>;
  list(): Promise<SecretDescriptor[]>;
  resolve(request: SecretResolveRequest): Promise<SecretPayload>;
  remove(handle: string): Promise<boolean>;
};

export type SecretRecoveryCandidate = {
  /** Stable, non-secret identity of the legacy record. It is hashed before persistence. */
  sourceId: string;
  input: SecretDescriptorInput;
  payload: SecretPayload;
};
export type SecretRecoverySnapshot = {
  status: 'available' | 'missing';
  candidates: SecretRecoveryCandidate[];
  /** Legacy records that existed but could not be decrypted or validated. */
  skipped: number;
};
export type SecretRecoveryReport = {
  status: 'complete' | 'missing' | 'partial' | 'unavailable';
  imported: number;
  existing: number;
  skipped: number;
  failed: number;
};

const metadata = ({ encryptedPayload: _payload, ...descriptor }: StoredSecret): SecretDescriptor =>
  structuredClone(descriptor);
const targetAllowed = (allowed: string[] | undefined, value: string | undefined): boolean =>
  !allowed || allowed.length === 0 || (Boolean(value) && allowed.includes(value!));

const SECRET_FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const EXACT_HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const MAX_SECRET_TARGET_HOSTNAMES = 20;
const MAX_STORED_SECRETS = 512;
const RECOVERED_SECRET_HANDLE = /^secret:\/\/recovered\/[a-f0-9]{64}$/u;

/** Produce an opaque, repeatable handle without persisting the legacy source identity. */
export const stableSecretRecoveryHandle = (sourceId: string): string =>
  `secret://recovered/${createHash('sha256').update(sourceId).digest('hex')}`;

/** Normalize an allowlist of exact DNS hostnames; schemes, paths, ports and wildcards are forbidden. */
export const normalizeExactSecretHostnames = (values: unknown): string[] => {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_SECRET_TARGET_HOSTNAMES) {
    throw new Error('Secret targets must contain between 1 and 20 exact hostnames.');
  }
  const normalized = values.map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''));
  if (normalized.some((value) => !EXACT_HOSTNAME.test(value))) {
    throw new Error('Every secret target must be an exact hostname without a scheme, path, port, or wildcard.');
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Secret targets must contain unique exact hostnames.');
  }
  return normalized;
};
const boundedUniqueList = (values: string[], label: string, maxItems = 100): string[] => {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  if (normalized.length === 0 || normalized.length > maxItems || new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must contain unique non-empty values.`);
  }
  return normalized;
};
const normalizeDescriptor = (
  input: SecretDescriptorInput,
  payload: SecretPayload,
  timestamp: number
): { input: SecretDescriptorInput; payload: SecretPayload } => {
  const label = input.label.trim().slice(0, 120);
  const note = input.note?.trim().slice(0, 1_000) || undefined;
  const fields = boundedUniqueList(input.fields, 'Secret fields', 50);
  if (!label) throw new Error('A secret-set name is required.');
  if (fields.some((field) => !SECRET_FIELD.test(field))) {
    throw new Error(
      'Secret variable names must start with a letter or underscore and contain only letters, numbers, and underscores.'
    );
  }
  if (
    fields.some((field) => typeof payload[field] !== 'string' || payload[field].length === 0) ||
    Object.keys(payload).some((field) => !fields.includes(field))
  ) {
    throw new Error('Every secret variable must have one non-empty value and no extra payload fields.');
  }
  const surfaces = boundedUniqueList(input.binding.surfaces, 'Secret surfaces');
  const purposes = boundedUniqueList(input.binding.purposes, 'Secret purposes');
  const requiresExactTargets = surfaces.includes('browser') && purposes.includes('browser-fill');
  const targets = requiresExactTargets
    ? normalizeExactSecretHostnames(input.binding.targets)
    : input.binding.targets?.map((value) => value.trim()).filter(Boolean);
  if (input.expiresAt !== undefined && (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= timestamp)) {
    throw new Error('Secret expiry must be in the future.');
  }
  if (input.revokedAt !== undefined) throw new Error('A saved secret cannot start revoked.');
  return {
    input: {
      ...structuredClone(input),
      label,
      note,
      fields,
      binding: {
        surfaces,
        purposes,
        ...(targets && targets.length > 0 ? { targets: [...new Set(targets)] } : {}),
      },
    },
    payload: Object.fromEntries(fields.map((field) => [field, payload[field]])),
  };
};

/**
 * Resolves OS-encrypted values only for a bound host capability.
 * The vault must never be passed to renderer, prompt construction, event, or checkpoint code.
 */
export const createSecretVault = (
  repository: SecretVaultRepository,
  codec: SecretVaultCodec,
  newHandle: () => string = () => `secret://${randomUUID()}`,
  now: () => number = Date.now
): SecretVault => {
  let mutation = Promise.resolve();
  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutation.then(operation, operation);
    mutation = result.then(
      (): void => undefined,
      (): void => undefined
    );
    return result;
  };
  const requireEncryption = (): void => {
    if (!codec.available())
      throw new Error('OS secret encryption is unavailable; refusing to persist or reveal secrets.');
  };
  return {
    async put(input, payload) {
      return mutate(async () => {
        requireEncryption();
        const values = await repository.list();
        if (values.length >= MAX_STORED_SECRETS) throw new Error('Secret vault capacity has been reached.');
        const timestamp = now();
        const normalized = normalizeDescriptor(input, payload, timestamp);
        const stored: StoredSecret = {
          ...normalized.input,
          handle: newHandle(),
          createdAt: timestamp,
          updatedAt: timestamp,
          encryptedPayload: codec.encrypt(JSON.stringify(normalized.payload)),
        };
        await repository.save([...values, stored]);
        return metadata(stored);
      });
    },
    async replace(handle, input, payload) {
      return mutate(async () => {
        requireEncryption();
        const values = await repository.list();
        const existing = values.find((item) => item.handle === handle);
        if (!existing) throw new Error('Unknown secret capability handle.');
        if (existing.revokedAt !== undefined) throw new Error('Secret capability has been revoked.');
        const timestamp = now();
        const normalized = normalizeDescriptor(input, payload, timestamp);
        const stored: StoredSecret = {
          ...normalized.input,
          handle: existing.handle,
          createdAt: existing.createdAt,
          updatedAt: timestamp,
          encryptedPayload: codec.encrypt(JSON.stringify(normalized.payload)),
        };
        await repository.save(values.map((item) => (item.handle === handle ? stored : item)));
        return metadata(stored);
      });
    },
    async recover(handle, input, payload) {
      return mutate(async () => {
        requireEncryption();
        if (!RECOVERED_SECRET_HANDLE.test(handle)) throw new Error('Invalid recovered secret handle.');
        const values = await repository.list();
        const existing = values.find((item) => item.handle === handle);
        if (existing) return { descriptor: metadata(existing), created: false };
        if (values.length >= MAX_STORED_SECRETS) throw new Error('Secret vault capacity has been reached.');
        const timestamp = now();
        const normalized = normalizeDescriptor(input, payload, timestamp);
        const stored: StoredSecret = {
          ...normalized.input,
          handle,
          createdAt: timestamp,
          updatedAt: timestamp,
          encryptedPayload: codec.encrypt(JSON.stringify(normalized.payload)),
        };
        await repository.save([...values, stored]);
        return { descriptor: metadata(stored), created: true };
      });
    },
    async list() {
      return (await repository.list()).map(metadata);
    },
    async resolve(request) {
      requireEncryption();
      const stored = (await repository.list()).find((item) => item.handle === request.handle);
      if (!stored) throw new Error('Unknown secret capability handle.');
      if (stored.revokedAt !== undefined) throw new Error('Secret capability has been revoked.');
      if (stored.expiresAt !== undefined && stored.expiresAt <= now())
        throw new Error('Secret capability has expired.');
      if (!stored.binding.surfaces.includes(request.surface))
        throw new Error('Secret capability is not allowed on this surface.');
      if (!stored.binding.purposes.includes(request.purpose))
        throw new Error('Secret capability is not allowed for this purpose.');
      const requiresBrowserFillTarget = request.surface === 'browser' && request.purpose === 'browser-fill';
      if (
        requiresBrowserFillTarget &&
        (!stored.binding.targets ||
          stored.binding.targets.length === 0 ||
          !targetAllowed(stored.binding.targets, request.target))
      ) {
        throw new Error('Secret capability is not allowed for this target.');
      }
      if (!requiresBrowserFillTarget && request.target && !targetAllowed(stored.binding.targets, request.target)) {
        throw new Error('Secret capability is not allowed for this target.');
      }
      const requestedFields = [...new Set(request.fields)];
      if (requestedFields.length === 0 || requestedFields.some((field) => !stored.fields.includes(field))) {
        throw new Error('Secret capability field is not allowed.');
      }
      const decoded: unknown = JSON.parse(codec.decrypt(stored.encryptedPayload));
      if (!decoded || typeof decoded !== 'object') throw new Error('Secret payload is corrupted.');
      const payload = decoded as SecretPayload;
      if (requestedFields.some((field) => typeof payload[field] !== 'string'))
        throw new Error('Secret payload is corrupted.');
      return Object.fromEntries(requestedFields.map((field) => [field, payload[field]]));
    },
    async remove(handle) {
      return mutate(async () => {
        const values = await repository.list();
        const next = values.filter((item) => item.handle !== handle);
        if (next.length === values.length) return false;
        await repository.save(next);
        return true;
      });
    },
  };
};

/**
 * Recover a legacy source without overwriting Core records. Source errors and
 * per-record failures are reduced to count-only diagnostics so secret-bearing
 * exception text can never cross into renderer or model output.
 */
export const recoverSecretSource = async (
  vault: SecretVault,
  loadSource: () => Promise<SecretRecoverySnapshot>
): Promise<SecretRecoveryReport> => {
  let snapshot: SecretRecoverySnapshot;
  try {
    snapshot = await loadSource();
  } catch {
    return { status: 'unavailable', imported: 0, existing: 0, skipped: 0, failed: 0 };
  }
  if (snapshot.status === 'missing') {
    return { status: 'missing', imported: 0, existing: 0, skipped: snapshot.skipped, failed: 0 };
  }

  let imported = 0;
  let existing = 0;
  let failed = 0;
  for (const candidate of snapshot.candidates) {
    try {
      const recovered = await vault.recover(
        stableSecretRecoveryHandle(candidate.sourceId),
        candidate.input,
        candidate.payload
      );
      if (recovered.created) imported += 1;
      else existing += 1;
    } catch {
      failed += 1;
    }
  }
  return {
    status: snapshot.skipped > 0 || failed > 0 ? 'partial' : 'complete',
    imported,
    existing,
    skipped: snapshot.skipped,
    failed,
  };
};

type RepositoryFs = Pick<typeof fs.promises, 'readFile' | 'writeFile' | 'rename' | 'mkdir'>;
const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
const isStoredSecret = (value: unknown): value is StoredSecret => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<StoredSecret>;
  return typeof item.handle === 'string' && typeof item.encryptedPayload === 'string' && Array.isArray(item.fields);
};

/** Atomic 0600 persistence for encrypted records only. */
export const createFileSecretRepository = (
  filePath: string,
  fsImpl: RepositoryFs = fs.promises
): SecretVaultRepository => ({
  async list() {
    try {
      const value: unknown = JSON.parse(await fsImpl.readFile(filePath, 'utf-8'));
      return Array.isArray(value) ? value.filter(isStoredSecret) : [];
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  },
  async save(values) {
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
    await fsImpl.writeFile(temporary, `${JSON.stringify(values, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    await fsImpl.rename(temporary, filePath);
  },
});
