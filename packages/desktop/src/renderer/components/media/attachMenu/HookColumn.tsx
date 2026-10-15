/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HookSettingsRow } from '@/common/integrations/hooks/hookSettings';
import React from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { groupEntriesByPackage } from './attachMenuModel';
import { PluginGroup } from './PluginGroup';

/** Hooks that would run now. Fails closed: no bridge means no hooks are listed. */
export const loadActiveHookRows = async (): Promise<HookSettingsRow[]> => {
  try {
    const result = await window.electronAPI?.hookSettings?.list();
    if (!result?.ok) return [];
    return result.data.hooks.filter((hook) => hook.active);
  } catch {
    return [];
  }
};

/** Active hooks for the attach menus. Read-only: hooks run on events and are switched on or off in Settings. */
export const useActiveHookRows = (): HookSettingsRow[] => {
  const { data } = useSWR('attach-menu-active-hooks', loadActiveHookRows);
  return data ?? [];
};

type HookEntry = { hook: HookSettingsRow; packageId?: string };

const commandLabel = (command: string): string => (command.length > 48 ? `${command.slice(0, 47)}...` : command);

const HookRow: React.FC<{ hook: HookSettingsRow }> = ({ hook }) => {
  const meta = [hook.event, hook.matcher].filter((part): part is string => Boolean(part)).join(' · ');
  return (
    <div className='attach-menu__item cursor-default' data-testid={`attach-hook-${hook.id}`} title={hook.command}>
      <div className='flex items-center gap-10px px-12px py-9px min-w-0'>
        <span className='min-w-0 flex-1'>
          <span className='block text-13px leading-16px truncate'>{commandLabel(hook.command)}</span>
          <span className='attach-menu__hook-meta'>{meta}</span>
        </span>
      </div>
    </div>
  );
};

/**
 * The Hook column of the plus and tools menus. Lists the active hooks: package hooks grouped by package (one collapsed
 * row per plugin), user and workspace hooks under "Other". No checkboxes: the registry has no per-session switch, so the
 * note says where to change them.
 */
export const HookMenuList: React.FC<{ hooks: HookSettingsRow[]; packageNames: ReadonlyMap<string, string> }> = ({
  hooks,
  packageNames,
}) => {
  const { t } = useTranslation();
  const entries: HookEntry[] = hooks.map((hook) => ({
    hook,
    packageId: hook.source === 'package' ? hook.pluginId : undefined,
  }));
  const { standalone, groups } = groupEntriesByPackage(entries, packageNames);
  const note = (
    <div className='attach-menu__note' data-testid='attach-hook-note'>
      {t('conversation.attachMenu.hookNote', {
        defaultValue: 'Hooks run on events. Turn them on or off in Settings.',
      })}
    </div>
  );
  if (hooks.length === 0) {
    return (
      <>
        <div className='attach-menu__panel-scroll'>
          <div className='px-12px py-12px text-13px text-t-secondary' data-testid='attach-hook-empty'>
            {t('conversation.attachMenu.hookEmpty', { defaultValue: 'No active hooks' })}
          </div>
        </div>
        {note}
      </>
    );
  }
  return (
    <>
      <div className='attach-menu__panel-scroll' data-testid='attach-hook-list'>
        {standalone.length > 0 ? (
          <div className='attach-menu__section-label'>
            {t('conversation.attachMenu.otherGroup', { defaultValue: 'Other' })}
          </div>
        ) : null}
        {standalone.map((entry) => (
          <HookRow key={entry.hook.id} hook={entry.hook} />
        ))}
        {groups.map((group) => (
          <PluginGroup
            key={group.packageId}
            groupKey={`hooks:${group.packageId}`}
            testId={`attach-hook-group-${group.packageId}`}
            name={group.name}
            countLabel={t('conversation.attachMenu.hookCount', {
              count: group.items.length,
              defaultValue: '{{count}} hook',
            })}
          >
            {group.items.map((entry) => (
              <HookRow key={entry.hook.id} hook={entry.hook} />
            ))}
          </PluginGroup>
        ))}
      </div>
      {note}
    </>
  );
};
