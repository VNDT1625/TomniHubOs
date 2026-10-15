/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What an install did to the connections of a package, in words, grouped by kind: what is on (and whether it starts again
 * at launch), and what stayed off with the reason. The chat message is built only from this, so it cannot disagree with
 * the connection state the registry reports.
 */

import type { AdapterConnectionKind } from '@/common/packages/adapter';
import { DATA_KINDS } from '@process/integrations/connections/core/registry';
import type { InstallActivationReport } from './installActivation';

export type InstalledConnectionLine = Readonly<{ key: string; status: string; reason?: string }>;

export type InstallReportInput = Readonly<{
  /** Every connection of the package after the install, with its state. */
  connections: readonly InstalledConnectionLine[];
  /** What the activation step did; absent when the install did not ask for activation. */
  activation?: InstallActivationReport;
}>;

const KIND_LABELS: Readonly<Record<string, string>> = {
  mcp: 'MCP',
  hook: 'Hook',
  cli: 'CLI',
  skill: 'Skill',
  command: 'Lệnh',
  agent: 'Agent',
  rules: 'Quy tắc',
  knowledge: 'Kiến thức',
  tool: 'Công cụ',
  service: 'Dịch vụ',
  'web-embed': 'Web app',
  launcher: 'Ứng dụng ngoài',
  extension: 'Tiện ích trình duyệt',
  bridge: 'Cầu nối',
  vscode: 'VS Code',
};

const SHOWN_KEYS = 5;
const kindOf = (key: string): string => key.split(':')[0] ?? key;
const labelOf = (kind: string): string => KIND_LABELS[kind] ?? kind;

const keyList = (keys: readonly string[]): string => {
  const shown = keys.slice(0, SHOWN_KEYS).map((key) => `\`${key}\``);
  return `${shown.join(', ')}${keys.length > SHOWN_KEYS ? `, … (+${keys.length - SHOWN_KEYS})` : ''}`;
};

/** Keys of one kind in the order they were given, split by kind, kinds in the order they first appear. */
const byKind = <T extends { key: string }>(items: readonly T[]): Array<[string, T[]]> => {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(kindOf(item.key), [...(groups.get(kindOf(item.key)) ?? []), item]);
  return [...groups.entries()];
};

/**
 * The report lines for the connections of one package. Enabled kinds say what is on; code-running kinds that are on also
 * say whether they start again at launch. Off kinds give each reason once, in the words the activation step used.
 */
export const installReportLines = (input: InstallReportInput): string[] => {
  if (input.connections.length === 0) return ['Gói này không khai báo kết nối nào.'];
  const enabled = input.activation?.enabled ?? [];
  const onKeys = new Set(enabled.map((item) => item.key));
  const reasons = new Map((input.activation?.stayedOff ?? []).map((item) => [item.key, item.reason]));
  const off = input.connections.filter((connection) => !onKeys.has(connection.key));
  const lines: string[] = [];

  if (enabled.length > 0) {
    lines.push(`🔌 **Đã bật ${enabled.length} kết nối:**`);
    for (const [kind, items] of byKind(enabled)) {
      const notes = new Set<string>();
      if (!DATA_KINDS.has(kind as AdapterConnectionKind)) {
        if (items.some((item) => item.autoStart)) notes.add('tự bật khi mở lại ứng dụng');
        if (items.some((item) => !item.autoStart)) notes.add('chỉ bật trong phiên này, tắt khi thoát ứng dụng');
      }
      if (kind === 'mcp') notes.add('xem và quản lý trong Cài đặt → MCP');
      const suffix = notes.size > 0 ? ` (${[...notes].join('; ')})` : '';
      lines.push(`- ${labelOf(kind)} (${items.length}): ${keyList(items.map((item) => item.key))}${suffix}`);
    }
  } else {
    lines.push('Chưa bật kết nối nào.');
  }

  if (off.length > 0) {
    lines.push(`⏸ **Còn tắt ${off.length} kết nối:**`);
    for (const [kind, items] of byKind(off)) {
      const byReason = new Map<string, string[]>();
      for (const item of items) {
        const reason = reasons.get(item.key) ?? item.reason ?? 'chưa bật';
        byReason.set(reason, [...(byReason.get(reason) ?? []), item.key]);
      }
      for (const [reason, keys] of byReason) {
        lines.push(`- ${labelOf(kind)} (${keys.length}): ${keyList(keys)} — ${reason}`);
      }
    }
  }
  return lines;
};
