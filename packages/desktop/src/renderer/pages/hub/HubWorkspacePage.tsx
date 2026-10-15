import { HUB_APPS, parseRecentHubApps, type HubAppDefinition } from '@/renderer/pages/guid/HubHome/catalog';
import { DEFAULT_ONBOARDING_APPS } from '@/renderer/pages/guid/HubHome/sidebarPins';
import { useManagerStore } from '@/renderer/pages/manager/useManagerStore';
import type { PackageListing } from '@/common/packages';
import type { PublisherSubmissionNativeReceipt } from '@/common/types/platform/electron';
import {
  createStudioCompatibilityLegacyFallbackDestination,
  isStudioPackageGateNavigationState,
} from '@/common/packages/studioCompatibility';
import { Alert, Button, Card, Input, Message, Modal, Tag } from '@arco-design/web-react';
import { AllApplication, Calendar, DashboardOne, Notes, Plus, Refresh, Right, Search, Time } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { isElectronDesktop } from '@/renderer/utils/platform';
import styles from './HubWorkspacePage.module.css';
import { getFirstRunnablePackageModule, PackageAppHost } from './PackageAppHost';
import { isPackageListingInstalled } from './installedPackageApps';
import { packageClient } from './packageClient';
import StoreProductDetail from './StoreProductDetail';
import { requestPackagePermissionUpdateConsent } from './StoreProductDetail/permissionConsent';
import { useAllCronJobs } from '@/renderer/pages/cron/useCronJobs';
import { StoreControls, type StoreFilter } from '@/renderer/pages/integrations/store/StoreControls';
import { LocalBuiltUpdateCheck } from '@/renderer/pages/integrations/store/LocalBuiltUpdateCheck';
import { ExtensionsTab, storeViewForPath } from '@/renderer/pages/integrations/extensions/ExtensionsTab';

export type HubWorkspaceKind = 'management' | 'store' | 'history' | 'package-app';

type HubWorkspacePageProps = {
  kind: HubWorkspaceKind;
  packageId?: string;
  moduleId?: string;
};

const RECENT_APPS_STORAGE_KEY = 'tomni.hub.recentApps';
/**
 * Search eligibility remains authoritative in the package service. This is a
 * display-only defensive order that puts already installed matches first.
 */
export const orderStorePackageListings = (listings: PackageListing[]): PackageListing[] =>
  listings.toSorted((left, right) => {
    const installationOrder = Number(right.state === 'installed') - Number(left.state === 'installed');
    if (installationOrder !== 0) return installationOrder;
    return left.manifest.id < right.manifest.id ? -1 : left.manifest.id > right.manifest.id ? 1 : 0;
  });

/** Store cards use the signed offer only to prevent a misleading pre-checkout install action. */
/** Keep downloaded Store apps visible, but remove obsolete never-installed Tomny demo surfaces.
 * Installed older apps and local Repo-to-Package imports remain manageable and uninstallable. */
export const isVisibleStorePackage = (listing: PackageListing): boolean => {
  if (listing.trust === 'local-built' || listing.installedTrust === 'local-built') return isPackageListingInstalled(listing);
  if (listing.manifest.publisherId !== 'com.tomni' || listing.manifest.type !== 'app') return true;
  const defaults = new Set<string>(DEFAULT_ONBOARDING_APPS.map((item) => item.id));
  return defaults.has(listing.manifest.id) || isPackageListingInstalled(listing);
};

export const requiresPaidStoreActivation = (listing: PackageListing): boolean =>
  listing.offer?.active === true && listing.offer.price.amountMinor > 0;

const readRecentApps = (): HubAppDefinition[] => {
  if (typeof window === 'undefined') return [];
  const ids = parseRecentHubApps(window.localStorage.getItem(RECENT_APPS_STORAGE_KEY));
  return ids.map((id) => HUB_APPS.find((app) => app.id === id)).filter((app): app is HubAppDefinition => Boolean(app));
};

