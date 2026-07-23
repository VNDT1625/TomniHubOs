import { Alert, Button, Input, Message, Space, Switch, Typography } from '@arco-design/web-react';
import { Data, Delete, Download } from '@icon-park/react';
import React, { useState } from 'react';
import type { AccountClientContract, AccountSnapshot, SyncPreferences } from '../../types';
import { useAccountI18n } from '../../i18n';
import styles from '../AccountPrototype.module.css';

type SyncKey = Exclude<keyof SyncPreferences, 'enabled' | 'sourceCode'>;

export const DataPrivacyScreen: React.FC<{
  client: AccountClientContract;
  snapshot: AccountSnapshot;
}> = ({ client, snapshot }) => {
  const { t } = useAccountI18n();
  const [exported, setExported] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const update = (patch: Partial<SyncPreferences>) =>
    void client.updateSync({ ...snapshot.sync, ...patch, sourceCode: false });

  const exportData = async () => {
    const result = await client.exportData();
    if (result.ok) {
      setExported(result.value);
      Message.success(t('successExported'));
    }
  };

  const rows: Array<{ key: SyncKey; label: Parameters<typeof t>[0] }> = [
    { key: 'settings', label: 'syncSettings' },
    { key: 'automations', label: 'syncAutomations' },
    { key: 'accountProfile', label: 'syncProfile' },
    { key: 'workspaceMetadata', label: 'syncWorkspace' },
    { key: 'conversations', label: 'syncConversations' },
  ];

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>{t('privacyTitle')}</h1>
        <p className={styles.heroSubtitle}>{t('privacyDescription')}</p>
      </section>

      <section className={styles.panel}>
        <div className={styles.syncRow}>
          <Space>
            <Data />
            <Typography.Text bold>{t('masterSync')}</Typography.Text>
          </Space>
          <Switch checked={snapshot.sync.enabled} onChange={(enabled) => update({ enabled })} />
        </div>
        {rows.map((row) => (
          <div className={styles.syncRow} key={row.key}>
            <Typography.Text>{t(row.label)}</Typography.Text>
            <Switch
              checked={snapshot.sync[row.key]}
              disabled={!snapshot.sync.enabled}
              onChange={(value) => update({ [row.key]: value })}
            />
          </div>
        ))}
        <div className={styles.syncRow}>
          <div>
            <Typography.Text>{t('syncSourceCode')}</Typography.Text>
            <div>
              <Typography.Text type='secondary'>{t('neverUploaded')}</Typography.Text>
            </div>
          </div>
          <Switch checked={false} disabled />
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <Typography.Title heading={5}>{t('exportData')}</Typography.Title>
          <Button icon={<Download />} onClick={() => void exportData()}>
            {t('exportData')}
          </Button>
        </div>
        {exported ? <pre className={styles.codePreview}>{exported}</pre> : null}
      </section>

      <section className={`${styles.panel} ${styles.dangerPanel}`}>
        <Typography.Title heading={5}>{t('dangerZone')}</Typography.Title>
        <Alert type='warning' content={t('deleteConfirmation')} style={{ marginBottom: 16 }} />
        <Space>
          <Input value={confirmation} onChange={setConfirmation} />
          <Button status='danger' icon={<Delete />} onClick={() => void client.deleteAccount(confirmation)}>
            {t('deleteAccount')}
          </Button>
        </Space>
      </section>
    </div>
  );
};
