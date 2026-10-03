export type Ed25519Signer = Readonly<{ keyId: string; sign(payload: Uint8Array): Promise<Uint8Array> }>;
export const requireEd25519Signature = async (signer: Ed25519Signer, payload: Uint8Array): Promise<string> => {
  const signature = await signer.sign(payload);
  if (signature.byteLength !== 64) throw new Error('SIGNER_INCOMPATIBLE_ED25519_OUTPUT');
  return Buffer.from(signature).toString('base64');
};
