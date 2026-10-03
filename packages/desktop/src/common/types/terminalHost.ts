/**
 * JSON-safe Terminal package ABI. Core owns these data shapes; Terminal owns its
 * renderer and Main implementation. No Node, Electron, or capability authority
 * is exposed by this module.
 */

export type TerminalStatus = 'running' | 'exited';
export type TerminalSession = {
  id: string;
  title: string;
  shell: string;
  cwd: string;
  status: TerminalStatus;
  createdAt: number;
  exitedAt: number | null;
  exitCode: number | null;
  pid: number | null;
  scheduled: boolean;
};
export type CreateTerminalOptions = {
  shell?: string;
  args?: string[];
  cwd?: string;
  title?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  scheduled?: boolean;
  noShellIntegration?: boolean;
};
export type TerminalDataEvent = { id: string; data: string };
export type TerminalExitEvent = { id: string; exitCode: number | null; exitedAt: number };
export type SystemTerminalProcess = { pid: number; name: string };
export type TerminalScheduleKind = 'cron' | 'once';
export type TerminalSchedule = {
  id: string;
  name: string;
  shell?: string;
  cwd?: string;
  script: string;
  kind: TerminalScheduleKind;
  cron?: string;
  at?: number;
  tz?: string;
  enabled: boolean;
  lastRunAt: number | null;
  lastStatus: 'ok' | 'error' | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};
export type ShellProfile = {
  id: string;
  label: string;
  path: string;
  args?: string[];
  icon?: string;
  isDefault?: boolean;
};
export type CreateTerminalRequest = { options?: CreateTerminalOptions };
export type WriteTerminalRequest = { id: string; data: string };
export type ResizeTerminalRequest = { id: string; cols: number; rows: number };
export type TerminalIdRequest = { id: string };
export type TerminalListData = { sessions: TerminalSession[]; runningCount: number };
export type SaveScheduleRequest = { schedule: Partial<TerminalSchedule> & { name: string; script: string } };
export type TerminalResult<T> = { ok: true; data: T } | { ok: false; error: string };
export type CommandRecord = {
  command: string;
  program: string;
  cwd?: string;
  count: number;
  successCount: number;
  firstUsedAt: number;
  lastUsedAt: number;
  lastExitCode: number | null;
};
export type CaptureInput = { command: string; exitCode: number; cwd?: string };
export type CommandDocResult<T> = TerminalResult<T>;
export type Remap = { from: string; to: string; updateUrl?: string; source: 'seed' | 'realtime' };
export type SmartFixResult<T> = TerminalResult<T>;
export type MtuiResponse = { ok: boolean; [key: string]: unknown };
export type MtuiSuggestion = {
  command: string;
  score: number;
  success_rate: number;
  used_count: number;
  last_used: string;
  source: string;
};
export type MtuiSuggestResult = { ok: boolean; command: string; query: string; suggestions: MtuiSuggestion[] };
export type MtuiRepairResult = {
  ok: boolean;
  command: string;
  repair_available: boolean;
  original_command: string;
  suggested_command?: string;
  message?: string;
  source?: string;
  risk?: string;
  requires_confirm?: boolean;
};
export type MtuiResult<T> = TerminalResult<T>;
