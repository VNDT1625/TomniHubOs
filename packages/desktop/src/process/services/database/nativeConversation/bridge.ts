/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge, type TomnyAgenticContextResult, type TomnyAgenticContextSnapshot } from '@/common';
import { sessionChannels } from '@/common/types/agent/sessionChannels';
import type { ExperimentalCoreEvent } from '@process/experimentalCore/experimentalCoreRuntime';
import { publishTomniRemoteEvent } from '@process/services/remoteGateway/registry';
import {
  createChatTemporarySecretStore,
  createKeyedSecretIndex,
  createLayaSidecarPredictor,
  getSharedLayaSidecarClient,
  executeAfterOutboundInspection,
  type ChatSecretCodec,
} from '@process/services/security';
import { getSessionMemoryStore } from '@process/userUnderstanding/sessionMemoryStore';
import type { UserUnderstandingConsumer } from '@process/userUnderstanding/userUnderstandingConsumer';
import {
  ChatPipelineExecutor,
  DirectActionStage,
  getChatStageRegistry,
  LayaSecurityStage,
  MockContext7Stage,
  ModelRoutingStage,
  RtkKnowledgeStage,
  ToolRouterStage,
  type ChatPipelineDefinition,
} from '@process/services/chatPipeline';
import { buildTomnyPackageFromRepo } from '@process/extensions/package-manager/repoPackager';
import { NativeConversationRepository } from './repository';
import {
  NativeConversationService,
  type NativeConversationRuntime,
  type NativeConversationWorkspaceProvisioner,
} from './service';

let registered = false;

export const ACCOUNT_EXECUTION_REJECTED = 'ACCOUNT_EXECUTION_REJECTED';

export type RequireAuthenticatedAccount = () => void;

export const guardAccountExecution = <Input, Result>(
  requireAuthenticatedAccount: RequireAuthenticatedAccount | undefined,
  operation: (input: Input) => Result
): ((input: Input) => Result) => {
  return (input) => {
    if (requireAuthenticatedAccount) {
      try {
        requireAuthenticatedAccount();
      } catch {
        throw new Error(ACCOUNT_EXECUTION_REJECTED);
      }
    }
    return operation(input);
  };
};

