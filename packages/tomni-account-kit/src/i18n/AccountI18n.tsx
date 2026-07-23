import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { AccountLocale } from '../types';
import { accountMessages, type AccountMessageKey } from './dictionaries';

type TranslationValues = Record<string, string | number>;

type AccountI18nValue = {
  locale: AccountLocale;
  setLocale(locale: AccountLocale): void;
  t(key: AccountMessageKey, values?: TranslationValues): string;
};

const AccountI18nContext = createContext<AccountI18nValue | null>(null);

const interpolate = (template: string, values?: TranslationValues): string => {
  if (!values) return template;
  return template.replace(/{{(\w+)}}/g, (_match, key: string) => String(values[key] ?? ''));
};

export const AccountI18nProvider: React.FC<React.PropsWithChildren<{ initialLocale?: AccountLocale }>> = ({
  initialLocale = 'vi-VN',
  children,
}) => {
  const [locale, setLocale] = useState<AccountLocale>(initialLocale);
  const t = useCallback(
    (key: AccountMessageKey, values?: TranslationValues) => interpolate(accountMessages[locale][key], values),
    [locale]
  );
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);
  return <AccountI18nContext.Provider value={value}>{children}</AccountI18nContext.Provider>;
};

export const useAccountI18n = (): AccountI18nValue => {
  const value = useContext(AccountI18nContext);
  if (!value) throw new Error('useAccountI18n must be used inside AccountI18nProvider');
  return value;
};
