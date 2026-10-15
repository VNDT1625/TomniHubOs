/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Detector `mcp-config` (design section 7.3): MCP servers a repository declares in a configuration file
 * (`.mcp.json`, `mcp.json`, `mcp_config.json`, `.vscode/mcp.json`, `.cursor/mcp.json`) or in an MCPB/DXT bundle
 * manifest (`manifest.json` with a `server` block).
 *
 * Secrets: the files are untrusted and may hold real keys. No literal `env` value and no literal header value is ever
 * returned. A variable becomes an `env` entry (name, required, hint) plus an `env-value` open item, and a header
 * becomes `{ name, fromEnv }`. A URL that carries credentials (user info or a secret-looking query) is refused.
 * Nothing here is executed and nothing is read beyond the inventory.
 */

import { z } from 'zod';
import type { AdapterConnection, AdapterOpenItem } from '@/common/packages/adapter';
import { ENV_KEY } from '@/common/packages/adapter/primitives';
import { normalizeRepoPath } from '../inventory';
import type { Detector, DetectorResult, RepoInventory } from '../types';
import {
  baseName,
  dirName,
  envValueItem,
  findPlaceholders,
  firstUnsafeArgument,
  looksLikeCredential,
  looksSecret,
  normalizeProgram,
  parseLooseJson,
  quoteForNote,
  sourcePath,
  toConnectionId,
  toEnvName,
  unrecognizedItem,
  validateConnection,
} from './mcpShared';

export const MCP_CONFIG_DETECTOR_ID = 'mcp-config';
export const MCP_CONFIG_DETECTOR_VERSION = 1;

const CONFIG_NAMES: ReadonlySet<string> = new Set(['.mcp.json', 'mcp.json', 'mcp_config.json']);
const PLUGIN_MANIFESTS = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'plugin.json'] as const;
const MAX_SERVERS_PER_FILE = 64;
const MAX_ENV = 20;
const MAX_HEADERS = 20;
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]{0,63}$/u;
const BUILD_FOLDERS = /^(?:dist|build|out|lib)\//u;
const ROOT_VARIABLES: Readonly<Record<string, 'workspace' | 'file'>> = {
  workspacefolder: 'workspace',
  workspaceroot: 'workspace',
  claude_plugin_root: 'file',
  codex_plugin_root: 'file',
  plugin_root: 'file',
  __dirname: 'file',
  extensionpath: 'file',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** One server entry. Unknown keys are dropped (zod strips them); every known key is bounded. */
const serverSchema = z.object({
  type: z.string().max(40).optional(),
  command: z.string().min(1).max(300).optional(),
  args: z.array(z.string().max(500)).max(64).optional(),
  env: z.record(z.string().max(100), z.unknown()).optional(),
  url: z.string().max(2000).optional(),
  serverUrl: z.string().max(2000).optional(),
  headers: z.record(z.string().max(100), z.unknown()).optional(),
  disabled: z.boolean().optional(),
});

const userConfigSchema = z.record(
  z.string().max(100),
  z.object({
    title: z.string().max(200).optional(),
    description: z.string().max(1000).optional(),
    required: z.boolean().optional(),
  })
);

/** The `manifest.json` of an MCPB/DXT bundle. */
const bundleSchema = z.object({
  name: z.string().min(1).max(200),
  display_name: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  server: z.object({
    type: z.string().max(20),
    entry_point: z.string().max(300).optional(),
    mcp_config: z
      .object({
        command: z.string().max(300).optional(),
        args: z.array(z.string().max(500)).max(64).optional(),
        env: z.record(z.string().max(100), z.unknown()).optional(),
      })
      .optional(),
  }),
  user_config: userConfigSchema.optional(),
});

type Outcome = Readonly<{
  connection?: AdapterConnection;
  openItems: readonly AdapterOpenItem[];
}>;

type Context = Readonly<{
  /** Repository-relative path of the declaring file. */
  file: string;
  /** Folder relative paths in the file start from (the repository root for `.vscode/` and `.cursor/` files). */
  baseDir: string;
  /** `source/<dir>` of the plugin that owns the file, when it sits in a plugin folder. */
  plugin?: string;
  files: ReadonlySet<string>;
  origin: 'mcp-config' | 'mcpb';
  /** Looks up a variable that is not an environment variable (MCPB `user_config`). */
  lookup?: (name: string) => Readonly<{ hint?: string; required?: boolean }> | undefined;
}>;

const truncate = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text);

