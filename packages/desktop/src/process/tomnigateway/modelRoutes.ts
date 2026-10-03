import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { TomniGatewayModelService } from './types';

const MODEL_ROUTE = '/v1/chat/completions';
const RESPONSES_ROUTE = '/v1/responses';
const MODEL_HISTORY_ROUTE = '/v1/model-requests';
const MODEL_QUOTA_ROUTE = '/v1/model-quota';
const MODEL_REPLAY_ROUTE = '/v1/model-replay';
const MODEL_REPLAY_EXPORT_ROUTE = '/v1/model-replay/export';
const MAX_MODEL_NAME_LENGTH = 200;
const MAX_MESSAGE_COUNT = 100;

type ModelRequest = Readonly<{ model: string; messages: readonly unknown[]; stream?: boolean }>;
type ResponsesRequest = Readonly<{ model: string; input: readonly unknown[]; stream?: boolean }>;

const writeJson = (response: ServerResponse, status: number, body: unknown, origin?: string): void => {
  response
    .writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
    })
    .end(JSON.stringify(body));
};

const fail = (response: ServerResponse, status: number, code: string, origin?: string): void =>
  writeJson(response, status, { error: { message: code, type: 'tomni_gateway_error', code } }, origin);

const credentialFrom = (request: IncomingMessage): string => {
  const value = request.headers.authorization;
  if (typeof value !== 'string') return '';
  return /^Bearer\s+(.+)$/iu.exec(value)?.[1]?.trim() ?? '';
};

const readModelRequest = async (request: IncomingMessage): Promise<ModelRequest | undefined> => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.length;
    if (bytes > 64 * 1024) return undefined;
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const requestValue = value as { model?: unknown; messages?: unknown; stream?: unknown };
    if (
      typeof requestValue.model !== 'string' ||
      !requestValue.model.trim() ||
      requestValue.model.length > MAX_MODEL_NAME_LENGTH ||
      !Array.isArray(requestValue.messages) ||
      requestValue.messages.length === 0 ||
      requestValue.messages.length > MAX_MESSAGE_COUNT ||
      (requestValue.stream !== undefined && typeof requestValue.stream !== 'boolean')
    ) {
      return undefined;
    }
    return { model: requestValue.model.trim(), messages: requestValue.messages, stream: requestValue.stream === true };
  } catch {
    return undefined;
  }
};

const responsesInputToMessages = (input: unknown): readonly unknown[] | undefined => {
  if (typeof input === 'string' && input.length > 0) return [{ role: 'user', content: input }];
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MESSAGE_COUNT) return undefined;
  const messages: unknown[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const value = item as { role?: unknown; content?: unknown; type?: unknown };
    if (typeof value.role === 'string' && typeof value.content === 'string' && value.content.length > 0) {
      messages.push({ role: value.role, content: value.content });
      continue;
    }
    if (value.type === 'message' && typeof value.role === 'string' && Array.isArray(value.content)) {
      const text = value.content
        .filter((part): part is { type: string; text: string } => {
          if (!part || typeof part !== 'object' || Array.isArray(part)) return false;
          const candidate = part as { type?: unknown; text?: unknown };
          return candidate.type === 'input_text' && typeof candidate.text === 'string';
        })
        .map((part) => part.text)
        .join('');
      if (text.length > 0) {
        messages.push({ role: value.role, content: text });
        continue;
      }
    }
    return undefined;
  }
  return messages;
};

const readResponsesRequest = async (request: IncomingMessage): Promise<ResponsesRequest | undefined> => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.length;
    if (bytes > 64 * 1024) return undefined;
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const requestValue = value as { model?: unknown; input?: unknown; stream?: unknown };
    if (
      typeof requestValue.model !== 'string' ||
      !requestValue.model.trim() ||
      requestValue.model.length > MAX_MODEL_NAME_LENGTH ||
      requestValue.input === undefined ||
      (requestValue.stream !== undefined && typeof requestValue.stream !== 'boolean')
    ) {
      return undefined;
    }
    const messages = responsesInputToMessages(requestValue.input);
    return messages
      ? { model: requestValue.model.trim(), input: messages, stream: requestValue.stream === true }
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Handles only the isolated model route. Its credential is resolved by Main
 * to a consumer identity, so an upstream provider secret never crosses HTTP.
 */
