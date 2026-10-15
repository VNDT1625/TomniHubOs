/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IConversationMcpStatus, IConversationMcpStatusKind } from '@/common/config/storage';
import { ipcBridge } from '@/common';
import { mcpService } from '@/common/adapter/ipcBridge';
import { Button, Message, Trigger } from '@arco-design/web-react';
import { Down, FolderOpen, Lightning, Link, Paperclip, Plus, Right, Shield } from '@icon-park/react';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { iconColors } from '@/renderer/styles/colors';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { FileService } from '@/renderer/services/FileService';
import type { FileMetadata } from '@/renderer/services/FileService';
import { SkillDocumentModal } from '@/renderer/components/skills/SkillDocumentModal';
import {
  ATTACH_MENU_TRIGGER,
  buildAttachMenuModel,
  packageIdOfMcp,
  pendingPluginEntries,
  type AttachCategory,
  type AttachMcpEntry,
  type AttachPackageGroup,
  type AttachSkillEntry,
  type SkillViewerTarget,
} from '@/renderer/components/media/attachMenu/attachMenuModel';
import { MenuItem } from '@/renderer/components/media/attachMenu/AttachMenuItem';
import { AutoSelectRow } from '@/renderer/components/media/attachMenu/AutoSelectRow';
import { HookMenuList, useActiveHookRows } from '@/renderer/components/media/attachMenu/HookColumn';
import { PluginGroup } from '@/renderer/components/media/attachMenu/PluginGroup';
import {
  useEnableInstalledPlugin,
  useInstalledPlugins,
} from '@/renderer/components/media/attachMenu/useInstalledPlugins';
import { emitter } from '@/renderer/utils/emitter';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

interface FileAttachButtonProps {
  openFileSelector: () => void;
  onLocalFilesAdded?: (files: FileMetadata[]) => void;
  loadedSkills?: string[];
  loadedMcpStatuses?: IConversationMcpStatus[];
  /** Auto mode: when true the manual lists are hidden. The switch row renders only when the toggle is provided. */
  autoSelect?: boolean;
  onToggleAutoSelect?: () => void;
}

/** Shared attach-menu model; re-exported so existing imports of this module keep working. */
export {
  ATTACH_MENU_TRIGGER,
  buildAttachMenuModel,
  packageIdOfMcp,
} from '@/renderer/components/media/attachMenu/attachMenuModel';

const MCP_STATUS_CLASS_NAME: Record<IConversationMcpStatusKind, string> = {
  loaded: 'text-[var(--color-success-6)]',
  failed: 'text-[var(--color-danger-6)]',
  unsupported: 'text-[var(--color-warning-6)]',
};

const buildLoadedMcpStatuses = (
  statuses?: IConversationMcpStatus[],
  legacyNames?: string[]
): IConversationMcpStatus[] => {
  if (Array.isArray(statuses) && statuses.length > 0) {
    return statuses;
  }

  return (legacyNames ?? []).map((name) => ({
    id: name,
    name,
    status: 'loaded',
  }));
};

