/**
 * First-login package chooser and cross-device reinstall prompt.
 * Never copies app data, secrets or local Repo-to-Package archives into the cloud.
 */
import type { PackageListing } from '@/common/packages';
import { Button, Checkbox, Message, Modal } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_ONBOARDING_APPS } from '../guid/HubHome/sidebarPins';
import { flushCloudPackageOutbox, loadCloudPackageLibrary } from './cloudPackageLibrary';
import { isAvailableSignedAppPackage, isPackageListingInstalled } from './installedPackageApps';
import { packageClient } from './packageClient';
import { requestPackagePermissionUpdateConsent } from './StoreProductDetail/permissionConsent';

type Option = { id: string; name: string; available: boolean };
type Prompt = { kind: 'first-login' | 'restore'; options: Option[] };
const deviceDecisionKey = (userId: string): string => `tomni.hub.package-restore-handled.${userId}`;

export const buildRestorePrompt = (
  cloud: readonly { package_id: string; name: string }[],
  local: readonly PackageListing[],
  catalog: readonly PackageListing[]
): Prompt | null => {
  // The same physical device already has the user's Store apps; never reprompt or reinstall.
  const installed = new Set(local.filter(isPackageListingInstalled).map((item) => item.manifest.id));
    const available = new Set(catalog.filter(isAvailableSignedAppPackage).map((item) => item.manifest.id));
  if (cloud.length === 0 && installed.size > 0) return null;
  if (cloud.length > 0) {
    // Only artifacts in an independently verified Store catalog can be offered for reinstallation.
    const missing = cloud.filter((item) => available.has(item.package_id) && !installed.has(item.package_id));
    return missing.length > 0
      ? { kind: 'restore', options: missing.map((item) => ({ id: item.package_id, name: item.name, available: true })) }
      : null;
  }
  return {
    kind: 'first-login',
    options: DEFAULT_ONBOARDING_APPS.map((item) => ({
      id: item.id,
      name: item.name,
      available: available.has(item.id),
    })),
  };
};