/** Resolves the arguments: turns `${workspaceFolder}/x` into `x` and refuses any other variable. */
const resolveArguments = (
  rawArgs: readonly string[],
  context: Context
): Readonly<{ args: readonly string[]; rootDir: string }> | Readonly<{ error: string }> => {
  let rootDir: string | undefined;
  const args: string[] = [];
  for (const arg of rawArgs) {
    const holders = findPlaceholders(arg);
    let value = arg;
    if (holders.length > 0) {
      const holder = holders[0];
      const kind = holder === undefined ? undefined : ROOT_VARIABLES[holder.name.toLowerCase()];
      if (holders.length !== 1 || holder === undefined || kind === undefined || !arg.startsWith(`${holder.raw}/`)) {
        const names = holders.map((item) => toEnvName(item.name) ?? '?').join(', ');
        return { error: `Tham số chứa biến cần giá trị lúc chạy (${names}); chưa hỗ trợ.` };
      }
      const root = kind === 'workspace' ? '' : context.baseDir;
      if (rootDir !== undefined && rootDir !== root) return { error: 'Tham số trỏ tới nhiều thư mục gốc khác nhau.' };
      rootDir = root;
      value = arg.slice(holder.raw.length + 1);
    }
    value = value.replace(/^(?:\.\/)+/u, '');
    if (value.split('/').includes('..')) return { error: 'Tham số trỏ ra ngoài thư mục repo.' };
    args.push(value);
  }
  return { args, rootDir: rootDir ?? context.baseDir };
};

/** Turns `env` into entries without values. Returns the entries and the variables the user must fill in. */
const buildEnvironment = (
  env: Readonly<Record<string, unknown>> | undefined,
  context: Context
): Readonly<{
  entries: readonly Readonly<{ name: string; required: boolean; hint?: string }>[];
  problems: readonly string[];
}> => {
  const entries: { name: string; required: boolean; hint?: string }[] = [];
  const problems: string[] = [];
  for (const [key, value] of Object.entries(env ?? {})) {
    if (!ENV_KEY.test(key) || key.length > 64) {
      problems.push(`Biến môi trường "${quoteForNote(key, 30)}" không hợp lệ nên bị bỏ qua.`);
      continue;
    }
    if (entries.length >= MAX_ENV) {
      problems.push(`Chỉ giữ ${MAX_ENV} biến môi trường đầu tiên.`);
      break;
    }
    const holders = typeof value === 'string' ? findPlaceholders(value) : [];
    const variable = holders.find((item) => !item.isPath);
    const known = variable === undefined ? undefined : context.lookup?.(variable.name);
    const envName = variable === undefined ? undefined : toEnvName(variable.name);
    const hint =
      known?.hint ?? (envName === undefined || envName === key ? undefined : `Giá trị lấy từ biến ${envName}.`);
    entries.push({
      name: key,
      required: known?.required ?? (variable !== undefined || looksSecret(key)),
      ...(hint === undefined || hint.trim() === '' ? {} : { hint: truncate(hint.trim(), 1000) }),
    });
  }
  return { entries, problems };
};

