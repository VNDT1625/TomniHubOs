/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Button, Input, InputNumber, Message, Popconfirm, Radio, Select, Switch } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import {
  notificationHubChannels,
  type ConnectorDraft,
  type NotificationConnector,
  type NotificationHubSnapshot,
  type NotificationRules,
  type OsNotificationApp,
} from '@/common/types/platform/notificationHub';
import {
  NOTIFICATION_SOURCE_CATALOG,
  SITE_SOURCE_PRESETS,
  type NotificationSourceGroup,
} from '@/common/types/platform/notificationSourceCatalog';

type SourceKind = NotificationConnector['kind'];

const SOURCE_KINDS: readonly SourceKind[] = ['imap', 'web', 'youtube', 'os', 'feed'];

type FormState = {
  id?: string;
  kind: SourceKind;
  label: string;
  preset: string;
  host: string;
  port: number;
  user: string;
  password: string;
  mailbox: string;
  /** Mail: keep a short text preview (off = headers only). */
  preview: boolean;
  url: string;
  origin: string;
  captureNotifications: boolean;
  channel: string;
  apps: string[];
  intervalMinutes: number;
};

/** Well-known IMAP servers; each needs an app password when two-step sign-in is on. */
export const MAIL_PRESETS: Record<string, { host: string; port: number }> = Object.fromEntries(
  NOTIFICATION_SOURCE_CATALOG.filter((entry) => entry.kind === 'imap' && entry.host && entry.port).map((entry) => [
    entry.id,
    { host: entry.host as string, port: entry.port as number },
  ])
);

/** Sites whose tab title carries an unread count or that raise web notifications. */
export const SITE_PRESETS = SITE_SOURCE_PRESETS;

const SITE_GROUPS: readonly NotificationSourceGroup[] = ['ai', 'messages', 'social', 'mail'];

const DEFAULT_INTERVAL: Record<SourceKind, number> = { imap: 5, feed: 30, web: 0, youtube: 60, os: 1 };

const blankForm = (kind: SourceKind = 'imap'): FormState => ({
  kind,
  label: kind === 'os' ? 'Windows' : '',
  preset: 'gmail',
  host: MAIL_PRESETS.gmail?.host ?? 'imap.gmail.com',
  port: MAIL_PRESETS.gmail?.port ?? 993,
  user: '',
  password: '',
  mailbox: 'INBOX',
  preview: false,
  url: '',
  origin: '',
  captureNotifications: true,
  channel: '',
  apps: [],
  intervalMinutes: DEFAULT_INTERVAL[kind],
});

const formFromConnector = (connector: NotificationConnector): FormState => {
  const base = { ...blankForm(connector.kind), id: connector.id, label: connector.label };
  switch (connector.kind) {
    case 'imap': {
      const preset = Object.entries(MAIL_PRESETS).find(([, value]) => value.host === connector.host)?.[0] ?? 'custom';
      return { ...base, ...connector, preset, password: '', preview: connector.headersOnly === false };
    }
    case 'feed':
      return { ...base, url: connector.url, intervalMinutes: connector.intervalMinutes };
    case 'youtube':
      return { ...base, channel: connector.channelId, intervalMinutes: connector.intervalMinutes };
    case 'os':
      return { ...base, apps: connector.apps, intervalMinutes: connector.intervalMinutes };
    case 'web':
      return { ...base, origin: connector.origin, captureNotifications: connector.captureNotifications === true };
  }
};

/** Builds the draft Main validates; an empty password keeps the saved one. */
export const draftFromForm = (form: FormState, enabled = true): ConnectorDraft => {
  switch (form.kind) {
    case 'imap':
      return {
        id: form.id,
        kind: 'imap',
        label: form.label.trim() || form.user.trim(),
        enabled,
        host: form.host.trim(),
        port: form.port,
        user: form.user.trim(),
        mailbox: form.mailbox.trim() || 'INBOX',
        intervalMinutes: form.intervalMinutes,
        headersOnly: !form.preview,
        unreadOnly: true,
        ...(form.password ? { password: form.password } : {}),
      };
    case 'feed':
      return {
        id: form.id,
        kind: 'feed',
        label: form.label.trim(),
        enabled,
        url: form.url.trim(),
        intervalMinutes: form.intervalMinutes,
      };
    case 'youtube':
      return {
        id: form.id,
        kind: 'youtube',
        label: form.label.trim() || form.channel.trim(),
        enabled,
        channelId: form.channel.trim(),
        intervalMinutes: form.intervalMinutes,
      };
    case 'os':
      return {
        id: form.id,
        kind: 'os',
        label: form.label.trim() || 'Windows',
        enabled,
        apps: form.apps,
        intervalMinutes: form.intervalMinutes,
      };
    case 'web':
      return {
        id: form.id,
        kind: 'web',
        label: form.label.trim(),
        enabled,
        origin: form.origin.trim(),
        captureNotifications: form.captureNotifications,
      };
  }
};

