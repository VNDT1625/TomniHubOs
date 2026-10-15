/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  HubFileErrorCode,
  HubFileResult,
  LibraryEntrySummary,
} from '@/common/integrations/library/libraryContracts';
import { fileViewerPath } from '@/renderer/pages/integrations/fileViewer/fileViewerRoute';
import { Button, Input } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

type LoadState = 'loading' | 'ready' | 'error';

/** Library (S11): documents the person keeps by location. Files are never copied; a moved file offers "choose again". */
const LibraryPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<LibraryEntrySummary[]>([]);
  const [load, setLoad] = useState<LoadState>('loading');
  const [query, setQuery] = useState('');
  const [actionError, setActionError] = useState<HubFileErrorCode | null>(null);

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.library;
    if (!api) {
      setLoad('error');
      return;
    }
    try {
      const result = await api.list();
      if (result.ok) {
        setEntries(result.data);
        setLoad('ready');
      } else {
        setLoad('error');
      }
    } catch {
      setLoad('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Runs one mutation, then reloads so "missing" is re-evaluated by Main. A cancelled picker is not an error. */
  const run = useCallback(
    async (action: () => Promise<HubFileResult<unknown>> | undefined) => {
      setActionError(null);
      try {
        const result = await action();
        if (result && result.ok === false && result.code !== 'CANCELLED') setActionError(result.code);
      } catch {
        setActionError('IO_ERROR');
      }
      await refresh();
    },
    [refresh]
  );

  const visible = useMemo(() => {
    const words = query
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 0);
    return entries.filter((entry) => {
      const haystack = `${entry.name}\n${entry.path}`.toLocaleLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [entries, query]);

  return (
    <div className='hub-page hub-lib' data-testid='hub-library-page'>
      <header className='hub-page-heading'>
        <div>
          <h1>{t('guid.hubHome.library.title')}</h1>
          <p>{t('guid.hubHome.library.subtitle')}</p>
        </div>
        <Button type='primary' onClick={() => void run(() => window.electronAPI?.library?.add())}>
          {t('guid.hubHome.library.add')}
        </Button>
      </header>
      <Input
        allowClear
        className='hub-page-search'
        placeholder={t('guid.hubHome.library.searchPlaceholder')}
        value={query}
        onChange={setQuery}
      />
      {actionError && (
        <p className='hub-fv-notice hub-fv-notice--bad' role='alert'>
          {t(
            actionError === 'INVALID_REQUEST'
              ? 'guid.hubHome.library.errors.duplicate'
              : 'guid.hubHome.library.errors.generic'
          )}
        </p>
      )}
      {load === 'loading' && (
        <p className='hub-fv-notice' role='status'>
          {t('guid.hubHome.library.loading')}
        </p>
      )}
      {load === 'error' && (
        <p className='hub-fv-notice hub-fv-notice--bad' role='alert'>
          {t('guid.hubHome.library.errors.generic')}
        </p>
      )}
      {load === 'ready' && entries.length === 0 && (
        <div className='hub-lib-empty' data-testid='library-empty'>
          <strong>{t('guid.hubHome.library.empty')}</strong>
          <span>{t('guid.hubHome.library.emptyHint')}</span>
        </div>
      )}
      {load === 'ready' && entries.length > 0 && visible.length === 0 && (
        <p className='hub-fv-notice' role='status'>
          {t('guid.hubHome.library.noMatches')}
        </p>
      )}
      {visible.length > 0 && (
        <ul className='hub-lib-list' aria-label={t('guid.hubHome.library.listLabel')}>
          {visible.map((entry) => (
            <li key={entry.id} className={`hub-lib-row ${entry.missing ? 'hub-lib-row--missing' : ''}`}>
              <div className='hub-lib-info'>
                <strong>{entry.name}</strong>
                <span className='hub-lib-path'>{entry.path}</span>
                {entry.missing && (
                  <span className='hub-lib-missing' role='status'>
                    <strong>{t('guid.hubHome.library.missing')}</strong>
                    <span>{t('guid.hubHome.library.missingHint')}</span>
                  </span>
                )}
              </div>
              <div className='hub-lib-actions'>
                {entry.missing ? (
                  <Button
                    type='secondary'
                    size='small'
                    onClick={() => void run(() => window.electronAPI?.library?.repick({ entryId: entry.id }))}
                  >
                    {t('guid.hubHome.library.repick')}
                  </Button>
                ) : (
                  <Button
                    type='secondary'
                    size='small'
                    onClick={() => navigate(fileViewerPath({ kind: 'library', id: entry.id }))}
                  >
                    {t('guid.hubHome.library.open')}
                  </Button>
                )}
                <Button
                  type='secondary'
                  size='small'
                  onClick={() => void run(() => window.electronAPI?.library?.remove({ entryId: entry.id }))}
                >
                  {t('guid.hubHome.library.remove')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default LibraryPage;
