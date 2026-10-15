/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Finds the plugin folders of a repository (design section 7.3, `agent-plugins`): folders with a Claude Code, Codex,
 * Copilot or agent-plugins.org manifest, and the local folders named by a `marketplace.json`. A marketplace entry
 * that points at another repository is reported and never fetched; a path that is not a safe, relative folder of
 * this repository is rejected.
 */

import {
  cleanRelative,
  field,
  folderExists,
  isRecord,
  joinPath,
  listField,
  loadJson,
  plain,
  report,
  stringField,
  type Context,
  type JsonRecord,
  type Origin,
} from './support';

export type PluginRoot = Readonly<{
  /** Repository-relative plugin folder; the empty string is the repository root. */
  path: string;
  origin: Origin;
  /** Parsed manifests and inline marketplace entries; their keys name extra component paths. */
  manifests: readonly JsonRecord[];
  /** Repository path of the manifest used in notes. */
  manifestFile: string;
}>;

type Draft = {
  manifests: JsonRecord[];
  files: string[];
  claude: boolean;
  codex: boolean;
  copilot: boolean;
  agentPlugins: boolean;
  /** Origin implied by the marketplace that lists the folder, best first. */
  market: Origin | undefined;
};

type Marker = Readonly<{ suffix: string; origin: 'claude-plugin' | 'codex-plugin' | 'copilot' }>;

const MARKETPLACES: readonly Marker[] = [
  { suffix: '.claude-plugin/marketplace.json', origin: 'claude-plugin' },
  { suffix: '.agents/plugins/marketplace.json', origin: 'codex-plugin' },
  { suffix: '.github/plugin/marketplace.json', origin: 'copilot' },
];
const MARKET_ORDER: readonly Origin[] = ['claude-plugin', 'codex-plugin', 'copilot'];
const MAX_MARKETPLACE_ENTRIES = 200;

/** The folder above a marker such as `.claude-plugin/plugin.json`, or `undefined` when `file` does not end with it. */
const baseOf = (file: string, suffix: string): string | undefined => {
  const lower = file.toLowerCase();
  if (lower === suffix) return '';
  return lower.endsWith(`/${suffix}`) ? file.slice(0, file.length - suffix.length - 1) : undefined;
};

const draftFor = (drafts: Map<string, Draft>, path: string): Draft => {
  const existing = drafts.get(path);
  if (existing !== undefined) return existing;
  const created: Draft = {
    manifests: [],
    files: [],
    claude: false,
    codex: false,
    copilot: false,
    agentPlugins: false,
    market: undefined,
  };
  drafts.set(path, created);
  return created;
};

/** True when the `$schema` of a manifest is hosted on agent-plugins.org. */
const isAgentPluginsSchema = (manifest: JsonRecord): boolean => {
  const schema = stringField(manifest, '$schema');
  if (schema === undefined) return false;
  try {
    const host = new URL(schema).hostname.toLowerCase();
    return host === 'agent-plugins.org' || host.endsWith('.agent-plugins.org');
  } catch {
    return false;
  }
};

/** A remote location written in a marketplace, reduced to something safe to show: no user, password, query or hash. */
const describeRemote = (text: string): string => {
  try {
    const url = new URL(text);
    return plain(`${url.protocol}//${url.host}${url.pathname}`, 120);
  } catch {
    // Not a URL: a bare `owner/repo`, or an scp-like `git@host:path`.
  }
  if (/^[\w.-]+\/[\w.-]+$/u.test(text)) return `github.com/${text}`;
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/u.exec(text);
  return scp?.[1] === undefined ? '(không nhận dạng được)' : plain(`${scp[1]}/${scp[2] ?? ''}`, 120);
};

type Source =
  | Readonly<{ kind: 'local'; path: string }>
  | Readonly<{ kind: 'remote'; where: string }>
  | Readonly<{ kind: 'unsafe' | 'invalid' }>;

const UNSAFE_TEXT = /(?:^|[\\/])\.\.(?:[\\/]|$)|^[\\/]|^[A-Za-z]:/u;

/** `source` of a marketplace entry: `./folder`, `{ source: 'local', path }`, or a location in another repository. */
const classifySource = (source: unknown): Source => {
  if (typeof source === 'string') {
    const text = source.trim();
    if (text === '.' || text.startsWith('./')) {
      const path = cleanRelative(text);
      return path === undefined ? { kind: 'unsafe' } : { kind: 'local', path };
    }
    return UNSAFE_TEXT.test(text) ? { kind: 'unsafe' } : { kind: 'remote', where: describeRemote(text) };
  }
  if (!isRecord(source)) return { kind: 'invalid' };
  const kind = (stringField(source, 'source') ?? '').toLowerCase();
  if (kind === 'local') {
    const path = stringField(source, 'path');
    const cleaned = path === undefined ? undefined : cleanRelative(path);
    return path === undefined
      ? { kind: 'invalid' }
      : cleaned === undefined
        ? { kind: 'unsafe' }
        : { kind: 'local', path: cleaned };
  }
  if (kind === 'github') {
    const repo = stringField(source, 'repo') ?? '';
    return { kind: 'remote', where: /^[\w.-]+\/[\w.-]+$/u.test(repo) ? `github.com/${repo}` : '(repo không hợp lệ)' };
  }
  if (kind === 'npm') return { kind: 'remote', where: `npm:${plain(stringField(source, 'package') ?? '', 60)}` };
  const url = stringField(source, 'url');
  const subfolder = stringField(source, 'path');
  const where = url === undefined ? `(${plain(kind, 20) || 'không rõ'})` : describeRemote(url);
  return { kind: 'remote', where: subfolder === undefined ? where : plain(`${where} (${subfolder})`, 160) };
};

