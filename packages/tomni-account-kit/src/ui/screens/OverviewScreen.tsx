import { Card, Progress, Space, Statistic, Tag, Timeline, Typography } from '@arco-design/web-react';
import { CheckOne, Cloudy, Devices, Lock, Ticket } from '@icon-park/react';
import React from 'react';
import type { AccountSnapshot } from '../../types';
import { useAccountI18n } from '../../i18n';
import styles from '../AccountPrototype.module.css';

const auditMessageKeys = {
  'account.created': 'auditAccountCreated',
  'email.verified': 'auditEmailVerified',
  'session.created': 'auditSessionCreated',
  'session.revoked': 'auditSessionRevoked',
  'device.revoked': 'auditDeviceRevoked',
  'password.changed': 'auditPasswordChanged',
  'profile.updated': 'auditProfileUpdated',
  'subscription.changed': 'auditSubscriptionChanged',
  'sync.updated': 'auditSyncUpdated',
  'organization.updated': 'auditOrganizationUpdated',
  'data.exported': 'auditDataExported',
} as const;

export const OverviewScreen: React.FC<{ snapshot: AccountSnapshot }> = ({ snapshot }) => {
  const { t, locale } = useAccountI18n();
  const creditsPercent = snapshot.subscription.creditsLimit
    ? Math.round((snapshot.subscription.creditsRemaining / snapshot.subscription.creditsLimit) * 100)
    : 0;

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <Tag color='arcoblue' icon={<CheckOne />}>
          {t('prototypeBadge')}
        </Tag>
        <h1 className={styles.heroTitle}>
          {t('overviewGreeting', { name: snapshot.user?.displayName ?? t('brand') })}
        </h1>
        <p className={styles.heroSubtitle}>{t('overviewSubtitle')}</p>
      </section>

      <div className={styles.metricGrid}>
        <Card className={styles.metricCard}>
          <Space>
            <Ticket />
            <Typography.Text type='secondary'>{t('plan')}</Typography.Text>
          </Space>
          <div className={styles.metricValue}>{snapshot.subscription.planId.toUpperCase()}</div>
        </Card>
        <Card className={styles.metricCard}>
          <Space>
            <Cloudy />
            <Typography.Text type='secondary'>{t('credits')}</Typography.Text>
          </Space>
          <Statistic value={snapshot.subscription.creditsRemaining} countUp className={styles.metricValue} />
          <Progress percent={creditsPercent} size='small' showText={false} />
        </Card>
        <Card className={styles.metricCard}>
          <Space>
            <Devices />
            <Typography.Text type='secondary'>{t('activeDevices')}</Typography.Text>
          </Space>
          <div className={styles.metricValue}>{snapshot.devices.filter((device) => !device.revokedAt).length}</div>
        </Card>
        <Card className={styles.metricCard}>
          <Space>
            <Lock />
            <Typography.Text type='secondary'>{t('activeSessions')}</Typography.Text>
          </Space>
          <div className={styles.metricValue}>{snapshot.sessions.length}</div>
        </Card>
      </div>

      <div className={styles.splitGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <Typography.Title heading={5}>{t('recentActivity')}</Typography.Title>
          </div>
          {snapshot.audit.length ? (
            <Timeline>
              {snapshot.audit.slice(0, 6).map((event) => (
                <Timeline.Item
                  key={event.id}
                  label={new Intl.DateTimeFormat(locale, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(event.createdAt)}
                >
                  {t(auditMessageKeys[event.type])}
                </Timeline.Item>
              ))}
            </Timeline>
          ) : (
            <Typography.Text type='secondary'>{t('emptyActivity')}</Typography.Text>
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <Typography.Title heading={5}>{t('securityScore')}</Typography.Title>
              <Typography.Text type='secondary'>{t('securityAdvice')}</Typography.Text>
            </div>
            <Tag color='green' icon={<CheckOne />}>
              {t('securityGood')}
            </Tag>
          </div>
          <Progress type='circle' percent={88} />
          <div style={{ marginTop: 20 }}>
            <Space>
              <Cloudy />
              <Typography.Text>{t('syncStatus')}</Typography.Text>
              <Tag color={snapshot.sync.enabled ? 'green' : 'gray'}>
                {snapshot.sync.enabled ? t('enabled') : t('disabled')}
              </Tag>
            </Space>
          </div>
        </section>
      </div>
    </div>
  );
};
