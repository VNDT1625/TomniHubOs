/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IMcpServer } from '@/common/config/storage';
import AgentModeSelector from '@/renderer/components/agent/AgentModeSelector';
import { supportsModeSwitch, type AgentModeOption } from '@/renderer/utils/model/agentModes';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { getCleanFileNames, FileService } from '@/renderer/services/FileService';
import { iconColors } from '@/renderer/styles/colors';
import { isElectronDesktop } from '@/renderer/utils/platform';
import type { AvailableAgent } from '../types';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import PresetAgentTag, { type AgentSwitcherItem } from './PresetAgentTag';
import { Button, Checkbox, Dropdown, Menu, Message, Tooltip } from '@arco-design/web-react';
import {
  ArrowUp,
  Code,
  Cube,
  Down,
  FolderOpen,
  Lightning,
  More,
  People,
  Plus,
  Robot,
  Shield,
  UploadOne,
} from '@icon-park/react';
import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../index.module.css';

type GuidActionRowProps = {
  // File handling
  files: string[];
  onFilesUploaded: (paths: string[]) => void;

  // Model selector node (rendered by parent)
  modelSelectorNode: React.ReactNode;

  // Agent mode
  selectedAgent: string | 'custom';
  effectiveModeAgent?: string;
  selectedMode: string;
  onModeSelect: (mode: string) => void;

  // Preset agent tag
  is_presetAgent: boolean;
  selectedAgentInfo: AvailableAgent | undefined;
  /**
   * Backend-merged preset catalog — drives the preset tag label lookup. Not
   * the ACP engine-config list (custom agents from the AgentRegistry).
   */
  assistants: Assistant[];
  localeKey: string;
  onClosePresetTag: () => void;
  agentLogo?: string | null;
  agentSwitcherItems?: AgentSwitcherItem[];
  onAgentSwitch?: (key: string) => void;
  hidePresetTag?: boolean;

  // Skills management
  allSkills: Array<{ name: string; description: string; isAuto: boolean }>;
  disabledBuiltinSkills: string[];
  enabledSkills: string[];
  onToggleSkill: (name: string, isAuto: boolean) => void;
  mcpServers: IMcpServer[];
  selectedMcpServerIds: string[];
  onToggleMcpServer: (serverId: string) => void;

  /** Whether the Browser-Control (Super) server is registered/available. */
  superAvailable?: boolean;
  /** Whether Super is enabled for the conversation being created. */
  superEnabled?: boolean;
  /** Toggle Super for the new conversation (grants the agent the live-browser tools). */
  onToggleSuper?: () => void;

  variant?: 'default' | 'hub';
  onOpenCollaboration?: () => void;
  onOpenCapabilities?: () => void;
  onOpenCodeApp?: () => void;
  onSelectWorkspace?: (dir: string) => void;

  // Send button
  loading: boolean;
  isButtonDisabled: boolean;
  speechInputNode?: React.ReactNode;
  onSend: () => void;
};

