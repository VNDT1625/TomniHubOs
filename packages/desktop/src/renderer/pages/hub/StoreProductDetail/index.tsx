/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PackageListing } from '@/common/packages';
import type { PackageSurfaceAiAccessConsentDisplay } from '@/common/types/platform/electron';
import { Alert, Button, Card, Message, Modal, Spin, Tag } from '@arco-design/web-react';
import { ApplicationOne, CheckOne, Left, Lock, Shield } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getFirstRunnablePackageModule } from '../PackageAppHost';
import { packageClient } from '../packageClient';
import styles from './StoreProductDetail.module.css';
import { requestPackagePermissionUpdateConsent } from './permissionConsent';

type StoreProductDetailProps = {
  packageId: string;
  onBack: () => void;
  onOpen: (packageId: string, moduleId: string) => void;
};

const formatPackageSize = (bytes: number | undefined, locale: string): string => {
  if (!bytes || bytes <= 0) return '—';
  const megabytes = bytes / (1024 * 1024);
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: megabytes >= 1 ? 'megabyte' : 'kilobyte',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(megabytes >= 1 ? megabytes : bytes / 1024);
};

/** Formats a signed integer-minor offer for display only; commerce decisions stay in Main. */
const formatOfferPrice = (amountMinor: number, currency: string, locale: string): string => {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits;
  return formatter.format(amountMinor / 10 ** fractionDigits);
};

