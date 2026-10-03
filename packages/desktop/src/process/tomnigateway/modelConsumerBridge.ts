import {
  TOMNI_MODEL_CONSUMER_CHANNELS,
  modelConsumerChannels,
  type TomniModelConsumerApplyRequest,
  type TomniModelConsumerApplyResult,
  type TomniModelConsumerIssueRequest,
  type TomniModelConsumerResult,
} from '@/common/types/provider/modelConsumerChannels';
import type { TomniGatewayModelConsumerRegistry } from './modelConsumerVault';
import type { TomniGatewayModelService } from './types';

export type { TomniModelConsumerResult } from '@/common/types/provider/modelConsumerChannels';
export { TOMNI_MODEL_CONSUMER_CHANNELS };
export type { TomniModelConsumerSummary } from '@/common/types/provider/modelConsumerChannels';

type RevokeRequest = Readonly<{ consumerId: string }>;
type RotateRequest = Readonly<{ consumerId: string; ttlMs: number }>;
export type TomniModelConsumerBridgeOptions = Readonly<{
  requireAuthenticatedAccount?: () => void;
  getApprovedGatewayBaseUrl?: () => string | Promise<string | undefined>;
  /** Main-owned configuration writer; omitted to keep distribution disabled. */
  applyConfiguration?: (request: TomniModelConsumerApplyRequest) => Promise<TomniModelConsumerApplyResult>;
  modelService?: TomniGatewayModelService;
}>;

const bounded = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/\p{Cc}/u.test(value);

const parseIssue = (value: unknown): TomniModelConsumerIssueRequest | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['label', 'allowedModels', 'ttlMs'].includes(key))) return undefined;
  if (
    !bounded(record.label, 200) ||
    !Array.isArray(record.allowedModels) ||
    record.allowedModels.length === 0 ||
    record.allowedModels.length > 200 ||
    record.allowedModels.some((model) => !bounded(model, 200)) ||
    typeof record.ttlMs !== 'number' ||
    !Number.isSafeInteger(record.ttlMs)
  ) {
    return undefined;
  }
  return { label: record.label, allowedModels: record.allowedModels, ttlMs: record.ttlMs };
};

const parseRevoke = (value: unknown): RevokeRequest | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && bounded(record.consumerId, 160)
    ? { consumerId: record.consumerId }
    : undefined;
};

const isApprovedGatewayBaseUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 512) return false;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    const loopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1';
    return (
      parsed.protocol === 'http:' &&
      loopback &&
      parsed.port !== '' &&
      Number.isInteger(Number(parsed.port)) &&
      Number(parsed.port) > 0 &&
      Number(parsed.port) <= 65535 &&
      (parsed.pathname === '/v1' || parsed.pathname === '/v1/') &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.search === '' &&
      parsed.hash === ''
    );
  } catch {
    return false;
  }
};
const sameGatewayBaseUrl = (actual: string, expected: string): boolean => {
  try {
    const actualUrl = new URL(actual);
    const expectedUrl = new URL(expected);
    const actualPath = actualUrl.pathname.endsWith('/') ? actualUrl.pathname.slice(0, -1) : actualUrl.pathname;
    const expectedPath = expectedUrl.pathname.endsWith('/') ? expectedUrl.pathname.slice(0, -1) : expectedUrl.pathname;
    return actualUrl.origin === expectedUrl.origin && actualPath === expectedPath;
  } catch {
    return false;
  }
};

const parseApply = (value: unknown): TomniModelConsumerApplyRequest | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const endpoint = record.endpoint;
  if (
    Object.keys(record).some((key) => !['consumerId', 'credential', 'targetId', 'endpoint'].includes(key)) ||
    !bounded(record.consumerId, 160) ||
    !bounded(record.credential, 512) ||
    !bounded(record.targetId, 80) ||
    !endpoint ||
    typeof endpoint !== 'object' ||
    Array.isArray(endpoint)
  ) {
    return undefined;
  }
  const endpointRecord = endpoint as Record<string, unknown>;
  if (
    !isApprovedGatewayBaseUrl(endpointRecord.baseUrl) ||
    endpointRecord.apiKey !== record.credential ||
    (endpointRecord.model !== undefined && !bounded(endpointRecord.model, 200))
  ) {
    return undefined;
  }
  return {
    consumerId: record.consumerId,
    credential: record.credential,
    targetId: record.targetId,
    endpoint: endpoint as TomniModelConsumerApplyRequest['endpoint'],
  };
};

