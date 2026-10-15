/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import CapabilityRemoveModal from '@/renderer/pages/settings/ToolsSettings/CapabilityRemoveModal';
import type { HookSettingsRow } from '@/common/integrations/hooks/hookSettings';

type HookRowProps = {
  hook: HookSettingsRow;
  busy: boolean;
  onReview: (hook: HookSettingsRow) => void;
  onSetEnabled: (hook: HookSettingsRow, enabled: boolean) => void;
  onRemove: (hook: HookSettingsRow) => void;
  /** Package hooks follow their plugin: status and command are shown, and no action is offered here. */
  readOnly?: boolean;
};

/**
 * One hook: the exact command, what would run, its state and what the person can do about it. The command is shown
 * as Main reports it (the hook's own paths are already replaced by placeholders).
 */
const HookRow: React.FC<HookRowProps> = ({ hook, busy, onReview, onSetEnabled, onRemove, readOnly = false }) => {
  const { t } = useTranslation();
  const args = hook.args ?? [];
  const canReview =
    !readOnly && (hook.status === 'needs-approval' || hook.status === 'stale' || hook.status === 'disabled');
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const commandLine = [hook.command, ...args].join(' ');

  return (
    <li className='hooks-row' data-testid='hook-row' data-hook-id={hook.id} data-status={hook.status}>
      <div className='hooks-row-head'>
        <span className='hooks-chip'>{hook.event}</span>
        <span className='hooks-chip hooks-chip--muted'>
          {t('settings.hooks.row.matcher')}:{' '}
          {hook.matcher && hook.matcher !== '*' ? hook.matcher : t('settings.hooks.row.matchAll')}
        </span>
        <span className='hooks-chip hooks-chip--muted'>{t(`settings.hooks.row.form.${hook.form}`)}</span>
        {hook.pluginId ? <span className='hooks-chip hooks-chip--muted'>{hook.pluginId}</span> : null}
        <span className='hooks-status' data-status={hook.status} data-testid='hook-status'>
          {t(`settings.hooks.status.${hook.status}`)}
        </span>
      </div>

      <div className='hooks-command-block'>
        <span className='hooks-label'>{t('settings.hooks.row.command')}</span>
        <code className='hooks-command' data-testid='hook-command'>
          {hook.command}
        </code>
        {args.length > 0 ? (
          <ol className='hooks-args'>
            {args.map((arg, index) => (
              // The position is part of the meaning of an argument, so it is a stable key.
              // oxlint-disable-next-line react/no-array-index-key
              <li key={index}>
                <code data-testid='hook-arg'>{arg}</code>
              </li>
            ))}
          </ol>
        ) : null}
        <p className='hooks-runs' data-testid='hook-what-runs'>
          {hook.form === 'exec'
            ? t('settings.hooks.row.runsExec', { program: hook.command, count: args.length })
            : t('settings.hooks.row.runsShell')}
        </p>
        <p className='hooks-meta'>
          {t('settings.hooks.row.timeout')}: {t('settings.hooks.row.seconds', { count: hook.timeoutSec })}
          {hook.approved && hook.approvedAt !== undefined
            ? ` · ${t('settings.hooks.row.approvedAt', { time: new Date(hook.approvedAt).toLocaleString() })}`
            : ''}
        </p>
      </div>

      {hook.status !== 'ready' ? <p className='hooks-hint'>{t(`settings.hooks.statusHint.${hook.status}`)}</p> : null}
      {hook.status === 'ready' && !hook.active ? (
        <p className='hooks-hint'>{t('settings.hooks.inactiveBySwitch')}</p>
      ) : null}

      <CapabilityRemoveModal
        visible={confirmingRemove}
        name={hook.command}
        detail={commandLine}
        onCancel={() => setConfirmingRemove(false)}
        onConfirm={() => {
          setConfirmingRemove(false);
          onRemove(hook);
        }}
      />

      <div className='hooks-actions'>
        {canReview ? (
          <button type='button' className='hooks-btn hooks-btn--primary' disabled={busy} onClick={() => onReview(hook)}>
            {t(hook.status === 'needs-approval' ? 'settings.hooks.action.review' : 'settings.hooks.action.reapprove')}
          </button>
        ) : null}
        {!readOnly && hook.status === 'disabled' ? (
          <button type='button' className='hooks-btn' disabled={busy} onClick={() => onSetEnabled(hook, true)}>
            {t('settings.hooks.action.enable')}
          </button>
        ) : null}
        {!readOnly && hook.status === 'ready' ? (
          <button type='button' className='hooks-btn' disabled={busy} onClick={() => onSetEnabled(hook, false)}>
            {t('settings.hooks.action.disable')}
          </button>
        ) : null}
        {!readOnly && hook.source === 'user' ? (
          <button
            type='button'
            className='hooks-btn hooks-btn--danger'
            disabled={busy}
            onClick={() => setConfirmingRemove(true)}
          >
            {t('settings.hooks.action.remove')}
          </button>
        ) : null}
      </div>
    </li>
  );
};

export default HookRow;
