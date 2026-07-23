import { beforeEach, describe, expect, it } from 'vitest';
import type { TTeam } from '@/common/types/team/teamTypes';
import {
  buildTeamTaskContextIntent,
  getTeamTaskContext,
  syncTeamTaskContexts,
  withTeamTaskDirective,
} from '@/renderer/pages/team/taskContext';

const makeTeam = (): TTeam => ({
  id: 'team-1',
  user_id: 'user-1',
  name: 'Commerce team',
  workspace: 'C:/repo',
  workspace_mode: 'shared',
  leader_agent_id: 'agent-1',
  agents: [
    {
      slot_id: 'agent-1',
      conversation_id: 'conversation-1',
      role: 'leader',
      agent_type: 'codex',
      agent_name: 'Payment agent',
      conversation_type: 'acp',
      status: 'idle',
    },
  ],
  groups: [
    {
      id: 'group-commerce',
      name: 'Commerce',
      parent_group_id: null,
      member_ids: ['user-1'],
      created_at: 1,
      updated_at: 1,
    },
    {
      id: 'group-payments',
      name: 'Payments',
      parent_group_id: 'group-commerce',
      member_ids: ['user-1'],
      created_at: 2,
      updated_at: 2,
    },
  ],
  tasks: [
    {
      id: 'task-objective',
      title: 'Launch checkout',
      description: 'Deliver the checkout capability.',
      scope: 'group',
      group_id: 'group-payments',
      parent_task_id: null,
      creator_id: 'user-1',
      owner: { kind: 'group', id: 'group-payments' },
      assignee: null,
      shared_with: [],
      reviewer_ids: [],
      acceptance_criteria: ['Checkout is available'],
      context_hints: ['packages/checkout'],
      status: 'running',
      priority: 'critical',
      created_at: 3,
      updated_at: 3,
    },
    {
      id: 'task-payment',
      title: 'Implement payment service',
      description: 'Add gateway callbacks and transaction persistence.',
      scope: 'personal',
      group_id: 'group-payments',
      parent_task_id: 'task-objective',
      creator_id: 'user-1',
      owner: { kind: 'user', id: 'user-1' },
      assignee: { kind: 'agent', id: 'agent-1' },
      shared_with: [],
      reviewer_ids: [],
      acceptance_criteria: ['Signed callbacks are verified', 'Transactions are idempotent'],
      context_hints: ['PaymentService.ts', 'packages/payment'],
      status: 'ready',
      priority: 'high',
      created_at: 4,
      updated_at: 4,
    },
  ],
  task_bindings: [
    {
      id: 'binding-1',
      task_id: 'task-payment',
      slot_id: 'agent-1',
      conversation_id: 'conversation-1',
      role: 'executor',
      is_primary: true,
      bound_at: 5,
    },
  ],
  created_at: 1,
  updated_at: 5,
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('Team task chat context', () => {
  it('stores the primary task hierarchy and repository hints for the bound conversation', () => {
    syncTeamTaskContexts(makeTeam());

    expect(getTeamTaskContext('conversation-1')).toMatchObject({
      taskId: 'task-payment',
      taskTitle: 'Implement payment service',
      groupPath: ['Commerce', 'Payments'],
      parentTaskPath: ['Launch checkout'],
      role: 'executor',
    });
  });

  it('uses the pinned task to focus codegraph selection and every model turn', () => {
    syncTeamTaskContexts(makeTeam());

    const intent = buildTeamTaskContextIntent('Fix the callback handler', 'conversation-1');
    const outgoing = withTeamTaskDirective('Fix the callback handler', 'conversation-1');

    expect(intent).toContain('Context hints: PaymentService.ts, packages/payment');
    expect(outgoing).toContain('<team-task-context>');
    expect(outgoing).toContain('Transactions are idempotent');
  });

  it('removes stale conversation context after a task is unpinned', () => {
    const team = makeTeam();
    syncTeamTaskContexts(team);
    syncTeamTaskContexts({ ...team, task_bindings: [] });

    expect(getTeamTaskContext('conversation-1')).toBeNull();
    expect(withTeamTaskDirective('Continue', 'conversation-1')).toBe('Continue');
  });
});
