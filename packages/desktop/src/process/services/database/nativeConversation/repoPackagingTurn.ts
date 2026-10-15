/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { runRepoToPackageChat } from '@process/extensions/package-manager/repoPackaging';
import type { NativeConversationRepository } from './repository';
import { createRepoToPackageEnvironment } from './repoToPackageEnvironment';
import { installReportLines } from '@process/integrations/connections/wiring/installReport';

/** Progress is saved at most this often while a run is going (ms). */
const PROGRESS_SAVE_INTERVAL_MS = 1000;

/** `/repotopackage [source] [options]`, matched on the whole message. */
const REPO_TO_PACKAGE_COMMAND = /^\s*\/repotopackage(?:\s+([\s\S]*))?$/iu;

/**
 * Returns the argument text of a `/repotopackage` message, or undefined when the message is something else.
 * The command is recognised here, before any pipeline stage or model, so a turn that starts with it never
 * reaches an agent no matter how the pipeline is configured or whether the decision model is ready.
 */
export const parseRepoToPackageSlash = (input: string): string | undefined => {
  const match = REPO_TO_PACKAGE_COMMAND.exec(input);
  if (!match) return undefined;
  const target = match[1]?.trim();
  return target === undefined || target === '' ? '.' : target;
};

/**
 * Installs the package that was just built as a `local-built` package (signed by this machine's key) and lets the
 * connection registry read what it offers. Data kinds switch on; code-running kinds only after the one confirmation the
 * person approves. A failure is reported without importing skills into the user's own catalog.
 */
const installLocalPackage = async (artifactPath: string): Promise<string> => {
  try {
    const { installLocalBuiltPackage } = await import('@process/extensions/package-manager/packageBridge');
    const installed = await installLocalBuiltPackage(artifactPath, { activateConnections: true });
    // The connections are on now. Open pages (Plugins, Hub, Store) read their lists again: the install's own state event came earlier.
    ipcBridge.packagePlatform.stateChanged.emit({ id: installed.packageId, state: 'installed' });
    const lines = [
      '',
      `✅ Đã cài gói \`${installed.packageId}\` (v${installed.version}) vào danh sách **Đã cài** với nhãn "Tạo trên máy này".`,
      ...installReportLines(installed),
    ];
    return lines.join('\n');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `\n⚠️ Gói đã tạo nhưng chưa cài được vào danh sách đã cài: ${reason}`;
  }
};

export type RepoToPackageTurnParams = Readonly<{
  repository: Pick<NativeConversationRepository, 'saveMessage' | 'getConversation'>;
  conversationId: string;
  input: string;
  target: string;
}>;

/**
 * Runs `/repotopackage` as a turn with no model: saves the user's message, streams the real packaging
 * progress into one assistant message, saves the outcome, and releases the chat. Returns immediately with
 * the id of that assistant message while packaging continues in the background.
 */
