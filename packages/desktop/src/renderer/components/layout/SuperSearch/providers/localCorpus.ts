/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LocalEntry } from './localProvider';

type Translate = (key: string) => string;

export type LocalCorpusInput = {
  t: Translate;
  conversations: ReadonlyArray<{ id: string; name?: string | null; modified_at?: number; created_at?: number }>;
  apps?: ReadonlyArray<{ id: string; name: string; description?: string }>;
};

/** Settings tabs in sidebar order, each with the existing tab label key and match synonyms. */
const SETTINGS_TABS = [
  { id: 'profile', labelKey: 'settings.tabProfile', keywords: 'profile account avatar tai khoan ho so' },
  { id: 'billing', labelKey: 'settings.tabBilling', keywords: 'billing usage credit wallet thanh toan tin dung' },
  { id: 'personal', labelKey: 'settings.tabPersonal', keywords: 'personal preferences ca nhan so thich' },
  { id: 'model', labelKey: 'settings.tabAiCore', keywords: 'model ai provider api key mo hinh' },
  { id: 'capabilities', labelKey: 'settings.tabCustomize', keywords: 'customize mcp skills tools ky nang cong cu' },
  { id: 'pipeline', labelKey: 'settings.tabPipeline', keywords: 'pipeline chat stage' },
  { id: 'aiconfig', labelKey: 'settings.tabAiConfig', keywords: 'ai configuration cau hinh' },
  { id: 'display', labelKey: 'settings.tabDisplay', keywords: 'display theme appearance giao dien hien thi' },
  { id: 'notification', labelKey: 'settings.tabNotification', keywords: 'notification alerts thong bao' },
  { id: 'webui', labelKey: 'settings.tabRemote', keywords: 'remote webui telegram dieu khien tu xa' },
  { id: 'resource', labelKey: 'settings.tabResource', keywords: 'resource ram cpu gpu tai nguyen' },
  { id: 'privacy', labelKey: 'settings.tabPrivacySecurity', keywords: 'privacy security permission bao mat quyen' },
  { id: 'system', labelKey: 'settings.tabSystem', keywords: 'system application update he thong ung dung' },
] as const;

type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

/** Individual settings reachable from the tabs. Titles reuse the labels the settings pages already show. */
const SETTINGS_DETAILS: ReadonlyArray<{ id: string; tab: SettingsTabId; titleKey: string; keywords: string }> = [
  {
    id: 'theme',
    tab: 'display',
    titleKey: 'common.superSearch.settings.theme',
    keywords: 'theme dark light mode color chu de mau sac sang toi',
  },
  {
    id: 'cssTheme',
    tab: 'display',
    titleKey: 'common.superSearch.settings.cssTheme',
    keywords: 'css custom skin tuy chinh',
  },
  {
    id: 'wallpaper',
    tab: 'display',
    titleKey: 'common.superSearch.settings.wallpaper',
    keywords: 'wallpaper background hinh nen',
  },
  {
    id: 'interfaceLanguage',
    tab: 'system',
    titleKey: 'common.superSearch.settings.interfaceLanguage',
    keywords: 'language locale ngon ngu tieng viet english',
  },
  {
    id: 'modelProviders',
    tab: 'model',
    titleKey: 'common.superSearch.settings.modelProviders',
    keywords: 'api key provider openai anthropic local model nha cung cap',
  },
  {
    id: 'mcpServers',
    tab: 'capabilities',
    titleKey: 'common.superSearch.settings.mcpServers',
    keywords: 'mcp server connector tool ket noi',
  },
  { id: 'skills', tab: 'capabilities', titleKey: 'common.superSearch.settings.skills', keywords: 'skill ky nang' },
  {
    id: 'webui',
    tab: 'webui',
    titleKey: 'common.superSearch.settings.webui',
    keywords: 'webui remote browser access truy cap tu xa',
  },
  {
    id: 'sandbox',
    tab: 'privacy',
    titleKey: 'settings.privacySecuritySettings.sandboxTitle',
    keywords: 'sandbox yolo approval phe duyet',
  },
  {
    id: 'secretMasking',
    tab: 'privacy',
    titleKey: 'settings.privacySecuritySettings.secretMaskingTitle',
    keywords: 'secret mask redact bi mat che',
  },
  {
    id: 'workspaceAccess',
    tab: 'privacy',
    titleKey: 'settings.privacySecuritySettings.workspaceAccessTitle',
    keywords: 'workspace folder access thu muc quyen truy cap',
  },
  {
    id: 'egress',
    tab: 'privacy',
    titleKey: 'settings.privacySecuritySettings.egressTitle',
    keywords: 'egress network domain allowlist mang ten mien',
  },
  {
    id: 'quietHours',
    tab: 'notification',
    titleKey: 'settings.notificationSettings.quietHoursTitle',
    keywords: 'quiet hours do not disturb gio yen lang',
  },
  {
    id: 'sound',
    tab: 'notification',
    titleKey: 'settings.notificationSettings.soundTitle',
    keywords: 'sound am thanh',
  },
  {
    id: 'focusMode',
    tab: 'notification',
    titleKey: 'settings.notificationSettings.focusModeTitle',
    keywords: 'focus mode tap trung',
  },
  {
    id: 'spendingCap',
    tab: 'billing',
    titleKey: 'settings.billingSettings.spendingCapTitle',
    keywords: 'spending limit cap budget han muc chi tieu',
  },
  {
    id: 'usage',
    tab: 'billing',
    titleKey: 'settings.billingSettings.usageTitle',
    keywords: 'usage history su dung lich su',
  },
  {
    id: 'responseLanguage',
    tab: 'personal',
    titleKey: 'settings.personalProfile.communication.title',
    keywords: 'tone verbosity language communication giong dieu ngon ngu tra loi',
  },
];

