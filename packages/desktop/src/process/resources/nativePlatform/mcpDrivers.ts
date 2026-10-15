import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { IMcpServer, IMcpServerTransport } from '@/common/config/storage';
import { redactResolvedSecrets, resolveCatalogTransport } from '@process/resources/mcpRegistry/packageMcpLaunch';

export type McpTestResult = {
  success: boolean;
  tools?: Array<{ name: string; description?: string; input_schema?: unknown; _meta?: Record<string, unknown> }>;
  error?: string;
  needsAuth?: boolean;
  authMethod?: 'oauth' | 'basic';
  wwwAuthenticate?: string;
};

/** Stderr of a stdio server kept for a failed probe (characters). */
const STDERR_TAIL_CHARS = 2_048;
/** Server output appended to the error text shown to the person. */
const OUTPUT_IN_ERROR_CHARS = 600;
/** Longest error text a probe returns. */
const ERROR_TEXT_CHARS = 2_000;
/** Declared values shorter than this are not treated as secrets, so ordinary words are not blanked out. */
const MIN_DECLARED_SECRET_CHARS = 6;

/**
 * Variables a stdio server may inherit from Main. Anything else (tokens, API keys, cookies) is dropped. The list keeps
 * what npx and uvx need on Windows and behind a proxy or a private CA; `npm_config_*` is kept except credentials.
 */
const STDIO_INHERITED_ENV: ReadonlySet<string> = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERPROFILE',
  'USERNAME',
  'USER',
  'LOGNAME',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMDATA',
  'LANG',
  'LC_ALL',
  'TZ',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
  'UV_CACHE_DIR',
  'UV_PYTHON',
]);
const NPM_CONFIG_NAME = /^npm_config_/i;
const CREDENTIAL_NAME = /token|auth|password|passwd|secret|cookie|_key/i;

/**
 * The environment of a stdio server: the inherited allowlist from the parent, then the variables the server declares.
 * Declared values win. Credential-looking npm settings are never inherited.
 */
export const stdioServerEnv = (
  declared: Record<string, string> | undefined,
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> => {
  const inherited: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const allowed =
      STDIO_INHERITED_ENV.has(name.toUpperCase()) || (NPM_CONFIG_NAME.test(name) && !CREDENTIAL_NAME.test(name));
    if (allowed) inherited[name] = value;
  }
  return { ...inherited, ...declared };
};

/** Keeps only the last `limit` characters of what a child wrote to stderr. */
class TextTail {
  private text = '';
  constructor(private readonly limit: number) {}
  push(chunk: Buffer | string): void {
    this.text = (this.text + String(chunk)).slice(-this.limit);
  }
  get value(): string {
    return this.text;
  }
}

