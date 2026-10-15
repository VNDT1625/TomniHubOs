/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Robot } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

export type AutoSelectRowProps = {
  autoSelect: boolean;
  onToggleAutoSelect: () => void;
};

/**
 * Top row of the attach or tools menu: a switch row for Auto mode. It is one native button with role="switch" and
 * aria-checked, so Space and Enter toggle it and screen readers announce its state. The icon, the tinted background
 * and the track all change with the state. When Auto is on the manual lists are hidden; the caller owns that state.
 */
export const AutoSelectRow: React.FC<AutoSelectRowProps> = ({ autoSelect, onToggleAutoSelect }) => {
  const { t } = useTranslation();
  const title = t('conversation.attachMenu.autoSelect', { defaultValue: 'Auto' });
  const hint = autoSelect
    ? t('conversation.attachMenu.autoSelectHint', {
        defaultValue: 'Laya will pick the matching plugins, skills and hooks',
      })
    : t('conversation.attachMenu.autoSelectOffHint', {
        defaultValue: 'Turn on to let Laya choose plugins, skills and hooks',
      });
  return (
    <>
      <button
        type='button'
        role='switch'
        aria-checked={autoSelect}
        aria-label={title}
        className={`attach-menu__auto ${autoSelect ? 'attach-menu__auto--on' : ''}`}
        onClick={onToggleAutoSelect}
        data-testid='attach-auto-select'
        data-state={autoSelect ? 'on' : 'off'}
      >
        <span className='attach-menu__auto-icon' aria-hidden='true'>
          <Robot theme='outline' size={16} strokeWidth={2.5} />
        </span>
        <span className='attach-menu__auto-text'>
          <span className='attach-menu__auto-title'>{title}</span>
          <span className='attach-menu__auto-hint' data-testid='attach-auto-hint'>
            {hint}
          </span>
        </span>
        <span className='attach-menu__switch' aria-hidden='true' data-testid='attach-auto-select-switch'>
          <span className='attach-menu__switch-knob' />
        </span>
      </button>
      <div className='attach-menu__divider' />
    </>
  );
};
