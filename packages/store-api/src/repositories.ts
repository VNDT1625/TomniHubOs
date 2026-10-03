import type { PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalCatalogPayload } from './publication.js';
export type StoreRepository = Readonly<{
  resolveAccount: (issuer: string, subject: string, client?: PoolClient) => Promise<string>;
  enrollPublisher: (accountId: string, namespace: string, client?: PoolClient) => Promise<Record<string, unknown>>;
  createSubmission: (
    input: Readonly<{
      accountId: string;
      publisherId: string;
      packageId: string;
      version: string;
      artifactDigest: string;
      manifestDigest: string;
      idempotencyKey: string;
    }>,
    client?: PoolClient
  ) => Promise<Record<string, unknown>>;
  listPendingReviews: (accountId: string, client?: PoolClient) => Promise<readonly Record<string, unknown>[]>;
  decideReview: (
    input: Readonly<{
      submissionId: string;
      reviewerAccountId: string;
      decision: 'approved' | 'rejected';
      artifactDigest: string;
      reason?: string;
    }>,
    client?: PoolClient
  ) => Promise<Record<string, unknown>>;
  authorizeCatalogPublication: (
    input: Readonly<{
      packageId: string;
      version: string;
      artifactDigest: string;
      publisherAccountId: string;
    }>,
    client?: PoolClient
  ) => Promise<void>;
  publishCatalog: (
    input: Readonly<{
      packageId: string;
      version: string;
      artifactDigest: string;
      offer?: unknown;
      publisherAccountId: string;
    }>,
    client?: PoolClient
  ) => Promise<Record<string, unknown>>;
  listCatalog: (client?: PoolClient) => Promise<readonly Record<string, unknown>[]>;
  catalogRevision: (client?: PoolClient) => Promise<number>;
  claimCheckout: (orderId: string, client?: PoolClient) => Promise<boolean>;
  setCheckoutSession: (
    orderId: string,
    provider: string,
    reference: string,
    url?: string,
    client?: PoolClient
  ) => Promise<void>;
  getCatalogEntry: (
    packageId: string,
    version: string,
    client?: PoolClient
  ) => Promise<Record<string, unknown> | undefined>;
  createOrder: (
    input: Readonly<{
      accountId: string;
      packageId: string;
      version: string;
      amountMinor: number;
      currency: string;
      idempotencyKey: string;
    }>,
    client?: PoolClient
  ) => Promise<Record<string, unknown>>;
  listEntitlements: (accountId: string, client?: PoolClient) => Promise<readonly Record<string, unknown>[]>;
}>;
const withClient = async <T>(
  client: PoolClient | undefined,
  pool: { connect: () => Promise<PoolClient> },
  fn: (c: PoolClient) => Promise<T>
): Promise<T> => {
  if (client) return fn(client);
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
};
export const createPostgresStoreRepository = (pool: { connect: () => Promise<PoolClient> }): StoreRepository => ({
  resolveAccount: async (issuer, subject, client) => {
    const resolve = async (c: PoolClient): Promise<string> => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [issuer, subject]);
      const found = await c.query<{ account_id: string }>(
        'SELECT account_id FROM external_identities WHERE issuer=$1 AND subject=$2',
        [issuer, subject]
      );
      if (found.rowCount) return found.rows[0]!.account_id;
      const created = await c.query<{ account_id: string }>('INSERT INTO accounts DEFAULT VALUES RETURNING account_id');
      const id = created.rows[0]!.account_id;
      const inserted = await c.query<{ account_id: string }>(
        'INSERT INTO external_identities(account_id,issuer,subject) VALUES($1,$2,$3) ON CONFLICT (issuer,subject) DO NOTHING RETURNING account_id',
        [id, issuer, subject]
      );
      if (inserted.rowCount) return inserted.rows[0]!.account_id;
      const raced = await c.query<{ account_id: string }>(
        'SELECT account_id FROM external_identities WHERE issuer=$1 AND subject=$2',
        [issuer, subject]
      );
      if (!raced.rowCount) throw new Error('ACCOUNT_RESOLUTION_FAILED');
      return raced.rows[0]!.account_id;
    };
    if (client) return resolve(client);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const accountId = await resolve(c);
      await c.query('COMMIT');
      return accountId;
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
  },
  enrollPublisher: (accountId, namespace, client) =>
    withClient(client, pool, async (c) => {
      const e = await c.query(
        'SELECT publisher_id,owner_account_id,namespace,status,authority_revision FROM publishers WHERE owner_account_id=$1',
        [accountId]
      );
      if (e.rowCount) return e.rows[0] as Record<string, unknown>;
      const p = (
        await c.query('INSERT INTO publishers(owner_account_id,namespace,status) VALUES($1,$2,$3) RETURNING *', [
          accountId,
          namespace,
          'active',
        ])
      ).rows[0] as Record<string, unknown>;
      await c.query('INSERT INTO publisher_members(publisher_id,account_id,role,status) VALUES($1,$2,$3,$4)', [
        p.publisher_id,
        accountId,
        'publisher',
        'active',
      ]);
      await c.query('INSERT INTO audit_events(actor_subject,action,payload_json) VALUES($1,$2,$3)', [
        accountId,
        'publisher.enrolled',
        JSON.stringify({ publisherId: p.publisher_id, namespace }),
      ]);
      return p;
    }),
  createSubmission: (i, client) =>
    withClient(client, pool, async (c) => {
      const e = await c.query('SELECT * FROM package_submissions WHERE publisher_id=$1 AND idempotency_key=$2', [
        i.publisherId,
        i.idempotencyKey,
      ]);
      const requestFingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            packageId: i.packageId,
            version: i.version,
            artifactDigest: i.artifactDigest,
            manifestDigest: i.manifestDigest,
          })
        )
        .digest('hex');
      if (e.rowCount) {
        if (e.rows[0]!.request_fingerprint && e.rows[0]!.request_fingerprint !== requestFingerprint)
          throw new Error('IDEMPOTENCY_KEY_CONFLICT');
        return e.rows[0] as Record<string, unknown>;
      }
      const m = await c.query(
        'SELECT 1 FROM publisher_members WHERE publisher_id=$1 AND account_id=$2 AND role=$3 AND status=$4',
        [i.publisherId, i.accountId, 'publisher', 'active']
      );
      if (!m.rowCount) throw new Error('PUBLISHER_MEMBERSHIP_REQUIRED');
      const a = await c.query(
        'SELECT 1 FROM package_artifacts WHERE artifact_digest=$1 AND package_id=$2 AND version=$3 AND state IN ($4,$5)',
        [i.artifactDigest, i.packageId, i.version, 'staged', 'authoritative']
      );
      if (!a.rowCount) throw new Error('ARTIFACT_NOT_STAGED');
      return (
        await c.query(
          'INSERT INTO package_submissions(publisher_id,package_id,version,artifact_digest,manifest_digest,idempotency_key,state,request_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
          [
            i.publisherId,
            i.packageId,
            i.version,
            i.artifactDigest,
            i.manifestDigest,
            i.idempotencyKey,
            'pending',
            requestFingerprint,
          ]
        )
      ).rows[0] as Record<string, unknown>;
    }),
  listPendingReviews: (accountId, client) =>
    withClient(client, pool, async (c) => {
      const reviewer = await c.query(
        'SELECT 1 FROM publisher_members WHERE account_id=$1 AND role IN ($2,$3) AND status=$4',
        [accountId, 'reviewer', 'administrator', 'active']
      );
      if (!reviewer.rowCount) throw new Error('REVIEWER_REQUIRED');
      return (await c.query('SELECT * FROM package_submissions WHERE state=$1 ORDER BY submitted_at ASC', ['pending']))
        .rows as Record<string, unknown>[];
    }),
  decideReview: (i, client) =>
    withClient(client, pool, async (c) => {
      const s = await c.query<{ publisher_id: string; artifact_digest: string; state: string }>(
        'SELECT publisher_id,artifact_digest,state FROM package_submissions WHERE submission_id=$1 FOR UPDATE',
        [i.submissionId]
      );
      if (!s.rowCount) throw new Error('SUBMISSION_NOT_FOUND');
      if (s.rows[0]!.state !== 'pending') {
        const prior = await c.query<{ decision: 'approved' | 'rejected'; artifact_digest: string }>(
          'SELECT decision,artifact_digest FROM package_reviews WHERE submission_id=$1 LIMIT 1',
          [i.submissionId]
        );
        if (
          prior.rowCount &&
          prior.rows[0]!.decision === i.decision &&
          prior.rows[0]!.artifact_digest === i.artifactDigest
        )
          return s.rows[0] as Record<string, unknown>;
        throw new Error('REVIEW_TERMINAL');
      }
      const own = await c.query(
        'SELECT 1 FROM publisher_members WHERE publisher_id=$1 AND account_id=$2 AND role=$3 AND status=$4',
        [s.rows[0]!.publisher_id, i.reviewerAccountId, 'publisher', 'active']
      );
      if (own.rowCount) throw new Error('REVIEW_SELF_APPROVAL_DENIED');
      const r = await c.query('SELECT 1 FROM publisher_members WHERE account_id=$1 AND role IN ($2,$3) AND status=$4', [
        i.reviewerAccountId,
        'reviewer',
        'administrator',
        'active',
      ]);
      if (!r.rowCount) throw new Error('REVIEWER_REQUIRED');
      if (s.rows[0]!.artifact_digest !== i.artifactDigest) throw new Error('REVIEW_DIGEST_MISMATCH');
      await c.query(
        'INSERT INTO package_reviews(submission_id,reviewer_account_id,decision,artifact_digest,reason) VALUES($1,$2,$3,$4,$5)',
        [i.submissionId, i.reviewerAccountId, i.decision, i.artifactDigest, i.reason ?? null]
      );
      await c.query(
        'INSERT INTO package_approvals(submission_id,reviewer_account_id,artifact_digest,decision,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [i.submissionId, i.reviewerAccountId, i.artifactDigest, i.decision, i.reason ?? null]
      );
      const decided = (
        await c.query('UPDATE package_submissions SET state=$1 WHERE submission_id=$2 RETURNING *', [
          i.decision,
          i.submissionId,
        ])
      ).rows[0] as Record<string, unknown>;
      await c.query('INSERT INTO audit_events(actor_subject,action,payload_json) VALUES($1,$2,$3)', [
        i.reviewerAccountId,
        `submission.${i.decision}`,
        JSON.stringify({ submissionId: i.submissionId, artifactDigest: i.artifactDigest, reason: i.reason ?? null }),
      ]);
      return decided;
    }),
  authorizeCatalogPublication: (i, client) =>
    withClient(client, pool, async (c) => {
      const reviewer = await c.query(
        'SELECT 1 FROM publisher_members WHERE account_id=$1 AND role IN ($2,$3) AND status=$4 LIMIT 1',
        [i.publisherAccountId, 'reviewer', 'administrator', 'active']
      );
      if (!reviewer.rowCount) throw new Error('REVIEWER_REQUIRED');
      const submission = await c.query(
        'SELECT 1 FROM package_submissions s JOIN package_artifacts a ON a.artifact_digest=s.artifact_digest WHERE s.package_id=$1 AND s.version=$2 AND s.artifact_digest=$3 AND s.state=$4 AND a.state IN ($5,$6)',
        [i.packageId, i.version, i.artifactDigest, 'approved', 'staged', 'authoritative']
      );
      if (!submission.rowCount) throw new Error('SUBMISSION_NOT_APPROVED');
    }),
  publishCatalog: (i, client) =>
    withClient(client, pool, async (c) => {
      const reviewer = await c.query(
        'SELECT 1 FROM publisher_members WHERE account_id=$1 AND role IN ($2,$3) AND status=$4 LIMIT 1',
        [i.publisherAccountId, 'reviewer', 'administrator', 'active']
      );
      if (!reviewer.rowCount) throw new Error('REVIEWER_REQUIRED');
      const a = await c.query(
        'SELECT s.submission_id,s.publisher_id FROM package_submissions s JOIN package_artifacts a ON a.artifact_digest=s.artifact_digest WHERE s.package_id=$1 AND s.version=$2 AND s.artifact_digest=$3 AND s.state=$4 AND a.state IN ($5,$6)',
        [i.packageId, i.version, i.artifactDigest, 'approved', 'staged', 'authoritative']
      );
      if (!a.rowCount) throw new Error('SUBMISSION_NOT_APPROVED');
      const existing = await c.query(
        'SELECT ce.publication_id,ce.artifact_digest,cp.revision FROM catalog_entries ce JOIN catalog_publications cp ON cp.publication_id=ce.publication_id WHERE ce.package_id=$1 AND ce.version=$2 AND ce.state=$3 LIMIT 1',
        [i.packageId, i.version, 'published']
      );
      if (existing.rowCount) {
        if (existing.rows[0]!.artifact_digest !== i.artifactDigest) throw new Error('CATALOG_VERSION_CONFLICT');
        return existing.rows[0] as Record<string, unknown>;
      }
      const sig = await c.query<{
        key_id: string;
        algorithm: string;
        signature: string;
        canonical_digest: string;
        signed_at: string;
      }>(
        'SELECT key_id,algorithm,signature,canonical_digest,signed_at FROM release_signatures WHERE artifact_digest=$1 ORDER BY signed_at DESC LIMIT 1',
        [i.artifactDigest]
      );
      if (!sig.rowCount) throw new Error('SIGNATURE_REQUIRED');
      const expectedCanonicalDigest = createHash('sha256')
        .update(
          canonicalCatalogPayload({
            packageId: i.packageId,
            version: i.version,
            artifactDigest: i.artifactDigest,
            offer: i.offer,
          })
        )
        .digest('hex');
      if (sig.rows[0]!.algorithm !== 'ed25519' || sig.rows[0]!.canonical_digest !== expectedCanonicalDigest)
        throw new Error('SIGNATURE_PAYLOAD_MISMATCH');
      await c.query("SELECT pg_advisory_xact_lock(hashtext('tomni_catalog_revision'))");
      const rev = await c.query<{ revision: string }>(
        'SELECT COALESCE(MAX(revision),0)+1 AS revision FROM catalog_publications'
      );
      const p = (
        await c.query(
          'INSERT INTO catalog_publications(revision,signer_key_id,signature,canonical_digest,state) VALUES($1,$2,$3,$4,$5) RETURNING *',
          [
            rev.rows[0]!.revision,
            sig.rows[0]!.key_id,
            sig.rows[0]!.signature,
            sig.rows[0]!.canonical_digest,
            'published',
          ]
        )
      ).rows[0] as Record<string, unknown>;
      await c.query(
        'INSERT INTO catalog_entries(package_id,version,artifact_digest,publication_id,offer_json,state) VALUES($1,$2,$3,$4,$5,$6)',
        [i.packageId, i.version, i.artifactDigest, p.publication_id, i.offer ?? null, 'published']
      );
      await c.query('INSERT INTO audit_events(actor_subject,action,payload_json) VALUES($1,$2,$3)', [
        i.publisherAccountId,
        'catalog.published',
        JSON.stringify({
          packageId: i.packageId,
          version: i.version,
          artifactDigest: i.artifactDigest,
          revision: p.revision,
        }),
      ]);
      await c.query('INSERT INTO outbox_events(topic,aggregate_id,payload_json,state) VALUES($1,$2,$3,$4)', [
        'catalog.published',
        String(p.publication_id),
        JSON.stringify({ packageId: i.packageId, version: i.version, artifactDigest: i.artifactDigest }),
        'pending',
      ]);
      return p;
    }),
  catalogRevision: (client) =>
    withClient(client, pool, async (c) => {
      const result = await c.query<{ revision: string }>(
        'SELECT COALESCE(MAX(revision),0) AS revision FROM catalog_publications WHERE state=$1',
        ['published']
      );
      return Number(result.rows[0]?.revision ?? 0);
    }),
  listCatalog: (client) =>
    withClient(
      client,
      pool,
      async (c) =>
        (
          await c.query(
            'SELECT ce.package_id,ce.version,ce.artifact_digest,ce.offer_json,ce.publication_id,cp.revision,rs.key_id,rs.algorithm,rs.signature,rs.signed_at FROM catalog_entries ce JOIN catalog_publications cp ON cp.publication_id=ce.publication_id JOIN release_signatures rs ON rs.artifact_digest=ce.artifact_digest AND rs.key_id=cp.signer_key_id AND rs.canonical_digest=cp.canonical_digest WHERE ce.state=$1 AND cp.state=$1 ORDER BY ce.package_id,ce.version',
            ['published']
          )
        ).rows as Record<string, unknown>[]
    ),
  getCatalogEntry: (packageId, version, client) =>
    withClient(client, pool, async (c) => {
      const result = await c.query(
        'SELECT ce.package_id,ce.version,ce.artifact_digest,ce.offer_json,ce.publication_id,cp.revision,rs.key_id,rs.algorithm,rs.signature,rs.signed_at FROM catalog_entries ce JOIN catalog_publications cp ON cp.publication_id=ce.publication_id JOIN release_signatures rs ON rs.artifact_digest=ce.artifact_digest AND rs.key_id=cp.signer_key_id AND rs.canonical_digest=cp.canonical_digest WHERE ce.package_id=$1 AND ce.version=$2 AND ce.state=$3 AND cp.state=$3 LIMIT 1',
        [packageId, version, 'published']
      );
      return result.rowCount ? (result.rows[0] as Record<string, unknown>) : undefined;
    }),
  claimCheckout: (orderId, client) =>
    withClient(client, pool, async (c) => {
      const result = await c.query(
        "UPDATE orders SET state='checkout_creating',checkout_claim_until=now()+interval '2 minutes' WHERE order_id=$1 AND state='created' RETURNING order_id",
        [orderId]
      );
      return Boolean(result.rowCount);
    }),
  setCheckoutSession: (orderId, provider, reference, url, client) =>
    withClient(client, pool, async (c) => {
      await c.query(
        'UPDATE orders SET state=$1,provider_checkout_id=$2,provider_checkout_url=$3,checkout_claim_until=NULL WHERE order_id=$4 AND state=$5',
        ['checkout_pending', `${provider}:${reference}`, url ?? null, orderId, 'checkout_creating']
      );
    }),
  createOrder: (i, client) =>
    withClient(client, pool, async (c) => {
      const requestFingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            packageId: i.packageId,
            version: i.version,
            amountMinor: i.amountMinor,
            currency: i.currency,
          })
        )
        .digest('hex');
      const existing = await c.query<{ request_fingerprint: string | null } & Record<string, unknown>>(
        'SELECT o.*,ce.offer_json FROM orders o JOIN catalog_entries ce ON ce.package_id=o.package_id AND ce.version=o.version WHERE o.account_id=$1 AND o.idempotency_key=$2',
        [i.accountId, i.idempotencyKey]
      );
      if (existing.rowCount) {
        if (existing.rows[0]!.request_fingerprint && existing.rows[0]!.request_fingerprint !== requestFingerprint)
          throw new Error('IDEMPOTENCY_KEY_CONFLICT');
        const replayOffer = existing.rows[0]!.offer_json;
        const replayProductId =
          replayOffer && typeof replayOffer === 'object' && !Array.isArray(replayOffer)
            ? (replayOffer as { productId?: unknown }).productId
            : undefined;
        if (typeof replayProductId !== 'string' || !replayProductId.trim()) throw new Error('CATALOG_OFFER_INVALID');
        return { ...existing.rows[0], provider_price_id: replayProductId } as Record<string, unknown>;
      }
      if (!Number.isSafeInteger(i.amountMinor) || i.amountMinor <= 0) throw new Error('PAYMENT_AMOUNT_INVALID');
      const catalog = await c.query<{ offer_json: unknown }>(
        'SELECT offer_json FROM catalog_entries WHERE package_id=$1 AND version=$2 AND state=$3',
        [i.packageId, i.version, 'published']
      );
      if (!catalog.rowCount) throw new Error('CATALOG_ENTRY_NOT_FOUND');
      const offer = catalog.rows[0]!.offer_json;
      let providerPriceId: string | undefined;
      if (offer && typeof offer === 'object' && !Array.isArray(offer)) {
        const price = (offer as { price?: unknown }).price;
        if (!price || typeof price !== 'object' || Array.isArray(price)) throw new Error('CATALOG_OFFER_INVALID');
        const expectedAmount = (price as { amountMinor?: unknown }).amountMinor;
        const expectedCurrency = (price as { currency?: unknown }).currency;
        const productId = (offer as { productId?: unknown }).productId;
        if (!Number.isSafeInteger(Number(expectedAmount)) || typeof expectedCurrency !== 'string')
          throw new Error('CATALOG_OFFER_INVALID');
        if (typeof productId !== 'string' || !productId.trim()) throw new Error('CATALOG_OFFER_INVALID');
        providerPriceId = productId;
        if (expectedAmount !== undefined && Number(expectedAmount) !== i.amountMinor)
          throw new Error('PAYMENT_AMOUNT_MISMATCH');
        if (typeof expectedCurrency === 'string' && expectedCurrency !== i.currency)
          throw new Error('PAYMENT_CURRENCY_MISMATCH');
      }
      const created = (
        await c.query(
          'INSERT INTO orders(account_id,package_id,version,amount_minor,currency,state,idempotency_key,request_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
          [
            i.accountId,
            i.packageId,
            i.version,
            i.amountMinor,
            i.currency,
            'created',
            i.idempotencyKey,
            requestFingerprint,
          ]
        )
      ).rows[0] as Record<string, unknown>;
      return { ...created, provider_price_id: providerPriceId };
    }),
  listEntitlements: (accountId, client) =>
    withClient(
      client,
      pool,
      async (c) =>
        (await c.query('SELECT * FROM entitlements WHERE account_id=$1 AND state=$2', [accountId, 'active']))
          .rows as Record<string, unknown>[]
    ),
});
export const newNamespace = (subject: string): string =>
  `publisher.${subject.slice(0, 24)}.${randomUUID().slice(0, 8)}`;
