import { describe, expect, it } from 'vitest';
import { SupabaseDatabaseEgressGuard, type LayaPredictor } from '@/process/services/security';

describe('SupabaseDatabaseEgressGuard (Selective Scope Boundary)', () => {
  it('strictly exempts local notes and drafts from inspection (zero latency, zero blocking)', async () => {
    const guard = new SupabaseDatabaseEgressGuard();

    // Even if the user writes a tutorial or note containing SQL like DROP TABLE
    const localNotePayload = {
      title: 'SQL Cheat Sheet',
      content: 'Lệnh xóa bảng trong SQL là DROP TABLE users;',
    };

    const result = await guard.inspect(localNotePayload, { destination: 'local_note' });

    expect(result.allowed).toBe(true);
    expect(result.decision).toBe('allow');
    expect(result.riskType).toBe('exempt_local_storage');
    expect(result.reasonCode).toBe('LOCAL_STORAGE_EXEMPT');
    expect(result.latencyMs).toBe(0);
    expect(result.method).toBe('exempt');
  });

  it('allows safe legitimate payloads outbound to Supabase', async () => {
    const guard = new SupabaseDatabaseEgressGuard();
    const safePayload = {
      id: 'user_123',
      displayName: 'Nguyen Van A',
      email: 'vana@example.com',
      updatedAt: '2026-09-22T00:00:00Z',
    };

    const result = await guard.inspect(safePayload, { destination: 'supabase' });

    expect(result.allowed).toBe(true);
    expect(result.decision).toBe('allow');
    expect(result.riskType).toBe('safe');
    expect(result.reasonCode).toBe('PAYLOAD_VERIFIED_SAFE');
    expect(result.auditReceipt.payloadHash).toBeDefined();
  });

  it('blocks destructive DDL script (DROP TABLE) targeting Supabase', async () => {
    const guard = new SupabaseDatabaseEgressGuard();
    const destructivePayload = 'DROP TABLE users CASCADE;';

    const result = await guard.inspect(destructivePayload, { destination: 'https://xyz.supabase.co/rest/v1/rpc' });

    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('block');
    expect(result.riskType).toBe('destructive_script');
    expect(result.reasonCode).toBe('DETERMINISTIC_DESTRUCTIVE_SCRIPT');
  });

  it('blocks destructive DML (TRUNCATE TABLE) targeting Supabase', async () => {
    const guard = new SupabaseDatabaseEgressGuard();
    const truncatePayload = { query: 'TRUNCATE TABLE transactions;' };

    const result = await guard.inspect(truncatePayload, { destination: 'supabase' });

    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('block');
    expect(result.riskType).toBe('destructive_script');
  });

  it('blocks SQL Injection pattern targeting Supabase', async () => {
    const guard = new SupabaseDatabaseEgressGuard();
    const injectionPayload = {
      search: "' OR 1=1 --",
    };

    const result = await guard.inspect(injectionPayload, { destination: 'supabase' });

    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('block');
    expect(result.riskType).toBe('sql_injection');
    expect(result.reasonCode).toBe('DETERMINISTIC_SQL_INJECTION');
  });

  it('blocks RLS Bypass attempts targeting Supabase', async () => {
    const guard = new SupabaseDatabaseEgressGuard();
    const rlsBypassPayload = {
      headers: {
        role: 'service_role',
        bypassrls: true,
      },
    };

    const result = await guard.inspect(rlsBypassPayload, { destination: 'supabase' });

    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('block');
    expect(result.riskType).toBe('rls_bypass');
    expect(result.reasonCode).toBe('DETERMINISTIC_RLS_BYPASS');
  });

  it('uses Laya neural predictor to classify subtle database threats', async () => {
    const mockPredictor: LayaPredictor = async () => ({
      answers: {
        databaseSafety: { choice: 'sql_injection', confidence: 0.94 },
      },
    });

    const guard = new SupabaseDatabaseEgressGuard(mockPredictor);
    // Non-obvious query that escapes regex but is flagged by neural predictor
    const subtlePayload = { filter: 'col == val; SELECT secret FROM admin;' };

    const result = await guard.inspect(subtlePayload, { destination: 'supabase' });

    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('block');
    expect(result.riskType).toBe('sql_injection');
    expect(result.reasonCode).toBe('NEURAL_SQL_INJECTION');
    expect(result.method).toBe('laya_neural');
  });
});
