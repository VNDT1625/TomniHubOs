/** Store S1: a read-only "check new version from GitHub" for a package made on this machine. Never installs. */
import { Button } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RepoStoreCheckResult } from '@/common/types/platform/repoStore';

const K = 'guid.hubHome.storeImport.';

export type LocalBuiltUpdateCheckProps = Readonly<{ packageId: string }>;

export const LocalBuiltUpdateCheck: React.FC<LocalBuiltUpdateCheckProps> = ({ packageId }) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RepoStoreCheckResult>();

  const check = async (): Promise<void> => {
    const api = window.electronAPI?.repoStore;
    if (!api) {
      setResult({ ok: false, error: 'FAILED' });
      return;
    }
    setBusy(true);
    try {
      setResult(await api.checkUpdate({ packageId }));
    } catch {
      setResult({ ok: false, error: 'FAILED' });
    } finally {
      setBusy(false);
    }
  };

  const message = (value: RepoStoreCheckResult): string => {
    if (value.ok === false) return t(K + 'checkUpdateFailed', { code: value.error });
    if (value.status === 'update-available') return t(K + 'checkUpdateAvailable');
    if (value.status === 'up-to-date') return t(K + 'checkUpdateCurrent');
    return t(K + 'checkUpdateUnknown');
  };

  return (
    <div className='hub-store-check' data-testid={`store-check-update-${packageId}`}>
      <Button
        size='small'
        loading={busy}
        onClick={(event) => {
          event.stopPropagation();
          void check();
        }}
      >
        {t(K + 'checkUpdate')}
      </Button>
      {result && (
        <span className='hub-store-check-result' role='status'>
          {message(result)}
        </span>
      )}
    </div>
  );
};
