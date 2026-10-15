/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isHookSettingsFailure,
  type HookSettingsDescription,
  type HookSettingsErrorCode,
  type HookSettingsNativeAPI,
  type HookSettingsResult,
  type HookSettingsRow,
} from '@/common/integrations/hooks/hookSettings';

type HookApprovalDialogProps = {
  api: HookSettingsNativeAPI;
  hookId: string;
  /** Sends the approval through the page's action runner. The hash is the one this dialog showed. */
  onApprove: (hookId: string, approvalHash: string) => Promise<HookSettingsResult<HookSettingsRow>>;
  onClose: () => void;
};

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; description: HookSettingsDescription }
  | { kind: 'error'; code: HookSettingsErrorCode };

/**
 * Shows exactly what Main says would run, as the lines `describeHook` produced, and approves only the hash of those
 * lines. If the hook changed since, Main refuses and the dialog reads it again instead of approving something new.
 */
const HookApprovalDialog: React.FC<HookApprovalDialogProps> = ({ api, hookId, onApprove, onClose }) => {
  const { t } = useTranslation();
  const titleId = useId();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<HookSettingsErrorCode | undefined>();
  const dialogRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (): Promise<void> => {
    setPhase({ kind: 'loading' });
    try {
      const result = await api.describe({ hookId });
      setPhase(
        isHookSettingsFailure(result)
          ? { kind: 'error', code: result.error }
          : { kind: 'ready', description: result.data }
      );
    } catch {
      setPhase({ kind: 'error', code: 'IO_ERROR' });
    }
  }, [api, hookId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const approve = async (): Promise<void> => {
    if (phase.kind !== 'ready') return;
    setSending(true);
    setProblem(undefined);
    const result = await onApprove(hookId, phase.description.approvalHash);
    setSending(false);
    if (isHookSettingsFailure(result)) {
      setProblem(result.error);
      if (result.error === 'HASH_MISMATCH') await load();
      return;
    }
    onClose();
  };

  const valueOf = (key: string, value: string): string => {
    if (key === 'source') return t(`settings.hooks.source.${value}`);
    if (key === 'form') return t(`settings.hooks.row.form.${value}`);
    if (key === 'network' && value === 'unrestricted') return t('settings.hooks.networkUnrestricted');
    return value;
  };

  return (
    <div className='hooks-dialog-mask' data-testid='hook-approval-mask'>
      <div
        ref={dialogRef}
        className='hooks-dialog'
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !sending) onClose();
        }}
      >
        <h3 id={titleId} className='hooks-dialog-title'>
          {t('settings.hooks.dialog.title')}
        </h3>
        <p className='hooks-hint'>{t('settings.hooks.dialog.intro')}</p>

        {phase.kind === 'loading' ? <p className='hooks-empty'>{t('settings.hooks.dialog.loading')}</p> : null}
        {phase.kind === 'error' ? (
          <p className='hooks-notice hooks-notice--error' role='alert'>
            {t(`settings.hooks.error.${phase.code}`)}
          </p>
        ) : null}
        {phase.kind === 'ready' ? (
          <dl className='hooks-lines' data-testid='hook-approval-lines'>
            {phase.description.lines.map((line, index) => (
              // Lines repeat keys (several arguments, several files), so the position keeps them apart.
              // oxlint-disable-next-line react/no-array-index-key
              <React.Fragment key={`${line.key}:${index}`}>
                <dt>{t(`settings.hooks.line.${line.key}`)}</dt>
                <dd data-line={line.key}>
                  <code>{valueOf(line.key, line.value)}</code>
                </dd>
              </React.Fragment>
            ))}
          </dl>
        ) : null}

        <p className='hooks-hint'>{t('settings.hooks.dialog.hashNote')}</p>
        {problem ? (
          <p className='hooks-notice hooks-notice--error' role='alert'>
            {t(`settings.hooks.error.${problem}`)}
          </p>
        ) : null}

        <div className='hooks-actions'>
          <button type='button' className='hooks-btn' disabled={sending} onClick={onClose}>
            {t('settings.hooks.dialog.cancel')}
          </button>
          <button
            type='button'
            className='hooks-btn hooks-btn--primary'
            disabled={sending || phase.kind !== 'ready'}
            onClick={() => void approve()}
          >
            {t('settings.hooks.dialog.approve')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default HookApprovalDialog;