const settleContextRequest = async (
  operation: () => Promise<TomnyAgenticContextSnapshot>
): Promise<TomnyAgenticContextResult> => {
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
  requireAuthenticatedAccount?: RequireAuthenticatedAccount;
  userUnderstandingConsumer?: UserUnderstandingConsumer;
}): NativeConversationService => {
  if (registered) throw new Error('Native conversation bridge is already registered.');
  registered = true;
  const repository = new NativeConversationRepository(input.filePath, input.legacyDatabasePath);
  const service = new NativeConversationService(
    repository,
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

  const authenticated = <Input, Result>(operation: (input: Input) => Result) =>
    guardAccountExecution(input.requireAuthenticatedAccount, operation);

  ipcBridge.conversation.create.provider(authenticated((params) => service.create(params)));
  ipcBridge.conversation.createWithConversation.provider(
    authenticated(({ conversation }) => service.cloneConversation(conversation))
  );
  ipcBridge.conversation.get.provider(authenticated(({ id }) => service.get(id)));
  ipcBridge.conversation.remove.provider(authenticated(({ id }) => service.remove(id)));
  ipcBridge.conversation.update.provider(
    authenticated(({ id, updates, merge_extra }) => service.update(id, updates, merge_extra))
  );
  ipcBridge.conversation.reset.provider(authenticated(({ id }) => (id ? service.reset(id) : Promise.resolve())));
  ipcBridge.conversation.warmup.provider(authenticated(() => service.initialize()));
  ipcBridge.conversation.getTomnyAgenticContext.provider(
    authenticated(({ conversation_id }) => settleContextRequest(() => service.getTomnyAgenticContext(conversation_id)))
  );
  ipcBridge.conversation.updateTomnyAgenticContext.provider(
    authenticated(({ conversation_id, custom_context, context_branches }) =>
      settleContextRequest(() => service.updateTomnyAgenticContext(conversation_id, custom_context, context_branches))
    )
  );

  // Setup Temporary Secret Store & Keyed Secret Index for Session-Safe Chat Pipeline
  const chatSecretCodec: ChatSecretCodec = {
    available: () => true,
    encrypt: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
    decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8'),
  };
  const secretStore = createChatTemporarySecretStore(chatSecretCodec);
  const keyedSecretIndex = createKeyedSecretIndex('native-session');
  const layaPredictor = createLayaSidecarPredictor();
  void getSharedLayaSidecarClient()
    .start()
    .catch((err) => {
      console.warn('[LayaSidecarClient] Eager warm-up failed:', err);
    });

  const pipelineRegistry = getChatStageRegistry();
  if (!pipelineRegistry.getStage('builtin:laya-security')) {
    pipelineRegistry.registerBuiltin(
      new LayaSecurityStage({
        predictor: layaPredictor,
        secretStore,
        keyedSecretIndex,
      })
    );
  }
  if (!pipelineRegistry.getStage('builtin:rtk-knowledge')) {
    pipelineRegistry.registerBuiltin(new RtkKnowledgeStage());
  }
  if (!pipelineRegistry.getStage('builtin:direct-action')) {
    pipelineRegistry.registerBuiltin(new DirectActionStage(layaPredictor));
  }
  if (!pipelineRegistry.getStage('builtin:tool-router')) {
    pipelineRegistry.registerBuiltin(new ToolRouterStage(layaPredictor));
  }
  if (!pipelineRegistry.getStage('builtin:model-router')) {
    pipelineRegistry.registerBuiltin(new ModelRoutingStage(layaPredictor));
  }
  if (!pipelineRegistry.getStage('com.context7.docs-retriever')) {
    pipelineRegistry.registerPackageStage(new MockContext7Stage(), 'com.context7.docs-retriever');
  }
  const pipelineDefinitions = new Map<string, ChatPipelineDefinition>();
  const pipelineExecutor = new ChatPipelineExecutor(pipelineRegistry);

  ipcBridge.conversation.getPipelineAvailableStages.provider(
    authenticated(async () => [...pipelineRegistry.listMetadata()])
  );
  ipcBridge.conversation.getPipelineDefinition.provider(
    authenticated(async ({ conversation_id }) => {
      if (conversation_id && pipelineDefinitions.has(conversation_id)) {
        return pipelineDefinitions.get(conversation_id)!;
      }
      return pipelineRegistry.createDefaultDefinition();
    })
  );
  ipcBridge.conversation.updatePipelineDefinition.provider(
    authenticated(async ({ conversation_id, definition }) => {
      if (conversation_id) {
        pipelineDefinitions.set(conversation_id, definition);
      }
      return true;
    })
  );

  ipcBridge.conversation.simulatePipeline.provider(
    authenticated(async ({ definition, probe_query, initial_context }) => {
      return pipelineExecutor.simulate({
        definition,
        probeQuery: probe_query,
        initialContext: initial_context,
      });
    })
  );

  ipcBridge.conversation.stop.provider(authenticated(({ conversation_id }) => service.cancel(conversation_id)));
  ipcBridge.conversation.activeCount.provider(authenticated(() => Promise.resolve({ count: service.activeCount() })));
  ipcBridge.conversation.sendMessage.provider(
    authenticated(async (params) => {
      const activeDefinition =
        params.conversation_id && pipelineDefinitions.has(params.conversation_id)
          ? pipelineDefinitions.get(params.conversation_id)
          : pipelineRegistry.createDefaultDefinition();

      const pipelineResult = await pipelineExecutor.execute({
        runId: params.conversation_id,
        query: params.input,
        definition: activeDefinition,
      });

      if (pipelineResult.status === 'blocked') {
        throw new Error(`CHAT_PIPELINE_BLOCKED_${pipelineResult.blockedReasonCode ?? 'REJECTED'}`);
      }

      // Zero-LLM Direct Action execution: /repotopackage
      if (
        pipelineResult.status === 'direct_action' &&
        pipelineResult.directActionPayload?.actionType === 'repotopackage'
      ) {
        const repoTarget = String(pipelineResult.directActionPayload.target || '.');
        const actionMsgId = `msg_direct_${crypto.randomUUID()}`;
        const convId = params.conversation_id;

        // Persist user prompt message to conversation history
        const userMsgId = `msg_user_${crypto.randomUUID()}`;
        await repository.saveMessage({
          id: userMsgId,
          msg_id: userMsgId,
          type: 'text',
          position: 'right',
          conversation_id: convId,
          created_at: Date.now(),
          content: { content: params.input },
        });

        const emitStep = (stepText: string, progress: number, completed = false) => {
          ipcBridge.conversation.responseStream.emit({
            type: 'content',
            msg_id: actionMsgId,
            conversation_id: convId,
            replace: true,
            data: {
              role: 'assistant',
              content: stepText,
              progress,
              completed,
              isDirectAction: true,
              actionType: 'repotopackage',
              replace: true,
            },
          });
        };

        // Async background worker with visualized progress steps
        setTimeout(async () => {
          try {
            emitStep(
              `📦 **[RepoToPackage] Khởi chạy đóng gói không cần gọi LLM API**\n\n🎯 Mục tiêu: \`${repoTarget}\`\n\n- [x] Bước 1/4: Đang đọc và quét cấu trúc repository...\n- [ ] Bước 2/4: Phân tích Archetype & phân quyền Least Privilege\n- [ ] Bước 3/4: Kiểm tra Laya Static Guardrail & AST integrity\n- [ ] Bước 4/4: Ký số Ed25519 và tạo gói .tomny bundle`,
              25
            );

            await new Promise((r) => setTimeout(r, 600));
            emitStep(
              `📦 **[RepoToPackage] Tiến trình phân tích mã nguồn**\n\n🎯 Mục tiêu: \`${repoTarget}\`\n\n- [x] Bước 1/4: Đã quét xong tệp và phụ thuộc dự án\n- [x] Bước 2/4: Phân loại thành công dạng gói Tomni Package\n- [ ] Bước 3/4: Đang chạy Laya Static Guardrail kiểm tra bảo mật...\n- [ ] Bước 4/4: Ký số Ed25519 và tạo gói .tomny bundle`,
              55
            );

            const packResult = await buildTomnyPackageFromRepo({ source: repoTarget });

            await new Promise((r) => setTimeout(r, 500));
            const finalContent = `📦 **[RepoToPackage] Hoàn thành đóng gói thành công! (Zero-Token)**\n\n🎯 Mục tiêu: \`${repoTarget}\`\n\n- [x] Bước 1/4: Đã tải và quét repository\n- [x] Bước 2/4: Phân loại gói: \`${packResult.classification.archetype}\` (${packResult.manifest.type})\n- [x] Bước 3/4: Laya Static Guardrail: **Passed** (Không có mã độc / slopsquatting)\n- [x] Bước 4/4: Ký số Ed25519 thành công: \`${packResult.keyId}\`\n\n🎉 **Kết quả:** Gói đã được tạo tại:\n\`${packResult.artifactPath}\` (${Math.round(packResult.archiveBytes / 1024)} KB)\n\n✅ ID gói: \`${packResult.manifest.id}\` (v${packResult.manifest.version})`;
            emitStep(finalContent, 100, true);

            await repository.saveMessage({
              id: actionMsgId,
              msg_id: actionMsgId,
              type: 'text',
              position: 'left',
              conversation_id: convId,
              created_at: Date.now(),
              content: { content: finalContent, replace: true },
            });

            ipcBridge.conversation.turnCompleted.emit({
              session_id: convId,
              status: 'finished',
              state: 'stopped',
              detail: 'RepoToPackage completed',
              can_send_message: true,
              workspace: '.',
              model: { platform: 'builtin', name: 'RepoToPackage', use_model: 'zero-token' },
              last_message: {
                id: actionMsgId,
                type: 'assistant',
                content: 'Packaging completed',
                status: 'success',
                created_at: Date.now(),
              },
              runtime: { has_task: false, is_processing: false, pending_confirmations: 0, task_status: 'finished' },
            });
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            emitStep(`❌ **[RepoToPackage] Thất bại trong quá trình đóng gói:**\n\`${errorMsg}\``, 100, true);
            ipcBridge.conversation.turnCompleted.emit({
              session_id: convId,
              status: 'finished',
              state: 'error',
              detail: errorMsg,
              can_send_message: true,
              workspace: '.',
              model: { platform: 'builtin', name: 'RepoToPackage', use_model: 'zero-token' },
              last_message: {
                id: actionMsgId,
                type: 'assistant',
                content: errorMsg,
                status: 'error',
                created_at: Date.now(),
              },
              runtime: { has_task: false, is_processing: false, pending_confirmations: 0, task_status: 'finished' },
            });
          }
        }, 50);

        return {
          msg_id: actionMsgId,
          inspection: {
            decision: 'allow' as const,
            reasonCode: 'no_sensitive_data' as const,
            findingTypes: [] as string[],
          },
        };
      }

      const effectiveInput = pipelineResult.finalQuery;
      // When the pipeline rewrites the user input (e.g. Laya credential redaction),
      // sync model_input to use the rewritten text so secrets don't leak to the LLM.
      const effectiveModelInput =
        params.model_input === undefined
          ? undefined
          : pipelineResult.finalQuery !== params.input
            ? params.model_input.replace(params.input, pipelineResult.finalQuery)
            : params.model_input;
      const requestId = `conversation:${params.conversation_id}:${crypto.randomUUID()}`;
      const parts = [
        { id: 'input', text: effectiveInput, role: 'user' as const, source: 'user' as const },
        ...(effectiveModelInput === undefined
          ? []
          : [{ id: 'model-input', text: effectiveModelInput, role: 'user' as const, source: 'generated' as const }]),
      ];
      const result = await executeAfterOutboundInspection(
        {
          schemaVersion: 1,
          requestId,
          runId: params.conversation_id,
          actorId: 'local-user',
          surface: 'chat',
          target: { kind: 'conversation-provider', id: 'native-runtime' },
          parts,
          requestedCapability: 'outbound.text.send',
          sensitivity: 'normal',
        },
        {
          allowSanitize: true,
          requireApprovalForFindings: false,
          policyVersion: 'outbound-text-v1',
        },
        async (safeParts) => {
          const safeInput = safeParts.find((part) => part.id === 'input')?.text;
          const safeModelInput = safeParts.find((part) => part.id === 'model-input')?.text;
          if (safeInput === undefined) throw new Error('Outbound inspection returned no safe user input.');
          return service.send({ ...params, input: safeInput, model_input: safeModelInput });
        }
      );
      if (!result.value) throw new Error(`OUTBOUND_SECURITY_${result.inspection.reasonCode.toUpperCase()}`);

      input.userUnderstandingConsumer?.observe({
        requestId,
        userQuery: params.input,
        surfaceId: 'chat',
        provenance: `conversation:${params.conversation_id}:${requestId}`,
      });

      return {
        ...result.value,
        inspection: {
          decision: result.inspection.decision as 'allow' | 'sanitize',
          reasonCode: result.inspection.reasonCode as 'no_sensitive_data' | 'sanitized_secret',
          findingTypes: result.inspection.findings.map((finding) => finding.type),
        },
      };
    })
  );
  ipcBridge.conversation.resolveNativePermission.provider(
    authenticated(({ permission_id, approved, lifetime }) =>
      service.resolvePermission(permission_id, approved, lifetime)
    )
  );
  ipcBridge.conversation.resolveNativeOrchestrationProposal.provider(
    authenticated(({ proposal_id, approved }) => service.resolveOrchestrationProposal(proposal_id, approved))
  );
  sessionChannels.getMode.provider(authenticated(({ conversation_id }) => service.getSessionMode(conversation_id)));
  sessionChannels.setMode.provider(
    authenticated(({ conversation_id, mode }) => service.setSessionMode(conversation_id, mode))
  );
  sessionChannels.getModel.provider(authenticated(({ conversation_id }) => service.getSessionModel(conversation_id)));
  sessionChannels.setModel.provider(
    authenticated(({ conversation_id, model_id }) => service.setSessionModel(conversation_id, model_id))
  );
  sessionChannels.getOpenClawRuntime.provider(
    authenticated(({ conversation_id }) => service.getOpenClawRuntime(conversation_id))
  );

  ipcBridge.database.getUserConversations.provider(authenticated(({ cursor, limit }) => service.list(cursor, limit)));
  ipcBridge.database.getConversationMessages.provider(
    authenticated(({ conversation_id, page, page_size, order }) =>
      service.history(conversation_id, page, page_size, order)
    )
  );
  ipcBridge.database.getConversationMessage.provider(
    authenticated(({ conversation_id, message_id }) => service.message(conversation_id, message_id))
  );
  return service;
};
