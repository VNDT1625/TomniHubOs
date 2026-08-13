import { Button, Form, Input, List, Message, Select, Space, Tag, Typography } from '@arco-design/web-react';
import { People } from '@icon-park/react';
import React from 'react';
import type { AccountClientContract, AccountSnapshot, OrganizationMember } from '../../types';
import { useAccountI18n } from '../../i18n';
import styles from '../AccountPrototype.module.css';

export const OrganizationScreen: React.FC<{
  client: AccountClientContract;
  snapshot: AccountSnapshot;
}> = ({ client, snapshot }) => {
  const { t } = useAccountI18n();
  const [createForm] = Form.useForm();
  const [inviteForm] = Form.useForm();

  const create = async (values: { name: string }) => {
    const result = await client.createOrganization(values.name);
    if (result.ok) Message.success(t('successSaved'));
    else Message.error(t('errorInvalidInput'));
  };

  const invite = async (values: { email: string; role: OrganizationMember['role'] }) => {
    const result = await client.inviteOrganizationMember(values.email, values.role);
    if (result.ok) Message.success(t('successSaved'));
    else Message.error(t('errorInvalidInput'));
    if (result.ok) inviteForm.resetFields();
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>{t('organizationTitle')}</h1>
        <p className={styles.heroSubtitle}>{t('organizationDescription')}</p>
      </section>

      {!snapshot.organization ? (
        <section className={styles.panel}>
          <Typography.Paragraph type='secondary'>{t('emptyOrganization')}</Typography.Paragraph>
          <Form form={createForm} layout='inline' onSubmit={(values) => void create(values)}>
            <Form.Item field='name' required>
              <Input placeholder={t('organizationName')} />
            </Form.Item>
            <Button type='primary' htmlType='submit'>
              {t('createOrganization')}
            </Button>
          </Form>
        </section>
      ) : (
        <div className={styles.splitGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <Space>
                <People />
                <div>
                  <Typography.Title heading={4}>{snapshot.organization.name}</Typography.Title>
                  <Typography.Text type='secondary'>{snapshot.organization.slug}</Typography.Text>
                </div>
              </Space>
            </div>
            <List
              dataSource={snapshot.organization.members}
              render={(member) => (
                <List.Item key={member.id}>
                  <List.Item.Meta title={member.displayName} description={member.email} />
                  <Space>
                    <Tag>{t(member.role)}</Tag>
                    {member.status === 'invited' ? <Tag color='orange'>{t('invited')}</Tag> : null}
                  </Space>
                </List.Item>
              )}
            />
          </section>

          <section className={styles.panel}>
            <Typography.Title heading={5}>{t('inviteMember')}</Typography.Title>
            <Form form={inviteForm} layout='vertical' onSubmit={(values) => void invite(values)}>
              <Form.Item field='email' label={t('memberEmail')} required>
                <Input />
              </Form.Item>
              <Form.Item field='role' label={t('role')} initialValue='member' required>
                <Select
                  options={[
                    { label: t('admin'), value: 'admin' },
                    { label: t('member'), value: 'member' },
                  ]}
                />
              </Form.Item>
              <Button type='primary' htmlType='submit'>
                {t('inviteMember')}
              </Button>
            </Form>
          </section>
        </div>
      )}
    </div>
  );
};
