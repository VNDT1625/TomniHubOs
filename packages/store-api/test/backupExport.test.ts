import { describe, expect, it } from 'vitest';
import { exportCriticalStoreState } from '../src/backupExport.js';
describe('critical state export', () => {
  it('exports append-only tables with a verifiable manifest', async () => {
    const pool = { query: async () => ({ rows: [{ created_at: '2026-01-01', id: 1 }] }) } as never;
    const bundle = await exportCriticalStoreState(pool);
    expect(bundle.files).toHaveLength(5);
    expect(bundle.manifest.files.map((f) => f.name)).toContain('ledger_entries.jsonl');
  });
});
