/**
 * Repository-scoped Secret Context vault.
 *
 * Values are encrypted with Electron safeStorage, kept in app data (never the
 * repository), and are intentionally absent from every renderer/MCP response.
 */
import { app, safeStorage } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SecretRecoverySnapshot } from '@process/agentRuntime/secretVault';

const VAULT_FILE = 'ide-repo-secret-context.json';
const VAULT_VERSION = 2;
const ALIAS = /^[A-Z][A-Z0-9_]{0,79}$/;
const COMBO_KEY = /^[A-Z][A-Z0-9_]{0,47}$/;
const COMBO_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const SECRET_MARKER = /\{\{secret:([A-Z][A-Z0-9_]{0,79})\}\}/gi;

export type RepoSecretContext = {
  alias: string;
  description: string;
  comboId?: string;
  comboLabel?: string;
  comboKey?: string;
  status: 'set' | 'needs_value';
  updatedAt: number;
};

export type RepoSecretComboKey = {
  key: string;
  alias: string;
  status: 'set' | 'needs_value';
  updatedAt: number;
};

export type RepoSecretCombo = {
  comboId: string;
  comboLabel: string;
  description: string;
  keys: RepoSecretComboKey[];
  updatedAt: number;
};

/** Metadata-only summary used by the local UI to explain repository scoping. */
export type RepoSecretScopeSummary = {
  repository: string;
  secretCount: number;
  comboCount: number;
  updatedAt: number;
};

export type RepoSecretComboInput = {
  comboId: string;
  comboLabel: string;
  description: string;
  keys: { key: string; value?: string }[];
};

/** Result returned only to the local renderer after explicit marker rendering. */
export type RepoSecretMarkerRender = {
  text: string;
  resolvedAliases: string[];
};

type StoredSecretContext = {
  repository: string;
  alias: string;
  description: string;
  comboId?: string;
  comboKey?: string;
  updatedAt: number;
  encryptedValue?: string;
  osEncrypted?: boolean;
};

type StoredRepoSecretCombo = {
  repository: string;
  comboId: string;
  comboLabel: string;
  description: string;
  keys: string[];
  updatedAt: number;
};

type RepoSecretVault = {
  version: typeof VAULT_VERSION;
  entries: StoredSecretContext[];
  combos: StoredRepoSecretCombo[];
};

type RepoSecretStore = {
  list(repository: string): Promise<RepoSecretContext[]>;
  listCombos(repository: string): Promise<RepoSecretCombo[]>;
  listScopes(): Promise<RepoSecretScopeSummary[]>;
  /** Main-process only. Plaintext candidates are consumed immediately by Core recovery and never cross IPC. */
  listCoreRecoveryCandidates(): Promise<SecretRecoverySnapshot>;
  declare(repository: string, alias: string, description: string): Promise<RepoSecretContext>;
  save(repository: string, alias: string, description: string, value: string): Promise<RepoSecretContext>;
  saveCombo(repository: string, input: RepoSecretComboInput): Promise<RepoSecretCombo>;
  remove(repository: string, alias: string): Promise<void>;
  removeCombo(repository: string, comboId: string): Promise<void>;
  /**
   * Returns a value only to the local, trusted renderer after an explicit
   * user reveal action. This method is never wired into MCP or agent tools.
   */
  reveal(repository: string, alias: string): Promise<string>;
  /** Replaces only {{secret:ALIAS}} for a renderer explicitly requesting it. */
  renderMarkers(repository: string, text: string): Promise<RepoSecretMarkerRender>;
  /** Main-process only: inject selected aliases or whole combos into a child process environment. */
  resolveEnvironment(repository: string, aliases: string[], comboIds?: string[]): Promise<Record<string, string>>;
  /** Remove every resolved value from a tool result before it reaches the model. */
  redact(text: string, values: Record<string, string>): string;
};

