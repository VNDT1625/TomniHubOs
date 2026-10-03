import { describe, expect, it } from 'vitest';
import { createStoreApiClient } from '@/process/services/storeApiClient';

describe('trusted Store API client', () => {
  it('routes publisher and reviewer mutations through Main-owned bearer auth', async () => {
    const calls: Array<{ url: string; method: string; headers: Headers; body?: string }> = [];
    const client = createStoreApiClient({
      baseUrl: 'http://127.0.0.1:8787',
      accessToken: async () => 'access-token',
      fetchImpl: async (input, init) => {
        calls.push({
          url: String(input),
          method: init?.method ?? 'GET',
          headers: new Headers(init?.headers),
          ...(typeof init?.body === 'string' ? { body: init.body } : {}),
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    await client.stageArtifact({ packageId: 'pkg', version: '1.0.0' });
    await client.submitPackage({ packageId: 'pkg' }, 'submit-key');
    await client.reviews();
    await client.decideReview('review/1', 'approve', { artifactDigest: 'sha256-a' });
    await client.publishCatalog({ packageId: 'pkg', version: '1.0.0' });

    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['POST', 'http://127.0.0.1:8787/v1/publisher-artifacts/stage'],
      ['POST', 'http://127.0.0.1:8787/v1/submissions'],
      ['GET', 'http://127.0.0.1:8787/v1/reviews'],
      ['POST', 'http://127.0.0.1:8787/v1/reviews/review%2F1/approve'],
      ['POST', 'http://127.0.0.1:8787/v1/catalog/publications'],
    ]);
    expect(calls.every((call) => call.headers.get('authorization') === 'Bearer access-token')).toBe(true);
    expect(calls[1]?.headers.get('idempotency-key')).toBe('submit-key');
  });

  it('rejects missing session token before making a request', async () => {
    let called = false;
    const client = createStoreApiClient({
      baseUrl: 'http://127.0.0.1:8787',
      accessToken: async () => undefined,
      fetchImpl: async () => {
        called = true;
        return new Response('{}');
      },
    });
    await expect(client.catalog()).rejects.toThrow('STORE_API_AUTH_REQUIRED');
    expect(called).toBe(false);
  });
});
