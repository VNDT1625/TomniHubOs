import { describe, expect, it } from 'vitest';
import { createStoreApiServer } from '../src/index.js';

describe('Store API HTTP bootstrap', () => {
  it('serves liveness and protects domain routes behind JWT auth', async () => {
    const api = createStoreApiServer({
      NODE_ENV: 'test',
      PORT: '18081',
      DATABASE_URL: 'postgres://localhost/store',
      SUPABASE_ISSUER: 'https://auth.example.test',
      SUPABASE_AUDIENCE: 'authenticated',
      SUPABASE_JWKS_URL: 'https://auth.example.test/.well-known/jwks.json',
    });
    await new Promise<void>((resolve) => api.server.listen(18081, '127.0.0.1', resolve));
    try {
      const live = await fetch('http://127.0.0.1:18081/health/live');
      expect(live.status).toBe(200);
      await expect(live.json()).resolves.toMatchObject({ ok: true, service: 'tomni-store-api' });
      const catalog = await fetch('http://127.0.0.1:18081/v1/catalog');
      expect(catalog.status).toBe(401);
      await expect(catalog.json()).resolves.toEqual({ code: 'AUTH_REQUIRED' });
    } finally {
      await new Promise<void>((resolve, reject) => api.server.close((error) => (error ? reject(error) : resolve())));
      await api.close();
    }
  });

  it('rejects a declared body size above the route limit before buffering', async () => {
    const api = createStoreApiServer({
      NODE_ENV: 'test',
      PORT: '18082',
      DATABASE_URL: 'postgres://localhost/store',
      SUPABASE_ISSUER: 'https://auth.example.test',
      SUPABASE_AUDIENCE: 'authenticated',
      SUPABASE_JWKS_URL: 'https://auth.example.test/.well-known/jwks.json',
      PADDLE_WEBHOOK_SECRET: 'test-secret',
    });
    await new Promise<void>((resolve) => api.server.listen(18082, '127.0.0.1', resolve));
    try {
      const response = await fetch('http://127.0.0.1:18082/v1/webhooks/paddle', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': String(2_000_001) },
        body: 'x'.repeat(2_000_001),
      });
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toEqual({ code: 'PAYLOAD_TOO_LARGE' });
    } finally {
      await new Promise<void>((resolve, reject) => api.server.close((error) => (error ? reject(error) : resolve())));
      await api.close();
    }
  });
});