const REDACTED = '[redacted]';
const BEARER_VALUE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi;
const NAMED_VALUE =
  /((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|authorization|cookie)["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi;
const URL_USER_INFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;

/**
 * Removes secret values from text a probe is about to show or log: the values that were filled in, bearer tokens,
 * `token=`/`password=`-style pairs and user information in URLs.
 */
export const redactProbeText = (text: string, secrets: readonly string[]): string =>
  redactResolvedSecrets(text, secrets)
    .replace(BEARER_VALUE, `$1 ${REDACTED}`)
    .replace(NAMED_VALUE, `$1${REDACTED}`)
    .replace(URL_USER_INFO, `$1${REDACTED}@`);

/** Declared values that may be secrets: header or variable values of the server as the person wrote it. */
const declaredSecretValues = (transport: IMcpServerTransport): string[] =>
  Object.values(transport.type === 'stdio' ? (transport.env ?? {}) : (transport.headers ?? {})).filter(
    (value) => value.length >= MIN_DECLARED_SECRET_CHARS
  );

/** One line of child output: whitespace collapsed, last `limit` characters. */
const oneLine = (text: string, limit: number): string => text.replace(/\s+/g, ' ').trim().slice(-limit);

/** Where a server is launched, without any value of its environment or headers. */
const describeLaunch = (transport: IMcpServerTransport): string => {
  if (transport.type === 'stdio') {
    return `transport=stdio command=${transport.command} args=${JSON.stringify(transport.args ?? [])} cwd=${transport.cwd ?? '(inherited)'}`;
  }
  let origin = '(invalid url)';
  try {
    origin = new URL(transport.url).origin;
  } catch {
    // keep the placeholder: the URL is only shown for diagnosis
  }
  return `transport=${transport.type} origin=${origin}`;
};

const httpHeaders = (transport: Extract<IMcpServerTransport, { url: string }>): RequestInit => ({
  headers: transport.headers,
});

type ProbeTransport = Readonly<{ transport: Transport; stderr?: TextTail }>;

const createTransport = (transport: IMcpServerTransport): ProbeTransport => {
  if (transport.type === 'stdio') {
    const stderr = new TextTail(STDERR_TAIL_CHARS);
    const stdio = new StdioClientTransport({
      command: transport.command,
      args: transport.args ?? [],
      ...(transport.cwd ? { cwd: transport.cwd } : {}),
      env: stdioServerEnv(transport.env),
      stderr: 'pipe',
    });
    // A piped stream that nobody reads fills up and stalls the server, so the probe drains it and keeps the tail.
    stdio.stderr?.on('data', (chunk: Buffer | string) => stderr.push(chunk));
    return { transport: stdio, stderr };
  }
  const url = new URL(transport.url);
  if (transport.type === 'sse')
    return { transport: new SSEClientTransport(url, { requestInit: httpHeaders(transport) }) };
  return { transport: new StreamableHTTPClientTransport(url, { requestInit: httpHeaders(transport) }) };
};

/**
 * Programs that may install dependencies on their first start. Launchers fetch a package; interpreters run a script
 * that can install its own (context-mode's `start.mjs` runs `npm install` silently, about 60 s on a cold cache).
 */
const PACKAGE_LAUNCHERS = new Set([
  'npx',
  'npx.cmd',
  'uvx',
  'bunx',
  'pnpx',
  'node',
  'node.exe',
  'python',
  'python3',
  'python.exe',
  'bun',
  'bun.exe',
  'deno',
]);
const FIRST_RUN_TIMEOUT_MS = 180_000;

export const probeTimeoutFor = (
  transport: IMcpServerTransport,
  baseMs: number,
  firstRunMs: number = FIRST_RUN_TIMEOUT_MS
): number =>
  transport.type === 'stdio' && PACKAGE_LAUNCHERS.has(path.basename(transport.command).toLowerCase())
    ? Math.max(baseMs, firstRunMs)
    : baseMs;

/**
 * Fills the secret placeholders of a package connection server. Runs in Main, only for the probe that is about to
 * connect; the catalog entry keeps its placeholders.
 */
export type McpTransportResolver = (
  server: Pick<IMcpServer, 'name' | 'transport'>
) => Promise<{ transport: IMcpServerTransport; secrets: string[] }>;

export class NativeMcpProbe {
  constructor(
    private readonly timeoutMs = 15_000,
    private readonly resolveTransport: McpTransportResolver = (server) => resolveCatalogTransport(server),
    private readonly log: (message: string) => void = (message) => console.warn(message),
    private readonly firstRunMs: number = FIRST_RUN_TIMEOUT_MS
  ) {}

  async test(server: IMcpServer): Promise<McpTestResult> {
    const timeoutMs = probeTimeoutFor(server.transport, this.timeoutMs, this.firstRunMs);
    const client = new Client({ name: 'tomny-mcp-probe', version: '1.0.0' });
    let transport: Transport | undefined;
    let stderr: TextTail | undefined;
    let secrets: string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Resolution fails closed (missing secret, URL not the catalog's) and its error names only the variable.
      const resolved = await this.resolveTransport(server);
      secrets = [...resolved.secrets, ...declaredSecretValues(server.transport)];
      const created = createTransport(resolved.transport);
      transport = created.transport;
      stderr = created.stderr;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('MCP connection timed out.')), timeoutMs);
      });
      // The SDK gives each request 60 seconds by default; the probe budget (up to 180 s for a first package download)
      // is passed to every request so that the SDK does not cut the first run short.
      await Promise.race([client.connect(transport, { timeout: timeoutMs }), timeout]);
      const response = await Promise.race([client.listTools(undefined, { timeout: timeoutMs }), timeout]);
      return {
        success: true,
        tools: response.tools.map((tool) => ({
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {}),
          input_schema: tool.inputSchema,
          ...(tool._meta ? { _meta: tool._meta } : {}),
        })),
      };
    } catch (error) {
      // A remote may echo a header back in its error; the result reaches the renderer and `last_test_error`.
      const raw = error instanceof Error ? error.message : String(error);
      const message = redactProbeText(raw, secrets);
      const output = oneLine(redactProbeText(stderr?.value ?? '', secrets), OUTPUT_IN_ERROR_CHARS);
      const text = (output ? `${message} Server output: ${output}` : message).slice(0, ERROR_TEXT_CHARS);
      const needsAuth = error instanceof UnauthorizedError || /\b(401|unauthori[sz]ed|oauth)\b/i.test(message);
      const tail = oneLine(redactProbeText(stderr?.value ?? '', secrets), STDERR_TAIL_CHARS);
      this.log(
        [
          `[MCP probe] "${server.name}" failed: ${text}`,
          `  ${describeLaunch(server.transport)} timeoutMs=${timeoutMs}`,
          `  stderr tail (${tail.length} chars): ${tail || '(none)'}`,
        ].join('\n')
      );
      return {
        success: false,
        error: text,
        ...(needsAuth ? { needsAuth: true, authMethod: 'oauth' as const } : {}),
      };
    } finally {
      if (timer) clearTimeout(timer);
      await client
        .close()
        .catch(async (): Promise<void> => void (await transport?.close().catch((): void => undefined)));
    }
  }
}

