/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure planning for "update from source" (docs/platform/repotopackage-design.md section 9.5, criterion C6).
 *
 * Nothing here touches the network, the disk or the package manager. Given the adapter of the installed package and
 * the adapter that re-running detection and packaging just produced, it decides, per `connectionKey`, which of the
 * four cases of 9.5 applies:
 *
 * 1. unchanged - the connection is identical: whatever the user switched on stays on;
 * 2. data-changed - a connection that only holds content (skill, command, agent, rules, knowledge) changed: it
 *    follows the update and stays on;
 * 3. code-changed - a connection that can run code changed: it turns off and needs the user's approval again;
 * 4. added / removed - a new connection starts off; one the source no longer declares is removed by its host.
 *
 * The plan is a preview. The connection registry (`syncPackage`) remains the authority: it recomputes each
 * approval hash, which also covers the content of the files a connection runs, and that is what really keeps a
 * connection on or turns it off. A change that is visible only in such a file therefore shows up in the observed
 * result of an update, not in this plan; the plan can never make a connection stay on.
 */

import semver from 'semver';
import {
  connectionKey,
  type AdapterConnection,
  type AdapterConnectionKind,
  type AdapterDocument,
  type AdapterOpenItem,
  type AdapterProvenance,
} from '@/common/packages/adapter';
import { canonicalJson } from '@process/integrations/connections/core/approval';

/**
 * Connections that hold content for the agent and never run code. This mirrors the set the connection registry uses
 * to decide that a connection follows an update; every other kind, including `mcp` over http and `web-embed` over a
 * url, needs a new approval when it changes (a changed address is a changed network destination, so the safer side
 * is taken).
 */
export const DATA_CONNECTION_KINDS: ReadonlySet<AdapterConnectionKind> = new Set([
  'skill',
  'command',
  'agent',
  'rules',
  'knowledge',
]);

export type ConnectionUpdateCase = 'unchanged' | 'data-changed' | 'code-changed' | 'added' | 'removed';

/**
 * What the update does to the connection, given whether the user had it on.
 * `keeps-state` includes a changed connection that was off: it stays off and is approved when it is next switched on.
 */
export type ConnectionUpdateEffect =
  | 'keeps-state'
  | 'follows-update'
  | 'turns-off-needs-approval'
  | 'added-off'
  | 'removed';

export type ConnectionUpdateEntry = Readonly<{
  key: string;
  kind: AdapterConnectionKind;
  change: ConnectionUpdateCase;
  wasEnabled: boolean;
  effect: ConnectionUpdateEffect;
}>;

export type OpenItemChange = Readonly<{ previous: AdapterOpenItem; next: AdapterOpenItem }>;

export type OpenItemDiff = Readonly<{
  added: readonly AdapterOpenItem[];
  removed: readonly AdapterOpenItem[];
  /** Same item (kind, connection, path, name) whose note or options changed. */
  changed: readonly OpenItemChange[];
  unchanged: number;
}>;

export type SourceUpdatePlan = Readonly<{
  /** Sorted by key, so equal inputs always give an equal plan. */
  connections: readonly ConnectionUpdateEntry[];
  openItems: OpenItemDiff;
  counts: Readonly<Record<ConnectionUpdateCase, number>>;
  /** Keys that were on and will be off until approved again. */
  needsReapproval: readonly string[];
  /** True when neither a connection nor an open item differs. */
  noChanges: boolean;
}>;

const compareCodeUnits = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export const isDataConnection = (connection: AdapterConnection): boolean => DATA_CONNECTION_KINDS.has(connection.kind);

const openItemIdentity = (item: AdapterOpenItem): string =>
  [item.kind, item.connection ?? '', item.path ?? '', item.name ?? ''].join('\u0000');

const groupByIdentity = (items: readonly AdapterOpenItem[]): Map<string, AdapterOpenItem[]> => {
  const groups = new Map<string, AdapterOpenItem[]>();
  for (const item of items) {
    const identity = openItemIdentity(item);
    const group = groups.get(identity);
    if (group) group.push(item);
    else groups.set(identity, [item]);
  }
  return groups;
};

/** Items with the same identity are paired in order, so repeated identical items are counted, not merged. */
export const diffOpenItems = (previous: readonly AdapterOpenItem[], next: readonly AdapterOpenItem[]): OpenItemDiff => {
  const before = groupByIdentity(previous);
  const after = groupByIdentity(next);
  const added: AdapterOpenItem[] = [];
  const removed: AdapterOpenItem[] = [];
  const changed: OpenItemChange[] = [];
  let unchanged = 0;

  for (const [identity, nextGroup] of after) {
    const previousGroup = before.get(identity) ?? [];
    for (const [index, item] of nextGroup.entries()) {
      const match = previousGroup[index];
      if (match === undefined) added.push(item);
      else if (canonicalJson(match) === canonicalJson(item)) unchanged += 1;
      else changed.push({ previous: match, next: item });
    }
    removed.push(...previousGroup.slice(nextGroup.length));
  }
  for (const [identity, previousGroup] of before) {
    if (!after.has(identity)) removed.push(...previousGroup);
  }
  return { added, removed, changed, unchanged };
};

