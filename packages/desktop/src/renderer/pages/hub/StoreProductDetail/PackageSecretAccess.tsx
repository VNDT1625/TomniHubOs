import { Button, Message } from '@arco-design/web-react';
import { KeyRound } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PackageAccessOverviewView, SecretsResult } from '@/common/types/platform/sessionSecrets';
import type { PackageAccessApi } from '@/renderer/services/secretSetsClient';

type PackageSecretAccessProps = {
  /** Must stay the same object while the package is the same. */
  api: PackageAccessApi;
  active: boolean;
};

/**
 * Which of the person's general keys this package may use. By default none: the package can ask, and only an approval
 * here (behind a native dialog) lets it use that one set. No value is ever shown.
 */
export const PackageSecretAccess: React.FC<PackageSecretAccessProps> = ({ api, active }) => {
  const { t } = useTranslation();
  const key = (name: string, options?: Record<string, unknown>) => t(`guid.hubHome.secrets.${name}`, options);
  const [overview, setOverview] = useState<PackageAccessOverviewView | null>(null);
  const [busy, setBusy] = useState(false);
  // Answers that arrive after the package changed belong to the old package and are dropped.
  const latest = useRef(api);
  latest.current = api;

  const refresh = useCallback(async () => {
    const result = await api.overview();
    if (latest.current === api) setOverview(result.ok ? result.data : null);
  }, [api]);

  useEffect(() => {
    setOverview(null);
    if (!active) return;
    let live = true;
    void api.overview().then((result) => {
      if (live) setOverview(result.ok ? result.data : null);
    });
    return () => {
      live = false;
    };
  }, [api, active]);

  const act = async (run: () => Promise<SecretsResult<boolean>>): Promise<void> => {
    setBusy(true);
    try {
      const result = await run();
      if (result.ok === true && result.data) Message.success(key('accessSaved'));
      else if (result.ok === true || result.error !== 'CANCELLED') Message.error(key('error'));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!overview) return null;
  const { granted, pending, available } = overview;

  return (
    <section className='hub-secret-section' aria-label={key('accessTitle')} data-testid='package-secret-access'>
      <h4>{key('accessTitle')}</h4>
      <p className='hub-secret-boundary'>{key('accessHint')}</p>

      {pending.length > 0 && (
        <>
          <h4>{key('accessPending')}</h4>
          {pending.map((request) => (
            <article className='hub-secret-combo' key={request.id} data-testid={`package-access-request-${request.id}`}>
              <div className='hub-secret-combo-head'>
                <KeyRound size={14} aria-hidden='true' />
                <div>
                  <strong>{request.label}</strong>
                  <span>{key('accessReason', { reason: request.reason })}</span>
                </div>
              </div>
              <div className='hub-secret-key-row'>
                {request.fields.map((field) => (
                  <code key={field}>{field}</code>
                ))}
              </div>
              <div className='hub-secret-actions'>
                <Button
                  size='small'
                  type='primary'
                  disabled={busy}
                  aria-label={`${key('accessApprove')}: ${request.label}`}
                  onClick={() => void act(() => api.approve(request.id))}
                >
                  {key('accessApprove')}
                </Button>
                <Button
                  size='small'
                  disabled={busy}
                  aria-label={`${key('accessDeny')}: ${request.label}`}
                  onClick={() => void act(() => api.deny(request.id))}
                >
                  {key('accessDeny')}
                </Button>
              </div>
            </article>
          ))}
        </>
      )}

      <h4>{key('accessGranted')}</h4>
      {granted.length === 0 && <p className='hub-secret-empty'>{key('accessEmpty')}</p>}
      {granted.map((set) => (
        <article className='hub-secret-combo' key={set.handle} data-testid={`package-access-granted-${set.label}`}>
          <div className='hub-secret-combo-head'>
            <KeyRound size={14} aria-hidden='true' />
            <div>
              <strong>{set.label}</strong>
              {set.note && <span>{set.note}</span>}
            </div>
            <Button
              size='mini'
              status='danger'
              disabled={busy}
              aria-label={`${key('accessRevoke')}: ${set.label}`}
              onClick={() => void act(() => api.revoke(set.handle))}
            >
              {key('accessRevoke')}
            </Button>
          </div>
          <div className='hub-secret-key-row'>
            {set.fields.map((field) => (
              <code key={field}>{field}</code>
            ))}
          </div>
        </article>
      ))}

      <h4>{key('accessAvailable')}</h4>
      {available.length === 0 && <p className='hub-secret-empty'>{key('accessNone')}</p>}
      {available.map((set) => (
        <article className='hub-secret-combo' key={set.handle} data-testid={`package-access-available-${set.label}`}>
          <div className='hub-secret-combo-head'>
            <KeyRound size={14} aria-hidden='true' />
            <div>
              <strong>{set.label}</strong>
              {set.note && <span>{set.note}</span>}
            </div>
            <Button
              size='mini'
              disabled={busy}
              aria-label={`${key('accessGrant')}: ${set.label}`}
              onClick={() => void act(() => api.grant(set.handle))}
            >
              {key('accessGrant')}
            </Button>
          </div>
        </article>
      ))}
    </section>
  );
};
