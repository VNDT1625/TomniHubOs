/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import { parsePackageManifest, type InstalledPackageRecord } from '../../../common/packages';

type PersistedPackageState = {
  schemaVersion: 1;
  packages: InstalledPackageRecord[];
};

const clone = <T>(value: T): T => structuredClone(value);
const EMPTY_STATE: PersistedPackageState = { schemaVersion: 1, packages: [] };
const SAFE_PACKAGE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const SHA256_INTEGRITY = /^sha256-[a-f0-9]{64}$/;
const MAX_PACKAGE_STATE_BYTES = 8 * 1024 * 1024;
const MAX_PACKAGE_ID_LENGTH = 200;
const MAX_VERSION_LENGTH = 128;
const MAX_CORRUPT_BACKUPS = 8;
const corruptBackupPath = (filePath: string): string =>
  path.join(path.dirname(filePath), `${path.basename(filePath)}.corrupt-${Date.now()}-${randomUUID()}`);
const corruptBackupPrefix = (filePath: string): string => `${path.basename(filePath)}.corrupt-`;
const isCorruptBackupName = (filePath: string, name: string): boolean => {
  const prefix = corruptBackupPrefix(filePath);
  return name.startsWith(prefix) && /^\d+-[0-9a-f-]{36}$/u.test(name.slice(prefix.length));
};

const hasValidProvenance = (
  provenance: InstalledPackageRecord['provenance'],
  version: string | undefined,
  delivery: InstalledPackageRecord['delivery'] | undefined
): boolean => {
  if (!provenance) return true;
  const expectedSource = delivery === 'downloaded-package' ? 'store' : 'bundled';
  const validIntegrity = provenance.integrity === undefined || SHA256_INTEGRITY.test(provenance.integrity);
  return (
    provenance.source === expectedSource &&
    (provenance.scope === 'core' || provenance.scope === 'optional') &&
    provenance.version === version &&
    semver.valid(provenance.version) !== null &&
    validIntegrity &&
    (delivery !== 'downloaded-package' || provenance.integrity !== undefined)
  );
};

const parseInstalledPackageRecord = (value: unknown): InstalledPackageRecord | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Partial<InstalledPackageRecord>;
  const valid =
    typeof record.id === 'string' &&
    record.id.length <= MAX_PACKAGE_ID_LENGTH &&
    SAFE_PACKAGE_ID.test(record.id) &&
    typeof record.version === 'string' &&
    record.version.length <= MAX_VERSION_LENGTH &&
    semver.valid(record.version) !== null &&
    (!record.previousVersion ||
      (typeof record.previousVersion === 'string' &&
        record.previousVersion.length <= MAX_VERSION_LENGTH &&
        semver.valid(record.previousVersion) !== null)) &&
    (record.state === 'installed' || record.state === 'failed' || record.state === 'quarantined') &&
    (record.delivery === 'bundled-legacy' ||
      record.delivery === 'bundled-package' ||
      record.delivery === 'downloaded-package') &&
    typeof record.enabled === 'boolean' &&
    typeof record.installedAt === 'number' &&
    Number.isFinite(record.installedAt) &&
    typeof record.updatedAt === 'number' &&
    Number.isFinite(record.updatedAt) &&
    (!record.trust ||
      record.trust === 'trusted-first-party' ||
      record.trust === 'signed-first-party' ||
      record.trust === 'signed-store') &&
    (!record.previousTrust ||
      record.previousTrust === 'trusted-first-party' ||
      record.previousTrust === 'signed-first-party' ||
      record.previousTrust === 'signed-store') &&
    hasValidProvenance(record.provenance, record.version, record.delivery) &&
    hasValidProvenance(record.previousProvenance, record.previousVersion, record.delivery) &&
    (!(record.previousManifest || record.previousTrust || record.previousProvenance) ||
      record.previousVersion !== undefined);
  if (!valid) return undefined;
  try {
    const manifest = record.manifest ? parsePackageManifest(record.manifest) : undefined;
    const previousManifest = record.previousManifest ? parsePackageManifest(record.previousManifest) : undefined;
    if (manifest && (manifest.id !== record.id || manifest.version !== record.version)) return undefined;
    if (
      previousManifest &&
      (previousManifest.id !== record.id || previousManifest.version !== record.previousVersion)
    ) {
      return undefined;
    }
    if (record.provenance?.integrity && manifest?.artifact?.integrity !== record.provenance.integrity) {
      return undefined;
    }
    if (
      record.previousProvenance?.integrity &&
      previousManifest?.artifact?.integrity !== record.previousProvenance.integrity
    ) {
      return undefined;
    }
    return {
      ...(record as InstalledPackageRecord),
      ...(manifest ? { manifest } : {}),
      ...(previousManifest ? { previousManifest } : {}),
    };
  } catch {
    return undefined;
  }
};

