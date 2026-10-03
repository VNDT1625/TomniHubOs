/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "Distribute via 9Router" panel for Settings › Model.
 *
 * Lets the user point an external CLI / IDE tool (Kiro, Antigravity, Claude
 * Code, Codex, Cursor, Cline, OpenClaw...) at their local 9Router endpoint and
 * shows the exact configuration that tool needs — env vars, config-file
 * content, or copy-paste fields ("auto convert to the format the app needs").
 *
 * Renderer-only and side-effect-free: it computes plans with the pure
 * `common/router9` engine and copies to the clipboard. Writing config files on
 * disk is intentionally deferred to a Main-process applier (a higher-risk step).
 */

import { Button, Collapse, Input, Message, Switch, Tag, Tooltip } from '@arco-design/web-react';
import { Copy, LinkCloud, Components, CheckOne, PlayOne, Browser, ChartHistogram } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TomnySelect from '@/renderer/components/base/TomnySelect';
import {
  buildConnectorPlan,
  CONNECTOR_TARGETS,
  ROUTER9_REASONING_EFFORTS,
  type ConnectorPlan,
  type Router9Endpoint,
  type Router9ReasoningEffort,
} from '@/common/router9';
import { savePreferredModelId } from '@/renderer/pages/guid/hooks/agentSelectionUtils';
import {
  router9Client,
  type ApplyResult,
  type ManagedRouter9Status,
  type ManagedRouter9UsageStats,
  type ManagedRouter9UsageBreakdown,
} from './router9BridgeClient';

import { usageByConsumer } from './router9Usage';

const DEFAULT_BASE_URL = 'http://127.0.0.1:20129/v1';
const TARGET_STORAGE_KEY = 'tomni.modelGateway.target';
const MODEL_STORAGE_PREFIX = 'tomni.modelGateway.model.';
const REASONING_STORAGE_PREFIX = 'tomni.modelGateway.reasoning.';

const readStoredTarget = (): string => {
  try {
    const stored = localStorage.getItem(TARGET_STORAGE_KEY);
    if (stored && CONNECTOR_TARGETS.some((target) => target.id === stored)) return stored;
  } catch {
    // Storage can be unavailable in hardened renderer/test contexts.
  }
  return CONNECTOR_TARGETS[0]?.id ?? 'kiro';
};

const readStoredModel = (targetId: string): string => {
  try {
    return localStorage.getItem(`${MODEL_STORAGE_PREFIX}${targetId}`) ?? '';
  } catch {
    return '';
  }
};

const readStoredReasoning = (targetId: string): Router9ReasoningEffort | undefined => {
  try {
    const stored = localStorage.getItem(`${REASONING_STORAGE_PREFIX}${targetId}`);
    return ROUTER9_REASONING_EFFORTS.find((effort) => effort === stored);
  } catch {
    return undefined;
  }
};

const persistSelection = (
  targetId: string,
  model?: string,
  reasoningEffort?: Router9ReasoningEffort | 'auto'
): void => {
  try {
    localStorage.setItem(TARGET_STORAGE_KEY, targetId);
    if (model !== undefined) {
      const key = `${MODEL_STORAGE_PREFIX}${targetId}`;
      if (model) localStorage.setItem(key, model);
      else localStorage.removeItem(key);
    }
    if (reasoningEffort !== undefined) {
      const key = `${REASONING_STORAGE_PREFIX}${targetId}`;
      if (reasoningEffort !== 'auto') localStorage.setItem(key, reasoningEffort);
      else localStorage.removeItem(key);
    }
  } catch {
    // Selection persistence is a convenience, never a send/apply prerequisite.
  }
};

const compactSessionId = (sessionId: string): string =>
  sessionId.length <= 22 ? sessionId : `${sessionId.slice(0, 9)}…${sessionId.slice(-9)}`;

/** Color a target's mechanism badge so the user can tell apply-modes apart. */
const mechanismColor = (mechanism: string): string => {
  switch (mechanism) {
    case 'env':
      return 'arcoblue';
    case 'configFile':
      return 'orange';
    case 'manual':
    default:
      return 'gray';
  }
};

type Router9ConnectorPanelProps = {
  /** Refresh model consumers after Main has synchronized Tomny's managed provider. */
  onProviderSynced?: () => void;
};

