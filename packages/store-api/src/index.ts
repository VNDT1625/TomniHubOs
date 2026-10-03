import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readStoreApiConfig } from './config.js';
import { createStoreDatabase } from './db.js';
import { createPostgresStoreRepository, newNamespace } from './repositories.js';
import { verifyPaddleWebhook } from './paddle.js';
import { createCommerceRepository } from './commerceRepository.js';
import { runPaddleReconciliation } from './reconciliation.js';
import { recoverStoreJobs } from './recovery.js';
import { assertArtifactDownloadable, issueDownloadTicket } from './artifactRepository.js';
import { createPaddlePaymentProvider, createPaddleRefundProvider } from './providers.js';
import { persistStagedArtifact } from './artifactMetadata.js';
import { validatePackageArchive } from './staging.js';
import { createGcsArtifactStore, createGcsMetadataTokenProvider } from './gcs.js';
import { createOutboxWorker } from './outboxWorker.js';
import { createRecoveryWorker, type RecoveryHandler } from './recoveryWorker.js';
import { replayPendingPaymentWebhook } from './pendingPaymentRecovery.js';

import { verifySupabaseJwt } from './auth.js';
import { signReleaseArtifact } from './publication.js';
import type { Ed25519Signer } from './signer.js';
import { createRemoteEd25519Signer } from './remoteSigner.js';

const json = (res: ServerResponse, status: number, value: unknown): void => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(value));
};
export const readBody = async (req: IncomingMessage, maxBytes = 2_000_000): Promise<Buffer> => {
  const contentLength = req.headers['content-length'];
  if (typeof contentLength === 'string') {
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared < 0) throw new Error('INVALID_CONTENT_LENGTH');
    if (declared > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const part = Buffer.from(chunk);
    total += part.byteLength;
    if (total > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(part);
  }
  return Buffer.concat(chunks);
};
const createJwksResolver = (config: ReturnType<typeof readStoreApiConfig>) => {
  let cached: readonly Record<string, unknown>[] | undefined;
  let expiresAt = 0;
  let inFlight: Promise<readonly Record<string, unknown>[]> | undefined;
  return async (): Promise<readonly Record<string, unknown>[]> => {
    if (cached && expiresAt > Date.now()) return cached;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const response = await fetch(config.jwksUrl);
      if (!response.ok) throw new Error('AUTH_JWKS_UNAVAILABLE');
      const document = (await response.json()) as { keys?: readonly Record<string, unknown>[] };
      if (!Array.isArray(document.keys) || document.keys.length === 0) throw new Error('AUTH_JWKS_INVALID');
      cached = document.keys;
      expiresAt = Date.now() + 5 * 60_000;
      return cached;
    })();
    try {
      return await inFlight;
    } finally {
      inFlight = undefined;
    }
  };
};
const requireActor = async (
  req: IncomingMessage,
  config: ReturnType<typeof readStoreApiConfig>,
  resolveJwks: () => Promise<readonly Record<string, unknown>[]>
): Promise<string> => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ') || header.length < 16) throw new Error('AUTH_REQUIRED');
  return verifySupabaseJwt(header.slice(7), {
    issuer: config.supabaseIssuer,
    audience: config.supabaseAudience,
    jwks: await resolveJwks(),
  }).subject;
};
const requiredString = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(code);
  return value;
};
export const decodeBase64 = (value: string): Buffer => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error('ARTIFACT_BASE64_INVALID');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength > 50 * 1024 * 1024 || bytes.toString('base64') !== value)
    throw new Error('ARTIFACT_BASE64_INVALID');
  return bytes;
};

const requiredIdempotencyKey = (input: Record<string, unknown>, req: IncomingMessage): string => {
  const bodyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey : undefined;
  const headerValue = req.headers['idempotency-key'];
  const headerKey = typeof headerValue === 'string' ? headerValue : undefined;
  if (bodyKey !== undefined && headerKey !== undefined && bodyKey !== headerKey)
    throw new Error('IDEMPOTENCY_KEY_CONFLICT');
  const candidate = bodyKey ?? headerKey;
  if (typeof candidate !== 'string' || !/^[A-Za-z0-9._:-]{8,200}$/.test(candidate))
    throw new Error('IDEMPOTENCY_KEY_REQUIRED');
  return candidate;
};

