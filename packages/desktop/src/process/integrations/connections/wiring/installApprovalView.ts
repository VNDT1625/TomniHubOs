/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turns the code-running connections of one package into what the in-app approval shows (docs/platform/repotopackage-design.md
 * section 9.4). It only reorganises the lines the host already wrote: groups by kind, one row per connection, identical
 * rows merged with a count, lines every row shares shown once per group, and the risks worth a warning. Approval hashes
 * are still computed by the registry from the host subject; nothing here decides what is approved.
 */

import type {
  InstallApprovalField,
  InstallApprovalFieldId,
  InstallApprovalGroup,
  InstallApprovalGroupKind,
  InstallApprovalPrompt,
  InstallApprovalRequest,
  InstallApprovalRisk,
  InstallApprovalRow,
} from '@/common/types/platform/packageConnections';
import type { InstallActivationItem } from './installActivation';

/** Host labels are English and fixed by each host; a label matching no rule is kept as the host wrote it. */
const FIELD_RULES: ReadonlyArray<readonly [RegExp, InstallApprovalFieldId]> = [
  [/^(command|argument|starts|.*: start)$/iu, 'command'],
  [/working folder|package folder/iu, 'folder'],
  [/setup/iu, 'setup'],
  [/variables|environment/iu, 'env'],
  [/network/iu, 'network'],
  [/^(url|opens|connects to)$/iu, 'url'],
];

const SETUP_INSTALLS = /\b(install|add|ci|sync)\b/iu;
const NETWORK_UNRESTRICTED = /not restricted|unrestricted/iu;
const GROUP_ORDER: Readonly<Record<InstallApprovalGroupKind, number>> = { mcp: 0, hook: 1, cli: 2, other: 3 };

const fieldIdOf = (label: string): InstallApprovalFieldId =>
  FIELD_RULES.find(([pattern]) => pattern.test(label))?.[1] ?? 'other';

const groupKindOf = (kind: string): InstallApprovalGroupKind =>
  kind === 'mcp' || kind === 'hook' || kind === 'cli' ? kind : 'other';

const keyOf = (field: InstallApprovalField): string => JSON.stringify([field.id, field.label, field.value]);

/** The command and argument lines of one connection are one command line, in their order. */
const fieldsOf = (lines: readonly { label: string; value: string }[]): InstallApprovalField[] => {
  const fields: InstallApprovalField[] = [];
  for (const line of lines) {
    const id = fieldIdOf(line.label);
    const command = id === 'command' ? fields.findIndex((field) => field.id === 'command') : -1;
    if (command >= 0) {
      const previous = fields[command];
      if (previous) fields[command] = { ...previous, value: `${previous.value} ${line.value}` };
      continue;
    }
    fields.push({ id, label: line.label, value: line.value });
  }
  return fields;
};

const risksOf = (fields: readonly InstallApprovalField[]): InstallApprovalRisk[] => {
  const risks = new Set<InstallApprovalRisk>();
  for (const field of fields) {
    if (field.id === 'setup' && SETUP_INSTALLS.test(field.value)) risks.add('setup-install');
    if (field.id === 'network' && NETWORK_UNRESTRICTED.test(field.value)) risks.add('network-open');
  }
  return [...risks];
};

/** Groups the items by connection kind. mcp, hook and cli come first; other kinds follow in the order they appear. */
export const buildInstallApprovalGroups = (items: readonly InstallActivationItem[]): InstallApprovalGroup[] => {
  const byKind = new Map<string, InstallActivationItem[]>();
  for (const item of items) byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item]);
  const ordered = [...byKind.entries()].toSorted(
    ([left], [right]) => GROUP_ORDER[groupKindOf(left)] - GROUP_ORDER[groupKindOf(right)]
  );
  return ordered.map(([kindName, members]) => {
    const rows = members.map((item) => ({ title: item.subject.title, fields: fieldsOf(item.subject.lines) }));
    // A line every row shares is shown once for the group, but only when there is more than one row to compare.
    const sharedKeys =
      rows.length > 1
        ? new Set(
            rows[0]?.fields
              .map(keyOf)
              .filter((key) => rows.every((row) => row.fields.some((field) => keyOf(field) === key))) ?? []
          )
        : new Set<string>();
    const shared = rows[0]?.fields.filter((field) => sharedKeys.has(keyOf(field))) ?? [];
    const merged = new Map<string, InstallApprovalRow>();
    for (const row of rows) {
      const own = row.fields.filter((field) => !sharedKeys.has(keyOf(field)));
      const signature = JSON.stringify([row.title, own.map(keyOf)]);
      const existing = merged.get(signature);
      merged.set(
        signature,
        existing ? { ...existing, count: existing.count + 1 } : { title: row.title, count: 1, fields: own }
      );
    }
    const risks = new Set<InstallApprovalRisk>();
    for (const row of rows) for (const risk of risksOf(row.fields)) risks.add(risk);
    return {
      kind: groupKindOf(kindName),
      kindName,
      count: members.length,
      shared,
      rows: [...merged.values()],
      risks: [...risks],
    };
  });
};

export const buildInstallApprovalRequest = (input: {
  requestId: string;
  packageId: string;
  packageName: string;
  items: readonly InstallActivationItem[];
  /** Defaults to the install confirmation. */
  prompt?: InstallApprovalPrompt;
}): InstallApprovalRequest => ({
  requestId: input.requestId,
  packageId: input.packageId,
  packageName: input.packageName,
  prompt: input.prompt ?? 'install',
  keys: input.items.map((item) => item.key),
  groups: buildInstallApprovalGroups(input.items),
});
