import { describe, expect, it } from 'vitest';
import { createRemoteEd25519Signer } from '../src/remoteSigner.js';

describe('remote non-exportable signer boundary', () => {
  it('rejects insecure remote endpoints and missing credentials', () => {
    expect(() =>
      createRemoteEd25519Signer({ endpoint: 'http://signer.example', keyId: 'k', accessToken: 't' })
    ).toThrow('SIGNER_ENDPOINT_INVALID');
    expect(() =>
      createRemoteEd25519Signer({ endpoint: 'https://signer.example', keyId: '', accessToken: 't' })
    ).toThrow('SIGNER_NOT_CONFIGURED');
  });

  it('sends canonical bytes and accepts exactly 64-byte signatures', async () => {
    const signature = Buffer.alloc(64, 7).toString('base64');
    let request: Request | undefined;
    const signer = createRemoteEd25519Signer({
      endpoint: 'https://signer.example/sign',
      keyId: 'kms-key-v1',
      accessToken: 'opaque-token',
      fetchImpl: async (input, init) => {
        request = new Request(input, init);
        return new Response(JSON.stringify({ signatureBase64: signature }), { status: 200 });
      },
    });
    const out = await signer.sign(new Uint8Array([1, 2, 3]));
    expect(out.byteLength).toBe(64);
    expect(request?.headers.get('authorization')).toBe('Bearer opaque-token');
    expect(await request?.json()).toEqual({
      keyId: 'kms-key-v1',
      payloadBase64: Buffer.from([1, 2, 3]).toString('base64'),
    });
  });

  it('rejects malformed provider signatures', async () => {
    const signer = createRemoteEd25519Signer({
      endpoint: 'https://signer.example/sign',
      keyId: 'kms-key-v1',
      accessToken: 'opaque-token',
      fetchImpl: async () => new Response(JSON.stringify({ signatureBase64: 'bad' }), { status: 200 }),
    });
    await expect(signer.sign(new Uint8Array([1]))).rejects.toThrow('SIGNER_RESPONSE_INVALID');
  });
});
