import { Button, Form, Input, List, Message, Space, Tag, Typography } from '@arco-design/web-react';
import { Computer, Lock } from '@icon-park/react';
import React from 'react';
import type { AccountClientContract, AccountSnapshot } from '../../types';
import { useAccountI18n } from '../../i18n';
import styles from '../AccountPrototype.module.css';

export const SecurityScreen: React.FC<{
  client: AccountClientContract;
  snapshot: AccountSnapshot;
}> = ({ client, snapshot }) => {
  const { t, locale } = useAccountI18n();
  const [form] = Form.useForm();

  const change = async (values: { currentPassword: string; nextPassword: string }) => {
    const result = await client.changePassword(values.currentPassword, values.nextPassword);
    if (result.ok) {
      Message.success(t('successPassword'));
      form.resetFields();
    } else {
      Message.error(result.code === 'WEAK_PASSWORD' ? t('errorWeakPassword') : t('errorInvalidCredentials'));
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>{t('securityTitle')}</h1>
        <p className={styles.heroSubtitle}>{t('securityDescription')}</p>
      </section>
      <div className={styles.splitGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <Space>
              <Lock />
              <Typography.Title heading={5}>{t('changePassword')}</Typography.Title>
            </Space>
          </div>
          <Form form={form} layout='vertical' onSubmit={(values) => void change(values)}>
            <Form.Item field='currentPassword' label={t('currentPassword')} required>
              <Input.Password />
            </Form.Item>
            <Form.Item field='nextPassword' label={t('nextPassword')} required>
              <Input.Password />
            </Form.Item>
            <Button type='primary' htmlType='submit'>
              {t('changePassword')}
            </Button>
          </Form>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <Typography.Title heading={5}>{t('sessions')}</Typography.Title>
          </div>
          <List
            dataSource={snapshot.sessions}
            render={(session) => (
              <List.Item
                key={session.id}
                actions={[
                  <Button
                    key='revoke'
                    type='text'
                    status='danger'
                    onClick={() => void client.revokeSession(session.id)}
                  >
                    {t('revoke')}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={<Computer />}
                  title={
                    <Space>
                      {session.label}
                      {session.current ? <Tag color='green'>{t('current')}</Tag> : null}
                    </Space>
                  }
                  description={t('lastActive', {
                    time: new Intl.DateTimeFormat(locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(session.lastActiveAt),
                  })}
                />
              </List.Item>
            )}
          />
        </section>
      </div>
    </div>
  );
};
