import tomniIcon from '@/renderer/assets/tomni-icon.svg';
import Sider from '@/renderer/components/layout/Sider';
import ConversationSearchPopover from '@/renderer/pages/conversation/GroupedHistory/ConversationSearchPopover';
import { HUB_APPS, parseRecentHubApps, type HubAppDefinition } from '@/renderer/pages/guid/HubHome/catalog';
import { useManagerStore } from '@/renderer/pages/manager/useManagerStore';
import {
  getRecentFiles,
  getStarredFiles,
  setLastStudioView,
  type StudioFileEntry,
} from '@/renderer/pages/studio/studioStorage';
import type {
  CatalogSourceState,
  FederatedCatalogItem,
  FederatedCatalogSearchResult,
  PackageListing,
} from '@/common/packages';
import {
  createStudioCompatibilityLegacyFallbackDestination,
  isStudioPackageGateNavigationState,
} from '@/common/packages/studioCompatibility';
import { Alert, Button, Card, Input, Message, Modal, Progress, Tag, Tooltip } from '@arco-design/web-react';
import {
  AllApplication,
  Calendar,
  DashboardOne,
  DocumentFolder,
  Left,
  Notes,
  Plus,
  Remind,
  Refresh,
  Right,
  Search,
  SettingTwo,
  Time,
} from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import styles from './HubWorkspacePage.module.css';
import { getFirstRunnablePackageModule, PackageAppHost } from './PackageAppHost';
import { packageClient } from './packageClient';
import StoreProductDetail from './StoreProductDetail';
import { requestPackagePermissionUpdateConsent } from './StoreProductDetail/permissionConsent';

import CompanyPage from '@/renderer/pages/company/CompanyPage';

export type HubWorkspaceKind = 'management' | 'store' | 'history' | 'company';

type HubWorkspacePageProps = {
  kind: HubWorkspaceKind;
  packageId?: string;
  moduleId?: string;
};

const RECENT_APPS_STORAGE_KEY = 'tomni.hub.recentApps';

const readRecentApps = (): HubAppDefinition[] => {
  if (typeof window === 'undefined') return [];
  const ids = parseRecentHubApps(window.localStorage.getItem(RECENT_APPS_STORAGE_KEY));
  return ids.map((id) => HUB_APPS.find((app) => app.id === id)).filter((app): app is HubAppDefinition => Boolean(app));
};

