import classNames from 'classnames';
import React from 'react';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { SettingsViewModeProvider } from '@/renderer/components/settings/SettingsModal/settingsViewContext';
import { isElectronDesktop, resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { type IExtensionSettingsTab } from '@/common/adapter/ipcBridge';
import { useExtensionSettingsTabs } from '@/renderer/hooks/system/useExtensionSettingsTabs';
import {
  Brain,
  Communication,
  Computer,
  Dashboard,
  Earth,
  Equalizer,
  Info,
  Lightning,
  Lock,
  PersonalPrivacy,
  Puzzle,
  Remind,
  SettingConfig,
  Shield,
  User,
  Wallet,
} from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useExtI18n } from '@/renderer/hooks/system/useExtI18n';
import { BUILTIN_TAB_IDS, LEGACY_ANCHOR_REMAP } from './SettingsSider';
import './settings.css';

interface SettingsPageWrapperProps {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

type NavItem = { label: string; icon: React.ReactElement; path: string; id: string };

type TranslateFn = (key: string, options?: { defaultValue?: string }) => string;

const GROUP_HEADER_BEFORE: Record<string, string> = {
  profile: 'settings.groupAccount',
  model: 'settings.groupAiCore',
  display: 'settings.groupGeneral',
  about: 'settings.groupOther',
};

export function getBuiltinSettingsNavItems(isDesktop: boolean, t: TranslateFn): NavItem[] {
  const builtinMap: Record<string, NavItem> = {
    profile: {
      id: 'profile',
      label: t('settings.tabProfile', { defaultValue: 'Profile' }),
      icon: <User theme='outline' size='16' />,
      path: 'profile',
    },
    billing: {
      id: 'billing',
      label: t('settings.tabBilling', { defaultValue: 'Billing & Usage' }),
      icon: <Wallet theme='outline' size='16' />,
      path: 'billing',
    },
    personal: {
      id: 'personal',
      label: t('settings.tabPersonal', { defaultValue: 'Personal' }),
      icon: <PersonalPrivacy theme='outline' size='16' />,
      path: 'personal',
    },

    model: {
      id: 'model',
      label: t('settings.tabAiCore', { defaultValue: 'AI Core' }),
      icon: <Brain theme='outline' size='16' />,
      path: 'model',
    },
    capabilities: {
      id: 'capabilities',
      label: t('settings.tabCustomize', { defaultValue: 'Customize' }),
      icon: <Lightning theme='outline' size='16' />,
      path: 'capabilities',
    },
    pipeline: {
      id: 'pipeline',
      label: t('settings.tabPipeline', { defaultValue: 'Pipeline Chat' }),
      icon: <Shield theme='outline' size='16' />,
      path: 'pipeline',
    },
    aiconfig: {
      id: 'aiconfig',
      label: t('settings.tabAiConfig', { defaultValue: 'AI Configuration' }),
      icon: <Equalizer theme='outline' size='16' />,
      path: 'aiconfig',
    },

    display: {
      id: 'display',
      label: t('settings.tabDisplay', { defaultValue: 'Display' }),
      icon: <Computer theme='outline' size='16' />,
      path: 'display',
    },
    notification: {
      id: 'notification',
      label: t('settings.tabNotification', { defaultValue: 'Notifications' }),
      icon: <Remind theme='outline' size='16' />,
      path: 'notification',
    },
    webui: {
      id: 'webui',
      label: t('settings.tabRemote', { defaultValue: 'Remote' }),
      icon: isDesktop ? <Earth theme='outline' size='16' /> : <Communication theme='outline' size='16' />,
      path: 'webui',
    },
    resource: {
      id: 'resource',
      label: t('settings.tabResource', { defaultValue: 'Resource' }),
      icon: <Dashboard theme='outline' size='16' />,
      path: 'resource',
    },
    privacy: {
      id: 'privacy',
      label: t('settings.tabPrivacySecurity', { defaultValue: 'Privacy & Security' }),
      icon: <Lock theme='outline' size='16' />,
      path: 'privacy',
    },
    system: {
      id: 'system',
      label: t('settings.tabSystem', { defaultValue: 'Application' }),
      icon: <SettingConfig theme='outline' size='16' />,
      path: 'system',
    },

    about: {
      id: 'about',
      label: t('settings.tabAbout', { defaultValue: 'About' }),
      icon: <Info theme='outline' size='16' />,
      path: 'about',
    },
  };

  return BUILTIN_TAB_IDS.map((id) => builtinMap[id]);
}

const SettingsPageWrapper: React.FC<SettingsPageWrapperProps> = ({ children, className, contentClassName }) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const isDesktop = isElectronDesktop();

  const extensionTabs = useExtensionSettingsTabs();
  const { resolveExtTabName } = useExtI18n();

