/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * MCP servers declared by a plugin (`.mcp.json`, `mcp.json`, `mcp_config.json`, or the manifest key `mcpServers`).
 * A literal header or environment value found in a repository is never copied: a header keeps only the name of the
 * variable that will hold its value, and a variable named in the repository becomes an `env-value` open item.
 */

import { ADAPTER_MCP_COMMANDS } from '@/common/packages/adapter';
import { COMMAND_TOKEN, ENV_KEY } from '@/common/packages/adapter/primitives';
import {
  addConnection,
  cleanRelative,
  field,
  isRecord,
  joinPath,
  plain,
  report,
  stringField,
  titleOf,
  toId,
  type Context,
  type JsonRecord,
  type RootScope,
} from './support';

const MAX_SERVERS = 64;
const MAX_HEADERS = 20;
const MAX_ENV = 20;
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]*$/u;
const ROOT_VARIABLE = /^\$\{(?:CLAUDE|TOMNY)_PLUGIN_ROOT\}(?:\/(.*))?$/u;
const REFERENCE = /\$\{(?:user_config\.)?([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}|\$([A-Za-z_][A-Za-z0-9_]*)/gu;
const BUILT_IN_VARIABLE = /^(?:CLAUDE|TOMNY)_(?:PLUGIN|PROJECT)_/u;
const SECRET_PARAMETER = /key|token|secret|auth|pass|sig|credential|session|bearer/iu;
const HTTP_TYPES: ReadonlySet<string> = new Set(['http', 'streamable-http', 'streamable_http', 'streamablehttp']);
const STDIO_TYPES: ReadonlySet<string> = new Set(['stdio', 'local']);

/** Names of the variables a value refers to (`${NAME}`, `$NAME`, `${user_config.key}`), upper-cased, in order. */
const referencesIn = (value: string): string[] =>
  [...value.matchAll(REFERENCE)]
    .map((match) => (match[1] ?? match[2] ?? '').toUpperCase())
    .filter((name) => name !== '' && !BUILT_IN_VARIABLE.test(name));

/** True when `value` holds text besides its variable references (a prefix such as `Bearer `). */
const hasTextBesidesReferences = (value: string): boolean => value.replace(REFERENCE, '').trim() !== '';

/** A variable name for a header whose value was written into the repository: `<SERVER>_<HEADER>`. */
const inferredVariable = (serverId: string, header: string): string | undefined => {
  const raw = `${serverId}_${header}`.toUpperCase().replace(/[^A-Z0-9]+/gu, '_');
  const trimmed = raw.replace(/^_+|_+$/gu, '');
  const name = (/^[A-Z]/u.test(trimmed) ? trimmed : `MCP_${trimmed}`).slice(0, 64);
  return ENV_KEY.test(name) ? name : undefined;
};

type UrlVerdict = 'ok' | 'not-https' | 'invalid' | 'credentials';

/** Remote endpoint check. The URL is copied only when it is https and carries no credential-like part. */
const checkUrl = (raw: string): UrlVerdict => {
  if (raw.length > 500 || raw.includes('$')) return 'invalid';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'invalid';
  }
  if (url.protocol !== 'https:') return 'not-https';
  if (url.username !== '' || url.password !== '') return 'credentials';
  for (const name of url.searchParams.keys()) if (SECRET_PARAMETER.test(name)) return 'credentials';
  return 'ok';
};

const URL_NOTES: Readonly<Record<Exclude<UrlVerdict, 'ok'>, string>> = {
  'not-https': 'địa chỉ không phải https',
  invalid: 'địa chỉ không hợp lệ hoặc còn biến chưa thay',
  credentials: 'địa chỉ chứa thông tin đăng nhập hoặc tham số có thể là bí mật; không sao chép',
};

type Header = Readonly<{ name: string; fromEnv: string }>;

const convertHeaders = (
  context: Context,
  raw: unknown,
  id: string,
  where: string
): { headers: Header[]; ok: boolean } => {
  const headers: Header[] = [];
  if (raw === undefined) return { headers, ok: true };
  if (!isRecord(raw)) {
    report(context, 'unrecognized', `MCP "${id}": headers phải là một đối tượng`, { path: where, connection: id });
    return { headers, ok: false };
  }
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(raw).slice(0, MAX_HEADERS)) {
    if (!HEADER_NAME.test(name) || seen.has(name.toLowerCase())) {
      report(context, 'unrecognized', `MCP "${id}": một header có tên không hợp lệ hoặc trùng đã bị bỏ`, {
        path: where,
        connection: id,
      });
      continue;
    }
    seen.add(name.toLowerCase());
    const references = typeof value === 'string' ? [...new Set(referencesIn(value))] : [];
    const [only] = references;
    const text = typeof value === 'string' ? value : '';
    if (references.length === 1 && only !== undefined && ENV_KEY.test(only)) {
      headers.push({ name, fromEnv: only });
      report(
        context,
        'env-value',
        hasTextBesidesReferences(text)
          ? `MCP "${id}": header ${name} đọc từ biến này; repo có thêm chữ quanh biến, hãy điền giá trị đầy đủ của header`
          : `MCP "${id}": header ${name} đọc giá trị từ biến này`,
        { path: where, connection: id, name: only, required: true }
      );
      continue;
    }
    const inferred = inferredVariable(id, name);
    if (inferred === undefined) {
      report(
        context,
        'unrecognized',
        `MCP "${id}": giá trị header ${name} không được sao chép và không đặt được tên biến`,
        {
          path: where,
          connection: id,
        }
      );
      continue;
    }
    headers.push({ name, fromEnv: inferred });
    report(
      context,
      'env-value',
      `MCP "${id}": header ${name} có giá trị viết thẳng trong repo; giá trị không được sao chép, hãy điền vào biến này`,
      { path: where, connection: id, name: inferred, required: true }
    );
  }
  if (Object.keys(raw).length > MAX_HEADERS) {
    report(context, 'unrecognized', `MCP "${id}": quá ${MAX_HEADERS} header, phần thừa bị bỏ`, {
      path: where,
      connection: id,
    });
  }
  return { headers, ok: true };
};