const draftFromConnector = (connector: NotificationConnector, enabled: boolean): ConnectorDraft => {
  if (connector.kind === 'imap') {
    const { hasSecret: _hasSecret, ...rest } = connector;
    return { ...rest, enabled };
  }
  return { ...connector, enabled };
};

const splitList = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const OsAppPicker: React.FC<{ value: string[]; onChange: (apps: string[]) => void }> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const [apps, setApps] = useState<OsNotificationApp[] | undefined>();
  useEffect(() => {
    let cancelled = false;
    void notificationHubChannels.listOsApps
      .invoke()
      .then((list) => {
        if (!cancelled) setApps(list);
      })
      .catch(() => {
        if (!cancelled) setApps([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const toggle = (appId: string) =>
    onChange(value.includes(appId) ? value.filter((entry) => entry !== appId) : [...value, appId]);
  return (
    <div className='tnh-field'>
      <span>{t('common.notificationHub.sources.osApps')}</span>
      <p className='tnh-hint'>{t('common.notificationHub.sources.osHint')}</p>
      {apps === undefined ? null : apps.length === 0 ? (
        <div className='tnh-hint'>{t('common.notificationHub.sources.osNone')}</div>
      ) : (
        <div className='tnh-presets' role='group' aria-label={t('common.notificationHub.sources.osApps')}>
          {apps.map((app) => (
            <button
              type='button'
              key={app.appId}
              aria-pressed={value.includes(app.appId)}
              title={app.appId}
              className={`tnh-chip tnh-chip--button ${value.includes(app.appId) ? 'tnh-chip--active' : ''}`}
              onClick={() => toggle(app.appId)}
            >
              {app.label} · {app.count}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** Which sources work today, which need a signed-in site, and which only have an adapter. */
const SourceCatalog: React.FC = () => {
  const { t } = useTranslation();
  return (
    <section className='tnh-section' aria-label={t('common.notificationHub.catalog.title')}>
      <div className='tnh-section-head'>
        <span>{t('common.notificationHub.catalog.title')}</span>
      </div>
      <p className='tnh-hint'>{t('common.notificationHub.catalog.intro')}</p>
      <div className='tnh-catalog'>
        {NOTIFICATION_SOURCE_CATALOG.map((entry) => (
          <span
            key={entry.id}
            className={`tnh-chip tnh-support tnh-support--${entry.support}`}
            title={t(`common.notificationHub.catalog.support.${entry.support}`)}
          >
            {entry.label}
            <small>{t(`common.notificationHub.catalog.support.${entry.support}`)}</small>
          </span>
        ))}
      </div>
    </section>
  );
};

/** Sources tab: mail accounts, sites, YouTube channels, desktop apps and feeds, plus the filtering rules. */
const NotificationSourcesPanel: React.FC<{ snapshot: NotificationHubSnapshot; showCatalog?: boolean }> = ({
  snapshot,
  showCatalog = false,
}) => {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState<FormState | undefined>();
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | undefined>();
  const { rules } = snapshot.settings;
  const [ruleText, setRuleText] = useState({ vip: '', muted: '', urgent: '' });

  useEffect(() => {
    setRuleText({
      vip: rules.vipSenders.join('\n'),
      muted: rules.mutedSenders.join('\n'),
      urgent: rules.urgentKeywords.join('\n'),
    });
  }, [rules.vipSenders, rules.mutedSenders, rules.urgentKeywords]);

  const patch = (next: Partial<FormState>) => setForm((current) => (current ? { ...current, ...next } : current));
  const statusOf = (id: string) => snapshot.status.find((entry) => entry.id === id);
  const errorText = (code: string) => t(`common.notificationHub.errors.${code}`, { defaultValue: code });

  const connectorDetail = (connector: NotificationConnector): string => {
    switch (connector.kind) {
      case 'imap':
        return `${connector.user} · ${connector.host}`;
      case 'feed':
        return connector.url;
      case 'youtube':
        return connector.channelId;
      case 'os':
        return connector.apps.length > 0 ? connector.apps.join(', ') : t('common.notificationHub.sources.osAllApps');
      case 'web':
        return connector.origin;
    }
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const existing = snapshot.settings.connectors.find((connector) => connector.id === form.id);
      const result = await notificationHubChannels.saveConnector.invoke({
        draft: draftFromForm(form, existing?.enabled ?? true),
      });
      if (result.error) {
        Message.error(errorText(result.error));
        return;
      }
      Message.success(t('common.notificationHub.sources.saved'));
      setForm(undefined);
    } catch {
      Message.error(errorText('unknown'));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (connector: NotificationConnector, enabled: boolean) => {
    const result = await notificationHubChannels.saveConnector.invoke({
      draft: draftFromConnector(connector, enabled),
    });
    if (result.error) Message.error(errorText(result.error));
  };

  const test = async (connector: NotificationConnector) => {
    setBusyId(connector.id);
    try {
      const result = await notificationHubChannels.testConnector.invoke({ id: connector.id });
      if (result.ok) Message.success(t('common.notificationHub.sources.syncOk', { count: result.count ?? 0 }));
      else
        Message.error(t('common.notificationHub.sources.syncFailed', { error: errorText(result.error ?? 'unknown') }));
    } finally {
      setBusyId(undefined);
    }
  };

  const saveRules = async (next: Partial<NotificationRules> = {}) => {
    const value: NotificationRules = {
      ...rules,
      vipSenders: splitList(ruleText.vip),
      mutedSenders: splitList(ruleText.muted),
      urgentKeywords: splitList(ruleText.urgent),
      ...next,
    };
    const saved = await notificationHubChannels.saveRules.invoke(value);
    if (saved) Message.success(t('common.notificationHub.rules.saved'));
  };

  const formatTime = (time?: number) =>
    time ? new Date(time).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' }) : undefined;

  return (
    <div className='tnh-sources'>
      <section className='tnh-section'>
        <div className='tnh-section-head'>
          <span>{t('common.notificationHub.sources.title')}</span>
          {!form && (
            <Button size='mini' type='primary' onClick={() => setForm(blankForm())}>
              {t('common.notificationHub.sources.add')}
            </Button>
          )}
        </div>
        <p className='tnh-hint'>{t('common.notificationHub.sources.intro')}</p>
        {snapshot.settings.connectors.length === 0 && !form && (
          <div className='tnh-empty'>{t('common.notificationHub.sources.none')}</div>
        )}
        {snapshot.settings.connectors.map((connector) => {
          const status = statusOf(connector.id);
          return (
            <div className='tnh-connector' key={connector.id} data-testid={`connector-${connector.id}`}>
              <div className='tnh-connector-main'>
                <div className='tnh-connector-name'>
                  <span className='tnh-chip'>{t(`common.notificationHub.sources.kind.${connector.kind}`)}</span>
                  {connector.label}
                </div>
                <div className='tnh-connector-detail'>{connectorDetail(connector)}</div>
                <div className={`tnh-connector-status ${status?.lastError ? 'tnh-connector-status--error' : ''}`}>
                  {status?.lastError
                    ? t('common.notificationHub.sources.lastError', { error: errorText(status.lastError) })
                    : status?.lastSyncAt
                      ? t('common.notificationHub.sources.lastSync', { time: formatTime(status.lastSyncAt) })
                      : connector.kind === 'web'
                        ? t('common.notificationHub.sources.webPassive')
                        : t('common.notificationHub.sources.neverSynced')}
                  {connector.kind === 'imap' && !connector.hasSecret && (
                    <span className='tnh-connector-warn'> · {t('common.notificationHub.sources.noPassword')}</span>
                  )}
                </div>
              </div>
              <div className='tnh-connector-actions'>
                <Switch
                  size='small'
                  checked={connector.enabled}
                  aria-label={t('common.notificationHub.sources.enabled')}
                  onChange={(checked) => void toggle(connector, checked)}
                />
                {connector.kind !== 'web' && (
                  <Button size='mini' loading={busyId === connector.id} onClick={() => void test(connector)}>
                    {t('common.notificationHub.sources.syncNow')}
                  </Button>
                )}
                <Button size='mini' onClick={() => setForm(formFromConnector(connector))}>
                  {t('common.notificationHub.sources.edit')}
                </Button>
                <Popconfirm
                  title={t('common.notificationHub.sources.removeConfirm')}
                  onOk={() => void notificationHubChannels.removeConnector.invoke({ id: connector.id })}
                >
                  <Button size='mini' status='danger'>
                    {t('common.notificationHub.sources.remove')}
                  </Button>
                </Popconfirm>
              </div>
            </div>
          );
        })}
      </section>

      {form && (
        <section className='tnh-section tnh-form' data-testid='connector-form'>
          {!form.id && (
            <Radio.Group
              type='button'
              size='small'
              value={form.kind}
              onChange={(kind: SourceKind) => setForm(blankForm(kind))}
            >
              {SOURCE_KINDS.map((kind) => (
                <Radio key={kind} value={kind}>
                  {t(`common.notificationHub.sources.kind.${kind}`)}
                </Radio>
              ))}
            </Radio.Group>
          )}

          {form.kind === 'imap' && (
            <>
              <label className='tnh-field'>
                <span>{t('common.notificationHub.sources.provider')}</span>
                <Select
                  size='small'
                  value={form.preset}
                  onChange={(preset: string) => patch({ preset, ...MAIL_PRESETS[preset] })}
                >
                  {[...Object.keys(MAIL_PRESETS), 'custom'].map((preset) => (
                    <Select.Option key={preset} value={preset}>
                      {t(`common.notificationHub.sources.presets.${preset}`)}
                    </Select.Option>
                  ))}
                </Select>
              </label>
              <p className='tnh-hint'>
                {t(`common.notificationHub.sources.presetHint.${form.preset in MAIL_PRESETS ? form.preset : 'custom'}`)}
              </p>
              <label className='tnh-field'>
                <span>{t('common.notificationHub.sources.user')}</span>
                <Input size='small' value={form.user} onChange={(user) => patch({ user })} autoComplete='off' />
              </label>
              <label className='tnh-field'>
                <span>{t('common.notificationHub.sources.password')}</span>
                <Input.Password
                  size='small'
                  value={form.password}
                  onChange={(password) => patch({ password })}
                  autoComplete='new-password'
                  placeholder={form.id ? t('common.notificationHub.sources.passwordKeep') : undefined}
                />
              </label>
              {form.preset === 'custom' && (
                <div className='tnh-field-row'>
                  <label className='tnh-field'>
                    <span>{t('common.notificationHub.sources.host')}</span>
                    <Input size='small' value={form.host} onChange={(host) => patch({ host })} />
                  </label>
                  <label className='tnh-field tnh-field--narrow'>
                    <span>{t('common.notificationHub.sources.port')}</span>
                    <InputNumber
                      size='small'
                      min={1}
                      max={65535}
                      value={form.port}
                      onChange={(port) => patch({ port: Number(port) || 993 })}
                    />
                  </label>
                </div>
              )}
              <label className='tnh-field'>
                <span>{t('common.notificationHub.sources.mailbox')}</span>
                <Input size='small' value={form.mailbox} onChange={(mailbox) => patch({ mailbox })} />
              </label>
              <div className='tnh-switch-row'>
                <span>
                  {t('common.notificationHub.sources.preview')}
                  <small className='tnh-hint'>{t('common.notificationHub.sources.previewHint')}</small>
                </span>
                <Switch
                  size='small'
                  checked={form.preview}
                  aria-label={t('common.notificationHub.sources.preview')}
                  onChange={(preview) => patch({ preview })}
                />
              </div>
            </>
          )}

          {form.kind === 'feed' && (
            <label className='tnh-field'>
              <span>{t('common.notificationHub.sources.url')}</span>
              <Input size='small' value={form.url} onChange={(url) => patch({ url })} placeholder='https://' />
            </label>
          )}

          {form.kind === 'youtube' && (
            <>
              <p className='tnh-hint'>{t('common.notificationHub.sources.youtubeHint')}</p>
              <label className='tnh-field'>
                <span>{t('common.notificationHub.sources.channel')}</span>
                <Input
                  size='small'
                  value={form.channel}
                  onChange={(channel) => patch({ channel })}
                  placeholder='@channel'
                />
              </label>
            </>
          )}

          {form.kind === 'os' && <OsAppPicker value={form.apps} onChange={(apps) => patch({ apps })} />}

          {form.kind === 'web' && (
            <>
              <p className='tnh-hint'>{t('common.notificationHub.sources.webHint')}</p>
              {SITE_GROUPS.map((group) => (
                <div key={group} className='tnh-preset-group'>
                  <span className='tnh-preset-group-label'>{t(`common.notificationHub.catalog.group.${group}`)}</span>
                  <div className='tnh-presets'>
                    {SITE_PRESETS.filter((site) => site.group === group).map((site) => (
                      <button
                        type='button'
                        key={site.origin}
                        aria-pressed={form.origin === site.origin}
                        className={`tnh-chip tnh-chip--button ${form.origin === site.origin ? 'tnh-chip--active' : ''}`}
                        onClick={() =>
                          patch({
                            origin: site.origin,
                            label: form.label || site.label,
                            captureNotifications: site.captureNotifications === true,
                          })
                        }
                      >
                        {site.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <label className='tnh-field'>
                <span>{t('common.notificationHub.sources.origin')}</span>
                <Input
                  size='small'
                  value={form.origin}
                  onChange={(origin) => patch({ origin })}
                  placeholder='example.com'
                />
              </label>
              <div className='tnh-switch-row'>
                <span>
                  {t('common.notificationHub.sources.capture')}
                  <small className='tnh-hint'>{t('common.notificationHub.sources.captureHint')}</small>
                </span>
                <Switch
                  size='small'
                  checked={form.captureNotifications}
                  aria-label={t('common.notificationHub.sources.capture')}
                  onChange={(captureNotifications) => patch({ captureNotifications })}
                />
              </div>
            </>
          )}

          <label className='tnh-field'>
            <span>{t('common.notificationHub.sources.label')}</span>
            <Input size='small' value={form.label} onChange={(label) => patch({ label })} />
          </label>
          {form.kind !== 'web' && (
            <label className='tnh-field tnh-field--narrow'>
              <span>{t('common.notificationHub.sources.interval')}</span>
              <InputNumber
                size='small'
                min={form.kind === 'os' ? 1 : form.kind === 'youtube' ? 15 : 2}
                max={240}
                value={form.intervalMinutes}
                onChange={(value) => patch({ intervalMinutes: Number(value) || DEFAULT_INTERVAL[form.kind] })}
              />
            </label>
          )}
          <div className='tnh-form-actions'>
            <Button size='small' onClick={() => setForm(undefined)}>
              {t('common.notificationHub.sources.cancel')}
            </Button>
            <Button size='small' type='primary' loading={saving} onClick={() => void save()}>
              {t('common.notificationHub.sources.save')}
            </Button>
          </div>
        </section>
      )}

      <section className='tnh-section'>
        <div className='tnh-section-head'>
          <span>{t('common.notificationHub.rules.title')}</span>
        </div>
        <div className='tnh-switch-row'>
          <span>
            {t('common.notificationHub.rules.useLaya')}
            <small className='tnh-hint'>
              {snapshot.layaReady
                ? t('common.notificationHub.rules.layaRunning')
                : t('common.notificationHub.rules.layaStopped')}
            </small>
          </span>
          <Switch size='small' checked={rules.useLaya} onChange={(useLaya) => void saveRules({ useLaya })} />
        </div>
        <div className='tnh-switch-row'>
          <span>{t('common.notificationHub.rules.systemAlerts')}</span>
          <Switch
            size='small'
            checked={rules.systemAlertsForP0}
            onChange={(systemAlertsForP0) => void saveRules({ systemAlertsForP0 })}
          />
        </div>
        {(['vip', 'muted', 'urgent'] as const).map((key) => (
          <label className='tnh-field' key={key}>
            <span>{t(`common.notificationHub.rules.${key}`)}</span>
            <Input.TextArea
              autoSize={{ minRows: 1, maxRows: 4 }}
              value={ruleText[key]}
              placeholder={t(`common.notificationHub.rules.${key}Placeholder`)}
              onChange={(value) => setRuleText((current) => ({ ...current, [key]: value }))}
            />
          </label>
        ))}
        <div className='tnh-form-actions'>
          <Button size='small' type='primary' onClick={() => void saveRules()}>
            {t('common.notificationHub.rules.save')}
          </Button>
        </div>
      </section>
      {showCatalog && <SourceCatalog />}
    </div>
  );
};

export default NotificationSourcesPanel;