const HubWorkspacePage: React.FC<HubWorkspacePageProps> = ({ kind, packageId, moduleId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
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
  const openStorePackageModule = useCallback(
    (id: string, idModule: string): void => {
      const destination = `/store/app/${encodeURIComponent(id)}/${encodeURIComponent(idModule)}`;
      if (packageGateNavigationState) {
        navigate(destination, { state: packageGateNavigationState });
        return;
      }
      navigate(destination);
    },
    [navigate, packageGateNavigationState]
  );
  const manager = useManagerStore();
  const [collapsed, setCollapsed] = useState(() => window.matchMedia?.('(max-width: 839px)').matches ?? false);
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  const recentFiles = useMemo(() => getRecentFiles(), []);
  const starredFiles = useMemo(() => getStarredFiles(), []);
  const recentApps = useMemo(readRecentApps, []);
  const titleKey =
    kind === 'management'
      ? 'guid.hubHome.shell.nav.manage'
      : kind === 'store'
        ? 'guid.hubHome.shell.store'
        : kind === 'company'
          ? 'guid.hubHome.shell.nav.company'
          : 'guid.hubHome.shell.nav.history';
  const subtitleKey =
    kind === 'management'
      ? 'manager.workspace.overviewSubtitle'
      : kind === 'store'
        ? 'guid.hubHome.shell.storeHint'
        : kind === 'company'
          ? 'company.title'
          : 'guid.hubHome.recentSubtitle';
  const searchKey = kind === 'store' ? 'guid.hubHome.shell.searchPlaceholder' : 'studio.searchPlaceholder';

  const visibleFiles = useMemo(() => {
    const source = activeTab === 'starred' ? starredFiles : recentFiles;
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return source;
    return source.filter((file) => `${file.name} ${file.path}`.toLocaleLowerCase().includes(normalizedQuery));
  }, [activeTab, query, recentFiles, starredFiles]);

  const visibleApps = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const source = recentApps.length > 0 ? recentApps : HUB_APPS.slice(0, 4);
    if (!normalizedQuery) return source;
    return source.filter((app) => t(app.labelKey).toLocaleLowerCase().includes(normalizedQuery));
  }, [query, recentApps, t]);

  const openFile = (file: StudioFileEntry): void => {
    setLastStudioView({ mode: 'editor', filePath: file.path });
    navigate('/studio');
  };

  return (
    <div className={`${styles.shell} ${collapsed ? styles.shellCollapsed : ''}`} data-testid={`hub-${kind}-page`}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <img src={tomniIcon} alt='' />
          <strong className={styles.sidebarCopy}>Tomny</strong>
          <Tooltip content={t(collapsed ? 'common.expand' : 'common.collapse')} position='right'>
            <Button
              type='text'
              shape='circle'
              className={styles.collapseButton}
              icon={
                collapsed ? (
                  <Right theme='outline' size={14} fill='currentColor' />
                ) : (
                  <Left theme='outline' size={14} fill='currentColor' />
                )
              }
              aria-label={t(collapsed ? 'common.expand' : 'common.collapse')}
              onClick={() => setCollapsed((current) => !current)}
            />
          </Tooltip>
        </div>
        <Sider collapsed={collapsed} />
      </aside>

      <header className={styles.topbar}>
        <ConversationSearchPopover
          onConversationSelect={() => undefined}
          renderTrigger={({ onClick, isActive }) => (
            <Button
              type='secondary'
              className={`${styles.globalSearch} ${isActive ? styles.globalSearchActive : ''}`}
              icon={<Search theme='outline' size={15} fill='currentColor' />}
              onClick={onClick}
            >
              <span>{t('guid.hubHome.shell.searchPlaceholder')}</span>
              <kbd>Ctrl + K</kbd>
            </Button>
          )}
        />
        <div className={styles.topbarActions}>
          <Button
            type='text'
            shape='circle'
            icon={<Remind theme='outline' size={17} fill='currentColor' />}
            aria-label={t('guid.hubHome.status.notificationsTitle')}
            onClick={() => navigate('/settings/realtime')}
          />
          <Button
            type='text'
            shape='circle'
            icon={<SettingTwo theme='outline' size={17} fill='currentColor' />}
            aria-label={t('guid.hubHome.shell.nav.settings')}
            onClick={() => navigate('/settings/model')}
          />
        </div>
      </header>

      <div className={styles.body}>
        <main className={styles.main}>
          <header className={styles.pageHeading}>
            <div>
              <h1>{t(titleKey)}</h1>
              <p>{t(subtitleKey)}</p>
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

          {!packageId && (
            <Input
              allowClear
              className={styles.pageSearch}
              prefix={<Search theme='outline' size={15} fill='currentColor' />}
              placeholder={t(searchKey)}
              value={query}
              onChange={setQuery}
            />
          )}

          {kind === 'store' && packageId && moduleId ? (
            <PackageAppHost packageId={packageId} moduleId={moduleId} onBack={returnFromStorePackage} />
          ) : kind === 'store' && packageId ? (
            <StoreProductDetail packageId={packageId} onBack={returnFromStorePackage} onOpen={openStorePackageModule} />
          ) : kind === 'store' ? (
            <StoreContent query={query} />
          ) : kind === 'management' ? (
            <ManagementContent
              query={query}
              taskCount={manager.data.tasks.length}
              noteCount={manager.data.notes.length}
              eventCount={manager.data.events.length}
              onOpen={() => navigate('/manager/workspace')}
            />
          ) : kind === 'company' ? (
            <CompanyPage />
          ) : (
            <>
              <div className={styles.tabs} role='tablist'>
                {[
                  { id: 'all', key: 'common.all' },
                  { id: 'recent', key: 'studio.section.recent' },
                  { id: 'starred', key: 'studio.section.starred' },
                ].map((tab) => (
                  <Button
                    key={tab.id}
                    type='text'
                    className={activeTab === tab.id ? styles.tabActive : ''}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {t(tab.key)}
                  </Button>
                ))}
              </div>
              <HistoryContent files={visibleFiles} apps={visibleApps} onOpenFile={openFile} onNavigate={navigate} />
            </>
          )}
        </main>

        <aside className={styles.statusRail}>
          <Card className={styles.statusCard} bordered>
            <div className={styles.statusHeading}>
              <strong>{t('guid.hubHome.status.workTitle')}</strong>
              <Button type='text' size='mini' onClick={() => navigate('/manager/workspace')}>
                {t('guid.hubHome.viewAll')}
              </Button>
            </div>
            <div className={styles.statusMetric}>
              <span>{t('guid.hubHome.status.workInProgress', { count: manager.data.tasks.length })}</span>
              <Progress percent={manager.data.tasks.length > 0 ? 68 : 0} showText={false} size='small' />
            </div>
          </Card>
          <Card className={styles.statusCard} bordered>
            <div className={styles.statusHeading}>
              <strong>{t('guid.hubHome.status.notificationsTitle')}</strong>
              <Remind theme='outline' size={15} fill='currentColor' />
            </div>
            <p>{t('guid.hubHome.status.notificationWorkspaceActivity')}</p>
            <p>{t('guid.hubHome.status.notificationApprovalRequested')}</p>
          </Card>
          <Card className={styles.statusCard} bordered>
            <div className={styles.statusHeading}>
              <strong>{t('guid.hubHome.status.systemTitle')}</strong>
              <Time theme='outline' size={15} fill='currentColor' />
            </div>
            <div className={styles.systemReady}>
              <span className={styles.readyDot} />
              <span>{t('guid.hubHome.status.coreReady')}</span>
            </div>
            <small>{t('guid.hubHome.status.coreReadyHint')}</small>
          </Card>
        </aside>
      </div>

      <footer className={styles.footer}>
        <span>{t('guid.hubHome.shell.version')}</span>
        <span className={styles.footerStatus}>
          <span className={styles.readyDot} />
          {t('guid.hubHome.shell.coreHealthy')}
        </span>
      </footer>
    </div>
  );
};

