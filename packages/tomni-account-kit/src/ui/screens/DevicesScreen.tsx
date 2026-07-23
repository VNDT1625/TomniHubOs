import { Button, Card, Input, Message, Space, Tag, Typography } from '@arco-design/web-react';
import { Devices } from '@icon-park/react';
import React, { useState } from 'react';
import type { AccountClientContract, AccountDevice, AccountSnapshot } from '../../types';
import { useAccountI18n } from '../../i18n';
import styles from '../AccountPrototype.module.css';

const DeviceCard: React.FC<{
  device: AccountDevice;
  client: AccountClientContract;
}> = ({ device, client }) => {
  const { t } = useAccountI18n();
  const [name, setName] = useState(device.name);

  const rename = async () => {
    const result = await client.renameDevice(device.id, name);
    if (result.ok) Message.success(t('successSaved'));
    else Message.error(t('errorInvalidInput'));
  };

  return (
    <Card className={styles.metricCard}>
      <div className={styles.panelHeader}>
        <Space>
          <Devices />
          <div>
            <Typography.Text bold>{device.name}</Typography.Text>
            <div>
              <Typography.Text type='secondary'>{device.platform}</Typography.Text>
            </div>
          </div>
        </Space>
        <Tag color={device.revokedAt ? 'red' : device.trusted ? 'green' : 'gray'}>
          {device.revokedAt ? t('revoked') : device.trusted ? t('trusted') : t('current')}
        </Tag>
      </div>
      <Space>
        <Input value={name} onChange={setName} disabled={Boolean(device.revokedAt)} />
        <Button onClick={() => void rename()} disabled={Boolean(device.revokedAt)}>
          {t('rename')}
        </Button>
        <Button
          status='danger'
          onClick={() => void client.revokeDevice(device.id)}
          disabled={Boolean(device.revokedAt)}
        >
          {t('revoke')}
        </Button>
      </Space>
    </Card>
  );
};

export const DevicesScreen: React.FC<{
  client: AccountClientContract;
  snapshot: AccountSnapshot;
}> = ({ client, snapshot }) => {
  const { t } = useAccountI18n();
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>{t('devicesTitle')}</h1>
        <p className={styles.heroSubtitle}>{t('devicesDescription')}</p>
      </section>
      <div className={styles.deviceGrid}>
        {snapshot.devices.map((device) => (
          <DeviceCard key={device.id} device={device} client={client} />
        ))}
      </div>
    </div>
  );
};