const parseRotate = (value: unknown): RotateRequest | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 2 &&
    bounded(record.consumerId, 160) &&
    typeof record.ttlMs === 'number' &&
    Number.isSafeInteger(record.ttlMs)
    ? { consumerId: record.consumerId, ttlMs: record.ttlMs }
    : undefined;
};
const parseHistory = (
  value: unknown
):
  | Readonly<{
      consumerId?: string;
      sessionId?: string;
      providerId?: string;
      model?: string;
      status?: 'completed' | 'failed' | 'cancelled';
    }>
  | undefined => {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['consumerId', 'sessionId', 'providerId', 'model', 'status'].includes(key)))
    return undefined;
  if (record.consumerId !== undefined && !bounded(record.consumerId, 160)) return undefined;
  if (record.sessionId !== undefined && !bounded(record.sessionId, 160)) return undefined;
  if (record.providerId !== undefined && !bounded(record.providerId, 160)) return undefined;
  if (record.status !== undefined && !['completed', 'failed', 'cancelled'].includes(record.status as string))
    return undefined;
  const consumerId = record.consumerId === undefined ? undefined : String(record.consumerId);
  const sessionId = record.sessionId === undefined ? undefined : String(record.sessionId);
  const providerId = record.providerId === undefined ? undefined : String(record.providerId);
  const status = record.status === undefined ? undefined : (record.status as 'completed' | 'failed' | 'cancelled');
  return {
    ...(consumerId === undefined ? {} : { consumerId }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(providerId === undefined ? {} : { providerId }),
    ...(status === undefined ? {} : { status }),
  };
};
const wrap = async <T>(operation: () => Promise<T>): Promise<TomniModelConsumerResult<T>> => {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export const tomniModelConsumerChannels = modelConsumerChannels;

export const registerTomniModelConsumerBridge = (
  registry: TomniGatewayModelConsumerRegistry,
  options: TomniModelConsumerBridgeOptions = {}
): void => {
  const requireAuthenticatedAccount = options.requireAuthenticatedAccount ?? (() => undefined);

  tomniModelConsumerChannels.gatewayEndpoint.provider(() =>
    wrap(async () => {
      requireAuthenticatedAccount();
      const baseUrl = options.getApprovedGatewayBaseUrl ? await options.getApprovedGatewayBaseUrl() : undefined;
      if (!baseUrl) throw new Error('MODEL_CONSUMER_GATEWAY_UNAVAILABLE');
      return { baseUrl };
    })
  );

  tomniModelConsumerChannels.apply.provider((raw) => {
    const request = parseApply(raw);
    return request
      ? wrap(async () => {
          requireAuthenticatedAccount();
          const approvedBaseUrl = options.getApprovedGatewayBaseUrl
            ? await options.getApprovedGatewayBaseUrl()
            : request.endpoint.baseUrl;
          if (!approvedBaseUrl || !sameGatewayBaseUrl(request.endpoint.baseUrl, approvedBaseUrl)) {
            throw new Error('MODEL_CONSUMER_INVALID_APPLY');
          }
          const consumer = await registry.resolveCredential(request.credential);
          if (
            !consumer ||
            consumer.consumerId !== request.consumerId ||
            (request.endpoint.model && !consumer.allowedModels.includes(request.endpoint.model))
          ) {
            throw new Error('MODEL_CONSUMER_REVOKED_OR_MODEL_DENIED');
          }
          if (!options.applyConfiguration) throw new Error('MODEL_CONSUMER_APPLY_UNAVAILABLE');
          return options.applyConfiguration(request);
        })
      : Promise.resolve({ ok: false, error: 'MODEL_CONSUMER_INVALID_APPLY' });
  });

  tomniModelConsumerChannels.history.provider((raw) => {
    const query = parseHistory(raw);
    const service = options.modelService;
    return query && service?.listRequestHistory
      ? wrap(async (): Promise<readonly Record<string, unknown>[]> => {
          requireAuthenticatedAccount();
          return service.listRequestHistory?.(query) ?? [];
        })
      : Promise.resolve({ ok: false, error: 'MODEL_CONSUMER_HISTORY_UNAVAILABLE' });
  });

  tomniModelConsumerChannels.quota.provider((raw) => {
    const service = options.modelService;
    if (!service?.getQuota || !raw || typeof raw !== 'object' || Array.isArray(raw))
      return Promise.resolve({ ok: false, error: 'MODEL_CONSUMER_QUOTA_UNAVAILABLE' });
    const record = raw as Record<string, unknown>;
    const consumerIdValue = record.consumerId;
    const modelValue = record.model;
    if (!bounded(consumerIdValue, 160) || (modelValue !== undefined && !bounded(modelValue, 200)))
      return Promise.resolve({ ok: false, error: 'MODEL_CONSUMER_INVALID_QUOTA' });
    const consumerId = String(consumerIdValue);
    const model = modelValue === undefined ? undefined : String(modelValue);
    return wrap(async () => {
      requireAuthenticatedAccount();
      return service.getQuota({ consumerId, ...(model === undefined ? {} : { model }) });
    });
  });

  tomniModelConsumerChannels.replayPreview.provider((_raw: void) => {
    const service = options.modelService;
    return service?.replayPreview
      ? wrap(async (): Promise<Record<string, unknown>> => {
          requireAuthenticatedAccount();
          return service.replayPreview?.() as Promise<Record<string, unknown>>;
        })
      : Promise.resolve({ ok: false, error: 'MODEL_CONSUMER_REPLAY_UNAVAILABLE' });
  });
  tomniModelConsumerChannels.replayExport.provider(
    (_raw: void): Promise<TomniModelConsumerResult<readonly Record<string, unknown>[]>> => {
      const service = options.modelService;
      return service?.replayExport
        ? wrap(async (): Promise<readonly Record<string, unknown>[]> => {
            requireAuthenticatedAccount();
            return service.replayExport?.() ?? [];
          })
        : Promise.resolve({ ok: false, error: 'MODEL_CONSUMER_REPLAY_UNAVAILABLE' });
    }
  );
  tomniModelConsumerChannels.deleteReplay.provider((raw) => {
    const service = options.modelService;
    if (
      !service?.deleteReplay ||
      (raw !== undefined &&
        (!raw ||
          typeof raw !== 'object' ||
          Array.isArray(raw) ||
          Object.keys(raw as Record<string, unknown>).some((key) => key !== 'sampleId')))
    )
      return Promise.resolve({ ok: false, error: 'MODEL_CONSUMER_REPLAY_UNAVAILABLE' });
    const sampleId = raw === undefined ? undefined : (raw as Record<string, unknown>).sampleId;
    if (sampleId !== undefined && !bounded(sampleId, 160))
      return Promise.resolve({ ok: false, error: 'MODEL_CONSUMER_INVALID_REPLAY_DELETE' });
    const sampleIdValue = sampleId === undefined ? undefined : String(sampleId);

    return wrap(async () => {
      requireAuthenticatedAccount();
      return service.deleteReplay?.(sampleIdValue) ?? 0;
    });
  });
  tomniModelConsumerChannels.issue.provider((raw) => {
    const request = parseIssue(raw);
    return request
      ? wrap(() => {
          requireAuthenticatedAccount();
          return registry.issue(request);
        })
      : Promise.resolve({ ok: false, error: 'MODEL_CONSUMER_INVALID_ISSUE' });
  });
  tomniModelConsumerChannels.list.provider(() =>
    wrap(() => {
      requireAuthenticatedAccount();
      return registry.list();
    })
  );
  tomniModelConsumerChannels.rotate.provider((raw) => {
    const request = parseRotate(raw);
    return request && registry.rotate
      ? wrap(async () => {
          requireAuthenticatedAccount();
          const result = await registry.rotate(request);
          if (!result) throw new Error('MODEL_CONSUMER_REVOKED_OR_INVALID_ROTATION');
          return result;
        })
      : Promise.resolve({ ok: false, error: 'MODEL_CONSUMER_INVALID_ROTATE' });
  });
  tomniModelConsumerChannels.revoke.provider((raw) => {
    const request = parseRevoke(raw);
    return request
      ? wrap(() => {
          requireAuthenticatedAccount();
          return registry.revoke(request.consumerId);
        })
      : Promise.resolve({ ok: false, error: 'MODEL_CONSUMER_INVALID_REVOKE' });
  });
};