  const menuItems = React.useMemo(() => {
    const builtins = getBuiltinSettingsNavItems(isDesktop, t);

    const result = [...builtins];
    const unanchored: IExtensionSettingsTab[] = [];
    const beforeMap = new Map<string, IExtensionSettingsTab[]>();
    const afterMap = new Map<string, IExtensionSettingsTab[]>();

    for (const tab of extensionTabs) {
      if (!tab.position) {
        unanchored.push(tab);
        continue;
      }
      const { relativeTo: rawAnchor, placement } = tab.position;
      const anchor = LEGACY_ANCHOR_REMAP[rawAnchor] ?? rawAnchor;
      if (!result.some((item) => item.id === anchor)) {
        unanchored.push(tab);
        continue;
      }
      const map = placement === 'before' ? beforeMap : afterMap;
      let list = map.get(anchor);
      if (!list) {
        list = [];
        map.set(anchor, list);
      }
      list.push(tab);
    }

    const toNavItem = (tab: IExtensionSettingsTab): NavItem => {
      const resolvedIcon = resolveExtensionAssetUrl(tab.icon) || tab.icon;
      return {
        id: tab.id,
        label: resolveExtTabName(tab),
        icon: resolvedIcon ? (
          <img src={resolvedIcon} alt='' className='w-16px h-16px object-contain' />
        ) : (
          <Puzzle theme='outline' size='16' />
        ),
        path: `ext/${tab.id}`,
      };
    };

    for (let i = result.length - 1; i >= 0; i--) {
      const id = result[i].id;
      const afters = afterMap.get(id);
      if (afters) result.splice(i + 1, 0, ...afters.map(toNavItem));
      const befores = beforeMap.get(id);
      if (befores) result.splice(i, 0, ...befores.map(toNavItem));
    }

    if (unanchored.length > 0) {
      const sysIdx = result.findIndex((item) => item.id === 'system');
      const idx = sysIdx >= 0 ? sysIdx : result.length;
      result.splice(idx, 0, ...unanchored.map(toNavItem));
    }

    return result;
  }, [isDesktop, t, extensionTabs, resolveExtTabName]);

  const groupHeaderAt = React.useMemo(() => {
    const headers = new Map<number, string>();
    for (const [itemId, headerKey] of Object.entries(GROUP_HEADER_BEFORE)) {
      const itemIndex = menuItems.findIndex((item) => item.id === itemId);
      if (itemIndex >= 0) headers.set(itemIndex, headerKey);
    }
    return headers;
  }, [menuItems]);

  const currentItem = menuItems.find((item) => pathname.includes(`/settings/${item.path}`)) ?? menuItems[0];

  const containerClass = classNames(
    'settings-page-wrapper w-full min-h-full box-border overflow-y-auto',
    isMobile ? 'px-16px py-14px' : 'px-12px md:px-40px py-32px',
    className
  );

  const contentClass = classNames('settings-page-content mx-auto w-full md:max-w-1024px', contentClassName);

  return (
    <SettingsViewModeProvider value='page'>
      <div className={containerClass}>
        <header className='settings-page-header'>
          <div>
            <p className='settings-page-header__eyebrow'>{t('common.settings', { defaultValue: 'Settings' })}</p>
            <h1 className='settings-page-header__title'>{currentItem?.label}</h1>
          </div>
          <label className='settings-page-picker'>
            <span className='sr-only'>{t('common.settings', { defaultValue: 'Settings' })}</span>
            <select
              value={currentItem?.path ?? ''}
              onChange={(event) => void navigate(`/settings/${event.target.value}`, { replace: true })}
            >
              {menuItems.map((item) => (
                <option key={item.path} value={item.path}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </header>
        <div className='settings-page-layout'>
          <nav className='settings-page-nav' aria-label={t('common.settings', { defaultValue: 'Settings' })}>
            {menuItems.map((item, index) => {
              const active = pathname.includes(`/settings/${item.path}`);
              const groupHeaderKey = groupHeaderAt.get(index);
              return (
                <React.Fragment key={item.path}>
                  {groupHeaderKey ? (
                    <div className='settings-page-nav__group'>
                      {t(groupHeaderKey, { defaultValue: groupHeaderKey })}
                    </div>
                  ) : null}
                  <button
                    type='button'
                    className={classNames('settings-page-nav__item', { 'settings-page-nav__item--active': active })}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => void navigate(`/settings/${item.path}`, { replace: true })}
                  >
                    <span className='settings-page-nav__icon'>{item.icon}</span>
                    <span className='settings-page-nav__label'>{item.label}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </nav>
          <div className={contentClass}>{children}</div>
        </div>
      </div>
    </SettingsViewModeProvider>
  );
};

export default SettingsPageWrapper;
