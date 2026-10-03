import type { Pool } from 'pg';
import { stagePackageArtifact, type StagedArtifact } from './staging.js';
import { putAuthoritativeArtifact, type ArtifactObjectStore } from './artifacts.js';
export const persistStagedArtifact = async (
  pool: Pool,
  input: Readonly<{
    bytes: Uint8Array;
    accountId: string;
    packageId: string;
    version: string;
    manifestDigest: string;
    maxBytes?: number;
    authoritativeStore?: ArtifactObjectStore;
  }>
): Promise<StagedArtifact> => {
  const staged = stagePackageArtifact(input);
  const membership = await pool.query<{ publisher_id: string }>(
    'SELECT publisher_id FROM publisher_members WHERE account_id=$1 AND role=$2 AND status=$3 LIMIT 1',
    [input.accountId, 'publisher', 'active']
  );
  if (!membership.rowCount) throw new Error('PUBLISHER_MEMBERSHIP_REQUIRED');
  let state: 'staged' | 'authoritative' = 'staged';
  if (input.authoritativeStore) {
    await putAuthoritativeArtifact(input.authoritativeStore, staged.digest.slice(7), input.bytes);
    state = 'authoritative';
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const publisher = await client.query<{ publisher_id: string }>(
      'SELECT publisher_id FROM publisher_members WHERE account_id=$1 AND role=$2 AND status=$3 LIMIT 1',
      [input.accountId, 'publisher', 'active']
    );
    if (!publisher.rowCount) throw new Error('PUBLISHER_MEMBERSHIP_REQUIRED');
    const packageRow = await client.query<{ publisher_id: string }>(
      'INSERT INTO packages(package_id,publisher_id,name) VALUES($1,$2,$1) ON CONFLICT (package_id) DO UPDATE SET name=packages.name WHERE packages.publisher_id=$2 RETURNING publisher_id',
      [input.packageId, publisher.rows[0]!.publisher_id]
    );
    if (!packageRow.rowCount) throw new Error('PACKAGE_PUBLISHER_CONFLICT');
    const versionRow = await client.query<{ manifest_digest: string }>(
      'INSERT INTO package_versions(package_id,version,manifest_json,manifest_digest,state) VALUES($1,$2,$3,$4,$5) ON CONFLICT (package_id,version) DO NOTHING RETURNING manifest_digest',
      [
        input.packageId,
        input.version,
        JSON.stringify({ id: input.packageId, version: input.version }),
        input.manifestDigest,
        'staged',
      ]
    );
    if (!versionRow.rowCount) {
      const existing = await client.query<{ manifest_digest: string }>(
        'SELECT manifest_digest FROM package_versions WHERE package_id=$1 AND version=$2 FOR UPDATE',
        [input.packageId, input.version]
      );
      if (!existing.rowCount || existing.rows[0]!.manifest_digest !== input.manifestDigest)
        throw new Error('PACKAGE_VERSION_IMMUTABLE_CONFLICT');
    }
    await client.query(
      'INSERT INTO package_artifacts(artifact_digest,package_id,version,archive_digest,size_bytes,object_key,state) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (artifact_digest) DO UPDATE SET state=EXCLUDED.state WHERE package_artifacts.state=' +
        "'staged'",
      [staged.digest, input.packageId, input.version, staged.digest, staged.sizeBytes, staged.objectKey, state]
    );
    await client.query('COMMIT');
    return staged;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
