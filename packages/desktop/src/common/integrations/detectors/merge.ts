/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runs the detectors and merges what they found (design sections 7.2 and 7.5). The merge is a pure function of the
 * set of results: nothing depends on the order detectors ran in, because every collection is sorted by content
 * before it is returned.
 */

import {
  connectionKey,
  type AdapterConnection,
  type AdapterConnectionKind,
  type AdapterOpenItem,
} from '@/common/packages/adapter';
import { isSafeRelativePath } from '@/common/packages/adapter/primitives';
import { isDeclarationFile, normalizeRepoPath } from './inventory';
import type {
  DetectionReport,
  Detector,
  DetectorResult,
  MergeOptions,
  MergedDetection,
  RepoInventory,
  TextHash,
} from './types';

/**
 * Hosts whose plugins can be packaged for more than one agent, best first (design section 7.5 rule 3). An origin that
 * is not listed ranks last and is never dropped in favour of a host version.
 */
export const PLUGIN_HOST_ORDER: readonly string[] = [
  'claude-plugin',
  'agent-plugins',
  'codex-plugin',
  'copilot',
  'gemini-extension',
];

/** Largest number of alternatives one `choose` open item can name (the schema allows 16 ids). */
const MAX_CHOICES = 16;
const MAX_UNRECOGNIZED_OVERFLOW_ITEMS = 20;
const MAX_NOTE = 300;

const compareStrings = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/** JSON with object keys sorted, so equal data always gives the same text. */
const stableStringify = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).toSorted(([left], [right]) => compareStrings(left, right)))
      : item
  );

/** cyrb128: four 32-bit lanes, 32 hex characters. Not cryptographic; only used to build dedupe keys. */
export const defaultHash: TextHash = (text) => {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const mixed = h1 ^ h2 ^ h3 ^ h4;
  return [mixed ^ h1, mixed ^ h2, mixed ^ h3, mixed ^ h4]
    .map((lane) => (lane >>> 0).toString(16).padStart(8, '0'))
    .join('');
};

type Identified = AdapterConnection & { id: string };
const hasId = (connection: AdapterConnection): connection is Identified => 'id' in connection;

/** The MCP-only fields, read without narrowing the union (stdio has `command`, `args`, `cwd`; remote has `url`). */
type McpFacts = Readonly<{
  url?: string;
  transport?: string;
  command?: string;
  args?: readonly string[];
  cwd?: string;
}>;
const mcpFacts = (connection: AdapterConnection): McpFacts =>
  connection.kind === 'mcp' ? (connection as McpFacts) : {};

type Entry = Readonly<{
  connection: AdapterConnection;
  /** Identity for deduplication (design section 7.5 rule 1); not the same as `connectionKey`. */
  key: string;
  /** Where in the repository the connection lives; shorter means further out. */
  location: string;
  /** Position of the connection's origin in `PLUGIN_HOST_ORDER`, or the list length when it is not a host. */
  rank: number;
  serial: string;
}>;

const originRank = (connection: AdapterConnection): number => {
  const index = connection.origin === undefined ? -1 : PLUGIN_HOST_ORDER.indexOf(connection.origin);
  return index < 0 ? PLUGIN_HOST_ORDER.length : index;
};

const locationOf = (connection: AdapterConnection): string => {
  switch (connection.kind) {
    case 'skill':
    case 'command':
    case 'agent':
    case 'rules':
    case 'vscode':
      return connection.path;
    case 'extension':
      return connection.root;
    case 'mcp':
      return mcpFacts(connection).url !== undefined
        ? (connection.plugin ?? '')
        : (mcpFacts(connection).cwd ?? connection.plugin ?? '');
    default:
      return connection.plugin ?? '';
  }
};

const segmentCount = (path: string): number => (path === '' ? 0 : path.split('/').length);

/** Outermost first; ties go to the better host, then to the text so the choice is stable. */
const compareEntries = (left: Entry, right: Entry): number =>
  segmentCount(left.location) - segmentCount(right.location) ||
  left.location.length - right.location.length ||
  compareStrings(left.location, right.location) ||
  left.rank - right.rank ||
  compareStrings(left.serial, right.serial);

