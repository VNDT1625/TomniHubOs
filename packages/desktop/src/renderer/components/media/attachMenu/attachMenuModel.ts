/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IConversationMcpStatus, IMcpServer } from '@/common/config/storage';
import type {
  PackageConnectionResult,
  PackageConnectionView,
  PackageEnableReport,
} from '@/common/types/platform/packageConnections';

/** Second column that is open beside the main menu. */
export type AttachCategory = 'mcp' | 'skills' | 'hooks';

/** A skill or MCP server that belongs to an installed package (undefined packageId means standalone). */
export type AttachMcpEntry = {
  item: IConversationMcpStatus;
  packageId?: string;
  /** An installed plugin that is off: its server is not in the catalog yet. Picking it turns its package on. */
  pending?: boolean;
};
export type AttachSkillEntry = { name: string; description?: string; packageId?: string };

export type AttachPackageGroup = {
  packageId: string;
  name: string;
  mcp: AttachMcpEntry[];
  skills: AttachSkillEntry[];
};

export type AttachMenuModel = {
  /** Items the person added or that ship with the app. They stay flat rows, never inside a package cluster. */
  standalone: { mcp: AttachMcpEntry[]; skills: AttachSkillEntry[] };
  packages: AttachPackageGroup[];
};

export type SkillViewerTarget = { name: string; packageId?: string; packageName?: string };

/** State of a group checkbox: every member on, some on, or none on. */
export type GroupCheckState = 'checked' | 'indeterminate' | 'unchecked';

/** Group checkbox state from the members' checked flags. An empty group reads as unchecked. */
export const groupCheckState = (checked: readonly boolean[]): GroupCheckState => {
  const onCount = checked.filter(Boolean).length;
  if (onCount === 0) return 'unchecked';
  return onCount === checked.length ? 'checked' : 'indeterminate';
};

/**
 * Trigger placement shared by every attach or tools menu: the menu opens upward, is anchored to its button and is
 * moved by Arco when the viewport is short (autoFitPosition). Opening is click-only; there is no hover behavior.
 */
export const ATTACH_MENU_TRIGGER = {
  position: 'tl',
  trigger: 'click',
  clickToClose: true,
  autoFitPosition: true,
  popupAlign: { bottom: 8 },
} as const;

const PACKAGE_CONNECTION_MCP_ID = /^pkgconn:([a-z0-9][a-z0-9._-]*):/u;
const PACKAGE_OWNER_PREFIX = 'package:';

/**
 * Finds the installed package that owns an MCP status. Connection servers carry their package in the id; other
 * servers carry it in `extension.name` (`package:<id>`). Anything else is standalone.
 */
export const packageIdOfMcp = (item: IConversationMcpStatus, servers?: IMcpServer[]): string | undefined => {
  const fromId = PACKAGE_CONNECTION_MCP_ID.exec(item.id)?.[1];
  if (fromId) return fromId;
  const wantedName = item.name.trim().toLowerCase();
  const server =
    servers?.find((candidate) => candidate.id === item.id) ??
    servers?.find((candidate) => candidate.name.trim().toLowerCase() === wantedName);
  const owner = server?.extension?.name;
  if (!owner?.startsWith(PACKAGE_OWNER_PREFIX)) return undefined;
  const packageId = owner.slice(PACKAGE_OWNER_PREFIX.length);
  return packageId.length > 0 ? packageId : undefined;
};

/** One package cluster of any entry kind. */
export type AttachEntryGroup<T> = { packageId: string; name: string; items: T[] };

/**
 * Shared grouping for every attach-menu list (plugins, skills, hooks). Entries without a package stay standalone. Clusters
 * are ordered by display name, and a package with no installed name falls back to its id.
 */