const Router9ConnectorPanel: React.FC<Router9ConnectorPanelProps> = ({ onProviderSynced }) => {
  const { t } = useTranslation();
  const [targetId, setTargetId] = useState<string>(readStoredTarget);
  const [baseUrl, setBaseUrl] = useState<string>(DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState<string>('');
  const [model, setModel] = useState<string>(() => readStoredModel(readStoredTarget()));

  const [reasoningEffort, setReasoningEffort] = useState<Router9ReasoningEffort | undefined>(() =>
    readStoredReasoning(readStoredTarget())
  );
  const [managedStatus, setManagedStatus] = useState<ManagedRouter9Status | null>(null);
  const [managedLoading, setManagedLoading] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [providerCount, setProviderCount] = useState(0);
  const [usageLogs, setUsageLogs] = useState<string[]>([]);
  const [usageStats, setUsageStats] = useState<ManagedRouter9UsageStats | null>(null);
  const [usageBreakdown, setUsageBreakdown] = useState<ManagedRouter9UsageBreakdown>({ sessions: [] });
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const target = useMemo(() => CONNECTOR_TARGETS.find((tg) => tg.id === targetId), [targetId]);
  const consumerUsage = useMemo(() => usageByConsumer(usageStats), [usageStats]);

  const selectTarget = (value: string): void => {
    persistSelection(value);
    setTargetId(value);
    setModel(readStoredModel(value));

    setReasoningEffort(readStoredReasoning(value));
  };

  const selectModel = (value: string): void => {
    persistSelection(targetId, value);
    setModel(value);
  };

  const selectReasoning = (value: string): void => {
    const effort = ROUTER9_REASONING_EFFORTS.find((item) => item === value);
    persistSelection(targetId, undefined, effort ?? 'auto');
    setReasoningEffort(effort);
  };

  const endpoint = useMemo<Router9Endpoint>(
    () => ({
      baseUrl,
      apiKey,
      ...(model.trim() ? { model: model.trim() } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
    }),
    [apiKey, baseUrl, model, reasoningEffort]
  );

  const preferredChatModel = (selectedModel: string): string =>
    targetId === 'codex' && reasoningEffort ? `${selectedModel}::${reasoningEffort}` : selectedModel;

  const loadManagedOverview = async (clientKey = apiKey): Promise<void> => {
    setOverviewLoading(true);
    try {
      const [providers, logs, stats, models, breakdown] = await Promise.all([
        router9Client.listProviders(),
        router9Client.listUsageLogs(),
        router9Client.usageStats(),
        router9Client.listModels(clientKey || undefined),
        router9Client.usageBreakdown().catch((): null => null),
      ]);
      if (!providers.ok) throw new Error('error' in providers ? providers.error : 'unknown');
      if (!logs.ok) throw new Error('error' in logs ? logs.error : 'unknown');
      if (!stats.ok) throw new Error('error' in stats ? stats.error : 'unknown');
      if (!models.ok) throw new Error('error' in models ? models.error : 'unknown');
      setProviderCount(providers.data.connections?.length ?? 0);
      setUsageLogs(logs.data.slice(0, 8));
      setUsageStats(stats.data);
      if (breakdown?.ok) setUsageBreakdown(breakdown.data);
      setAvailableModels(models.data.map((item) => item.id).filter(Boolean));
      setOverviewOpen(true);
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setOverviewLoading(false);
    }
  };

  const restoreManagedClient = async (status: ManagedRouter9Status): Promise<string> => {
    const client = await router9Client.ensureClient(`Tomny · ${target?.label ?? targetId}`);
    if (!client.ok) throw new Error('error' in client ? client.error : 'unknown');
    if (!client.data.key) throw new Error(t('settings.router9.clientKeyUnavailable'));
    setManagedStatus(status);
    setBaseUrl(status.baseUrl);
    setApiKey(client.data.key);
    // Tomny is a gateway consumer of its own, separate from the selected CLI.
    // Main owns the dedicated credential and provider-store update so the
    // renderer never has to copy a CLI key into Tomny's direct-provider list.
    void router9Client.syncTomniProvider().then((synced) => {
      if (!synced.ok) return;
      setAvailableModels(synced.data.models);
      onProviderSynced?.();
    });
    // Credential restoration is the critical path. Provider/catalog/usage
    // refresh stays in the background so a slow upstream never blocks the UI.
    void loadManagedOverview(client.data.key);
    return client.data.key;
  };

  const loadManagedStatus = (): void => {
    router9Client
      .status()
      .then((result) => {
        if (!result.ok) return;
        setManagedStatus(result.data);
        setBaseUrl(result.data.baseUrl);
        // Renderer state is discarded when Settings unmounts. Rehydrate the
        // client credential and model catalog from the still-running Main
        // process so changing tabs never requires another Start click.
        if (result.data.state === 'running' || result.data.state === 'external') {
          void restoreManagedClient(result.data).catch((): undefined => undefined);
        }
      })
      .catch((): undefined => undefined);
  };

  // A distinct gateway key is maintained for each CLI target. Besides making
  // tab restoration deterministic, this preserves per-CLI usage attribution.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on selected target only
  useEffect(loadManagedStatus, [targetId]);

  const useManagedGateway = async () => {
    setManagedLoading(true);
    try {
      const started = await router9Client.start();
      if (!started.ok) throw new Error('error' in started ? started.error : 'unknown');
      const clientKey = await restoreManagedClient(started.data);
      if (target?.mechanism === 'configFile') {
        const configured = await router9Client.applyPlan(targetId, {
          baseUrl: started.data.baseUrl,
          apiKey: clientKey,
          ...(model.trim() ? { model: model.trim() } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
        });
        if (!configured.ok) throw new Error('error' in configured ? configured.error : 'unknown');
        setApplied(configured.data);
        const selectedModel = model.trim();
        if (target.agentPreferenceKey && selectedModel) {
          await savePreferredModelId(target.agentPreferenceKey, preferredChatModel(selectedModel));
        }
      }
      Message.success(t('settings.router9.gatewayReady'));
    } catch (error) {
      Message.error(
        t('settings.router9.gatewayFailed', { error: error instanceof Error ? error.message : String(error) })
      );
      loadManagedStatus();
    } finally {
      setManagedLoading(false);
    }
  };

  const toggleAutoStart = async (enabled: boolean): Promise<void> => {
    setManagedLoading(true);
    try {
      const result = await router9Client.setAutoStart(enabled);
      if (!result.ok) throw new Error('error' in result ? result.error : 'unknown');
      setManagedStatus(result.data);
      if (enabled && result.data.state === 'stopped') {
        const started = await router9Client.start();
        if (!started.ok) throw new Error('error' in started ? started.error : 'unknown');
        await restoreManagedClient(started.data);
      }
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
      loadManagedStatus();
    } finally {
      setManagedLoading(false);
    }
  };

  const openManagedDashboard = (section: 'providers' | 'usage') => {
    router9Client
      .openDashboard(section)
      .then((result) => {
        if (!result.ok) Message.error('error' in result ? result.error : t('common.failed'));
      })
      .catch((error: unknown) => Message.error(error instanceof Error ? error.message : String(error)));
  };

  // Compute the plan only when we have usable credentials; the engine throws
  // otherwise, so guard before calling it.
  const plan = useMemo<ConnectorPlan | null>(() => {
    if (!endpoint.baseUrl.trim() || !endpoint.apiKey.trim()) return null;
    try {
      return buildConnectorPlan(targetId, endpoint);
    } catch {
      return null;
    }
  }, [endpoint, targetId]);

  const copy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => Message.success(t('settings.router9.copied')))
      .catch(() => Message.error(t('common.failed')));
  };

  // Apply state: only meaningful for non-manual targets (env / configFile).
  const [applying, setApplying] = useState(false);
  const [syncingChat, setSyncingChat] = useState(false);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const canApply = !!plan && !!target && target.mechanism !== 'manual';

  // Clear a stale apply result whenever the target or credentials change.
  useEffect(() => {
    setApplied(null);
  }, [targetId, baseUrl, apiKey, model, reasoningEffort]);

  const apply = () => {
    if (!plan || !canApply) return;
    setApplying(true);
    setApplied(null);
    router9Client
      .applyPlan(targetId, endpoint)
      .then(async (res) => {
        if (res.ok) {
          const selectedModel = model.trim();
          if (target?.agentPreferenceKey && selectedModel) {
            // Config files control standalone CLIs; Tomny's main chat keeps a
            // separate per-agent preference. Keep both surfaces aligned for
            // every connector target that has a matching Tomny agent.
            await savePreferredModelId(target.agentPreferenceKey, preferredChatModel(selectedModel));
          }
          setApplied(res.data);
          Message.success(t('settings.router9.applied'));
          return;
        }
        // `'error' in res` narrows reliably where the discriminant alone does not.
        const errMsg = 'error' in res ? res.error : 'unknown';
        Message.error(t('settings.router9.applyFailed', { error: errMsg }));
      })
      .catch((error: unknown) => {
        Message.error(
          t('settings.router9.applyFailed', { error: error instanceof Error ? error.message : String(error) })
        );
      })
      .finally(() => setApplying(false));
  };

  const syncToTomniChat = async (): Promise<void> => {
    const selectedModel = model.trim();
    if (!target?.agentPreferenceKey || !selectedModel) return;
    setSyncingChat(true);
    try {
      await savePreferredModelId(target.agentPreferenceKey, preferredChatModel(selectedModel));
      Message.success(t('settings.router9.chatSynced'));
    } finally {
      setSyncingChat(false);
    }
  };

  const envBlock = useMemo(() => {
    if (!plan || plan.env.length === 0) return '';
    return plan.env.map((e) => `export ${e.key}="${e.value}"`).join('\n');
  }, [plan]);

  return (
    <Collapse bordered={false} className='mt-16px [&_.arco-collapse-item-content-box]:!px-0'>
      <Collapse.Item
        name='router9'
        header={
          <div className='flex items-center gap-8px'>
            <Components theme='outline' size='18' className='text-[rgb(var(--primary-6))]' />
            <span className='text-14px font-600 text-t-primary'>{t('settings.router9.title')}</span>
          </div>
        }
      >
        <div className='flex flex-col gap-14px'>
          <p className='text-12px leading-5 text-t-secondary m-0'>{t('settings.router9.subtitle')}</p>

          <div className='rd-10px border border-solid border-b-base bg-fill-1 px-12px py-10px flex flex-col gap-10px'>
            <div className='flex items-center justify-between gap-12px'>
              <div className='flex items-center gap-8px min-w-0'>
                <Tag
                  size='small'
                  color={
                    managedStatus?.state === 'running'
                      ? 'green'
                      : managedStatus?.state === 'external'
                        ? 'orange'
                        : 'gray'
                  }
                >
                  {t(`settings.router9.state.${managedStatus?.state ?? 'stopped'}`)}
                </Tag>
                <span className='text-12px text-t-secondary truncate'>
                  {managedStatus?.runtimeReady === false
                    ? t('settings.router9.runtimeMissing')
                    : (managedStatus?.baseUrl ?? DEFAULT_BASE_URL)}
                </span>
              </div>
              <Button
                size='small'
                type='primary'
                loading={managedLoading}
                icon={<PlayOne theme='outline' size='14' />}
                onClick={() => void useManagedGateway()}
              >
                {t('settings.router9.useGateway')}
              </Button>
            </div>
            <div className='flex flex-wrap gap-8px'>
              <Button
                size='mini'
                icon={<Browser theme='outline' size='14' />}
                onClick={() => openManagedDashboard('providers')}
              >
                {t('settings.router9.oauthProviders')}
              </Button>
              <Button
                size='mini'
                icon={<ChartHistogram theme='outline' size='14' />}
                loading={overviewLoading}
                onClick={() => void loadManagedOverview()}
              >
                {t('settings.router9.usage')}
              </Button>
              {managedStatus?.upstreamVersion && (
                <span className='text-11px text-t-tertiary self-center'>9Router {managedStatus.upstreamVersion}</span>
              )}
            </div>
            <div className='flex items-center justify-between gap-12px rd-8px bg-fill-1 px-9px py-7px'>
              <div className='min-w-0'>
                <div className='text-11px font-600 text-t-primary'>{t('settings.router9.autoStart')}</div>
                <div className='text-10px text-t-tertiary'>{t('settings.router9.autoStartHint')}</div>
              </div>
              <Switch
                size='small'
                checked={managedStatus?.autoStart === true}
                loading={managedLoading}
                aria-label={t('settings.router9.autoStart')}
                onChange={(checked) => void toggleAutoStart(checked)}
              />
            </div>
            {overviewOpen && (
              <div className='rd-8px border border-solid border-b-base bg-bg-2 px-10px py-8px flex flex-col gap-6px'>
                <div className='text-11px text-t-secondary'>
                  {t('settings.router9.oauthProviders')}:{' '}
                  <span className='font-600 text-t-primary'>{providerCount}</span>
                </div>
                <div className='text-11px font-600 text-t-primary'>{t('settings.router9.usage')}</div>
                {usageStats && (
                  <div className='grid grid-cols-2 md:grid-cols-5 gap-6px'>
                    <Metric label={t('settings.router9.metrics.requests')} value={usageStats.totalRequests} />
                    <Metric label={t('settings.router9.metrics.input')} value={usageStats.totalPromptTokens} />
                    <Metric label={t('settings.router9.metrics.output')} value={usageStats.totalCompletionTokens} />
                    <Metric label={t('settings.router9.metrics.cached')} value={usageStats.totalCachedTokens} />
                    <Metric label={t('settings.router9.metrics.cost')} value={`$${usageStats.totalCost.toFixed(4)}`} />
                  </div>
                )}
                {consumerUsage.length > 0 && (
                  <div className='flex flex-col gap-4px'>
                    <div className='text-11px font-600 text-t-primary'>{t('settings.router9.usageByConsumer')}</div>
                    {consumerUsage.map((row) => (
                      <div
                        key={row.consumer}
                        className='grid grid-cols-[minmax(120px,1fr)_repeat(4,minmax(54px,auto))] gap-6px items-center text-10px rd-6px bg-fill-1 px-7px py-5px'
                      >
                        <span className='truncate text-t-primary' title={row.consumer}>
                          {row.consumer}
                        </span>
                        <span className='font-mono text-t-secondary'>R {row.requests.toLocaleString()}</span>
                        <span className='font-mono text-t-secondary'>In {row.promptTokens.toLocaleString()}</span>
                        <span className='font-mono text-t-secondary'>Out {row.completionTokens.toLocaleString()}</span>
                        <span className='font-mono text-t-secondary'>${row.cost.toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {usageBreakdown.sessions.length > 0 && (
                  <div className='flex flex-col gap-4px'>
                    <div className='text-11px font-600 text-t-primary'>{t('settings.router9.usageBySession')}</div>
                    {usageBreakdown.sessions.slice(0, 10).map((row) => (
                      <div
                        key={`${row.consumer}:${row.sessionId}:${row.measurement}`}
                        className='grid grid-cols-[minmax(150px,1fr)_minmax(92px,auto)_repeat(3,minmax(54px,auto))] gap-6px items-center text-10px rd-6px bg-fill-1 px-7px py-5px'
                      >
                        <div className='min-w-0'>
                          <div className='truncate text-t-primary' title={row.consumer}>
                            {row.consumer}
                          </div>
                          <div className='truncate font-mono text-t-tertiary' title={row.sessionId}>
                            {row.clientTool} · {compactSessionId(row.sessionId)}
                          </div>
                        </div>
                        <Tag size='small' color={row.measurement === 'gateway-estimated' ? 'orange' : 'green'}>
                          {t(`settings.router9.measurement.${row.measurement}`)}
                        </Tag>
                        <span className='font-mono text-t-secondary'>R {row.requests.toLocaleString()}</span>
                        <span className='font-mono text-t-secondary'>In {row.promptTokens.toLocaleString()}</span>
                        <span className='font-mono text-t-secondary'>Out {row.completionTokens.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className='text-10px text-t-tertiary'>{t('settings.router9.tokenSourceNote')}</div>
                <div className='max-h-144px overflow-y-auto font-mono text-10px leading-5 text-t-secondary'>
                  {usageLogs.length > 0 ? usageLogs.map((line) => <div key={line}>{line}</div>) : <div>—</div>}
                </div>
              </div>
            )}
          </div>

          {/* Endpoint + target inputs */}
          <div className='grid grid-cols-1 md:grid-cols-2 gap-12px'>
            <label className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>{t('settings.router9.targetLabel')}</span>
              <TomnySelect
                data-testid='router9-target-select'
                aria-label={t('settings.router9.targetLabel')}
                value={targetId}
                onChange={(value) => selectTarget(String(value))}
                className='w-full'
              >
                {CONNECTOR_TARGETS.map((tg) => (
                  <TomnySelect.Option key={tg.id} value={tg.id}>
                    {tg.label}
                  </TomnySelect.Option>
                ))}
              </TomnySelect>
            </label>
            <label className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>{t('settings.router9.endpointLabel')}</span>
              <Input value={baseUrl} onChange={setBaseUrl} prefix={<LinkCloud theme='outline' size='14' />} />
            </label>
            <label className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>{t('settings.router9.clientAccessLabel')}</span>
              {apiKey &&
              (managedStatus?.state === 'running' || managedStatus?.state === 'external') &&
              baseUrl === managedStatus.baseUrl ? (
                <div className='h-32px rd-6px border border-solid border-b-base bg-fill-1 px-9px flex items-center justify-between gap-8px'>
                  <span className='text-12px text-t-primary'>{t('settings.router9.clientAccessManaged')}</span>
                  <Tag size='small' color='green'>
                    {t('settings.router9.clientAccessProtected')}
                  </Tag>
                </div>
              ) : (
                <Input.Password
                  value={apiKey}
                  onChange={setApiKey}
                  placeholder={t('settings.router9.clientKeyPlaceholder')}
                  aria-label={t('settings.router9.clientAccessLabel')}
                />
              )}
              <span className='text-10px leading-4 text-t-tertiary'>{t('settings.router9.clientAccessHint')}</span>
            </label>
            <label className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>{t('settings.router9.modelLabel')}</span>
              <TomnySelect
                aria-label={t('settings.router9.modelLabel')}
                value={model || undefined}
                onChange={(value) => selectModel(value ?? '')}
                placeholder={t('settings.router9.modelPlaceholder')}
                showSearch
                allowCreate
                allowClear
              >
                {availableModels.map((modelId) => (
                  <TomnySelect.Option key={modelId} value={modelId}>
                    {modelId}
                  </TomnySelect.Option>
                ))}
              </TomnySelect>
            </label>
            <label className='flex flex-col gap-4px'>
              <span className='text-12px text-t-secondary'>{t('settings.router9.reasoningLabel')}</span>
              <TomnySelect
                data-testid='router9-reasoning-select'
                aria-label={t('settings.router9.reasoningLabel')}
                value={reasoningEffort ?? 'auto'}
                onChange={(value) => selectReasoning(String(value))}
              >
                <TomnySelect.Option value='auto'>{t('settings.router9.reasoning.auto')}</TomnySelect.Option>
                {ROUTER9_REASONING_EFFORTS.map((effort) => (
                  <TomnySelect.Option key={effort} value={effort}>
                    {t(`settings.router9.reasoning.${effort}`)}
                  </TomnySelect.Option>
                ))}
              </TomnySelect>
              <span className='text-10px leading-4 text-t-tertiary'>{t('settings.router9.reasoningHint')}</span>
            </label>
          </div>

          {/* Target description + mechanism badge */}
          {target && (
            <div className='flex items-start gap-8px'>
              <Tag size='small' color={mechanismColor(target.mechanism)} className='shrink-0'>
                {t(`settings.router9.mechanism.${target.mechanism}`)}
              </Tag>
              <span className='text-12px leading-5 text-t-secondary'>{t(target.descriptionKey)}</span>
            </div>
          )}

          {!plan ? (
            <div
              className='rd-8px px-12px py-8px text-12px leading-5 border border-solid'
              style={{
                borderColor: 'rgba(var(--primary-6),0.32)',
                backgroundColor: 'rgba(var(--primary-6),0.08)',
                color: 'rgb(var(--primary-6))',
              }}
            >
              {t('settings.router9.needCreds')}
            </div>
          ) : (
            <div className='flex flex-col gap-12px'>
              {/* Copy-paste connection fields (always present) */}
              <Section title={t('settings.router9.fieldsTitle')}>
                <div className='flex flex-col gap-6px'>
                  {plan.fields
                    .filter((field) => target?.mechanism === 'manual' || field.key !== 'apiKey')
                    .map((f) => (
                      <div key={f.key} className='flex items-center gap-8px'>
                        <span className='text-12px text-t-secondary w-72px shrink-0'>{f.key}</span>
                        <code className='flex-1 min-w-0 truncate text-12px text-t-primary bg-[var(--fill-1)] rd-6px px-8px py-4px'>
                          {f.value}
                        </code>
                        <CopyButton label={t('settings.router9.copy')} onClick={() => copy(f.value)} />
                      </div>
                    ))}
                </div>
              </Section>

              {/* Environment variables (env-mechanism targets) */}
              {envBlock && (
                <Section
                  title={t('settings.router9.envTitle')}
                  onCopy={() => copy(envBlock)}
                  copyLabel={t('settings.router9.copy')}
                >
                  <pre className='m-0 text-12px text-t-primary bg-[var(--fill-1)] rd-6px px-10px py-8px overflow-x-auto whitespace-pre'>
                    {envBlock}
                  </pre>
                </Section>
              )}

              {/* Config files (configFile-mechanism targets) */}
              {plan.files.map((file) => (
                <Section
                  key={file.path}
                  title={`${t('settings.router9.fileTitle')} · ${file.path}`}
                  onCopy={() => copy(file.content)}
                  copyLabel={t('settings.router9.copy')}
                >
                  <pre className='m-0 text-12px text-t-primary bg-[var(--fill-1)] rd-6px px-10px py-8px overflow-x-auto whitespace-pre'>
                    {file.content}
                  </pre>
                </Section>
              ))}

              {/* One-click apply — writes config files to disk (with backup).
                  Manual targets have no auto-apply, so the button is hidden. */}
              {canApply && (
                <div className='flex flex-col gap-8px'>
                  <div className='flex items-center gap-10px'>
                    <Button
                      type='primary'
                      loading={applying}
                      icon={<CheckOne theme='outline' size='14' />}
                      onClick={apply}
                    >
                      {t('settings.router9.apply')}
                    </Button>
                    <span className='text-12px text-t-secondary'>{t('settings.router9.applyHint')}</span>
                  </div>

                  {applied && (
                    <div
                      className='rd-8px px-12px py-8px text-12px leading-5 border border-solid flex flex-col gap-4px'
                      style={{
                        borderColor: 'rgba(var(--success-6),0.32)',
                        backgroundColor: 'rgba(var(--success-6),0.08)',
                      }}
                    >
                      {applied.files.map((f) => (
                        <div key={f.path} className='text-t-primary'>
                          <span className='text-[rgb(var(--success-6))]'>
                            {f.status === 'written'
                              ? t('settings.router9.fileWritten')
                              : t('settings.router9.fileSkipped')}
                          </span>
                          {' · '}
                          <code className='text-t-secondary'>{f.path}</code>
                          {f.backupPath && (
                            <span className='text-t-tertiary'> ({t('settings.router9.backupSaved')})</span>
                          )}
                        </div>
                      ))}
                      {applied.notes.length > 0 && (
                        <div className='text-t-secondary'>
                          {t('settings.router9.envNote')}
                          <pre className='m-0 mt-4px text-12px text-t-primary bg-[var(--fill-1)] rd-6px px-8px py-6px overflow-x-auto whitespace-pre'>
                            {applied.notes.join('\n')}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {target?.mechanism === 'manual' && target.agentPreferenceKey && model.trim() && (
                <div className='flex items-center gap-10px'>
                  <Button
                    type='primary'
                    loading={syncingChat}
                    icon={<CheckOne theme='outline' size='14' />}
                    onClick={() => void syncToTomniChat()}
                  >
                    {t('settings.router9.useInTomnyChat')}
                  </Button>
                  <span className='text-12px text-t-secondary'>{t('settings.router9.manualChatHint')}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </Collapse.Item>
    </Collapse>
  );
};

/** A titled block with an optional inline copy action in its header. */
const Section: React.FC<{
  title: string;
  copyLabel?: string;
  onCopy?: () => void;
  children: React.ReactNode;
}> = ({ title, copyLabel, onCopy, children }) => (
  <div className='flex flex-col gap-6px'>
    <div className='flex items-center justify-between'>
      <span className='text-12px font-500 text-t-secondary'>{title}</span>
      {onCopy && copyLabel && <CopyButton label={copyLabel} onClick={onCopy} />}
    </div>
    {children}
  </div>
);

const CopyButton: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <Tooltip content={label}>
    <Button
      size='mini'
      className='!w-26px !h-26px !min-w-26px text-t-secondary hover:text-t-primary'
      icon={<Copy theme='outline' size='14' />}
      onClick={onClick}
    />
  </Tooltip>
);

const Metric: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div className='rd-6px bg-fill-1 px-7px py-5px min-w-0'>
    <div className='text-9px text-t-tertiary'>{label}</div>
    <div className='font-mono text-11px font-600 text-t-primary truncate'>{value.toLocaleString()}</div>
  </div>
);

export default Router9ConnectorPanel;
