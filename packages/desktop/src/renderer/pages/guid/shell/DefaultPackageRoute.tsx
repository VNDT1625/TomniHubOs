/** The Browser/IDE routes are package gates, not bundled application implementations. */
import type { PackageListing } from '@/common/packages';
import { Alert, Button } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getFirstRunnablePackageModule } from '@/renderer/pages/hub/PackageAppHost';
import { isAvailableSignedAppPackage, isPackageListingInstalled } from '@/renderer/pages/hub/installedPackageApps';
import { packageClient } from '@/renderer/pages/hub/packageClient';
import { requestPackagePermissionUpdateConsent } from '@/renderer/pages/hub/StoreProductDetail/permissionConsent';

type DefaultPackageName = 'browser' | 'ide';
const DEFAULT_PACKAGES: Readonly<Record<DefaultPackageName, { id: string; title: string }>> = {
  browser: { id: 'com.tomni.browser', title: 'Browser' },
  ide: { id: 'com.tomni.ide', title: 'IDE' },
};

const DefaultPackageRoute: React.FC<{ app: DefaultPackageName }> = ({ app }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const definition = DEFAULT_PACKAGES[app];
  const [listing, setListing] = useState<PackageListing>();
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const items = await packageClient.list();
      setListing(items.find((item) => item.manifest.id === definition.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [definition.id]);

  useEffect(() => {
    void refresh();
    const onMutation = (): void => { void refresh(); };
    window.addEventListener('tomni-packages-changed', onMutation);
    return () => window.removeEventListener('tomni-packages-changed', onMutation);
  }, [refresh]);

  useEffect(() => {
        if (!listing || !isPackageListingInstalled(listing) || !listing.enabled || !listing.compatible || listing.revoked) return;
    const module = getFirstRunnablePackageModule(listing);
    if (module) {
      void navigate(`/apps/${encodeURIComponent(definition.id)}/${encodeURIComponent(module.id)}`, { replace: true });
    }
  }, [definition.id, listing, navigate]);

    const refreshCatalog = async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      // Explicit Refresh fetches remote Store releases, not only the cached inventory.
      const latest = await packageClient.refresh();
      setListing(latest.find((item) => item.manifest.id === definition.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  const install = async (): Promise<void> => {
    if (installing || !isAvailableSignedAppPackage(listing)) return;
    setInstalling(true);
    setError(undefined);
    try {
      const consentId = await requestPackagePermissionUpdateConsent(definition.id, t);
      if (consentId === null) return;
      const installed = await packageClient.install(definition.id, consentId ?? undefined);
      const module = getFirstRunnablePackageModule(installed);
      if (!module) throw new Error('PACKAGE_NO_RUNNABLE_SURFACE');
      void navigate(`/apps/${encodeURIComponent(definition.id)}/${encodeURIComponent(module.id)}`, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInstalling(false);
    }
  };

  const installed = listing && isPackageListingInstalled(listing);
  const available = isAvailableSignedAppPackage(listing);
  return (
    <div className='hub-page-content' data-testid={`default-package-gate-${app}`}>
      <header className='hub-page-heading'><h1>{definition.title}</h1></header>
      {loading ? <p role='status'>{t('common.loading')}</p> : (
        <div className='hub-onboarding-description'>
          {error && <Alert type='error' content={error} />}
          {!installed && !available && <Alert type='warning'
            content={t('guid.hubHome.layout.noCompatibleRelease', { name: definition.title })} />}
          {installed && (!listing?.enabled || !listing?.compatible || listing?.revoked) && <Alert type='warning'
            content={t('guid.hubHome.layout.packageNotEnabled', { name: definition.title })} />}
          <div className='flex gap-8px mt-16px'>
            {!installed && available && <Button type='primary' loading={installing} disabled={installing}
              onClick={() => void install()}>{t('guid.hubHome.layout.installAndOpen')}</Button>}
            <Button type='secondary' onClick={() => void navigate(`/store/package/${encodeURIComponent(definition.id)}`)}>
              {t('guid.hubHome.layout.managePackage')}
            </Button>
            <Button type='secondary' onClick={() => void refreshCatalog()}>{t('common.refresh')}</Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DefaultPackageRoute;
