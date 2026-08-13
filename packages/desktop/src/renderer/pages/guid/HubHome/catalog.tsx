import {
  Book,
  Branch,
  BuildingTwo,
  Calendar,
  Code,
  Communication,
  Compass,
  DashboardOne,
  Earth,
  GraphicDesign,
  MusicOne,
  Terminal,
} from '@icon-park/react';

export type HubCategoryId = 'communication' | 'creative' | 'developer' | 'productivity';
export type HubAppId =
  | 'chat'
  | 'browser'
  | 'company'
  | 'studio'
  | 'music'
  | 'realtime'
  | 'ide'
  | 'terminal'
  | 'git'
  | 'manager'
  | 'automation'
  | 'knowledge';
export type HubTone = 'primary' | 'danger' | 'info' | 'success' | 'warning';

type HubIcon = typeof Communication;
type HubAppTranslationKey = `guid.hubHome.apps.${HubAppId}.${'title' | 'description'}`;
type HubCategoryTranslationKey = `guid.hubHome.categories.${HubCategoryId}.${'title' | 'description'}`;

export type HubAppDefinition = {
  id: HubAppId;
  category: HubCategoryId;
  labelKey: HubAppTranslationKey;
  descriptionKey: HubAppTranslationKey;
  path: string;
  packageId?: string;
  moduleId?: string;
  state?: Record<string, unknown>;
  Icon: HubIcon;
  tone: HubTone;
};

export type HubCategoryDefinition = {
  id: HubCategoryId;
  titleKey: HubCategoryTranslationKey;
  descriptionKey: HubCategoryTranslationKey;
  tone: HubTone;
  featured: boolean;
};

export const HUB_CATEGORIES: readonly HubCategoryDefinition[] = [
  {
    id: 'communication',
    titleKey: 'guid.hubHome.categories.communication.title',
    descriptionKey: 'guid.hubHome.categories.communication.description',
    tone: 'primary',
    featured: true,
  },
  {
    id: 'creative',
    titleKey: 'guid.hubHome.categories.creative.title',
    descriptionKey: 'guid.hubHome.categories.creative.description',
    tone: 'danger',
    featured: true,
  },
  {
    id: 'developer',
    titleKey: 'guid.hubHome.categories.developer.title',
    descriptionKey: 'guid.hubHome.categories.developer.description',
    tone: 'info',
    featured: true,
  },
  {
    id: 'productivity',
    titleKey: 'guid.hubHome.categories.productivity.title',
    descriptionKey: 'guid.hubHome.categories.productivity.description',
    tone: 'success',
    featured: false,
  },
];

export const HUB_APPS: readonly HubAppDefinition[] = [
  {
    id: 'chat',
    category: 'communication',
    labelKey: 'guid.hubHome.apps.chat.title',
    descriptionKey: 'guid.hubHome.apps.chat.description',
    path: '/guid',
    Icon: Communication,
    tone: 'primary',
  },
  {
    id: 'browser',
    category: 'communication',
    labelKey: 'guid.hubHome.apps.browser.title',
    descriptionKey: 'guid.hubHome.apps.browser.description',
    path: '/browser',
    Icon: Compass,
    tone: 'info',
  },
  {
    id: 'company',
    category: 'communication',
    labelKey: 'guid.hubHome.apps.company.title',
    descriptionKey: 'guid.hubHome.apps.company.description',
    path: '/company',
    Icon: BuildingTwo,
    tone: 'success',
  },
  {
    id: 'studio',
    category: 'creative',
    labelKey: 'guid.hubHome.apps.studio.title',
    descriptionKey: 'guid.hubHome.apps.studio.description',
    path: '/store/app/com.tomni.studio/studio',
    packageId: 'com.tomni.studio',
    moduleId: 'studio',
    Icon: GraphicDesign,
    tone: 'danger',
  },
  {
    id: 'music',
    category: 'creative',
    labelKey: 'guid.hubHome.apps.music.title',
    descriptionKey: 'guid.hubHome.apps.music.description',
    path: '/music',
    Icon: MusicOne,
    tone: 'primary',
  },
  {
    id: 'realtime',
    category: 'creative',
    labelKey: 'guid.hubHome.apps.realtime.title',
    descriptionKey: 'guid.hubHome.apps.realtime.description',
    path: '/realtime',
    Icon: Earth,
    tone: 'warning',
  },
  {
    id: 'ide',
    category: 'developer',
    labelKey: 'guid.hubHome.apps.ide.title',
    descriptionKey: 'guid.hubHome.apps.ide.description',
    path: '/store/app/com.tomni.ide/ide',
    packageId: 'com.tomni.ide',
    moduleId: 'ide',
    Icon: Code,
    tone: 'info',
  },
  {
    id: 'terminal',
    category: 'developer',
    labelKey: 'guid.hubHome.apps.terminal.title',
    descriptionKey: 'guid.hubHome.apps.terminal.description',
    path: '/terminal',
    Icon: Terminal,
    tone: 'primary',
  },
  {
    id: 'git',
    category: 'developer',
    labelKey: 'guid.hubHome.apps.git.title',
    descriptionKey: 'guid.hubHome.apps.git.description',
    path: '/git',
    Icon: Branch,
    tone: 'danger',
  },
  {
    id: 'manager',
    category: 'productivity',
    labelKey: 'guid.hubHome.apps.manager.title',
    descriptionKey: 'guid.hubHome.apps.manager.description',
    path: '/manager',
    Icon: DashboardOne,
    tone: 'primary',
  },
  {
    id: 'automation',
    category: 'productivity',
    labelKey: 'guid.hubHome.apps.automation.title',
    descriptionKey: 'guid.hubHome.apps.automation.description',
    path: '/scheduled',
    Icon: Calendar,
    tone: 'warning',
  },
  {
    id: 'knowledge',
    category: 'productivity',
    labelKey: 'guid.hubHome.apps.knowledge.title',
    descriptionKey: 'guid.hubHome.apps.knowledge.description',
    path: '/knowledge',
    Icon: Book,
    tone: 'success',
  },
];

export const HUB_QUICK_PROMPTS = [
  'guid.hubHome.quickPrompts.plan',
  'guid.hubHome.quickPrompts.analyze',
  'guid.hubHome.quickPrompts.write',
  'guid.hubHome.quickPrompts.build',
] as const;

const HUB_APP_ID_SET = new Set<HubAppId>(HUB_APPS.map((app) => app.id));

export const parseRecentHubApps = (rawValue: string | null): HubAppId[] => {
  if (!rawValue) return [];
  try {
    const value: unknown = JSON.parse(rawValue);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is HubAppId => typeof item === 'string' && HUB_APP_ID_SET.has(item as HubAppId));
  } catch {
    return [];
  }
};

export const addRecentHubApp = (recentApps: readonly HubAppId[], appId: HubAppId): HubAppId[] =>
  [appId, ...recentApps.filter((id) => id !== appId)].slice(0, 4);
