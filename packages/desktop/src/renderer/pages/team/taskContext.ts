import type { TeamTask, TeamTaskBindingRole, TTeam } from '@/common/types/team/teamTypes';

const TASK_CONTEXT_PREFIX = 'team.task-context.';
const TEAM_MANIFEST_PREFIX = 'team.task-context-manifest.';

export type TeamTaskContextSnapshot = {
  teamId: string;
  teamName: string;
  taskId: string;
  taskTitle: string;
  description: string;
  status: TeamTask['status'];
  priority: TeamTask['priority'];
  scope: TeamTask['scope'];
  role: TeamTaskBindingRole;
  groupPath: string[];
  parentTaskPath: string[];
  acceptanceCriteria: string[];
  contextHints: string[];
  ownerLabel: string;
  assigneeLabel: string | null;
  boundAt: number;
};

const storageAvailable = (): boolean => {
  try {
    return typeof window !== 'undefined' && window.localStorage != null;
  } catch {
    return false;
  }
};

const taskPathFor = (task: TeamTask, tasks: TeamTask[]): string[] => {
  const path: string[] = [];
  const visited = new Set<string>([task.id]);
  let parentId = task.parent_task_id;
  while (parentId) {
    if (visited.has(parentId)) break;
    visited.add(parentId);
    const parent = tasks.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    path.unshift(parent.title);
    parentId = parent.parent_task_id;
  }
  return path;
};

const groupPathFor = (groupId: string | null, team: TTeam): string[] => {
  if (!groupId) return [];
  const groups = team.groups ?? [];
  const path: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = groupId;
  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const group = groups.find((candidate) => candidate.id === currentId);
    if (!group) break;
    path.unshift(group.name);
    currentId = group.parent_group_id;
  }
  return path;
};

const actorLabel = (team: TTeam, actor: TeamTask['owner'] | null): string | null => {
  if (!actor) return null;
  if (actor.kind === 'user') return actor.id === team.user_id ? 'Current user' : actor.id;
  if (actor.kind === 'agent') {
    return team.agents.find((candidate) => candidate.slot_id === actor.id)?.agent_name ?? actor.id;
  }
  return team.groups?.find((candidate) => candidate.id === actor.id)?.name ?? actor.id;
};

const snapshotFor = (
  team: TTeam,
  task: TeamTask,
  role: TeamTaskBindingRole,
  boundAt: number
): TeamTaskContextSnapshot => ({
  teamId: team.id,
  teamName: team.name,
  taskId: task.id,
  taskTitle: task.title,
  description: task.description,
  status: task.status,
  priority: task.priority,
  scope: task.scope,
  role,
  groupPath: groupPathFor(task.group_id, team),
  parentTaskPath: taskPathFor(task, team.tasks ?? []),
  acceptanceCriteria: task.acceptance_criteria,
  contextHints: task.context_hints,
  ownerLabel: actorLabel(team, task.owner) ?? task.owner.id,
  assigneeLabel: actorLabel(team, task.assignee),
  boundAt,
});

/** Keep persistent conversation snapshots in sync with the authoritative Team record. */
export const syncTeamTaskContexts = (team: TTeam): void => {
  if (!storageAvailable()) return;
  const manifestKey = `${TEAM_MANIFEST_PREFIX}${team.id}`;
  const previousConversationIds = (() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(manifestKey) ?? '[]') as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  })();

  const tasks = team.tasks ?? [];
  const primaryByConversation = new Map<string, NonNullable<TTeam['task_bindings']>[number]>();
  for (const binding of (team.task_bindings ?? []).toSorted((left, right) => right.bound_at - left.bound_at)) {
    const existing = primaryByConversation.get(binding.conversation_id);
    if (!existing || (binding.is_primary && !existing.is_primary)) {
      primaryByConversation.set(binding.conversation_id, binding);
    }
  }

  const nextConversationIds: string[] = [];
  for (const [conversationId, binding] of primaryByConversation) {
    const task = tasks.find((candidate) => candidate.id === binding.task_id);
    if (!task) continue;
    window.localStorage.setItem(
      `${TASK_CONTEXT_PREFIX}${conversationId}`,
      JSON.stringify(snapshotFor(team, task, binding.role, binding.bound_at))
    );
    nextConversationIds.push(conversationId);
  }

  for (const conversationId of previousConversationIds) {
    if (!nextConversationIds.includes(conversationId)) {
      window.localStorage.removeItem(`${TASK_CONTEXT_PREFIX}${conversationId}`);
    }
  }
  window.localStorage.setItem(manifestKey, JSON.stringify(nextConversationIds));
};

export const getTeamTaskContext = (conversationId: string): TeamTaskContextSnapshot | null => {
  if (!storageAvailable() || !conversationId) return null;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(`${TASK_CONTEXT_PREFIX}${conversationId}`) ?? 'null'
    ) as Partial<TeamTaskContextSnapshot> | null;
    if (!parsed || typeof parsed.taskId !== 'string' || typeof parsed.taskTitle !== 'string') return null;
    return parsed as TeamTaskContextSnapshot;
  } catch {
    return null;
  }
};

/** Enrich the codegraph query so repository slices are selected for the pinned task, not just the latest sentence. */
export const buildTeamTaskContextIntent = (input: string, conversationId: string): string => {
  const context = getTeamTaskContext(conversationId);
  if (!context) return input;
  return [
    `Task: ${context.taskTitle}`,
    context.description ? `Goal: ${context.description}` : '',
    context.groupPath.length > 0 ? `Group: ${context.groupPath.join(' / ')}` : '',
    context.parentTaskPath.length > 0 ? `Parent objectives: ${context.parentTaskPath.join(' > ')}` : '',
    context.acceptanceCriteria.length > 0 ? `Acceptance: ${context.acceptanceCriteria.join('; ')}` : '',
    context.contextHints.length > 0 ? `Context hints: ${context.contextHints.join(', ')}` : '',
    `Current request: ${input}`,
  ]
    .filter(Boolean)
    .join('\n');
};

/** Bind every model turn to the task contract while preserving the clean user-visible bubble. */
export const withTeamTaskDirective = (message: string, conversationId: string): string => {
  const context = getTeamTaskContext(conversationId);
  if (!context) return message;
  const lines = [
    '<team-task-context>',
    `Task ID: ${context.taskId}`,
    `Task: ${context.taskTitle}`,
    `Your role: ${context.role}`,
    `Status: ${context.status}`,
    `Priority: ${context.priority}`,
    `Owner: ${context.ownerLabel}`,
    context.assigneeLabel ? `Assignee: ${context.assigneeLabel}` : '',
    context.groupPath.length > 0 ? `Group path: ${context.groupPath.join(' / ')}` : '',
    context.parentTaskPath.length > 0 ? `Parent task path: ${context.parentTaskPath.join(' > ')}` : '',
    context.description ? `Objective: ${context.description}` : '',
    context.acceptanceCriteria.length > 0
      ? `Acceptance criteria:\n${context.acceptanceCriteria.map((criterion) => `- ${criterion}`).join('\n')}`
      : '',
    context.contextHints.length > 0 ? `Repository context hints: ${context.contextHints.join(', ')}` : '',
    'Stay within this task unless the user explicitly switches or unpins it. Use the task metadata to choose relevant repository context, explain blockers against its acceptance criteria, and report progress in task terms.',
    '</team-task-context>',
  ].filter(Boolean);
  return `${lines.join('\n')}\n\n${message}`;
};
