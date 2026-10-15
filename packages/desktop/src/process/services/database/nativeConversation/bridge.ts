/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import {
  ipcBridge,
  type SessionContextResult,
  type SessionContextSnapshot,
  type TomnyAgenticContextResult,
  type TomnyAgenticContextSnapshot,
} from '@/common';
import { sessionChannels } from '@/common/types/agent/sessionChannels';
import type { ExperimentalCoreEvent } from '@process/experimentalCore/experimentalCoreRuntime';
import { publishTomniRemoteEvent } from '@process/services/remoteGateway/registry';
import {
  createChatTemporarySecretStore,
  createKeyedSecretIndex,
  createLayaPipelinePredictor,
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
  ModelRoutingStage,
  OutputSecurityStage,
  RtkKnowledgeStage,
  ToolSchemaStage,
  UnderstandStage,
  buildRunTrace,
  buildOutboundParts,
  LAYA_WARMUP,
  composeSendParams,
  createToolSelectionMemory,
} from '@process/services/chatPipeline';
import type { PipelineRunTrace } from '@/common/types/pipeline';
import { applyModesToModelInput } from '@/common/chat/slash/modes';
import { decideCliSlashCommand, parseSlashCommandName } from '@/common/chat/slash/compatibility';
import { addPresentationGuidance } from '@/common/chat/presentationGuidance';
import {
  applyPackageCommandToModelInput,
  createPackageCommandService,
  type PackageCommandService,
} from '@process/integrations/connections/commands/packageCommandService';
import { createPipelineDefinitionStore, sanitizePipelineDefinition } from './pipelineDefinitionStore';
import { parseRepoToPackageSlash, startRepoToPackageTurn } from './repoPackagingTurn';
import { NativeConversationRepository } from './repository';
import { readMessagePage } from '@process/services/database/conversationPage/messagePage';
import {
  configureCapabilityConversationSource,
  resolveConversationCapabilityTurn,
  resolvePackageAttachmentTurn,
} from '@process/toolselect/wiring';
import type { LiveImageOutputStore } from '@process/services/liveImageOutputStore';
import { createProductionTurnNotePolicy } from './turnNotesWiring';
import {
  NativeConversationService,
  type NativeConversationRuntime,
  type NativeConversationWorkspaceProvisioner,
} from './service';

let registered = false;
const MAX_TRACKED_CONVERSATIONS = 200;

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