const stdioCandidate = (
  id: string,
  title: string,
  description: string | undefined,
  rawCommand: string,
  rawArgs: readonly string[],
  env: Readonly<Record<string, unknown>> | undefined,
  context: Context
): Outcome => {
  const openItems: AdapterOpenItem[] = [];
  const refuse = (note: string): Outcome => ({
    openItems: [unrecognizedItem(context.file, `Server "${id}": ${note}`)],
  });

  const resolved = resolveArguments(rawArgs, context);
  if ('error' in resolved) return refuse(resolved.error);
  const program = normalizeProgram(rawCommand, resolved.args);
  if (program === undefined) {
    return refuse(`lệnh "${quoteForNote(rawCommand, 40)}" không nằm trong danh sách được phép.`);
  }
  if (program.args.length === 0) return refuse('thiếu tham số khởi động.');
  const unsafe = firstUnsafeArgument(program.program, program.args);
  if (unsafe !== undefined) return refuse(`tham số "${quoteForNote(unsafe, 40)}" chưa được hỗ trợ.`);

  // A program started from a file in the repository runs from source/; a published one (npx, uvx) needs no folder.
  const runsLocalFile = program.program === 'node' || program.program === 'python' || program.program === 'bun';
  const script = runsLocalFile ? program.args[0] : undefined;
  if (script !== undefined) {
    const repoPath = normalizeRepoPath(resolved.rootDir === '' ? script : `${resolved.rootDir}/${script}`);
    if (repoPath !== undefined && BUILD_FOLDERS.test(script) && !context.files.has(repoPath)) {
      openItems.push({
        kind: 'needs-build',
        connection: id,
        path: sourcePath(repoPath),
        note: `Server cần ${quoteForNote(script, 80)}, chưa có trong repo: build rồi trỏ vào kết quả.`,
      });
    }
  }

  const environment = buildEnvironment(env, context);
  const candidate = {
    kind: 'mcp',
    id,
    title,
    ...(description === undefined ? {} : { description }),
    command: program.program,
    // `./start.mjs` and `start.mjs` name the same file; the plugin reader writes the second form, so both merge.
    args: script === undefined ? [...program.args] : [script.replace(/^\.\//u, ''), ...program.args.slice(1)],
    ...(runsLocalFile ? { cwd: sourcePath(resolved.rootDir) } : {}),
    ...(environment.entries.length > 0 ? { env: environment.entries.map((entry) => ({ ...entry })) } : {}),
    ...(context.plugin === undefined ? {} : { plugin: context.plugin }),
    origin: context.origin,
  };
  const checked = validateConnection(candidate, context.file);
  if ('problem' in checked) return { openItems: [checked.problem] };
  for (const entry of environment.entries) {
    if (entry.required) {
      openItems.push(envValueItem(id, entry.name, `Cần giá trị cho ${entry.name} (server ${id}).`));
    }
  }
  for (const problem of environment.problems)
    openItems.push(unrecognizedItem(context.file, `Server "${id}": ${problem}`));
  return { connection: checked.connection, openItems };
};

type UrlCheck = Readonly<{ url: string }> | Readonly<{ error: string }>;

/** Only `https://` addresses without credentials. The address is the only part of the URL that is copied. */
const checkUrl = (text: string): UrlCheck => {
  const trimmed = text.trim();
  if (findPlaceholders(trimmed).length > 0) return { error: 'địa chỉ chứa biến; chưa hỗ trợ.' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: 'địa chỉ không hợp lệ.' };
  }
  if (parsed.protocol !== 'https:') return { error: `chỉ nhận địa chỉ https (máy ${quoteForNote(parsed.host, 40)}).` };
  if (parsed.username !== '' || parsed.password !== '') return { error: 'địa chỉ chứa tên đăng nhập hoặc mật khẩu.' };
  for (const [name, value] of parsed.searchParams) {
    if (looksSecret(name) || looksLikeCredential(value)) {
      return { error: 'địa chỉ chứa thông tin xác thực trong chuỗi truy vấn; không được chép vào gói.' };
    }
  }
  if (trimmed.length > 500) return { error: 'địa chỉ quá dài.' };
  return { url: trimmed };
};

const remoteCandidate = (
  id: string,
  title: string,
  description: string | undefined,
  transport: 'http' | 'sse',
  rawUrl: string,
  headers: Readonly<Record<string, unknown>> | undefined,
  context: Context
): Outcome => {
  const refuse = (note: string): Outcome => ({
    openItems: [unrecognizedItem(context.file, `Server "${id}": ${note}`)],
  });
  const checked = checkUrl(rawUrl);
  if ('error' in checked) return refuse(checked.error);

  const openItems: AdapterOpenItem[] = [];
  const fromEnv = new Map<string, string>();
  const seenVariables = new Set<string>();
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!HEADER_NAME.test(name) || typeof value !== 'string') {
      openItems.push(unrecognizedItem(context.file, `Server "${id}": header "${quoteForNote(name, 30)}" bị bỏ qua.`));
      continue;
    }
    if (fromEnv.size >= MAX_HEADERS) break;
    // A variable in the value names the secret; a literal value is dropped and the variable is named after the header.
    const variable = findPlaceholders(value).find((item) => !item.isPath);
    const named = variable === undefined ? undefined : toEnvName(variable.name);
    const derived = toEnvName(`${toEnvName(id) ?? 'MCP'}_${name}`);
    const envName = named ?? derived;
    if (envName === undefined) continue;
    fromEnv.set(name, envName);
    if (!seenVariables.has(envName)) {
      seenVariables.add(envName);
      openItems.push(envValueItem(id, envName, `Cần giá trị cho header ${name} của server ${id}.`));
    }
  }

  const candidate = {
    kind: 'mcp',
    transport,
    id,
    title,
    ...(description === undefined ? {} : { description }),
    url: checked.url,
    ...(fromEnv.size > 0 ? { headers: [...fromEnv].map(([name, variable]) => ({ name, fromEnv: variable })) } : {}),
    ...(context.plugin === undefined ? {} : { plugin: context.plugin }),
    origin: context.origin,
  };
  const validated = validateConnection(candidate, context.file);
  if ('problem' in validated) return { openItems: [validated.problem] };
  return { connection: validated.connection, openItems };
};

