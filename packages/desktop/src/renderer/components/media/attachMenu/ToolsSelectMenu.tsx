/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IConversationMcpStatus, IMcpServer } from '@/common/config/storage';
import { SkillDocumentModal } from '@/renderer/components/skills/SkillDocumentModal';
import { iconColors } from '@/renderer/styles/colors';
import { Button, Checkbox, Trigger } from '@arco-design/web-react';
import { Down, Left, Lightning, Link, Right, Shield, UploadOne } from '@icon-park/react';
import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { AutoSelectRow } from './AutoSelectRow';
import { HookMenuList, useActiveHookRows } from './HookColumn';
import { useEnableInstalledPlugin, useInstalledPlugins } from './useInstalledPlugins';
import { MenuItem } from './AttachMenuItem';
import { PluginGroup } from './PluginGroup';
import {
  ATTACH_MENU_TRIGGER,
  buildAttachMenuModel,
  groupCheckState,
  packageIdOfMcp,
  pendingPluginEntries,
  type AttachCategory,
  type AttachMcpEntry,
  type AttachPackageGroup,
  type AttachSkillEntry,
  type SkillViewerTarget,
} from './attachMenuModel';
import {
  ATTACH_MENU_MAX_WIDTH,
  computeAttachMenuPlacement,
  readAttachMenuArea,
  type AttachMenuLayout,
  type AttachMenuPlacement,
} from './attachMenuPlacement';

type SkillToggleItem = { name: string; description: string; isAuto: boolean };

export type ToolsSelectMenuProps = {
  /** Trigger element (a button). The menu opens on click, upward, from this element. */
  children: React.ReactElement;
  allSkills: SkillToggleItem[];
  disabledBuiltinSkills: string[];
  enabledSkills: string[];
  onToggleSkill: (name: string, isAuto: boolean) => void;
  mcpServers: IMcpServer[];
  selectedMcpServerIds: string[];
  onToggleMcpServer: (serverId: string) => void;
  onAddFiles: () => void;
  /** Only passed where the browser file picker is used (WebUI). */
  onMyDevice?: () => void;
  /** Auto mode: when true the manual lists are hidden. The switch row renders only when the toggle is provided. */
  autoSelect?: boolean;
  onToggleAutoSelect?: () => void;
  onVisibleChange?: (visible: boolean) => void;
};

type PanelProps = Omit<ToolsSelectMenuProps, 'children' | 'onVisibleChange'> & {
  category: AttachCategory | undefined;
  /** Popup layout chosen from the free area when the menu opened. */
  layout: AttachMenuLayout;
  maxWidth: number;
  /** Clears the category (undefined) or selects one. Stacked layout uses undefined for the back button. */
  onCategory: (category: AttachCategory | undefined) => void;
  onDone: () => void;
  onView: (target: SkillViewerTarget) => void;
};

type ToggleItem = { checked: boolean; toggle: () => void };

type AnchorClickProps = { onClick?: (event: React.MouseEvent<HTMLElement>) => void };

/**
 * A selectable row: clicking the row or its checkbox toggles it exactly once. A description (skills) sits on its own
 * line under the name; the name is one line with an ellipsis and its full text in the tooltip.
 */
const ToggleRow: React.FC<{
  checked: boolean;
  indeterminate?: boolean;
  label: React.ReactNode;
  description?: string;
  tag?: string;
  className?: string;
  testId: string;
  onToggle: () => void;
}> = ({ checked, indeterminate = false, label, description, tag, className = '', testId, onToggle }) => {
  const control = (
    <Checkbox
      className='attach-menu__check'
      checked={checked}
      indeterminate={indeterminate}
      onClick={(event: React.MouseEvent) => event.stopPropagation()}
      onChange={onToggle}
    >
      <span className='attach-menu__label text-13px' title={typeof label === 'string' ? label : undefined}>
        {label}
      </span>
    </Checkbox>
  );
  return (
    <div className={`attach-menu__item ${className}`.trim()} onClick={onToggle} data-testid={testId}>
      <div className='flex items-center gap-10px px-12px py-9px min-w-0'>
        {description ? (
          <div className='flex flex-col min-w-0 flex-1'>
            {control}
            <span className='attach-menu__desc'>{description}</span>
          </div>
        ) : (
          control
        )}
        {tag ? <span className='attach-menu__tag'>{tag}</span> : null}
      </div>
    </div>
  );
};