const HubWorkspacePage: React.FC<HubWorkspacePageProps> = ({ kind, packageId, moduleId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isPackageApp = kind === 'package-app' && Boolean(packageId) && Boolean(moduleId);
  const packageGateNavigationState = isStudioPackageGateNavigationState(location.state) ? location.state : undefined;
  const returnFromStorePackage = useCallback((): void => {
    if (!packageGateNavigationState) {
      navigate('/store');
      return;
    }
    navigate(createStudioCompatibilityLegacyFallbackDestination(packageGateNavigationState.navigationSearch), {
      state: packageGateNavigationState.navigationState,
    });
  }, [navigate, packageGateNavigationState]);
  const returnFromPackageApp = useCallback((): void => {
    if (!packageId) {
      navigate('/store');
      return;
    }
    navigate(`/store/package/${encodeURIComponent(packageId)}`);
  }, [navigate, packageId]);
  const openStorePackageModule = useCallback(
    (id: string, idModule: string): void => {
      const destination = `/apps/${encodeURIComponent(id)}/${encodeURIComponent(idModule)}`;
      if (packageGateNavigationState) {
        navigate(destination, { state: packageGateNavigationState });
        return;
      }
      navigate(destination);
    },
    [navigate, packageGateNavigationState]
  );
  const manager = useManagerStore();
  const { jobs: cronJobs } = useAllCronJobs();
  const [query, setQuery] = useState('');

  const recentApps = useMemo(readRecentApps, []);
  const titleKey =
    kind === 'management'
      ? 'guid.hubHome.shell.nav.manage'
      : kind === 'store'
        ? 'guid.hubHome.shell.store'
        : 'guid.hubHome.shell.nav.history';

  const subtitleKey = kind === 'management' ? 'manager.workspace.overviewSubtitle' : 'guid.hubHome.recentSubtitle';

  const isStoreList = kind === 'store' && !packageId;
  const searchKey = 'guid.hubHome.shell.searchPlaceholder';

  const visibleApps = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const source = recentApps.length > 0 ? recentApps : HUB_APPS.slice(0, 4);
    if (!normalizedQuery) return source;
    return source.filter((app) => t(app.labelKey).toLocaleLowerCase().includes(normalizedQuery));
  }, [query, recentApps, t]);

  return (
    <div className={`hub-page ${isPackageApp ? 'hub-page--package' : ''}`} data-testid={`hub-${kind}-page`}>
      {!isPackageApp && !isStoreList && (
        <header className='hub-page-heading'>
          <div>
            <h1>{t(titleKey)}</h1>
            {kind !== 'store' && <p>{t(subtitleKey)}</p>}
          </div>
          {kind !== 'store' && (
            <Button
              type='primary'
              icon={<Plus theme='outline' size={15} fill='currentColor' />}
              onClick={() => navigate(kind === 'management' ? '/manager/workspace' : '/studio')}
            >
              {t(kind === 'management' ? 'manager.tasks.create' : 'studio.create.action')}
            </Button>
          )}
        </header>
      )}

      {!packageId && !isPackageApp && kind !== 'store' && (
        <Input
          allowClear
          className='hub-page-search'
          prefix={<Search theme='outline' size={15} fill='currentColor' />}
          placeholder={t(searchKey)}
          value={query}
          onChange={setQuery}
        />
      )}

      {isPackageApp && packageId && moduleId ? (
        <PackageAppHost packageId={packageId} moduleId={moduleId} onBack={returnFromPackageApp} allowSandboxedWeb />
      ) : kind === 'store' && packageId ? (
        <StoreProductDetail packageId={packageId} onBack={returnFromStorePackage} onOpen={openStorePackageModule} />
      ) : kind === 'store' ? (
        <StoreContent />
      ) : kind === 'management' ? (
        <ManagementContent
          query={query}
          taskCount={manager.data.tasks.length}
          noteCount={manager.data.notes.length}
          eventCount={manager.data.events.length}
          coreCount={cronJobs.length || (isElectronDesktop() ? 1 : 0)}
          onOpenScheduled={() => navigate('/scheduled')}
          onOpen={() => navigate('/manager/workspace')}
        />
      ) : (
        <HistoryContent apps={visibleApps} onNavigate={navigate} />
      )}
    </div>
  );
};