const FileAttachButton: React.FC<FileAttachButtonProps> = ({
  openFileSelector,
  onLocalFilesAdded,
  loadedSkills,
  loadedMcpStatuses,
  autoSelect = false,
  onToggleAutoSelect,
}) => {
  const conversationContext = useConversationContextSafe();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<AttachCategory | undefined>(undefined);
  const [collapsedPackages, setCollapsedPackages] = useState<ReadonlySet<string>>(() => new Set());
  const [viewer, setViewer] = useState<SkillViewerTarget | undefined>(undefined);

  const skillNames = loadedSkills ?? conversationContext?.loadedSkills ?? [];
  const mcpStatuses = buildLoadedMcpStatuses(
    loadedMcpStatuses ?? conversationContext?.loadedMcpStatuses,
    conversationContext?.loadedMcpServers
  );
  const hasSkills = skillNames.length > 0;
  const hookRows = useActiveHookRows();
  const installedPlugins = useInstalledPlugins();
  const enablePlugin = useEnableInstalledPlugin();

  const { data: skillIndex } = useSWR(hasSkills ? 'skills-index' : null, () =>
    ipcBridge.fs.listAvailableSkills.invoke()
  );
  const { data: mcpServers, mutate: refreshMcpServers } = useSWR(
    mcpStatuses.length > 0 || installedPlugins.length > 0 ? 'attach-menu-mcp-servers' : null,
    () => mcpService.listServers.invoke()
  );
  useEffect(() => {
    const refresh = () => {
      void refreshMcpServers();
    };
    window.addEventListener('tomni-packages-changed', refresh);
    return () => window.removeEventListener('tomni-packages-changed', refresh);
  }, [refreshMcpServers]);

  // An installed plugin whose server is not in the catalog is off (or not yet loaded). It is listed as a pending entry,
  // exactly as in the Home menu. Nothing is listed until the catalog has loaded, so an on plugin never shows as off.
  const catalogIds = new Set([...(mcpServers ?? []).map((server) => server.id), ...mcpStatuses.map((item) => item.id)]);
  const mcpEntries: AttachMcpEntry[] = [
    ...mcpStatuses.map((item) => ({ item, packageId: packageIdOfMcp(item, mcpServers) })),
    ...(mcpServers === undefined ? [] : pendingPluginEntries(installedPlugins, catalogIds)),
  ];
  const hasPlugins = mcpEntries.length > 0;

  const { data: packageRows } = useSWR(hasSkills || hasPlugins ? 'attach-menu-packages' : null, () =>
    ipcBridge.packagePlatform.list.invoke(undefined)
  );

  const skillByName = new Map((skillIndex ?? []).map((skill) => [skill.name, skill] as const));
  const packageNames = new Map((packageRows ?? []).map((row) => [row.manifest.id, row.manifest.name] as const));
  const model = buildAttachMenuModel(
    mcpEntries,
    skillNames.map((name) => {
      const indexed = skillByName.get(name);
      return { name, description: indexed?.description, packageId: indexed?.packageId };
    }),
    packageNames
  );

  const handleSkillClick = useCallback((name: string) => {
    setOpen(false);
    setCategory(undefined);
    emitter.emit('sendbox.fill', `/${name} `);
  }, []);

  const handleVisibleChange = useCallback((visible: boolean) => {
    setOpen(visible);
    if (!visible) setCategory(undefined);
  }, []);

  const handleOpenMcpSettings = useCallback(() => {
    setOpen(false);
    setCategory(undefined);
    void navigate('/settings/capabilities?tab=tools');
  }, [navigate]);

  const togglePackageGroup = useCallback((packageId: string) => {
    setCollapsedPackages((current) => {
      const next = new Set(current);
      if (next.has(packageId)) next.delete(packageId);
      else next.add(packageId);
      return next;
    });
  }, []);

  const openViewer = useCallback((target: SkillViewerTarget) => {
    setOpen(false);
    setCategory(undefined);
    setViewer(target);
  }, []);

  const handleLocalFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0 || !onLocalFilesAdded) return;
      setUploading(true);
      try {
        const processed = await FileService.processDroppedFiles(fileList, conversationContext?.conversation_id);
        if (processed.length > 0) onLocalFilesAdded(processed);
      } catch {
        Message.error(t('common.fileAttach.failed'));
      } finally {
        setUploading(false);
      }
      e.target.value = '';
    },
    [conversationContext?.conversation_id, onLocalFilesAdded, t]
  );

  const isDesktop = isElectronDesktop();
  const plusIcon = <Plus theme='outline' size='14' strokeWidth={2} fill={iconColors.primary} />;

  if (isDesktop && !hasSkills && !hasPlugins && hookRows.length === 0 && !onToggleAutoSelect) {
    return (
      <Button
        type='secondary'
        shape='circle'
        icon={plusIcon}
        onClick={openFileSelector}
        data-testid='tomnyagentic-attach-folder-btn'
      />
    );
  }

  const pluginOffLabel = t('guid.hubHome.connections.status.off', { defaultValue: 'Off' });
  const mcpTagText = t('conversation.attachMenu.mcpTag', { defaultValue: 'MCP' });
  const pluginLabel = t('conversation.attachMenu.pluginLabel', { defaultValue: 'Plugin' });
  const pluginCountLabel = (count: number) =>
    t('conversation.attachMenu.pluginCount', { count, defaultValue: '{{count}} plugin' });
  const skillLabel = (count: number) =>
    t('conversation.attachMenu.skillCount', { count, defaultValue: '{{count}} skill' });

  const renderMcpRow = (entry: AttachMcpEntry) => {
    const { item } = entry;
    if (entry.pending) {
      return (
        <MenuItem
          key={`mcp-${item.id}-pending`}
          icon={<Shield theme='outline' size={15} strokeWidth={2.5} />}
          label={
            <>
              {item.name} <span className='attach-menu__tag'>{pluginOffLabel}</span>
            </>
          }
          onClick={() => {
            if (entry.packageId !== undefined) void enablePlugin(entry.packageId);
          }}
          testId={`attach-mcp-${item.id}`}
        />
      );
    }
    return (
      <MenuItem
        key={`mcp-${item.id}-${item.status}`}
        icon={<Shield theme='outline' size={15} strokeWidth={2.5} />}
        label={
          <>
            {item.name} <span className='attach-menu__tag'>{mcpTagText}</span>
          </>
        }
        suffix={
          item.status === 'loaded' ? undefined : (
            <span className={`text-12px leading-none ${MCP_STATUS_CLASS_NAME[item.status]}`}>
              {t(`conversation.mcp.status.${item.status}` as const)}
            </span>
          )
        }
        className='cursor-default'
        title={item.reason}
        testId={`attach-mcp-${item.id}`}
      />
    );
  };

  const nameOf = (packageId: string): string => packageNames.get(packageId) ?? packageId;

  const renderSkillRow = (entry: AttachSkillEntry) => (
    <div key={`skill-${entry.name}`} className='attach-menu__skill-row' data-testid={`attach-skill-${entry.name}`}>
      <MenuItem
        icon={<Lightning theme='outline' size={15} strokeWidth={2.5} />}
        label={entry.name}
        description={entry.description || undefined}
        onClick={() => handleSkillClick(entry.name)}
        title={entry.name}
        className='attach-menu__skill-main'
      />
      <Button
        type='text'
        size='mini'
        className='attach-menu__view'
        data-testid={`attach-skill-view-${entry.name}`}
        onClick={(event) => {
          event.stopPropagation();
          openViewer({
            name: entry.name,
            packageId: entry.packageId,
            packageName: entry.packageId === undefined ? undefined : nameOf(entry.packageId),
          });
        }}
      >
        {t('conversation.attachMenu.viewSkill', { defaultValue: 'Xem' })}
      </Button>
    </div>
  );

  const renderPackageGroup = (group: AttachPackageGroup) => {
    const collapsed = collapsedPackages.has(group.packageId);
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
        {collapsed ? null : <div className='attach-menu__group-body'>{rows}</div>}
      </div>
    );
  };

  // Skills of one plugin: one collapsed row per plugin. Loaded skills here are click-to-insert, so there is no checkbox.
  const renderSkillPluginGroup = (group: AttachPackageGroup) => (
    <PluginGroup
      key={`group-${group.packageId}`}
      groupKey={`skills:${group.packageId}`}
      testId={`attach-menu-group-${group.packageId}`}
      name={group.name}
      countLabel={skillLabel(group.skills.length)}
    >
      {group.skills.map((entry) => renderSkillRow(entry))}
    </PluginGroup>
  );

  const renderPanel = (): React.ReactNode => {
    if (category === undefined) return null;
    if (category === 'hooks') return <HookMenuList hooks={hookRows} packageNames={packageNames} />;
    const standalone =
      category === 'mcp'
        ? model.standalone.mcp.map((entry) => renderMcpRow(entry))
        : model.standalone.skills.map((entry) => renderSkillRow(entry));
    const groups = model.packages.filter((group) =>
      category === 'mcp' ? group.mcp.length > 0 : group.skills.length > 0
    );
    return (
      <>
        <div className='attach-menu__panel-scroll'>
          {standalone}
          {groups.map((group) => (category === 'skills' ? renderSkillPluginGroup(group) : renderPackageGroup(group)))}
        </div>
        {category === 'mcp' ? (
          <div className='attach-menu__panel-footer'>
            <div className='text-12px leading-16px text-t-secondary whitespace-normal break-words'>
              {t('conversation.mcp.managementHint', {
                defaultValue:
                  'If an MCP looks abnormal, it is usually caused by the MCP JSON configuration. Go to Tools settings and test it there.',
              })}
            </div>
            <Button
              type='text'
              size='mini'
              className='mt-6px h-auto! px-0! text-12px! inline-flex! items-center! gap-4px!'
              data-testid='attach-open-mcp-settings'
              onClick={handleOpenMcpSettings}
            >
              <span className='leading-none'>
                {t('conversation.mcp.openSettings', {
                  defaultValue: 'Open Tools settings',
                })}
              </span>
              <span className='inline-flex h-12px w-12px flex-shrink-0 items-center justify-center'>
                <Right theme='outline' size={12} strokeWidth={3} className='block' />
              </span>
            </Button>
          </div>
        ) : null}
      </>
    );
  };

  const menu = (
    <div className='attach-menu' onClick={(e) => e.stopPropagation()} data-testid='attach-menu'>
      <div className='attach-menu__main'>
        {onToggleAutoSelect ? <AutoSelectRow autoSelect={autoSelect} onToggleAutoSelect={onToggleAutoSelect} /> : null}
        {/* Loaded items stay above file actions so the session snapshot is visible */}
        {!autoSelect && (hasPlugins || hasSkills || hookRows.length > 0) && (
          <>
            {hasPlugins && (
              <div className='px-6px'>
                <MenuItem
                  icon={<Shield theme='outline' size={15} strokeWidth={2.5} />}
                  label={`${pluginLabel} · ${mcpEntries.length}`}
                  suffix={<Right theme='outline' size={12} strokeWidth={3} style={{ color: '#c9cdd4' }} />}
                  active={category === 'mcp'}
                  onClick={() => setCategory('mcp')}
                  testId='attach-category-mcp'
                />
              </div>
            )}
            {hasSkills && (
              <div className='px-6px'>
                <MenuItem
                  icon={<Lightning theme='outline' size={15} strokeWidth={2.5} />}
                  label={`${t('conversation.skills.loaded', { defaultValue: 'Loaded Skills' })} · ${skillNames.length}`}
                  suffix={<Right theme='outline' size={12} strokeWidth={3} style={{ color: '#c9cdd4' }} />}
                  active={category === 'skills'}
                  onClick={() => setCategory('skills')}
                  testId='attach-category-skills'
                />
              </div>
            )}
            <div className='px-6px'>
              <MenuItem
                icon={<Link theme='outline' size={15} strokeWidth={2.5} />}
                label={`${t('conversation.attachMenu.hookLabel', { defaultValue: 'Hook' })} · ${hookRows.length}`}
                suffix={<Right theme='outline' size={12} strokeWidth={3} style={{ color: '#c9cdd4' }} />}
                active={category === 'hooks'}
                onClick={() => setCategory('hooks')}
                testId='attach-category-hooks'
              />
            </div>
            <div className='attach-menu__divider' />
          </>
        )}

        {/* 文件操作最常用，在最下（离 + 最近） */}
        <div className='px-6px'>
          {!isDesktop && (
            <MenuItem
              icon={<FolderOpen theme='outline' size={15} strokeWidth={2.5} />}
              label={t('common.fileAttach.myDevice', { defaultValue: 'Upload from device' })}
              onClick={() => {
                fileInputRef.current?.click();
                setOpen(false);
              }}
            />
          )}
          <MenuItem
            icon={<Paperclip theme='outline' size={15} strokeWidth={2.5} />}
            label={t('common.fileAttach.addFiles', { defaultValue: 'Add files' })}
            onClick={() => {
              openFileSelector();
              setOpen(false);
            }}
          />
        </div>
      </div>
      {category !== undefined && !autoSelect ? (
        <div className='attach-menu__panel' data-testid='attach-menu-panel' data-category={category}>
          {renderPanel()}
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <Trigger popup={() => menu} {...ATTACH_MENU_TRIGGER} popupVisible={open} onVisibleChange={handleVisibleChange}>
        <Button
          type='secondary'
          shape='circle'
          icon={plusIcon}
          loading={uploading}
          disabled={uploading}
          data-testid='tomnyagentic-attach-folder-btn'
        />
      </Trigger>
      <input
        ref={fileInputRef}
        type='file'
        multiple
        style={{ display: 'none' }}
        onChange={handleLocalFileChange}
        data-testid='tomnyagentic-file-upload-input'
      />
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

export default FileAttachButton;
