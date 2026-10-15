/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { CloseSmall, Down, Left, Refresh, Right, Search, Translate } from '@icon-park/react';
import type { SuperSearchMode } from './useSuperSearch';

export type EngineOption = { id: string; label: string };

type SuperSearchBarProps = {
  mode: SuperSearchMode;
  query: string;
  expanded: boolean;
  listboxId: string;
  activeOptionId?: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Browser mode only: engines offered by the selector, and the one in effect. */
  engines: readonly EngineOption[];
  engineId: string;
  /** Browser mode: URL of the open page, shown while the field is not being edited. */
  pageUrl?: string;
  onEngineChange: (id: string) => void;
  /** Browser mode: nav controls that used to live in the page's own address row. */
  onCommand: (command: 'back' | 'forward' | 'reload' | 'controls' | 'subtitles') => void;
  onQueryChange: (value: string) => void;
  onFocus: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
};

/**
 * Header search field. Same footprint as the old button: in the Browser app it swaps the generic
 * placeholder for an engine selector (`google : query`) without growing the header.
 */
const SuperSearchBar: React.FC<SuperSearchBarProps> = ({
  mode,
  query,
  expanded,
  listboxId,
  activeOptionId,
  inputRef,
  engines,
  engineId,
  pageUrl,
  onEngineChange,
  onCommand,
  onQueryChange,
  onFocus,
  onKeyDown,
}) => {
  const { t } = useTranslation();
  const isBrowser = mode === 'browser';
  const engineLabel = engines.find((engine) => engine.id === engineId)?.label ?? engineId;
  const placeholder = isBrowser
    ? t('common.superSearch.placeholder.browser', { engine: engineLabel })
    : t('common.superSearch.placeholder.hub');

  return (
    <div
      className='app-titlebar__omni-search-btn super-search-bar'
      data-mode={mode}
      data-spotlight-id='search'
      onMouseDown={(event) => {
        if (event.target !== inputRef.current && !(event.target instanceof HTMLSelectElement)) {
          event.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      {isBrowser && (
        <span className='super-search-bar__nav'>
          {(
            [
              ['back', 'browser.address.back', <Left key='b' theme='outline' size={14} fill='currentColor' />],
              ['forward', 'browser.address.forward', <Right key='f' theme='outline' size={14} fill='currentColor' />],
              ['reload', 'browser.address.reload', <Refresh key='r' theme='outline' size={14} fill='currentColor' />],
            ] as const
          ).map(([command, label, icon]) => (
            <button
              key={command}
              type='button'
              className='super-search-bar__icon-btn'
              aria-label={t(label)}
              title={t(label)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onCommand(command)}
            >
              {icon}
            </button>
          ))}
        </span>
      )}
      <Search theme='outline' size={14} fill='currentColor' />
      {isBrowser && (
        <>
          <select
            className='super-search-bar__engine'
            aria-label={t('common.superSearch.engineLabel')}
            value={engineId}
            onChange={(event) => onEngineChange(event.target.value)}
          >
            <option value='all'>{t('common.superSearch.scope.all')}</option>
            {engines.map((engine) => (
              <option key={engine.id} value={engine.id}>
                {engine.label}
              </option>
            ))}
          </select>
          <span className='super-search-bar__colon' aria-hidden='true'>
            :
          </span>
        </>
      )}
      <input
        ref={inputRef}
        className='super-search-bar__input'
        type='text'
        role='combobox'
        aria-label={t('common.superSearch.ariaLabel')}
        aria-expanded={expanded}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        aria-autocomplete='list'
        autoComplete='off'
        spellCheck={false}
        value={query || (isBrowser && !expanded ? (pageUrl ?? '') : '')}
        placeholder={placeholder}
        onChange={(event) => onQueryChange(event.target.value)}
        onFocus={(event) => {
          event.currentTarget.select();
          onFocus();
        }}
        onKeyDown={onKeyDown}
      />
      {isBrowser && (
        <span className='super-search-bar__nav'>
          <button
            type='button'
            className='super-search-bar__icon-btn'
            aria-label={t('browser.subtitle_overlay.enable')}
            title={t('browser.subtitle_overlay.enable')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onCommand('subtitles')}
          >
            <Translate theme='outline' size={14} fill='currentColor' />
          </button>
          <button
            type='button'
            className='super-search-bar__icon-btn'
            aria-label={t('browser.toolbar.expandControls')}
            title={t('browser.toolbar.expandControls')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onCommand('controls')}
          >
            <Down theme='outline' size={14} fill='currentColor' />
          </button>
        </span>
      )}
      {query.length > 0 && (
        <button
          type='button'
          className='super-search-bar__clear'
          aria-label={t('common.superSearch.clear')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onQueryChange('');
            inputRef.current?.focus();
          }}
        >
          <CloseSmall theme='outline' size={14} fill='currentColor' />
        </button>
      )}
    </div>
  );
};

export default SuperSearchBar;
