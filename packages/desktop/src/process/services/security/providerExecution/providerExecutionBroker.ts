import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

import type { IProvider } from '@/common/config/storage';
import type { FoundationTrustRuntime } from '@process/foundation/runKernel';
import type { IProviderStore } from '@process/services/tomnyProviderStore';
import {
  ProviderDestinationAuthorityError,
  type ProviderDestinationAuthority,
} from '@process/services/security/providerExecution/providerDestinationAuthority';
import {
  assertProviderDiscoveryDestination,
  type ProviderDnsLookup,
} from '@process/services/security/providerDiscovery/providerDiscoveryBridge';
import type { ChatMessageInput } from '@process/services/agentChat/types';
import { createSemanticEgressGuard, type SemanticEgressGuard } from '@process/services/security/semanticEgressGuard';
import type { SemanticEgressAuditSink } from '@process/services/security/semanticEgressAuditSink';

const PROVIDER_EXECUTION_ORIGIN = 'tomny://provider-execution';
const PROVIDER_EXECUTION_TIMEOUT_MS = 90_000;
const MAX_PROVIDER_REQUEST_BYTES = 1_048_576;
const MAX_PROVIDER_RESPONSE_BYTES = 1_048_576;

export type ProviderExecutionBrokerErrorCode =
  | 'PROVIDER_EXECUTION_ABORTED'
  | 'PROVIDER_EXECUTION_DENIED'
  | 'PROVIDER_EXECUTION_INVALID_DESTINATION'
  | 'PROVIDER_EXECUTION_REQUEST_TOO_LARGE'
  | 'PROVIDER_EXECUTION_RESPONSE_TOO_LARGE'
  | 'PROVIDER_EXECUTION_NETWORK_FAILED'
  | 'PROVIDER_EXECUTION_TIMEOUT'
  | 'PROVIDER_EXECUTION_RESPONSE_INVALID'
  | 'PROVIDER_EXECUTION_UNAVAILABLE';

/** Only this stable, redacted error can cross a provider execution boundary. */
export class ProviderExecutionBrokerError extends Error {
  public constructor(public readonly code: ProviderExecutionBrokerErrorCode) {
    super(code);
    this.name = 'ProviderExecutionBrokerError';
  }
}

export type ProviderExecutionRequest = Readonly<{
  model: string;
  messages: readonly ChatMessageInput[];
  signal?: AbortSignal;
}>;

/** Provider secret values never occur in this result or its evidence reference. */
export type ProviderExecutionUsage = Readonly<{
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
}>;
export type ProviderExecutionResult = Readonly<{
  content: string;
  evidenceRef: string;
  /** Stable provider catalog identity; never contains the provider credential. */
  providerId: string;
  usage?: ProviderExecutionUsage;
}>;

export type ProviderExecutionBrokerOptions = Readonly<{
  trustRuntime: FoundationTrustRuntime;
  providerStore: Pick<IProviderStore, 'list' | 'get'>;
  /** Missing authority deliberately keeps dynamic BYOK egress disabled. */
  destinationAuthority?: ProviderDestinationAuthority;
  /** Main-owned online-session resolver. A renderer identity is never accepted. */
  actorId: () => string;
  /** Main-owned cache scope; omitted scope disables verdict reuse. */
  semanticCacheScope?: (
    input: Readonly<{ accountId: string; destination: string }>
  ) => Readonly<{ workspaceId: string; vaultRevision: string }> | undefined;
  dnsLookup?: ProviderDnsLookup;
  newId?: () => string;
  /** Local semantic inspection has no Trust authority and fails closed for gray-zone payloads when unavailable. */
  semanticEgressGuard?: SemanticEgressGuard;
  semanticModelVersion?: string;
  /** Missing or unwritable durable classification evidence denies egress before final Trust. */
  semanticEgressAuditSink?: SemanticEgressAuditSink;
  /** Main-only credential resolver; OAuth providers never expose tokens through IProvider.api_key. */
  resolveProviderCredential?: (provider: IProvider) => Promise<string | undefined>;
  timeoutMs?: number;
}>;