const readMarketplace = (
  context: Context,
  drafts: Map<string, Draft>,
  file: string,
  marker: Marker,
  base: string
): void => {
  const loaded = loadJson(context, file);
  if (loaded.state !== 'ok') return;
  const entries = isRecord(loaded.value) ? field(loaded.value, 'plugins') : undefined;
  if (!Array.isArray(entries)) {
    report(context, 'unrecognized', 'marketplace.json không có danh sách "plugins"', { path: file });
    return;
  }
  if (entries.length > MAX_MARKETPLACE_ENTRIES) {
    report(context, 'unrecognized', `marketplace.json có hơn ${MAX_MARKETPLACE_ENTRIES} plugin, phần thừa bị bỏ`, {
      path: file,
    });
  }
  for (const entry of (entries as readonly unknown[]).slice(0, MAX_MARKETPLACE_ENTRIES)) {
    if (!isRecord(entry)) {
      report(context, 'unrecognized', 'Một mục trong marketplace.json không phải đối tượng', { path: file });
      continue;
    }
    const name = plain(stringField(entry, 'name') ?? '', 64) || 'plugin';
    const source = classifySource(field(entry, 'source'));
    if (source.kind === 'remote') {
      report(context, 'unrecognized', `Plugin "${name}" nằm ở repo khác (${source.where}); không tự tải`, {
        path: file,
      });
      continue;
    }
    if (source.kind !== 'local') {
      report(
        context,
        'unrecognized',
        source.kind === 'unsafe'
          ? `Plugin "${name}": đường dẫn nguồn không an toàn (tuyệt đối, có "..", hoặc ký tự lạ); bị từ chối`
          : `Plugin "${name}": nguồn không nhận ra được`,
        { path: file }
      );
      continue;
    }
    const folder = joinPath(base, source.path);
    if (!folderExists(context, folder)) {
      report(context, 'unrecognized', `Plugin "${name}": thư mục nguồn không có trong repo`, { path: file });
      continue;
    }
    const draft = draftFor(drafts, folder);
    draft.files.push(file);
    draft.manifests.push(entry);
    if (draft.market === undefined || MARKET_ORDER.indexOf(marker.origin) < MARKET_ORDER.indexOf(draft.market)) {
      draft.market = marker.origin;
    }
  }
};

const originOf = (draft: Draft): Origin | undefined => {
  if (draft.claude) return 'claude-plugin';
  if (draft.codex) return 'codex-plugin';
  if (draft.agentPlugins) return 'agent-plugins';
  return draft.copilot ? 'copilot' : draft.market;
};

/** Manifest files whose own folder tells where the plugin is, with the flag they set on the draft. */
const MANIFESTS: readonly Readonly<{ suffix: string; flag: 'claude' | 'codex' | 'copilot' }>[] = [
  { suffix: '.claude-plugin/plugin.json', flag: 'claude' },
  { suffix: '.codex-plugin/plugin.json', flag: 'codex' },
  { suffix: '.github/plugin/plugin.json', flag: 'copilot' },
];

/** Every plugin folder of the repository, ordered by path, each with its single best-ranked origin. */
export const discoverRoots = (context: Context): PluginRoot[] => {
  const drafts = new Map<string, Draft>();
  const files = context.inventory.files;

  for (const file of files) {
    for (const marker of MARKETPLACES) {
      const base = baseOf(file, marker.suffix);
      if (base !== undefined) readMarketplace(context, drafts, file, marker, base);
    }
    for (const manifest of MANIFESTS) {
      const base = baseOf(file, manifest.suffix);
      if (base === undefined) continue;
      const loaded = loadJson(context, file);
      if (loaded.state !== 'ok') continue;
      if (!isRecord(loaded.value)) {
        report(context, 'unrecognized', 'plugin.json không phải một đối tượng', { path: file });
        continue;
      }
      const draft = draftFor(drafts, base);
      draft[manifest.flag] = true;
      draft.files.push(file);
      draft.manifests.push(loaded.value);
    }
  }

  // A plain `plugin.json` only counts when it belongs to a folder found above or declares an agent-plugins.org schema.
  for (const file of files) {
    if (file.toLowerCase().split('/').at(-1) !== 'plugin.json') continue;
    if (MANIFESTS.some((manifest) => baseOf(file, manifest.suffix) !== undefined)) continue;
    const folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    const loaded = loadJson(context, file);
    if (loaded.state !== 'ok') continue;
    const known = drafts.get(folder);
    if (!isRecord(loaded.value)) {
      report(context, 'unrecognized', 'plugin.json không phải một đối tượng', { path: file });
    } else if (known !== undefined || isAgentPluginsSchema(loaded.value)) {
      const draft = known ?? draftFor(drafts, folder);
      draft.agentPlugins ||= isAgentPluginsSchema(loaded.value);
      draft.files.push(file);
      draft.manifests.push(loaded.value);
    } else {
      report(
        context,
        'unrecognized',
        'plugin.json không có $schema của agent-plugins.org và không thuộc plugin nào; bỏ qua',
        {
          path: file,
        }
      );
    }
  }

  const roots: PluginRoot[] = [];
  for (const [path, draft] of [...drafts.entries()].toSorted(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  )) {
    const origin = originOf(draft);
    if (origin !== undefined)
      roots.push({ path, origin, manifests: draft.manifests, manifestFile: draft.files[0] ?? path });
  }
  return roots;
};

/** Values of `key` across all manifests of a root, one list level flattened. */
export const manifestValues = (root: PluginRoot, key: string): unknown[] =>
  root.manifests.flatMap((manifest) =>
    listField(manifest, key).flatMap((value) => (Array.isArray(value) ? (value as unknown[]) : [value]))
  );
