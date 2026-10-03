import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { requireEd25519Signature, type Ed25519Signer } from './signer.js';
export const canonicalCatalogPayload = (
  input: Readonly<{ packageId: string; version: string; artifactDigest: string; offer?: unknown }>
): Uint8Array =>
  Buffer.from(
    JSON.stringify({
      packageId: input.packageId,
      version: input.version,
      artifactDigest: input.artifactDigest,
      offer: input.offer ?? null,
    })
  );
export const signReleaseArtifact = async (
  pool: Pool,
  signer: Ed25519Signer,
  input: Readonly<{ packageId: string; version: string; artifactDigest: string; offer?: unknown }>
): Promise<Readonly<{ keyId: string; signature: string; canonicalDigest: string }>> => {
  const payload = canonicalCatalogPayload(input);
  const signature = await requireEd25519Signature(signer, payload);
  const canonicalDigest = createHash('sha256').update(payload).digest('hex');
  await pool.query(
    'INSERT INTO release_signatures(artifact_digest,key_id,algorithm,signature,canonical_digest) VALUES($1,$2,$3,$4,$5) ON CONFLICT (artifact_digest,key_id) DO NOTHING',
    [input.artifactDigest, signer.keyId, 'ed25519', signature, canonicalDigest]
  );
  return { keyId: signer.keyId, signature, canonicalDigest };
};