type SelectedProvider = Readonly<{ providerId: string; model: string }>;
type ProviderHttpResponse = Readonly<{ status: number; body: string }>;

const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8');
const nonNegativeCount = (value: unknown): number | undefined =>
  Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : undefined;

const nestedUsageCount = (
  usage: Record<string, unknown> | undefined,
  keys: readonly string[],
  field: string
): number | undefined => {
  for (const key of keys) {
    const detail = usage?.[key];
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) continue;
    const count = nonNegativeCount((detail as Record<string, unknown>)[field]);
    if (count !== undefined) return count;
  }
  return undefined;
};

const firstProviderApiKey = (apiKeys: string): string =>
  apiKeys
    .split(/[,\n]/u)
    .map((key) => key.trim())
    .find(Boolean) ?? '';

const isProviderModelEnabled = (provider: IProvider, model: string): boolean =>
  provider.model_enabled?.[model] !== false;

const isUsableProvider = (provider: IProvider): boolean =>
  provider.enabled !== false &&
  (provider.auth_type === 'oauth' || Boolean(provider.api_key)) &&
  Boolean(provider.base_url) &&
  Array.isArray(provider.models) &&
  provider.models.length > 0;

const selectProvider = (providers: readonly IProvider[], requestedModel: string): SelectedProvider | undefined => {
  const usable = providers.filter(isUsableProvider);
  const owner = usable.find(
    (provider) => provider.models.includes(requestedModel) && isProviderModelEnabled(provider, requestedModel)
  );
  if (owner) return { providerId: owner.id, model: requestedModel };
  for (const provider of usable) {
    const fallback = provider.models.find((model) => isProviderModelEnabled(provider, model)) ?? provider.models[0];
    if (fallback) return { providerId: provider.id, model: fallback };
  }
  return undefined;
};

const resolveProviderChatUrl = (provider: IProvider): string => {
  if (provider.is_full_url) return provider.base_url.replace(/\/+$/u, '');
  const base = provider.base_url.replace(/\/+$/u, '');
  const platform = provider.platform?.toLowerCase();
  if (platform === 'anthropic') return `${base}/v1/messages`;
  if (platform === 'gemini' || platform === 'gemini-vertex-ai') return `${base}/v1beta/models`;
  return `${base}/chat/completions`;
};

const messageText = (content: ChatMessageInput['content']): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
  }
  return '';
};

