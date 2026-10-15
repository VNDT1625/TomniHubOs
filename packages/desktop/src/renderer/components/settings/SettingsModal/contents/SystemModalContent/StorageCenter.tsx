import { ipcBridge } from '@/common';
import type {
  StorageCenterCategoryId,
  StorageCenterCleanupPreview,
  StorageCenterPolicy,
  StorageCenterSummary,
} from '@/common/types/platform/storageCenter';
import SectionCard from '@/renderer/pages/settings/ResourceSettings/components/SectionCard';
import { Alert, Button, Divider, Message, Modal, Spin, Switch } from '@arco-design/web-react';
import { Data, Delete, Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const bytes = (value: number): string => {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)) - 1, units.length - 1);
  return `${(value / 1024 ** (index + 1)).toFixed(value >= 1024 ** (index + 2) ? 1 : 0)} ${units[index]}`;
};

const categoryLabel = (category: StorageCenterCategoryId, t: (key: string) => string): string =>
  t(`storage.category.${category}`);

type StorageCenterProps = { isDesktop: boolean };

const StorageCenter: React.FC<StorageCenterProps> = ({ isDesktop }) => {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<StorageCenterSummary>();
  const [policy, setPolicy] = useState<StorageCenterPolicy>();
  const [preview, setPreview] = useState<StorageCenterCleanupPreview>();
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState<string>();
  const [modal, modalContextHolder] = Modal.useModal();

  const load = useCallback(async () => {
    if (!isDesktop) return;
    setLoading(true);
    setError(undefined);
    try {
      const [nextSummary, nextPolicy, nextPreview] = await Promise.all([
        ipcBridge.storageCenter.getSummary.invoke(),
        ipcBridge.storageCenter.getPolicy.invoke(),
        ipcBridge.storageCenter.previewCleanup.invoke(),
      ]);
      setSummary(nextSummary);
      setPolicy(nextPolicy);
      setPreview(nextPreview);
    } catch {
      setError(t('storage.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [isDesktop, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateAutomaticCleanup = useCallback(
    async (automaticCleanup: boolean) => {
      if (!policy) return;
      const nextPolicy = { ...policy, automaticCleanup };
      setPolicy(nextPolicy);
      try {
        setPolicy(await ipcBridge.storageCenter.updatePolicy.invoke({ policy: nextPolicy }));
      } catch {
        setPolicy(policy);
        Message.error(t('storage.errorPolicy'));
      }
    },
    [policy, t]
  );

  const reviewCleanup = useCallback(() => {
    if (!preview || preview.reclaimableBytes === 0) return;
    modal.confirm({
      title: t('storage.cleanupConfirmTitle'),
      content: t('storage.cleanupConfirmDescription', {
        bytes: bytes(preview.reclaimableBytes),
        count: preview.candidates.length,
      }),
      okText: t('storage.cleanupAction'),
      onOk: async () => {
        setCleaning(true);
        try {
          const result = await ipcBridge.storageCenter.runCleanup.invoke({ planId: preview.planId });
          Message.success(
            t('storage.cleanupSuccess', { bytes: bytes(result.reclaimedBytes), count: result.removedFiles })
          );
          await load();
        } catch {
          Message.error(t('storage.cleanupError'));
        } finally {
          setCleaning(false);
        }
      },
    });
  }, [load, modal, preview, t]);

  const categoryRows = useMemo(
    () =>
      summary?.categories.map((category) => ({
        ...category,
        label: categoryLabel(category.category, t),
      })) ?? [],
    [summary, t]
  );

  if (!isDesktop) return null;

  return (
    <SectionCard
      icon={<Data theme='outline' size={18} />}
      title={t('storage.title')}
      subtitle={t('storage.description')}
      extra={
        <Button
          type='text'
          size='mini'
          icon={<Refresh theme='outline' size={15} />}
          loading={loading}
          onClick={() => void load()}
        >
          {t('storage.refresh')}
        </Button>
      }
    >
      {modalContextHolder}
      {error && <Alert type='error' content={error} className='mb-12px' />}
      {loading && !summary ? (
        <div className='py-20px flex-center'>
          <Spin />
        </div>
      ) : (
        <div className='flex flex-col gap-12px'>
          <div className='flex items-center justify-between gap-12px'>
            <div>
              <div className='text-22px font-600 text-t-primary'>{bytes(summary?.totalBytes ?? 0)}</div>
              <div className='text-12px text-t-tertiary'>{t('storage.managedUsage')}</div>
            </div>
            <div className='flex items-center gap-8px'>
              <span className='text-12px text-t-secondary'>{t('storage.autoCleanup')}</span>
              <Switch
                checked={policy?.automaticCleanup ?? false}
                disabled={!policy}
                onChange={updateAutomaticCleanup}
              />
            </div>
          </div>

          <div className='flex flex-col divide-y divide-border-2'>
            {categoryRows.map((category) => (
              <div key={category.category} className='py-8px flex items-center justify-between gap-12px'>
                <div className='min-w-0'>
                  <div className='text-13px text-t-primary'>{category.label}</div>
                  <div className='text-11px text-t-tertiary'>
                    {category.files} · {t(`storage.state.${category.state}`)}
                  </div>
                </div>
                <span className='text-13px font-500 text-t-primary'>{bytes(category.bytes)}</span>
              </div>
            ))}
          </div>

          <Divider className='my-2px' />
          <div className='flex items-center justify-between gap-12px'>
            <div className='min-w-0'>
              <div className='text-13px text-t-primary'>{t('storage.previewTitle')}</div>
              <div className='text-12px text-t-tertiary'>
                {t('storage.previewDescription', {
                  bytes: bytes(preview?.reclaimableBytes ?? 0),
                  count: preview?.candidates.length ?? 0,
                })}
              </div>
            </div>
            <Button
              size='small'
              icon={<Delete theme='outline' size={15} />}
              loading={cleaning}
              disabled={!preview || preview.reclaimableBytes === 0}
              onClick={reviewCleanup}
            >
              {t('storage.reviewCleanup')}
            </Button>
          </div>
          <div className='text-11px text-t-tertiary'>{t('storage.protectionNotice')}</div>
        </div>
      )}
    </SectionCard>
  );
};

export default StorageCenter;
