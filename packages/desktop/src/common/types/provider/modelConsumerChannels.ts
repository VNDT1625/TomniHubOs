import { bridge } from '@office-ai/platform';
export type TomniModelConsumerResult<T> = { ok: true; data: T } | { ok: false; error: string };
export type TomniModelConsumerEndpoint = Readonly<{
  baseUrl: string;
  apiKey: string;
  model?: string;
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}>;
export type TomniModelConsumerSummary = Readonly<{
  consumerId: string;
  label: string;
  allowedModels: readonly string[];
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}>;
export type TomniModelConsumerIssueRequest = Readonly<{
  label: string;
  allowedModels: readonly string[];
  ttlMs: number;
}>;
export type TomniModelConsumerIssueResult = Readonly<{ consumerId: string; credential: string; expiresAt: string }>;
export type TomniModelConsumerRotateRequest = Readonly<{ consumerId: string; ttlMs: number }>;
export type TomniModelConsumerRotateResult = TomniModelConsumerIssueResult;
export type TomniModelConsumerApplyRequest = Readonly<{
  consumerId: string;
  credential: string;
  targetId: string;
  endpoint: TomniModelConsumerEndpoint;
}>;
export type TomniModelConsumerApplyResult = Readonly<{
  targetId: string;
  files: readonly Readonly<{ path: string; status: 'written' | 'skipped'; backupPath?: string }>[];
  notes: readonly string[];
}>;
export type TomniModelConsumerHistoryQuery = Readonly<{
  consumerId?: string;
  sessionId?: string;
  model?: string;
  providerId?: string;
}>;
export type TomniModelConsumerQuotaRequest = Readonly<{ consumerId: string; model?: string }>;
export const TOMNI_MODEL_CONSUMER_CHANNELS = {
  issue: 'tomni-model-consumer.issue',
  list: 'tomni-model-consumer.list',
  revoke: 'tomni-model-consumer.revoke',
  rotate: 'tomni-model-consumer.rotate',
  history: 'tomni-model-consumer.history',
  quota: 'tomni-model-consumer.quota',
  replayPreview: 'tomni-model-consumer.replay-preview',
  gatewayEndpoint: 'tomni-model-consumer.gateway-endpoint',
  replayExport: 'tomni-model-consumer.replay-export',
  deleteReplay: 'tomni-model-consumer.delete-replay',
  apply: 'tomni-model-consumer.apply',
} as const;
export const modelConsumerChannels = {
  issue: bridge.buildProvider<TomniModelConsumerResult<TomniModelConsumerIssueResult>, TomniModelConsumerIssueRequest>(
    TOMNI_MODEL_CONSUMER_CHANNELS.issue
  ),
  list: bridge.buildProvider<TomniModelConsumerResult<readonly TomniModelConsumerSummary[]>, void>(
    TOMNI_MODEL_CONSUMER_CHANNELS.list
  ),
  revoke: bridge.buildProvider<TomniModelConsumerResult<boolean>, Readonly<{ consumerId: string }>>(
    TOMNI_MODEL_CONSUMER_CHANNELS.revoke
  ),
  rotate: bridge.buildProvider<
    TomniModelConsumerResult<TomniModelConsumerRotateResult>,
    TomniModelConsumerRotateRequest
  >(TOMNI_MODEL_CONSUMER_CHANNELS.rotate),
  history: bridge.buildProvider<
    TomniModelConsumerResult<readonly Record<string, unknown>[]>,
    TomniModelConsumerHistoryQuery
  >(TOMNI_MODEL_CONSUMER_CHANNELS.history),
  quota: bridge.buildProvider<TomniModelConsumerResult<Record<string, unknown>>, TomniModelConsumerQuotaRequest>(
    TOMNI_MODEL_CONSUMER_CHANNELS.quota
  ),
  replayPreview: bridge.buildProvider<TomniModelConsumerResult<Record<string, unknown>>, void>(
    TOMNI_MODEL_CONSUMER_CHANNELS.replayPreview
  ),
  gatewayEndpoint: bridge.buildProvider<TomniModelConsumerResult<{ baseUrl: string }>, void>(
    TOMNI_MODEL_CONSUMER_CHANNELS.gatewayEndpoint
  ),
  replayExport: bridge.buildProvider<TomniModelConsumerResult<readonly Record<string, unknown>[]>, void>(
    TOMNI_MODEL_CONSUMER_CHANNELS.replayExport
  ),
  deleteReplay: bridge.buildProvider<TomniModelConsumerResult<number>, Readonly<{ sampleId?: string }>>(
    TOMNI_MODEL_CONSUMER_CHANNELS.deleteReplay
  ),
  apply: bridge.buildProvider<TomniModelConsumerResult<TomniModelConsumerApplyResult>, TomniModelConsumerApplyRequest>(
    TOMNI_MODEL_CONSUMER_CHANNELS.apply
  ),
};