const requiredPositiveAmount = (value: unknown): number => {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('PAYMENT_AMOUNT_INVALID');
  return amount;
};
export const internalAuthorized = (
  req: IncomingMessage,
  env: Readonly<Record<string, string | undefined>>
): boolean => {
  const expected = env.STORE_INTERNAL_TOKEN;
  const provided = req.headers['x-store-internal-token'];
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
};
const parseJson = (raw: Buffer): Record<string, unknown> => {
  const value = JSON.parse(raw.toString('utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON_OBJECT_REQUIRED');
  return value as Record<string, unknown>;
};
export const statusForStoreError = (code: string): number => {
  if (code === 'AUTH_REQUIRED' || code.startsWith('AUTH_INVALID')) return 401;
  if (code === 'REVIEWER_REQUIRED' || code.endsWith('DENIED') || code === 'INTERNAL_AUTH_REQUIRED') return 403;
  if (code.endsWith('NOT_FOUND') || code === 'CATALOG_ENTRY_NOT_FOUND' || code === 'NOT_FOUND') return 404;
  if (code.includes('IDEMPOTENCY_KEY_CONFLICT') || code.endsWith('VERSION_CONFLICT') || code === 'REVIEW_TERMINAL')
    return 409;
  if (code === 'PAYLOAD_TOO_LARGE') return 413;
  if (
    code.endsWith('NOT_CONFIGURED') ||
    code.includes('UNAVAILABLE') ||
    code.startsWith('PADDLE_PROVIDER_') ||
    code === 'OUTBOX_HANDLER_NOT_CONFIGURED'
  )
    return 503;
  return 400;
};
export type StoreApiServerOptions = Readonly<{
  outboxHandlers?: Readonly<Record<string, import('./outboxWorker.js').OutboxHandler>>;
  recoveryHandlers?: Readonly<Record<string, RecoveryHandler>>;
  signer?: Ed25519Signer;
}>;
const unconfiguredOutboxHandler = async (): Promise<void> => {
  throw new Error('OUTBOX_HANDLER_NOT_CONFIGURED');
};
export const createStoreApiServer = (
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: StoreApiServerOptions = {}
) => {
  const config = readStoreApiConfig(env);
  const signer =
    options.signer ??
    (env.STORE_SIGNER_ENDPOINT && env.STORE_SIGNER_KEY_ID && env.STORE_SIGNER_TOKEN
      ? createRemoteEd25519Signer({
          endpoint: env.STORE_SIGNER_ENDPOINT,
          keyId: env.STORE_SIGNER_KEY_ID,
          accessToken: env.STORE_SIGNER_TOKEN,
        })
      : undefined);
  if (config.nodeEnv === 'production' && !signer) throw new Error('STORE_API_CONFIG_MISSING:PACKAGE_SIGNER');
  const database = createStoreDatabase(config.databaseUrl, {
    max: config.dbPoolMax,
    idleTimeoutMillis: config.dbIdleTimeoutMs,
    connectionTimeoutMillis: config.dbConnectionTimeoutMs,
  });
  const repo = createPostgresStoreRepository(database.pool);
  const commerce = createCommerceRepository(database.pool);
  const resolveJwks = createJwksResolver(config);

  const outboxWorker =
    env.STORE_WORKER_ENABLED === 'true'
      ? createOutboxWorker(
          database.pool,
          options.outboxHandlers ?? {
            'catalog.published': unconfiguredOutboxHandler,
            'entitlement.issued': unconfiguredOutboxHandler,
            'refund.requested': unconfiguredOutboxHandler,
            'refund.confirmed': unconfiguredOutboxHandler,
          },
          `store-api-${process.pid}`
        )
      : undefined;
  const recoveryWorker =
    env.STORE_RECOVERY_WORKER_ENABLED === 'true'
      ? createRecoveryWorker(
          database.pool,
          options.recoveryHandlers ?? {
            'payment-webhook-prerequisite': async (job) => {
              await replayPendingPaymentWebhook(database.pool, commerce, job.aggregate_id);
            },
          },
          `store-recovery-${process.pid}`
        )
      : undefined;
  const recoveryTimer = recoveryWorker
    ? setInterval(
        () =>
          void recoveryWorker.runOnce().catch((error: unknown) => console.error('store recovery worker failed', error)),
        5_000
      )
    : undefined;
  recoveryTimer?.unref?.();

  if (recoveryWorker)
    void recoveryWorker.runOnce().catch((error: unknown) => console.error('store recovery worker failed', error));
  const server = createServer(async (req, res) => {
    const requestId =
      typeof req.headers['x-request-id'] === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(req.headers['x-request-id'])
        ? req.headers['x-request-id']
        : randomUUID();
    res.setHeader('x-request-id', requestId);
    const startedAt = Date.now();
    let actorSubject: string | undefined;
    let actorAccountId: string | undefined;
    res.once('finish', () => {
      console.log(
        JSON.stringify({
          request_id: requestId,
          route: (req.url ?? '/').split('?')[0],
          method: req.method,
          status: res.statusCode,
          duration_ms: Date.now() - startedAt,
          ...(actorSubject ? { actor_subject: actorSubject } : {}),
          ...(actorAccountId ? { account_id: actorAccountId } : {}),
        })
      );
    });
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/health/live'))
        return json(res, 200, { ok: true, service: 'tomni-store-api' });
      if (req.method === 'GET' && url.pathname === '/health/ready') {
        await database.health();
        return json(res, 200, { ok: true, ready: true });
      }
      if (req.method === 'POST' && url.pathname === '/v1/webhooks/paddle') {
        const raw = await readBody(req);
        const secret = env.PADDLE_WEBHOOK_SECRET;
        if (!secret) throw new Error('PADDLE_NOT_CONFIGURED');
        verifyPaddleWebhook(raw, String(req.headers['paddle-signature'] ?? ''), secret);
        const payloadHash = createHash('sha256').update(raw).digest('hex');
        const event = parseJson(raw);
        const eventId = requiredString(event.event_id, 'PADDLE_EVENT_ID_REQUIRED');
        const eventType = requiredString(event.event_type, 'PADDLE_EVENT_TYPE_REQUIRED');
        if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data))
          throw new Error('PADDLE_DATA_INVALID');
        const data = event.data as Record<string, unknown>;
        if (eventType === 'transaction.completed') {
          const custom = data.custom_data as Record<string, unknown> | undefined;
          const totals = (data.details as Record<string, unknown> | undefined)?.totals as
            | Record<string, unknown>
            | undefined;
          return json(
            res,
            200,
            await commerce.applyCapturedPayment({
              providerEventId: eventId,
              orderId: requiredString(custom?.order_id, 'PADDLE_ORDER_ID_REQUIRED'),
              provider: 'paddle',
              providerReference: requiredString(data.id, 'PADDLE_PROVIDER_REFERENCE_REQUIRED'),
              amountMinor: requiredPositiveAmount(totals?.total),
              currency: requiredString(data.currency_code, 'PADDLE_CURRENCY_REQUIRED'),
              actorSubject: 'paddle',
              payloadHash,
            })
          );
        }
        if (eventType === 'adjustment.updated' && data.status === 'approved') {
          const custom = data.custom_data as Record<string, unknown> | undefined;
          return json(
            res,
            200,
            await commerce.confirmRefund({
              providerEventId: eventId,
              refundId: requiredString(custom?.refund_id, 'PADDLE_REFUND_ID_REQUIRED'),
              providerRefundId: requiredString(data.id, 'PADDLE_PROVIDER_REFUND_ID_REQUIRED'),
              actorSubject: 'paddle',
              payloadHash,
            })
          );
        }
        return json(res, 202, { ok: true, accepted: true });
      }
      if (
        req.method === 'POST' &&
        (url.pathname === '/internal/reconciliation' || url.pathname === '/internal/recovery')
      ) {
        if (!internalAuthorized(req, env)) return json(res, 403, { code: 'INTERNAL_AUTH_REQUIRED' });
        if (url.pathname === '/internal/reconciliation')
          return json(res, 200, await runPaddleReconciliation(database.pool, 'paddle'));
        return json(res, 200, await recoverStoreJobs(database.pool));
      }
      const subject = await requireActor(req, config, resolveJwks);
      const accountId = await repo.resolveAccount(config.supabaseIssuer, subject);
      actorSubject = subject;
      actorAccountId = accountId;
      if (req.method === 'POST' && url.pathname === '/v1/publishers/enroll') {
        const publisher = await database.transaction((client) =>
          repo.enrollPublisher(accountId, newNamespace(accountId), client)
        );
        return json(res, 201, publisher);
      }
      if (req.method === 'POST' && url.pathname === '/v1/publisher-artifacts/stage') {
        // Base64 adds ~33% overhead; keep the request bounded while allowing the 50 MB artifact cap.
        const input = parseJson(await readBody(req, 70 * 1024 * 1024));
        const encoded = requiredString(input.bytesBase64, 'ARTIFACT_BYTES_REQUIRED');
        const bytes = decodeBase64(encoded);
        validatePackageArchive(bytes, env.STORE_REQUIRE_ARCHIVE === 'true');
        if (config.nodeEnv === 'production' && !env.GCS_BUCKET) throw new Error('ARTIFACT_STORAGE_NOT_CONFIGURED');

        const authoritativeStore = env.GCS_BUCKET
          ? createGcsArtifactStore({
              bucket: env.GCS_BUCKET,
              ...(env.GCS_ACCESS_TOKEN
                ? { accessToken: env.GCS_ACCESS_TOKEN }
                : { accessTokenProvider: createGcsMetadataTokenProvider() }),
            })
          : undefined;

        const staged = await persistStagedArtifact(database.pool, {
          accountId,
          bytes,
          packageId: requiredString(input.packageId, 'PACKAGE_ID_REQUIRED'),
          version: requiredString(input.version, 'PACKAGE_VERSION_REQUIRED'),
          manifestDigest: requiredString(input.manifestDigest, 'MANIFEST_DIGEST_REQUIRED'),
          authoritativeStore,
        });
        return json(res, 201, staged);
      }

      if (req.method === 'POST' && url.pathname === '/v1/submissions') {
        const input = parseJson(await readBody(req));
        const result = await database.transaction((client) =>
          repo.createSubmission(
            {
              accountId,
              publisherId: String(input.publisherId ?? ''),
              packageId: String(input.packageId ?? ''),
              version: String(input.version ?? ''),
              artifactDigest: String(input.artifactDigest ?? ''),
              manifestDigest: String(input.manifestDigest ?? ''),
              idempotencyKey: requiredIdempotencyKey(input, req),
            },
            client
          )
        );
        return json(res, 201, result);
      }
      if (req.method === 'GET' && url.pathname === '/v1/reviews')
        return json(res, 200, { items: await repo.listPendingReviews(accountId) });
      const review = url.pathname.match(/^\/v1\/reviews\/([^/]+)\/(approve|reject)$/);
      if (req.method === 'POST' && review) {
        const input = parseJson(await readBody(req));
        const result = await database.transaction((client) =>
          repo.decideReview(
            {
              submissionId: review[1]!,
              reviewerAccountId: accountId,
              decision: review[2] as 'approved' | 'rejected',
              artifactDigest: String(input.artifactDigest ?? ''),
              reason: typeof input.reason === 'string' ? input.reason : undefined,
            },
            client
          )
        );
        return json(res, 200, result);
      }
      if (req.method === 'POST' && url.pathname === '/v1/catalog/publications') {
        const input = parseJson(await readBody(req));
        await database.transaction((client) =>
          repo.authorizeCatalogPublication(
            {
              packageId: String(input.packageId ?? ''),
              version: String(input.version ?? ''),
              artifactDigest: String(input.artifactDigest ?? ''),
              publisherAccountId: accountId,
            },
            client
          )
        );
        if (!signer) throw new Error('SIGNER_NOT_CONFIGURED');
        await signReleaseArtifact(database.pool, signer, {
          packageId: String(input.packageId ?? ''),
          version: String(input.version ?? ''),
          artifactDigest: String(input.artifactDigest ?? ''),
          offer: input.offer,
        });
        const result = await database.transaction((client) =>
          repo.publishCatalog(
            {
              packageId: String(input.packageId ?? ''),
              version: String(input.version ?? ''),
              artifactDigest: String(input.artifactDigest ?? ''),
              offer: input.offer,
              publisherAccountId: accountId,
            },
            client
          )
        );
        return json(res, 201, result);
      }
      if (req.method === 'GET' && url.pathname === '/v1/catalog') {
        const items = await repo.listCatalog();
        const revision = await repo.catalogRevision();
        return json(res, 200, { revision, items });
      }
      const catalogEntry = url.pathname.match(/^\/v1\/catalog\/([^/]+)\/([^/]+)$/);
      if (req.method === 'GET' && catalogEntry) {
        const entry = await repo.getCatalogEntry(
          decodeURIComponent(catalogEntry[1]!),
          decodeURIComponent(catalogEntry[2]!)
        );
        if (!entry) return json(res, 404, { code: 'CATALOG_ENTRY_NOT_FOUND' });
        return json(res, 200, entry);
      }
      if (req.method === 'POST' && url.pathname === '/v1/checkout') {
        const input = parseJson(await readBody(req));
        const result = await database.transaction((client) =>
          repo.createOrder(
            {
              accountId,
              packageId: String(input.packageId ?? ''),
              version: String(input.version ?? ''),
              amountMinor: Number(input.amountMinor ?? 0),
              currency: String(input.currency ?? 'USD'),
              idempotencyKey: requiredIdempotencyKey(input, req),
            },
            client
          )
        );
        const checkoutProvider = env.PADDLE_API_KEY
          ? createPaddlePaymentProvider({ apiKey: env.PADDLE_API_KEY })
          : undefined;
        if (!checkoutProvider) return json(res, 201, { order: result, provider: 'paddle', checkoutConfigured: false });
        if (result.replayed) return json(res, 200, { ...result, replayed: true });
        if (typeof result.provider_checkout_id === 'string' && result.provider_checkout_id.startsWith('paddle:')) {
          const reference = result.provider_checkout_id.slice('paddle:'.length);
          return json(res, 200, {
            order: result,
            checkout: {
              provider: 'paddle',
              reference,
              ...(result.provider_checkout_url ? { url: result.provider_checkout_url } : {}),
            },
            replayed: true,
          });
        }
        const claimed = await repo.claimCheckout(String(result.order_id));
        if (!claimed) return json(res, 202, { order: result, checkoutPending: true, replayed: true });
        const session = await checkoutProvider.createCheckout({
          orderId: String(result.order_id),
          amountMinor: Number(result.amount_minor),
          currency: String(result.currency),
          packageId: String(result.package_id),
          version: String(result.version),
          priceId: requiredString(result.provider_price_id, 'PADDLE_PRICE_ID_REQUIRED'),
        });
        await repo.setCheckoutSession(String(result.order_id), session.provider, session.reference, session.url);
        return json(res, 201, { order: { ...result, state: 'checkout_pending' }, checkout: session });
      }
      const download = url.pathname.match(/^\/v1\/artifacts\/([^/]+)\/download-ticket$/);
      const artifactDownload = url.pathname.match(/^\/v1\/artifacts\/([^/]+)\/download$/);
      if (req.method === 'GET' && artifactDownload) {
        const secret = env.DOWNLOAD_TICKET_SECRET;
        const bucket = env.GCS_BUCKET;
        const accessToken = env.GCS_ACCESS_TOKEN;
        if (!secret || !bucket) throw new Error('ARTIFACT_DOWNLOAD_NOT_CONFIGURED');
        const digest = decodeURIComponent(artifactDownload[1]!);
        const objectKey = 'sha256/' + digest.replace(/^sha256-/, '');
        const { verifyDownloadTicket } = await import('./artifactRepository.js');
        const ticket = {
          ticketId: url.searchParams.get('ticketId') ?? '',
          digest,
          expiresAt: url.searchParams.get('expiresAt') ?? '',
          objectKey,
          proof: url.searchParams.get('proof') ?? undefined,
        };
        if (!verifyDownloadTicket(ticket, accountId, secret)) throw new Error('DOWNLOAD_TICKET_INVALID');
        await assertArtifactDownloadable(database.pool, accountId, digest);
        const bytes = await createGcsArtifactStore({
          bucket,
          ...(accessToken ? { accessToken } : { accessTokenProvider: createGcsMetadataTokenProvider() }),
        }).download(objectKey);
        const expectedDigest = digest.replace(/^sha256-/, '');
        const actualDigest = createHash('sha256').update(bytes).digest('hex');
        if (actualDigest !== expectedDigest) throw new Error('ARTIFACT_DIGEST_MISMATCH');
        res.statusCode = 200;
        res.setHeader('content-type', 'application/octet-stream');
        res.end(Buffer.from(bytes));
        return;
      }

      if (req.method === 'POST' && download) {
        if (env.NODE_ENV === 'production' && !env.DOWNLOAD_TICKET_SECRET)
          throw new Error('DOWNLOAD_TICKET_SIGNING_NOT_CONFIGURED');
        const ticket = await issueDownloadTicket(database.pool, {
          accountId,
          digest: decodeURIComponent(download[1]!),
          ticketSecret: env.DOWNLOAD_TICKET_SECRET,
        });
        return json(res, 200, ticket);
      }
      if (req.method === 'GET' && url.pathname === '/v1/entitlements')
        return json(res, 200, { items: await repo.listEntitlements(accountId) });
      if (req.method === 'POST' && url.pathname === '/v1/refunds') {
        const input = parseJson(await readBody(req));
        const result = await commerce.requestRefund({
          accountId,
          orderId: String(input.orderId ?? ''),
          amountMinor: Number(input.amountMinor ?? 0),
          reason: String(input.reason ?? 'customer-request'),
          currency: String(input.currency ?? 'USD'),
          actorSubject: subject,
          idempotencyKey: requiredIdempotencyKey(input, req),
        });
        if (result.replayed) return json(res, 200, { ...result, replayed: true });
        if (!env.PADDLE_API_KEY) return json(res, 202, result);
        const provider = createPaddleRefundProvider({ apiKey: env.PADDLE_API_KEY });
        const providerResult = await provider.requestRefund({
          orderId: result.providerTransactionId,
          amountMinor: Number(input.amountMinor ?? 0),
          currency: String(input.currency ?? 'USD'),
        });
        await database.transaction(async (client) => {
          const updated = await client.query(
            'UPDATE refunds SET provider_refund_id=$1 WHERE refund_id=$2 AND state=$3',
            [providerResult.reference, result.refundId, 'requested']
          );
          if (!updated.rowCount) throw new Error('REFUND_STATE_CHANGED');
        });
        return json(res, 202, { ...result, providerReference: providerResult.reference });
      }

      return json(res, 404, { code: 'NOT_FOUND' });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'STORE_API_ERROR';
      console.log(
        JSON.stringify({
          request_id: requestId,
          route: req.url,
          method: req.method,
          duration_ms: Date.now() - startedAt,
          result: 'error',
          ...(actorSubject ? { actor_subject: actorSubject } : {}),
          ...(actorAccountId ? { account_id: actorAccountId } : {}),
        })
      );
      return json(res, statusForStoreError(code), { code });
    }
  });
  return {
    server,
    close: async () => {
      outboxWorker?.stop();
      if (recoveryTimer) clearInterval(recoveryTimer);
      await database.close();
    },
    config,
  };
};
if (import.meta.main) {
  const api = createStoreApiServer();
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = new Promise<void>((resolve, reject) => {
      api.server.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
          reject(error);
          return;
        }
        void api.close().then(resolve, reject);
      });
    });
    return shutdownPromise;
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  api.server.listen(api.config.port, '0.0.0.0');
}
