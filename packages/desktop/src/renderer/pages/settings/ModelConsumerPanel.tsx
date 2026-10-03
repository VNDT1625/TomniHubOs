import { Button, Card, Input, Message, Popconfirm, Tag } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type {
  TomniModelConsumerIssueResult,
  TomniModelConsumerSummary,
} from '@/common/types/provider/modelConsumerChannels';

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const addUsageCount = (current: number, candidate: unknown): number =>
  typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0 ? current + candidate : current;

const ModelConsumerPanel: React.FC = () => {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [models, setModels] = useState('');
  const [consumers, setConsumers] = useState<readonly TomniModelConsumerSummary[]>([]);
  const [issued, setIssued] = useState<TomniModelConsumerIssueResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [targetId, setTargetId] = useState('codex');
  const [endpoint, setEndpoint] = useState('');
  const [message, messageContext] = Message.useMessage();
  const [history, setHistory] = useState<readonly Record<string, unknown>[]>([]);
  const [quota, setQuota] = useState<Record<string, unknown> | null>(null);
  const [replay, setReplay] = useState<Record<string, unknown> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await ipcBridge.modelConsumers.list.invoke();
    if (result.ok) setConsumers(result.data);
    else if ('error' in result) message.error(result.error);
  }, [message]);

  const refreshTelemetry = useCallback(async (consumerId: string): Promise<void> => {
    const [historyResult, quotaResult, replayResult] = await Promise.all([
      ipcBridge.modelConsumers.history.invoke({ consumerId }),
      ipcBridge.modelConsumers.quota.invoke({ consumerId }),
      ipcBridge.modelConsumers.replayPreview.invoke(),
    ]);
    if (historyResult.ok) setHistory(historyResult.data);
    if (quotaResult.ok) setQuota(quotaResult.data);
    if (replayResult.ok) setReplay(replayResult.data);
  }, []);

  useEffect(() => {
    void ipcBridge.modelConsumers.gatewayEndpoint.invoke().then((result) => {
      if (result.ok) setEndpoint(result.data.baseUrl);
    });
    const active = consumers.find((consumer) => !consumer.revokedAt);
    if (active) void refreshTelemetry(active.consumerId);
  }, [consumers, refreshTelemetry]);

  const issue = async (): Promise<void> => {
    const allowedModels = models
      .split(/[,\n]/u)

      .map((item) => item.trim())
      .filter(Boolean);
    if (!label.trim() || allowedModels.length === 0) {
      message.warning(
        t('settings.modelConsumerRequired', {
          defaultValue: 'Enter a label and at least one allowed model.',
        })
      );
      return;
    }
    setLoading(true);
    try {
      const result = await ipcBridge.modelConsumers.issue.invoke({
        label: label.trim(),
        allowedModels,
        ttlMs: DEFAULT_TTL_MS,
      });
      if ('error' in result) {
        message.error(result.error);
        return;
      }
      setIssued(result.data);
      setLabel('');
      setModels('');
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const apply = async (): Promise<void> => {
    if (!issued) return;
    const result = await ipcBridge.modelConsumers.apply.invoke({
      consumerId: issued.consumerId,
      credential: issued.credential,
      targetId,
      endpoint: { baseUrl: endpoint, apiKey: issued.credential },
    });
    if ('error' in result) message.error(result.error);
    else message.success(t('settings.modelConsumerApplied', { defaultValue: 'Configuration applied with backup.' }));
  };

  const copyCredential = async (): Promise<void> => {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.credential);
    message.success(t('settings.modelConsumerCopied', { defaultValue: 'Credential copied.' }));
  };

  const exportReplay = async (): Promise<void> => {
    const result = await ipcBridge.modelConsumers.replayExport.invoke();
    if ('error' in result) {
      message.error(result.error);
      return;
    }
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'tomni-model-replay.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const deleteReplay = async (): Promise<void> => {
    const result = await ipcBridge.modelConsumers.deleteReplay.invoke({});
    if ('error' in result) {
      message.error(result.error);
      return;
    }
    message.success(
      t('settings.modelConsumerReplayDeleted', {
        defaultValue: 'Deleted {{count}} replay samples.',
        count: result.data,
      })
    );
    const active = consumers.find((consumer) => !consumer.revokedAt);
    if (active) await refreshTelemetry(active.consumerId);
  };

  const rotate = async (consumerId: string): Promise<void> => {
    const result = await ipcBridge.modelConsumers.rotate.invoke({ consumerId, ttlMs: DEFAULT_TTL_MS });
    if ('error' in result) {
      message.error(result.error);
      return;
    }
    setIssued(result.data);
    await refresh();
  };

  const revoke = async (consumerId: string): Promise<void> => {
    const result = await ipcBridge.modelConsumers.revoke.invoke({ consumerId });
    if ('error' in result) {
      message.error(result.error);
      return;
    }
    setIssued((current) => (current?.consumerId === consumerId ? null : current));
    await refresh();
  };

  const tokenUsage = history.reduce<{
    input: number;
    output: number;
    total: number;
    cached: number;
    reasoning: number;
    reported: number;
    estimated: number;
    unavailable: number;
  }>(
    (totals, record) => {
      const usage = record.usage;
      if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return totals;
      const value = usage as Record<string, unknown>;
      const source = value.source;
      totals.reported += source === 'reported' ? 1 : 0;
      totals.estimated += source === 'estimated' ? 1 : 0;
      totals.unavailable += source === 'unavailable' ? 1 : 0;
      totals.input = addUsageCount(totals.input, value.promptCount);
      totals.output = addUsageCount(totals.output, value.completionCount);
      totals.total = addUsageCount(totals.total, value.totalCount);
      totals.cached = addUsageCount(totals.cached, value.cachedCount);
      totals.reasoning = addUsageCount(totals.reasoning, value.reasoningCount);
      return totals;
    },
    { input: 0, output: 0, total: 0, cached: 0, reasoning: 0, reported: 0, estimated: 0, unavailable: 0 }
  );

  return (
    <div className='flex flex-col gap-12px'>
      {messageContext}
      <Card
        title={t('settings.modelConsumerTitle', { defaultValue: 'Tomny gateway consumers' })}
        bordered={false}
        className='!bg-[var(--color-bg-2)]'
      >
        <div className='text-12px text-t-secondary mb-12px'>
          {t('settings.modelConsumerDescription', {
            defaultValue:
              'Issue a separate, revocable gateway credential for a CLI or app. Upstream provider keys stay in Main.',
          })}
        </div>
        <div className='flex flex-col gap-8px'>
          <Input
            value={label}
            onChange={setLabel}
            placeholder={t('settings.modelConsumerLabel', { defaultValue: 'Consumer label (for example: Codex CLI)' })}
          />
          <Input.TextArea
            value={models}
            onChange={setModels}
            autoSize={{ minRows: 2, maxRows: 5 }}
            placeholder={t('settings.modelConsumerModels', { defaultValue: 'Allowed model ids, separated by commas' })}
          />
          <Button type='primary' icon={<Plus />} loading={loading} onClick={() => void issue()}>
            {t('settings.modelConsumerIssue', { defaultValue: 'Issue credential' })}
          </Button>
        </div>
      </Card>
      {issued && (
        <>
          <Card
            title={t('settings.modelConsumerApplyTitle', { defaultValue: 'Apply to a CLI or app' })}
            bordered={false}
            className='!bg-[var(--color-bg-2)]'
          >
            <div className='flex gap-8px'>
              <Input value={targetId} onChange={setTargetId} placeholder='codex' />
              <Input value={endpoint} onChange={setEndpoint} placeholder='http://127.0.0.1:20129/v1' />
              <Button onClick={() => void apply()}>{t('settings.router9.apply', { defaultValue: 'Apply' })}</Button>
            </div>
          </Card>
          <Card
            title={t('settings.modelConsumerIssued', { defaultValue: 'New credential (shown once)' })}
            bordered={false}
            className='!bg-[var(--color-bg-2)]'
          >
            <div className='flex items-center gap-8px'>
              <Input.Password value={issued.credential} readOnly />
              <Button
                aria-label={t('settings.router9.copy', { defaultValue: 'Copy' })}
                icon={<Copy />}
                onClick={() => void copyCredential()}
              />
            </div>
            <div className='text-12px text-t-secondary mt-8px'>
              {t('settings.modelConsumerExpiry', { defaultValue: 'Expires {{date}}', date: issued.expiresAt })}
            </div>
          </Card>
        </>
      )}
      <Card
        title={t('settings.modelConsumerTelemetryTitle', { defaultValue: 'Usage and privacy' })}
        bordered={false}
        className='!bg-[var(--color-bg-2)]'
      >
        <div className='grid grid-cols-1 md:grid-cols-4 gap-8px text-12px'>
          <div>
            <div className='text-t-secondary'>
              {t('settings.modelConsumerRequestCount', { defaultValue: 'Requests' })}
            </div>
            <div className='text-t-primary font-600'>
              {t('settings.modelConsumerTokenUsage', {
                defaultValue:
                  '{{requests}} requests · {{tokens}} tokens (in {{input}} / out {{output}} / cache {{cached}} / reasoning {{reasoning}})',
                requests: history.length,
                tokens:
                  tokenUsage.reported + tokenUsage.estimated > 0
                    ? tokenUsage.total
                    : t('settings.modelConsumerUsageUnavailable', { defaultValue: 'unavailable' }),
                input: tokenUsage.input,
                output: tokenUsage.output,
                cached: tokenUsage.cached,
                reasoning: tokenUsage.reasoning,
              })}
            </div>
            <div className='text-11px text-t-secondary'>
              {t('settings.modelConsumerUsageSources', {
                defaultValue:
                  'Usage source: {{reported}} reported · {{estimated}} estimated · {{unavailable}} unavailable',
                reported: tokenUsage.reported,
                estimated: tokenUsage.estimated,
                unavailable: tokenUsage.unavailable,
              })}
            </div>
          </div>
          <div>
            <div className='text-t-secondary'>
              {t('settings.modelConsumerQuotaStatus', { defaultValue: 'Quota status' })}
            </div>
            <div className='text-t-primary font-600'>{String(quota?.status ?? 'unknown')}</div>
            <div className='text-11px text-t-secondary'>
              {quota && quota.remaining !== undefined
                ? String(quota.remaining) + ' / ' + String(quota.limit ?? '?') + ' ' + String(quota.unit ?? '')
                : 'Balance unavailable'}
            </div>
          </div>
          <div>
            <div className='text-t-secondary'>
              {t('settings.modelConsumerReplayStatus', { defaultValue: 'Replay samples' })}
            </div>
            <div className='text-t-primary font-600'>
              {replay ? `${String(replay.count ?? 0)} (${replay.enabled ? 'on' : 'off'})` : 'unknown'}
            </div>
          </div>
        </div>
        <div className='mt-10px flex gap-8px'>
          <Button size='mini' onClick={() => void exportReplay()}>
            {t('settings.modelConsumerReplayExport', { defaultValue: 'Export replay' })}
          </Button>
          <Button size='mini' status='danger' onClick={() => void deleteReplay()}>
            {t('settings.modelConsumerReplayDelete', { defaultValue: 'Delete replay' })}
          </Button>
        </div>
        {history.length > 0 && (
          <div className='mt-10px flex flex-col gap-4px'>
            {history.slice(0, 5).map((record, index) => (
              <div key={String(record.requestId ?? index)} className='text-11px text-t-secondary'>
                {String(record.model ?? 'model')} · {String(record.status ?? 'unknown')} ·{' '}
                {String(record.durationMs ?? '?')} ms
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card
        title={t('settings.modelConsumerExisting', { defaultValue: 'Existing consumers' })}
        bordered={false}
        className='!bg-[var(--color-bg-2)]'
      >
        {consumers.length === 0 ? (
          <div className='text-12px text-t-secondary'>
            {t('settings.modelConsumerNone', { defaultValue: 'No gateway consumers yet.' })}
          </div>
        ) : (
          <div className='flex flex-col gap-8px'>
            {consumers.map((consumer) => (
              <div key={consumer.consumerId} className='flex items-center justify-between gap-8px'>
                <div className='min-w-0'>
                  <div className='text-13px text-t-primary truncate'>{consumer.label}</div>
                  <div className='text-11px text-t-secondary truncate'>{consumer.allowedModels.join(', ')}</div>
                </div>
                {consumer.revokedAt ? (
                  <Tag color='red'>{t('settings.revoked', { defaultValue: 'Revoked' })}</Tag>
                ) : (
                  <>
                    <Button size='mini' onClick={() => void rotate(consumer.consumerId)}>
                      {t('settings.modelConsumerRotate', { defaultValue: 'Rotate' })}
                    </Button>
                    <Popconfirm
                      title={t('settings.modelConsumerRevokeConfirm', { defaultValue: 'Revoke this credential?' })}
                      onOk={() => void revoke(consumer.consumerId)}
                    >
                      <Button size='mini' status='danger'>
                        {t('settings.revoke', { defaultValue: 'Revoke' })}
                      </Button>
                    </Popconfirm>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default ModelConsumerPanel;