const effectOf = (change: ConnectionUpdateCase, wasEnabled: boolean): ConnectionUpdateEffect => {
  switch (change) {
    case 'added':
      return 'added-off';
    case 'removed':
      return 'removed';
    case 'data-changed':
      return wasEnabled ? 'follows-update' : 'keeps-state';
    case 'code-changed':
      return wasEnabled ? 'turns-off-needs-approval' : 'keeps-state';
    default:
      return 'keeps-state';
  }
};

export type PlanSourceUpdateInput = Readonly<{
  previous: AdapterDocument;
  next: AdapterDocument;
  /** `connectionKey`s the user currently has switched on. */
  enabledKeys: ReadonlySet<string>;
}>;

export const planSourceUpdate = (input: PlanSourceUpdateInput): SourceUpdatePlan => {
  const before = new Map(input.previous.connections.map((connection) => [connectionKey(connection), connection]));
  const after = new Map(input.next.connections.map((connection) => [connectionKey(connection), connection]));
  const entries: ConnectionUpdateEntry[] = [];

  for (const [key, connection] of after) {
    const old = before.get(key);
    const wasEnabled = input.enabledKeys.has(key);
    let change: ConnectionUpdateCase;
    if (old === undefined) change = 'added';
    else if (canonicalJson(old) === canonicalJson(connection)) change = 'unchanged';
    else change = isDataConnection(connection) ? 'data-changed' : 'code-changed';
    entries.push({
      key,
      kind: connection.kind,
      change,
      wasEnabled: old === undefined ? false : wasEnabled,
      effect: effectOf(change, old === undefined ? false : wasEnabled),
    });
  }
  for (const [key, connection] of before) {
    if (after.has(key)) continue;
    entries.push({
      key,
      kind: connection.kind,
      change: 'removed',
      wasEnabled: input.enabledKeys.has(key),
      effect: 'removed',
    });
  }
  entries.sort((left, right) => compareCodeUnits(left.key, right.key));

  const counts: Record<ConnectionUpdateCase, number> = {
    unchanged: 0,
    'data-changed': 0,
    'code-changed': 0,
    added: 0,
    removed: 0,
  };
  for (const entry of entries) counts[entry.change] += 1;

  const openItems = diffOpenItems(input.previous.openItems ?? [], input.next.openItems ?? []);
  const noChanges =
    entries.every((entry) => entry.change === 'unchanged') &&
    openItems.added.length === 0 &&
    openItems.removed.length === 0 &&
    openItems.changed.length === 0;

  return {
    connections: entries,
    openItems,
    counts,
    needsReapproval: entries.filter((entry) => entry.effect === 'turns-off-needs-approval').map((entry) => entry.key),
    noChanges,
  };
};

export type UpdatableSource =
  | Readonly<{ ok: true; url: string; ref?: string; subdirectory?: string; commit?: string }>
  | Readonly<{ ok: false; reason: 'NO_PROVENANCE' | 'SOURCE_NOT_UPDATABLE'; message: string }>;

/**
 * Which recorded sources this module can fetch again. Only a Git source with an address qualifies; a folder, a
 * website, a Store package or a Chrome Web Store extension is updated by its own source module.
 */
export const resolveUpdatableSource = (provenance: AdapterProvenance | undefined): UpdatableSource => {
  if (provenance === undefined) {
    return {
      ok: false,
      reason: 'NO_PROVENANCE',
      message: 'Gói này không ghi nguồn gốc nên không cập nhật từ nguồn được.',
    };
  }
  if (provenance.kind !== 'git' || provenance.url === undefined) {
    return {
      ok: false,
      reason: 'SOURCE_NOT_UPDATABLE',
      message: 'Nguồn của gói này không phải địa chỉ Git nên chưa cập nhật từ nguồn được.',
    };
  }
  return {
    ok: true,
    url: provenance.url,
    ...(provenance.ref !== undefined ? { ref: provenance.ref } : {}),
    ...(provenance.subdirectory !== undefined ? { subdirectory: provenance.subdirectory } : {}),
    ...(provenance.commit !== undefined ? { commit: provenance.commit } : {}),
  };
};

/** True when `candidate` can be installed over `installed` as an update (the package manager refuses a downgrade). */
export const isUpgradeVersion = (installed: string, candidate: string): boolean =>
  semver.valid(installed) !== null && semver.valid(candidate) !== null && semver.gt(candidate, installed);

/** The version a rebuilt package gets when the repository did not raise its own: the patch number goes up by one. */
export const bumpPatchVersion = (installed: string): string | undefined => {
  if (semver.valid(installed) === null) return undefined;
  return semver.inc(installed, 'patch') ?? undefined;
};
