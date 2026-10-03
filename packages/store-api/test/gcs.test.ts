import { describe, expect, it, vi } from 'vitest';
import { createGcsArtifactStore, createGcsMetadataTokenProvider } from '../src/gcs.js';
describe('GCS artifact adapter', () => {
  it('uploads create-only and downloads with digest verification', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('/download/') ? new Response(Buffer.from('x'), { status: 200 }) : new Response('{}', { status: 200 })
    );
    const store = createGcsArtifactStore(
      { bucket: 'b', accessToken: 't', endpoint: 'http://127.0.0.1:8787' },
      fetchImpl as unknown as typeof fetch
    );
    const digest = '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881';
    await store.create('sha256/' + digest, Buffer.from('x'), { ifGenerationMatch: 0, metadata: { sha256: digest } });
    expect(String((fetchImpl.mock.calls as unknown[][])[0]?.[0] ?? '')).toContain('ifGenerationMatch=0');
    await expect(store.download('sha256/' + digest)).resolves.toEqual(new Uint8Array([120]));
  });
  it('rejects metadata that does not match the content-addressed key', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ size: '1', metadata: { sha256: 'bad' } }), { status: 200 })
    );
    const store = createGcsArtifactStore(
      { bucket: 'b', accessToken: 't', endpoint: 'http://127.0.0.1:8787' },
      fetchImpl as unknown as typeof fetch
    );
    await expect(store.head('sha256/2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881')).rejects.toThrow(
      'GCS_METADATA_INVALID'
    );
  });

  it('rejects malformed object size metadata', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            size: 'not-a-number',
            metadata: { sha256: '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881' },
          }),
          { status: 200 }
        )
    );
    const store = createGcsArtifactStore(
      { bucket: 'b', accessToken: 't', endpoint: 'http://127.0.0.1:8787' },
      fetchImpl as unknown as typeof fetch
    );
    await expect(store.head('sha256/2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881')).rejects.toThrow(
      'GCS_METADATA_INVALID'
    );
  });

  it('uses Cloud Run metadata identity without a static token', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'short-lived-workload-token', expires_in: 300 }), { status: 200 })
    );
    const provider = createGcsMetadataTokenProvider(fetchImpl as unknown as typeof fetch);
    await expect(provider()).resolves.toBe('short-lived-workload-token');
    await expect(provider()).resolves.toBe('short-lived-workload-token');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls as unknown[][])[0]?.[1]).toEqual({ headers: { 'Metadata-Flavor': 'Google' } });
  });
  it('fails closed when workload identity cannot issue a valid token', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: '' }), { status: 200 }));
    await expect(createGcsMetadataTokenProvider(fetchImpl as unknown as typeof fetch)()).rejects.toThrow(
      'GCS_TOKEN_INVALID'
    );
  });
  it('fails closed without credentials', () => {
    expect(() => createGcsArtifactStore({ bucket: '', accessToken: '' })).toThrow('GCS_NOT_CONFIGURED');
  });
  it('rejects non-HTTPS non-local endpoints', () => {
    expect(() => createGcsArtifactStore({ bucket: 'b', accessToken: 't', endpoint: 'http://metadata.google' })).toThrow(
      'GCS_ENDPOINT_INVALID'
    );
  });
  it('rejects HTTPS endpoints outside Google Cloud Storage', () => {
    expect(() =>
      createGcsArtifactStore({ bucket: 'b', accessToken: 't', endpoint: 'https://metadata.google' })
    ).toThrow('GCS_ENDPOINT_INVALID');
  });
  it('rejects arbitrary object keys', async () => {
    const store = createGcsArtifactStore({ bucket: 'b', accessToken: 't' }, vi.fn() as never);
    await expect(store.download('other/path')).rejects.toThrow('GCS_OBJECT_KEY_INVALID');
  });
});
