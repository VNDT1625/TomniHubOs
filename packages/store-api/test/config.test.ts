import { describe, expect, it } from 'vitest';
import { readStoreApiConfig } from '../src/config.js';

describe('store API configuration', () => {
  it('fails closed when production credentials are absent', () => {
    expect(() => readStoreApiConfig({})).toThrow('STORE_API_CONFIG_MISSING:SUPABASE_ISSUER');
  });
  it('rejects non-HTTPS JWKS endpoints', () => {
    expect(() =>
      readStoreApiConfig({
        DATABASE_URL: 'postgres://x',
        SUPABASE_ISSUER: 'https://auth.example',
        SUPABASE_AUDIENCE: 'authenticated',
        SUPABASE_JWKS_URL: 'http://auth.example/keys',
      })
    ).toThrow('STORE_API_CONFIG_INVALID:SUPABASE_JWKS_URL');
  });
  it('uses bounded pool defaults and accepts valid overrides', () => {
    const config = readStoreApiConfig({
      DATABASE_URL: 'postgres://runtime',
      SUPABASE_ISSUER: 'https://auth.example',
      SUPABASE_AUDIENCE: 'authenticated',
      SUPABASE_JWKS_URL: 'https://auth.example/keys',
      STORE_DB_POOL_MAX: '8',
      STORE_DB_IDLE_TIMEOUT_MS: '15000',
      STORE_DB_CONNECTION_TIMEOUT_MS: '1000',
    });
    expect(config.dbPoolMax).toBe(8);
    expect(config.dbIdleTimeoutMs).toBe(15_000);
    expect(config.dbConnectionTimeoutMs).toBe(1_000);
  });
  it('rejects invalid pool bounds', () => {
    const base = {
      DATABASE_URL: 'postgres://runtime',
      SUPABASE_ISSUER: 'https://auth.example',
      SUPABASE_AUDIENCE: 'authenticated',
      SUPABASE_JWKS_URL: 'https://auth.example/keys',
    };
    expect(() => readStoreApiConfig({ ...base, STORE_DB_POOL_MAX: '0' })).toThrow(
      'STORE_API_CONFIG_INVALID:STORE_DB_POOL_MAX'
    );
    expect(() => readStoreApiConfig({ ...base, STORE_DB_CONNECTION_TIMEOUT_MS: '1' })).toThrow(
      'STORE_API_CONFIG_INVALID:STORE_DB_CONNECTION_TIMEOUT_MS'
    );
  });
});