export const handleModelRoute = async (input: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  service: TomniGatewayModelService;
  origin?: string;
}): Promise<boolean> => {
  const { request, response, url, service, origin } = input;

  if (
    url.pathname !== MODEL_ROUTE &&
    url.pathname !== RESPONSES_ROUTE &&
    url.pathname !== MODEL_HISTORY_ROUTE &&
    url.pathname !== MODEL_QUOTA_ROUTE &&
    url.pathname !== MODEL_REPLAY_ROUTE &&
    url.pathname !== MODEL_REPLAY_EXPORT_ROUTE
  )
    return false;
  if (
    (url.pathname === MODEL_HISTORY_ROUTE ||
      url.pathname === MODEL_QUOTA_ROUTE ||
      url.pathname === MODEL_REPLAY_ROUTE ||
      url.pathname === MODEL_REPLAY_EXPORT_ROUTE) &&
    request.method !== 'GET' &&
    !(url.pathname === MODEL_REPLAY_ROUTE && request.method === 'DELETE')
  ) {
    fail(response, 405, 'METHOD_NOT_ALLOWED', origin);
    return true;
  }
  if ((url.pathname === MODEL_ROUTE || url.pathname === RESPONSES_ROUTE) && request.method !== 'POST') {
    fail(response, 405, 'METHOD_NOT_ALLOWED', origin);
    return true;
  }
  const credential = credentialFrom(request);
  if (!credential) {
    fail(response, 401, 'MODEL_CREDENTIAL_REQUIRED', origin);
    return true;
  }
  const admission = await service
    .authorize({ credential, origin, path: url.pathname })
    .catch((): undefined => undefined);
  if (!admission) {
    fail(response, 401, 'MODEL_CREDENTIAL_DENIED', origin);
    return true;
  }
  if (url.pathname === MODEL_QUOTA_ROUTE) {
    if (!service.getQuota) {
      fail(response, 404, 'MODEL_QUOTA_UNAVAILABLE', origin);
      return true;
    }
    const quota = await service.getQuota({
      consumerId: admission.consumerId,
      ...(url.searchParams.get('model') ? { model: url.searchParams.get('model') ?? undefined } : {}),
    });
    writeJson(response, 200, { object: 'quota', data: quota }, origin);
    return true;
  }
  if (url.pathname === MODEL_HISTORY_ROUTE) {
    if (!service.listRequestHistory) {
      fail(response, 404, 'MODEL_HISTORY_UNAVAILABLE', origin);
      return true;
    }
    const parseTime = (name: string): number | undefined => {
      const value = url.searchParams.get(name);
      if (value === null || !/^\d+$/u.test(value)) return undefined;
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) ? parsed : undefined;
    };
    const status = url.searchParams.get('status');
    const records = await service.listRequestHistory({
      consumerId: admission.consumerId,
      ...(url.searchParams.get('session_id') ? { sessionId: url.searchParams.get('session_id') ?? undefined } : {}),
      ...(url.searchParams.get('provider_id') ? { providerId: url.searchParams.get('provider_id') ?? undefined } : {}),
      ...(url.searchParams.get('model') ? { model: url.searchParams.get('model') ?? undefined } : {}),
      ...(status === 'completed' || status === 'failed' || status === 'cancelled' ? { status } : {}),

      ...(parseTime('from') === undefined ? {} : { from: parseTime('from') }),
      ...(parseTime('to') === undefined ? {} : { to: parseTime('to') }),
    });
    writeJson(
      response,
      200,
      { object: 'list', data: records.map(({ actorDigest: _actorDigest, ...record }) => record) },
      origin
    );
    return true;
  }
  if (url.pathname === MODEL_REPLAY_ROUTE) {
    if (request.method === 'DELETE') {
      if (!service.deleteReplay) {
        fail(response, 404, 'MODEL_REPLAY_UNAVAILABLE', origin);
        return true;
      }
      const sampleId = url.searchParams.get('sample_id') ?? undefined;
      const deleted = await service.deleteReplay(sampleId);
      writeJson(response, 200, { object: 'deletion', deleted }, origin);
      return true;
    }
    if (!service.replayPreview) {
      fail(response, 404, 'MODEL_REPLAY_UNAVAILABLE', origin);
      return true;
    }
    writeJson(response, 200, { object: 'replay_preview', data: await service.replayPreview() }, origin);
    return true;
  }
  if (url.pathname === MODEL_REPLAY_EXPORT_ROUTE) {
    if (!service.replayExport) {
      fail(response, 404, 'MODEL_REPLAY_UNAVAILABLE', origin);
      return true;
    }
    writeJson(response, 200, { object: 'replay_export', data: await service.replayExport() }, origin);
    return true;
  }
  const responsesRequest = url.pathname === RESPONSES_ROUTE ? await readResponsesRequest(request) : undefined;
  const modelRequest = url.pathname === MODEL_ROUTE ? await readModelRequest(request) : undefined;
  const requestModel =
    modelRequest ??
    (responsesRequest
      ? { model: responsesRequest.model, messages: responsesRequest.input, stream: responsesRequest.stream }
      : undefined);
  if (!requestModel) {
    fail(response, 400, 'INVALID_MODEL_REQUEST', origin);
    return true;
  }

  if (requestModel.stream === true) {
    // Never fake SSE from a non-streaming broker. Streaming remains disabled
    // until cancellation, backpressure, usage, and terminal receipts share one contract.
    fail(response, 400, 'MODEL_STREAMING_UNSUPPORTED', origin);
    return true;
  }

  const controller = new AbortController();
  const abort = (): void => controller.abort();
  request.once('aborted', abort);
  response.once('close', () => {
    if (!response.writableEnded) abort();
  });
  try {
    const result = await service.chatCompletions({
      consumerId: admission.consumerId,
      model: requestModel.model,
      messages: requestModel.messages,
      signal: controller.signal,
      requestId: `model-request-${randomUUID()}`,
      sessionId: `model-consumer-${admission.consumerId}`,
    });
    if (controller.signal.aborted || response.writableEnded) return true;
    writeJson(
      response,
      200,
      {
        // The conditional keeps both OpenAI-compatible response envelopes on one governed execution path.
        // eslint-disable-next-line unicorn/no-useless-spread
        ...(url.pathname === RESPONSES_ROUTE
          ? {
              id: 'resp-' + randomUUID(),
              object: 'response',
              created_at: Math.floor(Date.now() / 1000),
              status: 'completed',
              model: result.model,
              output: [
                {
                  id: 'msg-' + randomUUID(),
                  type: 'message',
                  status: 'completed',
                  role: 'assistant',
                  content: [{ type: 'output_text', text: result.content, annotations: [] }],
                },
              ],
              output_text: result.content,
              ...(result.usage
                ? {
                    usage: {
                      ...(result.usage.prompt_tokens === undefined ? {} : { input_tokens: result.usage.prompt_tokens }),
                      ...(result.usage.completion_tokens === undefined
                        ? {}
                        : { output_tokens: result.usage.completion_tokens }),
                      ...(result.usage.total_tokens === undefined ? {} : { total_tokens: result.usage.total_tokens }),
                      ...(result.usage.cached_tokens === undefined
                        ? {}
                        : { input_tokens_details: { cached_tokens: result.usage.cached_tokens } }),
                      ...(result.usage.reasoning_tokens === undefined
                        ? {}
                        : { output_tokens_details: { reasoning_tokens: result.usage.reasoning_tokens } }),
                    },
                  }
                : {}),
              ...(result.receiptId ? { tomni_receipt_id: result.receiptId } : {}),
            }
          : {
              id: 'chatcmpl-' + randomUUID(),
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: result.model,
              choices: [{ index: 0, message: { role: 'assistant', content: result.content }, finish_reason: 'stop' }],
              ...(result.usage ? { usage: result.usage } : {}),
              ...(result.receiptId ? { tomni_receipt_id: result.receiptId } : {}),
            }),
      },

      origin
    );
  } catch {
    if (!controller.signal.aborted && !response.writableEnded) fail(response, 502, 'MODEL_EXECUTION_FAILED', origin);
  } finally {
    request.removeListener('aborted', abort);
  }
  return true;
};