const formatAnthropicPayload = (model: string, messages: readonly ChatMessageInput[]): Record<string, unknown> => {
  let systemPrompt: string | undefined;
  const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    const role = msg.role.toLowerCase();
    const text = messageText(msg.content);
    if (role === 'system') {
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${text}` : text;
    } else {
      const normalizedRole: 'user' | 'assistant' = role === 'assistant' ? 'assistant' : 'user';
      const last = anthropicMessages[anthropicMessages.length - 1];
      if (last && last.role === normalizedRole) {
        last.content += `\n\n${text}`;
      } else {
        anthropicMessages.push({ role: normalizedRole, content: text });
      }
    }
  }

  if (anthropicMessages.length === 0 || anthropicMessages[0].role !== 'user') {
    anthropicMessages.unshift({ role: 'user', content: 'Hello' });
  }

  return {
    model,
    max_tokens: 4096,
    messages: anthropicMessages,
    ...(systemPrompt ? { system: systemPrompt } : {}),
  };
};

const formatGeminiPayload = (model: string, messages: readonly ChatMessageInput[]): Record<string, unknown> => {
  const contents = messages.map((msg) => ({
    role: msg.role.toLowerCase() === 'assistant' ? 'model' : 'user',
    parts: [{ text: messageText(msg.content) }],
  }));
  return {
    model,
    contents,
  };
};

const formatProviderPayload = (
  provider: IProvider,
  model: string,
  messages: readonly ChatMessageInput[]
): Record<string, unknown> => {
  const platform = provider.platform?.toLowerCase();
  if (platform === 'anthropic') {
    return formatAnthropicPayload(model, messages);
  }
  if (platform === 'gemini' || platform === 'gemini-vertex-ai') {
    return formatGeminiPayload(model, messages);
  }
  return isResponsesEndpoint(provider) ? { model, input: messages, stream: false } : { model, messages, stream: false };
};

const buildProviderHeaders = (provider: IProvider, apiKey: string, body: string): Record<string, string> => {
  const platform = provider.platform?.toLowerCase();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'content-length': String(byteLength(body)),
  };
  if (platform === 'anthropic') {
    if (apiKey) headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (platform === 'gemini' || platform === 'gemini-vertex-ai') {
    if (apiKey) headers['x-goog-api-key'] = apiKey;
  } else {
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  }
  return headers;
};

const isResponsesEndpoint = (provider: IProvider): boolean => provider.base_url.trim().endsWith('/responses');

const extractResponseContent = (parsed: Record<string, unknown>): string | undefined => {
  const output = parsed.output;
  if (!Array.isArray(output)) return undefined;
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === 'string') chunks.push(text);
    }
  }
  return chunks.length > 0 ? chunks.join('') : undefined;
};
const isIpv6 = (address: string): boolean => address.includes(':');

const assertNotAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_ABORTED');
};

/**
 * Opens one post body only after destination validation. DNS is pinned to the
 * address inspected for this request; Node transport never follows redirects.
 */
const postPinnedProviderRequest = async (
  urlValue: string,
  headers: Record<string, string>,
  body: string,
  signal: AbortSignal,
  timeoutMs: number,
  resolveDns: ProviderDnsLookup | undefined
): Promise<ProviderHttpResponse> => {
  const destination = await assertProviderDiscoveryDestination(urlValue, resolveDns);
  assertNotAborted(signal);
  const address = destination.addresses[0];
  if (!address) throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_INVALID_DESTINATION');
  const transport = destination.url.protocol === 'https:' ? https : http;

  return new Promise<ProviderHttpResponse>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };
    const request = transport.request(
      {
        protocol: destination.url.protocol,
        hostname: destination.url.hostname,
        port: destination.url.port || undefined,
        path: `${destination.url.pathname}${destination.url.search}`,
        method: 'POST',
        headers,
        lookup: (_hostname, _options, callback) => callback(null, address, isIpv6(address) ? 6 : 4),
      },
      (response) => {
        const expectedLength = Number(response.headers['content-length']);
        if (Number.isFinite(expectedLength) && expectedLength > MAX_PROVIDER_RESPONSE_BYTES) {
          response.destroy();
          settle(() => reject(new ProviderExecutionBrokerError('PROVIDER_EXECUTION_RESPONSE_TOO_LARGE')));
          return;
        }
        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        response.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (receivedBytes > MAX_PROVIDER_RESPONSE_BYTES) {
            response.destroy();
            settle(() => reject(new ProviderExecutionBrokerError('PROVIDER_EXECUTION_RESPONSE_TOO_LARGE')));
            return;
          }
          chunks.push(chunk);
        });
        response.once('error', () =>
          settle(() => reject(new ProviderExecutionBrokerError('PROVIDER_EXECUTION_NETWORK_FAILED')))
        );
        response.once('end', () =>
          settle(() => resolve({ status: response.statusCode ?? 502, body: Buffer.concat(chunks).toString('utf8') }))
        );
      }
    );
    const abort = (): void => {
      request.destroy(new ProviderExecutionBrokerError('PROVIDER_EXECUTION_ABORTED'));
    };
    const timer = setTimeout(
      () => request.destroy(new ProviderExecutionBrokerError('PROVIDER_EXECUTION_TIMEOUT')),
      timeoutMs
    );
    const cleanUp = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    request.once('error', (error: unknown) => {
      cleanUp();
      if (error instanceof ProviderExecutionBrokerError) settle(() => reject(error));
      else settle(() => reject(new ProviderExecutionBrokerError('PROVIDER_EXECUTION_NETWORK_FAILED')));
    });
    request.once('close', cleanUp);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    request.end(body);
  });
};

/**
 * The only direct provider egress seam for this chat target. It resolves the
 * provider twice by Main-owned stored ID, receives an opaque trust secret lease,
 * inspects the exact serialized request, and only then opens a pinned socket.
 */
export const createProviderExecutionBroker = (options: ProviderExecutionBrokerOptions) => {
  const newId = options.newId ?? randomUUID;
  const timeoutMs = options.timeoutMs ?? PROVIDER_EXECUTION_TIMEOUT_MS;
  const semanticEgressGuard = options.semanticEgressGuard ?? createSemanticEgressGuard();
  const semanticModelVersion = options.semanticModelVersion ?? 'unavailable';
  return {
    async execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult> {
      assertNotAborted(request.signal);
      if (!options.destinationAuthority) throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_DENIED');
      const actorId = options.actorId();
      if (!actorId.trim()) throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_DENIED');
      const runId = `provider-chat-${newId()}`;
      const taskId = `provider-task-${newId()}`;
      const idempotencyKey = `${runId}:${taskId}`;

      // Reject an untrusted origin or disallowed capability before touching the
      // provider catalog. This is a policy-only preflight: it cannot mint a
      // transferable grant because the concrete provider target is not known
      // until Main later selects a stored provider ID.
      const preflightRequest = {
        runId,
        taskId,
        actorId,
        operation: 'provider' as const,
        targetId: 'provider:pending',
        requestedCapabilities: ['provider.execute', 'secret.use'],
        workspaceScope: 'provider://main-only',
        policyVersion: options.trustRuntime.policyVersion,
        idempotencyKey,
        reason: 'Preflight user-configured provider chat completion',
      };
      const origin = await options.trustRuntime.trustBroker.authorizeOrigin({
        runId,
        taskId,
        actorId,
        targetId: preflightRequest.targetId,
        policyVersion: preflightRequest.policyVersion,
        origin: PROVIDER_EXECUTION_ORIGIN,
      });
      if (
        origin.decision !== 'allow' ||
        options.trustRuntime.trustBroker.authorize(preflightRequest).decision !== 'allow'
      ) {
        throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_DENIED');
      }

      const selected = selectProvider(await options.providerStore.list(), request.model);
      if (!selected) throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_UNAVAILABLE');
      let destinationAdmission;
      try {
        destinationAdmission = await options.destinationAuthority.admit(selected.providerId);
      } catch (error) {
        if (error instanceof ProviderDestinationAuthorityError) {
          throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_DENIED');
        }
        throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_DENIED');
      }

      // Never accept a provider object or secret from a caller. Re-read this exact
      // opaque ID from the Main store after model selection.
      const provider = await options.providerStore.get(selected.providerId);
      if (!provider || !isUsableProvider(provider))
        throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_UNAVAILABLE');
      const resolvedCredential = await options.resolveProviderCredential?.(provider);
      const apiKey =
        resolvedCredential ?? (provider.auth_type === 'oauth' ? '' : firstProviderApiKey(provider.api_key));
      if (!apiKey) throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_UNAVAILABLE');
      let storedDestination: string;
      try {
        storedDestination = new URL(resolveProviderChatUrl(provider)).href;
      } catch {
        throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_INVALID_DESTINATION');
      }
      if (storedDestination !== destinationAdmission.destination) {
        throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_INVALID_DESTINATION');
      }
      const destination = new URL(destinationAdmission.destination);
      assertNotAborted(request.signal);
      const payloadObject = formatProviderPayload(provider, selected.model, request.messages);
      let serializedPayload = JSON.stringify(payloadObject);
      if (byteLength(serializedPayload) > MAX_PROVIDER_REQUEST_BYTES) {
        throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_REQUEST_TOO_LARGE');
      }
      const trustRequest = {
        runId,
        taskId,
        actorId,
        operation: 'provider' as const,
        targetId: `provider:${selected.providerId}`,
        requestedCapabilities: ['provider.execute', 'secret.use'],
        workspaceScope: 'provider://main-only',
        policyVersion: options.trustRuntime.policyVersion,
        idempotencyKey,
        reason: 'Execute user-configured provider chat completion',
        networkHost: destination.hostname,
      };
      const trustGrant = await options.trustRuntime.trustBroker.requestCapability(
        trustRequest,
        PROVIDER_EXECUTION_ORIGIN
      );
      if (trustGrant.decision !== 'allow' || !trustGrant.grantId) {
        throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_DENIED');
      }
      const semantic = await semanticEgressGuard.inspect({
        serializedPayload,
        origin: PROVIDER_EXECUTION_ORIGIN,
        policyVersion: options.trustRuntime.policyVersion,
        modelVersion: semanticModelVersion,
        cacheScope: (() => {
          const scoped = options.semanticCacheScope?.({ accountId: actorId, destination: destination.hostname });
          return scoped
            ? {
                accountId: actorId,
                workspaceId: scoped.workspaceId,
                vaultRevision: scoped.vaultRevision,
                destination: destination.hostname,
              }
            : undefined;
        })(),
        semanticPolicy: {
          route: 'external',
          destinationAuthorized: true,
          capabilityGranted: true,
          scopeAuthorized: true,
          confirmation: 'not_required',
          allowedRiskTypes: ['none'],
        },
      });
      try {
        if (!options.semanticEgressAuditSink) throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_DENIED');
        await options.semanticEgressAuditSink.append({
          ...semantic.audit,
          origin: PROVIDER_EXECUTION_ORIGIN,
          recordedAt: new Date().toISOString(),
        });
      } catch {
        throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_DENIED');
      }
      if (semantic.decision === 'block' || semantic.serializedPayload === undefined) {
        throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_DENIED');
      }
      serializedPayload = semantic.serializedPayload;
      const egress = await options.trustRuntime.trustBroker.inspectFinalEgress({
        ...trustRequest,
        origin: PROVIDER_EXECUTION_ORIGIN,
        grantId: trustGrant.grantId,
        serializedPayload,
      });
      if (egress.decision !== 'allow') throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_DENIED');
      assertNotAborted(request.signal);
      try {
        await options.destinationAuthority.assertCurrent(destinationAdmission);
        await options.trustRuntime.trustBroker.resolveSecret({
          runId,
          taskId,
          actorId,
          targetId: trustRequest.targetId,
          origin: PROVIDER_EXECUTION_ORIGIN,
          secretHandle: `provider-secret:${selected.providerId}`,
          purpose: 'provider-chat-completion',
          policyVersion: options.trustRuntime.policyVersion,
          idempotencyKey,
          grantId: trustGrant.grantId,
          destinationHost: destination.hostname,
        });
      } catch {
        throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_DENIED');
      }
      assertNotAborted(request.signal);

      const controller = new AbortController();
      const abort = (): void => controller.abort();
      if (request.signal?.aborted) controller.abort();
      else request.signal?.addEventListener('abort', abort, { once: true });
      try {
        try {
          await options.destinationAuthority.assertCurrent(destinationAdmission);
        } catch {
          throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_DENIED');
        }
        const requestHeaders = buildProviderHeaders(provider, apiKey, serializedPayload);
        const response = await postPinnedProviderRequest(
          destination.href,
          requestHeaders,
          serializedPayload,
          controller.signal,
          timeoutMs,
          options.dnsLookup
        );
        if (response.status < 200 || response.status >= 300)
          throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_NETWORK_FAILED');
        let parsed: Record<string, unknown>;
        try {
          const value = JSON.parse(response.body) as unknown;
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid response');
          parsed = value as Record<string, unknown>;
        } catch {
          throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_RESPONSE_INVALID');
        }
        const choices = parsed.choices;
        const chatContent =
          Array.isArray(choices) && choices[0] && typeof choices[0] === 'object'
            ? (choices[0] as Record<string, unknown>).message
            : undefined;
        let content: string | undefined =
          chatContent && typeof chatContent === 'object'
            ? ((chatContent as Record<string, unknown>).content as string | undefined)
            : undefined;

        if (content === undefined && Array.isArray(parsed.content)) {
          // Anthropic format: { content: [{ type: 'text', text: '...' }] }
          const textParts = (parsed.content as Array<{ type?: string; text?: string }>)
            .filter((p) => p && typeof p.text === 'string')
            .map((p) => p.text as string);
          if (textParts.length > 0) content = textParts.join('');
        }

        if (
          content === undefined &&
          Array.isArray(parsed.candidates) &&
          parsed.candidates[0] &&
          typeof parsed.candidates[0] === 'object'
        ) {
          // Gemini format: { candidates: [{ content: { parts: [{ text: '...' }] } }] }
          const candidate = parsed.candidates[0] as Record<string, unknown>;
          const candidateContent = candidate.content as Record<string, unknown> | undefined;
          if (candidateContent && Array.isArray(candidateContent.parts)) {
            const textParts = (candidateContent.parts as Array<{ text?: string }>)
              .filter((p) => p && typeof p.text === 'string')
              .map((p) => p.text as string);
            if (textParts.length > 0) content = textParts.join('');
          }
        }

        if (content === undefined) {
          content = extractResponseContent(parsed);
        }
        if (typeof content !== 'string') throw new ProviderExecutionBrokerError('PROVIDER_EXECUTION_RESPONSE_INVALID');
        const responseUsage =
          parsed.usage && typeof parsed.usage === 'object' ? (parsed.usage as Record<string, unknown>) : undefined;
        const geminiUsage =
          parsed.usageMetadata && typeof parsed.usageMetadata === 'object'
            ? (parsed.usageMetadata as Record<string, unknown>)
            : undefined;
        const promptTokens = nonNegativeCount(
          responseUsage?.prompt_tokens ?? responseUsage?.input_tokens ?? geminiUsage?.promptTokenCount
        );
        const completionTokens = nonNegativeCount(
          responseUsage?.completion_tokens ?? responseUsage?.output_tokens ?? geminiUsage?.candidatesTokenCount
        );
        const totalTokens =
          nonNegativeCount(responseUsage?.total_tokens ?? geminiUsage?.totalTokenCount) ??
          (promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined);
        const cachedTokens =
          nonNegativeCount(responseUsage?.cached_tokens) ??
          nestedUsageCount(responseUsage, ['prompt_tokens_details', 'input_tokens_details'], 'cached_tokens');
        const reasoningTokens =
          nonNegativeCount(responseUsage?.reasoning_tokens) ??
          nestedUsageCount(responseUsage, ['completion_tokens_details', 'output_tokens_details'], 'reasoning_tokens');
        const usage =
          promptTokens === undefined &&
          completionTokens === undefined &&
          totalTokens === undefined &&
          cachedTokens === undefined &&
          reasoningTokens === undefined
            ? undefined
            : {
                ...(promptTokens === undefined ? {} : { prompt_tokens: promptTokens }),
                ...(completionTokens === undefined ? {} : { completion_tokens: completionTokens }),
                ...(totalTokens === undefined ? {} : { total_tokens: totalTokens }),
                ...(cachedTokens === undefined ? {} : { cached_tokens: cachedTokens }),
                ...(reasoningTokens === undefined ? {} : { reasoning_tokens: reasoningTokens }),
              };
        return {
          providerId: selected.providerId,
          content,
          evidenceRef: `provider-egress:${newId()}`,
          ...(usage === undefined ? {} : { usage }),
        };
      } finally {
        request.signal?.removeEventListener('abort', abort);
      }
    },
  };
};

export type ProviderExecutionBroker = ReturnType<typeof createProviderExecutionBroker>;
export { PROVIDER_EXECUTION_ORIGIN };