export const groupEntriesByPackage = <T extends { packageId?: string }>(
  entries: readonly T[],
  packageNames: ReadonlyMap<string, string>
): { standalone: T[]; groups: AttachEntryGroup<T>[] } => {
  const standalone: T[] = [];
  const groups = new Map<string, AttachEntryGroup<T>>();
  for (const entry of entries) {
    if (entry.packageId === undefined) {
      standalone.push(entry);
      continue;
    }
    const existing = groups.get(entry.packageId);
    if (existing) {
      existing.items.push(entry);
    } else {
      groups.set(entry.packageId, {
        packageId: entry.packageId,
        name: packageNames.get(entry.packageId) ?? entry.packageId,
        items: [entry],
      });
    }
  }
  return { standalone, groups: [...groups.values()].toSorted((a, b) => a.name.localeCompare(b.name)) };
};

/** Splits entries into standalone rows and per-package clusters. Clusters are ordered by display name. */
export const buildAttachMenuModel = (
  mcp: AttachMcpEntry[],
  skills: AttachSkillEntry[],
  packageNames: ReadonlyMap<string, string>
): AttachMenuModel => {
  const standalone = {
    mcp: mcp.filter((entry) => entry.packageId === undefined),
    skills: skills.filter((entry) => entry.packageId === undefined),
  };
  const groups = new Map<string, AttachPackageGroup>();
  const groupFor = (packageId: string): AttachPackageGroup => {
    const existing = groups.get(packageId);
    if (existing) return existing;
    const created: AttachPackageGroup = {
      packageId,
      name: packageNames.get(packageId) ?? packageId,
      mcp: [],
      skills: [],
    };
    groups.set(packageId, created);
    return created;
  };
  for (const entry of mcp) if (entry.packageId !== undefined) groupFor(entry.packageId).mcp.push(entry);
  for (const entry of skills) if (entry.packageId !== undefined) groupFor(entry.packageId).skills.push(entry);
  const packages = [...groups.values()].toSorted((a, b) => a.name.localeCompare(b.name));
  return { standalone, packages };
};

/** An MCP connection of an installed package, as the Plugin column lists it whether it is on or off. */
export type InstalledPlugin = { packageId: string; title: string; serverId: string };

const MCP_KEY_PREFIX = 'mcp:';

/**
 * The Plugin entries of one installed package: one per MCP connection, whatever its state. The server id is the one the
 * connection host registers while the connection is on (`pkgconn:<package>:<connection>`), so an entry is recognised in
 * the catalog once it is on.
 */
export const installedPluginsOf = (
  packageId: string,
  views: readonly Pick<PackageConnectionView, 'key' | 'kind' | 'title'>[]
): InstalledPlugin[] =>
  views
    .filter((view) => view.kind === 'mcp' && view.key.startsWith(MCP_KEY_PREFIX))
    .map((view) => ({
      packageId,
      title: view.title,
      serverId: `pkgconn:${packageId}:${view.key.slice(MCP_KEY_PREFIX.length)}`,
    }));

/**
 * Plugin entries for installed plugins whose server is not in the catalog (they are off). They sit in their package
 * cluster and are never selected; picking one turns the package on, and from then on its server can be attached.
 */
export const pendingPluginEntries = (
  plugins: readonly InstalledPlugin[],
  catalogServerIds: ReadonlySet<string>
): AttachMcpEntry[] =>
  plugins
    .filter((plugin) => !catalogServerIds.has(plugin.serverId))
    .map((plugin) => ({
      item: { id: plugin.serverId, name: plugin.title, status: 'unsupported' },
      packageId: plugin.packageId,
      pending: true,
    }));

/** What the menu says after a plugin was picked: it is on, the request failed, or its MCP connection stayed off. */
export type PluginEnableOutcome =
  | { kind: 'on' }
  | { kind: 'failed'; code: string }
  | { kind: 'stayed-off'; reason: string };

/**
 * Reads the package switch's answer for a picked plugin. Only the MCP connections decide the outcome: a cancelled
 * approval leaves them off, and the reason says so; other connections of the package (hooks, skills) do not block it.
 */
export const pluginEnableOutcome = (result: PackageConnectionResult<PackageEnableReport>): PluginEnableOutcome => {
  if (result.ok === false) return { kind: 'failed', code: result.error };
  const stayed = result.data.stayedOff.find((item) => item.key.startsWith(MCP_KEY_PREFIX));
  return stayed === undefined ? { kind: 'on' } : { kind: 'stayed-off', reason: stayed.reason };
};