const settleSessionContextRequest = async (
  operation: () => Promise<SessionContextSnapshot>
): Promise<SessionContextResult> => {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    console.error('[NativeConversation] Session context request failed:', error);
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
  /** Main-owned account identity for protected live-image reads. */
  accountId?: () => string | undefined;
  liveImageOutputStore?: LiveImageOutputStore;
  /** Prompt commands of enabled packages. Defaults to the application's connection registry. */
  packageCommands?: PackageCommandService;
  userUnderstandingConsumer?: UserUnderstandingConsumer;
  e2eCapture?: ConstructorParameters<typeof NativeConversationService>[6];
  /** Wipes everything scoped to a session (for example temporary secrets) when its conversation ends. */
  onSessionEnded?: (sessionId: string) => void;
}): NativeConversationService => {
  if (registered) throw new Error('Native conversation bridge is already registered.');
  registered = true;
  const repository = new NativeConversationRepository(input.filePath, input.legacyDatabasePath);
  configureCapabilityConversationSource((conversationId) => repository.getConversation(conversationId));
  // Chains saved in the pipeline editor (per conversation, or the app default from Settings) survive a restart.
  const pipelineStore = createPipelineDefinitionStore(path.join(path.dirname(input.filePath), 'chat-pipelines.json'), {
    defaultDefinition: () => getChatStageRegistry().createDefaultDefinition(),
  });
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
      commandCatalog: (event) => ipcBridge.conversation.cliCommandsUpdated.emit(event),
    },
    input.workspaceProvisioner,
    getSessionMemoryStore(),
    // Turns worth remembering become session notes; Laya helps judge, a heuristic decides without it.
    createProductionTurnNotePolicy(createLayaPipelinePredictor()),
    input.e2eCapture,
    input.onSessionEnded
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
  ipcBridge.conversation.fork.provider(authenticated(({ id }) => service.forkConversation(id)));
  ipcBridge.conversation.remove.provider(
    authenticated(async ({ id }) => {
      const removed = await service.remove(id);
      pipelineStore.forget(id);
      return removed;
    })
  );
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
  ipcBridge.conversation.getSessionContext.provider(
    authenticated(({ conversation_id }) =>
      settleSessionContextRequest(() => service.getSessionContext(conversation_id))
    )
  );
  ipcBridge.conversation.updateSessionContext.provider(
    authenticated(({ conversation_id, custom_context, context_branches }) =>
      settleSessionContextRequest(() => service.updateSessionContext(conversation_id, custom_context, context_branches))
    )
  );

  ipcBridge.conversation.readLiveImageOutput.provider(
    authenticated(({ conversation_id, output_id, output_ref }) => {
      const accountId = input.accountId?.();
      if (!accountId) return Promise.resolve(null);
      return (
        input.liveImageOutputStore?.read({
          accountId,
          conversationId: conversation_id,
          outputId: output_id,
          outputRef: output_ref,
        }) ?? Promise.resolve(null)
      );
    })
  );

  // Prompt commands of enabled packages: listed for the `/` menu here, expanded where a message is sent.
  const packageCommands =
    input.packageCommands ??
    createPackageCommandService(async () => {
      const { getConnectionRegistry } = await import('@process/extensions/package-manager/packageBridge');
      return getConnectionRegistry();
    });
  ipcBridge.conversation.packageCommands.provider(authenticated(() => packageCommands.list()));
  ipcBridge.conversation.getCliCommands.provider(
    authenticated(({ conversation_id }) => service.getCliCommands(conversation_id))
  );

  // Setup Temporary Secret Store & Keyed Secret Index for Session-Safe Chat Pipeline
  const chatSecretCodec: ChatSecretCodec = {
    available: () => true,
    encrypt: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
    decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8'),
  };
  const secretStore = createChatTemporarySecretStore(chatSecretCodec);
  const keyedSecretIndex = createKeyedSecretIndex('native-session');
  // A person is waiting on this path, so a model that is still loading answers "not ready" at once.
  getSharedLayaSidecarClient().setWarmup(LAYA_WARMUP.state, LAYA_WARMUP.questions);
  const layaPredictor = createLayaPipelinePredictor();
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
  // Security, understand and tool schema all read the same Laya forward pass (one call per distinct input).
  if (!pipelineRegistry.getStage('builtin:understand')) {
    pipelineRegistry.registerBuiltin(new UnderstandStage(layaPredictor));
  }
  if (!pipelineRegistry.getStage('builtin:direct-action')) {
    pipelineRegistry.registerBuiltin(new DirectActionStage(layaPredictor));
  }
  if (!pipelineRegistry.getStage('builtin:tool-schema')) {
    pipelineRegistry.registerBuiltin(new ToolSchemaStage(layaPredictor));
  }
  // Pipelines saved before the router became the tool-schema stage keep working.
  pipelineRegistry.registerAlias('builtin:tool-router', 'builtin:tool-schema');
  if (!pipelineRegistry.getStage('builtin:rtk-knowledge')) {
    pipelineRegistry.registerBuiltin(new RtkKnowledgeStage());
  }
  if (!pipelineRegistry.getStage('builtin:model-router')) {
    pipelineRegistry.registerBuiltin(new ModelRoutingStage(layaPredictor));
  }
  if (!pipelineRegistry.getStage('builtin:output-security')) {
    pipelineRegistry.registerBuiltin(new OutputSecurityStage());
  }
  const lastPipelineRuns = new Map<string, PipelineRunTrace>();
  const remember = <T>(map: Map<string, T>, key: string, value: T): void => {
    map.delete(key);
    map.set(key, value);
    if (map.size > MAX_TRACKED_CONVERSATIONS) map.delete(map.keys().next().value as string);
  };
  const toolSelectionMemory = createToolSelectionMemory(MAX_TRACKED_CONVERSATIONS);
  const pipelineExecutor = new ChatPipelineExecutor(pipelineRegistry, { predictor: layaPredictor });
  // A stop received while Main is resolving or inspecting the prompt must prevent model dispatch.
  const preflightControllers = new Map<string, AbortController>();

  ipcBridge.conversation.getPipelineAvailableStages.provider(
    authenticated(async () => [...pipelineRegistry.listMetadata()])
  );
  ipcBridge.conversation.getPipelineDefinition.provider(
    authenticated(
      async ({ conversation_id }) =>
        pipelineStore.resolve(conversation_id) ?? pipelineRegistry.createDefaultDefinition()
    )
  );
  ipcBridge.conversation.updatePipelineDefinition.provider(
    authenticated(async ({ conversation_id, definition }) => {
      // Without a conversation the chain becomes the default for every conversation that has none of its own.
      const sanitized = sanitizePipelineDefinition(definition);
      if (!sanitized) return false;
      pipelineStore.save(conversation_id, sanitized);
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

  ipcBridge.conversation.getPipelineLastRun.provider(
    authenticated(async ({ conversation_id }) =>
      conversation_id ? (lastPipelineRuns.get(conversation_id) ?? null) : null
    )
  );

  ipcBridge.conversation.stop.provider(
    authenticated(async ({ conversation_id }) => {
      preflightControllers.get(conversation_id)?.abort(new Error('CHAT_PIPELINE_CANCELLED'));
      await service.cancel(conversation_id);
    })
  );
  ipcBridge.conversation.activeCount.provider(authenticated(() => Promise.resolve({ count: service.activeCount() })));
  ipcBridge.conversation.sendMessage.provider(
    authenticated(async (params) => {
      const conversationId = params.conversation_id;
      if (preflightControllers.has(conversationId)) throw new Error('CHAT_PIPELINE_ALREADY_RUNNING');
      const preflight = new AbortController();
      preflightControllers.set(conversationId, preflight);
      try {
        preflight.signal.throwIfAborted();
        // Provider-advertised commands MUST reach ACP as the exact one-block prompt.
        // Unknown commands are refused instead of silently becoming an ordinary model question.
        const conversation = await repository.getConversation(conversationId);
        if (conversation?.type === 'acp' && parseSlashCommandName(params.input)) {
          const catalog = await service.getCliCommands(conversationId);
          preflight.signal.throwIfAborted();
          const decision = decideCliSlashCommand(params.input, catalog);
          if (decision.kind === 'native') {
            if ((params.files?.length ?? 0) > 0 || (params.workspace_references?.length ?? 0) > 0) {
              throw new Error('CLI_COMMAND_ATTACHMENTS_UNSUPPORTED');
            }
                        const requestId = `conversation:cli:${conversationId}:${crypto.randomUUID()}`;
            const definition = structuredClone(
              pipelineStore.resolve(conversationId) ?? pipelineRegistry.createDefaultDefinition()
            );
            const outputRefs = definition.enabled
              ? definition.stages.filter((ref) => ref.enabled && ref.phase === 'post_model')
              : [];
            const outputGuard = outputRefs.some(
              (ref) => pipelineRegistry.getStage(ref.stageRegistryId)?.role === 'guard'
            );
            if (outputGuard) {
              const metadata = pipelineRegistry.listMetadata();
              if (outputRefs.some((ref) => {
                const stage = pipelineRegistry.getStage(ref.stageRegistryId);
                return stage?.role === 'guard' &&
                  !metadata.some((entry) => entry.id === stage.id && entry.authorizedGuard === true);
              })) throw new Error('CHAT_OUTPUT_GUARD_NOT_AUTHORIZED');
            }
            const guarded = await executeAfterOutboundInspection(
              {
                schemaVersion: 1,
                requestId,
                runId: conversationId,
                actorId: 'local-user',
                surface: 'chat',
                target: { kind: 'conversation-provider', id: 'native-runtime' },
                parts: [{ id: 'input', text: params.input, role: 'user', source: 'user' }],
                requestedCapability: 'outbound.text.send',
                sensitivity: 'normal',
              },
              { allowSanitize: true, requireApprovalForFindings: false, policyVersion: 'outbound-text-v1' },
              async (safeParts) => {
                const safe = safeParts.find((part) => part.id === 'input')?.text;
                if (safe !== params.input) throw new Error('CLI_COMMAND_INSPECTION_CHANGED_INPUT');
                preflight.signal.throwIfAborted();
                                                return service.send(
                  { ...params, input: safe, model_input: safe },
                  outputRefs.length
                    ? async (text, signal) => {
                        const result = await pipelineExecutor.execute({
                          runId: requestId,
                          direction: 'output',
                          query: text,
                          definition,
                          signal,
                        });
                        if (result.status !== 'completed' || result.executedStages.some((stage) => stage.error)) {
                          throw new Error('CHAT_OUTPUT_PROCESSING_FAILED');
                        }
                        return result.finalQuery;
                      }
                    : undefined,
                  preflight.signal, undefined, outputGuard, true
                );
              }
            );
            if (!guarded.value) throw new Error(`OUTBOUND_SECURITY_${guarded.inspection.reasonCode.toUpperCase()}`);
            return guarded.value;
          }
                    if (decision.kind === 'unsupported') {
            // A known native command lacking session/UI support must not fall through to a package with the same name.
            if (decision.reason === 'requires-session' || decision.reason === 'requires-ui') {
              throw new Error(`CLI_COMMAND_UNSUPPORTED:${decision.name}:${decision.reason}`);
            }
            const packageMatch = await packageCommands.expand(params.input);
            if (packageMatch === undefined) {
              throw new Error(`CLI_COMMAND_UNSUPPORTED:${decision.name}:${decision.reason}`);
            }
          }
        }
        // /repotopackage is a command, not a question: it never goes through the pipeline or an agent.
        const repoToPackageTarget = parseRepoToPackageSlash(params.input);
        if (repoToPackageTarget !== undefined && params.conversation_id) {
          return startRepoToPackageTurn({
            repository,
            conversationId: params.conversation_id,
            input: params.input,
            target: repoToPackageTarget,
          });
        }

        // A command of an enabled package (/name args): the bubble keeps the typed line, the agent gets the filled
        // template. Shell syntax in the template is never run (see common/integrations/commands/commandTemplate.ts).
        const packageCommand = await packageCommands.expand(params.input);
        preflight.signal.throwIfAborted();
        if (packageCommand !== undefined) {
          params = {
            ...params,
            model_input: applyPackageCommandToModelInput(params.input, params.model_input, packageCommand.modelInput),
          };
        }

        // A mode at the start (/boost, /mermaid, ...) is explained to the model without changing what the bubble shows.
        const modeModelInput = applyModesToModelInput(params.input, params.model_input);
        if (modeModelInput !== undefined) params = { ...params, model_input: modeModelInput };
        // Give all native conversation providers the same lightweight display capability guidance.
        const presentationInput = addPresentationGuidance(params.input, params.model_input);
        if (presentationInput !== undefined) params = { ...params, model_input: presentationInput };

        const sendStartedAt = performance.now();
        const sendMark = (label: string): void =>
          console.info(`[Tomny:send] ${label} +${Math.round(performance.now() - sendStartedAt)}ms`);
        preflight.signal.throwIfAborted();
        const activeDefinition = structuredClone(
          pipelineStore.resolve(params.conversation_id) ?? pipelineRegistry.createDefaultDefinition()
        );
        const outputRefs = activeDefinition.enabled
          ? activeDefinition.stages.filter((ref) => ref.enabled && ref.phase === 'post_model')
          : [];
        // Reject stale or phase-mismatched references before any assistant output can be published.
        if (
          outputRefs.some((ref) => {
            const stage = pipelineRegistry.getStage(ref.stageRegistryId);
            return !stage || stage.phase !== 'post_model';
          })
        ) {
          throw new Error('CHAT_OUTPUT_STAGE_UNAVAILABLE');
        }
        // A guard must be Main-authorized. Any guard forces completed-text buffering before publish/persist.
        const metadata = pipelineRegistry.listMetadata();
        const outputHasGuard = outputRefs.some(
          (ref) => pipelineRegistry.getStage(ref.stageRegistryId)?.role === 'guard'
        );
        if (
          outputHasGuard &&
          outputRefs.some((ref) => {
            const stage = pipelineRegistry.getStage(ref.stageRegistryId);
            return (
              stage?.role === 'guard' &&
              !metadata.some((entry) => entry.id === stage.id && entry.authorizedGuard === true)
            );
          })
        ) {
          throw new Error('CHAT_OUTPUT_GUARD_NOT_AUTHORIZED');
        }

        const pipelineResult = await pipelineExecutor.execute({
          runId: params.conversation_id,
          query: params.input,
          definition: activeDefinition,
          signal: preflight.signal,
        });
        preflight.signal.throwIfAborted();
        if (pipelineResult.status === 'aborted') throw new Error('CHAT_PIPELINE_CANCELLED');
        sendMark(
          `pipeline(${pipelineResult.status}, laya=${getSharedLayaSidecarClient().ready ? 'ready' : 'loading'})`
        );
        if (params.conversation_id) {
          remember(lastPipelineRuns, params.conversation_id, buildRunTrace(params.conversation_id, pipelineResult));
        }

        if (pipelineResult.status === 'blocked') {
          throw new Error(`CHAT_PIPELINE_BLOCKED_${pipelineResult.blockedReasonCode ?? 'REJECTED'}`);
        }

        // A pipeline stage may also have recognised the command; the early check above normally wins first.
        if (
          pipelineResult.status === 'direct_action' &&
          pipelineResult.directActionPayload?.actionType === 'repotopackage'
        ) {
          return startRepoToPackageTurn({
            repository,
            conversationId: params.conversation_id,
            input: params.input,
            target: String(pipelineResult.directActionPayload.target || '.'),
          });
        }

        const toolSelection = toolSelectionMemory.next(params.conversation_id, pipelineResult.grounding);
        // A stage's string is only a proposal; Main checks the current target's model catalog.
        const autoAdvisorEnabled = activeDefinition.stages.some(
          (ref) =>
            ref.enabled &&
            ref.stageRegistryId === 'builtin:model-router' &&
            (ref.config?.mode === 'auto' || ref.config?.autoModelSelection === true)
        );
        const candidate = pipelineResult.grounding?.modelRouting;
        const recommendation =
          candidate && typeof candidate === 'object' && !Array.isArray(candidate)
            ? (candidate as Record<string, unknown>).recommendedModel
            : undefined;
        const proposedModel =
          autoAdvisorEnabled &&
          pipelineResult.executedStages.some(
            (stage) => stage.stageRegistryId === 'builtin:model-router' && stage.decision === 'continue'
          ) &&
          typeof recommendation === 'string' &&
          recommendation.length <= 160
            ? recommendation
            : undefined;
        const requestId = `conversation:${params.conversation_id}:${crypto.randomUUID()}`;
        // The pipeline's rewrite and the context its stages gathered leave as inspectable parts, so retrieved
        // text is checked at the send step like everything else.
        // Auto select: only a conversation in `auto` mode gets a turn choice, so manual sends are unchanged.
        // The query is the pipeline's redacted one. The hint joins the pipeline context, so it is inspected with it.
        const turnConversation = await repository.getConversation(params.conversation_id);
        const capabilityTurn = await resolveConversationCapabilityTurn(turnConversation, pipelineResult.finalQuery);
        // Enabled package plugins attach in every capability mode. Their block joins the context like the auto hint.
        const packageAttachment = await resolvePackageAttachmentTurn(turnConversation, capabilityTurn);
        const parts = buildOutboundParts(
          {
            finalQuery: pipelineResult.finalQuery,
            finalContext: [pipelineResult.finalContext, capabilityTurn?.hint, packageAttachment?.hint]
              .filter(Boolean)
              .join('\n\n'),
          },
          params
        );
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
            preflight.signal.throwIfAborted();
            return service.send(
              {
                ...composeSendParams(params, safeParts, toolSelection),
                capabilitySelection: capabilityTurn ?? null,
                packageAttachment: packageAttachment ?? null,
              },
              outputRefs.length
                ? async (text, signal) => {
                    const output = await pipelineExecutor.execute({
                      runId: requestId,
                      direction: 'output',
                      query: text,
                      definition: activeDefinition,
                      context: pipelineResult.finalContext,
                      grounding: structuredClone(pipelineResult.grounding),
                      signal,
                    });
                    if (output.status !== 'completed' || output.executedStages.some((stage) => stage.error)) {
                      throw new Error('CHAT_OUTPUT_PROCESSING_FAILED');
                    }
                    return output.finalQuery;
                  }
                : undefined,
              preflight.signal,
              proposedModel,
              outputHasGuard
            );
          }
        );
        preflight.signal.throwIfAborted();
        sendMark(`inspection+send(${result.inspection.decision})`);
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
      } finally {
        if (preflightControllers.get(conversationId) === preflight) preflightControllers.delete(conversationId);
      }
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
    authenticated(({ conversation_id, page, page_size, order, content_mode, known_revision }) =>
      readMessagePage(repository, {
        conversationId: conversation_id,
        page,
        pageSize: page_size,
        order,
        contentMode: content_mode,
        knownRevision: known_revision,
      })
    )
  );
  ipcBridge.database.getConversationMessage.provider(
    authenticated(({ conversation_id, message_id }) => service.message(conversation_id, message_id))
  );
  return service;
};
