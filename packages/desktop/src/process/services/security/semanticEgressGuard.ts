import { createHash } from 'node:crypto';

import type { KeyedSecretIndex } from './keyedSecretIndex';
import { inspectOutboundText } from './outboundTextInspection';
import {
  deriveFinalSecurityAction,
  isCanonicalSemanticSecurityEvidence,
  type SemanticSecurityEvidence,
  type SemanticSecurityPolicyState,
} from './semanticSecurityPolicy';

export type SemanticEgressModelOutput = SemanticSecurityEvidence;

export type SemanticEgressModel = (
  input: Readonly<{
    sanitizedPayload: string;
    contentHash: string;
    signal: AbortSignal;
  }>
) => Promise<unknown>;

export type SemanticEgressAudit = Readonly<{
  contentHash: string;
  policyVersion: string;
  modelVersion: string;
  classification: 'low' | 'gray' | 'high';
  decision: 'allow' | 'rewrite' | 'block';
  reasonCode: string;
  cacheHit: boolean;
  elapsedMs: number;
}>;

export type SemanticEgressResult = Readonly<{
  decision: 'allow' | 'rewrite' | 'block';
  serializedPayload?: string;
  audit: SemanticEgressAudit;
}>;

export type SemanticEgressGuard = Readonly<{
  inspect(
    input: Readonly<{
      serializedPayload: string;
      origin: string;
      policyVersion: string;
      modelVersion: string;
      ocrOrigin?: boolean;
      cacheScope?: Readonly<{ accountId: string; workspaceId: string; vaultRevision: string; destination: string }>;
      semanticPolicy?: SemanticSecurityPolicyState;
      signal?: AbortSignal;
    }>
  ): Promise<SemanticEgressResult>;
}>;

export type SemanticEgressGuardOptions = Readonly<{
  model?: SemanticEgressModel;
  keyedSecretIndex?: KeyedSecretIndex;
  now?: () => number;
  deadlineMs?: number;
  cacheTtlMs?: number;
}>;

type CachedLowRisk = Readonly<{ reasonCode: string; expiresAt: number }>;

const MAX_PAYLOAD_LENGTH = 1_000_000;

const DEFAULT_DEADLINE_MS = 30_000;
const highRisk = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:authorization|api[_-]?key|password|secret|token)\s*[:=]/iu;
const grayZone =
  /\b(?:ignore (?:all |previous )?instructions|system prompt|exfiltrat|upload (?:this|the) (?:file|data)|send (?:this|the) (?:file|data) to)\b/iu;

const contentHash = (payload: string): string => createHash('sha256').update(payload, 'utf8').digest('hex');
const cacheKey = (
  hash: string,
  policyVersion: string,
  modelVersion: string,
  origin: string,
  ocrOrigin: boolean,
  scope: Readonly<{ accountId: string; workspaceId: string; vaultRevision: string; destination: string }>
): string =>
  JSON.stringify([
    hash,
    policyVersion,
    modelVersion,
    origin,
    ocrOrigin ? 'ocr' : 'generated',
    scope.accountId,
    scope.workspaceId,
    scope.vaultRevision,
    scope.destination,
  ]);

/**
 * Main-only final-payload gate. Its cache stores hashes and decisions only; Trust
 * and destination checks remain mandatory after this guard returns.
 */