const GuidActionRow: React.FC<GuidActionRowProps> = ({
  files,
  onFilesUploaded,
  modelSelectorNode,
  selectedAgent,
  effectiveModeAgent,
  selectedMode,
  onModeSelect,
  is_presetAgent,
  selectedAgentInfo,
  assistants,
  localeKey,
  onClosePresetTag,
  agentLogo,
  agentSwitcherItems,
  onAgentSwitch,
  allSkills,
  disabledBuiltinSkills,
  enabledSkills,
  onToggleSkill,
  mcpServers,
  selectedMcpServerIds,
  onToggleMcpServer,
  superAvailable = false,
  superEnabled = false,
  onToggleSuper,
  variant = 'default',
  onOpenCollaboration,
  onOpenCapabilities,
  onOpenCodeApp,
  onSelectWorkspace,
  hidePresetTag = false,
  loading,
  isButtonDisabled,
  speechInputNode,
  onSend,
}) => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [isPlusDropdownOpen, setIsPlusDropdownOpen] = useState(false);
  const modeBackend = effectiveModeAgent || selectedAgent;
  const showModeSwitch = supportsModeSwitch(modeBackend);
  const configOptionCount = (modelSelectorNode ? 1 : 0) + (showModeSwitch ? 1 : 0);

  // Browser file picker ref (WebUI only)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleLocalFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;
      setUploading(true);
      try {
        const processed = await FileService.processDroppedFiles(fileList);
        if (processed.length > 0) {
          onFilesUploaded(processed.map((f) => f.path));
        }
      } catch {
        Message.error(t('common.fileAttach.failed'));
      } finally {
        setUploading(false);
      }
      // Reset so the same file can be re-selected
      e.target.value = '';
    },
    [onFilesUploaded, t]
  );

  const getModeDisplayLabel = (mode: AgentModeOption): string =>
    t(`agentMode.${mode.value}`, { defaultValue: mode.label });

  const isWebUI = !isElectronDesktop();

  const isSkillChecked = (skill: { name: string; isAuto: boolean }) =>
    skill.isAuto ? !disabledBuiltinSkills.includes(skill.name) : enabledSkills.includes(skill.name);

  const activeSkillCount = allSkills.filter(isSkillChecked).length;
  const activeMcpCount = selectedMcpServerIds.length;
  const currentAgentItem = agentSwitcherItems?.find((item) => item.isCurrent) ?? agentSwitcherItems?.[0];

  const combinedAgentModelMenu =
    currentAgentItem && agentSwitcherItems && agentSwitcherItems.length > 0 && onAgentSwitch ? (
      <div className={styles.actionHubAgentModelPopover}>
        <section className={styles.actionHubAgentModelSection}>
          <span className={styles.actionHubAgentModelHeading}>{t('guid.agentSwitcherLabel')}</span>
          <Menu
            className={styles.actionHubAgentMenu}
            selectedKeys={[currentAgentItem.key]}
            onClickMenuItem={onAgentSwitch}
          >
            {agentSwitcherItems.map((item) => (
              <Menu.Item key={item.key}>
                <span className={styles.actionHubAgentMenuItem}>
                  {item.logo ? (
                    <img src={item.logo} alt='' className={styles.actionHubAgentLogo} />
                  ) : (
                    <Robot theme='outline' size='15' fill='currentColor' />
                  )}
                  <span>{item.label}</span>
                </span>
              </Menu.Item>
            ))}
          </Menu>
        </section>
        {modelSelectorNode && (
          <section className={styles.actionHubAgentModelSection}>
            <span className={styles.actionHubAgentModelHeading}>{t('common.defaultModel')}</span>
            <div className={styles.actionHubAgentModelControl}>{modelSelectorNode}</div>
          </section>
        )}
      </div>
    ) : null;

  const handleWorkspaceSelect = useCallback(() => {
    ipcBridge.dialog.showOpen
      .invoke({ properties: ['openDirectory'] })
      .then((directories) => {
        const selectedDirectory = directories?.[0];
        if (selectedDirectory) onSelectWorkspace?.(selectedDirectory);
      })
      .catch((error) => {
        console.error('Failed to open workspace dialog:', error);
      });
  }, [onSelectWorkspace]);

  const menuContent = (
    <Menu
      className='min-w-200px'
      onClickMenuItem={(key) => {
        if (key === 'file') {
          ipcBridge.dialog.showOpen
            .invoke({ properties: ['openFile', 'multiSelections'] })
            .then((uploadedFiles) => {
              if (uploadedFiles && uploadedFiles.length > 0) {
                onFilesUploaded(uploadedFiles);
              }
            })
            .catch((error) => {
              console.error('Failed to open file dialog:', error);
            });
        } else if (key === 'device') {
          fileInputRef.current?.click();
        }
      }}
    >
      {isWebUI ? (
        <>
          <Menu.Item key='file'>
            <div className='flex items-center gap-8px'>
              <UploadOne theme='outline' size='16' fill={iconColors.secondary} style={{ lineHeight: 0 }} />
              <span>{t('common.fileAttach.addFiles')}</span>
            </div>
          </Menu.Item>
          <Menu.Item key='device'>
            <div className='flex items-center gap-8px'>
              <UploadOne theme='outline' size='16' fill={iconColors.secondary} style={{ lineHeight: 0 }} />
              <span>{t('common.fileAttach.myDevice')}</span>
            </div>
          </Menu.Item>
        </>
      ) : (
        <Menu.Item key='file'>
          <div className='flex items-center gap-8px'>
            <UploadOne theme='outline' size='16' fill={iconColors.secondary} style={{ lineHeight: 0 }} />
            <span>{t('common.fileAttach.addFiles')}</span>
          </div>
        </Menu.Item>
      )}
      {allSkills.length > 0 && (
        <Menu.SubMenu
          key='skills'
          title={
            <div className='flex items-center gap-8px'>
              <Lightning theme='filled' size='16' fill={iconColors.primary} style={{ lineHeight: 0 }} />
              <span>
                {t('settings.capabilitiesTab.skills')} ({activeSkillCount}/{allSkills.length})
              </span>
            </div>
          }
          triggerProps={{
            popupStyle: {
              maxHeight: 360,
              overflowY: 'auto',
              overflowX: 'hidden',
            },
          }}
        >
          {allSkills.map((skill) => (
            <Menu.Item
              key={`skill-${skill.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSkill(skill.name, skill.isAuto);
              }}
            >
              <Checkbox
                checked={isSkillChecked(skill)}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                onChange={() => onToggleSkill(skill.name, skill.isAuto)}
              >
                <span className='text-13px'>{skill.name}</span>
              </Checkbox>
            </Menu.Item>
          ))}
        </Menu.SubMenu>
      )}
      {mcpServers.length > 0 && (
        <Menu.SubMenu
          key='mcp'
          title={
            <div className='flex items-center gap-8px'>
              <Shield theme='outline' size='16' fill={iconColors.primary} style={{ lineHeight: 0 }} />
              <span>
                {t('mcp.label')} ({activeMcpCount}/{mcpServers.length})
              </span>
            </div>
          }
          triggerProps={{
            popupStyle: {
              maxHeight: 360,
              overflowY: 'auto',
              overflowX: 'hidden',
            },
          }}
        >
          {mcpServers.map((server) => (
            <Menu.Item
              key={`mcp-${server.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleMcpServer(server.id);
              }}
            >
              <Checkbox
                checked={selectedMcpServerIds.includes(server.id)}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                onChange={() => onToggleMcpServer(server.id)}
              >
                <span className='text-13px'>
                  {server.name}
                  {server.tools?.length ? ` (${server.tools.length} ${t('mcp.tools')})` : ''}
                </span>
              </Checkbox>
            </Menu.Item>
          ))}
        </Menu.SubMenu>
      )}
    </Menu>
  );

  if (variant === 'hub') {
    return (
      <div className={[styles.actionRow, styles.actionRowHub].join(' ')}>
        <div className={styles.actionHubPrimary}>
          <Tooltip
            content={
              superAvailable
                ? superEnabled
                  ? t('workspace.super.onHint')
                  : t('workspace.super.offHint')
                : t('guid.hubHome.shell.storeHint')
            }
          >
            <Button
              size='small'
              type='primary'
              className={styles.actionHubSuper}
              icon={<Lightning theme={superEnabled ? 'filled' : 'outline'} size='14' />}
              onClick={superAvailable ? onToggleSuper : onOpenCapabilities}
            >
              {t('workspace.super.label')}
            </Button>
          </Tooltip>
          {currentAgentItem && combinedAgentModelMenu ? (
            <Tooltip content={t('guid.agentSwitcherLabel')}>
              <span className='inline-flex min-w-0' data-agent-switcher-tooltip-target>
                <Dropdown trigger='click' position='bl' droplist={combinedAgentModelMenu}>
                  <Button
                    type='secondary'
                    size='small'
                    className={styles.actionHubAgent}
                    aria-label={t('guid.agentSwitcherLabel')}
                  >
                    <span className={styles.actionHubAgentContent}>
                      {currentAgentItem.logo ? (
                        <img src={currentAgentItem.logo} alt='' className={styles.actionHubAgentLogo} />
                      ) : (
                        <Robot theme='outline' size='15' fill='currentColor' />
                      )}
                      <span className={styles.actionHubAgentLabel}>{currentAgentItem.label}</span>
                      <Down theme='outline' size='11' fill='currentColor' />
                    </span>
                  </Button>
                </Dropdown>
              </span>
            </Tooltip>
          ) : (
            modelSelectorNode && <span className={styles.actionConfigItem}>{modelSelectorNode}</span>
          )}
          {showModeSwitch && (
            <span
              className={[styles.actionConfigItem, styles.actionConfigMode].join(' ')}
              data-mobile={isMobile ? 'true' : undefined}
            >
              <AgentModeSelector
                backend={modeBackend}
                compact
                initialMode={selectedMode}
                onModeSelect={onModeSelect}
                compactLeadingIcon={<Shield theme='outline' size='14' fill={iconColors.secondary} />}
                modeLabelFormatter={getModeDisplayLabel}
              />
            </span>
          )}
        </div>

        <div className={styles.actionHubSecondary}>
          <Tooltip content={t('guid.hubHome.shell.nav.company')}>
            <Button
              type='text'
              shape='circle'
              size='small'
              className={styles.actionHubIcon}
              icon={<People theme='outline' size='15' fill='currentColor' />}
              onClick={onOpenCollaboration}
              aria-label={t('guid.hubHome.shell.nav.company')}
            />
          </Tooltip>
          <Tooltip content={t('guid.hubHome.shell.nav.products')}>
            <Button
              type='text'
              shape='circle'
              size='small'
              className={styles.actionHubIcon}
              icon={<Cube theme='outline' size='15' fill='currentColor' />}
              onClick={onOpenCapabilities}
              aria-label={t('guid.hubHome.shell.nav.products')}
            />
          </Tooltip>
          <Tooltip content={t('guid.hubHome.apps.ide.title')}>
            <Button
              type='text'
              shape='circle'
              size='small'
              className={styles.actionHubIcon}
              icon={<Code theme='outline' size='15' fill='currentColor' />}
              onClick={onOpenCodeApp}
              aria-label={t('guid.hubHome.apps.ide.title')}
            />
          </Tooltip>
          <Tooltip content={t('guid.workspace.specifyWorkspace')}>
            <Button
              type='text'
              shape='circle'
              size='small'
              className={styles.actionHubIcon}
              icon={<FolderOpen theme='outline' size='15' fill='currentColor' />}
              onClick={handleWorkspaceSelect}
              aria-label={t('guid.workspace.specifyWorkspace')}
            />
          </Tooltip>
          <Dropdown trigger='hover' droplist={menuContent}>
            <Button
              type='text'
              shape='circle'
              size='small'
              className={styles.actionHubIcon}
              icon={<More theme='outline' size='15' fill='currentColor' />}
              aria-label={t('guid.hubHome.shell.more')}
            />
          </Dropdown>
          {isWebUI && (
            <input
              ref={fileInputRef}
              type='file'
              multiple
              style={{ display: 'none' }}
              onChange={handleLocalFileChange}
            />
          )}
          {speechInputNode}
          <Button
            shape='circle'
            type='primary'
            loading={loading}
            disabled={isButtonDisabled}
            className='send-button-custom'
            icon={<ArrowUp theme='filled' size='14' fill='white' strokeWidth={5} />}
            onClick={onSend}
            data-testid='guid-send-btn'
            aria-label={t('common.send')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.actionRow}>
      <div className={styles.actionTools}>
        <div className={styles.actionEntry}>
          <Dropdown trigger='hover' onVisibleChange={setIsPlusDropdownOpen} droplist={menuContent}>
            <span className='flex items-center gap-4px cursor-pointer lh-[1]'>
              <Button
                type='secondary'
                shape='circle'
                className={isPlusDropdownOpen ? styles.plusButtonRotate : ''}
                icon={<Plus theme='outline' size='14' strokeWidth={2} fill={iconColors.primary} />}
                loading={uploading}
                disabled={uploading}
                data-testid='file-upload-btn'
              />
              {files.length > 0 && (
                <Tooltip
                  className={'!max-w-max'}
                  content={<span className='whitespace-break-spaces'>{getCleanFileNames(files).join('\n')}</span>}
                >
                  <span className='text-t-primary'>File({files.length})</span>
                </Tooltip>
              )}
            </span>
          </Dropdown>
          {isWebUI && (
            <input
              ref={fileInputRef}
              type='file'
              multiple
              style={{ display: 'none' }}
              onChange={handleLocalFileChange}
            />
          )}
        </div>
      </div>
      <div className={styles.actionSubmit}>
        {superAvailable && onToggleSuper && (
          <Tooltip content={superEnabled ? t('workspace.super.onHint') : t('workspace.super.offHint')}>
            <Button
              size='small'
              type={superEnabled ? 'primary' : 'secondary'}
              icon={<Lightning theme={superEnabled ? 'filled' : 'outline'} size='14' />}
              onClick={onToggleSuper}
            >
              {t('workspace.super.label')}
            </Button>
          </Tooltip>
        )}
        {configOptionCount > 0 && (
          <div className={styles.actionConfigGroup} data-mobile={isMobile ? 'true' : undefined}>
            {modelSelectorNode}

            {showModeSwitch && (
              <AgentModeSelector
                backend={modeBackend}
                compact
                initialMode={selectedMode}
                onModeSelect={onModeSelect}
                compactLeadingIcon={<Shield theme='outline' size='14' fill={iconColors.secondary} />}
                modeLabelFormatter={getModeDisplayLabel}
              />
            )}
          </div>
        )}

        {!hidePresetTag && is_presetAgent && selectedAgentInfo && (
          <div className={styles.actionPresetAgent}>
            <PresetAgentTag
              agentInfo={selectedAgentInfo}
              assistants={assistants}
              localeKey={localeKey}
              onClose={onClosePresetTag}
              agentLogo={agentLogo}
              agentSwitcherItems={agentSwitcherItems}
              onAgentSwitch={onAgentSwitch}
            />
          </div>
        )}

        {speechInputNode}
        <Button
          shape='circle'
          type='primary'
          loading={loading}
          disabled={isButtonDisabled}
          className='send-button-custom'
          icon={<ArrowUp theme='filled' size='14' fill='white' strokeWidth={5} />}
          onClick={onSend}
          data-testid='guid-send-btn'
        />
      </div>
    </div>
  );
};

export default GuidActionRow;
