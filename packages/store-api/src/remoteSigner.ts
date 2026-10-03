import type { Ed25519Signer } from './signer.js';

type RemoteSignerConfig = Readonly<{
  endpoint: string;
  keyId: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}>;

const decodeSignature = (value: unknown): Uint8Array => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0)
    throw new Error('SIGNER_RESPONSE_INVALID');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength !== 64 || bytes.toString('base64') !== value) throw new Error('SIGNER_RESPONSE_INVALID');
  return bytes;
};

export const createRemoteEd25519Signer = (config: RemoteSignerConfig): Ed25519Signer => {
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(endpoint.hostname))
    throw new Error('SIGNER_ENDPOINT_INVALID');
  if (!config.keyId.trim() || !config.accessToken.trim()) throw new Error('SIGNER_NOT_CONFIGURED');
  const fetchImpl = config.fetchImpl ?? fetch;
  return {
    keyId: config.keyId,
    sign: async (payload) => {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + config.accessToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ keyId: config.keyId, payloadBase64: Buffer.from(payload).toString('base64') }),
      });
      if (!response.ok) throw new Error('SIGNER_PROVIDER_REQUEST_FAILED');
      const body = (await response.json().catch(() => undefined)) as { signatureBase64?: unknown } | undefined;
      return decodeSignature(body?.signatureBase64);
    },
  };
};
