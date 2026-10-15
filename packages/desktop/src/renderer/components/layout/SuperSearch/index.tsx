/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { addEventListener, emitter } from '@/renderer/utils/emitter';
import { executeAction, type ActionDeps } from './engine/actions';
import { SCOPE_ALL } from './engine/aliases';
import { isSourceEnabled, loadConfig, saveConfig, type SuperSearchConfig } from './engine/config';
import type { AggregatedRow } from './engine/types';
import { recordRecentPage } from './providers/recentPages';
import { WEB_ENGINES } from './providers/webSources';
import SuperSearchBar from './SuperSearchBar';
import SuperSearchPanel from './SuperSearchPanel';
import { useSuperSearch, type SuperSearchMode } from './useSuperSearch';
import { useSuperSearchSources } from './useSuperSearchSources';

const BROWSER_PATH = /^\/browser(\/|$)/;

const SuperSearchInner: React.FC<{ mode: SuperSearchMode }> = ({ mode }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [config, setConfigState] = useState<SuperSearchConfig>(loadConfig);
  const [open, setOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [pageUrl, setPageUrl] = useState('');

  // The Browser page reports its active tab URL so the header can show it like an address bar.
  useEffect(() => (mode === 'browser' ? addEventListener('browser.url', setPageUrl) : undefined), [mode]);

  const providers = useSuperSearchSources({ mode, config, active: open });
  const search = useSuperSearch({ mode, providers, config });
  const { reset, scope } = search;

  const setConfig = useCallback((next: SuperSearchConfig) => {
    setConfigState(next);
    saveConfig(next);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setConfigOpen(false);
    reset();
    inputRef.current?.blur();
  }, [reset]);

  // Ctrl/Cmd+K focuses the header field from anywhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Pointer-down outside the header field and the centre panel dismisses it.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || (target instanceof Element && target.closest('.super-search-panel'))) {
        return;
      }
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  // Navigating anywhere closes the panel.
  useEffect(() => {
    setOpen(false);
    setConfigOpen(false);
  }, [pathname]);

  // The Browser app paints a native view above the DOM; ask it to step aside while the panel is open.
  useEffect(() => {
    if (mode !== 'browser') return undefined;
    emitter.emit('browser.overlay', open);
    return () => {
      emitter.emit('browser.overlay', false);
    };
  }, [mode, open]);

  const actionDeps = useCallback(
    (): Omit<ActionDeps, 'onBrowserRoute'> => ({
      navigate: (path: string) => void navigate(path),
      restart: () => void ipcBridge.windowControls.restart.invoke(),
    }),
    [navigate]
  );

  const run = useCallback(
    (row: AggregatedRow) => {
      if (mode === 'browser' && WEB_ENGINES.some((engine) => engine.id === row.hit.sourceId)) {
        setConfig({ ...config, browserEngine: row.hit.sourceId });
      }
      // Opened pages (not search-result rows) become named suggestions next time.
      if (row.hit.action.kind === 'url' && row.hit.icon === 'site') {
        recordRecentPage({ title: row.hit.title, url: row.hit.action.url });
      }
      executeAction(row.hit.action, { ...actionDeps(), onBrowserRoute: BROWSER_PATH.test(pathname) });
      close();
    },
    [mode, config, setConfig, actionDeps, pathname, close]
  );

  // Enter before the debounced results arrive still searches with the chosen engine.
  const searchNow = () => {
    const text = search.text.trim();
    const engine = WEB_ENGINES.find(
      (candidate) => candidate.id === (scope === SCOPE_ALL ? config.browserEngine : scope)
    );
    if (!text || !engine) return;
    executeAction({ kind: 'url', url: engine.searchUrl(text) }, { ...actionDeps(), onBrowserRoute: true });
    setConfig({ ...config, browserEngine: engine.id });
    close();
  };

  const changeEngine = (id: string) => {
    search.setScope(id);
    if (id !== SCOPE_ALL) setConfig({ ...config, browserEngine: id });
  };

  const cycleScope = (direction: 1 | -1) => {
    const ids = [
      SCOPE_ALL,
      ...providers.filter(({ source }) => isSourceEnabled(source, config)).map(({ source }) => source.id),
    ];
    const next = ids[(ids.indexOf(scope) + direction + ids.length) % ids.length];
    search.setScope(next);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      search.moveActive(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = search.rows[search.activeIndex];
      if (row) run(row);
      else if (mode === 'browser') searchNow();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (configOpen) setConfigOpen(false);
      else close();
    } else if (event.key === 'Tab' && open && providers.length > 0) {
      event.preventDefault();
      cycleScope(event.shiftKey ? -1 : 1);
    }
  };

  const optionId = (index: number) => `${listboxId}-opt-${index}`;
  const engines = providers.map(({ source }) => ({ id: source.id, label: source.label }));
  const hasRows = search.rows.length > 0;

  return (
    <div ref={rootRef} className='super-search-root'>
      <SuperSearchBar
        mode={mode}
        query={search.query}
        expanded={open}
        listboxId={listboxId}
        activeOptionId={open && hasRows ? optionId(search.activeIndex) : undefined}
        inputRef={inputRef}
        engines={engines}
        engineId={scope}
        pageUrl={pageUrl}
        onEngineChange={changeEngine}
        onCommand={(command) => emitter.emit('browser.command', command)}
        onQueryChange={(value) => {
          setOpen(true);
          search.setQuery(value);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <SuperSearchPanel
          mode={mode}
          listboxId={listboxId}
          optionId={optionId}
          providers={providers}
          activeProviders={search.activeProviders}
          config={config}
          aliasMap={search.aliasMap}
          scope={scope}
          text={search.text}
          disabledScope={search.disabledScope}
          states={search.states}
          rows={search.rows}
          activeIndex={search.activeIndex}
          configOpen={configOpen}
          onScopeChange={search.setScope}
          onHover={search.setActiveIndex}
          onPick={run}
          onConfigToggle={() => setConfigOpen((value) => !value)}
          onConfigChange={setConfig}
        />
      )}
    </div>
  );
};

/**
 * Header Super Search. On the Browser app route it becomes engine-specific (`google : query`);
 * everywhere else it searches in-app content, the web and connected sources. Remounts on mode
 * change so each mode starts from its own default scope.
 */
const SuperSearch: React.FC = () => {
  const { pathname } = useLocation();
  const mode: SuperSearchMode = BROWSER_PATH.test(pathname) ? 'browser' : 'hub';
  return <SuperSearchInner key={mode} mode={mode} />;
};

export default SuperSearch;
