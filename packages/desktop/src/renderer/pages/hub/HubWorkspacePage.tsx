import tomniIcon from '@/renderer/assets/tomni-icon.svg';
import Sider from '@/renderer/components/layout/Sider';
import ConversationSearchPopover from '@/renderer/pages/conversation/GroupedHistory/ConversationSearchPopover';
import { HUB_APPS, parseRecentHubApps, type HubAppDefinition } from '@/renderer/pages/guid/HubHome/catalog';
import { useManagerStore } from '@/renderer/pages/manager/useManagerStore';
import type {
  CatalogSourceState,
  FederatedCatalogItem,
  FederatedCatalogSearchResult,
  GoalSurfacePlan,
  PackageListing,
} from '@/common/packages';
import type { PublisherSubmissionNativeReceipt } from '@/common/types/platform/electron';
import {
  createStudioCompatibilityLegacyFallbackDestination,
  isStudioPackageGateNavigationState,
} from '@/common/packages/studioCompatibility';
import { Alert, Button, Card, Input, Message, Modal, Progress, Select, Tag, Tooltip } from '@arco-design/web-react';
import {
  AllApplication,
  Cpu,
  Calendar,
  DashboardOne,
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
import { isElectronDesktop } from '@/renderer/utils/platform';
import styles from './HubWorkspacePage.module.css';
import { getFirstRunnablePackageModule, PackageAppHost } from './PackageAppHost';
import { packageClient } from './packageClient';
import StoreProductDetail from './StoreProductDetail';
import { useSystemMetrics } from '@/renderer/pages/settings/ResourceSettings/system/useSystemMetrics';
import { requestPackagePermissionUpdateConsent } from './StoreProductDetail/permissionConsent';
import { useAllCronJobs } from '@/renderer/pages/cron/useCronJobs';
import { useNotifications } from '@/renderer/services/notificationService';

export type HubWorkspaceKind = 'management' | 'store' | 'history' | 'package-app';

type HubWorkspacePageProps = {
  kind: HubWorkspaceKind;
  packageId?: string;
  moduleId?: string;
};

const RECENT_APPS_STORAGE_KEY = 'tomni.hub.recentApps';
/** Electron Vite serves development renderer pages over HTTP; packaged pages use `file:`. */
const LOCAL_SURFACE_AI_PILOT_VISIBLE =
  typeof window !== 'undefined' && (window.location.protocol === 'http:' || window.location.protocol === 'https:');

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
export const requiresPaidStoreActivation = (listing: PackageListing): boolean =>
  listing.offer?.active === true && listing.offer.price.amountMinor > 0;

const readRecentApps = (): HubAppDefinition[] => {
  if (typeof window === 'undefined') return [];
  const ids = parseRecentHubApps(window.localStorage.getItem(RECENT_APPS_STORAGE_KEY));
  return ids.map((id) => HUB_APPS.find((app) => app.id === id)).filter((app): app is HubAppDefinition => Boolean(app));
};

const HubWorkspacePage: React.FC<HubWorkspacePageProps> = ({ kind, packageId, moduleId }) => {
  const { t } = useTranslation();
  const coreStatusKey = 'guid.hubHome.shell.coreHealthy';
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
  const systemMetrics = useSystemMetrics();
  const cpuPercent = Math.round(systemMetrics.live?.cpu?.overallPercent ?? 12);
  const memPercent = Math.round(systemMetrics.live?.memory?.usedPercent ?? 45);
  const isHighRam = memPercent > 80;
  const { jobs: cronJobs } = useAllCronJobs();
  const { notifications } = useNotifications();
  const [collapsed, setCollapsed] = useState(() => window.matchMedia?.('(max-width: 839px)').matches ?? false);
  const [query, setQuery] = useState('');

  const recentApps = useMemo(readRecentApps, []);
  const titleKey =
    kind === 'management'
      ? 'guid.hubHome.shell.nav.manage'
      : kind === 'store'
        ? 'guid.hubHome.shell.store'
        : 'guid.hubHome.shell.nav.history';

  const subtitleKey =
    kind === 'management'
      ? 'manager.workspace.overviewSubtitle'
      : kind === 'store'
        ? 'guid.hubHome.shell.storeHint'
        : 'guid.hubHome.recentSubtitle';

  const searchKey = 'guid.hubHome.shell.searchPlaceholder';

  const visibleApps = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const source = recentApps.length > 0 ? recentApps : HUB_APPS.slice(0, 4);
    if (!normalizedQuery) return source;
    return source.filter((app) => t(app.labelKey).toLocaleLowerCase().includes(normalizedQuery));
  }, [query, recentApps, t]);

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

      <div className={`${styles.body} ${isPackageApp ? styles.packageAppBody : ''}`}>
        <main className={`${styles.main} ${isPackageApp ? styles.packageAppMain : ''}`}>
          {!isPackageApp && (
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
          )}

          {!packageId && !isPackageApp && (
            <Input
              allowClear
              className={styles.pageSearch}
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
            <StoreContent query={query} />
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
        </main>

        {!isPackageApp && (
          <aside className={styles.statusRail} data-testid='hub-status-rail'>
            {/* Card 1: Tasks Monitor */}
            <Card className={styles.statusCard} bordered>
              <div className={styles.statusHeading}>
                <strong>{t('guid.hubHome.status.workTitle')}</strong>
                <Button type='text' size='mini' onClick={() => navigate('/manager/workspace')}>
                  {t('guid.hubHome.viewAll')}
                </Button>
              </div>
              <div className={styles.statusMetric}>
                <span>
                  {manager.data.tasks.length > 0
                    ? t('guid.hubHome.status.workInProgress', { count: manager.data.tasks.length })
                    : 'Tất cả Agent đang sẵn sàng'}
                </span>
                <Progress
                  percent={manager.data.tasks.length > 0 ? 68 : 0}
                  showText={false}
                  size='small'
                  status={manager.data.tasks.length > 0 ? 'normal' : 'success'}
                />
              </div>
              {manager.data.tasks.slice(0, 2).map((task) => (
                <p
                  key={task.id}
                  style={{
                    margin: '4px 0',
                    fontSize: '11px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  ⚡ {(task as any).name || (task as any).title || task.id}
                </p>
              ))}
            </Card>

            {/* Card 2: System Telemetry */}
            <Card className={styles.statusCard} bordered>
              <div className={styles.statusHeading}>
                <strong>Thông số hệ thống</strong>
                <Cpu theme='outline' size={15} fill='currentColor' />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '11px',
                      color: 'var(--hub-muted)',
                    }}
                  >
                    <span>CPU</span>
                    <span>{cpuPercent}%</span>
                  </div>
                  <Progress
                    percent={cpuPercent}
                    showText={false}
                    size='small'
                    status={cpuPercent > 85 ? 'warning' : 'normal'}
                  />
                </div>
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '11px',
                      color: 'var(--hub-muted)',
                    }}
                  >
                    <span>RAM ({isHighRam ? 'Tải cao' : 'Ổn định'})</span>
                    <span>{memPercent}%</span>
                  </div>
                  <Progress
                    percent={memPercent}
                    showText={false}
                    size='small'
                    status={isHighRam ? 'error' : 'normal'}
                  />
                </div>
              </div>
            </Card>

            {/* Card 3: Usage & Environment */}
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
        )}
      </div>

      <footer className={styles.footer}>
        <span>{t('guid.hubHome.shell.version')}</span>
        <span className={styles.footerStatus}>
          <span className={styles.readyDot} />
          {t(coreStatusKey)}
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
  const [submittingPublisherPackage, setSubmittingPublisherPackage] = useState(false);
  const [publisherSubmissionReceipt, setPublisherSubmissionReceipt] = useState<PublisherSubmissionNativeReceipt>();
  const [goal, setGoal] = useState('');
  const [goalPlan, setGoalPlan] = useState<GoalSurfacePlan>();
  const [planningGoal, setPlanningGoal] = useState(false);
  const [executingPlanStep, setExecutingPlanStep] = useState<number>();
  const [goalPlanningError, setGoalPlanningError] = useState<string>();
  const [modelTargets, setModelTargets] = useState<readonly { targetId: string; modelKeys: readonly string[] }[]>([]);
  const [selectedModelTarget, setSelectedModelTarget] = useState<string>();
  const [selectedModelKey, setSelectedModelKey] = useState<string>();
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
      setPackages(orderStorePackageListings(listings.filter((item) => item.delivery === 'downloaded-package')));
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

  useEffect(() => {
    const modelSelection = window.electronAPI?.hubModelSelection;
    if (!modelSelection) return;
    let active = true;
    void Promise.all([modelSelection.list(), modelSelection.get()]).then(([catalog, current]) => {
      if (!active) return;
      if (!catalog.ok) {
        setGoalPlanningError('guid.hubHome.storeDetail.goalPlanningUnavailable');
        return;
      }
      setModelTargets(catalog.targets);
      if (!current.ok || current.selection === undefined) return;
      const selectedTarget = catalog.targets.find((target) => target.targetId === current.selection?.targetId);
      if (!selectedTarget?.modelKeys.includes(current.selection.modelKey)) return;
      setSelectedModelTarget(selectedTarget.targetId);
      setSelectedModelKey(current.selection.modelKey);
    });
    return () => {
      active = false;
    };
  }, []);

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

  const saveHubModelSelection = async (targetId: string, modelKey: string): Promise<boolean> => {
    const modelSelection = window.electronAPI?.hubModelSelection;
    if (!modelSelection) {
      setGoalPlanningError('guid.hubHome.storeDetail.goalPlanningUnavailable');
      return false;
    }
    const result = await modelSelection.set({ targetId, modelKey });
    if (result.ok) return true;
    setGoalPlanningError('guid.hubHome.storeDetail.goalPlanningUnavailable');
    return false;
  };

  const planSurfacesForGoal = async (): Promise<void> => {
    const planner = window.electronAPI?.hubGoalSurfacePlanning;
    if (!planner || !goal.trim() || !selectedModelTarget || !selectedModelKey) {
      setGoalPlanningError(
        !selectedModelTarget || !selectedModelKey
          ? 'guid.hubHome.storeDetail.goalPlanningModelRequired'
          : 'guid.hubHome.storeDetail.goalPlanningUnavailable'
      );
      return;
    }
    setPlanningGoal(true);
    setGoalPlanningError(undefined);
    setGoalPlan(undefined);
    try {
      if (!(await saveHubModelSelection(selectedModelTarget, selectedModelKey))) return;
      const result = await planner.plan({ goal: goal.trim() });
      if (result.ok === false) {
        setGoalPlanningError('guid.hubHome.storeDetail.goalPlanningUnavailable');
        return;
      }
      setGoalPlan(result.plan);
    } catch {
      setGoalPlanningError('guid.hubHome.storeDetail.goalPlanningUnavailable');
    } finally {
      setPlanningGoal(false);
    }
  };

  /**
   * The C4 development pilot can receive only Main-issued opaque IDs. Package,
   * runtime, target, model, instruction, and user goal stay Main-owned.
   */
  const executeLocalPlanStep = async (stepIndex: number): Promise<void> => {
    const plan = goalPlan;
    const actionApi = window.electronAPI?.hubGoalSurfaceAction;
    const accessApi = window.electronAPI?.packageSurfaceAiAccess;
    if (!plan || !actionApi || !accessApi) {
      Message.error(t('guid.hubHome.storeDetail.goalPlanningPilotUnavailable'));
      return;
    }
    setExecutingPlanStep(stepIndex);
    try {
      const prepared = await actionApi.prepare({ planId: plan.requestId, stepIndex });
      if (!prepared.ok || !('actionId' in prepared) || !('consent' in prepared)) {
        Message.error(t('guid.hubHome.storeDetail.goalPlanningPilotUnavailable'));
        setExecutingPlanStep(undefined);
        return;
      }
      const challengeResult = await accessApi.requestChallenge(prepared.consent);
      if (!challengeResult.ok || !('challenge' in challengeResult)) {
        await actionApi.cancel({ actionId: prepared.actionId });
        Message.error(t('guid.hubHome.storeDetail.goalPlanningPilotUnavailable'));
        setExecutingPlanStep(undefined);
        return;
      }
      const { challenge } = challengeResult;
      Modal.confirm({
        title: t('guid.hubHome.storeDetail.goalPlanningPilotConfirmTitle'),
        content: t('guid.hubHome.storeDetail.goalPlanningPilotConfirmDescription', {
          operation: challenge.operationId,
          capability: challenge.capability,
        }),
        okText: t('guid.hubHome.storeDetail.aiAccessAllow'),
        cancelText: t('common.cancel'),
        onOk: async () => {
          try {
            const confirmation = await accessApi.confirmChallenge({
              challengeId: challenge.challengeId,
              approved: true,
            });
            if (
              !confirmation.ok ||
              !('approved' in confirmation) ||
              !confirmation.approved ||
              !confirmation.consentId
            ) {
              await actionApi.cancel({ actionId: prepared.actionId });
              Message.error(t('guid.hubHome.storeDetail.goalPlanningPilotUnavailable'));
              return;
            }
            const execution = await actionApi.execute({
              actionId: prepared.actionId,
              consentId: confirmation.consentId,
            });
            if (!execution.ok || !('receipt' in execution)) {
              Message.error(t('guid.hubHome.storeDetail.goalPlanningPilotUnavailable'));
              return;
            }
            Message.success(
              t('guid.hubHome.storeDetail.goalPlanningPilotSuccess', { receipt: execution.receipt.receiptId })
            );
          } catch {
            Message.error(t('guid.hubHome.storeDetail.goalPlanningPilotUnavailable'));
          } finally {
            setExecutingPlanStep(undefined);
          }
        },
        onCancel: () => {
          void accessApi.confirmChallenge({ challengeId: challenge.challengeId, approved: false });
          void actionApi.cancel({ actionId: prepared.actionId });
          setExecutingPlanStep(undefined);
        },
      });
    } catch {
      Message.error(t('guid.hubHome.storeDetail.goalPlanningPilotUnavailable'));
      setExecutingPlanStep(undefined);
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
      <div className='mb-12px flex justify-end gap-8px'>
        <Button
          type='secondary'
          loading={submittingPublisherPackage}
          disabled={submittingPublisherPackage}
          data-testid='store-publisher-submit'
          onClick={() => void submitPublisherPackage()}
        >
          {t('guid.hubHome.storeDetail.publisherSubmission')}
        </Button>
        <Button
          type='secondary'
          icon={<Refresh theme='outline' size='14' />}
          loading={refreshing}
          onClick={() => void refreshCatalog()}
        >
          {t('common.refresh')}
        </Button>
      </div>
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
      <Card className={styles.surfacePlanner} bordered data-testid='store-goal-surface-planner'>
        <div className={styles.surfacePlannerHeader}>
          <div>
            <h2>{t('guid.hubHome.storeDetail.goalPlanningTitle')}</h2>
            <p>{t('guid.hubHome.storeDetail.goalPlanningDescription')}</p>
          </div>
          <Tag color={LOCAL_SURFACE_AI_PILOT_VISIBLE ? 'arcoblue' : 'gray'}>
            {t(
              LOCAL_SURFACE_AI_PILOT_VISIBLE
                ? 'guid.hubHome.storeDetail.goalPlanningPilotLocal'
                : 'guid.hubHome.storeDetail.goalPlanningNoAction'
            )}
          </Tag>
        </div>
        <div className={styles.surfacePlannerControls}>
          <Select
            value={selectedModelTarget}
            placeholder={t('guid.hubHome.storeDetail.goalPlanningTarget')}
            onChange={(value: string) => {
              setSelectedModelTarget(value);
              setSelectedModelKey(undefined);
              setGoalPlanningError(undefined);
            }}
          >
            {modelTargets.map((target) => (
              <Select.Option key={target.targetId} value={target.targetId}>
                {target.targetId}
              </Select.Option>
            ))}
          </Select>
          <Select
            value={selectedModelKey}
            placeholder={t('guid.hubHome.storeDetail.goalPlanningModel')}
            disabled={!selectedModelTarget}
            onChange={(value: string) => {
              setSelectedModelKey(value);
              setGoalPlanningError(undefined);
            }}
          >
            {modelTargets
              .find((target) => target.targetId === selectedModelTarget)
              ?.modelKeys.map((modelKey) => (
                <Select.Option key={modelKey} value={modelKey}>
                  {modelKey}
                </Select.Option>
              ))}
          </Select>
          <Input.TextArea
            value={goal}
            autoSize={{ minRows: 2, maxRows: 5 }}
            placeholder={t('guid.hubHome.storeDetail.goalPlanningGoal')}
            maxLength={10_000}
            onChange={setGoal}
          />
          <Button
            type='primary'
            loading={planningGoal}
            disabled={planningGoal || !goal.trim() || !selectedModelTarget || !selectedModelKey}
            onClick={() => void planSurfacesForGoal()}
            data-testid='store-goal-surface-plan'
          >
            {t('guid.hubHome.storeDetail.goalPlanningAction')}
          </Button>
        </div>
        {goalPlanningError && <Alert type='warning' content={t(goalPlanningError)} showIcon />}
        {goalPlan && (
          <div className={styles.surfacePlanSteps} data-testid='store-goal-surface-plan-result'>
            {goalPlan.steps.map((step, stepIndex) => {
              const packageId =
                step.kind === 'propose-install'
                  ? step.proposal.candidate.package.packageId
                  : step.kind === 'blocked'
                    ? undefined
                    : step.candidate.package.packageId;
              const labelKey =
                step.kind === 'execute-local'
                  ? 'guid.hubHome.storeDetail.goalPlanningLocal'
                  : step.kind === 'execute-remote'
                    ? 'guid.hubHome.storeDetail.goalPlanningRemote'
                    : step.kind === 'propose-install'
                      ? 'guid.hubHome.storeDetail.goalPlanningInstall'
                      : 'guid.hubHome.storeDetail.goalPlanningBlocked';
              const installedSurface =
                step.kind === 'execute-local' && packageId
                  ? packages.find((item) => item.manifest.id === packageId)
                  : undefined;
              const runnableModule = installedSurface ? getFirstRunnablePackageModule(installedSurface) : undefined;
              const canRunLocalPilot =
                LOCAL_SURFACE_AI_PILOT_VISIBLE &&
                step.kind === 'execute-local' &&
                Boolean(window.electronAPI?.hubGoalSurfaceAction);
              return (
                <div key={step.query.queryId} className={styles.surfacePlanStep}>
                  <Tag>{t(labelKey)}</Tag>
                  <strong>{step.query.capability}</strong>
                  {packageId && <span>{packageId}</span>}
                  {step.kind === 'propose-install' && step.proposal.requiresPurchase && (
                    <small>{t('guid.hubHome.storeDetail.goalPlanningPurchase')}</small>
                  )}
                  {packageId && (
                    <Button
                      type='text'
                      size='mini'
                      onClick={() => {
                        if (step.kind === 'execute-local' && runnableModule) {
                          navigate(`/apps/${encodeURIComponent(packageId)}/${encodeURIComponent(runnableModule.id)}`);
                          return;
                        }
                        navigate(`/store/package/${encodeURIComponent(packageId)}`);
                      }}
                    >
                      {t('guid.hubHome.storeDetail.goalPlanningViewSurface')}
                    </Button>
                  )}
                  {canRunLocalPilot && (
                    <Button
                      type='primary'
                      size='mini'
                      loading={executingPlanStep === stepIndex}
                      disabled={executingPlanStep !== undefined}
                      data-testid={`store-goal-surface-run-local-${stepIndex}`}
                      onClick={() => void executeLocalPlanStep(stepIndex)}
                    >
                      {t('guid.hubHome.storeDetail.goalPlanningPilotAction')}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
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
                </div>
                <strong className={styles.packageName}>{item.manifest.name}</strong>
                <p className={styles.packageDescription}>{item.manifest.description}</p>
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
