import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeamTaskInput } from '@/common/types/team/teamTypes';

const teamEvents = vi.hoisted(() => {
  const event = () => ({ emit: vi.fn() });
  return {
    agentStatusChanged: event(),
    agentSpawned: event(),
    agentRemoved: event(),
    agentRenamed: event(),
    listChanged: event(),
    created: event(),
    teammateMessage: event(),
    workspaceChanged: event(),
  };
});

vi.mock('@/common/adapter/ipcBridge', () => ({
  team: {
    ...teamEvents,
    create: { provider: vi.fn() },
    list: { provider: vi.fn() },
    get: { provider: vi.fn() },
    remove: { provider: vi.fn() },
    addAgent: { provider: vi.fn() },
    removeAgent: { provider: vi.fn() },
    stop: { provider: vi.fn() },
    ensureSession: { provider: vi.fn() },
    renameAgent: { provider: vi.fn() },
    renameTeam: { provider: vi.fn() },
    saveGroup: { provider: vi.fn() },
    removeGroup: { provider: vi.fn() },
    saveTask: { provider: vi.fn() },
    removeTask: { provider: vi.fn() },
    bindTask: { provider: vi.fn() },
    unbindTask: { provider: vi.fn() },
    setSessionMode: { provider: vi.fn() },
  },
}));

import { AgentMeshService } from '@process/agentRuntime/agentMesh/service';
import { createTeamBridgeHandlers, registerTeamBridge } from '@process/team/teamBridge';
import { JsonTeamStore } from '@process/team/teamStore';

const directories: string[] = [];
const makeHarness = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tomny-team-'));
  directories.push(directory);
  let sequence = 0;
  const store = new JsonTeamStore(path.join(directory, 'teams.json'));
  const mesh = new AgentMeshService();
  const handlers = createTeamBridgeHandlers({
    store,
    mesh,
    now: () => 1_000 + sequence,
    id: (prefix) => `${prefix}-${++sequence}`,
  });
  return { directory, store, mesh, handlers };
};

const input = {
  user_id: 'user-1',
  name: 'Release team',
  workspace: 'C:/repo',
  workspace_mode: 'shared' as const,
  agents: [
    {
      role: 'leader' as const,
      agent_type: 'tomny',
      agent_name: 'Lead',
      conversation_type: 'tomnyagentic',
      status: 'pending' as const,
    },
    {
      role: 'teammate' as const,
      agent_type: 'codex',
      agent_name: 'QA',
      conversation_type: 'acp',
      status: 'pending' as const,
    },
  ],
};

