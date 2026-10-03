import { app, safeStorage } from 'electron';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const FILE_NAME = 'model-consumers.v1.json';
const MAX_RECORD_BYTES = 256 * 1024;
const CREDENTIAL_BYTES = 32;

export type TomniGatewayModelConsumerRecord = Readonly<{
  schemaVersion: 1;
  consumerId: string;
  actorId: string;
  label: string;
  credentialDigest: string;
  allowedModels: readonly string[];
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}>;

export type TomniGatewayModelConsumer = Readonly<{
  consumerId: string;
  allowedModels: readonly string[];
}>;

export type ModelConsumerVaultCodec = Readonly<{
  isAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
}>;

export type ModelConsumerVault = Readonly<{
  list(): Promise<readonly TomniGatewayModelConsumerRecord[]>;
  save(record: TomniGatewayModelConsumerRecord): Promise<void>;
  revoke(consumerId: string, revokedAt?: string): Promise<boolean>;
  rotate(
    input: Readonly<{
      consumerId: string;
      actorId: string;
      credentialDigest: string;
      createdAt: string;
      expiresAt: string;
      now: number;
    }>
  ): Promise<boolean>;
}>;

export type TomniGatewayModelConsumerRegistry = Readonly<{
  issue(input: {
    label: string;
    allowedModels: readonly string[];
    ttlMs: number;
  }): Promise<{ consumerId: string; credential: string; expiresAt: string }>;
  resolveCredential(credential: string): Promise<TomniGatewayModelConsumer | undefined>;
  getConsumer(consumerId: string): Promise<TomniGatewayModelConsumer | undefined>;
  list(): Promise<
    readonly Readonly<{
      consumerId: string;
      label: string;
      allowedModels: readonly string[];
      createdAt: string;
      expiresAt: string;
      revokedAt?: string;
    }>[]
  >;
  revoke(consumerId: string): Promise<boolean>;
  rotate?(input: {
    consumerId: string;
    ttlMs: number;
  }): Promise<{ consumerId: string; credential: string; expiresAt: string } | undefined>;
}>;

export type ModelConsumerVaultOptions = Readonly<{
  rootDir?: string;
  codec?: ModelConsumerVaultCodec;
}>;

const defaultCodec: ModelConsumerVaultCodec = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
  decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
};

const digest = (credential: string): Buffer => createHash('sha256').update(credential, 'utf8').digest();
const digestText = (credential: string): string => digest(credential).toString('hex');
const sameDigest = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};
const bounded = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/\p{Cc}/u.test(value);
const rootPath = (options: ModelConsumerVaultOptions): string => {
  const root = options.rootDir ?? path.join(app.getPath('userData'), 'tomny-core');
  if (!path.isAbsolute(root)) throw new Error('MODEL_CONSUMER_INVALID_ROOT');
  return root;
};
const assertRecord: (value: unknown) => asserts value is TomniGatewayModelConsumerRecord = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MODEL_CONSUMER_INVALID_RECORD');
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    !bounded(record.consumerId, 160) ||
    !bounded(record.actorId, 160) ||
    !bounded(record.label, 200) ||
    !bounded(record.credentialDigest, 128) ||
    !Array.isArray(record.allowedModels) ||
    record.allowedModels.length > 200 ||
    record.allowedModels.some((model) => !bounded(model, 200)) ||
    !bounded(record.createdAt, 64) ||
    !bounded(record.expiresAt, 64) ||
    !Number.isFinite(Date.parse(record.createdAt)) ||
    !Number.isFinite(Date.parse(record.expiresAt)) ||
    (record.revokedAt !== undefined &&
      (!bounded(record.revokedAt, 64) || !Number.isFinite(Date.parse(record.revokedAt))))
  ) {
    throw new Error('MODEL_CONSUMER_INVALID_RECORD');
  }
};

