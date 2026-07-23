import { Button, Progress, Space, Tag, Typography } from '@arco-design/web-react';
import { CheckOne, Ticket } from '@icon-park/react';
import React from 'react';
import type { AccountClientContract, AccountPlanId, AccountSnapshot } from '../../types';
import { useAccountI18n } from '../../i18n';
import styles from '../AccountPrototype.module.css';

const plans: Array<{
  id: AccountPlanId;
  title: 'localPlan' | 'freePlan' | 'proPlan' | 'teamPlan';
  description: 'localPlanDescription' | 'freePlanDescription' | 'proPlanDescription' | 'teamPlanDescription';
}> = [
  { id: 'local', title: 'localPlan', description: 'localPlanDescription' },
  { id: 'free', title: 'freePlan', description: 'freePlanDescription' },
  { id: 'pro', title: 'proPlan', description: 'proPlanDescription' },
  { id: 'team', title: 'teamPlan', description: 'teamPlanDescription' },
];

export const SubscriptionScreen: React.FC<{
  client: AccountClientContract;
  snapshot: AccountSnapshot;
}> = ({ client, snapshot }) => {
  const { t, locale } = useAccountI18n();
  const percent = snapshot.subscription.creditsLimit
    ? Math.round((snapshot.subscription.creditsRemaining / snapshot.subscription.creditsLimit) * 100)
    : 0;

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>{t('subscriptionTitle')}</h1>
        <p className={styles.heroSubtitle}>{t('subscriptionDescription')}</p>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <Space>
            <Ticket />
            <div>
              <Typography.Text bold>
                {snapshot.subscription.creditsRemaining.toLocaleString(locale)} /{' '}
                {snapshot.subscription.creditsLimit.toLocaleString(locale)}
              </Typography.Text>
              <div>
                <Typography.Text type='secondary'>{t('credits')}</Typography.Text>
              </div>
            </div>
          </Space>
          {snapshot.subscription.renewsAt ? (
            <Tag>
              {t('renews', {
                date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(snapshot.subscription.renewsAt),
              })}
            </Tag>
          ) : null}
        </div>
        <Progress percent={percent} />
      </section>

      <div className={styles.planGrid}>
        {plans.map((plan) => {
          const current = plan.id === snapshot.subscription.planId;
          return (
            <section key={plan.id} className={`${styles.planCard} ${current ? styles.planCardCurrent : ''}`}>
              <div className={styles.panelHeader}>
                <Typography.Title heading={4}>{t(plan.title)}</Typography.Title>
                {current ? (
                  <Tag color='green' icon={<CheckOne />}>
                    {t('currentPlan')}
                  </Tag>
                ) : null}
              </div>
              <Typography.Paragraph type='secondary'>{t(plan.description)}</Typography.Paragraph>
              <div className={styles.planAction}>
                <Button
                  type={current ? 'secondary' : 'primary'}
                  long
                  disabled={current}
                  onClick={() => void client.changePlan(plan.id)}
                >
                  {current ? t('currentPlan') : t('choosePlan')}
                </Button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};
