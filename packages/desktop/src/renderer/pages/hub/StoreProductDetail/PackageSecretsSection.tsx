import { Button, Card } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SecretSetsPanel } from '@/renderer/pages/guid/HubHome/memory/SecretSetsPanel';
import { packageSecretAccess, packageSecretSets } from '@/renderer/services/secretSetsClient';
import { PackageSecretAccess } from './PackageSecretAccess';
import styles from './StoreProductDetail.module.css';

type PackageSecretsSectionProps = { packageId: string };

/**
 * An installed Package App's secret space: keys only it can use, older keys it can import, and the person's decision
 * about which general keys it may use. The same panel as the Hub rail, bound to the package.
 */
export const PackageSecretsSection: React.FC<PackageSecretsSectionProps> = ({ packageId }) => {
  const { t } = useTranslation();
  const sets = useMemo(() => packageSecretSets(packageId), [packageId]);
  const access = useMemo(() => packageSecretAccess(packageId), [packageId]);
  const [missing, setMissing] = useState<string[]>([]);
  const refresh = useCallback(async () => {
    const response = await window.electronAPI?.packageConnections?.list({ packageId });
    if (!response?.ok) {
      setMissing([]);
      return;
    }
    setMissing([
      ...new Set(
        response.data
          .filter((connection) => connection.status === 'needs-input')
          .flatMap((connection) => connection.requiredEnv ?? [])
      ),
    ]);
  }, [packageId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <Card className={styles.sectionCard} bordered data-testid='store-product-secrets'>
      {missing.length > 0 && (
        <section className='hub-secret-section' data-testid='package-required-environment'>
          <strong>{t('guid.hubHome.secrets.titlePackage')}</strong>
          <div className='hub-secret-key-row'>
            {missing.map((name) => (
              <code key={name}>{name}</code>
            ))}
          </div>
          <Button size='mini' type='text' onClick={() => void refresh()}>
            {t('guid.hubHome.secrets.refresh')}
          </Button>
        </section>
      )}
      <SecretSetsPanel api={sets} scope='package' active initialFields={missing} onChanged={() => void refresh()} />
      <PackageSecretAccess api={access} active />
    </Card>
  );
};
