import { Button, Form, Input, Message, Select, Typography } from '@arco-design/web-react';
import React from 'react';
import type { AccountClientContract, AccountSnapshot, ProfileInput } from '../../types';
import { useAccountI18n } from '../../i18n';
import styles from '../AccountPrototype.module.css';

export const ProfileScreen: React.FC<{
  client: AccountClientContract;
  snapshot: AccountSnapshot;
}> = ({ client, snapshot }) => {
  const { t } = useAccountI18n();
  const [form] = Form.useForm();

  const save = async (values: ProfileInput) => {
    const result = await client.updateProfile(values);
    if (result.ok) Message.success(t('successSaved'));
    else Message.error(t('errorInvalidInput'));
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>{t('profileTitle')}</h1>
        <p className={styles.heroSubtitle}>{t('profileDescription')}</p>
      </section>
      <section className={styles.panel}>
        <Form
          form={form}
          layout='vertical'
          initialValues={{
            displayName: snapshot.user?.displayName,
            locale: snapshot.user?.locale,
            timezone: snapshot.user?.timezone,
          }}
          onSubmit={(values) => void save(values)}
        >
          <div className={styles.formGrid}>
            <Form.Item field='displayName' label={t('displayName')} required>
              <Input />
            </Form.Item>
            <Form.Item label={t('email')}>
              <Input value={snapshot.user?.email} readOnly />
            </Form.Item>
            <Form.Item field='locale' label={t('locale')} required>
              <Select
                options={[
                  { label: t('languageVi'), value: 'vi-VN' },
                  { label: t('languageEn'), value: 'en-US' },
                ]}
              />
            </Form.Item>
            <Form.Item field='timezone' label={t('timezone')} required>
              <Input />
            </Form.Item>
          </div>
          <Button type='primary' htmlType='submit'>
            {t('saveChanges')}
          </Button>
        </Form>
      </section>
      <Typography.Text type='secondary'>{t('prototypeNotice')}</Typography.Text>
    </div>
  );
};