/** Sets every item to one state: all on when any is off, otherwise all off. Each toggle is one callback call. */
const toggleAllItems = (items: ReadonlyArray<ToggleItem>): void => {
  const target = !items.every((item) => item.checked);
  for (const item of items) if (item.checked !== target) item.toggle();
};

const ToolsSelectPanel: React.FC<PanelProps> = ({
  allSkills,
  disabledBuiltinSkills,
  enabledSkills,
  onToggleSkill,
  mcpServers,
  selectedMcpServerIds,
  onToggleMcpServer,
  onAddFiles,
  onMyDevice,
  autoSelect = false,
  onToggleAutoSelect,
  category,
  onCategory,
  onDone,
  onView,
  layout,
  maxWidth,
}) => {
  const { t } = useTranslation();
  const [collapsedPackages, setCollapsedPackages] = useState<ReadonlySet<string>>(() => new Set());

  const { data: skillIndex } = useSWR(allSkills.length > 0 ? 'skills-index' : null, () =>
    ipcBridge.fs.listAvailableSkills.invoke()
  );
  const { data: packageRows } = useSWR('attach-menu-packages', () => ipcBridge.packagePlatform.list.invoke(undefined));

  const skillByName = new Map((skillIndex ?? []).map((skill) => [skill.name, skill] as const));
  const packageNames = new Map((packageRows ?? []).map((row) => [row.manifest.id, row.manifest.name] as const));
  const skillOf = new Map(allSkills.map((skill) => [skill.name, skill] as const));
  const serverById = new Map(mcpServers.map((server) => [server.id, server] as const));

  const isSkillChecked = (skill: { name: string; isAuto: boolean }): boolean =>
    skill.isAuto ? !disabledBuiltinSkills.includes(skill.name) : enabledSkills.includes(skill.name);
  const isMcpChecked = (serverId: string): boolean => selectedMcpServerIds.includes(serverId);
  const activeSkillCount = allSkills.filter(isSkillChecked).length;
  const activeMcpCount = selectedMcpServerIds.length;

  const catalogMcpEntries: AttachMcpEntry[] = mcpServers.map((server) => {
    const item: IConversationMcpStatus = { id: server.id, name: server.name, status: 'loaded' };
    return { item, packageId: packageIdOfMcp(item, mcpServers) };
  });
  // Installed plugins that are off are listed beside the catalog, which only holds the servers that are on.
  const installedPlugins = useInstalledPlugins();
  const enablePlugin = useEnableInstalledPlugin();
  const mcpEntries: AttachMcpEntry[] = [
    ...catalogMcpEntries,
    ...pendingPluginEntries(installedPlugins, new Set(mcpServers.map((server) => server.id))),
  ];
  const skillEntries: AttachSkillEntry[] = allSkills.map((skill) => ({
    name: skill.name,
    description: skill.description || undefined,
    packageId: skillByName.get(skill.name)?.packageId,
  }));
  const model = buildAttachMenuModel(mcpEntries, skillEntries, packageNames);
  const hookRows = useActiveHookRows();

  const pluginCountLabel = (count: number) =>
    t('conversation.attachMenu.pluginCount', { count, defaultValue: '{{count}} plugin' });
  const skillLabel = (count: number) =>
    t('conversation.attachMenu.skillCount', { count, defaultValue: '{{count}} skill' });
  const mcpTag = t('conversation.attachMenu.mcpTag', { defaultValue: 'MCP' });
  const pluginLabel = t('conversation.attachMenu.pluginLabel', { defaultValue: 'Plugin' });
  const backLabel = t('conversation.attachMenu.back', { defaultValue: 'Back' });

  // Picking an off plugin turns its package on through the package switch (same action as the chat menu).
  const pluginOffLabel = t('guid.hubHome.connections.status.off', { defaultValue: 'Off' });

  const renderMcpRow = (entry: AttachMcpEntry) => {
    const serverId = entry.item.id;
    if (entry.pending) {
      return (
        <ToggleRow
          key={`mcp-${serverId}`}
          checked={false}
          label={entry.item.name}
          tag={pluginOffLabel}
          testId={`attach-mcp-${serverId}`}
          onToggle={() => {
            if (entry.packageId !== undefined) void enablePlugin(entry.packageId);
          }}
        />
      );
    }
    const server = serverById.get(serverId);
    const toolCount = server?.tools?.length ? ` (${server.tools.length} ${t('mcp.tools')})` : '';
    return (
      <ToggleRow
        key={`mcp-${serverId}`}
        checked={isMcpChecked(serverId)}
        label={`${server?.name ?? entry.item.name}${toolCount}`}
        tag={mcpTag}
        testId={`attach-mcp-${serverId}`}
        onToggle={() => onToggleMcpServer(serverId)}
      />
    );
  };

  const renderSkillRow = (entry: AttachSkillEntry) => {
    const skill = skillOf.get(entry.name);
    if (!skill) return null;
    const packageName =
      entry.packageId === undefined ? undefined : (packageNames.get(entry.packageId) ?? entry.packageId);
    return (
      <div key={`skill-${entry.name}`} className='attach-menu__skill-row' data-testid={`attach-skill-${entry.name}`}>
        <ToggleRow
          className='attach-menu__skill-main'
          checked={isSkillChecked(skill)}
          label={entry.name}
          description={entry.description}
          testId={`attach-skill-toggle-${entry.name}`}
          onToggle={() => onToggleSkill(skill.name, skill.isAuto)}
        />
        <Button
          type='text'
          size='mini'
          className='attach-menu__view'
          data-testid={`attach-skill-view-${entry.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onView({ name: entry.name, packageId: entry.packageId, packageName });
          }}
        >
          {t('conversation.attachMenu.viewSkill', { defaultValue: 'Xem' })}
        </Button>
      </div>
    );
  };

  const togglePackageGroup = (packageId: string) => {
    setCollapsedPackages((current) => {
      const next = new Set(current);
      if (next.has(packageId)) next.delete(packageId);
      else next.add(packageId);
      return next;
    });
  };

  const renderPackageGroup = (group: AttachPackageGroup) => {
    const collapsed = collapsedPackages.has(group.packageId);
    const items: ToggleItem[] = group.mcp
      .filter((entry) => entry.pending !== true)
      .map((entry) => ({
        checked: isMcpChecked(entry.item.id),
        toggle: () => onToggleMcpServer(entry.item.id),
      }));
    const checkedCount = items.filter((item) => item.checked).length;
    const rows = group.mcp.map((entry) => renderMcpRow(entry));
    return (
      <div
        key={`group-${group.packageId}`}
        className='attach-menu__group'
        data-testid={`attach-menu-group-${group.packageId}`}
      >
        <button
          type='button'
          className='attach-menu__group-header'
          aria-expanded={!collapsed}
          data-testid={`attach-menu-group-toggle-${group.packageId}`}
          onClick={() => togglePackageGroup(group.packageId)}
        >
          <span className='attach-menu__group-name'>{group.name}</span>
          <span className='attach-menu__group-counts'>
            {`${pluginCountLabel(group.mcp.length)}  ·  ${skillLabel(group.skills.length)}`}
          </span>
          {collapsed ? (
            <Right theme='outline' size={12} strokeWidth={3} />
          ) : (
            <Down theme='outline' size={12} strokeWidth={3} />
          )}
        </button>
        {collapsed ? null : (
          <div className='attach-menu__group-body'>
            {items.length > 0 ? (
              <ToggleRow
                checked={checkedCount === items.length}
                indeterminate={checkedCount > 0 && checkedCount < items.length}
                label={t('conversation.attachMenu.selectAllInPackage', { defaultValue: 'Select all in package' })}
                testId={`attach-select-all-${group.packageId}`}
                onToggle={() => toggleAllItems(items)}
              />
            ) : null}
            {rows}
          </div>
        )}
      </div>
    );
  };

  // Skills of one plugin: one collapsed row with a group checkbox over its members (checked, indeterminate or unchecked).
  const renderSkillPluginGroup = (group: AttachPackageGroup) => {
    const items: ToggleItem[] = group.skills.flatMap((entry) => {
      const skill = skillOf.get(entry.name);
      if (!skill) return [];
      return [{ checked: isSkillChecked(skill), toggle: () => onToggleSkill(skill.name, skill.isAuto) }];
    });
    return (
      <PluginGroup
        key={`group-${group.packageId}`}
        groupKey={`skills:${group.packageId}`}
        testId={`attach-menu-group-${group.packageId}`}
        name={group.name}
        countLabel={skillLabel(items.length)}
        check={{
          state: groupCheckState(items.map((item) => item.checked)),
          label: t('conversation.attachMenu.selectAllInPackage', { defaultValue: 'Select all in package' }),
          testId: `attach-select-all-${group.packageId}`,
          onToggle: () => toggleAllItems(items),
        }}
      >
        {group.skills.map((entry) => renderSkillRow(entry))}
      </PluginGroup>
    );
  };

  const standaloneRows =
    category === 'mcp'
      ? model.standalone.mcp.map((entry) => renderMcpRow(entry))
      : model.standalone.skills.map((entry) => renderSkillRow(entry));
  const groups = model.packages.filter((group) =>
    category === 'mcp' ? group.mcp.length > 0 : group.skills.length > 0
  );

  return (
    <div
      className={`attach-menu ${category !== undefined && !autoSelect ? 'attach-menu--panel-open' : ''}`}
      data-layout={layout}
      style={{ '--attach-menu-max-w': `${maxWidth}px` } as React.CSSProperties}
      onClick={(event) => event.stopPropagation()}
      data-testid='attach-menu'
    >
      <div className='attach-menu__main'>
        {onToggleAutoSelect ? <AutoSelectRow autoSelect={autoSelect} onToggleAutoSelect={onToggleAutoSelect} /> : null}
        {!autoSelect && (mcpEntries.length > 0 || allSkills.length > 0 || hookRows.length > 0) && (
          <>
            {mcpEntries.length > 0 && (
              <div className='px-6px'>
                <MenuItem
                  icon={<Shield theme='outline' size={15} strokeWidth={2.5} />}
                  label={`${pluginLabel} (${activeMcpCount}/${mcpEntries.length})`}
                  suffix={<Right theme='outline' size={12} strokeWidth={3} style={{ color: '#c9cdd4' }} />}
                  active={category === 'mcp'}
                  onClick={() => onCategory('mcp')}
                  testId='attach-category-mcp'
                />
              </div>
            )}
            {allSkills.length > 0 && (
              <div className='px-6px'>
                <MenuItem
                  icon={<Lightning theme='outline' size={15} strokeWidth={2.5} />}
                  label={`${t('settings.capabilitiesTab.skills')} (${activeSkillCount}/${allSkills.length})`}
                  suffix={<Right theme='outline' size={12} strokeWidth={3} style={{ color: '#c9cdd4' }} />}
                  active={category === 'skills'}
                  onClick={() => onCategory('skills')}
                  testId='attach-category-skills'
                />
              </div>
            )}
            <div className='px-6px'>
              <MenuItem
                icon={<Link theme='outline' size={15} strokeWidth={2.5} />}
                label={`${t('conversation.attachMenu.hookLabel', { defaultValue: 'Hook' })} (${hookRows.length})`}
                suffix={<Right theme='outline' size={12} strokeWidth={3} style={{ color: '#c9cdd4' }} />}
                active={category === 'hooks'}
                onClick={() => onCategory('hooks')}
                testId='attach-category-hooks'
              />
            </div>
            <div className='attach-menu__divider' />
          </>
        )}
        <div className='px-6px'>
          {onMyDevice && (
            <MenuItem
              icon={<UploadOne theme='outline' size='16' fill={iconColors.secondary} style={{ lineHeight: 0 }} />}
              label={t('common.fileAttach.myDevice')}
              onClick={() => {
                onMyDevice();
                onDone();
              }}
              testId='attach-my-device'
            />
          )}
          <MenuItem
            icon={<UploadOne theme='outline' size='16' fill={iconColors.secondary} style={{ lineHeight: 0 }} />}
            label={t('common.fileAttach.addFiles')}
            onClick={() => {
              onAddFiles();
              onDone();
            }}
            testId='attach-add-files'
          />
        </div>
      </div>
      {category !== undefined && !autoSelect ? (
        <div className='attach-menu__panel' data-testid='attach-menu-panel' data-category={category}>
          <div className='attach-menu__panel-head'>
            <button
              type='button'
              className='attach-menu__back'
              aria-label={backLabel}
              data-testid='attach-menu-back'
              onClick={() => onCategory(undefined)}
            >
              <Left theme='outline' size={14} strokeWidth={3} />
              <span>{backLabel}</span>
            </button>
          </div>
          {category === 'hooks' ? (
            <HookMenuList hooks={hookRows} packageNames={packageNames} />
          ) : (
            <div className='attach-menu__panel-scroll'>
              {standaloneRows.length > 0 ? (
                <div className='attach-menu__section-label' data-testid='attach-menu-other-label'>
                  {t('conversation.attachMenu.otherGroup', { defaultValue: 'Other' })}
                </div>
              ) : null}
              {standaloneRows}
              {groups.map((group) =>
                category === 'skills' ? renderSkillPluginGroup(group) : renderPackageGroup(group)
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};

const FULL_PLACEMENT: AttachMenuPlacement = {
  position: 'tl',
  maxWidth: ATTACH_MENU_MAX_WIDTH,
  layout: 'columns',
};

/** Places the popup beside its anchor inside the free area (viewport minus the Home side panes). */
const placementForAnchor = (anchor: HTMLElement | null): AttachMenuPlacement => {
  if (!anchor) return FULL_PLACEMENT;
  const rect = anchor.getBoundingClientRect();
  if (rect.width <= 0) return FULL_PLACEMENT;
  return computeAttachMenuPlacement({ left: rect.left, right: rect.right }, readAttachMenuArea());
};

/**
 * Click-only tools menu for the Home composer. Skills and MCP open as a second column beside the main menu, and each
 * list is grouped by installed package. Checkbox state stays in the parent; this component only reports toggles.
 */
const ToolsSelectMenu: React.FC<ToolsSelectMenuProps> = ({ children, onVisibleChange, ...panelProps }) => {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<AttachCategory | undefined>(undefined);
  const [viewer, setViewer] = useState<SkillViewerTarget | undefined>(undefined);
  const [placement, setPlacement] = useState<AttachMenuPlacement>(FULL_PLACEMENT);
  const anchorRef = useRef<HTMLElement | null>(null);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setCategory(undefined);
  }, []);

  const handleVisibleChange = useCallback(
    (visible: boolean) => {
      setOpen(visible);
      if (visible) setPlacement(placementForAnchor(anchorRef.current));
      else setCategory(undefined);
      onVisibleChange?.(visible);
    },
    [onVisibleChange]
  );

  const openViewer = useCallback(
    (target: SkillViewerTarget) => {
      closeMenu();
      setViewer(target);
    },
    [closeMenu]
  );

  // Remember the element that was clicked so the popup can be measured against it when it opens.
  const childOnClick = (children.props as AnchorClickProps).onClick;
  const anchoredChild = React.cloneElement(children as React.ReactElement<AnchorClickProps>, {
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      anchorRef.current = event.currentTarget;
      childOnClick?.(event);
    },
  });

  return (
    <>
      <Trigger
        popup={() => (
          <ToolsSelectPanel
            {...panelProps}
            category={category}
            layout={placement.layout}
            maxWidth={placement.maxWidth}
            onCategory={setCategory}
            onDone={closeMenu}
            onView={openViewer}
          />
        )}
        {...ATTACH_MENU_TRIGGER}
        position={placement.position}
        popupVisible={open}
        onVisibleChange={handleVisibleChange}
      >
        {anchoredChild}
      </Trigger>
      {viewer ? (
        <SkillDocumentModal
          name={viewer.name}
          packageId={viewer.packageId}
          packageName={viewer.packageName}
          onClose={() => setViewer(undefined)}
        />
      ) : null}
    </>
  );
};

export default ToolsSelectMenu;
