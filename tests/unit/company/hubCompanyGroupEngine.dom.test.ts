/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleNode } from '@process/company/companyOrchestrator';

type TurnEvent = {
  session_id: string;
  state: string;
  can_send_message: boolean;
  runtime: { pending_confirmations: number };
  last_message?: { content: string };
};

const turnListeners = new Set<(event: TurnEvent) => void>();
const replies: Record<string, (input: string) => string> = {};
const prompts: { conversationId: string; input: string }[] = [];
const emitTurn = (event: TurnEvent): void => turnListeners.forEach((listener) => listener(event));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      responseStream: { on: () => () => undefined },
      turnCompleted: {
        on: (listener: (event: TurnEvent) => void) => {
          turnListeners.add(listener);
          return () => turnListeners.delete(listener);
        },
      },
      sendMessage: {
        invoke: async ({ conversation_id, input }: { conversation_id: string; input: string }) => {
          prompts.push({ conversationId: conversation_id, input });
          const reply = replies[conversation_id]?.(input) ?? '';
          setTimeout(() => {
            if (reply === '__approval__') {
              emitTurn({
                session_id: conversation_id,
                state: 'ai_waiting_confirmation',
                can_send_message: false,
                runtime: { pending_confirmations: 1 },
              });
              return;
            }
            emitTurn({
              session_id: conversation_id,
              state: 'ai_waiting_input',
              can_send_message: true,
              runtime: { pending_confirmations: 0 },
              last_message: { content: reply },
            });
          }, 0);
          return {};
        },
      },
    },
    company: {
      routeGroupMessage: {
        invoke: async ({ candidates }: { candidates: { id: string }[] }) => ({
          ok: true,
          data: {
            source: 'laya',
            threshold: 0.6,
            scores: candidates.map(({ id }) => ({ id, score: id === 'fe' ? 0.9 : 0.1 })),
          },
        }),
      },
    },
  },
}));

vi.mock('@/renderer/pages/guid/HubHome/company/companyRoleChat', () => ({
  ensureRoleConversation: async ({ role }: { role: RoleNode }) => `conv-${role.id}`,
}));

const { clearGroupChat, getGroupSnapshot, runGroupWorkflow, sendGroupMessage } =
  await import('@/renderer/pages/guid/HubHome/company/group/groupEngine');
const { writeMeta } = await import('@/renderer/pages/guid/HubHome/company/group/groupMeta');

const role = (id: string, name: string, children: RoleNode[] = []): RoleNode => ({
  id,
  role: 'worker',
  name,
  children,
});
const lead = role('lead', 'Lead');
const fe = role('fe', 'Frontend');
const be = role('be', 'Backend');
const structure = { companyId: 'acme', root: { ...role('boss', 'Boss', [lead, fe, be]), role: 'president' as const } };
const group = { id: 'g', name: 'Web', leader: lead, members: [fe, be] };
const ctx = { companyId: 'acme', companyName: 'acme', group, structure, rules: [], language: 'en-US' };
const KEY = 'acme::g';
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('group chat engine', () => {
  beforeEach(() => {
    prompts.length = 0;
    for (const id of Object.keys(replies)) delete replies[id];
    window.localStorage.clear();
    clearGroupChat(KEY);
  });

  it('calls only the members Laya finds relevant and records who was skipped', async () => {
    replies['conv-fe'] = () => 'On it.';
    await sendGroupMessage(ctx, 'Fix the button colour');
    expect(prompts.map((item) => item.conversationId)).toEqual(['conv-fe']);
    const [userLine, reply] = getGroupSnapshot(KEY).messages;
    expect(userLine.routing?.called).toEqual(['Frontend']);
    expect(userLine.routing?.skipped.map((item) => item.name)).toEqual(['Lead', 'Backend']);
    expect(reply.text).toBe('On it.');
  });

  it('follows an @ hand-off from one agent to another', async () => {
    replies['conv-fe'] = () => '@Backend please add the API field';
    replies['conv-be'] = () => 'Field added.';
    await sendGroupMessage(ctx, 'Add a price to the card');
    await settle();
    await settle();
    expect(prompts.map((item) => item.conversationId)).toEqual(['conv-fe', 'conv-be']);
    expect(prompts[1].input).toContain('Frontend mentioned you');
    expect(getGroupSnapshot(KEY).messages.map((item) => item.text)).toContain('Field added.');
  });

  it('posts nothing when a member passes', async () => {
    replies['conv-fe'] = () => 'PASS';
    await sendGroupMessage(ctx, 'Anything on the button?');
    expect(getGroupSnapshot(KEY).messages).toHaveLength(1);
  });

  it('includes the group goal in every prompt', async () => {
    writeMeta(KEY, { goal: 'Ship v1 on Friday', events: [], workflows: [] });
    replies['conv-fe'] = () => 'ok';
    await sendGroupMessage(ctx, 'button');
    expect(prompts[0].input).toContain('Shared group goal: Ship v1 on Friday');
  });

  it('runs workflow steps in order, passing each output on', async () => {
    replies['conv-lead'] = () => 'Spec ready';
    replies['conv-be'] = (input) => (input.includes('Spec ready') ? 'API done' : 'missing spec');
    await runGroupWorkflow(ctx, {
      id: 'w',
      name: 'Release',
      steps: [
        { id: '1', roleId: 'lead', instruction: 'Write the spec' },
        { id: '2', roleId: 'be', instruction: 'Build the API' },
      ],
    });
    const lines = getGroupSnapshot(KEY).messages;
    expect(lines.map((item) => item.text)).toEqual([
      'Workflow "Release" started (2 steps).',
      'Spec ready',
      'API done',
      'Workflow "Release" finished.',
    ]);
    expect(lines[2].workflow).toEqual({ name: 'Release', step: 2, total: 2 });
    expect(getGroupSnapshot(KEY).workflowRunning).toBe(false);
  });

  it('flags a member that waits for a permission', async () => {
    replies['conv-fe'] = () => '__approval__';
    void sendGroupMessage(ctx, 'deploy the site');
    await settle();
    await settle();
    expect(getGroupSnapshot(KEY).waiting.has('fe')).toBe(true);
    emitTurn({
      session_id: 'conv-fe',
      state: 'ai_waiting_input',
      can_send_message: true,
      runtime: { pending_confirmations: 0 },
      last_message: { content: 'Deployed.' },
    });
    await settle();
    expect(getGroupSnapshot(KEY).waiting.size).toBe(0);
    expect(getGroupSnapshot(KEY).messages.at(-1)?.text).toBe('Deployed.');
  });

  it('keeps feeding an agent new lines once the transcript outgrows its stored cap', async () => {
    const old = Array.from({ length: 200 }, (_, index) => ({
      id: `m${index}`,
      from: 'user',
      name: 'User',
      text: `old line ${index}`,
      at: index,
    }));
    window.localStorage.setItem(
      'tomni.hub.companyGroupChat',
      JSON.stringify({ 'acme::g2': { messages: old, seen: { fe: 200 } } })
    );
    replies['conv-fe'] = () => 'ok';
    await sendGroupMessage({ ...ctx, group: { ...group, id: 'g2' } }, 'Fix the button colour');
    expect(prompts).toHaveLength(1);
    expect(prompts[0].input).toContain('User: Fix the button colour');
    expect(prompts[0].input).not.toContain('old line 0');
  });
});
