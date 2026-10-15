/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */
import type { HubActivityToolTrace, HubOverviewToolAction } from '@/common/types/agent/hubActivity';

/** Operates ONLY on the already redacted, memory-only Main-process trace.
 * No full arguments, output, shell commands or secrets travel to the Home cards.
 */
const shortName = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const clean = value.trim().replace(/\\/g, '/').split('/').findLast(Boolean) ?? '';
  if (!clean || clean.includes('[REDACTED]') || clean.length > 90) return undefined;
  return clean.replace(/[\r\n\t<>]/g, '').slice(0, 54) || undefined;
};

const pick = (obj: unknown, keys: string[], depth = 0): string | undefined => {
  if (depth > 3 || !obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  const fields = obj as Record<string, unknown>;
  for (const key of keys) {
    const entry = Object.entries(fields).find(([field]) => field.toLowerCase() === key.toLowerCase());
    if (entry && typeof entry[1] === 'string') return shortName(entry[1]);
  }
  for (const key of ['arguments', 'args', 'input', 'params', 'parameters', 'options']) {
    const nested = Object.entries(fields).find(([field]) => field.toLowerCase() === key);
    if (nested) {
      const result = pick(nested[1], keys, depth + 1);
      if (result) return result;
    }
  }
  return undefined;
};

export const toolActionDescription = (call: HubActivityToolTrace): string => {
  const tool = call.name.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  let input: unknown;
  try {
    input = call.input ? JSON.parse(call.input) : undefined;
  } catch {
    input = undefined;
  }
  const path = pick(input, [
    'filePath',
    'file_path',
    'relPath',
    'relativePath',
    'path',
    'filename',
    'file',
    'targetFile',
  ]);
  const lookup = pick(input, ['query', 'toolName', 'tool_name', 'name', 'searchTerm']);
  const active = call.status === 'running';
  const failed = call.status === 'error';
  let doing: string;
  let finished: string;
  if (/toolsearch|tool_search|schema_search|find_tools|tool_lookup|tool_discovery/.test(tool)) {
    doing = lookup ? `Đang tìm công cụ: ${lookup}` : 'Đang tìm công cụ phù hợp';
    finished = lookup ? `Đã tìm công cụ: ${lookup}` : 'Đã tìm công cụ';
  } else if (/read(_file)?$|\.read$|^readfile$|read_file|file_read|cat_file/.test(tool)) {
    doing = path ? `Đang đọc ${path}` : 'Đang đọc tệp';
    finished = path ? `Đã đọc ${path}` : 'Đã đọc tệp';
  } else if (/write|edit|patch|replace|update_file|save_file/.test(tool)) {
    doing = path ? `Đang chỉnh sửa ${path}` : 'Đang chỉnh sửa tệp';
    finished = path ? `Đã chỉnh sửa ${path}` : 'Đã chỉnh sửa tệp';
  } else if (/search|grep|find_file|find_in_files|rg$/.test(tool)) {
    doing = lookup ? `Đang tìm: ${lookup}` : 'Đang tìm trong dự án';
    finished = lookup ? `Đã tìm: ${lookup}` : 'Đã tìm trong dự án';
  } else if (/browser|navigate|open_url|webpage|visit_page/.test(tool)) {
    doing = 'Đang thao tác trong Browser';
    finished = 'Đã thao tác trong Browser';
  } else if (/terminal|command|execute|shell|run_code|\bexec\b/.test(tool)) {
    doing = 'Đang chạy lệnh';
    finished = 'Đã chạy lệnh';
  } else {
    const name = shortName(call.name) ?? 'công cụ';
    doing = `Đang dùng ${name}`;
    finished = `Đã dùng ${name}`;
  }
  return failed ? `Không thành công: ${finished.replace(/^Đã /, '').toLowerCase()}` : active ? doing : finished;
};

/** Ordering is stable as a tool updates from running to done, never two cards. */
export const projectHubOverviewActions = (calls: readonly HubActivityToolTrace[]): HubOverviewToolAction[] => {
  const groups = new Map<string, HubOverviewToolAction>();
  const actions: HubOverviewToolAction[] = [];
  for (const [index, call] of calls.entries()) {
    const item: HubOverviewToolAction = {
      id: call.id,
      number: call.ordinal ?? index + 1,
      state: call.status,
      label: toolActionDescription(call),
      ...(call.workflowId ? { workflowId: call.workflowId, workflowStepId: call.workflowStepId, workflowStage: call.workflowStage } : {}),
    };
    if (!call.workflowId) {
      actions.push(item);
      continue;
    }
        const groupKey = `${call.workflowId}:${call.workflowStage ?? 0}`;
    const group = groups.get(groupKey);
    if (group) {
      group.children!.push(item);
      group.state = group.children!.some((child) => child.state === 'running')
        ? 'running'
        : group.children!.some((child) => child.state === 'error')
          ? 'error'
          : 'done';
      continue;
    }
    const branch: HubOverviewToolAction = {
            id: `workflow-branch:${groupKey}`,
      number: item.number,
      state: item.state,
      label: 'Các tool chạy song song',
            workflowId: call.workflowId,
      workflowStage: call.workflowStage,
      children: [item],
    };
        groups.set(groupKey, branch);
    actions.push(branch);
  }
  return actions;
};
