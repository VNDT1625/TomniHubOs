/** Store S1/S3: package filters and a human-initiated native GitHub/folder import. */
import { Alert, Button, Input, Progress } from '@arco-design/web-react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RepoStoreProgress, RepoStoreImportResult } from '@/common/types/platform/repoStore';
import { LocalKeyRevokeControl } from './LocalKeyRevokeControl';

export type StoreFilter = 'all' | 'installed' | 'updates';
export type StoreControlsProps = Readonly<{
  filter: StoreFilter;
  onFilter: (value: StoreFilter) => void;
  onImported: (packageId: string) => Promise<void> | void;
  /** Runs after this machine's local signing key was revoked, so the list reloads its trust state. */
  onKeyRevoked: () => Promise<void> | void;
  onOpenDetails: (packageId: string) => void;
}>;
const K = 'guid.hubHome.storeImport.';

export const StoreControls: React.FC<StoreControlsProps> = ({
  filter,
  onFilter,
  onImported,
  onKeyRevoked,
  onOpenDetails,
}) => {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [webStore, setWebStore] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<RepoStoreProgress>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<Extract<RepoStoreImportResult, { ok: true }>>();
  const activeId = useRef<string | undefined>(undefined);
  useEffect(() => {
    const off = window.electronAPI?.repoStore?.onProgress((event) => {
      if (event.requestId === activeId.current) setProgress(event);
    });
    return () => {
      off?.();
      activeId.current = undefined;
    };
  }, []);
  const invoke = async (kind: 'github' | 'folder' | 'extension-file' | 'chrome-web-store') => {
    const api = window.electronAPI?.repoStore;
    if (!api) {
      setError(t(K + 'unavailable'));
      return;
    }
    if (kind === 'github') {
      try {
        const parsed = new URL(url.trim());
        if (
          parsed.protocol !== 'https:' ||
          parsed.hostname !== 'github.com' ||
          parsed.username ||
          parsed.password ||
          parsed.pathname.split('/').filter(Boolean).length < 2 ||
          parsed.port !== ''
        )
          throw new Error('Invalid');
      } catch {
        setError(t(K + 'invalidUrl'));
        return;
      }
    }
    const requestId = crypto.randomUUID();
    activeId.current = requestId;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    setProgress(undefined);
    try {
      const typed = kind === 'github' ? url.trim() : kind === 'chrome-web-store' ? webStore.trim() : undefined;
      const response = await api.import({ requestId, kind, ...(typed === undefined ? {} : { url: typed }) });
      if (response.ok === true) {
        setResult(response);
        await onImported(response.packageId);
      } else if (response.ok === false && response.error === 'DISABLED') {
        setError(t(K + 'webStoreDisabled'));
      } else if (response.ok === false && response.error !== 'CANCELLED') {
        setError(t(K + 'failed', { code: response.error }));
        if (response.report) setProgress({ requestId, phase: 'finished', progress: 100, text: response.report });
      }
    } catch {
      setError(t(K + 'unavailable'));
    } finally {
      if (activeId.current === requestId) activeId.current = undefined;
      setBusy(false);
    }
  };
  return (
    <section className='hub-store-controls' data-testid='store-source-controls'>
      <nav className='hub-store-filters' aria-label={t(K + 'filters')}>
        {(['all', 'installed', 'updates'] as const).map((value) => (
          <Button
            key={value}
            type={filter === value ? 'primary' : 'secondary'}
            size='small'
            aria-pressed={filter === value}
            onClick={() => onFilter(value)}
            data-testid={`store-filter-${value}`}
          >
            {t(K + 'filter.' + value)}
          </Button>
        ))}
      </nav>
      <div className='hub-store-import'>
        <h3>{t(K + 'title')}</h3>
        <p>{t(K + 'hint')}</p>
        <div className='hub-store-import-entry'>
          <Input
            aria-label={t(K + 'githubUrl')}
            placeholder={t(K + 'githubUrl')}
            value={url}
            onChange={setUrl}
            disabled={busy}
            maxLength={2048}
            onPressEnter={() => {
              if (!busy) void invoke('github');
            }}
          />
          <Button type='primary' loading={busy} disabled={busy || !url.trim()} onClick={() => void invoke('github')}>
            {t(K + 'importGithub')}
          </Button>
          <Button type='secondary' disabled={busy} onClick={() => void invoke('folder')}>
            {t(K + 'chooseFolder')}
          </Button>
          <Button type='secondary' disabled={busy} onClick={() => void invoke('extension-file')}>
            {t(K + 'chooseExtensionFile')}
          </Button>
        </div>
        <div className='hub-store-import-entry' data-testid='store-webstore-entry'>
          <Input
            aria-label={t(K + 'webStoreInput')}
            placeholder={t(K + 'webStoreInput')}
            value={webStore}
            onChange={setWebStore}
            disabled={busy}
            maxLength={2048}
            onPressEnter={() => {
              if (!busy && webStore.trim()) void invoke('chrome-web-store');
            }}
          />
          <Button type='secondary' disabled={busy || !webStore.trim()} onClick={() => void invoke('chrome-web-store')}>
            {t(K + 'importWebStore')}
          </Button>
        </div>
        <LocalKeyRevokeControl onRevoked={onKeyRevoked} />
        {error && <Alert type='error' content={error} closable onClose={() => setError(undefined)} />}
        {progress && (
          <div className='hub-store-import-progress' role='status' data-testid='store-import-progress'>
            <Progress percent={progress.progress} size='small' />
            <span>{t(K + 'phase.' + progress.phase)}</span>
            <details>
              <summary>{t(K + 'report')}</summary>
              <pre>{progress.text}</pre>
            </details>
          </div>
        )}
        {result && (
          <Alert
            type='success'
            title={t(K + 'success', { name: result.packageId })}
            content={
              <div>
                <Button size='small' onClick={() => onOpenDetails(result.packageId)}>
                  {t(K + 'openDetails')}
                </Button>
                <details>
                  <summary>{t(K + 'report')}</summary>
                  <pre>{result.report}</pre>
                </details>
              </div>
            }
            data-testid='store-import-success'
          />
        )}
      </div>
    </section>
  );
};
