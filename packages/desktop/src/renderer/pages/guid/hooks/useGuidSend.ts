/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { WorkspaceReferenceRequest } from '@/common/chat/workspaceReference';
import {
  serializeAttachmentReferences,
  type SemanticAttachmentReference,
} from '@/common/chat/semanticAttachmentReference';
import type { CapabilityMode, IMcpServer, TChatConversation, TProviderWithModel } from '@/common/config/storage';
import { buildAgentConversationParams, isTomnyAgentBackend } from '@/common/utils/buildAgentConversationParams';
import { toSessionMcpServer } from '@/renderer/hooks/mcp/catalog';
import { emitter } from '@/renderer/utils/emitter';
import { buildDisplayMessage } from '@/renderer/utils/file/messageFiles';
import { withResponseLanguageDirective } from '@/renderer/services/i18n/responseLanguage';
import { updateWorkspaceTime } from '@/renderer/utils/workspace/workspaceHistory';
import {
  BROWSER_CONTROL_MCP_NAME,
  withSuperBrowserRules,
  withIdeMemoryRules,
} from '@/renderer/pages/conversation/hooks/superGuidance';
import { Message } from '@arco-design/web-react';
import { runGuideCommand } from '@/renderer/components/Spotlight/spotlightBus';
import { runScheduleCommand } from '@/renderer/pages/cron/scheduleDraft';
import { handlePersonalMemoryCommand } from '@/renderer/services/personalMemoryCommand';
import { useCallback, useRef } from 'react';
import { type TFunction } from 'i18next';
import type { NavigateFunction } from 'react-router-dom';
import type { AcpModelInfo, AvailableAgent, EffectiveAgentInfo } from '../types';

export type GuidSendDeps = {
  // Input state
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  files: string[];
  setFiles: React.Dispatch<React.SetStateAction<string[]>>;
  attachmentReferences: readonly SemanticAttachmentReference[];
  workspaceReferences: WorkspaceReferenceRequest[];
  setWorkspaceReferences: React.Dispatch<React.SetStateAction<WorkspaceReferenceRequest[]>>;
  dir: string;
  setDir: React.Dispatch<React.SetStateAction<string>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  loading: boolean;

  // Agent state
  selectedAgent: string;
  selectedAgentKey: string;
  selectedAgentInfo: AvailableAgent | undefined;
  is_presetAgent: boolean;
  selectedMode: string;
  selectedAcpModel: string | null;
  currentAcpCachedModelInfo: AcpModelInfo | null;
  current_model: TProviderWithModel | undefined;

  // Agent helpers
  findAgentByKey: (key: string) => AvailableAgent | undefined;
  getEffectiveAgentType: (
    agentInfo: { agent_type: string; backend?: string; custom_agent_id?: string } | undefined
  ) => EffectiveAgentInfo;
  resolvePresetRulesAndSkills: (
    agentInfo: { agent_type: string; backend?: string; custom_agent_id?: string; context?: string } | undefined
  ) => Promise<{ rules?: string; skills?: string }>;
  resolveEnabledSkills: (
    agentInfo: { agent_type: string; backend?: string; custom_agent_id?: string } | undefined
  ) => string[] | undefined;
  resolveDisabledBuiltinSkills: (
    agentInfo: { agent_type: string; backend?: string; custom_agent_id?: string } | undefined
  ) => string[] | undefined;
  guidDisabledBuiltinSkills: string[] | undefined;
  guidEnabledSkills: string[] | undefined;
  availableMcpServers: IMcpServer[];
  selectedMcpServerIds: string[] | undefined;
  /** Default tool ids of the applied assistant; stored on the new conversation and checked by Main. */
  assistantDefaultToolIds?: string[];
  /** `auto` pools every enabled MCP server for the backend selector instead of the hidden manual list. */
  capabilityMode: CapabilityMode;
  currentEffectiveAgentInfo: EffectiveAgentInfo;
  isGoogleAuth: boolean;

  // Mention state reset
  setMentionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMentionQuery: React.Dispatch<React.SetStateAction<string | null>>;
  setMentionSelectorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMentionActiveIndex: React.Dispatch<React.SetStateAction<number>>;

  // Navigation
  navigate: NavigateFunction;
  /**
   * Conversation of the live agent tile selected on Home. When set, the next send continues
   * that conversation instead of creating a new agent tile for the same command.
   */
  continueConversationId?: string;
  t: TFunction;
};

