import FlexFullContainer from '@/renderer/components/layout/FlexFullContainer';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { isElectronDesktop, resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { type IExtensionSettingsTab } from '@/common/adapter/ipcBridge';
import { useExtI18n } from '@/renderer/hooks/system/useExtI18n';
import { useExtensionSettingsTabs } from '@/renderer/hooks/system/useExtensionSettingsTabs';
import {
  Brain,
  Communication,
  Computer,
  Dashboard,
  Earth,
  Info,
  Lightning,
  Lock,
  Puzzle,
  Remind,
  Robot,
  SettingConfig,
  Shield,
  User,
  Wallet,
} from '@icon-park/react';
import classNames from 'classnames';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Tooltip } from '@arco-design/web-react';
import { getSiderTooltipProps } from '@/renderer/utils/ui/siderTooltip';

/**
 * Builtin settings tab IDs in display order:
 * 1. ACCOUNT: profile, billing, personal
 * 2. AI: model, capabilities, pipeline, aiconfig
 * 3. GENERAL: display, notification, webui, resource, privacy, system
 * 4. OTHER: about
 */
export const BUILTIN_TAB_IDS = [
  // CỤM 1: ACCOUNT
  'profile',
  'billing',
  'personal',

  // CỤM 2: AI
  'model',
  'capabilities',
  'pipeline',
  'aiconfig',

  // CỤM 3: GENERAL
  'display',
  'notification',
  'webui',
  'resource',
  'privacy',
  'system',

  // CỤM 4: OTHER
  'about',
] as const;

/**
 * Legacy anchor IDs that have been merged into other tabs.
 */
export const LEGACY_ANCHOR_REMAP: Record<string, string> = {
  'skills-hub': 'capabilities',
  tools: 'capabilities',
  assistants: 'capabilities',
  agent: 'model',
};

/**
 * Group headers displayed above specific builtin tabs.
 */
const GROUP_HEADER_BEFORE: Record<string, string> = {
  profile: 'settings.groupAccount',
  model: 'settings.groupAiCore',
  display: 'settings.groupGeneral',
  about: 'settings.groupOther',
};

type SiderItem = {
  id: string;
  label: string;
  icon: React.ReactElement;
  isImageIcon?: boolean;
  path: string;
};

