/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_QUARANTINED_FILES = 8;

export type CatalogRevisionMarker = {
  schemaVersion: 1;
  revision: number;
  digest: string;
  committedAt: string;
};

export const canonicalizeCatalogValue = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeCatalogValue).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeCatalogValue(entry)}`)
    .join(',')}}`;
};

export const catalogDigest = (value: unknown): string =>
  `sha256-${createHash('sha256').update(canonicalizeCatalogValue(value)).digest('hex')}`;

export const parseCatalogRevisionMarker = (value: unknown): CatalogRevisionMarker => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Catalog revision marker must be an object.');
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !== 1 ||
    typeof raw.revision !== 'number' ||
    !Number.isSafeInteger(raw.revision) ||
    raw.revision < 1 ||
    typeof raw.digest !== 'string' ||
    !/^sha256-[a-f0-9]{64}$/.test(raw.digest) ||
    typeof raw.committedAt !== 'string' ||
    !Number.isFinite(Date.parse(raw.committedAt))
  ) {
    throw new Error('Catalog revision marker is invalid.');
  }
  return {
    schemaVersion: 1,
    revision: raw.revision,
    digest: raw.digest,
    committedAt: raw.committedAt,
  };
};

export const readBoundedJson = async (filePath: string, maxBytes: number): Promise<unknown> => {
  const handle = await open(filePath, 'r');
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile() || fileStat.size > maxBytes) throw new Error('Catalog cache file is invalid or too large.');
    return JSON.parse(await handle.readFile('utf8')) as unknown;
  } finally {
    await handle.close();
  }
};

const syncDirectoryBestEffort = async (directory: string): Promise<void> => {
  try {
    const handle = await open(directory, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Windows does not consistently allow directory handles; file fsync still protects contents.
  }
};

export const writeJsonAtomically = async (filePath: string, value: unknown): Promise<void> => {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(temporaryPath, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600);
    await syncDirectoryBestEffort(directory);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
};

export const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};

export const quarantineCatalogFile = async (
  filePath: string,
  quarantineDirectory: string,
  now: Date
): Promise<string | undefined> => {
  if (!(await fileExists(filePath))) return undefined;
  await mkdir(quarantineDirectory, { recursive: true });
  const timestamp = now.toISOString().replaceAll(/[:.]/g, '-');
  const target = path.join(quarantineDirectory, `${path.basename(filePath)}.${timestamp}.${randomUUID()}.corrupt`);
  try {
    await rename(filePath, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const entries = await readdir(quarantineDirectory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => ({
        path: path.join(quarantineDirectory, entry.name),
        modifiedAt: (await stat(path.join(quarantineDirectory, entry.name))).mtimeMs,
      }))
  );
  for (const entry of files
    .toSorted((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(MAX_QUARANTINED_FILES)) {
    await rm(entry.path, { force: true });
  }
  return target;
};

export const createSerializedCatalogExecutor = (): (<T>(operation: () => Promise<T>) => Promise<T>) => {
  let pending: Promise<void> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation, operation);
    pending = result.then(
      (): undefined => undefined,
      (): undefined => undefined
    );
    return result;
  };
};
