import type { Pool } from 'pg';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { artifactKey } from './artifacts.js';
export type DownloadTicket = Readonly<{
  ticketId: string;
  digest: string;
  expiresAt: string;
  objectKey: string;
  proof?: string;
}>;
const ticketProof = (secret: string, ticketId: string, accountId: string, digest: string, expiresAt: string): string =>
  createHmac('sha256', secret).update([ticketId, accountId, digest, expiresAt].join('\\n')).digest('base64url');
export const verifyDownloadTicket = (
  ticket: DownloadTicket,
  accountId: string,
  secret: string,
  now = Date.now()
): boolean => {
  if (!ticket.proof || Date.parse(ticket.expiresAt) <= now) return false;
  const expected = ticketProof(secret, ticket.ticketId, accountId, ticket.digest, ticket.expiresAt);
  const a = Buffer.from(expected);
  const b = Buffer.from(ticket.proof);
  return a.length === b.length && timingSafeEqual(a, b);
};
export const issueDownloadTicket = async (
  pool: Pool,
  input: Readonly<{ accountId: string; digest: string; ttlMs?: number; ticketSecret?: string }>
): Promise<DownloadTicket> => {
  const rawDigest = input.digest.replace(/^sha256-/, '');
  if (!/^[a-f0-9]{64}$/.test(rawDigest)) throw new Error('ARTIFACT_DIGEST_INVALID');
  const row = await pool.query<{ package_id: string; version: string }>(
    'SELECT ce.package_id,ce.version FROM catalog_entries ce JOIN package_artifacts pa ON pa.artifact_digest=ce.artifact_digest WHERE ce.artifact_digest=$1 AND ce.state=$2 AND pa.state<>$3',
    [`sha256-${rawDigest}`, 'published', 'revoked']
  );
  if (!row.rowCount) throw new Error('ARTIFACT_NOT_PUBLISHED');
  const entitlement = await pool.query(
    'SELECT 1 FROM entitlements WHERE account_id=$1 AND package_id=$2 AND version=$3 AND state=$4',
    [input.accountId, row.rows[0]!.package_id, row.rows[0]!.version, 'active']
  );
  if (!entitlement.rowCount) throw new Error('ENTITLEMENT_REQUIRED');
  const expiresAt = new Date(Date.now() + Math.min(input.ttlMs ?? 300_000, 900_000)).toISOString();
  const ticketId = randomUUID();
  const digest = `sha256-${rawDigest}`;
  return {
    ticketId,
    digest,
    expiresAt,
    objectKey: artifactKey(rawDigest),
    ...(input.ticketSecret
      ? { proof: ticketProof(input.ticketSecret, ticketId, input.accountId, digest, expiresAt) }
      : {}),
  };
};
export const assertArtifactDownloadable = async (pool: Pool, accountId: string, digest: string): Promise<void> => {
  const rawDigest = digest.replace(/^sha256-/, '');
  if (!/^[a-f0-9]{64}$/.test(rawDigest)) throw new Error('ARTIFACT_DIGEST_INVALID');
  const row = await pool.query<{ package_id: string; version: string }>(
    'SELECT ce.package_id,ce.version FROM catalog_entries ce JOIN package_artifacts pa ON pa.artifact_digest=ce.artifact_digest WHERE ce.artifact_digest=$1 AND ce.state=$2 AND pa.state<>$3',
    [`sha256-${rawDigest}`, 'published', 'revoked']
  );
  if (!row.rowCount) throw new Error('ARTIFACT_NOT_PUBLISHED');
  const entitlement = await pool.query(
    'SELECT 1 FROM entitlements WHERE account_id=$1 AND package_id=$2 AND version=$3 AND state=$4',
    [accountId, row.rows[0]!.package_id, row.rows[0]!.version, 'active']
  );
  if (!entitlement.rowCount) throw new Error('ENTITLEMENT_REQUIRED');
};