const StoreContent: React.FC<{ query: string }> = ({ query }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [packages, setPackages] = useState<PackageListing[]>([]);
  const [microsoftItems, setMicrosoftItems] = useState<FederatedCatalogItem[]>([]);
  const [microsoftStatus, setMicrosoftStatus] = useState<CatalogSourceState['status']>();
  const [busyId, setBusyId] = useState<string>();

  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const loadEpoch = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const epoch = ++loadEpoch.current;
    try {
      setError(undefined);
      const normalizedQuery = query.trim();
      const regionPart = navigator.language.split('-')[1]?.toUpperCase();
      const region = regionPart && /^[A-Z]{2}$/.test(regionPart) ? regionPart : 'ZZ';
      const [listings, federated]: [PackageListing[], FederatedCatalogSearchResult | undefined] = await Promise.all([
        normalizedQuery ? packageClient.search({ query: normalizedQuery }) : packageClient.list(),
        normalizedQuery
          ? packageClient
              .federatedSearch({ query: normalizedQuery, region, limit: 24 })
              .catch((): undefined => undefined)
          : Promise.resolve(undefined),
      ]);
      if (epoch !== loadEpoch.current) return;
      setPackages(listings.filter((item) => item.delivery === 'downloaded-package'));
      const microsoftSource = federated?.sources.find((source) => source.source === 'microsoft-store');
      setMicrosoftStatus(normalizedQuery ? (microsoftSource?.status ?? 'failed') : undefined);
      setMicrosoftItems(
        federated?.items.filter(
          (item) =>
            item.offers.some((offer) => offer.source === 'microsoft-store') &&
            !item.offers.some((offer) => offer.source === 'tomni-store')
        ) ?? []
      );
    } catch (loadError) {
      if (epoch !== loadEpoch.current) return;
      setMicrosoftItems([]);
      setMicrosoftStatus(query.trim() ? 'failed' : undefined);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [query]);

  useEffect(() => {
    const timeout = window.setTimeout((): void => {
      void load();
    }, 180);
    const reloadWhenVisible = (): void => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', reloadWhenVisible);
    document.addEventListener('visibilitychange', reloadWhenVisible);
    return () => {
      loadEpoch.current += 1;
      window.clearTimeout(timeout);
      window.removeEventListener('focus', reloadWhenVisible);
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
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setError(message);
      Message.error(message);
    } finally {
      setBusyId(undefined);
    }
  };

  const openMicrosoftProduct = async (productId: string): Promise<void> => {
    const operationId = `microsoft:${productId}`;
    setBusyId(operationId);
    setError(undefined);
    try {
      await packageClient.openMicrosoftStorePage(productId);
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setError(message);
      Message.error(message);
    } finally {
      setBusyId(undefined);
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
      <div className='mb-12px flex justify-end'>
        <Button
          type='secondary'
          icon={<Refresh theme='outline' size='14' />}
          loading={refreshing}
          onClick={() => void refreshCatalog()}
        >
          {t('common.refresh')}
        </Button>
      </div>
      {error && <Alert type='error' content={error} closable onClose={() => setError(undefined)} />}
      {query.trim() && microsoftStatus && microsoftStatus !== 'ready' && (
        <Alert
          type='warning'
          content={t(
            microsoftStatus === 'stale'
              ? 'guid.hubHome.storeDetail.microsoftSourceStale'
              : 'guid.hubHome.storeDetail.microsoftSourceFailed'
          )}
        />
      )}
      {packages.length === 0 && microsoftItems.length === 0 ? (
        <div className={styles.emptyState}>
          <span>{t('guid.hubHome.storeDetail.empty')}</span>
          {error && (
            <Button type='secondary' onClick={() => void load()}>
              {t('common.retry')}
            </Button>
          )}
        </div>
      ) : (
        <div className={styles.packageGrid}>
          {packages.map((item) => {
            const installed = item.state === 'installed';
            const runnableModule = getFirstRunnablePackageModule(item);
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
                </div>
                <strong className={styles.packageName}>{item.manifest.name}</strong>
                <p className={styles.packageDescription}>{item.manifest.description}</p>
                <div className={styles.packageMeta}>
                  <span>{item.manifest.type}</span>
                  <span>v{item.manifest.version}</span>
                  <span>{t('guid.hubHome.storeDetail.moduleCount', { count: item.manifest.modules.length })}</span>
                </div>
                <div className={styles.packageActions}>
                  {installed && runnableModule && (
                    <Button
                      type={item.updateAvailable ? 'secondary' : 'primary'}
                      long
                      className='capitalize'
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(
                          `/store/app/${encodeURIComponent(item.manifest.id)}/${encodeURIComponent(runnableModule.id)}`
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
                    disabled={(busyId !== undefined && busyId !== item.manifest.id) || (!installed && !item.compatible)}
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
          {microsoftItems.map((item) => {
            const offer = item.offers.find((candidate) => candidate.source === 'microsoft-store');
            if (!offer) return null;
            const operationId = `microsoft:${offer.sourceItemId}`;
            const certified = offer.trustSignal?.kind === 'microsoft-certification';
            return (
              <Card
                key={item.canonicalKey}
                className={`${styles.packageCard} ${styles.externalPackageCard}`}
                bordered
                hoverable
              >
                <div className={styles.packageHeader}>
                  <span className={styles.packageGlyph}>
                    <AllApplication theme='outline' size={20} fill='currentColor' />
                  </span>
                  <Tag color='arcoblue'>
                    {t(
                      certified
                        ? 'guid.hubHome.storeDetail.microsoftCertified'
                        : 'guid.hubHome.storeDetail.microsoftStore'
                    )}
                  </Tag>
                </div>
                <strong className={styles.packageName}>{item.display.name}</strong>
                <p className={styles.packageDescription}>
                  {item.display.summary ?? t('guid.hubHome.storeDetail.microsoftSummaryFallback')}
                </p>
                <div className={styles.packageMeta}>
                  <span>{t('guid.hubHome.storeDetail.microsoftStore')}</span>
                  {offer.version && <span>v{offer.version}</span>}
                  <span>{t(`guid.hubHome.storeDetail.availability.${offer.availability}`)}</span>
                </div>
                <Button
                  type='primary'
                  long
                  loading={busyId === operationId}
                  disabled={busyId !== undefined && busyId !== operationId}
                  onClick={() => void openMicrosoftProduct(offer.sourceItemId)}
                >
                  {t('guid.hubHome.storeDetail.openMicrosoftStore')}
                </Button>
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
  onOpen: () => void;
};

const ManagementContent: React.FC<ManagementContentProps> = ({ query, taskCount, noteCount, eventCount, onOpen }) => {
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
      value: 0,
      Icon: Time,
    },
  ].filter((item) => `${item.title} ${item.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  return (
    <div className={styles.managementGrid}>
      {cards.map((item) => (
        <Card key={item.id} className={styles.featureCard} bordered hoverable onClick={onOpen}>
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
  files: StudioFileEntry[];
  apps: HubAppDefinition[];
  onOpenFile: (file: StudioFileEntry) => void;
  onNavigate: ReturnType<typeof useNavigate>;
};

const HistoryContent: React.FC<HistoryContentProps> = ({ files, apps, onOpenFile, onNavigate }) => {
  const { t } = useTranslation();
  return (
    <div className={styles.activityList}>
      {files.map((file) => (
        <Card key={file.path} className={styles.activityCard} bordered hoverable>
          <span className={styles.activityIcon}>
            <DocumentFolder theme='outline' size={17} fill='currentColor' />
          </span>
          <span className={styles.activityCopy}>
            <strong>{file.name}</strong>
            <small>{file.path}</small>
          </span>
          <Button type='secondary' onClick={() => onOpenFile(file)}>
            {t('studio.open')}
          </Button>
        </Card>
      ))}
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
