/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { bridge } from '@office-ai/platform';

/**
 * Live view of work running anywhere in the Hub (agents, teams, scheduled runs,
 * app processes such as terminals), shown on Home so the user can manage it
 * from one place. Main owns the state; the renderer only receives bounded,
 * redaction-free metadata (titles, step labels, a short preview tail).
 */
export type HubActivityKind = 'agent' | 'team' | 'schedule' | 'app';

/** `needs_input` means the work is blocked on the user (a permission or question). */
export type HubActivityStatus = 'running' | 'needs_input' | 'done' | 'error' | 'stopped';

export type HubActivityStep = { id: string; label: string; state: 'running' | 'done' | 'error' };

/** Main-process-redacted, bounded tool diagnostics; never part of grid persistence. */
export type HubActivityToolTrace = {
  id: string;
  name: string;
  description: string;
  status: 'running' | 'done' | 'error';
  input?: string;
  output?: string;
  durationMs?: number;
  startedAtMs?: number;
    finishedAtMs?: number;
  /** Monotonic per-turn index; assigned in Main and never persisted. */
    ordinal?: number;
  /** One Workflow run owns many child tools; trace is sanitized in Main. */
  workflowId?: string;
    workflowStepId?: string;
  workflowStage?: number;
};

/** Memory-only, Main-projected human summaries. Never exposes raw tool args. */
export type HubOverviewToolAction = {
  id: string;
  number: number;
  state: 'running' | 'done' | 'error';
    label: string;
  /** Child tools form a branch within the existing numbered Overview. */
  workflowId?: string;
    workflowStepId?: string;
  workflowStage?: number;
  children?: HubOverviewToolAction[];
};

/** Option labels may be i18n keys (`messages.confirmation.*`); the renderer translates them. */
export type HubActivityPromptOption = { label: string; value: string };

export type HubActivityPrompt = {
  id: string;
  title: string;
  description: string;
  options: HubActivityPromptOption[];
};

export type HubActivityItem = {
  /** `${kind}:${sourceId}` — stable across updates. */
  id: string;
  kind: HubActivityKind;
  sourceId: string;
  title: string;
  /** What the item is doing (the user's request, a job name, a command). */
  task?: string;
  /** Absolute workspace / project directory, when the work is bound to one. */
  workspace?: string;
  status: HubActivityStatus;
  startedAt: number;
  updatedAt: number;
  /** Most recent steps, oldest first (bounded). */
  steps: HubActivityStep[];
  /** Short tail of the latest output. */
  preview?: string;
  prompt?: HubActivityPrompt;
  /** Display name of the agent/runtime driving the work (e.g. Tomny, Codex), when known. */
  agentName?: string;
  /** Model the work runs on, when known. */
  model?: string;
  /** Renderer route that opens the full surface for this item. */
  route?: string;
  /** Base app id (catalog id) when the item belongs to an app such as the terminal. */
  appId?: string;
  canStop: boolean;
};

export type HubActivitySnapshot = { generatedAt: number; items: HubActivityItem[] };

export const hubActivityChannels = {
    snapshot: bridge.buildProvider<HubActivitySnapshot, void>('hub-activity.snapshot'),
    trace: bridge.buildProvider<HubActivityToolTrace[], { id: string }>('hub-activity.trace'),
  overview: bridge.buildProvider<HubOverviewToolAction[], { id: string }>('hub-activity.overview'),
  stop: bridge.buildProvider<boolean, { id: string }>('hub-activity.stop'),
  respond: bridge.buildProvider<boolean, { id: string; prompt_id: string; value: string }>('hub-activity.respond'),
    dismiss: bridge.buildProvider<boolean, { id: string }>('hub-activity.dismiss'),
  showConversation: bridge.buildProvider<boolean, { conversation_id: string }>('hub-activity.show-conversation'),
  changed: bridge.buildEmitter<HubActivitySnapshot>('hub-activity.changed'),
};