export type PackageStateStore = {
  initialize: () => Promise<void>;
  list: () => InstalledPackageRecord[];
  get: (id: string) => InstalledPackageRecord | undefined;
  save: (record: InstalledPackageRecord) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export class JsonPackageStateStore implements PackageStateStore {
  private readonly records = new Map<string, InstalledPackageRecord>();
  private writeQueue = Promise.resolve();

  public constructor(private readonly filePath: string) {}

  public async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      if ((await stat(this.filePath)).size > MAX_PACKAGE_STATE_BYTES) {
        throw new Error('Installed package registry exceeds the size limit.');
      }
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<PersistedPackageState>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.packages)) {
        throw new Error('Unsupported installed package registry.');
      }
      const nextRecords = new Map<string, InstalledPackageRecord>();
      const duplicateIds = new Set<string>();
      let rejectedRecord = false;
      for (const record of parsed.packages) {
        const installedRecord = parseInstalledPackageRecord(record);
        if (!installedRecord) {
          rejectedRecord = true;
          continue;
        }
        if (nextRecords.has(installedRecord.id)) duplicateIds.add(installedRecord.id);
        nextRecords.set(installedRecord.id, clone(installedRecord));
      }
      for (const id of duplicateIds) nextRecords.delete(id);
      rejectedRecord ||= duplicateIds.size > 0;
      this.records.clear();
      for (const [id, record] of nextRecords) this.records.set(id, record);
      if (rejectedRecord) {
        await rename(this.filePath, corruptBackupPath(this.filePath)).catch((): undefined => undefined);
        await this.flush();
        await this.pruneCorruptBackups();
      }
    } catch (error) {
      this.records.clear();
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        await rename(this.filePath, corruptBackupPath(this.filePath)).catch((): undefined => undefined);
      }
      await this.flush(EMPTY_STATE);
      await this.pruneCorruptBackups();
    }
  }

  public list(): InstalledPackageRecord[] {
    return [...this.records.values()].map(clone).toSorted((left, right) => left.id.localeCompare(right.id));
  }

  public get(id: string): InstalledPackageRecord | undefined {
    const record = this.records.get(id);
    return record ? clone(record) : undefined;
  }

  public async save(record: InstalledPackageRecord): Promise<void> {
    const previous = this.records.get(record.id);
    this.records.set(record.id, clone(record));
    try {
      await this.flush();
    } catch (error) {
      if (previous) this.records.set(record.id, previous);
      else this.records.delete(record.id);
      throw error;
    }
  }

  public async remove(id: string): Promise<void> {
    const previous = this.records.get(id);
    this.records.delete(id);
    try {
      await this.flush();
    } catch (error) {
      if (previous) this.records.set(id, previous);
      throw error;
    }
  }

  private async flush(initial?: PersistedPackageState): Promise<void> {
    this.writeQueue = this.writeQueue
      .catch((): undefined => undefined)
      .then(async () => {
        const state = initial ?? { schemaVersion: 1 as const, packages: this.list() };
        const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporaryPath, JSON.stringify(state, null, 2) + String.fromCharCode(10), {
            encoding: 'utf8',
            mode: 0o600,
          });
          await rename(temporaryPath, this.filePath);
        } catch (error) {
          await rm(temporaryPath, { force: true }).catch((): undefined => undefined);
          throw error;
        }
      });

    await this.writeQueue;
  }

  private async pruneCorruptBackups(): Promise<void> {
    try {
      const backups = (await readdir(path.dirname(this.filePath), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && isCorruptBackupName(this.filePath, entry.name))
        .map((entry) => entry.name)
        .toSorted();
      const expiredBackups = backups.slice(0, Math.max(0, backups.length - MAX_CORRUPT_BACKUPS));
      await Promise.all(
        expiredBackups.map((name) => rm(path.join(path.dirname(this.filePath), name), { force: true }))
      );
    } catch {
      // A cleanup failure must not discard the recovered registry.
    }
  }
}
