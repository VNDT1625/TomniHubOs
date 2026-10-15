/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  AllApplication,
  Click,
  Earth,
  Link,
  MessageOne,
  Plug,
  Refresh,
  SettingConfig,
  SettingTwo,
  Application,
} from '@icon-park/react';
import { SCOPE_ALL, type AliasMap } from './engine/aliases';
import { isSourceEnabled, type SuperSearchConfig } from './engine/config';
import type { AggregatedRow, SearchIconKey, SearchProvider, SourceState } from './engine/types';
import SuperSearchConfigPanel from './SuperSearchConfigPanel';
import type { SuperSearchMode } from './useSuperSearch';

const ICONS: Record<SearchIconKey, React.ReactNode> = {
  chat: <MessageOne theme='outline' size={16} fill='currentColor' />,
  app: <AllApplication theme='outline' size={16} fill='currentColor' />,
  setting: <SettingTwo theme='outline' size={16} fill='currentColor' />,
  page: <Application theme='outline' size={16} fill='currentColor' />,
  action: <Refresh theme='outline' size={16} fill='currentColor' />,
  web: <Earth theme='outline' size={16} fill='currentColor' />,
  site: <Link theme='outline' size={16} fill='currentColor' />,
  connected: <Plug theme='outline' size={16} fill='currentColor' />,
};

export type SuperSearchPanelProps = {
  mode: SuperSearchMode;
  listboxId: string;
  optionId: (index: number) => string;
  providers: readonly SearchProvider[];
  activeProviders: readonly SearchProvider[];
  config: SuperSearchConfig;
  aliasMap: AliasMap;
  scope: string;
  text: string;
  disabledScope: boolean;
  states: Record<string, SourceState>;
  rows: readonly AggregatedRow[];
  activeIndex: number;
  configOpen: boolean;
  onScopeChange: (scope: string) => void;
  onHover: (index: number) => void;
  onPick: (row: AggregatedRow) => void;
  onConfigToggle: () => void;
  onConfigChange: (config: SuperSearchConfig) => void;
};

