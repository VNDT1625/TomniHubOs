/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reads the components of one plugin folder by the standard plugin layout, plus any path its manifest names:
 * `skills/` -> skill, `commands/` -> command, `agents/` -> agent, `hooks/hooks.json` -> hook, `.mcp.json` -> mcp,
 * `bin/` -> cli. Components Tomny has no runtime for (`lspServers`, `monitors`, `outputStyles`, `themes`,
 * `workflows`) become `needs-runtime` open items. Nothing is executed or read beyond the inventory.
 */

import { ENV_KEY } from '@/common/packages/adapter/primitives';
import { readHooksDocument } from './hooks';
import { claudeManifestHookFiles, hookFileFormat, otherHookFileNote } from './hookFormat';
import { readMcpDocument } from './mcp';
import { manifestValues, type PluginRoot } from './roots';
import {
  addConnection,
  cleanRelative,
  clip,
  field,
  filesUnder,
  folderExists,
  frontmatterOf,
  isRecord,
  joinPath,
  loadJson,
  packagePathOf,
  plain,
  report,
  titleOf,
  toId,
  uniqueId,
  type Context,
  type RootScope,
} from './support';

const MAX_PER_KIND = 100;
const MCP_FILES = ['.mcp.json', 'mcp.json', 'mcp_config.json'] as const;

/**
 * Folders and files a manifest key names, joined to the plugin folder and added to the defaults. A value that is not
 * a safe relative path inside the plugin, or is not a string, is reported and skipped.
 */
const referencedPaths = (
  context: Context,
  root: PluginRoot,
  key: string,
  defaults: readonly string[],
  allowRoot = false
): string[] => {
  const result: string[] = [];
  const candidates: readonly unknown[] = [...defaults, ...manifestValues(root, key)];
  for (const raw of candidates) {
    const relative = typeof raw === 'string' ? cleanRelative(raw) : undefined;
    if (relative === undefined || (relative === '' && !allowRoot)) {
      report(
        context,
        'unrecognized',
        typeof raw === 'string'
          ? `Khoá "${key}" của plugin có đường dẫn không an toàn hoặc không hợp lệ; bị từ chối`
          : `Khoá "${key}" của plugin dùng dạng khai báo chưa được hỗ trợ`,
        { path: root.manifestFile }
      );
      continue;
    }
    const full = joinPath(root.path, relative);
    if (!result.includes(full)) result.push(full);
  }
  return result;
};

const SKILL_FILE = /^([^/]+)\/skill\.md$/iu;

/** Skill folders under `base`: `base` itself when it holds `SKILL.md`, otherwise each child folder that does. */
const skillFolders = (context: Context, base: string): Map<string, string> => {
  const found = new Map<string, string>();
  for (const file of filesUnder(context, base)) {
    const rest = base === '' ? file : file.slice(base.length + 1);
    if (rest.toLowerCase() === 'skill.md') {
      found.clear();
      found.set(base, file);
      return found;
    }
    const child = SKILL_FILE.exec(rest)?.[1];
    if (child !== undefined) found.set(joinPath(base, child), file);
  }
  return found;
};

const readSkills = (context: Context, root: PluginRoot, scope: RootScope): void => {
  let count = 0;
  for (const base of referencedPaths(context, root, 'skills', ['skills'], true)) {
    for (const [folder, file] of [...skillFolders(context, base)].toSorted(([left], [right]) =>
      left < right ? -1 : 1
    )) {
      if (context.skills.has(folder)) continue;
      if (count >= MAX_PER_KIND) {
        report(context, 'unrecognized', `Plugin có hơn ${MAX_PER_KIND} skill, phần thừa bị bỏ`, { path: base });
        return;
      }
      context.skills.add(folder);
      context.claimed.add(file);
      count += 1;
      addConnection(
        context,
        { kind: 'skill', path: packagePathOf(folder), plugin: scope.plugin, origin: scope.origin },
        file
      );
    }
  }
};

type Markdown = Readonly<{ file: string; relative: string }>;

const markdownIn = (context: Context, base: string): Markdown[] => {
  if (context.files.has(base) && /\.md$/iu.test(base))
    return [{ file: base, relative: base.split('/').at(-1) ?? base }];
  return filesUnder(context, base)
    .filter((file) => /\.md$/iu.test(file))
    .map((file) => ({ file, relative: file.slice(base.length + 1) }));
};

const idFromRelative = (relative: string): string =>
  toId(
    relative
      .replace(/\.agent\.md$/iu, '')
      .replace(/\.md$/iu, '')
      .replaceAll('/', '-')
  );

