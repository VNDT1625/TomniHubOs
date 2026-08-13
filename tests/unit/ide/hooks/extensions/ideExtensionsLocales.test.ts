import { describe, expect, it } from 'vitest';
import enUS from '@/renderer/services/i18n/locales/en-US/ide.json';
import jaJP from '@/renderer/services/i18n/locales/ja-JP/ide.json';
import koKR from '@/renderer/services/i18n/locales/ko-KR/ide.json';
import ruRU from '@/renderer/services/i18n/locales/ru-RU/ide.json';
import trTR from '@/renderer/services/i18n/locales/tr-TR/ide.json';
import ukUA from '@/renderer/services/i18n/locales/uk-UA/ide.json';
import viVN from '@/renderer/services/i18n/locales/vi-VN/ide.json';
import zhCN from '@/renderer/services/i18n/locales/zh-CN/ide.json';
import zhTW from '@/renderer/services/i18n/locales/zh-TW/ide.json';

const locales = {
  'en-US': enUS,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'ru-RU': ruRU,
  'tr-TR': trTR,
  'uk-UA': ukUA,
  'vi-VN': viVN,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
} as const;

const flatten = (value: Record<string, unknown>, prefix = ''): Map<string, string> => {
  const result = new Map<string, string>();
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') result.set(path, child);
    else if (child && typeof child === 'object' && !Array.isArray(child)) {
      for (const [nestedPath, nestedValue] of flatten(child as Record<string, unknown>, path)) {
        result.set(nestedPath, nestedValue);
      }
    }
  }
  return result;
};

describe('IDE Extensions locale resources', () => {
  const english = flatten(enUS.extensions);

  it.each(Object.entries(locales))('%s contains the complete extensions key set', (_locale, resource) => {
    expect([...flatten(resource.extensions).keys()].toSorted()).toEqual([...english.keys()].toSorted());
    expect(resource.extensions.activation.onOpen).toBeTruthy();
    expect(resource.extensions.activation.onStartup).toBeTruthy();
  });

  it.each(Object.entries(locales).filter(([locale]) => locale !== 'en-US'))(
    '%s is localized instead of cloning the English block',
    (_locale, resource) => {
      const translated = flatten(resource.extensions);
      const identicalValues = [...english].filter(([key, value]) => translated.get(key) === value);
      expect(identicalValues.map(([key]) => key)).toHaveLength(0);
    }
  );
});
