/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_HOOK_EVENTS } from '@/common/integrations/hooks/events';
import type { HookSettingsNewUserHook } from '@/common/integrations/hooks/hookSettings';

type HookCreateFormProps = {
  busy: boolean;
  /** Resolves true when Main accepted the hook; the form then clears itself. */
  onCreate: (hook: HookSettingsNewUserHook) => Promise<boolean>;
};

const DEFAULT_TIMEOUT_SEC = 30;
const MIN_TIMEOUT_SEC = 1;
const MAX_TIMEOUT_SEC = 600;

/** Adds a hook of your own. It is created off; nothing runs until it is reviewed and approved. */
const HookCreateForm: React.FC<HookCreateFormProps> = ({ busy, onCreate }) => {
  const { t } = useTranslation();
  const headingId = useId();
  const [event, setEvent] = useState<string>(SUPPORTED_HOOK_EVENTS[0]);
  const [matcher, setMatcher] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [timeout, setTimeoutSec] = useState(String(DEFAULT_TIMEOUT_SEC));

  const submit = async (submitEvent: React.FormEvent): Promise<void> => {
    submitEvent.preventDefault();
    const program = command.trim();
    if (program === '') return;
    const argList = args
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    const seconds = Math.min(
      MAX_TIMEOUT_SEC,
      Math.max(MIN_TIMEOUT_SEC, Math.round(Number(timeout) || DEFAULT_TIMEOUT_SEC))
    );
    const created = await onCreate({
      event,
      ...(matcher.trim() === '' ? {} : { matcher: matcher.trim() }),
      command: program,
      // Arguments present means exec form: the program runs directly, without a shell.
      ...(argList.length > 0 ? { args: argList } : {}),
      timeoutSec: seconds,
    });
    if (created) {
      setCommand('');
      setArgs('');
      setMatcher('');
    }
  };

  return (
    <section className='hooks-section' aria-labelledby={headingId} data-testid='hook-create'>
      <h3 id={headingId} className='hooks-section-title'>
        {t('settings.hooks.create.title')}
      </h3>
      <p className='hooks-hint'>{t('settings.hooks.create.note')}</p>
      <form className='hooks-form' onSubmit={(submitEvent) => void submit(submitEvent)}>
        <label className='hooks-field'>
          <span>{t('settings.hooks.create.event')}</span>
          <select value={event} onChange={(changeEvent) => setEvent(changeEvent.target.value)}>
            {SUPPORTED_HOOK_EVENTS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className='hooks-field'>
          <span>{t('settings.hooks.create.matcher')}</span>
          <input value={matcher} maxLength={1000} onChange={(changeEvent) => setMatcher(changeEvent.target.value)} />
          <small>{t('settings.hooks.create.matcherHint')}</small>
        </label>
        <label className='hooks-field'>
          <span>{t('settings.hooks.create.command')}</span>
          <input
            value={command}
            maxLength={500}
            required
            onChange={(changeEvent) => setCommand(changeEvent.target.value)}
          />
        </label>
        <label className='hooks-field'>
          <span>{t('settings.hooks.create.args')}</span>
          <textarea rows={3} value={args} onChange={(changeEvent) => setArgs(changeEvent.target.value)} />
          <small>{t('settings.hooks.create.argsHint')}</small>
        </label>
        <label className='hooks-field'>
          <span>{t('settings.hooks.create.timeout')}</span>
          <input
            type='number'
            min={MIN_TIMEOUT_SEC}
            max={MAX_TIMEOUT_SEC}
            value={timeout}
            onChange={(changeEvent) => setTimeoutSec(changeEvent.target.value)}
          />
        </label>
        <div className='hooks-actions'>
          <button type='submit' className='hooks-btn hooks-btn--primary' disabled={busy || command.trim() === ''}>
            {t('settings.hooks.create.submit')}
          </button>
        </div>
      </form>
    </section>
  );
};

export default HookCreateForm;
