/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'fs';
import path from 'path';
import { ensureDirectory, getDataPath } from '@process/utils';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import { runMigrations } from '@process/services/database/migrations';
import {
  CURRENT_DB_VERSION,
  getDatabaseVersion,
  initSchema,
  setDatabaseVersion,
} from '@process/services/database/schema';

const DEFAULT_USER_ID = 'system_default_user';
const DEFAULT_PASSWORD_PLACEHOLDER = '';

/**
 * The Rust backend writes to aionui-backend.db. Before that backend existed,
 * Electron owned aionui.db. These names are compatibility identifiers and must
 * not be renamed as part of product branding.
 */
export const LEGACY_DATABASE_FILENAMES = ['aionui-backend.db', 'aionui.db'] as const;

export type LegacyDatabaseMigrationResult = {
  dbPath: string;
  fromVersion: number | null;
  toVersion: number;
  migrated: boolean;
  skipped: boolean;
};

/**
 * Discover history catalogs in priority order. The direct data directory is
 * the production layout. The nested aionui directory covers older launchers
 * that passed the Electron userData root instead of getDataPath().
 */
export function discoverLegacyDatabasePaths(dataDir = getDataPath()): string[] {
  const directories = [path.resolve(dataDir), path.resolve(dataDir, 'aionui')];
  const candidates = LEGACY_DATABASE_FILENAMES.flatMap((filename) =>
    directories.map((directory) => path.join(directory, filename))
  );
  return [...new Set(candidates)].filter((candidate) => existsSync(candidate));
}

/** Resolve the authoritative catalog, falling back to the Electron filename. */
export function resolveLegacyDatabasePath(dataDir = getDataPath()): string {
  return discoverLegacyDatabasePaths(dataDir)[0] ?? path.join(dataDir, 'aionui.db');
}

function ensureSystemUser(db: ISqliteDriver): void {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username, email, password_hash, avatar_path, created_at, updated_at, last_login, jwt_secret)
     VALUES (?, ?, NULL, ?, NULL, ?, ?, NULL, NULL)`
  ).run(DEFAULT_USER_ID, DEFAULT_USER_ID, DEFAULT_PASSWORD_PLACEHOLDER, now, now);
}

/**
 * Upgrade an existing compatible SQLite catalog to the v26 baseline before
 * a backend that needs that baseline starts. The chosen path is never copied
 * over another database and the driver is always closed.
 */
export async function runLegacyDatabaseMigrations(
  dbPath = resolveLegacyDatabasePath()
): Promise<LegacyDatabaseMigrationResult> {
  if (!existsSync(dbPath)) {
    return {
      dbPath,
      fromVersion: null,
      toVersion: CURRENT_DB_VERSION,
      migrated: false,
      skipped: true,
    };
  }

  ensureDirectory(path.dirname(dbPath));

  const { BetterSqlite3Driver } = await import('@process/services/database/drivers/BetterSqlite3Driver');
  const driver = new BetterSqlite3Driver(dbPath);

  try {
    initSchema(driver);
    const currentVersion = getDatabaseVersion(driver);

    if (currentVersion < CURRENT_DB_VERSION) {
      runMigrations(driver, currentVersion, CURRENT_DB_VERSION);
      setDatabaseVersion(driver, CURRENT_DB_VERSION);
    }

    ensureSystemUser(driver);

    return {
      dbPath,
      fromVersion: currentVersion,
      toVersion: CURRENT_DB_VERSION,
      migrated: currentVersion < CURRENT_DB_VERSION,
      skipped: false,
    };
  } finally {
    driver.close();
  }
}