const SettingsSider: React.FC<{ collapsed?: boolean; tooltipEnabled?: boolean }> = ({
  collapsed = false,
  tooltipEnabled = false,
}) => {
  const layout = useLayoutContext();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const isDesktop = isElectronDesktop();

  const extensionTabs = useExtensionSettingsTabs();
  const { resolveExtTabName } = useExtI18n();

  const { menus, groupHeaderAt } = useMemo(() => {
    const builtinMap: Record<string, SiderItem> = {
      // 1. ACCOUNT
      profile: {
        id: 'profile',
        label: t('settings.tabProfile', { defaultValue: 'Profile' }),
        icon: <User theme='outline' size={16} />,
        path: 'profile',
      },
      billing: {
        id: 'billing',
        label: t('settings.tabBilling', { defaultValue: 'Billing & Usage' }),
        icon: <Wallet theme='outline' size={16} />,
        path: 'billing',
      },
      personal: {
        id: 'personal',
        label: t('settings.tabPersonal', { defaultValue: 'Personal' }),
        icon: <Lock theme='outline' size={16} />,
        path: 'personal',
      },

      // 2. AI
      model: {
        id: 'model',
        label: t('settings.tabAiCore', { defaultValue: 'AI Core' }),
        icon: <Brain theme='outline' size={16} />,
        path: 'model',
      },
      capabilities: {
        id: 'capabilities',
        label: t('settings.tabCustomize', { defaultValue: 'Customize' }),
        icon: <Lightning theme='outline' size={16} />,
        path: 'capabilities',
      },
      pipeline: {
        id: 'pipeline',
        label: t('settings.tabPipeline', { defaultValue: 'Pipeline Chat' }),
        icon: <Shield theme='outline' size={16} />,
        path: 'pipeline',
      },
      aiconfig: {
        id: 'aiconfig',
        label: t('settings.tabAiConfig', { defaultValue: 'AI Configuration' }),
        icon: <SettingConfig theme='outline' size={16} />,
        path: 'aiconfig',
      },

      // 3. GENERAL
      display: {
        id: 'display',
        label: t('settings.tabDisplay', { defaultValue: 'Display' }),
        icon: <Computer theme='outline' size={16} />,
        path: 'display',
      },
      notification: {
        id: 'notification',
        label: t('settings.tabNotification', { defaultValue: 'Notifications' }),
        icon: <Remind theme='outline' size={16} />,
        path: 'notification',
      },
      webui: {
        id: 'webui',
        label: t('settings.tabRemote', { defaultValue: 'Remote' }),
        icon: isDesktop ? <Earth theme='outline' size={16} /> : <Communication theme='outline' size={16} />,
        path: 'webui',
      },
      resource: {
        id: 'resource',
        label: t('settings.tabResource', { defaultValue: 'Resource' }),
        icon: <Dashboard theme='outline' size={16} />,
        path: 'resource',
      },
      privacy: {
        id: 'privacy',
        label: t('settings.tabPrivacySecurity', { defaultValue: 'Privacy & Security' }),
        icon: <Lock theme='outline' size={16} />,
        path: 'privacy',
      },
      system: {
        id: 'system',
        label: t('settings.tabSystem', { defaultValue: 'Application' }),
        icon: <SettingConfig theme='outline' size={16} />,
        path: 'system',
      },

      // 4. OTHER
      about: {
        id: 'about',
        label: t('settings.tabAbout', { defaultValue: 'About' }),
        icon: <Info theme='outline' size={16} />,
        path: 'about',
      },
    };

    const result: SiderItem[] = BUILTIN_TAB_IDS.map((id) => builtinMap[id]);

    const beforeMap = new Map<string, IExtensionSettingsTab[]>();
    const afterMap = new Map<string, IExtensionSettingsTab[]>();
    const unanchored: IExtensionSettingsTab[] = [];

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

    const toSiderItem = (tab: IExtensionSettingsTab): SiderItem => {
      const resolvedIcon = resolveExtensionAssetUrl(tab.icon) || tab.icon;
      return {
        id: tab.id,
        label: resolveExtTabName(tab),
        icon: resolvedIcon ? <img src={resolvedIcon} alt='' className='w-full h-full object-contain' /> : <Puzzle />,
        isImageIcon: Boolean(resolvedIcon),
        path: `ext/${tab.id}`,
      };
    };

    for (let i = result.length - 1; i >= 0; i--) {
      const builtinId = result[i].id;
      const afters = afterMap.get(builtinId);
      if (afters) {
        result.splice(i + 1, 0, ...afters.map(toSiderItem));
      }
      const befores = beforeMap.get(builtinId);
      if (befores) {
        result.splice(i, 0, ...befores.map(toSiderItem));
      }
    }

    if (unanchored.length > 0) {
      const systemIdx = result.findIndex((item) => item.id === 'system');
      const insertIdx = systemIdx >= 0 ? systemIdx : result.length;
      result.splice(insertIdx, 0, ...unanchored.map(toSiderItem));
    }

    const headerAt = new Map<number, string>();
    for (const [builtinId, headerKey] of Object.entries(GROUP_HEADER_BEFORE)) {
      const builtinIdx = result.findIndex((item) => item.id === builtinId);
      if (builtinIdx < 0) continue;
      const beforeCount = beforeMap.get(builtinId)?.length ?? 0;
      headerAt.set(builtinIdx - beforeCount, headerKey);
    }

    return { menus: result, groupHeaderAt: headerAt };
  }, [t, isDesktop, extensionTabs, resolveExtTabName]);

  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);
  return (
    <div
      className={classNames('h-full settings-sider flex flex-col gap-2px overflow-y-auto overflow-x-hidden', {
        'settings-sider--collapsed': collapsed,
      })}
    >
      {menus.map((item, index) => {
        const isSelected = pathname.includes(item.path);
        const groupHeaderKey = groupHeaderAt.get(index);
        const groupHeader =
          groupHeaderKey && !collapsed ? (
            <div className='settings-sider__group-header px-12px mt-12px mb-4px h-20px flex items-center text-11px font-[700] tracking-wider text-t-tertiary select-none uppercase opacity-80'>
              {t(groupHeaderKey, { defaultValue: groupHeaderKey })}
            </div>
          ) : null;
        return (
          <React.Fragment key={item.id}>
            {groupHeader}
            <Tooltip {...siderTooltipProps} content={item.label} position='right'>
              <div
                data-settings-id={item.id}
                data-settings-path={item.path}
                className={classNames(
                  'settings-sider__item h-34px rd-8px flex items-center gap-8px group cursor-pointer relative overflow-hidden shrink-0 conversation-item [&.conversation-item+&.conversation-item]:mt-2px transition-colors',
                  {
                    'settings-sider__item--active active': isSelected,
                    'settings-sider__item--collapsed': collapsed,
                    'px-8px': collapsed,
                    'px-12px': !collapsed,
                  }
                )}
                onClick={() => {
                  void navigate(`/settings/${item.path}`);
                }}
              >
                <div
                  className={classNames(
                    'w-16px h-16px shrink-0 flex items-center justify-center transition-colors',
                    isSelected
                      ? 'text-primary'
                      : 'text-t-secondary group-hover:text-t-primary group-hover:dark:text-t-primary'
                  )}
                >
                  {item.icon}
                </div>
                {!collapsed && (
                  <div className='flex items-center justify-between min-w-0 flex-1 pr-8px'>
                    <span
                      className={classNames(
                        'text-13px overflow-hidden text-ellipsis whitespace-nowrap leading-20px transition-colors',
                        isSelected
                          ? 'text-primary font-[500]'
                          : 'text-t-primary group-hover:text-t-primary group-hover:dark:text-t-primary'
                      )}
                    >
                      {item.label}
                    </span>
                  </div>
                )}
              </div>
            </Tooltip>
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default SettingsSider;
