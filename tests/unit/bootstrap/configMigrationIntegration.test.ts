/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDriver = {
  prepare: vi.fn(() => ({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(),
  })),
  close: vi.fn(),
  exec: vi.fn(),
};

vi.mock('@process/services/database/drivers/BetterSqlite3Driver', () => ({
  BetterSqlite3Driver: class {
    constructor() {
      return mockDriver;
    }
  },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('@process/utils', () => ({
  ensureDirectory: vi.fn(),
  getDataPath: () => '/data',
}));

vi.mock('@process/services/database/schema', () => ({
  CURRENT_DB_VERSION: 26,
  getDatabaseVersion: vi.fn(() => 20),
  initSchema: vi.fn(),
  setDatabaseVersion: vi.fn(),
}));

vi.mock('@process/services/database/migrations', () => ({
  runMigrations: vi.fn(),
}));

import { existsSync } from 'fs';
import {
  discoverLegacyDatabasePaths,
  runLegacyDatabaseMigrations,
} from '@process/services/database/runLegacyDatabaseMigrations';
import { getDatabaseVersion, setDatabaseVersion } from '@process/services/database/schema';
import { runMigrations } from '@process/services/database/migrations';

describe('configMigrationIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (existsSync as any).mockReturnValue(true);
    (getDatabaseVersion as any).mockReturnValue(20);
  });

  it('discovers the active backend catalog before the Electron legacy catalog', () => {
    const dataDir = path.resolve('/data');
    const backend = path.join(dataDir, 'aionui-backend.db');
    const electronLegacy = path.join(dataDir, 'aionui.db');
    (existsSync as any).mockImplementation((candidate: string) => [backend, electronLegacy].includes(candidate));

    expect(discoverLegacyDatabasePaths(dataDir)).toEqual([backend, electronLegacy]);
  });

  it('discovers the historical nested data directory without inventing a database', () => {
    const dataDir = path.resolve('/data');
    const nestedLegacy = path.join(dataDir, 'aionui', 'aionui.db');
    (existsSync as any).mockImplementation((candidate: string) => candidate === nestedLegacy);

    expect(discoverLegacyDatabasePaths(dataDir)).toEqual([nestedLegacy]);
  });

  it('runs migrations when database version is outdated', async () => {
    const result = await runLegacyDatabaseMigrations('/test/aionui.db');

    expect(result.migrated).toBe(true);
    expect(result.fromVersion).toBe(20);
    expect(result.toVersion).toBe(26);
    expect(runMigrations).toHaveBeenCalledWith(mockDriver, 20, 26);
    expect(setDatabaseVersion).toHaveBeenCalledWith(mockDriver, 26);
  });

  it('skips migrations when database does not exist', async () => {
    (existsSync as any).mockReturnValue(false);

    const result = await runLegacyDatabaseMigrations('/test/aionui.db');

    expect(result.skipped).toBe(true);
    expect(result.migrated).toBe(false);
    expect(runMigrations).not.toHaveBeenCalled();
  });

  it('closes driver after migration completes', async () => {
    await runLegacyDatabaseMigrations('/test/aionui.db');

    expect(mockDriver.close).toHaveBeenCalled();
  });

  it('ensures system user exists after migration', async () => {
    await runLegacyDatabaseMigrations('/test/aionui.db');

    expect(mockDriver.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE INTO users'));
  });

  it('closes driver even if migration throws', async () => {
    (runMigrations as any).mockImplementation(() => {
      throw new Error('Migration failed');
    });

    await expect(runLegacyDatabaseMigrations('/test/aionui.db')).rejects.toThrow('Migration failed');
    expect(mockDriver.close).toHaveBeenCalled();
  });
});
