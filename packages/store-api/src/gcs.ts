import { createHash } from 'node:crypto';
import { artifactKey, type ArtifactObjectStore } from './artifacts.js';
export type GcsConfig = Readonly<{
  bucket: string;
  accessToken?: string;
  accessTokenProvider?: () => Promise<string>;
  endpoint?: string;
}>;
export const createGcsMetadataTokenProvider = (fetchImpl: typeof fetch = fetch): (() => Promise<string>) => {
  let cached: string | undefined;
  let expiresAt = 0;
  let inFlight: Promise<string> | undefined;
  return async () => {
    if (cached && expiresAt > Date.now() + 30_000) return cached;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const response = await fetchImpl(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        { headers: { 'Metadata-Flavor': 'Google' } }
      );
      if (!response.ok) throw new Error('GCS_TOKEN_UNAVAILABLE');
      const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
      if (typeof body.access_token !== 'string' || body.access_token.length < 20) throw new Error('GCS_TOKEN_INVALID');
      const lifetime = typeof body.expires_in === 'number' && Number.isFinite(body.expires_in) ? body.expires_in : 300;
      cached = body.access_token;
      expiresAt = Date.now() + Math.max(30, lifetime - 30) * 1000;
      return cached;
    })();
    try {
      return await inFlight;
    } finally {
      inFlight = undefined;
    }
  };
};
export type GcsArtifactStore = ArtifactObjectStore & Readonly<{ download: (key: string) => Promise<Uint8Array> }>;
const metadata = (digest: string) => ({ sha256: digest });
const baseUrl = (config: GcsConfig): string => {
  const endpoint = config.endpoint ?? 'https://storage.googleapis.com';
  const parsed = new URL(endpoint);
  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  const googleStorage = parsed.hostname === 'storage.googleapis.com';

  if ((!local && parsed.protocol !== 'https:') || (!local && !googleStorage)) throw new Error('GCS_ENDPOINT_INVALID');
  return parsed.toString().replace(/\/$/u, '');
};
export const createGcsArtifactStore = (config: GcsConfig, fetchImpl: typeof fetch = fetch): GcsArtifactStore => {
  if (!config.bucket || (!config.accessToken && !config.accessTokenProvider)) throw new Error('GCS_NOT_CONFIGURED');
  const base = baseUrl(config);
  const authHeaders = async (): Promise<Record<string, string>> => {
    const token = config.accessTokenProvider ? await config.accessTokenProvider() : config.accessToken;
    if (!token) throw new Error('GCS_NOT_CONFIGURED');
    return { Authorization: `Bearer ${token}` };
  };
  return {
    head: async (key) => {
      const response = await fetchImpl(
        `${base}/storage/v1/b/${encodeURIComponent(config.bucket)}/o/${encodeURIComponent(key)}`,
        { headers: await authHeaders() }
      );
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error('GCS_HEAD_FAILED');
      const value = (await response.json()) as { size?: string; metadata?: Record<string, string> };
      const digest = value.metadata?.sha256;
      const expectedDigest = key.startsWith('sha256/') ? key.slice('sha256/'.length) : undefined;
      if (!digest || !expectedDigest || digest !== expectedDigest) throw new Error('GCS_METADATA_INVALID');
      const size = Number(value.size);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error('GCS_METADATA_INVALID');
      return { digest, size, metadata: value.metadata ?? {} };
    },
    create: async (key, bytes, options) => {
      if (options.ifGenerationMatch !== 0) throw new Error('GCS_CREATE_ONLY_REQUIRED');
      const digest = options.metadata.sha256;
      if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('ARTIFACT_DIGEST_MISMATCH');
      const response = await fetchImpl(
        `${base}/upload/storage/v1/b/${encodeURIComponent(config.bucket)}/o?uploadType=media&name=${encodeURIComponent(key)}&ifGenerationMatch=0`,
        {
          method: 'POST',
          headers: {
            ...(await authHeaders()),
            'content-type': 'application/octet-stream',
            'x-goog-meta-sha256': digest,
          },
          body: Buffer.from(bytes),
        }
      );
      if (response.status === 412) throw new Error('ARTIFACT_IMMUTABILITY_CONFLICT');
      if (!response.ok) throw new Error('GCS_CREATE_FAILED');
      return { digest, size: bytes.byteLength, metadata: metadata(digest) };
    },
    download: async (key) => {
      if (!/^sha256\/[a-f0-9]{64}$/.test(key)) throw new Error('GCS_OBJECT_KEY_INVALID');
      const response = await fetchImpl(
        `${base}/download/storage/v1/b/${encodeURIComponent(config.bucket)}/o/${encodeURIComponent(key)}?alt=media`,
        { headers: await authHeaders() }
      );
      if (!response.ok) throw new Error('GCS_DOWNLOAD_FAILED');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const expected = key.slice(7);
      if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('ARTIFACT_DIGEST_MISMATCH');
      return bytes;
    },
  };
};
export const gcsObjectKey = (digest: string): string => artifactKey(digest);