export const createSemanticEgressGuard = (options: SemanticEgressGuardOptions = {}): SemanticEgressGuard => {
  const now = options.now ?? Date.now;
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const cacheTtlMs = options.cacheTtlMs ?? 60_000;
  let unscopedRequest = 0;
  const cache = new Map<string, CachedLowRisk>();
  const inFlight = new Map<string, Promise<SemanticEgressResult>>();
  let queue = Promise.resolve();
  let queuedCount = 0;
  const MAX_QUEUED = 64;

  const inspect = async (
    input: Readonly<{
      serializedPayload: string;
      origin: string;
      policyVersion: string;
      modelVersion: string;
      ocrOrigin?: boolean;
      cacheScope?: Readonly<{ accountId: string; workspaceId: string; vaultRevision: string; destination: string }>;
      semanticPolicy?: SemanticSecurityPolicyState;
      signal?: AbortSignal;
    }>
  ): Promise<SemanticEgressResult> => {
    const startedAt = now();
    const hash = contentHash(input.serializedPayload);
    const finish = (
      decision: SemanticEgressResult['decision'],
      classification: SemanticEgressAudit['classification'],
      reasonCode: string,
      serializedPayload?: string,
      cacheHit = false
    ): SemanticEgressResult => ({
      decision,
      ...(serializedPayload === undefined ? {} : { serializedPayload }),
      audit: {
        contentHash: hash,
        policyVersion: input.policyVersion,
        modelVersion: input.modelVersion,
        classification,
        decision,
        reasonCode,
        cacheHit,
        elapsedMs: Math.max(0, now() - startedAt),
      },
    });

    if (
      !input.origin ||
      !input.policyVersion ||
      !input.modelVersion ||
      input.serializedPayload.length > MAX_PAYLOAD_LENGTH
    ) {
      return finish('block', 'high', 'invalid_final_payload');
    }
    const deterministic = await inspectOutboundText(
      {
        schemaVersion: 1,
        requestId: `semantic_${hash}`,
        actorId: 'main-egress',
        surface: 'provider',
        target: { kind: 'external-api', id: input.origin },
        parts: [{ id: 'serialized_payload', text: input.serializedPayload, source: 'generated' }],
        sensitivity: 'normal',
      },
      { allowSanitize: true, requireApprovalForFindings: false, policyVersion: input.policyVersion, now }
    );
    if (deterministic.decision === 'failed_closed' || deterministic.decision === 'block') {
      return finish('block', 'high', deterministic.reasonCode);
    }
    const sanitizedPayload = deterministic.safeParts[0]?.text;
    if (sanitizedPayload === undefined) return finish('block', 'high', 'deterministic_inspection_invalid');
    if (deterministic.decision === 'sanitize') {
      return finish('rewrite', 'high', 'deterministic_redaction', sanitizedPayload);
    }
    // Registered secrets are matched before semantic inference, even without delimiters.
    if (options.keyedSecretIndex?.hasInText(input.serializedPayload)) {
      if (input.cacheScope?.vaultRevision !== options.keyedSecretIndex.revision)
        return finish('block', 'high', 'registered_secret_index_stale');
      return finish('block', 'high', 'registered_secret_match');
    }
    if (highRisk.test(input.serializedPayload)) {
      return sanitizedPayload === input.serializedPayload
        ? finish('block', 'high', 'known_high_risk')
        : finish('rewrite', 'high', 'deterministic_redaction', sanitizedPayload);
    }

    // Snapshot caller scope before awaiting inference; missing identity disables reuse.
    const scope = input.cacheScope ? { ...input.cacheScope } : undefined;
    const reusable =
      scope !== undefined &&
      Object.values(scope).every((value) => typeof value === 'string' && value.trim().length > 0);
    const key = reusable
      ? cacheKey(hash, input.policyVersion, input.modelVersion, input.origin, input.ocrOrigin === true, scope)
      : `unscoped:${++unscopedRequest}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return finish('allow', 'low', cached.reasonCode, sanitizedPayload, true);
    if (cached) cache.delete(key);
    if (!input.ocrOrigin && !grayZone.test(sanitizedPayload)) {
      if (reusable && cacheTtlMs > 0) {
        while (cache.size >= 256) cache.delete(cache.keys().next().value as string);
        cache.set(key, { reasonCode: 'deterministic_low_risk', expiresAt: now() + cacheTtlMs });
      }
      return finish('allow', 'low', 'deterministic_low_risk', sanitizedPayload);
    }

    const existing = inFlight.get(key);
    if (existing) {
      const shared = await existing;
      return finish(shared.decision, shared.audit.classification, shared.audit.reasonCode, shared.serializedPayload);
    }
    const run = async (): Promise<SemanticEgressResult> => {
      const remaining = deadlineMs - (now() - startedAt);
      if (remaining <= 0 || !options.model)
        return finish('block', 'gray', remaining <= 0 ? 'semantic_deadline_exceeded' : 'semantic_model_unavailable');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), remaining);
      const onCallerAbort = (): void => controller.abort();
      input.signal?.addEventListener('abort', onCallerAbort, { once: true });
      try {
        const output = await Promise.race([
          options.model({ sanitizedPayload, contentHash: hash, signal: controller.signal }),
          new Promise<never>((_resolve, reject): void =>
            controller.signal.addEventListener('abort', () => reject(new Error('deadline')), { once: true })
          ),
        ]);
        if (!isCanonicalSemanticSecurityEvidence(output)) return finish('block', 'gray', 'semantic_model_invalid');
        const action = deriveFinalSecurityAction(output, input.semanticPolicy);
        if (action !== 'allow') return finish('block', 'gray', `semantic_policy_${action}`);
        return finish('allow', 'gray', 'semantic_policy_allow', sanitizedPayload);
      } catch {
        return finish(
          'block',
          'gray',
          input.signal?.aborted
            ? 'semantic_cancelled'
            : controller.signal.aborted
              ? 'semantic_deadline_exceeded'
              : 'semantic_model_failed'
        );
      } finally {
        clearTimeout(timeout);
        input.signal?.removeEventListener('abort', onCallerAbort);
      }
    };
    if (queuedCount >= MAX_QUEUED) return finish('block', 'gray', 'semantic_queue_full');
    queuedCount += 1;
    const queued = queue.then(run, run);
    inFlight.set(key, queued);
    queued
      .finally((): void => {
        if (inFlight.get(key) === queued) inFlight.delete(key);
        queuedCount = Math.max(0, queuedCount - 1);
      })
      .catch((): undefined => undefined);
    queue = queued.then(
      (): void => undefined,
      (): void => undefined
    );
    return queued;
  };

  return { inspect };
};
