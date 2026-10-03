import { describe, expect, it } from 'vitest';
import { requireEd25519Signature } from '../src/signer.js';
describe('signer compatibility', () => {
  it('fails closed for non-Ed25519 output', async () => {
    await expect(
      requireEd25519Signature({ keyId: 'k', sign: async () => new Uint8Array(63) }, new Uint8Array([1]))
    ).rejects.toThrow('SIGNER_INCOMPATIBLE_ED25519_OUTPUT');
  });
});
