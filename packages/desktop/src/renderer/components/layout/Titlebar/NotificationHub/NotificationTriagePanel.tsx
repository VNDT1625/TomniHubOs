/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Button, Input, InputNumber, Radio, Switch } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import {
  notificationHubChannels,
  type NotificationHubSnapshot,
  type NotificationLlmRules,
  type NotificationRules,
} from '@/common/types/platform/notificationHub';

/**
 * Laya triage settings: what may interrupt, learning from feedback, package
 * apps, retention, muted sources, and the opt-in, budgeted LLM escalation.
 */
const NotificationTriagePanel: React.FC<{ snapshot: NotificationHubSnapshot }> = ({ snapshot }) => {
  const { t, i18n } = useTranslation();
  const { rules, connectors } = snapshot.settings;
  const escalation = snapshot.escalation;
  const [model, setModel] = useState(rules.llm.model);

  useEffect(() => setModel(rules.llm.model), [rules.llm.model]);

  const save = (patch: Partial<NotificationRules>): void => {
    void notificationHubChannels.saveRules.invoke({ ...rules, ...patch }).catch((): undefined => undefined);
  };
  const saveLlm = (patch: Partial<NotificationLlmRules>): void => save({ llm: { ...rules.llm, ...patch } });

  const sourceName = (key: string): string => {
    const connector = connectors.find((entry) => entry.id === key);
    if (connector) return connector.label;
    if (key.startsWith('app:')) return key.slice(4);
    return t(`common.notificationHub.sourceKind.${key}`, { defaultValue: key });
  };

  return (
    <div className='tnh-sources tnh-scope' data-testid='notification-triage'>
      <section className='tnh-section'>
        <div className='tnh-section-head'>
          <span>{t('common.notificationHub.triage.title')}</span>
        </div>
        <p className='tnh-hint'>{t('common.notificationHub.triage.intro')}</p>
        <div className='tnh-switch-row'>
          <span>
            {t('common.notificationHub.triage.interrupt')}
            <small className='tnh-hint'>{t('common.notificationHub.triage.interruptHint')}</small>
          </span>
          <Radio.Group
            type='button'
            size='small'
            value={rules.interruptLevel}
            onChange={(interruptLevel: NotificationRules['interruptLevel']) => save({ interruptLevel })}
          >
            <Radio value='P0'>{t('common.notificationHub.level.P0')}</Radio>
            <Radio value='P1'>{t('common.notificationHub.triage.p0p1')}</Radio>
          </Radio.Group>
        </div>
        <div className='tnh-switch-row'>
          <span>
            {t('common.notificationHub.triage.learn')}
            <small className='tnh-hint'>{t('common.notificationHub.triage.learnHint')}</small>
          </span>
          <Switch
            size='small'
            checked={rules.learnFromFeedback}
            aria-label={t('common.notificationHub.triage.learn')}
            onChange={(learnFromFeedback) => save({ learnFromFeedback })}
          />
        </div>
        <div className='tnh-switch-row'>
          <span>
            {t('common.notificationHub.triage.packageApps')}
            <small className='tnh-hint'>{t('common.notificationHub.triage.packageAppsHint')}</small>
          </span>
          <Switch
            size='small'
            checked={rules.packageApps}
            aria-label={t('common.notificationHub.triage.packageApps')}
            onChange={(packageApps) => save({ packageApps })}
          />
        </div>
        <div className='tnh-switch-row'>
          <span>{t('common.notificationHub.triage.retention')}</span>
          <InputNumber
            size='small'
            min={1}
            max={365}
            value={rules.retentionDays}
            aria-label={t('common.notificationHub.triage.retention')}
            onChange={(value) => save({ retentionDays: Number(value) || 30 })}
            className='tnh-number'
          />
        </div>
        <div className='tnh-field'>
          <span>{t('common.notificationHub.triage.muted')}</span>
          {rules.mutedSources.length === 0 ? (
            <div className='tnh-hint'>{t('common.notificationHub.triage.mutedNone')}</div>
          ) : (
            <div className='tnh-presets'>
              {rules.mutedSources.map((key) => (
                <span key={key} className='tnh-chip'>
                  {sourceName(key)}
                  <button
                    type='button'
                    className='tnh-action tnh-action--quiet'
                    aria-label={t('common.notificationHub.actions.unmuteSource', { name: sourceName(key) })}
                    onClick={() => save({ mutedSources: rules.mutedSources.filter((entry) => entry !== key) })}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className='tnh-section' data-testid='notification-llm'>
        <div className='tnh-section-head'>
          <span>{t('common.notificationHub.llm.title')}</span>
          <Switch
            size='small'
            checked={rules.llm.enabled}
            aria-label={t('common.notificationHub.llm.enable')}
            onChange={(enabled) => saveLlm({ enabled })}
          />
        </div>
        <p className='tnh-hint'>{t('common.notificationHub.llm.intro')}</p>
        <label className='tnh-field'>
          <span>{t('common.notificationHub.llm.model')}</span>
          <div className='tnh-field-row'>
            <Input
              size='small'
              value={model}
              placeholder={t('common.notificationHub.llm.modelPlaceholder')}
              onChange={setModel}
            />
            <Button
              size='small'
              disabled={model.trim() === rules.llm.model}
              onClick={() => saveLlm({ model: model.trim() })}
            >
              {t('common.notificationHub.rules.save')}
            </Button>
          </div>
        </label>
        <div className='tnh-switch-row'>
          <span>{t('common.notificationHub.llm.dailyLimit')}</span>
          <InputNumber
            size='small'
            min={0}
            max={500}
            value={rules.llm.dailyLimit}
            aria-label={t('common.notificationHub.llm.dailyLimit')}
            onChange={(value) => saveLlm({ dailyLimit: Number(value) || 0 })}
            className='tnh-number'
          />
        </div>
        <div className='tnh-switch-row'>
          <span>
            {t('common.notificationHub.llm.includeSnippet')}
            <small className='tnh-hint'>{t('common.notificationHub.llm.includeSnippetHint')}</small>
          </span>
          <Switch
            size='small'
            checked={rules.llm.includeSnippet}
            aria-label={t('common.notificationHub.llm.includeSnippet')}
            onChange={(includeSnippet) => saveLlm({ includeSnippet })}
          />
        </div>
        {escalation && (
          <div className='tnh-hint' data-testid='notification-llm-usage'>
            {escalation.active
              ? t('common.notificationHub.llm.usage', { used: escalation.usedToday, limit: escalation.limit })
              : t('common.notificationHub.llm.inactive')}
            {escalation.lastRunAt
              ? ` · ${t('common.notificationHub.llm.lastRun', {
                  time: new Date(escalation.lastRunAt).toLocaleString(i18n.language, {
                    timeStyle: 'short',
                    dateStyle: 'short',
                  }),
                })}`
              : ''}
            {escalation.lastError
              ? ` · ${t(`common.notificationHub.llm.error.${escalation.lastError}`, {
                  defaultValue: t('common.notificationHub.llm.errorGeneric', { error: escalation.lastError }),
                })}`
              : ''}
          </div>
        )}
      </section>
    </div>
  );
};

export default NotificationTriagePanel;
