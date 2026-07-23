import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Message,
  Space,
  Tabs,
  Tag,
  Typography,
} from '@arco-design/web-react';
import { Cloudy, Lock, People, Shield } from '@icon-park/react';
import React, { useState } from 'react';
import type { AccountClientContract, AccountResult } from '../types';
import { useAccountI18n } from '../i18n';
import styles from './AccountPrototype.module.css';

type AuthMode = 'login' | 'register' | 'verify' | 'forgot' | 'reset';

const errorKey = (result: Extract<AccountResult, { ok: false }>) => {
  const map = {
    EMAIL_EXISTS: 'errorEmailExists',
    INVALID_EMAIL: 'errorInvalidEmail',
    WEAK_PASSWORD: 'errorWeakPassword',
    INVALID_CREDENTIALS: 'errorInvalidCredentials',
    ACCOUNT_LOCKED: 'errorLocked',
    EMAIL_NOT_VERIFIED: 'errorNotVerified',
    INVALID_VERIFICATION_CODE: 'errorInvalidCode',
    INVALID_RESET_TOKEN: 'errorInvalidReset',
    NOT_AUTHENTICATED: 'errorNotAuthenticated',
    NOT_FOUND: 'errorNotFound',
    CONFIRMATION_MISMATCH: 'errorConfirmation',
    INVALID_INPUT: 'errorInvalidInput',
  } as const;
  return map[result.code];
};

