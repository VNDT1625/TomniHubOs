import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('store migration safety', () => {
  it('keeps ordered migrations and explicit least-privilege append-only grants', async () => {
    const directory = resolve(process.cwd(), 'migrations');
    const files: string[] = (await readdir(directory)).filter((file: string) => /^\d{3}_[a-z0-9_]+\.sql$/.test(file));
    files.sort();
    expect(files.length).toBeGreaterThanOrEqual(24);
    expect(files.map((file: string) => file.slice(0, 3))).toEqual(
      files.map((_: string, index: number) => String(index + 1).padStart(3, '0'))
    );
    const sql = await Promise.all(files.map((file: string) => readFile(resolve(directory, file), 'utf8')));
    expect(sql.join('\n')).not.toMatch(/GRANT ALL/i);
    const privilegeMigration = await readFile(resolve(directory, '015_runtime_append_only_privileges.sql'), 'utf8');
    expect(privilegeMigration).toMatch(/REVOKE UPDATE, DELETE, TRUNCATE ON payment_events/i);
    expect(privilegeMigration).toMatch(/GRANT SELECT, INSERT ON payment_events/i);
    const releaseEvidenceMigration = await readFile(resolve(directory, '016_release_evidence_append_only.sql'), 'utf8');
    expect(releaseEvidenceMigration).toMatch(/CREATE TRIGGER package_approvals_append_only/i);
    expect(releaseEvidenceMigration).toMatch(/CREATE TRIGGER release_signatures_append_only/i);
    expect(releaseEvidenceMigration).toMatch(/REVOKE UPDATE, DELETE, TRUNCATE ON package_approvals/i);
    const outboxPrivilegeMigration = await readFile(resolve(directory, '018_outbox_runtime_privilege.sql'), 'utf8');
    expect(outboxPrivilegeMigration).toMatch(/GRANT SELECT, INSERT, UPDATE ON outbox_events/i);
    expect(outboxPrivilegeMigration).toMatch(/REVOKE DELETE, TRUNCATE ON outbox_events/i);
    const identityMigration = await readFile(resolve(directory, '023_publisher_identity_immutable.sql'), 'utf8');
    expect(identityMigration).toMatch(/publishers_identity_immutable/);
    expect(identityMigration).toMatch(/publisher identity is immutable/);
    const publisherMigration = await readFile(resolve(directory, '022_publisher_owner_uniqueness.sql'), 'utf8');
    expect(publisherMigration).toMatch(/publishers_owner_account_uq/);
    expect(publisherMigration).toMatch(/GRANT SELECT, INSERT, UPDATE ON publishers/i);
    const ledgerMigration = await readFile(resolve(directory, '021_ledger_integrity.sql'), 'utf8');
    expect(ledgerMigration).toMatch(/ledger_entries_positive_amount_ck/);
    expect(ledgerMigration).toMatch(/ledger_entries_currency_format_ck/);
    expect(ledgerMigration).toMatch(/REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries/i);
    const hardeningMigration = await readFile(resolve(directory, '024_append_only_privilege_hardening.sql'), 'utf8');
    expect(hardeningMigration).toMatch(/REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM tomni_runtime/);
    expect(hardeningMigration).toMatch(/GRANT SELECT, INSERT ON %I TO tomni_runtime/);
    const integrityMigration = await readFile(resolve(directory, '017_integrity_invariants.sql'), 'utf8');
    expect(integrityMigration).toMatch(/package_artifacts_object_key_binding_ck/);
    expect(integrityMigration).toMatch(/orders_currency_format_ck/);
  });
});