export const PackageRestoreOnboarding: React.FC<{ userId?: string; ready: boolean }> = ({ userId, ready }) => {
  const { t } = useTranslation();
  const [installing, setInstalling] = useState<string>();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<readonly string[]>([]);

  useEffect(() => {
    let alive = true;
    setPrompt(null);
    setFailed([]);
    if (!userId || !ready) return () => { alive = false; };
    try {
      if (window.localStorage.getItem(deviceDecisionKey(userId)) === '1') return () => { alive = false; };
    } catch { /* storage can be unavailable */ }
    void (async () => {
            const [cloud, catalogResult, localResult] = await Promise.all([
                flushCloudPackageOutbox(userId).catch((): undefined => undefined).then(() => loadCloudPackageLibrary(userId)),
        packageClient.list().then((items) => ({ ok: true as const, items })).catch(() => ({ ok: false as const })),
        packageClient.list({ installedOnly: true }).then((items) => ({ ok: true as const, items })).catch(() => ({ ok: false as const })),
      ]);
      if (!alive) return;
      // A failed local inventory read cannot be treated as a new empty installation.
      if (!catalogResult.ok || !localResult.ok) {
        Message.warning(t('guid.hubHome.layout.packageReadFailed', { defaultValue: 'Không đọc được danh sách package trên thiết bị. Chưa thể tải lại ứng dụng.' }));
        return;
      }
      if (!cloud.ok) {
        if ('reason' in cloud && cloud.reason === 'service-unavailable') {
          Message.warning(t('guid.hubHome.layout.cloudReadFailed'));
        }
        return;
      }
            const result = buildRestorePrompt(cloud.items, localResult.items, catalogResult.items);
      if (!result) return;
            // Unavailable downloads remain visible, but are never preselected as installable.
      setSelected(result.options.filter((item) => item.available).map((item) => item.id));
      setPrompt(result);
    })().catch(() => {
      if (alive) Message.warning(t('guid.hubHome.layout.packageCheckFailed'));
    });
    return () => { alive = false; };
  }, [userId, ready]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const dismiss = (): void => {
    if (userId) {
      try { window.localStorage.setItem(deviceDecisionKey(userId), '1'); }
      catch { /* storage can be unavailable */ }
    }
    setPrompt(null);
  };
  const accept = async (): Promise<void> => {
    if (!prompt || busy) return;
        setBusy(true);
    setFailed([]);
    setInstalling(undefined);
        const errors: string[] = [];
    const retryIds: string[] = [];
    for (const item of prompt.options) {
      if (!selectedSet.has(item.id)) continue;
            if (!item.available) {
        retryIds.push(item.id);
        errors.push(t('guid.hubHome.layout.unavailableInstallError', { name: item.name }));
        continue;
      }
            try {
        setInstalling(item.name);
        // Use the same permission-update challenge and owner-bound receipt as Store.
        // No consent means no change to the already installed package.
                // eslint-disable-next-line no-await-in-loop -- Permission dialogs are sequential; never display multiple grant challenges together.
        const consentId = await requestPackagePermissionUpdateConsent(item.id, t);
                if (consentId === null) {
          retryIds.push(item.id);
          errors.push(t('guid.hubHome.layout.installConsentCancelled', { name: item.name, defaultValue: `${item.name}: đã hủy duyệt quyền cài đặt.` }));
          continue;
        }
        // Main performs the real verified download and filesystem transaction.
                // eslint-disable-next-line no-await-in-loop -- The signed package installer and its progress are serialized for predictable recovery.
        await packageClient.install(item.id, consentId ?? undefined);
            } catch (error) {
        retryIds.push(item.id);
        errors.push(t('guid.hubHome.layout.installAndOpenFailed', {
          name: item.name, reason: error instanceof Error ? error.message : t('guid.hubHome.layout.installUnknownError'),
        }));
      }
    }
        setInstalling(undefined);
    setBusy(false);
        if (errors.length) {
      // A partial success must not silently reinstall already completed packages on Retry.
      setSelected(retryIds);
      setFailed(errors);
      Message.warning(t('guid.hubHome.layout.someInstallFailed'));
      return;
    }
    dismiss();
  };

  return (
    <Modal
      visible={prompt !== null}
      unmountOnExit
      closable={!busy}
      maskClosable={false}
      title={t(prompt?.kind === 'restore' ? 'guid.hubHome.layout.restoreTitle' : 'guid.hubHome.layout.firstLoginTitle')}
      footer={null}
            onCancel={() => { if (!busy) dismiss(); }}

      className='hub-package-onboarding'
    >
      <p className='hub-onboarding-description'>
        {prompt?.kind === 'restore'
          ? t('guid.hubHome.layout.restoreDescription')
          : t('guid.hubHome.layout.firstLoginDescription')}
      </p>
      <div className='hub-onboarding-options' data-testid='hub-onboarding-options'>
        {prompt?.options.map((item) => (
          <label className='hub-onboarding-option' key={item.id}>
            <Checkbox
              checked={selectedSet.has(item.id)}
              disabled={busy || !item.available}
              onChange={(checked) => setSelected((current) =>
                checked ? [...current.filter((id) => id !== item.id), item.id] : current.filter((id) => id !== item.id)
              )}
            />
            <span>{item.name}</span>
            {!item.available && <small title={t('guid.hubHome.layout.packageUnavailableHint', { defaultValue: 'Chưa có package đã ký tương thích với phiên bản Tomny hiện tại' })}>{t('guid.hubHome.layout.packageUnavailable', { defaultValue: 'Chưa có bản tương thích' })}</small>}
          </label>
        ))}
      </div>
      {failed.length > 0 && (
        <div className='hub-onboarding-errors' role='alert'>
          {failed.map((error) => <p key={error}>{error}</p>)}
        </div>
      )}
            {installing && (
        <p className='hub-onboarding-progress' role='status'>
          {t('guid.hubHome.layout.installingPackage', { name: installing, defaultValue: `Đang cài đặt ${installing}…` })}
        </p>
      )}
      <div className='hub-onboarding-actions'>
        <Button disabled={busy} onClick={dismiss}>{t('guid.hubHome.layout.skip')}</Button>
        <Button type='primary' loading={busy} onClick={() => void accept()}>
          {t(prompt?.kind === 'restore' ? 'guid.hubHome.layout.restoreSelected' : 'guid.hubHome.layout.installSelected')}
        </Button>
      </div>
    </Modal>
  );
};