type ConfigSource = { source: string; file: string };
const commonConfigSources = (home = os.homedir(), appData = process.env.APPDATA): ConfigSource[] => [
  { source: 'claude', file: path.join(home, '.claude.json') },
  { source: 'claude-project', file: path.join(process.cwd(), '.mcp.json') },
  ...(appData ? [{ source: 'claude-desktop', file: path.join(appData, 'Claude', 'claude_desktop_config.json') }] : []),
  { source: 'cursor', file: path.join(home, '.cursor', 'mcp.json') },
  { source: 'kiro', file: path.join(home, '.kiro', 'settings', 'mcp.json') },
  { source: 'windsurf', file: path.join(home, '.codeium', 'windsurf', 'mcp_config.json') },
  { source: 'opencode', file: path.join(home, '.config', 'opencode', 'opencode.json') },
];

const transportFrom = (value: unknown): IMcpServerTransport | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.command === 'string')
    return {
      type: 'stdio',
      command: item.command,
      ...(Array.isArray(item.args) ? { args: item.args.filter((v): v is string => typeof v === 'string') } : {}),
      ...(item.env && typeof item.env === 'object' ? { env: item.env as Record<string, string> } : {}),
    };
  if (typeof item.url === 'string')
    return {
      type: item.type === 'sse' ? 'sse' : 'streamable_http',
      url: item.url,
      ...(item.headers && typeof item.headers === 'object' ? { headers: item.headers as Record<string, string> } : {}),
    };
  return null;
};

export class NativeMcpConfigScanner {
  constructor(private readonly sources: ConfigSource[] = commonConfigSources()) {}
  async scan(): Promise<
    Array<{ source: string; servers: Array<IMcpServer & { importable: boolean; import_skip_reason?: string }> }>
  > {
    const result: Array<{
      source: string;
      servers: Array<IMcpServer & { importable: boolean; import_skip_reason?: string }>;
    }> = [];
    for (const source of this.sources) {
      try {
        const parsed = JSON.parse(await readFile(source.file, 'utf8')) as Record<string, unknown>;
        const raw = (parsed.mcpServers ?? parsed.mcp ?? {}) as Record<string, unknown>;
        const servers = Object.entries(raw).map(([name, value], index) => {
          const transport = transportFrom(value);
          const now = Date.now();
          const fallback: IMcpServerTransport = { type: 'stdio', command: '' };
          return {
            id: `${source.source}-${index}-${name}`,
            name,
            enabled: true,
            transport: transport ?? fallback,
            created_at: now,
            updated_at: now,
            original_json: JSON.stringify({ mcpServers: { [name]: value } }, null, 2),
            importable: transport !== null,
            ...(transport ? {} : { import_skip_reason: 'Unsupported MCP transport.' }),
          };
        });
        if (servers.length > 0) result.push({ source: source.source, servers });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          console.warn(`[MCP scanner] Ignored invalid ${source.file}:`, error);
      }
    }
    return result;
  }
}