const REMOTE_TYPES: Readonly<Record<string, 'http' | 'sse'>> = {
  http: 'http',
  'streamable-http': 'http',
  streamablehttp: 'http',
  streamable_http: 'http',
  sse: 'sse',
};

/** One entry of `mcpServers` / `servers`. */
const convertServer = (name: string, value: unknown, context: Context): Outcome => {
  const id = toConnectionId(name);
  if (id === undefined) return { openItems: [unrecognizedItem(context.file, 'Có server không có tên dùng được.')] };
  const parsed = serverSchema.safeParse(value);
  if (!parsed.success) return { openItems: [unrecognizedItem(context.file, `Server "${id}" khai báo sai cấu trúc.`)] };
  const server = parsed.data;
  if (server.disabled === true) return { openItems: [] };
  const title = truncate(name.trim(), 120) || id;
  const url = server.url ?? server.serverUrl;
  const remoteType = server.type === undefined ? undefined : REMOTE_TYPES[server.type.toLowerCase()];
  if (remoteType !== undefined || (url !== undefined && server.command === undefined)) {
    if (url === undefined) return { openItems: [unrecognizedItem(context.file, `Server "${id}" không có địa chỉ.`)] };
    return remoteCandidate(id, title, undefined, remoteType ?? 'http', url, server.headers, context);
  }
  if (server.command === undefined) {
    return { openItems: [unrecognizedItem(context.file, `Server "${id}" không có lệnh khởi động hay địa chỉ.`)] };
  }
  return stdioCandidate(id, title, undefined, server.command, server.args ?? [], server.env, context);
};

