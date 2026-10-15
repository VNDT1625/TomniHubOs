/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

/** One row in an attach or tools menu. Shared by the chat "+" menu and the Home action row. */
export const MenuItem: React.FC<{
  icon: React.ReactNode;
  label: React.ReactNode;
  description?: React.ReactNode;
  suffix?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  title?: string;
  active?: boolean;
  testId?: string;
}> = ({ icon, label, description, suffix, onClick, className = '', title, active = false, testId }) => (
  <div
    className={`attach-menu__item flex items-center gap-10px px-12px py-9px rounded-8px cursor-pointer text-14px text-t-primary select-none ${active ? 'attach-menu__item--active' : ''} ${className}`}
    onClick={onClick}
    title={title}
    data-testid={testId}
  >
    <span className='flex-shrink-0 inline-flex items-center justify-center color-#86909c w-18px leading-none'>
      {icon}
    </span>
    <span className='min-w-0 flex-1'>
      <span className='block leading-none truncate'>{label}</span>
      {description ? <span className='mt-4px block text-12px leading-16px text-t-secondary'>{description}</span> : null}
    </span>
    {suffix}
  </div>
);