export const startRepoToPackageTurn = async (
  params: RepoToPackageTurnParams
): Promise<{
  msg_id: string;
  inspection: { decision: 'allow'; reasonCode: 'no_sensitive_data'; findingTypes: string[] };
}> => {
  const { repository, conversationId, input, target } = params;
  const actionMsgId = `msg_direct_${crypto.randomUUID()}`;
  const userMsgId = `msg_user_${crypto.randomUUID()}`;

  await repository.saveMessage({
    id: userMsgId,
    msg_id: userMsgId,
    type: 'text',
    position: 'right',
    conversation_id: conversationId,
    created_at: Date.now(),
    content: { content: input },
  });

  // The step text is also kept in the conversation, so a window reload shows what the run produced so far. Saves are
  // coalesced; the final message replaces the progress record under the same id.
  const createdAt = Date.now();
  let pendingSave: ReturnType<typeof setTimeout> | undefined;
  let latestText: string | undefined;
  const saveProgressMessage = (text: string, completed: boolean): Promise<void> =>
    repository.saveMessage({
      id: actionMsgId,
      msg_id: actionMsgId,
      type: 'text',
      position: 'left',
      conversation_id: conversationId,
      created_at: createdAt,
      content: { content: text, replace: true, repoRun: completed ? 'done' : 'running' },
    });
  const queueProgressSave = (text: string): void => {
    latestText = text;
    if (pendingSave !== undefined) return;
    pendingSave = setTimeout(() => {
      pendingSave = undefined;
      const latest = latestText;
      if (latest !== undefined) {
        saveProgressMessage(latest, false).catch((error: unknown) =>
          console.error('[RepoToPackage] Could not save progress:', error)
        );
      }
    }, PROGRESS_SAVE_INTERVAL_MS);
  };
  const cancelQueuedSave = (): void => {
    if (pendingSave !== undefined) clearTimeout(pendingSave);
    pendingSave = undefined;
  };

  const emitStep = (text: string, progress: number, completed = false): void => {
    if (completed) cancelQueuedSave();
    else queueProgressSave(text);
    ipcBridge.conversation.responseStream.emit({
      type: 'content',
      msg_id: actionMsgId,
      conversation_id: conversationId,
      replace: true,
      data: {
        role: 'assistant',
        content: text,
        progress,
        completed,
        isDirectAction: true,
        actionType: 'repotopackage',
        replace: true,
      },
    });
  };

  const releaseChat = (ok: boolean, detail: string, workspace: string, lastMessage: string): void => {
    // The chat page leaves its processing state on a stream `finish` frame, not on turnCompleted alone.
    ipcBridge.conversation.responseStream.emit({
      type: 'finish',
      data: { state: ok ? 'stopped' : 'error' },
      msg_id: actionMsgId,
      conversation_id: conversationId,
      created_at: Date.now(),
    });
    ipcBridge.conversation.turnCompleted.emit({
      session_id: conversationId,
      status: 'finished',
      state: ok ? 'stopped' : 'error',
      detail,
      can_send_message: true,
      workspace,
      model: { platform: 'builtin', name: 'RepoToPackage', use_model: 'zero-token' },
      last_message: {
        id: actionMsgId,
        type: 'assistant',
        content: lastMessage,
        status: ok ? 'success' : 'error',
        created_at: Date.now(),
      },
      runtime: { has_task: false, is_processing: false, pending_confirmations: 0, task_status: 'finished' },
    });
  };

  // Packaging runs in the background and streams its real progress into the assistant message.
  void (async () => {
    // The first frame goes out before the workspace lookup, so the user sees the command was understood.
    emitStep(`📦 **[RepoToPackage] Đang chuẩn bị**\n\n🎯 Nguồn: \`${target}\``, 0);
    const conversation = await repository.getConversation(conversationId).catch((): undefined => undefined);
    const workspaceValue = (conversation?.extra as Record<string, unknown> | undefined)?.workspace;
    const workspace = typeof workspaceValue === 'string' && workspaceValue.trim() !== '' ? workspaceValue : undefined;
    const outcome = await runRepoToPackageChat(target, createRepoToPackageEnvironment(workspace), (update) =>
      emitStep(update.text, update.progress, update.completed)
    );
    let finalText = outcome.text;
    // The package's MCP servers are connections of the package. The install below switches each one on or leaves it off, and
    // says which. Nothing is written to the MCP catalog here, so no disabled copy can disagree with the connection state.
    if (outcome.ok && outcome.artifactPath) {
      finalText += await installLocalPackage(outcome.artifactPath);
      emitStep(finalText, 100, true);
    }
    cancelQueuedSave();
    await saveProgressMessage(finalText, true);
    releaseChat(
      outcome.ok,
      outcome.ok ? 'RepoToPackage completed' : 'RepoToPackage failed',
      workspace ?? '.',
      outcome.ok ? 'Packaging completed' : 'Packaging failed'
    );
  })().catch((error: unknown) => {
    // The runner never throws; this only covers persistence failures, and must still release the UI.
    const message = error instanceof Error ? error.message : String(error);
    console.error('[RepoToPackage] Could not finish the direct action:', message);
    const failedText = `❌ **[RepoToPackage] Không hoàn tất được:** ${message}`;
    emitStep(failedText, 100, true);
    saveProgressMessage(failedText, true).catch((): undefined => undefined);
    releaseChat(false, message, '.', message);
  });

  return {
    msg_id: actionMsgId,
    inspection: { decision: 'allow', reasonCode: 'no_sensitive_data', findingTypes: [] },
  };
};