const StoreContent: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [packages, setPackages] = useState<PackageListing[]>([]);
  const [storeFilter, setStoreFilter] = useState<StoreFilter>('all');
  // `/store/extensions` (the header's Manage extensions) opens the Extensions tab; the tab buttons keep working.
  const location = useLocation();
  const [storeView, setStoreView] = useState<'packages' | 'extensions'>(() => storeViewForPath(location.pathname));
  useEffect(() => {
    setStoreView(storeViewForPath(location.pathname));
  }, [location.pathname]);
  const installedPackageIds = useMemo(
    () => packages.filter(isPackageListingInstalled).map((item) => item.manifest.id),
    [packages]
  );
  const visiblePackages = useMemo(
    () =>
            packages.filter(
        (item) =>
          isVisibleStorePackage(item) && (storeFilter === 'all' ||
          (storeFilter === 'installed' && isPackageListingInstalled(item)) ||
                    (storeFilter === 'updates' && item.updateAvailable))
      ),
    [packages, storeFilter]
  );
  const [busyId, setBusyId] = useState<string>();

  const [refreshing, setRefreshing] = useState(false);
  const [submittingPublisherPackage, setSubmittingPublisherPackage] = useState(false);
  const [publisherSubmissionReceipt, setPublisherSubmissionReceipt] = useState<PublisherSubmissionNativeReceipt>();
  const [error, setError] = useState<string>();
  const loadEpoch = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const epoch = ++loadEpoch.current;
    try {
      setError(undefined);
            const listings = await packageClient.list();
      if (epoch !== loadEpoch.current) return;
      setPackages(orderStorePackageListings(listings.filter((item) => item.delivery === 'downloaded-package')));
    } catch (loadError) {
      if (epoch !== loadEpoch.current) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout((): void => {
      void load();
    }, 180);
    const reloadWhenVisible = (): void => {
      if (document.visibilityState === 'visible') void load();
    };
        window.addEventListener('focus', reloadWhenVisible);
    window.addEventListener('tomni-packages-changed', reloadWhenVisible);
        const off = packageClient.onContributionsChanged?.(() => void load()) ?? (() => undefined);
    document.addEventListener('visibilitychange', reloadWhenVisible);
    return () => {
      loadEpoch.current += 1;
      window.clearTimeout(timeout);
            window.removeEventListener('focus', reloadWhenVisible);
      window.removeEventListener('tomni-packages-changed', reloadWhenVisible);
      off();
      document.removeEventListener('visibilitychange', reloadWhenVisible);
    };
  }, [load]);

  const refreshCatalog = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await packageClient.refresh();
      await load();
      Message.success(t('common.refreshSuccess'));
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
      setError(message);
      Message.error(message);
    } finally {
      setRefreshing(false);
    }
  };

  const installOrUpdate = async (item: PackageListing): Promise<void> => {
    setBusyId(item.manifest.id);
    setError(undefined);
    try {
      const id = item.manifest.id;
      const permissionConsentId = await requestPackagePermissionUpdateConsent(id, t);
      if (permissionConsentId === null) return;
      if (permissionConsentId) await packageClient.install(id, permissionConsentId);
      else await packageClient.install(id);
      await load();
      window.dispatchEvent(new CustomEvent('tomni-packages-changed'));
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setError(message);
      Message.error(message);
    } finally {
      setBusyId(undefined);
    }
  };

  const removePackage = async (item: PackageListing): Promise<void> => {
    setBusyId(item.manifest.id);
    setError(undefined);
    try {
      await packageClient.uninstall(item.manifest.id);
      await load();
      window.dispatchEvent(new CustomEvent('tomni-packages-changed'));
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      // The removal may have partly or fully applied before the error: resync both views from the service.
      await load();
      window.dispatchEvent(new CustomEvent('tomni-packages-changed'));
      setError(message);
      Message.error(message);
    } finally {
      setBusyId(undefined);
    }
  };

  const submitPublisherPackage = async (): Promise<void> => {
    const publisherSubmission = window.electronAPI?.publisherSubmission;
    if (!publisherSubmission) {
      Message.error(t('guid.hubHome.storeDetail.publisherSubmissionUnavailable'));
      return;
    }

    setSubmittingPublisherPackage(true);
    try {
      const result = await publisherSubmission.pickAndSubmit({ idempotencyKey: globalThis.crypto.randomUUID() });
      if (result.ok) {
        setPublisherSubmissionReceipt(result.receipt);
        Message.success(t('guid.hubHome.storeDetail.publisherSubmissionSuccess'));
        return;
      }
      const failureCode = 'code' in result ? result.code : undefined;
      if (failureCode === 'PUBLISHER_SUBMISSION_CANCELLED') {
        Message.info(t('guid.hubHome.storeDetail.publisherSubmissionCancelled'));
        return;
      }
      Message.error(
        t(
          failureCode === 'PUBLISHER_SUBMISSION_ACCOUNT_REQUIRED' || failureCode === 'PUBLISHER_SUBMISSION_UNAVAILABLE'
            ? 'guid.hubHome.storeDetail.publisherSubmissionUnavailable'
            : 'guid.hubHome.storeDetail.publisherSubmissionFailed'
        )
      );
    } catch {
      Message.error(t('guid.hubHome.storeDetail.publisherSubmissionFailed'));
    } finally {
      setSubmittingPublisherPackage(false);
    }
  };

  const confirmRemoval = (item: PackageListing): void => {
    Modal.confirm({
      title: t('guid.hubHome.storeDetail.removeTitle', { name: item.manifest.name }),
      content: t('guid.hubHome.storeDetail.removeDescription'),
      okText: t('common.remove'),
      cancelText: t('common.cancel'),
      okButtonProps: { status: 'danger' },
      onOk: () => removePackage(item),
    });
  };

  return (
    <>
      <header className='hub-page-heading'>
        <div>
          <h1>{t('guid.hubHome.shell.store')}</h1>
        </div>
        <div className='flex items-center gap-8px'>
          <Button
            type='secondary'
            icon={<Refresh theme='outline' size='14' />}
            loading={refreshing}
            onClick={() => void refreshCatalog()}
          >
            {t('common.refresh')}
          </Button>
          <Button
            type='primary'
            shape='circle'
            icon={<Plus theme='outline' size={16} fill='currentColor' />}
            loading={submittingPublisherPackage}
            disabled={submittingPublisherPackage}
            aria-label={t('guid.hubHome.storeDetail.publisherSubmission')}
            title={t('guid.hubHome.storeDetail.publisherSubmission')}
            data-testid='store-publisher-submit'
            onClick={() => void submitPublisherPackage()}
          />
        </div>
      </header>
      {publisherSubmissionReceipt ? (
        <Alert
          data-testid='store-publisher-submission-result'
          type={publisherSubmissionReceipt.status === 'auto-approved' ? 'success' : 'warning'}
          title={
            publisherSubmissionReceipt.status === 'auto-approved'
              ? t('guid.hubHome.storeDetail.publisherSubmissionTechnicalPass')
              : t('guid.hubHome.storeDetail.publisherSubmissionHumanReview')
          }
          content={
            publisherSubmissionReceipt.review.findings.length === 0 ? undefined : (
              <ul>
                {publisherSubmissionReceipt.review.findings.map((finding) => (
                  <li key={finding.code} data-testid={`store-publisher-review-finding-${finding.code}`}>
                    <strong>{finding.code}</strong>: {finding.evidence} {finding.remediation}
                  </li>
                ))}
              </ul>
            )
          }
          className='mb-12px'
        />
      ) : null}
      <nav className='hub-store-views' data-testid='store-views'>
        {(['packages', 'extensions'] as const).map((view) => (
          <Button
            key={view}
            type={storeView === view ? 'primary' : 'secondary'}
            size='small'
            aria-pressed={storeView === view}
            onClick={() => setStoreView(view)}
            data-testid={`store-view-${view}`}
          >
            {t(
              view === 'packages'
                ? 'guid.hubHome.storeImport.ext.tabPackages'
                : 'guid.hubHome.storeImport.ext.tabExtensions'
            )}
          </Button>
        ))}
      </nav>
      {storeView === 'extensions' && <ExtensionsTab packageIds={installedPackageIds} />}
      {storeView === 'packages' && (
        <StoreControls
          filter={storeFilter}
          onFilter={setStoreFilter}
          onImported={async () => {
            await load();
            window.dispatchEvent(new CustomEvent('tomni-packages-changed'));
          }}
          onKeyRevoked={async () => {
            await load();
            window.dispatchEvent(new CustomEvent('tomni-packages-changed'));
          }}
          onOpenDetails={(id) => navigate(`/store/package/${encodeURIComponent(id)}`)}
        />
      )}
      {error && <Alert type='error' content={error} closable onClose={() => setError(undefined)} />}
      {storeView === 'extensions' ? null : visiblePackages.length === 0 ? (
        <div className={styles.emptyState}>
          <span>{t(packages.length ? 'guid.hubHome.storeImport.noMatches' : 'guid.hubHome.storeDetail.empty')}</span>
          {error && (
            <Button type='secondary' onClick={() => void load()}>
              {t('common.retry')}
            </Button>
          )}
        </div>
      ) : (
        <div className={styles.packageGrid}>
          {visiblePackages.map((item) => {
            const installed = isPackageListingInstalled(item);
            const runnableModule = getFirstRunnablePackageModule(item);
            const requiresPayment = requiresPaidStoreActivation(item);
            const stateKey = item.updateAvailable
              ? 'guid.hubHome.storeDetail.updateAvailable'
              : !item.compatible
                ? 'guid.hubHome.storeDetail.incompatible'
                : item.state === 'quarantined'
                  ? 'guid.hubHome.storeDetail.quarantined'
                  : item.state === 'failed'
                    ? 'common.failed'
                    : installed
                      ? 'guid.hubHome.storeDetail.installed'
                      : 'guid.hubHome.storeDetail.available';
            return (
              <Card
                key={item.manifest.id}
                className={styles.packageCard}
                bordered
                hoverable
                role='link'
                tabIndex={0}
                aria-label={t('guid.hubHome.storeDetail.viewDetails', { name: item.manifest.name })}
                onClick={() => navigate(`/store/package/${encodeURIComponent(item.manifest.id)}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(`/store/package/${encodeURIComponent(item.manifest.id)}`);
                  }
                }}
              >
                <div className={styles.packageHeader}>
                  <span className={styles.packageGlyph}>
                    <AllApplication theme='outline' size={20} fill='currentColor' />
                  </span>
                  <Tag
                    color={item.updateAvailable ? 'orange' : installed ? 'green' : item.compatible ? 'arcoblue' : 'red'}
                  >
                    {t(stateKey)}
                  </Tag>
                  {item.installedTrust === 'local-built' && (
                    <Tag color='purple' data-testid={`store-local-built-${item.manifest.id}`}>
                      {t('guid.hubHome.storeImport.localBuilt')}
                    </Tag>
                  )}
                  {item.installedTrust === 'unsigned-revoked' && (
                    <Tag color='red' data-testid={`store-unsigned-revoked-${item.manifest.id}`}>
                      {t('guid.hubHome.localKey.revoked')}
                    </Tag>
                  )}
                </div>
                <strong className={styles.packageName}>{item.manifest.name}</strong>
                <p className={styles.packageDescription}>{item.manifest.description}</p>
                {item.installedTrust === 'unsigned-revoked' && (
                  <p className={styles.packageDescription} role='status'>
                    {t('guid.hubHome.localKey.revokedNotice')}
                  </p>
                )}
                {item.installedTrust === 'local-built' && installed && (
                  <LocalBuiltUpdateCheck packageId={item.manifest.id} />
                )}
                <div className={styles.packageMeta}>
                  <span>{item.manifest.type}</span>
                  <span>v{item.manifest.version}</span>
                  <span>{t('guid.hubHome.storeDetail.moduleCount', { count: item.manifest.modules.length })}</span>
                </div>
                <div className={styles.packageActions}>
                  {installed && item.enabled && runnableModule && (
                    <Button
                      type={item.updateAvailable ? 'secondary' : 'primary'}
                      long
                      className='capitalize'
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(
                          `/apps/${encodeURIComponent(item.manifest.id)}/${encodeURIComponent(runnableModule.id)}`
                        );
                      }}
                    >
                      {t('manager.palette.open')}
                    </Button>
                  )}
                  <Button
                    type={installed && !item.updateAvailable ? 'secondary' : 'primary'}
                    status={installed && !item.updateAvailable ? 'danger' : undefined}
                    long
                    loading={busyId === item.manifest.id}
                    disabled={
                      (busyId !== undefined && busyId !== item.manifest.id) ||
                      (!installed && (!item.compatible || requiresPayment))
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      if (installed && !item.updateAvailable) confirmRemoval(item);
                      else void installOrUpdate(item);
                    }}
                  >
                    {t(
                      installed && !item.updateAvailable
                        ? 'common.remove'
                        : item.updateAvailable
                          ? 'guid.hubHome.storeDetail.update'
                          : item.installedVersion
                            ? 'guid.hubHome.storeDetail.reinstall'
                            : 'common.download'
                    )}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
};

type ManagementContentProps = {
  query: string;
  taskCount: number;
  noteCount: number;
  eventCount: number;
  coreCount?: number;
  onOpenScheduled?: () => void;
  onOpen: () => void;
};

const ManagementContent: React.FC<ManagementContentProps> = ({
  query,
  taskCount,
  noteCount,
  eventCount,
  coreCount,
  onOpen,
  onOpenScheduled,
}) => {
  const { t } = useTranslation();
  const cards = [
    {
      id: 'tasks',
      title: t('manager.tabs.tasks'),
      description: t('manager.workspace.descriptions.tasks'),
      value: taskCount,
      Icon: DashboardOne,
    },
    {
      id: 'schedule',
      title: t('manager.tabs.schedule'),
      description: t('manager.workspace.descriptions.schedule'),
      value: eventCount,
      Icon: Calendar,
    },
    {
      id: 'notes',
      title: t('manager.tabs.notes'),
      description: t('manager.workspace.descriptions.daily'),
      value: noteCount,
      Icon: Notes,
    },
    {
      id: 'core',
      title: t('manager.workspace.nav.core'),
      description: t('manager.workspace.descriptions.core'),
      value: coreCount ?? 0,
      Icon: Time,
    },
  ].filter((item) => `${item.title} ${item.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  return (
    <div className={styles.managementGrid}>
      {cards.map((item) => (
        <Card
          key={item.id}
          className={styles.featureCard}
          bordered
          hoverable
          onClick={() => (item.id === 'core' && onOpenScheduled ? onOpenScheduled() : onOpen())}
        >
          <div className={styles.featureIcon}>
            <item.Icon theme='outline' size={18} fill='currentColor' />
          </div>
          <div className={styles.featureCopy}>
            <strong>{item.title}</strong>
            <p>{item.description}</p>
          </div>
          <span className={styles.featureValue}>{item.value}</span>
          <Right theme='outline' size={14} fill='currentColor' />
        </Card>
      ))}
    </div>
  );
};

type HistoryContentProps = {
  apps: HubAppDefinition[];
  onNavigate: ReturnType<typeof useNavigate>;
};

const HistoryContent: React.FC<HistoryContentProps> = ({ apps, onNavigate }) => {
  const { t } = useTranslation();
  return (
    <div className={styles.activityList}>
      {apps.map((app) => (
        <Card key={app.id} className={styles.activityCard} bordered hoverable>
          <span className={styles.activityIcon}>
            <app.Icon theme='outline' size={17} fill='currentColor' />
          </span>
          <span className={styles.activityCopy}>
            <strong>{t(app.labelKey)}</strong>
            <small>{t(app.descriptionKey)}</small>
          </span>
          <Button type='secondary' onClick={() => onNavigate(app.path)}>
            {t('manager.palette.open')}
          </Button>
        </Card>
      ))}
    </div>
  );
};

export default HubWorkspacePage;