const readCommands = (context: Context, root: PluginRoot, scope: RootScope): void => {
  const seen = new Set<string>();
  for (const base of referencedPaths(context, root, 'commands', ['commands'])) {
    for (const { file, relative } of markdownIn(context, base)) {
      if (seen.has(file)) continue;
      seen.add(file);
      const baseId = idFromRelative(relative);
      if (baseId === '' || seen.size > MAX_PER_KIND) {
        report(context, 'unrecognized', 'Một lệnh có tên không hợp lệ hoặc vượt giới hạn; bị bỏ', { path: file });
        continue;
      }
      const id = uniqueId(scope.used.command, baseId);
      const meta = frontmatterOf(context.inventory.text(file));
      context.claimed.add(file);
      const description = meta.get('description');
      const hint = meta.get('argument-hint');
      addConnection(
        context,
        {
          kind: 'command',
          id,
          title: titleOf(meta.get('name') ?? id, id),
          ...(description === undefined ? {} : { description: clip(description, 1000) }),
          path: packagePathOf(file),
          format: 'markdown',
          ...(hint === undefined ? {} : { argumentHint: clip(hint, 200) }),
          plugin: scope.plugin,
          origin: scope.origin,
        },
        file
      );
    }
  }
};

const toolsOf = (value: string | undefined): string[] | undefined => {
  if (value === undefined) return undefined;
  const tools = value
    .replace(/^\[|\]$/gu, '')
    .split(',')
    .map((tool) => tool.trim().replace(/^(["'])(.*)\1$/u, '$2'))
    .filter((tool) => tool !== '' && tool.length <= 64)
    .slice(0, 50);
  return tools.length > 0 ? tools : undefined;
};

const readAgents = (context: Context, root: PluginRoot, scope: RootScope): void => {
  const seen = new Set<string>();
  for (const base of referencedPaths(context, root, 'agents', ['agents'])) {
    for (const { file, relative } of markdownIn(context, base)) {
      if (seen.has(file)) continue;
      seen.add(file);
      const baseId = idFromRelative(relative);
      if (baseId === '' || seen.size > MAX_PER_KIND) {
        report(context, 'unrecognized', 'Một agent có tên không hợp lệ hoặc vượt giới hạn; bị bỏ', { path: file });
        continue;
      }
      const id = uniqueId(scope.used.agent, baseId);
      const meta = frontmatterOf(context.inventory.text(file));
      context.claimed.add(file);
      const description = meta.get('description');
      const tools = toolsOf(meta.get('tools'));
      const model = meta.get('model');
      addConnection(
        context,
        {
          kind: 'agent',
          id,
          title: titleOf(meta.get('name') ?? id, id),
          ...(description === undefined ? {} : { description: clip(description, 1000) }),
          path: packagePathOf(file),
          format: /\.agent\.md$/iu.test(file) ? 'copilot-agent' : 'claude-md',
          ...(tools === undefined ? {} : { tools }),
          ...(model === undefined || model.length > 64 ? {} : { model }),
          plugin: scope.plugin,
          origin: scope.origin,
        },
        file
      );
    }
  }
};

/** Reads declaration files named by a manifest key or found by default, then inline values of the key. */
const readDeclarations = (
  context: Context,
  root: PluginRoot,
  key: string,
  defaults: readonly string[],
  read: (document: unknown, where: string) => void
): void => {
  const done = new Set<string>();
  const readFile = (file: string): void => {
    if (done.has(file)) return;
    done.add(file);
    const loaded = loadJson(context, file);
    if (loaded.state === 'ok') read(loaded.value, file);
    else if (loaded.state === 'missing') {
      report(context, 'unrecognized', `Khoá "${key}" của plugin trỏ tới một tệp không có trong repo`, { path: file });
    }
  };
  for (const name of defaults) {
    const file = joinPath(root.path, name);
    if (context.files.has(file)) readFile(file);
  }
  for (const value of manifestValues(root, key)) {
    if (typeof value === 'string') {
      const relative = cleanRelative(value);
      if (relative === undefined || relative === '') {
        report(context, 'unrecognized', `Khoá "${key}" của plugin có đường dẫn không an toàn; bị từ chối`, {
          path: root.manifestFile,
        });
      } else readFile(joinPath(root.path, relative));
    } else if (isRecord(value)) read(value, root.manifestFile);
    else
      report(context, 'unrecognized', `Khoá "${key}" của plugin dùng dạng khai báo chưa được hỗ trợ`, {
        path: root.manifestFile,
      });
  }
};

/** The program that runs a script file of a plugin's `bin` folder, by its extension. Other files need a runtime. */
const scriptProgramOf = (name: string): string | undefined => {
  const lower = name.toLowerCase();
  if (/\.(?:mjs|cjs|js)$/u.test(lower)) return 'node';
  if (lower.endsWith('.py')) return 'python';
  return undefined;
};

/**
 * A plugin's `bin` files. A script runs as `node` or `python` with its path inside the plugin folder as the only
 * argument, from the plugin folder (never a bare name looked up on PATH, which the file is not on).
 */
const readBin = (context: Context, root: PluginRoot, scope: RootScope): void => {
  const folder = joinPath(root.path, 'bin');
  const prefix = `${folder}/`;
  const names = filesUnder(context, folder)
    .map((file) => file.slice(prefix.length))
    .filter((name) => !name.includes('/'))
    .slice(0, MAX_PER_KIND);
  for (const name of names) {
    const baseId = toId(name);
    if (baseId === '') continue;
    const program = scriptProgramOf(name);
    const cwd = packagePathOf(root.path);
    if (program === undefined || cwd === undefined) {
      report(
        context,
        'needs-runtime',
        `Lệnh bin ${plain(name, 60)} không phải script JavaScript hay Python; cần runtime để chạy`,
        {
          path: `${prefix}${name}`,
        }
      );
      continue;
    }
    addConnection(
      context,
      {
        kind: 'cli',
        id: uniqueId(scope.used.cli, baseId),
        title: titleOf(name, baseId),
        command: program,
        args: [`bin/${name}`],
        display: 'terminal',
        source: 'source',
        cwd,
        plugin: scope.plugin,
        origin: scope.origin,
      },
      `${prefix}${name}`
    );
  }
};

type RuntimeKind = Readonly<{ key: string; files: readonly string[]; folders: readonly string[] }>;

const RUNTIME_KINDS: readonly RuntimeKind[] = [
  { key: 'lspServers', files: ['.lsp.json'], folders: [] },
  { key: 'monitors', files: ['monitors/monitors.json'], folders: [] },
  { key: 'outputStyles', files: [], folders: ['output-styles'] },
  { key: 'themes', files: [], folders: ['themes'] },
  { key: 'workflows', files: [], folders: ['workflows'] },
];

/** One `needs-runtime` item per kind of component Tomny cannot run, naming the kind and where it was declared. */
const readRuntimeOnly = (context: Context, root: PluginRoot, scope: RootScope): void => {
  for (const kind of RUNTIME_KINDS) {
    const found =
      kind.files.map((name) => joinPath(root.path, name)).find((file) => context.files.has(file)) ??
      kind.folders.map((name) => joinPath(root.path, name)).find((folder) => folderExists(context, folder)) ??
      (manifestValues(root, kind.key).length > 0 ? root.manifestFile : undefined);
    if (found === undefined) continue;
    report(
      context,
      'needs-runtime',
      `Plugin ${scope.plugin} khai báo ${kind.key}; Tomny chưa có runtime cho loại này, phần đó được giữ trong source và không bật`,
      { path: found }
    );
  }
};

/** `userConfig` entries marked `sensitive` become variables the user fills; no default or value is read. */
const readUserConfig = (context: Context, root: PluginRoot, scope: RootScope): void => {
  const seen = new Set<string>();
  for (const manifest of root.manifests) {
    const config = field(manifest, 'userConfig');
    if (!isRecord(config)) continue;
    for (const [key, option] of Object.entries(config).slice(0, 20)) {
      if (!isRecord(option) || field(option, 'sensitive') !== true) continue;
      const raw = key
        .toUpperCase()
        .replace(/[^A-Z0-9]+/gu, '_')
        .replace(/^_+|_+$/gu, '');
      const name = (/^[A-Z]/u.test(raw) ? raw : `X_${raw}`).slice(0, 64);
      if (!ENV_KEY.test(name) || seen.has(name)) continue;
      seen.add(name);
      report(
        context,
        'env-value',
        `Plugin ${scope.plugin} cần giá trị nhạy cảm "${plain(key, 40)}" do người dùng điền`,
        {
          path: root.manifestFile,
          name,
          required: field(option, 'required') === true,
        }
      );
    }
  }
};

/** Reads every component of one plugin folder into the context. Returns the number of connections it added. */
export const readPlugin = (context: Context, root: PluginRoot): number => {
  const plugin = packagePathOf(root.path);
  if (plugin === undefined) {
    report(context, 'unrecognized', 'Đường dẫn plugin quá dài hoặc không hợp lệ; bị bỏ', { path: root.manifestFile });
    return 0;
  }
  const scope: RootScope = {
    root: root.path,
    plugin,
    origin: root.origin,
    used: { mcp: new Set(), command: new Set(), agent: new Set(), cli: new Set() },
    hookIndex: { next: 0 },
  };
  const before = context.connections.length;
  readSkills(context, root, scope);
  readCommands(context, root, scope);
  readAgents(context, root, scope);
  readDeclarations(context, root, 'hooks', ['hooks/hooks.json'], (document, where) => {
    const format = hookFileFormat(where, (path) => context.files.has(path), claudeManifestHookFiles(context.inventory));
    if (format.format === 'claude') readHooksDocument(context, scope, document, where);
    // A hooks.json is reported by the hooks detector; anything else named by a manifest is reported here.
    else if (!/(?:^|\/)hooks\.json$/iu.test(where)) {
      report(context, 'unrecognized', otherHookFileNote(format.host), { path: where });
    }
  });
  readDeclarations(context, root, 'mcpServers', MCP_FILES, (document, where) =>
    readMcpDocument(context, scope, document, where)
  );
  readBin(context, root, scope);
  readRuntimeOnly(context, root, scope);
  readUserConfig(context, root, scope);
  return context.connections.length - before;
};