const PAGES = [
  { id: 'home', path: '/guid', titleKey: 'common.superSearch.local.page.home', keywords: 'home hub trang chu' },
  {
    id: 'history',
    path: '/history',
    titleKey: 'common.superSearch.local.page.history',
    keywords: 'history conversations lich su hoi thoai',
  },
  {
    id: 'scheduled',
    path: '/scheduled',
    titleKey: 'common.superSearch.local.page.scheduled',
    keywords: 'scheduled tasks cron lich hen',
  },
  {
    id: 'store',
    path: '/store',
    titleKey: 'common.superSearch.local.page.store',
    keywords: 'store packages apps cua hang goi',
  },
  {
    id: 'browser',
    path: '/browser',
    titleKey: 'common.superSearch.local.page.browser',
    keywords: 'browser web trinh duyet',
  },
  { id: 'ide', path: '/ide', titleKey: 'common.superSearch.local.page.ide', keywords: 'ide code editor lap trinh' },
  {
    id: 'company',
    path: '/company',
    titleKey: 'common.superSearch.local.page.company',
    keywords: 'company group chat agents cong ty',
  },
  { id: 'git', path: '/git', titleKey: 'common.superSearch.local.page.git', keywords: 'git repository repo kho ma' },
  {
    id: 'account',
    path: '/account',
    titleKey: 'common.superSearch.local.page.account',
    keywords: 'account profile tai khoan',
  },
  {
    id: 'settings',
    path: '/settings',
    titleKey: 'common.superSearch.local.page.settings',
    keywords: 'settings preferences cai dat tuy chon',
  },
] as const;

/** Builds every searchable in-app entry from live data (conversations, installed catalog) and the static indexes. */
export const buildLocalEntries = ({ t, conversations, apps = [] }: LocalCorpusInput): LocalEntry[] => {
  const tabLabel = (tab: SettingsTabId): string => {
    const found = SETTINGS_TABS.find((entry) => entry.id === tab);
    return found ? t(found.labelKey) : t('common.superSearch.local.settings');
  };
  const entries: LocalEntry[] = [];

  for (const page of PAGES) {
    entries.push({
      id: `page:${page.id}`,
      title: t(page.titleKey),
      subtitle: t('common.superSearch.local.pageSubtitle'),
      keywords: page.keywords,
      icon: 'page',
      action: { kind: 'route', path: page.path },
    });
  }
  for (const tab of SETTINGS_TABS) {
    entries.push({
      id: `settings:${tab.id}`,
      title: tabLabel(tab.id),
      subtitle: t('common.superSearch.local.settings'),
      keywords: tab.keywords,
      icon: 'setting',
      action: { kind: 'route', path: `/settings/${tab.id}` },
    });
  }
  for (const detail of SETTINGS_DETAILS) {
    entries.push({
      id: `settings:${detail.tab}:${detail.id}`,
      title: t(detail.titleKey),
      subtitle: `${t('common.superSearch.local.settings')} › ${tabLabel(detail.tab)}`,
      keywords: detail.keywords,
      icon: 'setting',
      action: { kind: 'route', path: `/settings/${detail.tab}` },
    });
  }
  for (const app of apps) {
    entries.push({
      id: `app:${app.id}`,
      title: app.name,
      subtitle: app.description,
      subtitleSearchable: true,
      keywords: app.id,
      icon: 'app',
      action: { kind: 'route', path: `/store/package/${encodeURIComponent(app.id)}` },
    });
  }
  for (const conversation of conversations) {
    entries.push({
      id: `conversation:${conversation.id}`,
      title: conversation.name?.trim() || t('common.superSearch.local.untitledConversation'),
      subtitle: new Date(conversation.modified_at ?? conversation.created_at ?? 0).toLocaleDateString(),
      keywords: '',
      icon: 'chat',
      action: { kind: 'route', path: `/conversation/${encodeURIComponent(conversation.id)}` },
    });
  }
  entries.push({
    id: 'action:restart',
    title: t('common.superSearch.local.restartApp'),
    subtitle: t('common.superSearch.local.actionSubtitle'),
    keywords: 'restart reload relaunch khoi dong lai',
    icon: 'action',
    action: { kind: 'command', command: 'restart-app' },
  });
  return entries;
};
