import { describe, expect, it } from 'vitest';
import { runCriticalBackup } from '../src/runBackup.js';

describe('backup command', () => {
  it('fails closed when encryption key is absent', async () => {
    await expect(
      runCriticalBackup({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://localhost/store',
        SUPABASE_ISSUER: 'https://issuer',
        SUPABASE_AUDIENCE: 'authenticated',
        SUPABASE_JWKS_URL: 'https://issuer/keys',
      })
    ).rejects.toThrow('BACKUP_KEY_NOT_CONFIGURED');
  });
});
