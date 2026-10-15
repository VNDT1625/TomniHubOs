/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TurnRecoveryView } from './useTomnyAgenticTurnRecovery';

type InterruptionRecoveryBannerProps = {
  recovery: TurnRecoveryView | null;
  onCancel: () => void;
  onRetryNow: () => void;
};

/** Whole seconds left until `deadlineAt`, re-rendered every second while shown. */
const useSecondsLeft = (deadlineAt: number): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [deadlineAt]);
  return Math.max(0, Math.ceil((deadlineAt - now) / 1_000));
};

const formatClock = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/**
 * Visible notice shown when a turn was interrupted unintentionally. It replaces the
 * old toast-only feedback: the user sees the countdown and can cancel it or retry now.
 */
const InterruptionRecoveryBanner: React.FC<InterruptionRecoveryBannerProps> = ({ recovery, onCancel, onRetryNow }) => {
  const { t } = useTranslation();
  const deadlineAt = recovery?.deadlineAt ?? 0;
  const secondsLeft = useSecondsLeft(deadlineAt);

  if (!recovery) return null;

  if (recovery.kind === 'exhausted') {
    return (
      <div
        role='status'
        aria-live='polite'
        className='flex items-center justify-between gap-12px px-16px py-10px mb-8px rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--color-fill-2)]'
      >
        <span className='text-13px text-t-secondary'>
          {t('conversation.interruptionRecovery.exhaustedTitle', {
            max: recovery.maxAttempts,
            time: formatClock(secondsLeft),
          })}
        </span>
        <div className='flex items-center gap-8px shrink-0'>
          <Button size='small' type='primary' onClick={onRetryNow}>
            {t('conversation.interruptionRecovery.retryNow')}
          </Button>
          <Button size='small' onClick={onCancel}>
            {t('conversation.interruptionRecovery.dismiss')}
          </Button>
        </div>
      </div>
    );
  }

  const titleKey = recovery.asking
    ? 'conversation.interruptionRecovery.askTitle'
    : 'conversation.interruptionRecovery.countdownTitle';

  return (
    <div
      role='status'
      aria-live='polite'
      className='flex items-center justify-between gap-12px px-16px py-10px mb-8px rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--color-fill-2)]'
    >
      <span className='text-13px text-t-secondary'>
        {t(titleKey, {
          seconds: secondsLeft,
          attempt: recovery.attempt,
          max: recovery.maxAttempts,
        })}
      </span>
      <div className='flex items-center gap-8px shrink-0'>
        <Button size='small' type='primary' onClick={onRetryNow}>
          {t('conversation.interruptionRecovery.retryNow')}
        </Button>
        <Button size='small' onClick={onCancel}>
          {t('conversation.interruptionRecovery.cancel')}
        </Button>
      </div>
    </div>
  );
};

export default InterruptionRecoveryBanner;
