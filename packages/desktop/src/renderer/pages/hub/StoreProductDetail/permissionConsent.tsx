import type { PackageUpdatePermissionConsentChallenge } from '@/common/packages';
import { Alert, Modal, Tag } from '@arco-design/web-react';
import type { TFunction } from 'i18next';
import React from 'react';
import { packageClient } from '../packageClient';

const showPermissionUpdateConfirmation = (
  challenge: PackageUpdatePermissionConsentChallenge,
  t: TFunction
): Promise<boolean> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (approved: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(approved);
    };
    const permissionGroups = [
      { key: 'common.add', color: 'green', values: challenge.permissions.added },
      { key: 'common.remove', color: 'orange', values: challenge.permissions.removed },
      {
        key: 'common.edit',
        color: 'arcoblue',
        values: challenge.permissions.changed.map((change) => `${change.from} → ${change.to}`),
      },
    ].filter((group) => group.values.length > 0);

    Modal.confirm({
      title: `${t('guid.hubHome.storeDetail.update')} · ${t('guid.hubHome.storeDetail.permissions')}`,
      content: (
        <div className='flex flex-col gap-3 pt-1' data-testid='store-permission-update-consent'>
          <Alert type='warning' content={`${challenge.from.version} → ${challenge.to.version}`} />
          {permissionGroups.map((group) => (
            <div className='grid grid-cols-[minmax(72px,auto)_minmax(0,1fr)] items-start gap-2' key={group.key}>
              <strong className='pt-1 text-xs text-secondary'>{t(group.key)}</strong>
              <div className='flex min-w-0 flex-wrap gap-1.5'>
                {group.values.map((permission) => (
                  <Tag color={group.color} key={permission}>
                    {permission}
                  </Tag>
                ))}
              </div>
            </div>
          ))}
        </div>
      ),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      onOk: () => finish(true),
      onCancel: () => finish(false),
    });
  });

/**
 * Returns undefined when no extra approval is required, null when the user cancels,
 * or an owner-bound receipt for the exact permission delta.
 */
export const requestPackagePermissionUpdateConsent = async (
  packageId: string,
  t: TFunction
): Promise<string | undefined | null> => {
  const preparation = await packageClient.preparePermissionUpdate(packageId);
  if (!preparation.required) return undefined;
  if (!preparation.challenge) throw new Error('PACKAGE_PERMISSION_CONSENT_INVALID');
  if (!(await showPermissionUpdateConfirmation(preparation.challenge, t))) return null;
  const grant = await packageClient.approvePermissionUpdate(packageId, preparation.challenge.challengeId);
  return grant.receiptId;
};