/** `url`, and the aliases other hosts use (`serverUrl`, `httpUrl`). */
const urlOf = (server: JsonRecord): string | undefined =>
  stringField(server, 'url') ?? stringField(server, 'serverUrl') ?? stringField(server, 'httpUrl');

const transportOf = (server: JsonRecord): 'http' | 'sse' | 'stdio' | undefined => {
  const declared = (stringField(server, 'type') ?? stringField(server, 'transport'))?.trim().toLowerCase();
  if (declared !== undefined) {
    if (HTTP_TYPES.has(declared)) return 'http';
    if (declared === 'sse') return 'sse';
    return STDIO_TYPES.has(declared) ? 'stdio' : undefined;
  }
  if (urlOf(server) !== undefined) return 'http';
  return stringField(server, 'command') === undefined ? undefined : 'stdio';
};

const convertRemote = (
  context: Context,
  scope: RootScope,
  server: JsonRecord,
  transport: 'http' | 'sse',
  name: string,
  id: string,
  where: string
): void => {
  const url = urlOf(server)?.trim();
  const verdict = url === undefined ? 'invalid' : checkUrl(url);
  if (url === undefined || verdict !== 'ok') {
    report(context, 'unrecognized', `MCP "${id}": ${URL_NOTES[verdict === 'ok' ? 'invalid' : verdict]}`, {
      path: where,
      connection: id,
    });
    return;
  }
  const { headers, ok } = convertHeaders(context, field(server, 'headers'), id, where);
  if (!ok) return;
  addConnection(
    context,
    {
      kind: 'mcp',
      transport,
      id,
      title: titleOf(name, id),
      url,
      ...(headers.length > 0 ? { headers } : {}),
      plugin: scope.plugin,
      origin: scope.origin,
    },
    where
  );
};

type LocalArguments = Readonly<{ args: string[]; fromSource: boolean; firstFile: string | undefined }> | undefined;

/** Arguments of a stdio server. `${CLAUDE_PLUGIN_ROOT}/x` becomes the relative path `x`, run from the plugin folder. */
const convertArguments = (raw: unknown): LocalArguments => {
  if (raw === undefined) return { args: [], fromSource: false, firstFile: undefined };
  if (!Array.isArray(raw)) return undefined;
  const args: string[] = [];
  let firstFile: string | undefined;
  for (const item of raw as readonly unknown[]) {
    if (typeof item !== 'string') return undefined;
    const match = ROOT_VARIABLE.exec(item);
    if (match === null) {
      args.push(item);
      continue;
    }
    const relative = match[1] === undefined ? undefined : cleanRelative(match[1]);
    if (relative === undefined || relative === '') return undefined;
    args.push(relative);
    firstFile ??= relative;
  }
  return { args, fromSource: firstFile !== undefined, firstFile };
};

const convertEnvironment = (
  context: Context,
  raw: unknown,
  id: string,
  where: string
): { name: string; required: boolean }[] => {
  const variables: { name: string; required: boolean }[] = [];
  if (!isRecord(raw)) return variables;
  let skipped = 0;
  for (const [name, value] of Object.entries(raw)) {
    if (!ENV_KEY.test(name) || name.length > 64 || variables.length >= MAX_ENV) {
      skipped += 1;
      continue;
    }
    variables.push({
      name,
      required: typeof value === 'string' && (value.trim() === '' || referencesIn(value).length > 0),
    });
  }
  if (skipped > 0) {
    report(
      context,
      'unrecognized',
      `MCP "${id}": ${skipped} biến môi trường có tên không hợp lệ hoặc quá nhiều đã bị bỏ`,
      {
        path: where,
        connection: id,
      }
    );
  }
  return variables;
};

