// src/common/types/teamTypes.ts
// Shared team types used by both main process and renderer.
// Renderer code should import from here instead of @process/team/types.

/** Role of a teammate within a team */
export type TeammateRole = 'leader' | 'teammate';

// Backend statuses: idle|working|thinking|tool_use|completed|error → mapped via teamMapper.toStatus()
/** Lifecycle status of a teammate agent */
export type TeammateStatus = 'pending' | 'idle' | 'active' | 'completed' | 'failed';

/** Workspace sharing strategy for the team */
export type WorkspaceMode = 'shared' | 'isolated';

/** Scope of a task inside a Team workspace. */
export type TeamTaskScope = 'personal' | 'group';

/** Lifecycle of a human/agent task. */
export type TeamTaskStatus =
  | 'draft'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'review'
  | 'needs_changes'
  | 'done'
  | 'cancelled';

/** Sorting and attention priority for Team tasks. */
export type TeamTaskPriority = 'low' | 'medium' | 'high' | 'critical';

/** A responsibility target in the workspace hierarchy. */
export type TeamTaskActor = {
  kind: 'user' | 'agent' | 'group';
  id: string;
};

/** Nested group used by larger Team workspaces. */
export type TeamWorkspaceGroup = {
  id: string;
  name: string;
  parent_group_id: string | null;
  member_ids: string[];
  created_at: number;
  updated_at: number;
};

/** A task can be independent or a leaf under a larger group objective. */
export type TeamTask = {
  id: string;
  title: string;
  description: string;
  scope: TeamTaskScope;
  group_id: string | null;
  parent_task_id: string | null;
  creator_id: string;
  owner: TeamTaskActor;
  assignee: TeamTaskActor | null;
  shared_with: TeamTaskActor[];
  reviewer_ids: string[];
  acceptance_criteria: string[];
  /** File, folder, symbol, or domain hints used to select repository context for the bound agent. */
  context_hints: string[];
  status: TeamTaskStatus;
  priority: TeamTaskPriority;
  created_at: number;
  updated_at: number;
};

/** Editable task input accepted by the Team bridge. */
export type TeamTaskInput = Omit<TeamTask, 'id' | 'created_at' | 'updated_at'> & { id?: string };

/** Editable group input accepted by the Team bridge. */
export type TeamWorkspaceGroupInput = Omit<TeamWorkspaceGroup, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
};

/** The role an AI conversation has for a pinned task. */
export type TeamTaskBindingRole = 'planner' | 'executor' | 'reviewer' | 'tester' | 'advisor';

/** Persistent link between a task and one Team agent conversation. */
export type TeamTaskBinding = {
  id: string;
  task_id: string;
  slot_id: string;
  conversation_id: string;
  role: TeamTaskBindingRole;
  is_primary: boolean;
  bound_at: number;
};

/** Persisted agent configuration within a team */
export type TeamAgent = {
  slot_id: string;
  conversation_id: string;
  role: TeammateRole;
  agent_type: string;
  icon?: string;
  agent_name: string;
  conversation_type: string;
  status: TeammateStatus;
  cli_path?: string;
  custom_agent_id?: string;
  model?: string;
  pending_confirmations?: number;
};

/** Persisted team record (stored in SQLite `teams` table) */
export type TTeam = {
  id: string;
  user_id: string;
  name: string;
  workspace: string;
  workspace_mode: WorkspaceMode;
  leader_agent_id: string;
  agents: TeamAgent[];
  /** Current session permission mode (e.g. 'plan', 'auto'). Persisted so newly spawned agents inherit it. */
  session_mode?: string;
  /** Optional for backwards compatibility with Team records created before workspace tasks existed. */
  groups?: TeamWorkspaceGroup[];
  /** Personal and group tasks share one tree through `parent_task_id`. */
  tasks?: TeamTask[];
  /** AI conversations pinned to task-specific context. */
  task_bindings?: TeamTaskBinding[];
  created_at: number;
  updated_at: number;
};

/** IPC event pushed to renderer when agent status changes */
export type ITeamAgentStatusEvent = {
  team_id: string;
  slot_id: string;
  status: TeammateStatus;
  last_message?: string;
};

/** IPC event pushed to renderer when a new agent is spawned at runtime */
export type ITeamAgentSpawnedEvent = {
  team_id: string;
  agent: TeamAgent;
};

/** IPC event pushed to renderer when an agent is removed from the team */
export type ITeamAgentRemovedEvent = {
  team_id: string;
  slot_id: string;
};

/** IPC event pushed to renderer when an agent is renamed */
export type ITeamAgentRenamedEvent = {
  team_id: string;
  slot_id: string;
  old_name: string;
  new_name: string;
};

/** IPC event pushed to renderer when the team list changes (created/removed/agent changes) */
export type ITeamListChangedEvent = {
  team_id: string;
  action: 'created' | 'removed' | 'agent_added' | 'agent_removed';
};

/** IPC event pushed whenever group/task/binding workspace data changes. */
export type ITeamWorkspaceChangedEvent = {
  team_id: string;
  action: 'group_saved' | 'group_removed' | 'task_saved' | 'task_removed' | 'task_bound' | 'task_unbound';
  group_id?: string;
  task_id?: string;
  slot_id?: string;
};

/** IPC event pushed when a new team is created (backend `team.created` WS event) */
export type ITeamCreatedEvent = {
  team_id: string;
  team_name: string;
};

/** IPC event for real-time teammate-to-teammate messages (`team.teammate.message` WS event) */
export type ITeamTeammateMessageEvent = {
  conversation_id: string;
  content: string;
  from_slot_id: string;
  from_name: string;
};

/** IPC event for streaming agent messages to renderer */
export type ITeamMessageEvent = {
  team_id: string;
  slot_id: string;
  type: string;
  data: unknown;
  msg_id: string;
  conversation_id: string;
};

/** Phase of the MCP injection pipeline */
export type TeamMcpPhase =
  | 'tcp_ready'
  | 'tcp_error'
  | 'session_injecting'
  | 'session_ready'
  | 'session_error'
  | 'load_failed'
  | 'degraded'
  | 'config_write_failed'
  | 'mcp_tools_waiting'
  | 'mcp_tools_ready';

/** IPC event for MCP injection pipeline status */
export type ITeamMcpStatusEvent = {
  team_id: string;
  slot_id?: string;
  phase: TeamMcpPhase;
  server_count?: number;
  port?: number;
  error?: string;
};
