import { Button, Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SecretSetsApi } from '@/renderer/services/secretSetsClient';

type LegacyImportNoticeProps = {
  /** Must stay the same object while the package is the same. */
  legacy: NonNullable<SecretSetsApi['legacy']>;
  active: boolean;
  onImported: () => void;
};

/**
 * Offers to copy the keys a package kept before the app vault existed. Nothing is copied until the person clicks and
 * then approves a native dialog; the older keys are left in place.
 */
export const LegacyImportNotice: React.FC<LegacyImportNoticeProps> = ({ legacy, active, onImported }) => {
  const { t } = useTranslation();
  const key = (name: string, options?: Record<string, unknown>) => t(`guid.hubHome.secrets.${name}`, options);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const latest = useRef(legacy);
  latest.current = legacy;

  const refresh = useCallback(async () => {
    const result = await legacy.status();
    if (latest.current === legacy) setPending(result.ok ? result.data.pending : 0);
  }, [legacy]);

  useEffect(() => {
    setPending(0);
    if (!active) return;
    let live = true;
    void legacy.status().then((result) => {
      if (live) setPending(result.ok ? result.data.pending : 0);
    });
    return () => {
      live = false;
    };
  }, [legacy, active]);

  if (pending === 0) return null;

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await legacy.import();
      if (result.ok === true) {
        Message.success(key('legacyDone', result.data));
        onImported();
      } else if (result.error === 'KEYCHAIN_UNAVAILABLE') {
        Message.error(key('keychainUnavailable'));
      } else if (result.error !== 'CANCELLED') {
        Message.error(key('error'));
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className='hub-secret-section' aria-label={key('legacyTitle', { count: pending })}>
      <h4>{key('legacyTitle', { count: pending })}</h4>
      <p className='hub-secret-boundary'>{key('legacyHint')}</p>
      <div className='hub-secret-actions'>
        <Button size='small' type='primary' loading={busy} onClick={() => void run()}>
          {key('legacyImport')}
        </Button>
      </div>
    </section>
  );
};
