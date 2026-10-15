import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initSocialDb } from '@/process/services/social/socialDb';
import type { ISqliteDriver } from '@/process/services/database/drivers/ISqliteDriver';

function openDriver(file: string): ISqliteDriver {
  const db = new DatabaseSync(file);
  return {
    prepare: (sql) => {
      const stmt = db.prepare(sql);
      return {
        get: (...args) => stmt.get(...(args as string[])),
        all: (...args) => stmt.all(...(args as string[])),
        run: (...args) => {
          const result = stmt.run(...(args as string[]));
          return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
        },
      };
    },
    exec: (sql) => db.exec(sql),
    pragma: (sql) => db.prepare(`PRAGMA ${sql}`).get(),
    transaction:
      (fn) =>
      (...args) => {
        db.exec('BEGIN');
        try {
          const result = fn(...args);
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    close: () => db.close(),
  };
}

describe('Social SQLite schema version / migration safety', () => {
  it('backs up a legacy DB before versioning and retains account and unseen data across reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomny-social-migration-'));
    const file = join(dir, 'social.sqlite');
    try {
      const old = new DatabaseSync(file);
      old.exec(`
        CREATE TABLE social_accounts (id TEXT PRIMARY KEY, connected_at INTEGER NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE social_posts (
          id TEXT PRIMARY KEY, account_id TEXT NOT NULL, created_at INTEGER NOT NULL,
          fetched_at INTEGER NOT NULL, viewed INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL
        );
      `);
      old.prepare('INSERT INTO social_accounts VALUES (?, ?, ?)').run('old-account', 1, '{"id":"old-account"}');
      old
        .prepare('INSERT INTO social_posts VALUES (?, ?, ?, ?, ?, ?)')
        .run('unseen-1', 'old-account', 10, 10, 0, '{"id":"unseen-1","accountId":"old-account","isViewed":false}');
      old.close();

      const store = initSocialDb(file, openDriver(file));
      expect(store.getAccounts()).toEqual([{ id: 'old-account' }]);
      expect(store.getUnseenPosts()).toEqual([{ id: 'unseen-1', accountId: 'old-account', isViewed: false }]);
      store.close();

      const backup = `${file}.pre-social-v1.bak`;
      expect(existsSync(backup)).toBe(true);
      const saved = new DatabaseSync(backup);
      expect((saved.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(0);
      expect(saved.prepare('SELECT COUNT(*) AS count FROM social_posts').get()).toEqual({ count: 1 });
      saved.close();

      const reopened = openDriver(file);
      expect((reopened.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1);
      const dbAgain = initSocialDb(file, reopened);
      expect(dbAgain.getUnseenPosts()).toHaveLength(1);
      dbAgain.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses an unsafe migration when a backup already exists, without changing old data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomny-social-backup-'));
    const file = join(dir, 'social.sqlite');
    try {
      const old = new DatabaseSync(file);
      old.exec(
        'CREATE TABLE social_accounts (id TEXT PRIMARY KEY, connected_at INTEGER NOT NULL, payload TEXT NOT NULL)'
      );
      old.prepare('INSERT INTO social_accounts VALUES (?, ?, ?)').run('existing', 5, '{"id":"existing"}');
      old.close();
      writeFileSync(`${file}.pre-social-v1.bak`, 'preexisting backup');
      const driver = openDriver(file);
      expect(() => initSocialDb(file, driver)).toThrow('SOCIAL_DB_BACKUP_FAILED');
      driver.close();
      const untouched = new DatabaseSync(file);
      expect((untouched.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(0);
      expect(untouched.prepare('SELECT COUNT(*) AS count FROM social_accounts').get()).toEqual({ count: 1 });
      untouched.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rolls back failed legacy schema migration and preserves a recoverable backup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomny-social-rollback-'));
    const file = join(dir, 'social.sqlite');
    try {
      const old = new DatabaseSync(file);
      old.exec(
        'CREATE TABLE social_accounts (id TEXT PRIMARY KEY, connected_at INTEGER NOT NULL, payload TEXT NOT NULL)'
      );
      old.prepare('INSERT INTO social_accounts VALUES (?, ?, ?)').run('safe-account', 3, '{"id":"safe-account"}');
      old.close();

      const underlying = openDriver(file);
      const fault: ISqliteDriver = {
        ...underlying,
        exec(sql) {
          if (sql === 'PRAGMA user_version = 1') throw new Error('INJECTED_MIGRATION_FAILURE');
          underlying.exec(sql);
        },
      };
      expect(() => initSocialDb(file, fault)).toThrow('INJECTED_MIGRATION_FAILURE');
      expect((underlying.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(0);
      expect(underlying.prepare('SELECT COUNT(*) AS count FROM social_accounts').get()).toEqual({ count: 1 });
      expect(existsSync(`${file}.pre-social-v1.bak`)).toBe(true);
      underlying.close();

      // The existing backup is intentionally never overwritten. After the caller
      // preserves it elsewhere, a retry can create a new consistent safety copy.
      rmSync(`${file}.pre-social-v1.bak`);
      const recovered = initSocialDb(file, openDriver(file));
      expect(recovered.getAccounts()).toEqual([{ id: 'safe-account' }]);
      recovered.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed on a future schema and on a malformed stored JSON payload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomny-social-future-'));
    const file = join(dir, 'social.sqlite');
    try {
      const future = new DatabaseSync(file);
      future.exec('PRAGMA user_version = 99');
      future.close();
      const incompatible = openDriver(file);
      expect(() => initSocialDb(file, incompatible)).toThrow('SOCIAL_DB_VERSION_UNSUPPORTED');
      incompatible.close();

      const reset = new DatabaseSync(file);
      reset.exec('PRAGMA user_version = 0');
      reset.close();
      const driver = openDriver(file);
      const store = initSocialDb(file, driver);
      driver.prepare('INSERT INTO social_accounts VALUES (?, ?, ?)').run('broken', 1, 'not-json');
      expect(() => store.getAccounts()).toThrow('SOCIAL_CACHE_PAYLOAD_INVALID');
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