const bestEntry = (entries: readonly Entry[]): Entry => entries.toSorted(compareEntries)[0] as Entry;

const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---/u;
const FRONTMATTER_NAME = /^name:\s*(.+?)\s*$/mu;

/** Reads the skill `name` from SKILL.md frontmatter, looking the file up in the inventory. */
const createSkillNames = (inventory: RepoInventory): ((skillPath: string) => string | undefined) => {
  const byLower = new Map<string, string>();
  for (const file of inventory.files) byLower.set(file.toLowerCase(), file);
  return (skillPath) => {
    const folder = skillPath === 'source' ? '' : skillPath.replace(/^source\//u, '');
    const file = byLower.get((folder === '' ? 'skill.md' : `${folder}/skill.md`).toLowerCase());
    const text = file === undefined ? undefined : inventory.text(file);
    const block = text === undefined ? undefined : FRONTMATTER.exec(text)?.[1];
    const raw = block === undefined ? undefined : FRONTMATTER_NAME.exec(block)?.[1];
    const name = raw
      ?.replace(/^["']|["']$/gu, '')
      .trim()
      .toLowerCase();
    return name === undefined || name === '' ? undefined : name;
  };
};

const dedupeKeyOf = (
  connection: AdapterConnection,
  skillName: (skillPath: string) => string | undefined,
  hash: TextHash
): string => {
  switch (connection.kind) {
    case 'skill': {
      const name = skillName(connection.path);
      return name === undefined ? `skill:${connection.path}` : `skill:name:${name}`;
    }
    case 'mcp':
      return `mcp:${connection.id}`;
    case 'command':
    case 'agent':
      return `${connection.kind}:${connection.plugin ?? ''}:${connection.id}`;
    case 'hook': {
      const matcher = connection.matcher === undefined || connection.matcher === '' ? '*' : connection.matcher;
      return `hook:${hash(JSON.stringify([connection.event, matcher, connection.command, connection.args ?? []]))}`;
    }
    case 'rules':
      return `rules:${connection.path}`;
    case 'extension':
      return `extension:${connection.root}`;
    default:
      return connectionKey(connection);
  }
};

/** Design section 7.5 rule 3: inside one plugin folder, a host that ranks lower only adds what the best host lacks. */
const dropSecondaryHosts = (entries: readonly Entry[]): Entry[] => {
  const hostCount = PLUGIN_HOST_ORDER.length;
  const best = new Map<string, number>();
  for (const entry of entries) {
    const plugin = entry.connection.plugin;
    if (plugin !== undefined && entry.rank < hostCount)
      best.set(plugin, Math.min(best.get(plugin) ?? hostCount, entry.rank));
  }
  const covered = new Set<string>();
  for (const entry of entries) {
    const plugin = entry.connection.plugin;
    if (plugin !== undefined && entry.rank === best.get(plugin)) covered.add(`${plugin}\u0000${entry.key}`);
  }
  return entries.filter((entry) => {
    const plugin = entry.connection.plugin;
    if (plugin === undefined || entry.rank >= hostCount || entry.rank === best.get(plugin)) return true;
    return !covered.has(`${plugin}\u0000${entry.key}`);
  });
};

/** Default order inside a group of MCP alternatives: remote, then npx/uvx, then from source, then docker. */
const mcpPreference = (connection: AdapterConnection): number => {
  if (connection.kind !== 'mcp') return 4;
  const facts = mcpFacts(connection);
  if (facts.url !== undefined) return 0;
  if (facts.cwd !== undefined) return 2;
  if (facts.command === 'npx' || facts.command === 'uvx') return 1;
  return facts.command === 'docker' ? 3 : 2;
};

/** What an MCP server actually does; two entries with the same function are the same server. */
const mcpSignature = (connection: AdapterConnection): string => {
  if (connection.kind !== 'mcp') return '';
  const facts = mcpFacts(connection);
  return facts.url !== undefined
    ? stableStringify({ transport: facts.transport, url: facts.url })
    : stableStringify({ command: facts.command, args: facts.args, cwd: facts.cwd });
};

const mcpVariantSuffix = (connection: AdapterConnection): string => {
  if (connection.kind !== 'mcp') return 'alt';
  const facts = mcpFacts(connection);
  if (facts.url !== undefined) return facts.transport ?? 'remote';
  return facts.cwd !== undefined ? 'source' : (facts.command ?? 'local');
};

const withLimit = (base: string, suffix: string): string =>
  `${base.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;

/** A stable group id made from the server name. */
const groupIdFor = (name: string, hash: TextHash): string => {
  const id = `mcp-${name}`;
  return id.length <= 64 ? id : `mcp-${name.slice(0, 50)}-${hash(name).slice(0, 8)}`;
};

type VariantGroup = Readonly<{ name: string; members: readonly AdapterConnection[] }>;

type Resolved = Readonly<{
  kept: readonly AdapterConnection[];
  groups: readonly VariantGroup[];
  reasons: readonly string[];
}>;

/** Rules 1 and 2: one connection per key, except MCP servers of the same name that really differ. */
const resolveKeys = (entries: readonly Entry[], hash: TextHash): Resolved => {
  const byKey = new Map<string, Entry[]>();
  for (const entry of entries) byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), entry]);
  const kept: AdapterConnection[] = [];
  const groups: VariantGroup[] = [];
  const reasons: string[] = [];

  for (const key of [...byKey.keys()].toSorted(compareStrings)) {
    const list = byKey.get(key) ?? [];
    const signatures = new Map<string, Entry[]>();
    for (const entry of list)
      signatures.set(mcpSignature(entry.connection), [
        ...(signatures.get(mcpSignature(entry.connection)) ?? []),
        entry,
      ]);
    const first = list[0]?.connection;
    if (first === undefined) continue;
    if (first.kind !== 'mcp' || signatures.size === 1) {
      kept.push(bestEntry(list).connection);
      continue;
    }

    const representatives = [...signatures.values()]
      .map(bestEntry)
      .toSorted(
        (left, right) =>
          mcpPreference(left.connection) - mcpPreference(right.connection) || compareStrings(left.serial, right.serial)
      );
    if (representatives.length > MAX_CHOICES) {
      reasons.push(
        `MCP "${first.id}" có ${representatives.length} cách khai báo; chỉ giữ ${MAX_CHOICES} cách đứng đầu.`
      );
    }
    const group = groupIdFor(first.id, hash);
    const used = new Set<string>();
    const members: AdapterConnection[] = [];
    for (const representative of representatives.slice(0, MAX_CHOICES)) {
      const suffix = mcpVariantSuffix(representative.connection);
      let id = withLimit(first.id, `-${suffix}`);
      for (let counter = 2; used.has(id); counter += 1) id = withLimit(first.id, `-${suffix}-${counter}`);
      used.add(id);
      members.push({ ...(representative.connection as Identified), id, group } as AdapterConnection);
    }
    kept.push(...members);
    groups.push({ name: first.id, members });
  }
  return { kept, groups, reasons };
};

/**
 * Gives every connection a unique `connectionKey` (the document is rejected on duplicates). Returns the renamed
 * copies keyed by the original object so callers can still find a member after it was renamed.
 */
const uniquifyIds = (connections: readonly AdapterConnection[]): Map<AdapterConnection, AdapterConnection> => {
  const sorted = connections.toSorted(
    (left, right) =>
      compareStrings(connectionKey(left), connectionKey(right)) ||
      compareStrings(stableStringify(left), stableStringify(right))
  );
  const taken = new Set(sorted.map(connectionKey));
  const seen = new Set<string>();
  const result = new Map<AdapterConnection, AdapterConnection>();
  for (const connection of sorted) {
    const key = connectionKey(connection);
    if (!seen.has(key) || !hasId(connection)) {
      seen.add(key);
      result.set(connection, connection);
      continue;
    }
    let counter = 2;
    let id = withLimit(connection.id, `-${counter}`);
    while (taken.has(`${connection.kind}:${id}`)) {
      counter += 1;
      id = withLimit(connection.id, `-${counter}`);
    }
    taken.add(`${connection.kind}:${id}`);
    seen.add(`${connection.kind}:${id}`);
    result.set(connection, { ...connection, id } as AdapterConnection);
  }
  return result;
};

const ARCHETYPE_ORDER = [
  'mcp-tool-server',
  'agent-skill',
  'browser-extension',
  'web-service-app',
  'cli-tool',
  'desktop-app',
  'background-service',
  'knowledge-base',
  'vscode-extension',
  'bridge',
] as const;

const ARCHETYPE_OF_KIND: Readonly<Record<AdapterConnectionKind, (typeof ARCHETYPE_ORDER)[number]>> = {
  mcp: 'mcp-tool-server',
  skill: 'agent-skill',
  command: 'agent-skill',
  agent: 'agent-skill',
  hook: 'agent-skill',
  rules: 'agent-skill',
  extension: 'browser-extension',
  'web-embed': 'web-service-app',
  cli: 'cli-tool',
  tool: 'cli-tool',
  launcher: 'desktop-app',
  service: 'background-service',
  knowledge: 'knowledge-base',
  vscode: 'vscode-extension',
  bridge: 'bridge',
};

/**
 * The label shown for what a repository is (design section 7.5 rule 4). It counts usable connections per label
 * (an extension that still needs a build does not count) and takes the largest; a tie goes to the label that comes
 * first in a fixed order: mcp-tool-server, agent-skill, browser-extension, web-service-app, cli-tool, desktop-app,
 * background-service, knowledge-base, vscode-extension, bridge. With nothing usable it is `source-only`. The
 * label is for display and is not a `RepoArchetype`.
 */
export const pickArchetypeLabel = (connections: readonly AdapterConnection[]): string => {
  const counts = new Map<string, number>();
  for (const connection of connections) {
    if (connection.kind === 'extension' && connection.needsBuild === true) continue;
    const label = ARCHETYPE_OF_KIND[connection.kind];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  let winner = 'source-only';
  let best = 0;
  for (const label of ARCHETYPE_ORDER) {
    const count = counts.get(label) ?? 0;
    if (count > best) {
      best = count;
      winner = label;
    }
  }
  return winner;
};

const HIGH_SIGNAL_NAMES: ReadonlySet<string> = new Set([
  'plugin.json',
  'marketplace.json',
  'hooks.json',
  '.mcp.json',
  'mcp.json',
  'mcp_config.json',
  'gemini-extension.json',
  'skill.md',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'agents.md',
  'claude.md',
  'gemini.md',
  '.cursorrules',
]);

/**
 * Declaration files that, unclaimed, deserve an `unrecognized` open item (design section 7.5 rule 5). Most
 * declaration files (`package.json`, `pyproject.toml`, `requirements.txt`, ...) are common and often yield no
 * connection, so flagging them would only add noise. High-signal files are: plugin, marketplace, hooks, MCP, Gemini
 * extension, SKILL.md, compose and rules files by name; `manifest.json` only with a `manifest_version`;
 * `.claude/settings.json` only with a `hooks` block; a `*.user.js` only with a `==UserScript==` header; Copilot
 * instructions, Cursor/Windsurf rules, Kiro steering and `.clinerules` files.
 */
export const isHighSignalDeclaration = (path: string, text: string | undefined): boolean => {
  const lower = path.toLowerCase();
  const name = lower.slice(lower.lastIndexOf('/') + 1);
  if (HIGH_SIGNAL_NAMES.has(name)) return true;
  if (name === 'manifest.json') return text !== undefined && /"manifest_version"\s*:/u.test(text);
  if (lower.endsWith('.claude/settings.json')) return text !== undefined && /"hooks"\s*:/u.test(text);
  if (name.endsWith('.user.js')) return text !== undefined && text.includes('==UserScript==');
  return (
    lower.endsWith('.github/copilot-instructions.md') ||
    /(?:^|\/)(?:\.cursor|\.windsurf)\/rules\/.+/u.test(lower) ||
    /(?:^|\/)\.kiro\/steering\/.+/u.test(lower) ||
    /(?:^|\/)\.clinerules(?:\/.+)?$/u.test(lower)
  );
};

const packagePathOf = (path: string): string | undefined => {
  const candidate = `source/${path}`;
  return candidate.length <= 240 && isSafeRelativePath(candidate) ? candidate : undefined;
};

const clip = (text: string): string => (text.length <= MAX_NOTE ? text : `${text.slice(0, MAX_NOTE - 1)}…`);

const unrecognizedItem = (note: string, path: string): AdapterOpenItem => {
  const packagePath = packagePathOf(path);
  return packagePath === undefined
    ? { kind: 'unrecognized', note: clip(`${note} (${path})`) }
    : { kind: 'unrecognized', note: clip(note), path: packagePath };
};

const dedupeAndSort = <T>(items: readonly T[]): T[] => {
  const byText = new Map<string, T>();
  for (const item of items) byText.set(stableStringify(item), item);
  return [...byText.entries()].toSorted(([left], [right]) => compareStrings(left, right)).map(([, item]) => item);
};

/** Unclaimed high-signal files and files skipped for size (design sections 7.1 and 7.5 rule 5). */
const inventoryOpenItems = (inventory: RepoInventory, results: readonly DetectorResult[]): AdapterOpenItem[] => {
  const claimed = new Set<string>();
  for (const result of results) {
    for (const path of result.claimed) {
      const normalized = normalizeRepoPath(path);
      if (normalized === undefined) continue;
      claimed.add(normalized);
      if (normalized.startsWith('source/')) claimed.add(normalized.slice('source/'.length));
    }
  }
  const skipped = new Set(inventory.overflow);
  const items: AdapterOpenItem[] = [];
  for (const path of inventory.files) {
    if (!isDeclarationFile(path) || claimed.has(path) || skipped.has(path)) continue;
    if (isHighSignalDeclaration(path, inventory.text(path))) {
      items.push(unrecognizedItem('Tệp khai báo chưa có bộ nhận diện nào xử lý', path));
    }
  }
  for (const path of inventory.overflow.slice(0, MAX_UNRECOGNIZED_OVERFLOW_ITEMS)) {
    items.push(unrecognizedItem('repo quá nhiều tệp khai báo: tệp này không được đọc', path));
  }
  if (inventory.overflow.length > MAX_UNRECOGNIZED_OVERFLOW_ITEMS) {
    items.push({
      kind: 'unrecognized',
      note: `repo quá nhiều tệp khai báo: còn ${inventory.overflow.length - MAX_UNRECOGNIZED_OVERFLOW_ITEMS} tệp khác không được đọc`,
    });
  }
  return items;
};

/**
 * Merges detector results (design section 7.5). The output depends only on the set of results, not on their order.
 * Rules: duplicates share a key (skill by frontmatter name, MCP by server name, command and agent by name inside a
 * plugin, hook by a hash of event, matcher, command and args, rules by path, extension by root) and the outermost
 * copy wins; inside one plugin folder the best host (`PLUGIN_HOST_ORDER`) wins and the others only add what it lacks;
 * MCP servers of one name that really differ are all kept in one `group` with a `choose` open item and the best
 * default first (reported as `preferred ...` in `reasons`). Ids are made unique, and declaration files nobody
 * claimed become `unrecognized` open items.
 */
export const mergeResults = (
  inventory: RepoInventory,
  results: readonly DetectorResult[],
  options: MergeOptions = {}
): MergedDetection => {
  const hash = options.hash ?? defaultHash;
  const skillName = createSkillNames(inventory);

  const connections = dedupeAndSort(results.flatMap((result) => result.connections));
  const entries: Entry[] = connections.map((connection) => ({
    connection,
    key: dedupeKeyOf(connection, skillName, hash),
    location: locationOf(connection),
    rank: originRank(connection),
    serial: stableStringify(connection),
  }));

  const resolved = resolveKeys(dropSecondaryHosts(entries), hash);
  const renamed = uniquifyIds(resolved.kept);
  const finalConnections = [...renamed.values()].toSorted(
    (left, right) =>
      compareStrings(connectionKey(left), connectionKey(right)) ||
      compareStrings(stableStringify(left), stableStringify(right))
  );

  const reasons = [...results.flatMap((result) => result.reasons), ...resolved.reasons];
  const generated: AdapterOpenItem[] = [];
  const idsByName = new Map<string, readonly string[]>();
  for (const group of resolved.groups) {
    const ids = group.members.map((member) => {
      const final = renamed.get(member);
      return final !== undefined && hasId(final) ? final.id : '';
    });
    idsByName.set(group.name, ids);
    generated.push({
      kind: 'choose',
      note: clip(`MCP "${group.name}" được khai báo theo nhiều cách khác nhau; chọn một (mặc định: ${ids[0] ?? ''}).`),
      connections: ids,
    });
    reasons.push(`preferred: ${ids[0] ?? ''} (nhóm ${group.name})`);
  }

  // An item that named an MCP server that was split into alternatives now applies to each alternative.
  const carried = results
    .flatMap((result) => result.openItems)
    .flatMap((item) => {
      const targets = item.connection === undefined ? undefined : idsByName.get(item.connection);
      return targets === undefined ? [item] : targets.map((connection) => Object.assign({}, item, { connection }));
    });

  return {
    connections: finalConnections,
    openItems: dedupeAndSort([...carried, ...generated, ...inventoryOpenItems(inventory, results)]),
    reasons: [...new Set(reasons)].toSorted(compareStrings),
    archetype: pickArchetypeLabel(finalConnections),
  };
};

const asArray = <T>(value: unknown): readonly T[] => (Array.isArray(value) ? (value as readonly T[]) : []);

/** Checks that a detector returned an object; its lists are coerced so a sloppy detector cannot break the merge. */
const normalizeResult = (value: unknown): DetectorResult => {
  if (value === null || typeof value !== 'object') throw new Error('kết quả không phải một đối tượng');
  const record = value as Record<string, unknown>;
  return {
    connections: asArray<AdapterConnection>(record.connections),
    openItems: asArray<AdapterOpenItem>(record.openItems),
    reasons: asArray<unknown>(record.reasons).filter((reason): reason is string => typeof reason === 'string'),
    claimed: asArray<unknown>(record.claimed).filter((path): path is string => typeof path === 'string'),
  };
};

/**
 * Criterion C2 (design section 7.5 rule 5), detector side: a declaration file a detector says it handled must end up
 * as a connection or an open item. A detector that claims files but returns neither would drop them silently, so
 * each claimed file becomes an `unrecognized` item (up to `MAX_UNRECOGNIZED_OVERFLOW_ITEMS`). Files nobody claimed
 * are covered by `inventoryOpenItems`.
 */
const withCoverage = (result: DetectorResult): DetectorResult => {
  if (result.claimed.length === 0 || result.connections.length > 0 || result.openItems.length > 0) return result;
  const uncovered = [...new Set(result.claimed)].toSorted(compareStrings);
  const items = uncovered
    .slice(0, MAX_UNRECOGNIZED_OVERFLOW_ITEMS)
    .map((path) => unrecognizedItem('Tệp khai báo đã được đọc nhưng không tạo ra kết nối nào', path));
  if (uncovered.length > MAX_UNRECOGNIZED_OVERFLOW_ITEMS) {
    items.push({
      kind: 'unrecognized',
      note: `${uncovered.length - MAX_UNRECOGNIZED_OVERFLOW_ITEMS} tệp khai báo khác được đọc nhưng không tạo ra kết nối nào`,
    });
  }
  return { ...result, openItems: items };
};

/**
 * Runs every detector and merges. A detector that throws is replaced by an `unrecognized` open item that names it;
 * the others are unaffected. `detectors` in the report lists `"<id>@<version>"` for all detectors that were run.
 */
export const detectAll = (
  inventory: RepoInventory,
  detectors: readonly Detector[],
  options: MergeOptions = {}
): DetectionReport => {
  const results: DetectorResult[] = [];
  for (const detector of detectors) {
    try {
      results.push(withCoverage(normalizeResult(detector.detect(inventory))));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        connections: [],
        openItems: [
          { kind: 'unrecognized', note: clip(`Bộ nhận diện "${detector.id}" gặp lỗi: ${message.slice(0, 160)}`) },
        ],
        reasons: [`detector ${detector.id} lỗi`],
        claimed: [],
      });
    }
  }
  return {
    ...mergeResults(inventory, results, options),
    detectors: [...new Set(detectors.map((detector) => `${detector.id}@${detector.version}`))].toSorted(compareStrings),
  };
};
