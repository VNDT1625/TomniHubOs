/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge, type AionrsContextResult, type AionrsContextSnapshot } from '@/common';
import { sessionChannels } from '@/common/types/agent/sessionChannels';
import type { ExperimentalCoreEvent } from '@process/experimentalCore/experimentalCoreRuntime';
import { publishTomniRemoteEvent } from '@process/services/remoteGateway/registry';
import { getSessionMemoryStore } from '@process/ide/memory/sessionMemoryStore';
import { NativeConversationRepository } from './repository';
import {
  NativeConversationService,
  type NativeConversationRuntime,
  type NativeConversationWorkspaceProvisioner,
} from './service';

let registered = false;

const settleContextRequest = async (operation: () => Promise<AionrsContextSnapshot>): Promise<AionrsContextResult> => {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    console.error('[NativeConversation] Context request failed:', error);
    return { ok: false, error: 'context-unavailable' };
  }
};

/** Registers the production IPC contract used by the existing Conversation UI. */
export const registerNativeConversationBridge = (input: {
  filePath: string;

  legacyDatabasePath?: string | readonly string[];
  runtime: NativeConversationRuntime;
  workspaceProvisioner?: NativeConversationWorkspaceProvisioner;
  subscribeCore: (listener: (event: ExperimentalCoreEvent) => void) => () => void;
}): NativeConversationService => {
  if (registered) throw new Error('Native conversation bridge is already registered.');
  registered = true;
  const service = new NativeConversationService(
    new NativeConversationRepository(input.filePath, input.legacyDatabasePath),
    input.runtime,
    {
      response: (event) => {
        ipcBridge.conversation.responseStream.emit(event);
        publishTomniRemoteEvent({ kind: 'conversation.response', payload: event });
      },
      turnCompleted: (event) => {
        ipcBridge.conversation.turnCompleted.emit(event);
        publishTomniRemoteEvent({ kind: 'conversation.completed', payload: event });
      },
      listChanged: (event) => {
        ipcBridge.conversation.listChanged.emit(event);
        publishTomniRemoteEvent({ kind: 'conversation.list', payload: event });
      },
    },
    input.workspaceProvisioner,
    getSessionMemoryStore()
  );
  void service.initialize().catch((error) => console.error('[NativeConversation] Initialization failed:', error));
  input.subscribeCore((event) => service.handleCoreEvent(event));

  ipcBridge.conversation.create.provider((params) => service.create(params));
  ipcBridge.conversation.createWithConversation.provider(({ conversation }) => service.cloneConversation(conversation));
  ipcBridge.conversation.get.provider(({ id }) => service.get(id));
  ipcBridge.conversation.remove.provider(({ id }) => service.remove(id));
  ipcBridge.conversation.update.provider(({ id, updates, merge_extra }) => service.update(id, updates, merge_extra));
  ipcBridge.conversation.reset.provider(({ id }) => (id ? service.reset(id) : Promise.resolve()));
  ipcBridge.conversation.warmup.provider(() => service.initialize());
  ipcBridge.conversation.getAionrsContext.provider(({ conversation_id }) =>
    settleContextRequest(() => service.getAionrsContext(conversation_id))
  );
  ipcBridge.conversation.updateAionrsContext.provider(({ conversation_id, custom_context, context_branches }) =>
    settleContextRequest(() => service.updateAionrsContext(conversation_id, custom_context, context_branches))
  );
  ipcBridge.conversation.stop.provider(({ conversation_id }) => service.cancel(conversation_id));
  ipcBridge.conversation.activeCount.provider(() => Promise.resolve({ count: service.activeCount() }));
  ipcBridge.conversation.sendMessage.provider((params) => service.send(params));
  ipcBridge.conversation.resolveNativePermission.provider(({ permission_id, approved, lifetime }) =>
    service.resolvePermission(permission_id, approved, lifetime)
  );
  ipcBridge.conversation.resolveNativeOrchestrationProposal.provider(({ proposal_id, approved }) =>
    service.resolveOrchestrationProposal(proposal_id, approved)
  );
  sessionChannels.getMode.provider(({ conversation_id }) => service.getSessionMode(conversation_id));
  sessionChannels.setMode.provider(({ conversation_id, mode }) => service.setSessionMode(conversation_id, mode));
  sessionChannels.getModel.provider(({ conversation_id }) => service.getSessionModel(conversation_id));
  sessionChannels.setModel.provider(({ conversation_id, model_id }) =>
    service.setSessionModel(conversation_id, model_id)
  );
  sessionChannels.getOpenClawRuntime.provider(({ conversation_id }) => service.getOpenClawRuntime(conversation_id));

  ipcBridge.database.getUserConversations.provider(({ cursor, limit }) => service.list(cursor, limit));
  ipcBridge.database.getConversationMessages.provider(({ conversation_id, page, page_size, order }) =>
    service.history(conversation_id, page, page_size, order)
  );
  ipcBridge.database.getConversationMessage.provider(({ conversation_id, message_id }) =>
    service.message(conversation_id, message_id)
  );
  return service;
};