export const createModelConsumerVault = (options: ModelConsumerVaultOptions = {}): ModelConsumerVault => {
  const root = rootPath(options);
  const codec = options.codec ?? defaultCodec;
  const filePath = path.join(root, FILE_NAME);
  const load = async (): Promise<TomniGatewayModelConsumerRecord[]> => {
    if (!codec.isAvailable()) throw new Error('MODEL_CONSUMER_PROTECTED_STORAGE_UNAVAILABLE');
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error('MODEL_CONSUMER_STORAGE_UNAVAILABLE', { cause: error });
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_RECORD_BYTES) throw new Error('MODEL_CONSUMER_STORAGE_CORRUPT');
    let value: unknown;
    try {
      value = JSON.parse(codec.decrypt(raw));
    } catch (error) {
      throw new Error('MODEL_CONSUMER_STORAGE_CORRUPT', { cause: error });
    }
    if (!Array.isArray(value) || value.length > 200) throw new Error('MODEL_CONSUMER_STORAGE_CORRUPT');
    value.forEach(assertRecord);
    return value;
  };
  const persist = async (records: readonly TomniGatewayModelConsumerRecord[]): Promise<void> => {
    if (!codec.isAvailable()) throw new Error('MODEL_CONSUMER_PROTECTED_STORAGE_UNAVAILABLE');
    const output = codec.encrypt(JSON.stringify(records));
    if (Buffer.byteLength(output, 'utf8') > MAX_RECORD_BYTES) throw new Error('MODEL_CONSUMER_STORAGE_TOO_LARGE');
    await mkdir(root, { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, output, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, filePath);
      await chmod(filePath, 0o600);
    } catch (error) {
      await rm(temporary, { force: true }).catch((): undefined => undefined);
      throw new Error('MODEL_CONSUMER_STORAGE_UNAVAILABLE', { cause: error });
    }
  };
  let mutationQueue: Promise<void> = Promise.resolve();
  const withMutation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(
      (): void => undefined,
      (): void => undefined
    );
    return result;
  };
  return {
    list: async () => load(),
    save: (record) =>
      withMutation(async () => {
        assertRecord(record);
        const records = await load();
        const next = records.filter((item) => item.consumerId !== record.consumerId);
        next.push(record);
        await persist(next);
      }),
    rotate: (input) =>
      withMutation(async () => {
        const records = await load();
        const index = records.findIndex(
          (record) =>
            record.consumerId === input.consumerId &&
            record.actorId === input.actorId &&
            !record.revokedAt &&
            Date.parse(record.expiresAt) > input.now
        );
        if (index < 0) return false;
        const current = records[index]!;
        assertRecord({
          ...current,
          credentialDigest: input.credentialDigest,
          createdAt: input.createdAt,
          expiresAt: input.expiresAt,
        });
        const next = records.slice();
        next[index] = {
          ...current,
          credentialDigest: input.credentialDigest,
          createdAt: input.createdAt,
          expiresAt: input.expiresAt,
        };
        await persist(next);
        return true;
      }),
    revoke: (consumerId, revokedAt = new Date().toISOString()) =>
      withMutation(async () => {
        const records = await load();
        let changed = false;
        const next = records.map((record) => {
          if (record.consumerId !== consumerId || record.revokedAt) return record;
          changed = true;
          return Object.assign({}, record, { revokedAt });
        });
        if (changed) await persist(next);
        return changed;
      }),
  };
};

export const createTomniGatewayModelConsumerRegistry = (input: {
  vault: ModelConsumerVault;
  now?: () => number;
  newId?: () => string;
  newCredential?: () => string;
  /** Main-owned active account identity; caller payloads never supply it. */
  actorId: () => string;
}): TomniGatewayModelConsumerRegistry => {
  const now = input.now ?? Date.now;
  const newId = input.newId ?? (() => `model-consumer-${randomBytes(12).toString('hex')}`);
  const newCredential = input.newCredential ?? (() => randomBytes(CREDENTIAL_BYTES).toString('base64url'));
  const active = (record: TomniGatewayModelConsumerRecord, at: number): boolean =>
    !record.revokedAt && record.actorId === input.actorId() && Date.parse(record.expiresAt) > at;
  return {
    issue: async ({ label, allowedModels, ttlMs }) => {
      const actorId = input.actorId();
      if (
        !bounded(actorId, 160) ||
        !bounded(label, 200) ||
        allowedModels.length === 0 ||
        allowedModels.some((model) => !bounded(model, 200)) ||
        !Number.isSafeInteger(ttlMs) ||
        ttlMs < 1 ||
        ttlMs > 365 * 24 * 60 * 60 * 1_000
      ) {
        throw new Error('MODEL_CONSUMER_INVALID_ISSUE');
      }
      const credential = newCredential();
      const consumerId = newId();
      const created = new Date(now()).toISOString();
      const expiresAt = new Date(now() + ttlMs).toISOString();
      await input.vault.save({
        schemaVersion: 1,
        consumerId,
        actorId,
        label,
        credentialDigest: digestText(credential),
        allowedModels: [...new Set(allowedModels)],
        createdAt: created,
        expiresAt,
      });
      return { consumerId, credential, expiresAt };
    },
    resolveCredential: async (credential) => {
      if (!bounded(credential, 512)) return undefined;
      const candidate = digestText(credential);
      const at = now();
      const record = (await input.vault.list()).find(
        (item) => active(item, at) && sameDigest(item.credentialDigest, candidate)
      );
      return record ? { consumerId: record.consumerId, allowedModels: record.allowedModels } : undefined;
    },
    getConsumer: async (consumerId) => {
      if (!bounded(consumerId, 160)) return undefined;
      const record = (await input.vault.list()).find((item) => item.consumerId === consumerId && active(item, now()));
      return record ? { consumerId: record.consumerId, allowedModels: record.allowedModels } : undefined;
    },
    list: async () => {
      const actorId = input.actorId();
      return (await input.vault.list())
        .filter((record) => record.actorId === actorId)

        .map(({ consumerId, label, allowedModels, createdAt, expiresAt, revokedAt }) =>
          Object.assign({ consumerId, label, allowedModels, createdAt, expiresAt }, revokedAt ? { revokedAt } : {})
        );
    },
    rotate: async ({ consumerId, ttlMs }) => {
      if (!bounded(consumerId, 160) || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 365 * 24 * 60 * 60 * 1_000)
        return undefined;
      const actorId = input.actorId();
      const credential = newCredential();
      const createdAt = new Date(now()).toISOString();
      const expiresAt = new Date(now() + ttlMs).toISOString();
      const rotated = await input.vault.rotate({
        consumerId,
        actorId,
        credentialDigest: digestText(credential),
        createdAt,
        expiresAt,
        now: now(),
      });
      if (!rotated) return undefined;
      return { consumerId, credential, expiresAt };
    },
    revoke: async (consumerId) => {
      if (!bounded(consumerId, 160)) return false;
      const record = (await input.vault.list()).find(
        (item) => item.consumerId === consumerId && item.actorId === input.actorId()
      );
      return record ? input.vault.revoke(consumerId) : false;
    },
  };
};