/** Centre-of-screen results panel: scope tabs, per-source groups with rank badges, and source settings. */
const SuperSearchPanel: React.FC<SuperSearchPanelProps> = ({
  mode,
  listboxId,
  optionId,
  providers,
  activeProviders,
  config,
  aliasMap,
  scope,
  text,
  disabledScope,
  states,
  rows,
  activeIndex,
  configOpen,
  onScopeChange,
  onHover,
  onPick,
  onConfigToggle,
  onConfigChange,
}) => {
  const { t } = useTranslation();
  const activeRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeRowRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, rows]);

  const tabs = [
    { id: SCOPE_ALL, label: t('common.superSearch.scope.all'), alias: SCOPE_ALL },
    ...providers
      .filter(({ source }) => isSourceEnabled(source, config))
      .map(({ source }) => ({ id: source.id, label: source.label, alias: aliasMap[source.id] ?? source.defaultAlias })),
  ];
  const scopeLabel =
    providers.find(({ source }) => source.id === scope)?.source.label ?? t('common.superSearch.scope.all');
  let runningIndex = 0;
  const sections = activeProviders.map((provider) => {
    const sourceRows = rows.filter((row) => row.hit.sourceId === provider.source.id);
    const start = runningIndex;
    runningIndex += sourceRows.length;
    return { provider, sourceRows, start, state: states[provider.source.id] };
  });
  const hasText = text.length > 0;
  const anySettled = sections.some(({ state }) => state && state.status !== 'loading');
  const noneFound =
    hasText && anySettled && rows.length === 0 && sections.every(({ state }) => state?.status !== 'loading');

  const stateMessage = (state: SourceState | undefined): string | null => {
    if (!state || state.status === 'ok' || state.status === 'idle') return null;
    if (state.status === 'loading') return t('common.superSearch.state.loading');
    if (state.status === 'unavailable') {
      return state.message === 'no-bridge'
        ? t('common.superSearch.state.noBridge')
        : t('common.superSearch.state.unavailable');
    }
    return state.message === 'timeout' ? t('common.superSearch.state.timeout') : t('common.superSearch.state.error');
  };

  return createPortal(
    <div
      className='super-search-panel tomni-glass-panel'
      data-mode={mode}
      role='dialog'
      aria-label={t('common.superSearch.ariaLabel')}
      onMouseDown={(event) => {
        // Keep focus in the header input while the user clicks inside the panel.
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
      }}
    >
      <div className='super-search-tabs' role='tablist' aria-label={t('common.superSearch.scopeLabel')}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type='button'
            role='tab'
            tabIndex={-1}
            aria-selected={tab.id === scope}
            className='super-search-tab'
            onClick={() => onScopeChange(tab.id)}
          >
            {tab.label}
            {tab.id !== SCOPE_ALL && <span className='super-search-tab__alias'>{tab.alias}:</span>}
          </button>
        ))}
      </div>

      <div
        className='super-search-results'
        role='listbox'
        id={listboxId}
        aria-label={t('common.superSearch.ariaLabel')}
      >
        {!hasText && (
          <div className='super-search-state'>
            {scope === SCOPE_ALL
              ? t('common.superSearch.hint.empty')
              : t('common.superSearch.hint.scopeOnly', { source: scopeLabel })}
          </div>
        )}
        {hasText && disabledScope && <div className='super-search-state'>{t('common.superSearch.state.disabled')}</div>}
        {hasText &&
          sections.map(({ provider, sourceRows, start, state }) => {
            const message = stateMessage(state);
            return (
              <div
                key={provider.source.id}
                role='group'
                aria-label={provider.source.label}
                className='super-search-group'
              >
                <div className='super-search-group__head'>
                  <span>{provider.source.label}</span>
                  <span className='super-search-group__alias'>
                    {aliasMap[provider.source.id] ?? provider.source.defaultAlias}:
                  </span>
                </div>
                {message && (
                  <div
                    className={`super-search-state${state?.status === 'error' || state?.status === 'unavailable' ? ' super-search-state--warn' : ''}`}
                    role={state?.status === 'error' ? 'alert' : undefined}
                  >
                    {message}
                  </div>
                )}
                {sourceRows.map((row, offset) => {
                  const index = start + offset;
                  const selected = index === activeIndex;
                  return (
                    <div
                      key={row.hit.id}
                      id={optionId(index)}
                      ref={selected ? activeRowRef : undefined}
                      role='option'
                      aria-selected={selected}
                      className='super-search-row'
                      onMouseEnter={() => onHover(index)}
                      onClick={() => onPick(row)}
                    >
                      <span className='super-search-row__icon'>
                        {ICONS[row.hit.icon ?? 'page'] ?? <Click theme='outline' size={16} />}
                      </span>
                      <span className='super-search-row__body'>
                        <span className='super-search-row__title'>{row.hit.title}</span>
                        {row.hit.subtitle && <span className='super-search-row__subtitle'>{row.hit.subtitle}</span>}
                      </span>
                      <span
                        className='super-search-row__rank'
                        title={t('common.superSearch.rankTitle', {
                          rank: row.rank,
                          count: row.sourceHitCount,
                          source: provider.source.label,
                          percent: row.topPercent,
                        })}
                      >
                        {t('common.superSearch.rank', { rank: row.rank, percent: row.topPercent })}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        {noneFound && !disabledScope && <div className='super-search-state'>{t('common.superSearch.state.empty')}</div>}
      </div>

      <div className='super-search-sr-only' role='status' aria-live='polite'>
        {hasText ? t('common.superSearch.resultCount', { count: rows.length }) : ''}
      </div>

      {configOpen && (
        <SuperSearchConfigPanel providers={providers} config={config} aliasMap={aliasMap} onChange={onConfigChange} />
      )}

      <div className='super-search-footer'>
        <span>{t('common.superSearch.footer')}</span>
        <button type='button' className='super-search-footer__btn' aria-pressed={configOpen} onClick={onConfigToggle}>
          <SettingConfig theme='outline' size={13} fill='currentColor' />
          {t('common.superSearch.config.open')}
        </button>
      </div>
    </div>,
    document.body
  );
};

export default SuperSearchPanel;