const taskInput = (overrides: Partial<TeamTaskInput> = {}): TeamTaskInput => ({
  title: 'Payment capability',
  description: 'Implement the payment flow.',
  scope: 'personal',
  group_id: null,
  parent_task_id: null,
  creator_id: 'user-1',
  owner: { kind: 'user', id: 'user-1' },
  assignee: null,
  shared_with: [],
  reviewer_ids: [],
  acceptance_criteria: ['Payment succeeds'],
  context_hints: ['packages/payment'],
  status: 'ready',
  priority: 'high',
  ...overrides,
});

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('native Team compatibility gateway', () => {
  it('persists a team and hydrates the shared AgentMesh with leader-controlled peer communication', async () => {
    const { handlers, mesh, directory } = await makeHarness();
    const created = await handlers.create(input);

    expect((await handlers.list({ user_id: 'user-1' }))[0]?.id).toBe(created.id);
    expect(mesh.listSessions()).toContain(`team:${created.id}`);
    const [leader, teammate] = created.agents;
    expect(mesh.canSend(`team:${created.id}`, leader.slot_id, teammate.slot_id, 'control')).toBe(true);
    expect(mesh.canSend(`team:${created.id}`, teammate.slot_id, leader.slot_id, 'result')).toBe(true);

    const reloaded = await new JsonTeamStore(path.join(directory, 'teams.json')).get(created.id);
    expect(reloaded?.agents).toHaveLength(2);
  });

  it('updates agents durably and refuses to remove the leader', async () => {
    const { handlers } = await makeHarness();
    const created = await handlers.create(input);
    const leader = created.agents.find((agent) => agent.role === 'leader')!;
    const teammate = created.agents.find((agent) => agent.role === 'teammate')!;

    await handlers.renameAgent({ team_id: created.id, slot_id: teammate.slot_id, new_name: 'Verifier' });
    const withGroup = await handlers.saveGroup({
      team_id: created.id,
      group: { name: 'QA', parent_group_id: null, member_ids: [teammate.slot_id] },
    });
    const withTask = await handlers.saveTask({
      team_id: created.id,
      task: taskInput({ assignee: { kind: 'agent', id: teammate.slot_id }, group_id: withGroup.groups![0].id }),
    });
    await handlers.bindTask({
      team_id: created.id,
      task_id: withTask.tasks![0].id,
      slot_id: teammate.slot_id,
      role: 'tester',
    });
    await handlers.removeAgent({ team_id: created.id, slot_id: teammate.slot_id });

    const updated = await handlers.get({ id: created.id });
    expect(updated?.agents.map((agent) => agent.agent_name)).toEqual(['Lead']);
    expect(updated?.task_bindings).toEqual([]);
    expect(updated?.tasks?.[0].assignee).toBeNull();
    expect(updated?.groups?.[0].member_ids).toEqual([]);
    await expect(handlers.removeAgent({ team_id: created.id, slot_id: leader.slot_id })).rejects.toThrow(
      'leader cannot be removed'
    );
  });

  it('persists nested groups and parent-child tasks in one Team workspace tree', async () => {
    const { handlers } = await makeHarness();
    const created = await handlers.create(input);
    const withParentGroup = await handlers.saveGroup({
      team_id: created.id,
      group: { name: 'Commerce', parent_group_id: null, member_ids: ['user-1'] },
    });
    const parentGroup = withParentGroup.groups![0];
    const withChildGroup = await handlers.saveGroup({
      team_id: created.id,
      group: { name: 'Payments', parent_group_id: parentGroup.id, member_ids: ['user-1'] },
    });
    const childGroup = withChildGroup.groups!.find((group) => group.parent_group_id === parentGroup.id)!;
    const withObjective = await handlers.saveTask({
      team_id: created.id,
      task: taskInput({ scope: 'group', group_id: childGroup.id, owner: { kind: 'group', id: childGroup.id } }),
    });
    const objective = withObjective.tasks![0];
    const withChildTask = await handlers.saveTask({
      team_id: created.id,
      task: taskInput({ title: 'Integrate gateway', parent_task_id: objective.id }),
    });

    expect(withChildTask.groups?.map((group) => group.parent_group_id)).toEqual([null, parentGroup.id]);
    expect(withChildTask.tasks?.map((task) => task.parent_task_id)).toEqual([null, objective.id]);
  });

  it('replaces an agent primary task binding and removes bindings with a deleted task tree', async () => {
    const { handlers } = await makeHarness();
    const created = await handlers.create(input);
    const teammate = created.agents.find((agent) => agent.role === 'teammate')!;
    const withParent = await handlers.saveTask({ team_id: created.id, task: taskInput() });
    const parent = withParent.tasks![0];
    const withChild = await handlers.saveTask({
      team_id: created.id,
      task: taskInput({ title: 'Verify callback', parent_task_id: parent.id }),
    });
    const child = withChild.tasks!.find((task) => task.parent_task_id === parent.id)!;
    await handlers.bindTask({ team_id: created.id, task_id: child.id, slot_id: teammate.slot_id, role: 'tester' });
    const rebound = await handlers.bindTask({
      team_id: created.id,
      task_id: parent.id,
      slot_id: teammate.slot_id,
      role: 'executor',
    });

    expect(rebound.task_bindings).toHaveLength(1);
    expect(rebound.task_bindings?.[0]).toMatchObject({
      task_id: parent.id,
      slot_id: teammate.slot_id,
      is_primary: true,
    });

    const removed = await handlers.removeTask({ team_id: created.id, task_id: parent.id });
    expect(removed.tasks).toEqual([]);
    expect(removed.task_bindings).toEqual([]);
  });

  it('rejects cyclic group and task hierarchies', async () => {
    const { handlers } = await makeHarness();
    const created = await handlers.create(input);
    const withGroup = await handlers.saveGroup({
      team_id: created.id,
      group: { name: 'Parent', parent_group_id: null, member_ids: [] },
    });
    const group = withGroup.groups![0];
    const withTask = await handlers.saveTask({ team_id: created.id, task: taskInput() });
    const task = withTask.tasks![0];

    await expect(
      handlers.saveGroup({
        team_id: created.id,
        group: { id: group.id, name: group.name, parent_group_id: group.id, member_ids: [] },
      })
    ).rejects.toThrow('own parent');
    await expect(
      handlers.saveTask({ team_id: created.id, task: taskInput({ id: task.id, parent_task_id: task.id }) })
    ).rejects.toThrow('own parent');
  });

  it('registers every renderer Team operation on typed Electron providers', async () => {
    const { store, mesh } = await makeHarness();

    registerTeamBridge({ store, mesh });
    const { team: registeredTeam } = await import('@/common/adapter/ipcBridge');

    for (const operation of [
      'create',
      'list',
      'get',
      'remove',
      'addAgent',
      'removeAgent',
      'stop',
      'ensureSession',
      'renameAgent',
      'renameTeam',
      'saveGroup',
      'removeGroup',
      'saveTask',
      'removeTask',
      'bindTask',
      'unbindTask',
      'setSessionMode',
    ] as const) {
      expect(registeredTeam[operation].provider).toHaveBeenCalledOnce();
    }
  });

  it('recovers from a corrupt metadata file without exposing partial data', async () => {
    const { directory } = await makeHarness();
    const filePath = path.join(directory, 'corrupt.json');
    await writeFile(filePath, '{broken', 'utf8');

    expect(await new JsonTeamStore(filePath).list()).toEqual([]);
  });
});
