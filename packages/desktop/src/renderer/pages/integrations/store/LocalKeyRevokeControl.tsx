/** Store: revokes this machine's local signing key. Main asks for the confirmation; this control only starts the request. */
import { Alert, Button } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalKeyRevokeResult } from '@/common/types/platform/packageConnections';

const K = 'guid.hubHome.localKey.';

export type LocalKeyRevokeControlProps = Readonly<{
  /** Called after a successful revocation so the Store list shows the new trust state. */
  onRevoked: () => Promise<void> | void;
}>;

export const LocalKeyRevokeControl: React.FC<LocalKeyRevokeControlProps> = ({ onRevoked }) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LocalKeyRevokeResult>();

  const revoke = async (): Promise<void> => {
    const api = window.electronAPI?.localKeys;
    if (!api) {
      setResult({ ok: false, error: 'FAILED' });
      return;
    }
    setBusy(true);
    try {
      const response = await api.revoke();
      setResult(response);
      if (response.ok) await onRevoked();
    } catch {
      setResult({ ok: false, error: 'FAILED' });
    } finally {
      setBusy(false);
    }
  };

  const message = (value: LocalKeyRevokeResult): string | undefined => {
    if (value.ok === true) {
      return value.unsignedPackages > 0 ? t(K + 'done', { packages: value.unsignedPackages }) : t(K + 'doneNone');
    }
    // The person cancelled the native confirmation: nothing changed, nothing to report.
    return value.error === 'CANCELLED' ? undefined : t(K + 'failed');
  };

  const text = result === undefined ? undefined : message(result);

  return (
    <div className='hub-store-local-key' data-testid='store-local-key-revoke'>
      <Button size='small' type='secondary' loading={busy} disabled={busy} onClick={() => void revoke()}>
        {t(K + 'revokeButton')}
      </Button>
      {text && (
        <Alert type={result?.ok ? 'success' : 'error'} content={text} closable onClose={() => setResult(undefined)} />
      )}
    </div>
  );
};