export type GuidSendResult = {
  handleSend: () => Promise<void>;
  sendMessageHandler: () => void;
  isButtonDisabled: boolean;
};

/**
 * Hook that manages the send logic for all conversation types (openclaw/nanobot/acp).
 */
export const useGuidSend = (deps: GuidSendDeps): GuidSendResult => {
  const {
    input,
    setInput,
    files,
    setFiles,
    attachmentReferences,
    workspaceReferences,
    setWorkspaceReferences,
    dir,
    setDir,
    setLoading,
    loading,
    selectedAgent,
    selectedAgentKey,
    selectedAgentInfo,
    is_presetAgent,
    selectedMode,
    selectedAcpModel,
    currentAcpCachedModelInfo,
    current_model,
    findAgentByKey,
    getEffectiveAgentType,
    resolvePresetRulesAndSkills,
    resolveEnabledSkills,
    resolveDisabledBuiltinSkills,
    guidDisabledBuiltinSkills,
    guidEnabledSkills,
    availableMcpServers,
    selectedMcpServerIds,
    assistantDefaultToolIds,
    capabilityMode,
    setMentionOpen,
    setMentionQuery,
    setMentionSelectorOpen,
    setMentionActiveIndex,
    navigate,
    continueConversationId,
    t,
  } = deps;
  const sendingRef = useRef(false);

  const displayInput = serializeAttachmentReferences(input, attachmentReferences, 'display');
  const modelInput = serializeAttachmentReferences(input, attachmentReferences, 'model');

  const handleSend = useCallback(async () => {
    // /guide points at a control instead of starting a conversation.
    const guide = runGuideCommand(input);
    if (guide.handled) {
      setInput('');
      if (!guide.found)
        Message.info('Mô tả vị trí cần tìm, ví dụ: /guide cài đặt, /guide chế độ Super, /guide thông báo');
      return;
    }
    // /schedule opens the new-task form filled in; nothing runs until the user confirms there.
    if (runScheduleCommand(input)) {
      setInput('');
      return;
    }
    // /remember and /forget edit the personal memory directly; the model never sees them.
    if (handlePersonalMemoryCommand(input)) {
      setInput('');
      return;
    }
    // Replying to a live tile selected on Home continues that agent's conversation. Every
    // branch below starts by creating a conversation, which is what used to spawn a second
    // agent tile for a command the user meant for the one already on screen.
    if (continueConversationId) {
      const existing = await ipcBridge.conversation.get
        .invoke({ id: continueConversationId })
        .catch((): undefined => undefined);
      if (existing?.id) {
        const displayMessage = buildDisplayMessage(displayInput, files, existing.extra.workspace || dir || '');
        const result = await ipcBridge.conversation.sendMessage.invoke({
          conversation_id: existing.id,
          input: displayMessage,
          model_input: withResponseLanguageDirective(
            buildDisplayMessage(modelInput, files, existing.extra.workspace || dir || ''),
            existing.id
          ),
          files,
          workspace_references: workspaceReferences,
        });
        if (!result?.msg_id) throw new Error('HOME_SEND_NOT_ACCEPTED');
        if (dir) updateWorkspaceTime(dir);
        emitter.emit('chat.history.refresh');
        return;
      }
      // The selected conversation is gone; fall through and start a fresh one instead.
    }

    const isCustomWorkspace = !!dir;
    const finalWorkspace = dir || '';

    const agentInfo = selectedAgentInfo;
    const is_preset = is_presetAgent;
    const preset_assistant_id = is_preset ? agentInfo?.custom_agent_id : undefined;

    const { agent_type: effectiveAgentType } = getEffectiveAgentType(agentInfo);

    const { rules: preset_rules } = await resolvePresetRulesAndSkills(agentInfo);
    // Guid page's per-conversation skill overrides take precedence over the
    // assistant's saved defaults. The combined skills menu lets the user pick
    // any custom skill — not just preset-declared ones — so for non-preset
    // agents we still forward the user's selection (the backend accepts
    // `preset_enabled_skills` regardless of `is_preset`).
    const presetEnabledSkillsDefault = resolveEnabledSkills(agentInfo);
    const enabled_skills = guidEnabledSkills ?? presetEnabledSkillsDefault;
    const enabled_skills_to_send = is_presetAgent
      ? enabled_skills
      : guidEnabledSkills?.length
        ? guidEnabledSkills
        : undefined;
    const excludeBuiltinSkills = guidDisabledBuiltinSkills ?? resolveDisabledBuiltinSkills(agentInfo);
    // Auto select pools every server the user enabled; the backend narrows that pool for each request.
    const selectedMcpServerIdSet = new Set(
      capabilityMode === 'auto'
        ? availableMcpServers.filter((server) => server.enabled).map((server) => server.id)
        : (selectedMcpServerIds ?? [])
    );
    const selectedUserMcpServerIds = availableMcpServers
      .filter((server) => selectedMcpServerIdSet.has(server.id) && server.builtin !== true)
      .map((server) => server.id);
    const selectedAllSessionMcpServers = availableMcpServers
      .filter((server) => selectedMcpServerIdSet.has(server.id))
      .map((server) => toSessionMcpServer(server));
    const selectedSessionMcpServers = availableMcpServers
      .filter((server) => selectedMcpServerIdSet.has(server.id) && server.builtin === true)
      .map((server) => toSessionMcpServer(server));

    // Super = the Browser-Control MCP is among the selected servers. When on, the
    // agent must be told to use the embedded `browser_*` tools (not spawn
    // sub-agents / shell out to open a browser, which fails on Windows and has no
    // tools). We append standing browser rules to the conversation's rules layer.
    const superSelected = availableMcpServers.some(
      (server) => server.name === BROWSER_CONTROL_MCP_NAME && selectedMcpServerIdSet.has(server.id)
    );
    /** Append Super browser rules to a rules string only when Super is selected. */
    const withSuperRules = (rules?: string): string | undefined =>
      superSelected ? withSuperBrowserRules(rules) : rules;

    const finalEffectiveAgentType = effectiveAgentType;

    const startConversation = async (conversation: TChatConversation, storagePrefix: string): Promise<void> => {
      // Preset screens and Tomny command controls still need their conversation-page controller.
      const needsConversationPage =
        is_preset || (conversation.type === 'tomnyagentic' && input.trimStart().startsWith('/'));
      if (needsConversationPage) {
        sessionStorage.setItem(
          `${conversation.type === 'remote' ? 'remote' : storagePrefix}_initial_message_${conversation.id}`,
          JSON.stringify({
            input: displayInput,
            files: files.length > 0 ? files : undefined,
            workspace_references: workspaceReferences.length > 0 ? workspaceReferences : undefined,
          })
        );
        await navigate(`/conversation/${conversation.id}`);
        return;
      }
      const displayMessage = buildDisplayMessage(displayInput, files, conversation.extra.workspace ?? finalWorkspace);
      // The same governed native seam starts the run; no mounted chat page or optional package is required.
      const result = await ipcBridge.conversation.sendMessage.invoke({
        conversation_id: conversation.id,
        input: displayMessage,
        model_input: withResponseLanguageDirective(
          buildDisplayMessage(modelInput, files, conversation.extra.workspace ?? finalWorkspace),
          conversation.id
        ),
        files,
        workspace_references: workspaceReferences,
      });
      if (!result?.msg_id) throw new Error('HOME_SEND_NOT_ACCEPTED');
      emitter.emit('chat.history.refresh');
    };

    // OpenClaw Gateway path
    if (selectedAgent === 'openclaw-gateway') {
      const openclawAgentInfo = agentInfo || findAgentByKey(selectedAgentKey);
      const openclawConversationParams = buildAgentConversationParams({
        backend: openclawAgentInfo?.backend || 'openclaw-gateway',
        name: input,
        agent_name: openclawAgentInfo?.name,
        preset_assistant_id,
        workspace: finalWorkspace,
        model: current_model!,
        cli_path: openclawAgentInfo?.cli_path,
        custom_agent_id: openclawAgentInfo?.custom_agent_id,
        custom_workspace: isCustomWorkspace,
        extra: {
          default_files: files,
          runtime_validation: {
            expected_workspace: finalWorkspace,
            expected_backend: openclawAgentInfo?.backend,
            expected_agent_name: openclawAgentInfo?.name,
            expected_cli_path: openclawAgentInfo?.cli_path,
            expected_model: current_model?.use_model,
            switched_at: Date.now(),
          },
          preset_enabled_skills: enabled_skills_to_send,
          exclude_auto_inject_skills: excludeBuiltinSkills,
        },
      });

      try {
        const conversation = await ipcBridge.conversation.create.invoke(openclawConversationParams);

        if (!conversation || !conversation.id) {
          throw new Error('HOME_CREATE_NOT_ACCEPTED');
        }

        if (isCustomWorkspace) {
          updateWorkspaceTime(finalWorkspace);
        }

        emitter.emit('chat.history.refresh');

        await startConversation(conversation, 'openclaw');
      } catch (error: unknown) {
        console.error('Failed to start OpenClaw conversation:', error);
        throw error;
      }
      return;
    }

    // Nanobot path
    if (selectedAgent === 'nanobot') {
      const nanobotAgentInfo = agentInfo || findAgentByKey(selectedAgentKey);
      const nanobotConversationParams = buildAgentConversationParams({
        backend: nanobotAgentInfo?.backend || 'nanobot',
        name: input,
        agent_name: nanobotAgentInfo?.name,
        preset_assistant_id,
        workspace: finalWorkspace,
        model: current_model!,
        custom_agent_id: nanobotAgentInfo?.custom_agent_id,
        custom_workspace: isCustomWorkspace,
        extra: {
          default_files: files,
          preset_enabled_skills: enabled_skills_to_send,
          exclude_auto_inject_skills: excludeBuiltinSkills,
        },
      });

      try {
        const conversation = await ipcBridge.conversation.create.invoke(nanobotConversationParams);

        if (!conversation || !conversation.id) {
          throw new Error('HOME_CREATE_NOT_ACCEPTED');
        }

        if (isCustomWorkspace) {
          updateWorkspaceTime(finalWorkspace);
        }

        emitter.emit('chat.history.refresh');

        await startConversation(conversation, 'nanobot');
      } catch (error: unknown) {
        console.error('Failed to start Nanobot conversation:', error);
        throw error;
      }
      return;
    }

    // TomnyAgentic path (direct selection or preset assistant with tomnyagentic as main agent)
    if (isTomnyAgentBackend(selectedAgent) || (is_preset && isTomnyAgentBackend(finalEffectiveAgentType))) {
      // Allow conversation creation without model - the chat pipeline will handle model selection or prompt for connection
      try {
        const tomnyMemId = crypto.randomUUID();
        const tomnyBaseRules = withSuperRules(is_preset ? preset_rules : undefined);
        const conversation = await ipcBridge.conversation.create.invoke({
          type: 'tomnyagentic',
          name: input,
          model: current_model,
          extra: {
            default_files: files,
            workspace: finalWorkspace,
            custom_workspace: isCustomWorkspace,
            preset_rules: withIdeMemoryRules(tomnyMemId, tomnyBaseRules),
            preset_enabled_skills: enabled_skills_to_send,
            exclude_auto_inject_skills: excludeBuiltinSkills,
            selected_mcp_server_ids: selectedUserMcpServerIds,
            assistant_default_tools: assistantDefaultToolIds ?? [],
            // tomnyagentic should consume the authoritative session snapshot, just
            // like team MCP does, instead of reloading only user servers from
            // the global MCP repository at runtime.
            selected_session_mcp_servers: selectedAllSessionMcpServers,
            preset_assistant_id,
            session_mode: selectedMode,
            ide_memory_id: tomnyMemId,
            capabilityMode,

          },
        });

        if (!conversation || !conversation.id) {
          throw new Error('HOME_CREATE_NOT_ACCEPTED');
        }

        if (isCustomWorkspace) {
          updateWorkspaceTime(finalWorkspace);
        }

        emitter.emit('chat.history.refresh');

        await startConversation(conversation, 'tomnyagentic');
      } catch (error: unknown) {
        console.error('Failed to start Tomny Agentic conversation:', error);
        throw error;
      }
      return;
    }

    // Remaining agent path (ACP/remote/custom, including preset fallbacks)
    {
      // Agent-type fallback only applies to preset assistants whose primary agent
      // was unavailable and got switched. For non-preset
      // agents (including extension-contributed ACP adapters with backend='custom'),
      // we must keep the original selectedAgent so the correct backend/cli_path is used.
      const agent_typeChanged = is_preset && selectedAgent !== finalEffectiveAgentType;
      const acpBackend: string | undefined = agent_typeChanged
        ? finalEffectiveAgentType
        : is_preset
          ? finalEffectiveAgentType
          : selectedAgent;

      const acpAgentInfo = agent_typeChanged
        ? findAgentByKey(acpBackend as string)
        : agentInfo || findAgentByKey(selectedAgentKey);

      if (!acpAgentInfo && !is_preset) {
        console.warn(`${acpBackend} CLI not found, but proceeding to let conversation panel handle it.`);
      }
      const agentBackend = acpBackend || selectedAgent;
      const acpMemId = crypto.randomUUID();
      const acpBaseRules = withSuperRules(is_preset ? preset_rules : undefined);
      const agentConversationParams = buildAgentConversationParams({
        backend: agentBackend,
        name: input,
        // For row-scoped rows (custom ACP / remote) the backend factory
        // needs the actual catalog id — `backend` collapses to the `custom`
        // slot so it cannot discriminate between rows on its own.
        agent_id: acpAgentInfo?.id,
        agent_name: acpAgentInfo?.name,
        preset_assistant_id,
        workspace: finalWorkspace,
        model: current_model!,
        cli_path: acpAgentInfo?.cli_path,
        custom_agent_id: acpAgentInfo?.custom_agent_id,
        custom_workspace: isCustomWorkspace,
        is_preset,
        preset_agent_type: finalEffectiveAgentType,
        preset_resources:
          is_preset || superSelected
            ? {
                rules: withIdeMemoryRules(acpMemId, acpBaseRules),
                enabled_skills,
                exclude_auto_inject_skills: excludeBuiltinSkills,
              }
            : undefined,
        session_mode: selectedMode,
        current_model_id: selectedAcpModel || currentAcpCachedModelInfo?.current_model_id || undefined,
        extra: {
          default_files: files,
          exclude_auto_inject_skills: excludeBuiltinSkills,
          selected_mcp_server_ids: selectedUserMcpServerIds,
          selected_session_mcp_servers: selectedSessionMcpServers,
          ide_memory_id: acpMemId,
          capabilityMode,

          // Non-preset agents still forward user-selected custom skills via the
          // shared backend slot. For preset assistants this is already wired
          // through `preset_resources.enabled_skills` above.
          ...(is_preset ? {} : guidEnabledSkills?.length ? { preset_enabled_skills: guidEnabledSkills } : {}),
        },
      });

      try {
        const conversation = await ipcBridge.conversation.create.invoke(agentConversationParams);
        if (!conversation || !conversation.id) {
          throw new Error('HOME_CREATE_NOT_ACCEPTED');
        }

        if (isCustomWorkspace) {
          updateWorkspaceTime(finalWorkspace);
        }

        emitter.emit('chat.history.refresh');

        await startConversation(conversation, 'acp');
      } catch (error: unknown) {
        console.error('Failed to create ACP conversation:', error);
        throw error;
      }
    }
  }, [
    input,
    files,
    workspaceReferences,
    attachmentReferences,
    dir,
    selectedAgent,
    selectedAgentKey,
    selectedAgentInfo,
    is_presetAgent,
    selectedMode,
    selectedAcpModel,
    currentAcpCachedModelInfo,
    current_model,
    findAgentByKey,
    getEffectiveAgentType,
    resolvePresetRulesAndSkills,
    resolveEnabledSkills,
    resolveDisabledBuiltinSkills,
    guidDisabledBuiltinSkills,
    availableMcpServers,
    selectedMcpServerIds,
    assistantDefaultToolIds,
    capabilityMode,
    navigate,
    continueConversationId,
    t,
  ]);

  const sendMessageHandler = useCallback(() => {
    if (!input.trim() || loading || sendingRef.current) return;
    sendingRef.current = true;
    setLoading(true);
    handleSend()
      .then(() => {
        setInput((current) => (current === input ? '' : current));
        setMentionOpen(false);
        setMentionQuery(null);
        setMentionSelectorOpen(false);
        setMentionActiveIndex(0);
        setFiles((current) => current.filter((path) => !files.includes(path)));
        setWorkspaceReferences([]);
        if (is_presetAgent) setDir('');
      })
      .catch((error) => {
        console.error('Failed to send message:', error);
        Message.error(t('guid.hubHome.live.actionFailed'));
      })
      .finally(() => {
        sendingRef.current = false;
        setLoading(false);
      });
  }, [
    loading,
    input,
    files,
    workspaceReferences,
    is_presetAgent,
    attachmentReferences,
    t,
    handleSend,
    setLoading,
    setInput,
    setMentionOpen,
    setMentionQuery,
    setMentionSelectorOpen,
    setMentionActiveIndex,
    setFiles,
    setWorkspaceReferences,
    setDir,
  ]);

  // Calculate button disabled state
  const isButtonDisabled = loading || !input.trim();

  return {
    handleSend,
    sendMessageHandler,
    isButtonDisabled,
  };
};
