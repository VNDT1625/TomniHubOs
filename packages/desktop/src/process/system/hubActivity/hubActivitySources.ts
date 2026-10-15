/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { HubActivityPromptOption, HubActivityStatus } from '@/common/types/agent/hubActivity';
import type { TeammateStatus } from '@/common/types/team/teamTypes';
import { tailText, type HubActivityRegistry } from './hubActivityRegistry';
import { projectHubToolTrace } from './hubToolTrace';

type EventEnvelope = { kind: string; payload: unknown };

type ConversationInfo = { name?: string; extra?: unknown };

/** The slice of the native conversation service the activity source needs. */
export type ConversationActivityPort = {
  get: (id: string) => Promise<ConversationInfo | undefined>;
  cancel: (id: string) => Promise<void>;
  resolvePermission: (
    permissionId: string,
    approved: boolean,
    lifetime: 'allow-once' | 'session' | 'persistent'
  ) => Promise<boolean>;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const FINISH_STATUS: Record<string, HubActivityStatus> = {
  ai_waiting_input: 'done',
  stopped: 'stopped',
  error: 'error',
};

const stepState = (status: string): 'running' | 'done' | 'error' =>
  status === 'Success' ? 'done' : status === 'Error' || status === 'Canceled' ? 'error' : 'running';

const promptOptions = (value: unknown): HubActivityPromptOption[] =>
  (Array.isArray(value) ? value : [])
    .map((option) => record(option))
    .map((option) => ({ label: text(option.label), value: text(option.value) }))
    .filter((option) => option.label && option.value)
    .slice(0, 4);

/**
 * Projects native conversation events (the same stream the remote gateway
 * reads) into agent items. Nothing here can start work; it only observes, and
 * stop/respond go back through the service's own cancel and permission seams.
 */
export const attachConversationActivity = (
  registry: HubActivityRegistry,
  subscribe: (listener: (event: EventEnvelope) => void) => () => void,
  port: ConversationActivityPort
): (() => void) => {
  const outputs = new Map<string, string>();

  registry.registerController('agent', {
    stop: async (conversationId) => {
      await port.cancel(conversationId);
      return true;
    },
    respond: (_conversationId, promptId, value) =>
      port.resolvePermission(promptId, value !== 'cancel', value === 'proceed_always' ? 'persistent' : 'allow-once'),
  });

  const describe = (conversationId: string): void => {
    void port
      .get(conversationId)
      .then((conversation) => {
        if (!conversation || !registry.get('agent', conversationId)) return;
        const extra = record(conversation.extra);
        const temporary = extra.is_temporary_workspace === true;
        registry.upsert('agent', conversationId, {
          title: conversation.name?.trim() || undefined,
          workspace: temporary ? undefined : text(extra.workspace) || undefined,
        });
      })
      .catch((): undefined => undefined);
  };

  const onResponse = (message: IResponseMessage): void => {
    const conversationId = message.conversation_id;
    if (!conversationId || (message.hidden && message.type !== 'permission')) return;
    const data = record(message.data);
    switch (message.type) {
      case 'user_content': {
                outputs.set(conversationId, '');
        registry.clearToolTrace('agent', conversationId);
        registry.upsert('agent', conversationId, {
          task: text(data.content),
          status: 'running',
          startedAt: Date.now(),
          steps: [],
          preview: undefined,
          prompt: undefined,
          route: `/conversation/${conversationId}`,
          canStop: true,
        });
        describe(conversationId);
        return;
      }
      case 'start':
        if (registry.get('agent', conversationId)) registry.upsert('agent', conversationId, { status: 'running' });
        return;
      case 'content': {
        if (!registry.get('agent', conversationId)) return;
        const chunk = text(data.content);
        const replace = message.replace === true || data.replace === true;
        // The tile owns presentation and scroll; retain the complete turn output here.
        const output = replace ? chunk : `${outputs.get(conversationId) ?? ''}${chunk}`;
        outputs.set(conversationId, output);
        registry.upsert('agent', conversationId, { preview: output });
        return;
      }
      case 'tool_group': {
        if (!registry.get('agent', conversationId) || !Array.isArray(message.data)) return;
        for (const raw of message.data) {
          const item = record(raw);
          const callId = text(item.call_id);
          const name = text(item.name);
          if (!callId || name === 'ToolMap') continue;
          const state = stepState(text(item.status));
          const detail = text(item.description);
          const before = registry.get('agent', conversationId);
          const isNewCall = !before?.steps.some((step) => step.id === callId);
                    registry.step('agent', conversationId, {
            id: callId,
            label: detail && state === 'running' ? `${name} · ${detail}` : name,
            state,
          });
          const trace = projectHubToolTrace(raw);
          if (trace) registry.traceTool('agent', conversationId, trace);
          // A permission blocks the turn, so a brand-new tool call means it was answered elsewhere (chat, Telegram).
          if (before?.prompt && isNewCall) {
            registry.upsert('agent', conversationId, { prompt: undefined, status: 'running' });
          }
        }
        return;
      }
      case 'permission': {
        const id = text(data.native_core_permission_id) || text(data.id);
        if (!id) return;
        registry.upsert('agent', conversationId, {
          status: 'needs_input',
          prompt: {
            id,
            title: text(data.title),
            description: text(data.description),
            options: promptOptions(data.options),
          },
        });
        return;
      }
      case 'error':
        if (!registry.get('agent', conversationId)) return;
        registry.upsert('agent', conversationId, { status: 'error', preview: text(data.message) || undefined });
        return;
      case 'finish': {
        if (!registry.get('agent', conversationId)) return;
        outputs.delete(conversationId);
        const status = FINISH_STATUS[text(data.state)] ?? 'done';
        const current = registry.get('agent', conversationId);
        // An error already recorded keeps its message; a finish event must not downgrade it.
        registry.upsert('agent', conversationId, {
          status: current?.status === 'error' ? 'error' : status,
          canStop: false,
          steps: (current?.steps ?? []).map((step) =>
            step.state === 'running' ? { ...step, state: status === 'done' ? 'done' : 'error' } : step
          ),
        });
        return;
      }
      default:
        return;
    }
  };

  return subscribe((event) => {
    if (event.kind === 'conversation.response') {
      onResponse(event.payload as IResponseMessage);
      return;
    }
    if (event.kind === 'conversation.list') {
      const payload = record(event.payload);
      const conversationId = text(payload.conversation_id);
      if (payload.action === 'deleted' && conversationId) registry.remove('agent', conversationId);
      else if (payload.action === 'updated' && conversationId && registry.get('agent', conversationId)) {
        describe(conversationId);
      }
    }
  });
};

/** Scheduled-run audit kinds, as emitted by the core scheduled task service. */
export type ScheduledRunAudit = { taskId: string; kind: string; detail?: string; attempt?: number };

/** Reports one scheduled-run audit event. `name` resolves the job title lazily. */
export const reportScheduledRun = (
  registry: HubActivityRegistry,
  event: ScheduledRunAudit,
  name: (taskId: string) => Promise<string | undefined>
): void => {
  const base = { route: `/scheduled/${event.taskId}` };
  if (event.kind === 'run.started') {
    registry.upsert('schedule', event.taskId, {
      ...base,
      status: 'running',
      startedAt: Date.now(),
      steps: [],
      preview: undefined,
      canStop: true,
    });
    void name(event.taskId)
      .then((title) => {
        if (title && registry.get('schedule', event.taskId)) registry.upsert('schedule', event.taskId, { title });
      })
      .catch((): undefined => undefined);
    return;
  }
  if (!registry.get('schedule', event.taskId)) return;
  if (event.kind === 'run.retrying') {
    registry.step('schedule', event.taskId, {
      id: `attempt-${event.attempt ?? 0}`,
      label: event.detail ?? event.kind,
      state: 'error',
    });
    return;
  }
  const finished: Record<string, HubActivityStatus> = {
    'run.completed': 'done',
    'run.failed': 'error',
    'run.cancelled': 'stopped',
    'run.interrupted': 'error',
  };
  const status = finished[event.kind];
  if (status) registry.upsert('schedule', event.taskId, { status, canStop: false, preview: event.detail });
};

const TEAM_STEP_STATE: Record<TeammateStatus, 'running' | 'done' | 'error' | undefined> = {
  pending: undefined,
  idle: undefined,
  active: 'running',
  completed: 'done',
  failed: 'error',
};

/** Reports a team member's status; the team item is running while any member is active. */
export const reportTeamAgentStatus = (
  registry: HubActivityRegistry,
  input: {
    teamId: string;
    teamName?: string;
    slotId: string;
    agentName?: string;
    status: TeammateStatus;
    detail?: string;
  }
): void => {
  const state = TEAM_STEP_STATE[input.status];
  if (!state && !registry.get('team', input.teamId)) return;
  if (!registry.get('team', input.teamId)) {
    registry.upsert('team', input.teamId, {
      title: input.teamName,
      status: 'running',
      route: `/team/${input.teamId}`,
      canStop: false,
      startedAt: Date.now(),
    });
  } else if (input.teamName) {
    registry.upsert('team', input.teamId, { title: input.teamName });
  }
  if (state) {
    registry.step('team', input.teamId, {
      id: input.slotId,
      label: input.detail ? `${input.agentName ?? input.slotId} · ${input.detail}` : (input.agentName ?? input.slotId),
      state,
    });
  }
  const steps = registry.get('team', input.teamId)?.steps ?? [];
  const status: HubActivityStatus = steps.some((step) => step.state === 'running')
    ? 'running'
    : steps.some((step) => step.state === 'error')
      ? 'error'
      : 'done';
  registry.upsert('team', input.teamId, { status, preview: input.detail ? tailText(input.detail, 200) : undefined });
};

/** A terminal session as the terminal manager reports it. */
export type TerminalActivitySession = {
  id: string;
  title: string;
  cwd: string;
  status: 'running' | 'exited';
  createdAt: number;
  exitCode: number | null;
  scheduled: boolean;
};

/** Mirrors terminal sessions as running app items; `kill` is the stop control. */
export const attachTerminalActivity = (
  registry: HubActivityRegistry,
  terminals: {
    list: () => TerminalActivitySession[];
    kill: (id: string) => void;
    onSessionsChanged: (listener: (sessions: TerminalActivitySession[]) => void) => () => void;
  }
): (() => void) => {
  registry.registerController('app', {
    stop: async (sourceId) => {
      if (!sourceId.startsWith('terminal:')) return false;
      terminals.kill(sourceId.slice('terminal:'.length));
      return true;
    },
  });
  const known = new Set<string>();
  const sync = (sessions: TerminalActivitySession[]): void => {
    const seen = new Set<string>();
    for (const session of sessions) {
      const sourceId = `terminal:${session.id}`;
      seen.add(sourceId);
      // Only sessions seen running are listed; exited ones from before startup are history, not activity.
      if (session.status !== 'running' && !known.has(sourceId)) continue;
      known.add(sourceId);
      registry.upsert('app', sourceId, {
        title: session.title,
        task: session.scheduled ? 'scheduled' : undefined,
        workspace: session.cwd,
        status: session.status === 'running' ? 'running' : session.exitCode === 0 ? 'done' : 'stopped',
        startedAt: session.createdAt,
        appId: 'terminal',
        canStop: session.status === 'running',
      });
    }
    for (const sourceId of known) {
      if (!seen.has(sourceId)) {
        known.delete(sourceId);
        registry.remove('app', sourceId);
      }
    }
  };
  sync(terminals.list());
  return terminals.onSessionsChanged(sync);
};