export type RepoSecretFs = {
  readFile(path: string, encoding: 'utf-8'): Promise<string>;
  writeFile(path: string, data: string, options: { encoding: 'utf-8'; mode: number }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
};

export type RepoSecretCrypto = {
  isAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
};

const normalizeRepository = (repository: string): string => path.resolve(repository.trim()).toLowerCase();

const normalizeAlias = (alias: string): string => {
  const normalized = alias
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[0-9]/.test(normalized) ? 'SECRET_' + normalized : normalized;
};

const comboAlias = (comboLabel: string, comboId: string, key: string): string => {
  const normalizedLabel = normalizeAlias(comboLabel);
  const normalizedId = normalizeAlias(comboId).slice(0, 32);
  const prefix = normalizedLabel || 'COMBO_' + (normalizedId || 'SECRET');
  const suffix = '_' + key;
  return prefix.slice(0, Math.max(1, 80 - suffix.length)) + suffix;
};

const defaultFs: RepoSecretFs = {
  readFile: (filePath, encoding) => fs.promises.readFile(filePath, encoding),
  writeFile: (filePath, data, options) => fs.promises.writeFile(filePath, data, options),
  rename: (from, to) => fs.promises.rename(from, to),
  mkdir: (directory, options) => fs.promises.mkdir(directory, options),
};

const defaultCrypto: RepoSecretCrypto = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
  decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const stringValue = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const parseEntry = (value: unknown): { entry: StoredSecretContext; legacyComboLabel?: string } | null => {
  const item = asRecord(value);
  if (!item) return null;
  const repository = stringValue(item.repository);
  const alias = stringValue(item.alias);
  const description = stringValue(item.description);
  const updatedAt = item.updatedAt;
  if (!repository || !alias || !description || typeof updatedAt !== 'number') return null;

  const legacyCombo = asRecord(item.combo);
  const comboId = stringValue(item.comboId) ?? stringValue(legacyCombo?.id);
  const legacyComboLabel = stringValue(item.comboLabel) ?? stringValue(legacyCombo?.label);
  const comboKey = stringValue(item.comboKey);
  return {
    entry: {
      repository,
      alias,
      description,
      ...(comboId ? { comboId } : {}),
      ...(comboKey ? { comboKey } : {}),
      updatedAt,
      ...(typeof item.encryptedValue === 'string' ? { encryptedValue: item.encryptedValue } : {}),
      ...(typeof item.osEncrypted === 'boolean' ? { osEncrypted: item.osEncrypted } : {}),
    },
    ...(legacyComboLabel ? { legacyComboLabel } : {}),
  };
};

const parseCombo = (value: unknown): StoredRepoSecretCombo | null => {
  const item = asRecord(value);
  if (!item) return null;
  const repository = stringValue(item.repository);
  const comboId = stringValue(item.comboId);
  const comboLabel = stringValue(item.comboLabel);
  const description = stringValue(item.description);
  const updatedAt = item.updatedAt;
  if (!repository || !comboId || !comboLabel || !description || typeof updatedAt !== 'number') return null;
  const keys = Array.isArray(item.keys) ? item.keys.filter((key): key is string => typeof key === 'string') : [];
  return { repository, comboId, comboLabel, description, keys, updatedAt };
};

const deriveLegacyComboKey = (alias: string, label: string): string => {
  const prefix = normalizeAlias(label);
  if (prefix && alias.startsWith(prefix + '_')) return alias.slice(prefix.length + 1);
  return alias;
};

const parseVault = (raw: unknown): RepoSecretVault => {
  const record = asRecord(raw);
  const rawEntries = Array.isArray(raw) ? raw : Array.isArray(record?.entries) ? record.entries : [];
  const parsedEntries = rawEntries.map(parseEntry).filter((item): item is NonNullable<typeof item> => item !== null);
  const combos = (Array.isArray(record?.combos) ? record.combos : [])
    .map(parseCombo)
    .filter((combo): combo is StoredRepoSecretCombo => combo !== null);

  const comboMap = new Map(combos.map((combo) => [combo.repository + '\0' + combo.comboId, combo]));
  const entries = parsedEntries.map(({ entry, legacyComboLabel }) => {
    if (!entry.comboId) return entry;
    const mapKey = entry.repository + '\0' + entry.comboId;
    const existing = comboMap.get(mapKey);
    const label = existing?.comboLabel ?? legacyComboLabel ?? entry.comboId;
    const key = entry.comboKey ?? deriveLegacyComboKey(entry.alias, label);
    if (existing) {
      if (!existing.keys.includes(key)) existing.keys.push(key);
      return { ...entry, comboKey: key };
    }
    comboMap.set(mapKey, {
      repository: entry.repository,
      comboId: entry.comboId,
      comboLabel: label,
      description: entry.description,
      keys: [key],
      updatedAt: entry.updatedAt,
    });
    return { ...entry, comboKey: key };
  });

  return { version: VAULT_VERSION, entries, combos: Array.from(comboMap.values()) };
};

export const createRepoSecretStore = (options?: {
  dir?: string;
  now?: () => number;
  fs?: RepoSecretFs;
  crypto?: RepoSecretCrypto;
}): RepoSecretStore => {
  const dir = options?.dir ?? app.getPath('userData');
  const now = options?.now ?? Date.now;
  const fsImpl = options?.fs ?? defaultFs;
  const crypto = options?.crypto ?? defaultCrypto;
  const filePath = path.join(dir, VAULT_FILE);
  let cache: RepoSecretVault | null = null;
  let sourceStatus: SecretRecoverySnapshot['status'] = 'missing';
  let mutationQueue = Promise.resolve();

  const exclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = mutationQueue;
    let release = (): void => undefined;
    mutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  const load = async (): Promise<RepoSecretVault> => {
    if (cache) return cache;
    try {
      cache = parseVault(JSON.parse(await fsImpl.readFile(filePath, 'utf-8')) as unknown);
      sourceStatus = 'available';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[RepoSecretStore] read failed:', error);
        throw new Error('Repository Secret Context could not be read safely.', { cause: error });
      }
      cache = { version: VAULT_VERSION, entries: [], combos: [] };
      sourceStatus = 'missing';
    }
    return cache;
  };

  const persist = async (next: RepoSecretVault): Promise<void> => {
    await fsImpl.mkdir(dir, { recursive: true });
    const temporary = filePath + '.tmp';
    await fsImpl.writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
    await fsImpl.rename(temporary, filePath);
    cache = next;
    sourceStatus = 'available';
  };

  const comboForEntry = (vault: RepoSecretVault, entry: StoredSecretContext): StoredRepoSecretCombo | undefined =>
    entry.comboId
      ? vault.combos.find((combo) => combo.repository === entry.repository && combo.comboId === entry.comboId)
      : undefined;

  const metadata = (vault: RepoSecretVault, entry: StoredSecretContext): RepoSecretContext => {
    const combo = comboForEntry(vault, entry);
    return {
      alias: entry.alias,
      description: entry.description,
      ...(combo ? { comboId: combo.comboId, comboLabel: combo.comboLabel, comboKey: entry.comboKey } : {}),
      status: entry.encryptedValue ? 'set' : 'needs_value',
      updatedAt: entry.updatedAt,
    };
  };

  const comboMetadata = (vault: RepoSecretVault, combo: StoredRepoSecretCombo): RepoSecretCombo => {
    const comboEntries = vault.entries.filter(
      (entry) => entry.repository === combo.repository && entry.comboId === combo.comboId
    );
    return {
      comboId: combo.comboId,
      comboLabel: combo.comboLabel,
      description: combo.description,
      keys: combo.keys.flatMap((key) => {
        const entry = comboEntries.find((candidate) => candidate.comboKey === key);
        return entry
          ? [
              {
                key,
                alias: entry.alias,
                status: entry.encryptedValue ? ('set' as const) : ('needs_value' as const),
                updatedAt: entry.updatedAt,
              },
            ]
          : [];
      }),
      updatedAt: combo.updatedAt,
    };
  };

  const validate = (
    repository: string,
    alias: string,
    description: string
  ): { repository: string; alias: string; description: string } => {
    const normalizedRepository = normalizeRepository(repository);
    const normalizedAlias = normalizeAlias(alias);
    const normalizedDescription = description.trim().slice(0, 240);
    if (!repository.trim()) throw new Error('A repository is required.');
    if (!ALIAS.test(normalizedAlias)) throw new Error('Alias must use uppercase letters, numbers, and underscores.');
    if (!normalizedDescription) throw new Error('A purpose is required.');
    return { repository: normalizedRepository, alias: normalizedAlias, description: normalizedDescription };
  };

  const validateCombo = (
    repository: string,
    input: RepoSecretComboInput
  ): {
    repository: string;
    comboId: string;
    comboLabel: string;
    description: string;
    keys: RepoSecretComboInput['keys'];
  } => {
    const normalizedRepository = normalizeRepository(repository);
    const comboId = input.comboId.trim();
    const comboLabel = input.comboLabel.trim().slice(0, 80);
    const description = input.description.trim().slice(0, 240);
    const keys = input.keys.map(({ key, value }) => ({
      key: normalizeAlias(key),
      ...(value ? { value } : {}),
    }));
    if (!repository.trim()) throw new Error('A repository is required.');
    if (!COMBO_ID.test(comboId)) throw new Error('A valid Combo ID is required.');
    if (!comboLabel) throw new Error('A Combo label is required.');
    if (!description) throw new Error('A Combo purpose is required.');
    if (keys.length === 0) throw new Error('A Combo must contain at least one key.');
    if (keys.some(({ key }) => !COMBO_KEY.test(key))) {
      throw new Error('Combo keys must use uppercase letters, numbers, and underscores.');
    }
    if (new Set(keys.map(({ key }) => key)).size !== keys.length) throw new Error('Combo keys must be unique.');
    return { repository: normalizedRepository, comboId, comboLabel, description, keys };
  };

  const update = async (
    repository: string,
    alias: string,
    description: string,
    value?: string
  ): Promise<RepoSecretContext> =>
    exclusive(async () => {
      const input = validate(repository, alias, description);
      const vault = await load();
      const existing = vault.entries.find(
        (entry) => entry.repository === input.repository && entry.alias === input.alias
      );
      if (existing?.comboId) throw new Error('Secret Context alias ' + input.alias + ' belongs to a Combo.');
      if (value !== undefined && !crypto.isAvailable()) {
        throw new Error('System keychain is unavailable; Secret Context cannot store values securely.');
      }
      const sealed = value === undefined ? undefined : { encryptedValue: crypto.encrypt(value), osEncrypted: true };
      const next: StoredSecretContext = {
        repository: input.repository,
        alias: input.alias,
        description: input.description,
        updatedAt: now(),
        encryptedValue: sealed?.encryptedValue ?? existing?.encryptedValue,
        osEncrypted: sealed?.osEncrypted ?? existing?.osEncrypted,
      };
      const nextVault = {
        ...vault,
        entries: [
          ...vault.entries.filter((entry) => entry.repository !== input.repository || entry.alias !== input.alias),
          next,
        ],
      };
      await persist(nextVault);
      return metadata(nextVault, next);
    });

  return {
    async list(repository) {
      const root = normalizeRepository(repository);
      const vault = await load();
      return vault.entries
        .filter((entry) => entry.repository === root)
        .map((entry) => metadata(vault, entry))
        .sort((left, right) => left.alias.localeCompare(right.alias));
    },
    async listCombos(repository) {
      const root = normalizeRepository(repository);
      const vault = await load();
      return vault.combos
        .filter((combo) => combo.repository === root)
        .map((combo) => comboMetadata(vault, combo))
        .sort((left, right) => left.comboLabel.localeCompare(right.comboLabel));
    },
    async listScopes() {
      const vault = await load();
      const repositories = new Set([
        ...vault.entries.map((entry) => entry.repository),
        ...vault.combos.map((combo) => combo.repository),
      ]);
      return [...repositories]
        .map((repository): RepoSecretScopeSummary => {
          const entries = vault.entries.filter((entry) => entry.repository === repository);
          const combos = vault.combos.filter((combo) => combo.repository === repository);
          return {
            repository,
            secretCount: entries.length,
            comboCount: combos.length,
            updatedAt: Math.max(
              0,
              ...entries.map((entry) => entry.updatedAt),
              ...combos.map((combo) => combo.updatedAt)
            ),
          };
        })
        .sort((left, right) => right.updatedAt - left.updatedAt || left.repository.localeCompare(right.repository));
    },
    async listCoreRecoveryCandidates() {
      const vault = await load();
      if (sourceStatus === 'missing') return { status: 'missing', candidates: [], skipped: 0 };

      const candidates: SecretRecoverySnapshot['candidates'] = [];
      const groupedAliases = new Set<string>();
      let skipped = 0;
      const readValue = (entry: StoredSecretContext): string | undefined => {
        if (!entry.encryptedValue || !entry.osEncrypted) {
          skipped += 1;
          return undefined;
        }
        try {
          const value = crypto.decrypt(entry.encryptedValue);
          if (!value) {
            skipped += 1;
            return undefined;
          }
          return value;
        } catch {
          skipped += 1;
          return undefined;
        }
      };

      for (const combo of vault.combos) {
        const fields: string[] = [];
        const payload: Record<string, string> = {};
        for (const rawKey of combo.keys) {
          const entry = vault.entries.find(
            (candidate) =>
              candidate.repository === combo.repository &&
              candidate.comboId === combo.comboId &&
              candidate.comboKey === rawKey
          );
          if (!entry) {
            skipped += 1;
            continue;
          }
          groupedAliases.add(`${entry.repository}\0${entry.alias}`);
          const field = normalizeAlias(rawKey);
          const value = readValue(entry);
          if (!ALIAS.test(field) || payload[field] !== undefined || value === undefined) {
            if (value !== undefined) skipped += 1;
            continue;
          }
          fields.push(field);
          payload[field] = value;
        }
        if (fields.length > 0) {
          candidates.push({
            sourceId: `repo-secret-context\0${combo.repository}\0combo\0${combo.comboId}`,
            input: {
              label: combo.comboLabel,
              note: combo.description,
              kind: 'credential',
              fields,
              binding: { surfaces: ['secret-firewall'], purposes: ['opaque-use'] },
            },
            payload,
          });
        }
      }

      for (const entry of vault.entries) {
        if (groupedAliases.has(`${entry.repository}\0${entry.alias}`)) continue;
        const field = normalizeAlias(entry.alias);
        const value = readValue(entry);
        if (!ALIAS.test(field) || value === undefined) {
          if (value !== undefined) skipped += 1;
          continue;
        }
        candidates.push({
          sourceId: `repo-secret-context\0${entry.repository}\0entry\0${entry.alias}`,
          input: {
            label: entry.alias,
            note: entry.description,
            kind: 'credential',
            fields: [field],
            binding: { surfaces: ['secret-firewall'], purposes: ['opaque-use'] },
          },
          payload: { [field]: value },
        });
      }
      return { status: 'available', candidates, skipped };
    },
    declare: (repository, alias, description) => update(repository, alias, description),
    save: (repository, alias, description, value) => {
      if (!value.trim()) throw new Error('A secret value is required.');
      return update(repository, alias, description, value);
    },
    async saveCombo(repository, input) {
      return exclusive(async () => {
        const validated = validateCombo(repository, input);
        const vault = await load();
        const existingEntries = vault.entries.filter(
          (entry) => entry.repository === validated.repository && entry.comboId === validated.comboId
        );
        const hasNewValues = validated.keys.some(({ value }) => value !== undefined && value.trim().length > 0);
        if (hasNewValues && !crypto.isAvailable()) {
          throw new Error('System keychain is unavailable; Secret Context cannot store values securely.');
        }

        const timestamp = now();
        const nextEntries = validated.keys.map(({ key, value }): StoredSecretContext => {
          const existing = existingEntries.find((entry) => entry.comboKey === key);
          const alias = existing?.alias ?? comboAlias(validated.comboLabel, validated.comboId, key);
          const collision = vault.entries.find(
            (entry) =>
              entry.repository === validated.repository && entry.alias === alias && entry.comboId !== validated.comboId
          );
          if (collision) throw new Error('Secret Context alias ' + alias + ' is already in use.');
          const sealedValue = value?.trim() ? crypto.encrypt(value) : existing?.encryptedValue;
          return {
            repository: validated.repository,
            alias,
            description: validated.description,
            comboId: validated.comboId,
            comboKey: key,
            updatedAt: timestamp,
            ...(sealedValue ? { encryptedValue: sealedValue, osEncrypted: true } : {}),
          };
        });
        const nextCombo: StoredRepoSecretCombo = {
          repository: validated.repository,
          comboId: validated.comboId,
          comboLabel: validated.comboLabel,
          description: validated.description,
          keys: validated.keys.map(({ key }) => key),
          updatedAt: timestamp,
        };
        const nextVault: RepoSecretVault = {
          version: VAULT_VERSION,
          entries: [
            ...vault.entries.filter(
              (entry) => entry.repository !== validated.repository || entry.comboId !== validated.comboId
            ),
            ...nextEntries,
          ],
          combos: [
            ...vault.combos.filter(
              (combo) => combo.repository !== validated.repository || combo.comboId !== validated.comboId
            ),
            nextCombo,
          ],
        };
        await persist(nextVault);
        return comboMetadata(nextVault, nextCombo);
      });
    },
    async remove(repository, alias) {
      await exclusive(async () => {
        const root = normalizeRepository(repository);
        const key = normalizeAlias(alias);
        const vault = await load();
        const target = vault.entries.find((entry) => entry.repository === root && entry.alias === key);
        const nextCombos = target?.comboId
          ? vault.combos.flatMap((combo) => {
              if (combo.repository !== root || combo.comboId !== target.comboId) return [combo];
              const keys = combo.keys.filter((comboKey) => comboKey !== target.comboKey);
              return keys.length > 0 ? [{ ...combo, keys, updatedAt: now() }] : [];
            })
          : vault.combos;
        await persist({
          ...vault,
          entries: vault.entries.filter((entry) => entry.repository !== root || entry.alias !== key),
          combos: nextCombos,
        });
      });
    },
    async removeCombo(repository, comboId) {
      await exclusive(async () => {
        const root = normalizeRepository(repository);
        const id = comboId.trim();
        const vault = await load();
        await persist({
          ...vault,
          entries: vault.entries.filter((entry) => entry.repository !== root || entry.comboId !== id),
          combos: vault.combos.filter((combo) => combo.repository !== root || combo.comboId !== id),
        });
      });
    },
    async reveal(repository, alias) {
      const root = normalizeRepository(repository);
      const key = normalizeAlias(alias);
      const entry = (await load()).entries.find(
        (candidate) => candidate.repository === root && candidate.alias === key
      );
      if (!entry?.encryptedValue) throw new Error('Secret Context alias ' + key + ' has no stored value.');
      if (!entry.osEncrypted) {
        throw new Error('Secret Context alias ' + key + ' is not protected by the system keychain.');
      }
      try {
        return crypto.decrypt(entry.encryptedValue);
      } catch {
        throw new Error('Secret Context alias ' + key + ' could not be decrypted on this system.');
      }
    },
    async renderMarkers(repository, text) {
      const root = normalizeRepository(repository);
      const aliases = Array.from(
        new Set(Array.from(text.matchAll(SECRET_MARKER), (match) => normalizeAlias(match[1])))
      );
      if (aliases.length === 0) return { text, resolvedAliases: [] };

      const values = new Map(
        await Promise.all(aliases.map(async (alias) => [alias, await this.reveal(root, alias)] as const))
      );
      return {
        text: text.replace(SECRET_MARKER, (marker, rawAlias: string) => values.get(normalizeAlias(rawAlias)) ?? marker),
        resolvedAliases: aliases,
      };
    },
    async resolveEnvironment(repository, aliases, comboIds = []) {
      const root = normalizeRepository(repository);
      const vault = await load();
      const requested = new Set(aliases.map(normalizeAlias));
      for (const comboId of new Set(comboIds.map((id) => id.trim()).filter(Boolean))) {
        const combo = vault.combos.find((candidate) => candidate.repository === root && candidate.comboId === comboId);
        if (!combo) throw new Error('Secret Context Combo ' + comboId + ' does not exist.');
        for (const entry of vault.entries) {
          if (entry.repository === root && entry.comboId === comboId) requested.add(entry.alias);
        }
      }
      const values = await Promise.all(
        [...requested].map(async (alias) => [alias, await this.reveal(root, alias)] as const)
      );
      return Object.fromEntries(values);
    },
    redact(text, values) {
      return Object.values(values).reduce(
        (safe, value) => (value.length > 0 ? safe.split(value).join('[REDACTED]') : safe),
        text
      );
    },
  };
};

let store: RepoSecretStore | null = null;

export const getRepoSecretStore = (): RepoSecretStore => {
  store ??= createRepoSecretStore();
  return store;
};
