import React, { useEffect, useMemo, useState } from 'react';
import type { AccountClientContract, AccountSnapshot } from '../types';
import { MockAccountClient, createBrowserAccountStorage } from '../core';
import { AccountI18nProvider } from '../i18n';
import { AccountWorkspace } from './AccountWorkspace';
import { AuthFlow } from './AuthFlow';
import styles from './AccountPrototype.module.css';

const defaultClient = (): AccountClientContract =>
  new MockAccountClient(typeof window === 'undefined' ? undefined : createBrowserAccountStorage());

const AccountPrototypeContent: React.FC<{ client: AccountClientContract }> = ({ client }) => {
  const [snapshot, setSnapshot] = useState<AccountSnapshot>(() => client.snapshot());

  useEffect(() => client.subscribe(setSnapshot), [client]);

  return (
    <div className={styles.shell}>
      {snapshot.authStatus === 'signedIn' ? (
        <AccountWorkspace client={client} snapshot={snapshot} />
      ) : (
        <AuthFlow client={client} />
      )}
    </div>
  );
};

export const AccountPrototypeApp: React.FC<{ client?: AccountClientContract }> = ({ client }) => {
  const resolvedClient = useMemo(() => client ?? defaultClient(), [client]);
  const initialLocale = resolvedClient.snapshot().user?.locale ?? 'vi-VN';
  return (
    <AccountI18nProvider initialLocale={initialLocale}>
      <AccountPrototypeContent client={resolvedClient} />
    </AccountI18nProvider>
  );
};