/** The map of servers inside a configuration document, in any of the layouts tools write. */
const serversOf = (document: unknown, name: string): Record<string, unknown> | undefined => {
  if (!isRecord(document)) return undefined;
  for (const key of ['mcpServers', 'servers']) {
    const section = document[key];
    if (isRecord(section)) return section;
  }
  // Claude plugins may list the servers at the top level, without a wrapper.
  const entries = Object.values(document);
  if (
    CONFIG_NAMES.has(name) &&
    entries.length > 0 &&
    entries.every((entry) => isRecord(entry) && (typeof entry.command === 'string' || typeof entry.url === 'string'))
  ) {
    return document;
  }
  return undefined;
};

const pluginFor = (dir: string, files: ReadonlySet<string>): string | undefined =>
  PLUGIN_MANIFESTS.some((manifest) => files.has(dir === '' ? manifest : `${dir}/${manifest}`))
    ? sourcePath(dir)
    : undefined;

/**
 * The folder a config's relative paths start from. A config inside a host's settings folder (`.vscode/`, `.cursor/`) or
 * inside a plugin manifest folder (`.codex-plugin/`, `.cursor-plugin/`, `.claude-plugin/`) is relative to the folder
 * above it: for a plugin, that is the plugin root, where `.` and `./start.mjs` point.
 */
const baseDirFor = (file: string): string => {
  const dir = dirName(file);
  const folder = baseName(dir);
  return folder === '.vscode' || folder === '.cursor' || /^\.[a-z0-9]+-plugin$/u.test(folder) ? dirName(dir) : dir;
};

type FileOutcome = Readonly<{
  connections: readonly AdapterConnection[];
  openItems: readonly AdapterOpenItem[];
  reasons: readonly string[];
}>;

export const readConfigFile = (file: string, text: string, files: ReadonlySet<string>): FileOutcome => {
  const document = parseLooseJson(text);
  if (document === undefined) {
    return {
      connections: [],
      openItems: [unrecognizedItem(file, 'Không đọc được tệp cấu hình MCP (JSON hỏng hoặc bị cắt).')],
      reasons: [],
    };
  }
  const servers = serversOf(document, baseName(file));
  if (servers === undefined) {
    return {
      connections: [],
      openItems: [unrecognizedItem(file, 'Tệp cấu hình MCP không có khóa mcpServers hoặc servers.')],
      reasons: [],
    };
  }
  const baseDir = baseDirFor(file);
  const plugin = pluginFor(dirName(file), files);
  const context: Context = {
    file,
    baseDir,
    files,
    origin: 'mcp-config',
    ...(plugin === undefined ? {} : { plugin }),
  };
  const connections: AdapterConnection[] = [];
  const openItems: AdapterOpenItem[] = [];
  const seen = new Set<string>();
  const names = Object.keys(servers);
  if (names.length > MAX_SERVERS_PER_FILE) {
    openItems.push(unrecognizedItem(file, `Chỉ đọc ${MAX_SERVERS_PER_FILE} server đầu tiên.`));
  }
  for (const name of names.slice(0, MAX_SERVERS_PER_FILE)) {
    const id = toConnectionId(name);
    if (id !== undefined && seen.has(id)) {
      openItems.push(unrecognizedItem(file, `Server "${id}" bị trùng tên sau khi chuẩn hóa nên bị bỏ qua.`));
      continue;
    }
    if (id !== undefined) seen.add(id);
    const outcome = convertServer(name, servers[name], context);
    if (outcome.connection !== undefined) connections.push(outcome.connection);
    openItems.push(...outcome.openItems);
  }
  return {
    connections,
    openItems,
    reasons: connections.length > 0 ? [`Found ${connections.length} MCP server(s) in ${file}`] : [],
  };
};

/** The block `manifest.json` needs to be an MCPB/DXT manifest rather than a browser extension or web manifest. */
const isBundleManifest = (document: unknown): document is Record<string, unknown> =>
  isRecord(document) &&
  isRecord(document.server) &&
  (typeof document.manifest_version === 'string' || typeof document.dxt_version === 'string');

