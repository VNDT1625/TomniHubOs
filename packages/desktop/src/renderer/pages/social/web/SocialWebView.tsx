import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SocialAccount } from '@/common/types/social';
import { social as socialApi } from '@/common/adapter/ipcBridge';
type SocialWebSection = 'feed' | 'reels' | 'messages';
import styles from './SocialWebView.module.css';

type Props = {
  accounts: SocialAccount[];
  selectedAccountId: string | null;
  refreshKey?: number;
  onOpenSettings: () => void;
};

/** The website is painted by Electron Main, not embedded in an HTML iframe. */
export const SocialWebView: React.FC<Props> = ({ accounts, selectedAccountId, refreshKey, onOpenSettings }) => {
  const { t } = useTranslation();
  const facebookAccounts = accounts.filter((account) => account.platform === 'facebook');
  const account = selectedAccountId
    ? facebookAccounts.find((item) => item.id === selectedAccountId)
    : facebookAccounts[0];
  const viewport = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<SocialWebSection>('feed');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const accountId = account?.id;

  const positionView = useCallback(async (): Promise<boolean> => {
    const node = viewport.current;
    if (!accountId || !node || !node.isConnected) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    await socialApi.showWeb.invoke({
      accountId,
      section,
      bounds: { x: Math.max(0, rect.left), y: Math.max(0, rect.top), width: rect.width, height: rect.height },
    });
    return true;
  }, [accountId, section]);

  useEffect(() => {
    if (!accountId) return;
    return () => {
      // Leave no remote page painted over another Social tab or shell route.
      void socialApi.hideWeb.invoke({ accountId }).catch(() => {});
    };
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    let live = true;
    let raf = 0;
    setReady(false);
    setError(null);

    const update = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        void positionView()
          .then((shown) => {
            if (live && shown) setReady(true);
          })
          .catch(() => {
            if (live) {
              setReady(false);
              setError(t('guid.hubHome.socialWeb.browserError'));
            }
          });
      });
    };
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (viewport.current) observer?.observe(viewport.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      live = false;
      if (raf) cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [accountId, section, positionView, t]);

  useEffect(() => {
    if (refreshKey && accountId) {
      void socialApi.reloadWeb.invoke({ accountId }).catch(() => {
        setError(t('guid.hubHome.socialWeb.browserError'));
      });
    }
  }, [accountId, refreshKey, t]);

  const reload = async () => {
    if (!accountId) return;
    try {
      setError(null);
      await socialApi.reloadWeb.invoke({ accountId });
    } catch {
      setError(t('guid.hubHome.socialWeb.browserError'));
    }
  };

  if (!account) {
    return (
      <div className={styles.empty} role='status'>
        <p>{t('guid.hubHome.socialWeb.browserNoAccount')}</p>
        <button type='button' onClick={onOpenSettings}>
          {t('guid.hubHome.shell.nav.settings')}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <strong>{account.displayName}</strong>
        <span className={styles.hint}>{t('guid.hubHome.socialWeb.browserHint')}</span>
        <div className={styles.actions}>
          {(['feed', 'reels', 'messages'] as const).map((item) => (
            <button
              key={item}
              type='button'
              aria-pressed={section === item}
              onClick={() => setSection(item)}
              className={section === item ? styles.selected : ''}
            >
              {item === 'feed'
                ? t('guid.hubHome.socialWeb.browserFeed')
                : item === 'reels'
                  ? 'Reels'
                  : t('guid.hubHome.socialWeb.browserMessages')}
            </button>
          ))}
          <button type='button' onClick={() => void reload()}>
            {t('guid.hubHome.socialWeb.browserReload')}
          </button>
        </div>
      </div>
      {error && (
        <div role='alert' className={styles.error}>
          {error}
        </div>
      )}
      {!ready && !error && (
        <div role='status' className={styles.loading}>
          {t('guid.hubHome.socialWeb.browserLoading')}
        </div>
      )}
      <div ref={viewport} className={styles.viewport} aria-label={t('guid.hubHome.socialWeb.browserTitle')} />
    </div>
  );
};

export default SocialWebView;
