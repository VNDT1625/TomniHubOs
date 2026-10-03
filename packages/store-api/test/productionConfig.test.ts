import { describe, expect, it } from 'vitest';
import { readStoreApiConfig } from '../src/config.js';
import { createStoreApiServer } from '../src/index.js';

describe('production authority configuration', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://runtime',
    SUPABASE_ISSUER: 'https://auth.example',
    SUPABASE_AUDIENCE: 'authenticated',
    SUPABASE_JWKS_URL: 'https://auth.example/keys',
    STORE_INTERNAL_TOKEN: 'internal-token',
    DOWNLOAD_TICKET_SECRET: 'download-secret',
    PADDLE_WEBHOOK_SECRET: 'webhook-secret',
    PADDLE_API_KEY: 'paddle-key',
    GCS_BUCKET: 'tomni-artifacts',
  };

  it('requires each external commerce and artifact authority', () => {
    const cases = [
      ['PADDLE_WEBHOOK_SECRET', 'STORE_API_CONFIG_MISSING:PADDLE_WEBHOOK_SECRET'],
      ['PADDLE_API_KEY', 'STORE_API_CONFIG_MISSING:PADDLE_API_KEY'],
      ['GCS_BUCKET', 'STORE_API_CONFIG_MISSING:GCS_AUTHORITY'],
    ] as const;
    for (const [key, error] of cases) {
      const environment = { ...base };
      delete environment[key];
      expect(() => readStoreApiConfig(environment)).toThrow(error);
    }
  });
  it('rejects non-production Paddle mode in production', () => {
    expect(() => readStoreApiConfig({ ...base, PADDLE_ENV: 'sandbox' })).toThrow('STORE_API_CONFIG_INVALID:PADDLE_ENV');
  });
  it('fails closed when production signer is not injected', () => {
    expect(() => createStoreApiServer({ ...base, DATABASE_URL: 'postgres://runtime:secret@example/store' })).toThrow(
      'STORE_API_CONFIG_MISSING:PACKAGE_SIGNER'
    );
  });

  it('rejects privileged production database roles', () => {
    for (const role of ['postgres', 'supabase_admin'])
      expect(() =>
        readStoreApiConfig({ ...base, DATABASE_URL: 'postgres://' + role + ':secret@example/store' })
      ).toThrow('STORE_API_CONFIG_INVALID:DATABASE_ROLE');
  });
});
