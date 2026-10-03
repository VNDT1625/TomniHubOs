import type {
  IdeTeamGroup,
  IdeTeamTask,
  IdeTeamTaskStatus,
  TeamParticipant,
} from '@package-apps/ide/renderer/teamEdit/teamEditClient';

export const TASK_STATUS_KEYS: Record<IdeTeamTaskStatus, string> = {
  todo: 'ide.team.workspace.status.todo',
  in_progress: 'ide.team.workspace.status.inProgress',
  review: 'ide.team.workspace.status.review',
  done: 'ide.team.workspace.status.done',
};

export const TASK_STATUS_COLORS: Record<IdeTeamTaskStatus, 'gray' | 'arcoblue' | 'orange' | 'green'> = {
  todo: 'gray',
  in_progress: 'arcoblue',
  review: 'orange',
  done: 'green',
};

export const toTaskInput = (task: IdeTeamTask) => ({
  id: task.id,
  title: task.title,
  description: task.description,
  scope: task.scope,
  groupId: task.groupId,
  parentTaskId: task.parentTaskId,
  creatorId: task.creatorId,
  assigneeId: task.assigneeId,
  pinnedAgentId: task.pinnedAgentId,
  status: task.status,
});

export const directChildren = (taskId: string, tasks: IdeTeamTask[]): IdeTeamTask[] =>
  tasks.filter((task) => task.parentTaskId === taskId);

export const taskProgress = (task: IdeTeamTask, tasks: IdeTeamTask[]): number => {
  const children = directChildren(task.id, tasks);
  if (children.length > 0) {
    const done = children.filter((child) => child.status === 'done').length;
    return Math.round((done / children.length) * 100);
  }
  if (task.status === 'done') return 100;
  if (task.status === 'review') return 82;
  if (task.status === 'in_progress') return 55;
  return 0;
};

export const taskDepth = (task: IdeTeamTask, tasks: IdeTeamTask[]): number => {
  let depth = 0;
  let parentId = task.parentTaskId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    depth += 1;
    parentId = tasks.find((candidate) => candidate.id === parentId)?.parentTaskId ?? null;
  }
  return depth;
};

export const groupPath = (groupId: string | null, groups: IdeTeamGroup[]): string[] => {
  if (!groupId) return [];
  const path: string[] = [];
  const visited = new Set<string>();
  let current = groups.find((group) => group.id === groupId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current.name);
    current = current.parentGroupId ? groups.find((group) => group.id === current?.parentGroupId) : undefined;
  }
  return path;
};

export const participantById = (participants: TeamParticipant[], id: string | null): TeamParticipant | undefined =>
  id ? participants.find((participant) => participant.agentId === id) : undefined;

export const initials = (label: string): string => {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(-2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
};

export const formatDateTime = (at: number): string =>
  new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(at));
