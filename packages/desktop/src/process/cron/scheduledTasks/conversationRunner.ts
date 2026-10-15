/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IConversationTurnCompletedEvent,
  ICreateConversationParams,
  IResponseMessage,
} from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import { scopeAllowsTool } from './runtimeRunner';
import type { CoreScheduleRunInput, CoreScheduleRunner, CoreScheduledTask } from './types';

/** What the runner needs from the native conversation service and its event stream. */
export type ScheduledConversationPort = {
  get(id: string): Promise<TChatConversation | undefined>;
  create(params: ICreateConversationParams): Promise<TChatConversation>;
  send(params: { conversation_id: string; input: string; model_input?: string }): Promise<unknown>;
  cancel(conversationId: string): Promise<void>;
  resolvePermission(permissionId: string, approved: boolean): Promise<boolean>;
  /** Conversation events as published by the native conversation bridge (`conversation.response` / `conversation.completed`). */
  subscribe(listener: (event: { kind: string; payload: unknown }) => void): () => void;
};

export type ScheduledConversationRunnerOptions = {
  port: ScheduledConversationPort;
  describe(taskId: string): Promise<Pick<CoreScheduledTask, 'name' | 'legacy'> | undefined>;
  /** The saved skill for a task, sent to the model with the prompt (not shown in the bubble). */
  skillFor?(taskId: string): Promise<string | undefined>;
  onConversation?(taskId: string, conversationId: string): void;
};

/** Retries of one run continue in the conversation the first attempt opened. */
const MAX_TRACKED_RUNS = 50;

const pad = (value: number): string => String(value).padStart(2, '0');
const stamp = (at: number): string => {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const sandboxFor = (mode: CoreScheduleRunInput['target']['permissionMode']): string =>
  mode === 'full-access' ? 'danger-full-access' : mode;

const createParams = (
  input: CoreScheduleRunInput,
  task: Pick<CoreScheduledTask, 'name' | 'legacy'> | undefined
): ICreateConversationParams => {
  const { target } = input;
  const tomny = target.targetId === 'tomny';
  const agent = task?.legacy?.agentConfig;
  const providerId = agent?.backend || target.targetId;
  return {
    type: tomny ? 'tomnyagentic' : 'acp',
    name: `${task?.name || 'Scheduled task'} · ${stamp(input.scheduledFor)}`,
    model: {
      id: providerId,
      platform: 'custom',
      name: agent?.name || providerId,
      base_url: '',
      api_key: '',
      use_model: agent?.model_id ?? '',
    },
    extra: {
      workspace: target.workspace,
      custom_workspace: true,
      ...(tomny ? {} : { backend: target.targetId, ...(agent?.name ? { agent_name: agent.name } : {}) }),
      ...(agent?.cli_path ? { cli_path: agent.cli_path } : {}),
      tomny_core_target_id: target.targetId,
      ...(target.modelKey ? { tomny_core_model_key: target.modelKey } : {}),
      sandboxMode: sandboxFor(target.permissionMode),
      surface: target.surface,
      permission_scopes: [...target.permissionScopes],
      capability_grants: [...target.capabilityGrants],
      available_capabilities: [...target.availableCapabilities],
      cron_job_id: input.taskId,
    } as ICreateConversationParams['extra'],
  };
};

/**
 * Runs a scheduled task as a turn of a real conversation, so its answer, tools
 * and permissions are kept and shown like any chat. A task tied to an existing
 * conversation continues there; otherwise each run opens a conversation tagged
 * with the task id. Unattended permission requests follow the task's policy.
 */
export const createScheduledConversationRunner = (options: ScheduledConversationRunnerOptions): CoreScheduleRunner => {
  const { port } = options;
  const runConversations = new Map<string, string>();

  const conversationFor = async (input: CoreScheduleRunInput): Promise<TChatConversation> => {
    for (const id of [input.target.sessionId, runConversations.get(input.runId)]) {
      if (!id) continue;
      const found = await port.get(id);
      if (found) return found;
    }
    const created = await port.create(createParams(input, await options.describe(input.taskId)));
    runConversations.set(input.runId, created.id);
    while (runConversations.size > MAX_TRACKED_RUNS)
      runConversations.delete(runConversations.keys().next().value as string);
    return created;
  };

  return {
    async run(input) {
      if (input.signal.aborted) throw new Error('The scheduled run was cancelled.');
      const conversation = await conversationFor(input);
      options.onConversation?.(input.taskId, conversation.id);
      const skill = (await options.skillFor?.(input.taskId).catch((): undefined => undefined))?.trim();
      const prompt = input.target.prompt;

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error): void => {
          if (settled) return;
          settled = true;
          input.signal.removeEventListener('abort', abort);
          unsubscribe();
          if (error) reject(error);
          else resolve();
        };
        const stop = (error: Error): void => {
          void port.cancel(conversation.id).catch((): undefined => undefined);
          finish(error);
        };
        const abort = (): void => stop(new Error('The scheduled run was cancelled.'));

        const unsubscribe = port.subscribe((event) => {
          if (settled) return;
          if (event.kind === 'conversation.response') {
            const message = event.payload as IResponseMessage;
            if (message.conversation_id !== conversation.id || message.type !== 'permission') return;
            const data = (message.data ?? {}) as { id?: string; native_core_permission_id?: string; title?: string };
            const permissionId = data.native_core_permission_id || data.id;
            if (!permissionId) return;
            const approved =
              input.target.unattendedPermissionPolicy === 'allow-granted' &&
              Boolean(data.title) &&
              scopeAllowsTool(input.target.permissionScopes, data.title ?? '');
            void Promise.resolve(port.resolvePermission(permissionId, approved))
              .then((resolved) => {
                if (!resolved) stop(new Error('Scheduled permission request expired before it could be resolved.'));
              })
              .catch((error: unknown) => stop(error instanceof Error ? error : new Error(String(error))));
            return;
          }
          if (event.kind === 'conversation.completed') {
            const done = event.payload as IConversationTurnCompletedEvent;
            if (done.session_id !== conversation.id) return;
            if (done.state === 'error') finish(new Error(done.detail || 'Scheduled run failed.'));
            else if (done.state === 'stopped') finish(new Error(done.detail || 'Scheduled run was cancelled.'));
            else finish();
          }
        });

        input.signal.addEventListener('abort', abort, { once: true });
        void port
          .send({
            conversation_id: conversation.id,
            input: prompt,
            ...(skill ? { model_input: `${prompt}\n\n## Saved skill for this scheduled task\n${skill}` } : {}),
          })
          .catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
      });
    },
  };
};

/** Lets "Run now" return as soon as the run's conversation exists instead of waiting for the whole run. */
export const createRunConversationTracker = () => {
  const waiters = new Map<string, Set<(conversationId: string) => void>>();
  return {
    started(taskId: string, conversationId: string): void {
      const pending = waiters.get(taskId);
      waiters.delete(taskId);
      for (const notify of pending ?? []) notify(conversationId);
    },
    next(taskId: string): { promise: Promise<string>; dispose(): void } {
      let notify: (conversationId: string) => void = () => undefined;
      const promise = new Promise<string>((resolve) => {
        notify = resolve;
      });
      const set = waiters.get(taskId) ?? new Set();
      set.add(notify);
      waiters.set(taskId, set);
      return {
        promise,
        dispose: () => {
          set.delete(notify);
          if (set.size === 0 && waiters.get(taskId) === set) waiters.delete(taskId);
        },
      };
    },
  };
};