const StoreProductDetail: React.FC<StoreProductDetailProps> = ({ packageId, onBack, onOpen }) => {
  const { t, i18n } = useTranslation();
  const [listing, setListing] = useState<PackageListing>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [surfaceAiConsents, setSurfaceAiConsents] = useState<readonly PackageSurfaceAiAccessConsentDisplay[]>([]);
  const [surfaceAiBusyOperation, setSurfaceAiBusyOperation] = useState<string>();
  const [failedScreenshots, setFailedScreenshots] = useState<Set<string>>(() => new Set());

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const packages = await packageClient.list();
      const nextListing = packages.find((item) => item.manifest.id === packageId);
      setListing(nextListing);
      const accessApi = window.electronAPI?.packageSurfaceAiAccess;
      if (!accessApi || nextListing?.state !== 'installed' || !nextListing.enabled) {
        setSurfaceAiConsents([]);
      } else {
        const result = await accessApi.listConsents({ packageId });
        setSurfaceAiConsents(result.ok ? result.consents : []);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [packageId]);

  useEffect(() => {
    setFailedScreenshots(new Set());
    void load();
  }, [load]);

  const installed = listing?.state === 'installed';
  const hasLocalInstall = Boolean(listing?.installedVersion);
  const runnableModule = useMemo(() => (listing ? getFirstRunnablePackageModule(listing) : undefined), [listing]);
  const requiresPayment = Boolean(listing?.offer?.active && listing.offer.price.amountMinor > 0);

  const installOrUpdate = async (): Promise<void> => {
    if (!listing) return;
    setBusy(true);
    setError(undefined);
    try {
      const id = listing.manifest.id;
      const permissionConsentId = await requestPackagePermissionUpdateConsent(id, t);
      if (permissionConsentId === null) return;
      setListing(
        permissionConsentId ? await packageClient.install(id, permissionConsentId) : await packageClient.install(id)
      );
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setError(message);
      Message.error(message);
    } finally {
      setBusy(false);
    }
  };

  const removePackage = async (): Promise<void> => {
    if (!listing) return;
    setBusy(true);
    setError(undefined);
    try {
      setListing(await packageClient.uninstall(listing.manifest.id));
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setError(message);
      Message.error(message);
    } finally {
      setBusy(false);
    }
  };

  const updateInstalledPackage = async (operation: (id: string) => Promise<PackageListing>): Promise<void> => {
    if (!listing) return;
    setBusy(true);
    setError(undefined);
    try {
      setListing(await operation(listing.manifest.id));
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setError(message);
      Message.error(message);
    } finally {
      setBusy(false);
    }
  };

  const confirmRemoval = (): void => {
    if (!listing) return;
    Modal.confirm({
      title: t('guid.hubHome.storeDetail.removeTitle', { name: listing.manifest.name }),
      content: t('guid.hubHome.storeDetail.removeDescription'),
      okText: t('common.remove'),
      cancelText: t('common.cancel'),
      okButtonProps: { status: 'danger' },
      onOk: removePackage,
    });
  };

  const requestSurfaceAiAccess = async (operationId: string): Promise<void> => {
    const accessApi = window.electronAPI?.packageSurfaceAiAccess;
    if (!accessApi) {
      Message.error(t('guid.hubHome.storeDetail.aiAccessUnavailable'));
      return;
    }
    setSurfaceAiBusyOperation(operationId);
    try {
      const result = await accessApi.requestChallenge({ packageId, operationId });
      if (!result.ok || !('challenge' in result)) {
        Message.error(t('guid.hubHome.storeDetail.aiAccessUnavailable'));
        return;
      }
      const { challenge } = result;
      Modal.confirm({
        title: t('guid.hubHome.storeDetail.aiAccessConfirmTitle'),
        content: (
          <div className='flex flex-col gap-3' data-testid='store-product-ai-access-challenge'>
            <p className='m-0 text-secondary'>
              {t('guid.hubHome.storeDetail.aiAccessConfirmDescription', {
                operation: challenge.operationId,
                capability: challenge.capability,
              })}
            </p>
            <dl className='m-0 grid grid-cols-[minmax(132px,auto)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm'>
              <dt>{t('guid.hubHome.storeDetail.aiAccessConfirmPackage')}</dt>
              <dd className='m-0 break-all' data-testid='store-product-ai-access-challenge-package'>
                {`${challenge.packageId} · ${challenge.packageVersion}`}
              </dd>
              <dt>{t('guid.hubHome.storeDetail.aiAccessConfirmPublisher')}</dt>
              <dd className='m-0 break-all' data-testid='store-product-ai-access-challenge-publisher'>
                {challenge.publisherId}
              </dd>
              <dt>{t('guid.hubHome.storeDetail.aiAccessConfirmOperation')}</dt>
              <dd className='m-0 break-all' data-testid='store-product-ai-access-challenge-operation'>
                {challenge.operationId}
              </dd>
              <dt>{t('guid.hubHome.storeDetail.aiAccessConfirmCapability')}</dt>
              <dd className='m-0 break-all' data-testid='store-product-ai-access-challenge-capability'>
                {challenge.capability}
              </dd>
              <dt>{t('guid.hubHome.storeDetail.aiAccessConfirmSecretUse')}</dt>
              <dd className='m-0' data-testid='store-product-ai-access-challenge-secret-use'>
                {challenge.secretUse
                  ? t('guid.hubHome.storeDetail.aiAccessConfirmSecretUseYes')
                  : t('guid.hubHome.storeDetail.aiAccessConfirmSecretUseNo')}
              </dd>
              <dt>{t('guid.hubHome.storeDetail.aiAccessConfirmDataClasses')}</dt>
              <dd className='m-0 break-all' data-testid='store-product-ai-access-challenge-data-classes'>
                {challenge.dataClasses.join(', ') || t('guid.hubHome.storeDetail.aiAccessConfirmNone')}
              </dd>
              <dt>{t('guid.hubHome.storeDetail.aiAccessConfirmDestinations')}</dt>
              <dd className='m-0 break-all' data-testid='store-product-ai-access-challenge-destinations'>
                {challenge.destinationIds.join(', ') || t('guid.hubHome.storeDetail.aiAccessConfirmNone')}
              </dd>
              <dt>{t('guid.hubHome.storeDetail.aiAccessConfirmExpiresAt')}</dt>
              <dd className='m-0 break-all' data-testid='store-product-ai-access-challenge-expires-at'>
                <time dateTime={challenge.expiresAt}>{challenge.expiresAt}</time>
              </dd>
            </dl>
          </div>
        ),
        okText: t('guid.hubHome.storeDetail.aiAccessAllow'),
        cancelText: t('common.cancel'),
        onOk: async () => {
          const confirmation = await accessApi.confirmChallenge({ challengeId: challenge.challengeId, approved: true });
          if (!confirmation.ok || !('approved' in confirmation) || !confirmation.approved) {
            Message.error(t('guid.hubHome.storeDetail.aiAccessUnavailable'));
            return;
          }
          Message.success(t('guid.hubHome.storeDetail.aiAccessGranted'));
          await load();
        },
        onCancel: () => {
          void accessApi.confirmChallenge({ challengeId: challenge.challengeId, approved: false });
        },
      });
    } finally {
      setSurfaceAiBusyOperation(undefined);
    }
  };

  const revokeSurfaceAiAccess = async (consentId: string): Promise<void> => {
    const accessApi = window.electronAPI?.packageSurfaceAiAccess;
    if (!accessApi) return;
    setSurfaceAiBusyOperation(consentId);
    try {
      const result = await accessApi.revokeConsent({ consentId });
      if (!result.ok || !('revoked' in result) || !result.revoked) {
        Message.error(t('guid.hubHome.storeDetail.aiAccessUnavailable'));
        return;
      }
      Message.success(t('guid.hubHome.storeDetail.aiAccessRevoked'));
      await load();
    } finally {
      setSurfaceAiBusyOperation(undefined);
    }
  };

  if (loading) {
    return (
      <div className={styles.centerState} data-testid='store-product-loading'>
        <Spin tip={t('common.loading')} />
      </div>
    );
  }

  if (!listing) {
    return (
      <Card className={styles.errorCard} bordered data-testid='store-product-unavailable'>
        <ApplicationOne theme='outline' size={32} fill='currentColor' />
        <strong>{t('guid.hubHome.storeDetail.notFound')}</strong>
        <p>{error}</p>
        <div className={styles.errorActions}>
          <Button type='secondary' icon={<Left theme='outline' size={14} />} onClick={onBack}>
            {t('guid.hubHome.storeDetail.back')}
          </Button>
          <Button type='primary' onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </div>
      </Card>
    );
  }

  const { manifest } = listing;
  const AppIcon = ApplicationOne;
  const signedFirstParty = listing.trust === 'signed-first-party';
  const statusKey = listing.updateAvailable
    ? 'guid.hubHome.storeDetail.updateAvailable'
    : !listing.compatible
      ? 'guid.hubHome.storeDetail.incompatible'
      : listing.state === 'quarantined'
        ? 'guid.hubHome.storeDetail.quarantined'
        : installed
          ? 'guid.hubHome.storeDetail.installed'
          : 'guid.hubHome.storeDetail.available';
  const screenshots = (manifest.screenshots ?? []).filter((screenshot) => !failedScreenshots.has(screenshot.url));

  const markScreenshotFailed = (url: string): void => {
    setFailedScreenshots((current) => new Set(current).add(url));
  };

  return (
    <article className={styles.detail} data-testid='store-product-detail'>
      <Button type='text' className={styles.backButton} icon={<Left theme='outline' size={14} />} onClick={onBack}>
        {t('guid.hubHome.storeDetail.back')}
      </Button>

      {error && <Alert type='error' content={error} closable onClose={() => setError(undefined)} />}

      <Card className={styles.heroCard} bordered>
        <div className={styles.hero}>
          <div className={styles.appIcon}>
            <AppIcon theme='outline' size={38} fill='currentColor' />
          </div>
          <div className={styles.identity}>
            <div className={styles.eyebrow}>
              <span>{t('guid.hubHome.storeDetail.app')}</span>
              <span>·</span>
              <span>{manifest.publisherId}</span>
            </div>
            <h2>{manifest.name}</h2>
            <p>{manifest.description}</p>
            <div className={styles.badges}>
              <Tag
                color={
                  listing.updateAvailable ? 'orange' : installed ? 'green' : listing.compatible ? 'arcoblue' : 'red'
                }
              >
                {t(statusKey)}
              </Tag>
              <Tag icon={<Shield theme='outline' size={12} />}>{t('guid.hubHome.storeDetail.verified')}</Tag>
              <Tag>{manifest.bundleKind}</Tag>
              {listing.offer?.active && (
                <Tag data-testid='store-product-offer'>
                  {t('guid.hubHome.storeDetail.price')}{' '}
                  {formatOfferPrice(
                    listing.offer.price.amountMinor,
                    listing.offer.price.currency,
                    i18n.resolvedLanguage || i18n.language
                  )}
                </Tag>
              )}
            </div>
          </div>
          <div className={styles.heroActions}>
            {installed && listing.enabled && runnableModule && (
              <Button
                type={listing.updateAvailable ? 'secondary' : 'primary'}
                long
                onClick={() => onOpen(manifest.id, runnableModule.id)}
                data-testid='store-product-open'
              >
                {t('manager.palette.open')}
              </Button>
            )}
            {(!installed || listing.updateAvailable) && (
              <>
                <Button
                  type='primary'
                  long
                  loading={busy}
                  disabled={!listing.compatible || requiresPayment}
                  onClick={() => void installOrUpdate()}
                  data-testid='store-product-installation'
                >
                  {t(listing.updateAvailable ? 'guid.hubHome.storeDetail.update' : 'guid.hubHome.storeDetail.install')}
                </Button>
                {requiresPayment && (
                  <span className={styles.paymentNotice} data-testid='store-product-payment-unavailable'>
                    {t('guid.hubHome.storeDetail.paymentUnavailable')}
                  </span>
                )}
              </>
            )}
            {installed && !listing.enabled && (
              <Button
                type='primary'
                long
                loading={busy}
                onClick={() => void updateInstalledPackage(packageClient.enable)}
                data-testid='store-product-enable'
              >
                {t('guid.hubHome.storeDetail.enable')}
              </Button>
            )}
            {installed && listing.enabled && (
              <Button
                type='secondary'
                long
                loading={busy}
                onClick={() => void updateInstalledPackage(packageClient.disable)}
                data-testid='store-product-disable'
              >
                {t('guid.hubHome.storeDetail.disable')}
              </Button>
            )}
            {installed && listing.previousVersion && (
              <Button
                type='secondary'
                long
                disabled={busy}
                onClick={() => void updateInstalledPackage(packageClient.rollback)}
                data-testid='store-product-rollback'
              >
                {t('guid.hubHome.storeDetail.rollback')}
              </Button>
            )}
            {hasLocalInstall && (
              <Button
                type='secondary'
                status='danger'
                long
                disabled={busy}
                onClick={confirmRemoval}
                data-testid='store-product-remove'
              >
                {t('common.remove')}
              </Button>
            )}
          </div>
        </div>

        <div className={styles.metrics}>
          <div>
            <span>{t('common.version')}</span>
            <strong>{manifest.version}</strong>
          </div>
          <div>
            <span>{t('guid.hubHome.storeDetail.size')}</span>
            <strong>{formatPackageSize(manifest.artifact?.sizeBytes, i18n.resolvedLanguage || i18n.language)}</strong>
          </div>
          <div>
            <span>{t('guid.hubHome.storeDetail.compatibility')}</span>
            <strong>{manifest.engines.tomni}</strong>
          </div>
        </div>
      </Card>

      {installed && listing.enabled && listing.installedManifest?.aiAccess?.operations.length ? (
        <Card className={styles.sectionCard} bordered data-testid='store-product-ai-access'>
          <div className={styles.sectionHeading}>
            <div>
              <h3>{t('guid.hubHome.storeDetail.aiAccessTitle')}</h3>
              <p>{t('guid.hubHome.storeDetail.aiAccessDescription')}</p>
            </div>
            <Tag color='orange'>{t('guid.hubHome.storeDetail.aiAccessSeparateConsent')}</Tag>
          </div>
          <div className={styles.aiAccessList}>
            {listing.installedManifest.aiAccess.operations.map((operation) => {
              const consent = surfaceAiConsents.find(
                (candidate) =>
                  candidate.operationId === operation.id &&
                  candidate.packageVersion === listing.installedManifest?.version
              );
              return (
                <div className={styles.aiAccessOperation} key={operation.id}>
                  <div>
                    <strong>{operation.id}</strong>
                    <span>{operation.capability}</span>
                  </div>
                  {consent ? (
                    <Button
                      type='secondary'
                      status='danger'
                      size='small'
                      loading={surfaceAiBusyOperation === consent.consentId}
                      onClick={() => void revokeSurfaceAiAccess(consent.consentId)}
                      data-testid={`store-product-ai-revoke-${operation.id}`}
                    >
                      {t('guid.hubHome.storeDetail.aiAccessRevoke')}
                    </Button>
                  ) : (
                    <Button
                      type='primary'
                      size='small'
                      loading={surfaceAiBusyOperation === operation.id}
                      onClick={() => void requestSurfaceAiAccess(operation.id)}
                      data-testid={`store-product-ai-grant-${operation.id}`}
                    >
                      {t('guid.hubHome.storeDetail.aiAccessAllow')}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {screenshots.length > 0 ? (
        <section
          className={styles.screenshotGallery}
          aria-label={t('guid.hubHome.storeDetail.previewLabel')}
          data-testid='store-product-screenshots'
        >
          {screenshots.map((screenshot, index) => (
            <div key={screenshot.url} className={styles.screenshotFrame}>
              <img
                src={screenshot.url}
                alt={
                  screenshot.alt ??
                  t('guid.hubHome.storeDetail.previewImageAlt', {
                    name: manifest.name,
                    index: index + 1,
                  })
                }
                loading={index === 0 ? 'eager' : 'lazy'}
                onError={() => markScreenshotFailed(screenshot.url)}
              />
            </div>
          ))}
        </section>
      ) : (
        <section
          className={styles.preview}
          aria-label={t('guid.hubHome.storeDetail.whatsInside')}
          data-testid='store-product-capability-preview'
        >
          <div className={styles.previewCopy}>
            <span>{t('guid.hubHome.storeDetail.previewLabel')}</span>
            <h3>{t('guid.hubHome.storeDetail.previewTitle', { name: manifest.name })}</h3>
            <p>{t('guid.hubHome.storeDetail.previewDescription')}</p>
          </div>
          <div className={styles.modulePreview}>
            {manifest.modules.slice(0, 4).map((module, index) => (
              <div key={module.id} className={styles.previewModule}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{module.title}</strong>
                <small>{module.surface}</small>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className={styles.contentGrid}>
        <div className={styles.primaryColumn}>
          <Card className={styles.sectionCard} bordered>
            <h3>{t('guid.hubHome.storeDetail.about')}</h3>
            <p>{manifest.description}</p>
            <div className={styles.tagList}>
              {manifest.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </div>
          </Card>

          <Card className={styles.sectionCard} bordered>
            <h3>{t('guid.hubHome.storeDetail.whatsInside')}</h3>
            <div className={styles.moduleList}>
              {manifest.modules.map((module) => (
                <div key={module.id} className={styles.moduleRow}>
                  <span className={styles.moduleIcon}>
                    <ApplicationOne theme='outline' size={17} fill='currentColor' />
                  </span>
                  <div>
                    <strong>{module.title}</strong>
                    <p>{module.surface}</p>
                  </div>
                  {module.pinnable && <CheckOne theme='outline' size={15} className={styles.checkIcon} />}
                </div>
              ))}
            </div>
          </Card>

          <Card className={styles.sectionCard} bordered>
            <h3>{t('guid.hubHome.storeDetail.releaseNotes')}</h3>
            <strong>{t('guid.hubHome.storeDetail.currentRelease', { version: manifest.version })}</strong>
            <p>{t('guid.hubHome.storeDetail.releaseNotesBody')}</p>
          </Card>
        </div>

        <aside className={styles.secondaryColumn}>
          <Card className={styles.sectionCard} bordered>
            <h3>{t('guid.hubHome.storeDetail.developer')}</h3>
            <div className={styles.factList}>
              <div>
                <span>{t('guid.hubHome.storeDetail.publisher')}</span>
                <strong>{manifest.publisherId}</strong>
              </div>
              <div>
                <span>{t('guid.hubHome.storeDetail.packageType')}</span>
                <strong>{manifest.type}</strong>
              </div>
              <div>
                <span>{t('guid.hubHome.storeDetail.trust')}</span>
                <strong>
                  {t(signedFirstParty ? 'guid.hubHome.storeDetail.firstParty' : 'guid.hubHome.storeDetail.storeSigned')}
                </strong>
              </div>
            </div>
          </Card>

          <Card className={styles.sectionCard} bordered>
            <h3>
              <Lock theme='outline' size={16} fill='currentColor' />
              {t('guid.hubHome.storeDetail.permissions')}
            </h3>
            {manifest.permissions.length > 0 ? (
              <div className={styles.permissionList}>
                {manifest.permissions.map((permission) => (
                  <div key={permission}>
                    <CheckOne theme='outline' size={13} fill='currentColor' />
                    <span>{permission}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p>{t('guid.hubHome.storeDetail.noPermissions')}</p>
            )}
          </Card>

          <Card className={styles.sectionCard} bordered>
            <h3>{t('guid.hubHome.storeDetail.dependencies')}</h3>
            {manifest.dependencies.length > 0 ? (
              <div className={styles.factList}>
                {manifest.dependencies.map((dependency) => (
                  <div key={dependency.id}>
                    <strong>{dependency.id}</strong>
                    <span>{dependency.version}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p>{t('guid.hubHome.storeDetail.noDependencies')}</p>
            )}
          </Card>
        </aside>
      </div>
    </article>
  );
};

export default StoreProductDetail;