export const AuthFlow: React.FC<{ client: AccountClientContract }> = ({ client }) => {
  const { t } = useAccountI18n();
  const [mode, setMode] = useState<AuthMode>('login');
  const [busy, setBusy] = useState(false);
  const [prototypeCode, setPrototypeCode] = useState('');
  const [loginForm] = Form.useForm();
  const [registerForm] = Form.useForm();
  const [verifyForm] = Form.useForm();
  const [forgotForm] = Form.useForm();
  const [resetForm] = Form.useForm();

  const run = async (action: () => Promise<AccountResult>, success?: string) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      Message.error(t(errorKey(result)));
      return false;
    }
    if (success) Message.success(success);
    return true;
  };

  const submitLogin = async (values: { email: string; password: string; remember?: boolean }) => {
    await run(() =>
      client.login({
        email: values.email,
        password: values.password,
        remember: Boolean(values.remember),
      })
    );
  };

  const submitRegister = async (values: { email: string; password: string; displayName: string }) => {
    setBusy(true);
    const result = await client.register(values);
    setBusy(false);
    if (!result.ok) {
      Message.error(t(errorKey(result)));
      return;
    }
    setPrototypeCode(result.value.verificationCode);
    Message.success(t('successRegistered', { code: result.value.verificationCode }));
    setMode('verify');
  };

  const submitVerify = async (values: { code: string }) => {
    const ok = await run(() => client.verifyEmail(values.code), t('successVerified'));
    if (ok) setMode('login');
  };

  const submitForgot = async (values: { email: string }) => {
    setBusy(true);
    const result = await client.requestPasswordReset(values.email);
    setBusy(false);
    if (!result.ok) {
      Message.error(t(errorKey(result)));
      return;
    }
    setPrototypeCode(result.value.resetToken);
    Message.success(t('successResetToken', { token: result.value.resetToken }));
    setMode('reset');
  };

  const submitReset = async (values: { token: string; password: string }) => {
    const ok = await run(() => client.resetPassword(values.token, values.password), t('successPassword'));
    if (ok) setMode('login');
  };

  return (
    <div className={styles.authShell}>
      <section className={styles.authStory}>
        <div className={styles.brandMark}>
          <Shield theme='outline' size='20' />
          <Typography.Text bold>{t('brand')}</Typography.Text>
          <Tag color='arcoblue'>{t('prototypeBadge')}</Tag>
        </div>
        <div>
          <h1 className={styles.storyTitle}>{t('authWelcome')}</h1>
          <p className={styles.storyDescription}>{t('authDescription')}</p>
          <Space size='large'>
            <Tag icon={<Cloudy />}>{t('syncStatus')}</Tag>
            <Tag icon={<People />}>{t('navigationOrganization')}</Tag>
            <Tag icon={<Lock />}>{t('navigationSecurity')}</Tag>
          </Space>
        </div>
        <Alert type='info' content={t('prototypeNotice')} />
      </section>

      <main className={styles.authPanel}>
        <Card className={styles.authCard} bordered={false}>
          {mode === 'login' || mode === 'register' ? (
            <Tabs activeTab={mode} onChange={(key) => setMode(key as AuthMode)}>
              <Tabs.TabPane key='login' title={t('signIn')}>
                <Form form={loginForm} layout='vertical' onSubmit={(values) => void submitLogin(values)}>
                  <Form.Item field='email' label={t('email')} required>
                    <Input autoComplete='username' />
                  </Form.Item>
                  <Form.Item field='password' label={t('password')} required>
                    <Input.Password autoComplete='current-password' />
                  </Form.Item>
                  <Form.Item field='remember' triggerPropName='checked'>
                    <Checkbox>{t('remember')}</Checkbox>
                  </Form.Item>
                  <Space direction='vertical' style={{ width: '100%' }}>
                    <Button type='primary' htmlType='submit' long loading={busy}>
                      {t('signIn')}
                    </Button>
                    <Button long onClick={() => void client.loadDemoAccount()}>
                      {t('useDemo')}
                    </Button>
                    <Button type='text' long onClick={() => setMode('forgot')}>
                      {t('forgotPassword')}
                    </Button>
                  </Space>
                </Form>
              </Tabs.TabPane>
              <Tabs.TabPane key='register' title={t('signUp')}>
                <Form form={registerForm} layout='vertical' onSubmit={(values) => void submitRegister(values)}>
                  <Form.Item field='displayName' label={t('displayName')} required>
                    <Input />
                  </Form.Item>
                  <Form.Item field='email' label={t('email')} required>
                    <Input autoComplete='email' />
                  </Form.Item>
                  <Form.Item field='password' label={t('password')} required>
                    <Input.Password autoComplete='new-password' />
                  </Form.Item>
                  <Button type='primary' htmlType='submit' long loading={busy}>
                    {t('createAccount')}
                  </Button>
                </Form>
              </Tabs.TabPane>
            </Tabs>
          ) : null}

          {mode === 'verify' ? (
            <>
              <Typography.Title heading={4}>{t('verifyTitle')}</Typography.Title>
              <Typography.Paragraph type='secondary'>{t('verifyDescription')}</Typography.Paragraph>
              {prototypeCode ? <Alert type='success' content={prototypeCode} style={{ marginBottom: 16 }} /> : null}
              <Form form={verifyForm} layout='vertical' onSubmit={(values) => void submitVerify(values)}>
                <Form.Item field='code' label={t('verificationCode')} required>
                  <Input />
                </Form.Item>
                <Space direction='vertical' style={{ width: '100%' }}>
                  <Button type='primary' htmlType='submit' long loading={busy}>
                    {t('verify')}
                  </Button>
                  <Button long onClick={() => setMode('login')}>
                    {t('back')}
                  </Button>
                </Space>
              </Form>
            </>
          ) : null}

          {mode === 'forgot' ? (
            <>
              <Typography.Title heading={4}>{t('resetTitle')}</Typography.Title>
              <Form form={forgotForm} layout='vertical' onSubmit={(values) => void submitForgot(values)}>
                <Form.Item field='email' label={t('email')} required>
                  <Input />
                </Form.Item>
                <Space direction='vertical' style={{ width: '100%' }}>
                  <Button type='primary' htmlType='submit' long loading={busy}>
                    {t('sendReset')}
                  </Button>
                  <Button long onClick={() => setMode('login')}>
                    {t('back')}
                  </Button>
                </Space>
              </Form>
            </>
          ) : null}

          {mode === 'reset' ? (
            <>
              <Typography.Title heading={4}>{t('resetTitle')}</Typography.Title>
              {prototypeCode ? <Alert type='success' content={prototypeCode} style={{ marginBottom: 16 }} /> : null}
              <Form form={resetForm} layout='vertical' onSubmit={(values) => void submitReset(values)}>
                <Form.Item field='token' label={t('resetToken')} required>
                  <Input />
                </Form.Item>
                <Form.Item field='password' label={t('nextPassword')} required>
                  <Input.Password autoComplete='new-password' />
                </Form.Item>
                <Space direction='vertical' style={{ width: '100%' }}>
                  <Button type='primary' htmlType='submit' long loading={busy}>
                    {t('resetPassword')}
                  </Button>
                  <Button long onClick={() => setMode('login')}>
                    {t('back')}
                  </Button>
                </Space>
              </Form>
            </>
          ) : null}
        </Card>
      </main>
    </div>
  );
};