const convertLocal = (
  context: Context,
  scope: RootScope,
  server: JsonRecord,
  name: string,
  id: string,
  where: string
): void => {
  const command = stringField(server, 'command')?.trim() ?? '';
  if (!(ADAPTER_MCP_COMMANDS as readonly string[]).includes(command)) {
    const label = COMMAND_TOKEN.test(command) && command.length <= 40 ? ` "${command}"` : '';
    report(
      context,
      'unrecognized',
      `MCP "${id}": lệnh${label} không thuộc danh sách cho phép (${ADAPTER_MCP_COMMANDS.join(', ')})`,
      { path: where, connection: id }
    );
    return;
  }
  const parsed = convertArguments(field(server, 'args'));
  if (parsed === undefined) {
    report(context, 'unrecognized', `MCP "${id}": đối số không hợp lệ`, { path: where, connection: id });
    return;
  }
  const hasPackage = context.files.has(joinPath(scope.root, 'package.json'));
  const setupProgram = command === 'bun' ? 'bun' : 'npm';
  const env = convertEnvironment(context, field(server, 'env'), id, where);
  const connection = addConnection(
    context,
    {
      kind: 'mcp',
      id,
      title: titleOf(name, id),
      command,
      args: parsed.args,
      ...(parsed.fromSource ? { cwd: scope.plugin } : {}),
      ...(parsed.fromSource && hasPackage && (command === 'node' || command === 'bun')
        ? { setup: [[setupProgram, 'install']] }
        : {}),
      ...(env.length > 0 ? { env } : {}),
      plugin: scope.plugin,
      origin: scope.origin,
    },
    where
  );
  if (
    connection !== undefined &&
    parsed.firstFile !== undefined &&
    !context.files.has(joinPath(scope.root, parsed.firstFile))
  ) {
    report(
      context,
      'needs-runtime',
      `MCP "${id}" chạy từ mã nguồn của plugin nhưng tệp ${plain(parsed.firstFile, 100)} chưa có: cần build hoặc cài đặt trước`,
      { path: where, connection: id }
    );
  }
};

/** The `[name, server]` pairs of an MCP document: `{ mcpServers }`, `{ servers }`, or a bare map of servers. */
const serversOf = (document: unknown): readonly (readonly [string, unknown])[] => {
  if (!isRecord(document)) return [];
  for (const key of ['mcpServers', 'servers']) {
    const wrapped = field(document, key);
    if (isRecord(wrapped)) return Object.entries(wrapped);
  }
  const entries = Object.entries(document);
  const looksLikeServer = (value: unknown): boolean =>
    isRecord(value) &&
    ['command', 'url', 'type', 'serverUrl', 'httpUrl'].some((key) => field(value, key) !== undefined);
  return entries.length > 0 && entries.every(([, value]) => looksLikeServer(value)) ? entries : [];
};

/** Turns one MCP document (a parsed file or an inline manifest value) into connections and open items. */
export const readMcpDocument = (context: Context, scope: RootScope, document: unknown, where: string): void => {
  if (!isRecord(document)) {
    report(context, 'unrecognized', 'Khai báo MCP không phải một đối tượng', { path: where });
    return;
  }
  const servers = serversOf(document);
  if (servers.length === 0) {
    report(context, 'unrecognized', 'Khai báo MCP không có server nào nhận ra được', { path: where });
    return;
  }
  if (servers.length > MAX_SERVERS) {
    report(context, 'unrecognized', `Khai báo MCP có hơn ${MAX_SERVERS} server, phần thừa bị bỏ`, { path: where });
  }
  for (const [name, raw] of servers.slice(0, MAX_SERVERS)) {
    const base = toId(name);
    if (base === '' || !isRecord(raw)) {
      report(context, 'unrecognized', 'Một server MCP có tên hoặc nội dung không hợp lệ', { path: where });
      continue;
    }
    const transport = transportOf(raw);
    if (transport === undefined) {
      report(context, 'unrecognized', `MCP "${base}": kiểu kết nối không nhận ra được`, {
        path: where,
        connection: base,
      });
      continue;
    }
    if (scope.used.mcp.has(base)) {
      context.reasons.push(`MCP "${base}" được khai báo lặp trong plugin ${scope.plugin}; giữ khai báo đầu tiên`);
      continue;
    }
    scope.used.mcp.add(base);
    if (transport === 'stdio') convertLocal(context, scope, raw, name, base, where);
    else convertRemote(context, scope, raw, transport, name, base, where);
  }
};
