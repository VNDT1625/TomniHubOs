/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Checkbox } from '@arco-design/web-react';
import { Down, Right } from '@icon-park/react';
import React, { useState } from 'react';
import type { GroupCheckState } from './attachMenuModel';

/** Plugin groups expanded in this app session, by group key. Kept in memory only: nothing is persisted. */
const expandedGroupKeys = new Set<string>();

/** Forgets which plugin groups were expanded. Used by tests to start from the collapsed default. */
export const resetPluginGroupExpansion = (): void => {
  expandedGroupKeys.clear();
};

export type PluginGroupCheck = {
  state: GroupCheckState;
  label: string;
  testId: string;
  /** Sets every member to one state (the caller decides which members change). */
  onToggle: () => void;
};

export type PluginGroupProps = {
  /** Unique within one menu column, for example `skills:<packageId>`. */
  groupKey: string;
  testId: string;
  /** Plugin display name. Shown on one line with an ellipsis; the full name is in the tooltip. */
  name: string;
  countLabel: string;
  /** Group checkbox. Omitted where the list has no selection state. */
  check?: PluginGroupCheck;
  children: React.ReactNode;
};

/**
 * One plugin's members inside a menu column. Collapsed by default. The expand control is a native button with
 * aria-expanded, so Enter and Space work; the group checkbox is a separate control beside it.
 */
export const PluginGroup: React.FC<PluginGroupProps> = ({ groupKey, testId, name, countLabel, check, children }) => {
  const [expanded, setExpanded] = useState(() => expandedGroupKeys.has(groupKey));
  const toggleExpanded = () => {
    const next = !expanded;
    if (next) expandedGroupKeys.add(groupKey);
    else expandedGroupKeys.delete(groupKey);
    setExpanded(next);
  };
  return (
    <div className='attach-menu__plugin-group' data-testid={testId}>
      <div className='attach-menu__plugin-head'>
        {check ? (
          <Checkbox
            className='attach-menu__plugin-check'
            checked={check.state === 'checked'}
            indeterminate={check.state === 'indeterminate'}
            onChange={() => check.onToggle()}
            aria-label={check.label}
            data-testid={check.testId}
          />
        ) : null}
        <button
          type='button'
          className='attach-menu__plugin-toggle'
          aria-expanded={expanded}
          data-testid={`${testId}-toggle`}
          onClick={toggleExpanded}
        >
          <span className='attach-menu__group-name' title={name}>
            {name}
          </span>
          <span className='attach-menu__group-counts'>{countLabel}</span>
          {expanded ? (
            <Down theme='outline' size={12} strokeWidth={3} />
          ) : (
            <Right theme='outline' size={12} strokeWidth={3} />
          )}
        </button>
      </div>
      {expanded ? <div className='attach-menu__plugin-body'>{children}</div> : null}
    </div>
  );
};
