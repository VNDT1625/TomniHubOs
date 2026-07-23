import type { TeamTask, TeamTaskActor, TeamWorkspaceGroup, TTeam } from '@/common/types/team/teamTypes';

export const actorKey = (actor: TeamTaskActor): string => `${actor.kind}:${actor.id}`;

export const parseActorKey = (value: string): TeamTaskActor | null => {
  const separator = value.indexOf(':');
  if (separator <= 0) return null;
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!id || (kind !== 'user' && kind !== 'agent' && kind !== 'group')) return null;
  return { kind, id };
};

export const actorLabel = (team: TTeam, actor: TeamTaskActor | null, currentUserLabel: string): string => {
  if (!actor) return '—';
  if (actor.kind === 'user') return actor.id === team.user_id ? currentUserLabel : actor.id;
  if (actor.kind === 'agent') {
    return team.agents.find((candidate) => candidate.slot_id === actor.id)?.agent_name ?? actor.id;
  }
  return team.groups?.find((candidate) => candidate.id === actor.id)?.name ?? actor.id;
};

export const groupDepth = (group: TeamWorkspaceGroup, groups: TeamWorkspaceGroup[]): number => {
  let depth = 0;
  let cursor = group.parent_group_id;
  const visited = new Set<string>([group.id]);
  while (cursor) {
    if (visited.has(cursor)) break;
    visited.add(cursor);
    const parent = groups.find((candidate) => candidate.id === cursor);
    if (!parent) break;
    depth += 1;
    cursor = parent.parent_group_id;
  }
  return depth;
};

export const orderedGroups = (groups: TeamWorkspaceGroup[]): TeamWorkspaceGroup[] => {
  const result: TeamWorkspaceGroup[] = [];
  const appendChildren = (parentId: string | null) => {
    for (const group of groups.filter((candidate) => candidate.parent_group_id === parentId)) {
      result.push(group);
      appendChildren(group.id);
    }
  };
  appendChildren(null);
  for (const group of groups) {
    if (!result.some((candidate) => candidate.id === group.id)) result.push(group);
  }
  return result;
};

export const taskDepth = (task: TeamTask, tasks: TeamTask[]): number => {
  let depth = 0;
  let cursor = task.parent_task_id;
  const visited = new Set<string>([task.id]);
  while (cursor) {
    if (visited.has(cursor)) break;
    visited.add(cursor);
    const parent = tasks.find((candidate) => candidate.id === cursor);
    if (!parent) break;
    depth += 1;
    cursor = parent.parent_task_id;
  }
  return depth;
};

export const orderedTasks = (tasks: TeamTask[]): TeamTask[] => {
  const result: TeamTask[] = [];
  const appendChildren = (parentId: string | null) => {
    for (const task of tasks
      .filter((candidate) => candidate.parent_task_id === parentId)
      .toSorted((left, right) => right.updated_at - left.updated_at)) {
      result.push(task);
      appendChildren(task.id);
    }
  };
  appendChildren(null);
  for (const task of tasks) {
    if (!result.some((candidate) => candidate.id === task.id)) result.push(task);
  }
  return result;
};
