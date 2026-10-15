/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HookSettingsRow, HookSettingsSource } from '@/common/integrations/hooks/hookSettings';
import HookApprovalDialog from './HookApprovalDialog';
import HookAudit from './HookAudit';
import HookCoverage from './HookCoverage';
import HookCreateForm from './HookCreateForm';
import HookSourceSection from './HookSourceSection';
import { getHookSettingsApi, useHookSettings } from './useHookSettings';

const SOURCES: readonly HookSettingsSource[] = ['package', 'user', 'workspace'];

/**
 * Settings, Hooks (design surface S10): hooks by source, the exact command and what would run, approval pinned to the
 * content, the global and per-source switches, an honest statement of what tool hooks can stop, and the audit.
 * Every number and state shown here comes from Main; the page never computes an approval hash.
 */
const HooksPage: React.FC = () => {
  const { t } = useTranslation();
  const api = getHookSettingsApi();
  const { state, refresh, act, dismissNotice } = useHookSettings(api);
  const [reviewing, setReviewing] = useState<string | undefined>();

  if (!api || state.phase === 'unavailable') {
    return (
      <div className='hooks-page'>
        <h2 className='hooks-title'>{t('settings.hooks.title')}</h2>
        <p className='hooks-empty' role='status'>
          {t('settings.hooks.unavailable')}
        </p>
      </div>
    );
  }

  const { busy, hooks, switches, notice } = state;

  return (
    <div className='hooks-page' data-testid='hooks-page'>
      <header className='hooks-header'>
        <div>
          <h2 className='hooks-title'>{t('settings.hooks.title')}</h2>
          <p className='hooks-hint'>{t('settings.hooks.description')}</p>
        </div>
        <label className='hooks-switch hooks-switch--master'>
          <input
            type='checkbox'
            role='switch'
            data-testid='hooks-master-switch'
            checked={!switches.disableAll}
            disabled={busy || state.phase === 'loading'}
            onChange={(event) => void act(() => api.setDisableAll({ disabled: !event.target.checked }))}
          />
          <span>{t('settings.hooks.runAll')}</span>
        </label>
      </header>

      {switches.disableAll ? (
        <p className='hooks-notice hooks-notice--warn' role='status' data-testid='hooks-all-off'>
          {t('settings.hooks.allOffNote')}
        </p>
      ) : null}

      {notice ? (
        <p
          className={`hooks-notice ${notice.kind === 'ok' ? 'hooks-notice--ok' : 'hooks-notice--error'}`}
          role={notice.kind === 'ok' ? 'status' : 'alert'}
          data-testid='hooks-notice'
        >
          <span>{notice.kind === 'ok' ? notice.message : t(`settings.hooks.error.${notice.code}`)}</span>
          <button
            type='button'
            className='hooks-btn hooks-btn--ghost'
            onClick={dismissNotice}
            aria-label={t('settings.hooks.dismiss')}
          >
            ×
          </button>
        </p>
      ) : null}

      {state.phase === 'loading' ? <p className='hooks-empty'>{t('settings.hooks.loading')}</p> : null}

      <HookCoverage coverage={state.coverage} />

      {SOURCES.map((source) => (
        <HookSourceSection
          key={source}
          source={source}
          hooks={hooks.filter((hook) => hook.source === source)}
          enabled={switches.sources[source]}
          busy={busy}
          onToggleSource={(name, enabled) => void act(() => api.setSourceEnabled({ source: name, enabled }))}
          onReview={(hook: HookSettingsRow) => setReviewing(hook.id)}
          onSetEnabled={(hook, enabled) => void act(() => api.setEnabled({ hookId: hook.id, enabled }))}
          onRemove={(hook) => void act(() => api.removeUser({ hookId: hook.id }), t('settings.hooks.done.removed'))}
        />
      ))}

      <HookCreateForm
        busy={busy}
        onCreate={async (hook) => (await act(() => api.createUser(hook), t('settings.hooks.done.created'))).ok}
      />

      <HookAudit lines={state.audit} onRefresh={() => void refresh()} />

      {reviewing ? (
        <HookApprovalDialog
          api={api}
          hookId={reviewing}
          onApprove={(hookId, approvalHash) =>
            act(() => api.approve({ hookId, approvalHash }), t('settings.hooks.done.approved'))
          }
          onClose={() => setReviewing(undefined)}
        />
      ) : null}
    </div>
  );
};

export default HooksPage;
