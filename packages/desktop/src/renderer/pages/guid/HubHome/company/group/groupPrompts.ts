/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RoleNode } from '@process/company/companyOrchestrator';
import type { CompanyGroup } from '../companyGroups';

/** One line of a group transcript. */
export type GroupMessage = {
  id: string;
  /** `user`, `calendar`, `workflow`, or the id of the role that wrote it. */
  from: string;
  name: string;
  text: string;
  at: number;
  /** The author was tagged in from outside the group for this message. */
  guest?: boolean;
  /** The agent failed to answer; `text` carries the reason. */
  error?: boolean;
  /** On a user or calendar line: which agents were called to read it and which stayed idle. */
  routing?: {
    called: string[];
    skipped: { name: string; score: number }[];
    source: 'laya' | 'keywords' | 'all' | 'attendees';
  };
  /** A calendar event fired after its time (the app was closed). */
  late?: boolean;
  /** Part of a workflow run. `status` is set on the run's own start/finish lines. */
  workflow?: {
    name: string;
    step: number;
    total: number;
    status?: 'started' | 'done' | 'failed';
  };
};

/** A member with nothing to add answers this and nothing is posted. */
export const PASS_TOKEN = 'PASS';

export const isPass = (reply: string): boolean => reply.replace(/[\s.!]/g, '').toUpperCase() === PASS_TOKEN;

const MAX_PREVIOUS_CHARS = 4_000;

const speaker = (message: GroupMessage): string => {
  if (message.from === 'user') return 'User';
  if (message.from === 'calendar') return `Calendar event "${message.name}"`;
  if (message.from === 'workflow') return 'Workflow';
  return message.name;
};

const header = (companyName: string, group: CompanyGroup, role: RoleNode, goal: string): string[] => {
  const roster = [group.leader, ...group.members]
    .map((node) => (node.id === group.leader.id ? `${node.name} (leader)` : node.name))
    .join(', ');
  return [
    `[Group chat "${group.name}" in company "${companyName}"] You are ${role.name}.`,
    `Group members: ${roster}.`,
    ...(goal.trim() ? [`Shared group goal: ${goal.trim()}. Keep your work aligned with it.`] : []),
  ];
};

const transcript = (unseen: readonly GroupMessage[], omitted: number): string[] => [
  'Conversation:',
  ...(omitted > 0 ? [`(${omitted} earlier lines omitted)`] : []),
  ...unseen.map((message) => `${speaker(message)}: ${message.text}`),
];

/**
 * Prompt sent to one agent. It restates identity, group and goal each turn so
 * the agent needs no separate briefing turn, and carries the transcript lines
 * the agent has not seen (everything recent, for a guest).
 */
export const buildGroupPrompt = (params: {
  companyName: string;
  group: CompanyGroup;
  role: RoleNode;
  guest: boolean;
  unseen: readonly GroupMessage[];
  goal?: string;
  /** Earlier unseen lines left out to bound the prompt. */
  omitted?: number;
  /** Name of the agent that @mentioned this one, when it was handed work. */
  handoffFrom?: string;
}): string => {
  const { companyName, group, role, guest, unseen, goal = '', omitted = 0, handoffFrom } = params;
  return [
    ...header(companyName, group, role, goal),
    handoffFrom
      ? `${handoffFrom} mentioned you and is handing you work. Read the conversation and do your part.`
      : guest
        ? 'The user tagged you in to join this conversation temporarily. Read it below and reply once; you are not a member of the group.'
        : `You are a member of this group. If you have nothing useful to add, reply with exactly ${PASS_TOKEN}.`,
    'To hand part of the work to another agent, @mention them by name.',
    '',
    ...transcript(unseen, omitted),
    '',
    `Reply as ${role.name} to the latest message, concisely. Do not write other members' lines.`,
  ].join('\n');
};

/** Prompt for one workflow step: the step's instruction plus the previous step's output. */
export const buildWorkflowStepPrompt = (params: {
  companyName: string;
  group: CompanyGroup;
  role: RoleNode;
  goal?: string;
  workflowName: string;
  step: number;
  total: number;
  instruction: string;
  previous?: { name: string; output: string };
  unseen: readonly GroupMessage[];
  omitted?: number;
}): string => {
  const { companyName, group, role, goal = '', workflowName, step, total, instruction, previous, unseen } = params;
  return [
    ...header(companyName, group, role, goal),
    `You are running step ${step} of ${total} of the group workflow "${workflowName}".`,
    `Your task for this step: ${instruction.trim() || 'Continue the work.'}`,
    ...(previous
      ? ['', `Output of the previous step (by ${previous.name}):`, previous.output.slice(0, MAX_PREVIOUS_CHARS)]
      : []),
    '',
    ...transcript(unseen, params.omitted ?? 0),
    '',
    'Do the task and reply with its result only; the next step receives your reply. Do not @mention anyone.',
  ].join('\n');
};