const readBundle = (file: string, document: Record<string, unknown>, files: ReadonlySet<string>): FileOutcome => {
  const parsed = bundleSchema.safeParse(document);
  const nothing = (note: string): FileOutcome => ({
    connections: [],
    openItems: [unrecognizedItem(file, note)],
    reasons: [],
  });
  if (!parsed.success) return nothing('Manifest MCPB sai cấu trúc.');
  const bundle = parsed.data;
  const id = toConnectionId(bundle.name);
  if (id === undefined) return nothing('Manifest MCPB không có tên dùng được.');
  const userConfig = bundle.user_config ?? {};
  const baseDir = dirName(file);
  const context: Context = {
    file,
    baseDir,
    files,
    origin: 'mcpb',
    lookup: (name) => {
      const key = name.startsWith('user_config.') ? name.slice('user_config.'.length) : undefined;
      const entry = key === undefined ? undefined : userConfig[key];
      if (entry === undefined) return undefined;
      const hint = entry.title ?? entry.description;
      return { required: entry.required ?? false, ...(hint === undefined ? {} : { hint }) };
    },
  };
  const title = truncate((bundle.display_name ?? bundle.name).trim(), 120) || id;
  const description = bundle.description?.trim() === '' ? undefined : truncate(bundle.description?.trim() ?? '', 1000);
  const { server } = bundle;
  if (server.type === 'binary') {
    return {
      connections: [],
      openItems: [
        {
          kind: 'needs-runtime',
          connection: id,
          path: sourcePath(baseDir),
          note: 'Bundle MCPB dạng binary: chương trình dựng sẵn theo từng hệ điều hành, Hub chưa chạy được.',
        },
      ],
      reasons: [],
    };
  }
  const configured = server.mcp_config;
  const defaultCommand = server.type === 'python' ? 'python' : server.type === 'node' ? 'node' : undefined;
  const command = configured?.command ?? defaultCommand;
  const args = configured?.args ?? (server.entry_point === undefined ? [] : [`\${__dirname}/${server.entry_point}`]);
  if (command === undefined) return nothing(`Manifest MCPB loại "${quoteForNote(server.type, 20)}" chưa được hỗ trợ.`);
  const outcome = stdioCandidate(id, title, description, command, args, configured?.env, context);
  return {
    connections: outcome.connection === undefined ? [] : [outcome.connection],
    openItems: outcome.openItems,
    reasons: outcome.connection === undefined ? [] : [`Found MCPB bundle "${id}" in ${file}`],
  };
};

const detect = (inventory: RepoInventory): DetectorResult => {
  const files = new Set(inventory.files);
  const connections: AdapterConnection[] = [];
  const openItems: AdapterOpenItem[] = [];
  const reasons: string[] = [];
  const claimed: string[] = [];
  for (const file of inventory.files) {
    const name = baseName(file);
    const isConfig = CONFIG_NAMES.has(name);
    if (!isConfig && name !== 'manifest.json') continue;
    const text = inventory.text(file);
    if (text === undefined) continue;
    try {
      let outcome: FileOutcome | undefined;
      if (isConfig) {
        outcome = readConfigFile(file, text, files);
      } else {
        const document = parseLooseJson(text);
        if (isBundleManifest(document)) outcome = readBundle(file, document, files);
      }
      if (outcome === undefined) continue;
      claimed.push(file);
      connections.push(...outcome.connections);
      openItems.push(...outcome.openItems);
      reasons.push(...outcome.reasons);
    } catch {
      claimed.push(file);
      openItems.push(unrecognizedItem(file, 'Không phân tích được tệp khai báo MCP.'));
    }
  }
  return { connections, openItems, reasons, claimed };
};

export const mcpConfig: Detector = {
  id: MCP_CONFIG_DETECTOR_ID,
  version: MCP_CONFIG_DETECTOR_VERSION,
  detect,
};
