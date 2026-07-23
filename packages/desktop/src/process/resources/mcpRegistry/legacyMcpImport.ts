import type { IMcpServer, IMcpServerTransport, IMcpTool } from '@/common/config/storage';

export type LegacyMcpSqliteDatabase = {
  prepare(sql: string): { all(...params: unknown[]): Array<Record<string, unknown>> };
  close(): void;
};

export type LegacyMcpImportOptions = {
  databasePaths?: readonly string[];
  readConfig?: (key: 'mcp.config') => Promise<unknown>;
  openDatabase?: (databasePath: string) => Promise<LegacyMcpSqliteDatabase>;
};

const LEGACY_MCP_CONFIG_KEY = 'mcp.config' as const;
const DATABASE_TABLE_HINT = /mcp|setting|preference|config/i;
const TRANSPORT_TYPES = new Set(['stdio', 'sse', 'http', 'streamable_http']);

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : undefined;

const parseJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const asBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return fallback;
};

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const stringRecord = (value: unknown): Record<string, string> | undefined => {
  const record = asRecord(parseJson(value));
  if (!record) return undefined;
  const entries = Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const normalizeTransportType = (value: unknown): IMcpServerTransport['type'] | undefined => {
  const normalized = asString(value)?.toLowerCase().replaceAll('-', '_');
  return normalized && TRANSPORT_TYPES.has(normalized) ? (normalized as IMcpServerTransport['type']) : undefined;
};

const normalizeTransport = (value: unknown, typeHint?: unknown): IMcpServerTransport | undefined => {
  const record = asRecord(parseJson(value)) ?? {};
  const type = normalizeTransportType(record.type ?? typeHint);
  if (type === 'stdio') {
    const command = asString(record.command);
    if (!command) return undefined;
    const args = Array.isArray(record.args) ? record.args.filter((item): item is string => typeof item === 'string') : [];
    return { type, command, args, env: stringRecord(record.env) };
  }
  if (type === 'sse' || type === 'http' || type === 'streamable_http') {
    const url = asString(record.url);
    if (!url) return undefined;
    return { type, url, headers: stringRecord(record.headers) };
  }
  return undefined;
};

const normalizeTools = (value: unknown): IMcpTool[] | undefined => {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? (parsed.filter((item) => asRecord(item)) as IMcpTool[]) : undefined;
};

const normalizeServer = (value: unknown): (Partial<IMcpServer> & Pick<IMcpServer, 'name' | 'transport'>) | undefined => {
  const row = asRecord(value);
  if (!row) return undefined;
  if (row.deleted_at !== null && row.deleted_at !== undefined) return undefined;
  const name = asString(row.name);
  const transport = normalizeTransport(row.transport ?? row.transport_config, row.transport_type);
  if (!name || !transport) return undefined;
  const originalJson = asString(row.original_json);
  return {
    id: asString(row.id),
    name,
    description: asString(row.description),
    enabled: asBoolean(row.enabled, true),
    transport,
    tools: normalizeTools(row.tools),
    last_test_status:
      row.last_test_status === 'connected' ||
      row.last_test_status === 'disconnected' ||
      row.last_test_status === 'error' ||
      row.last_test_status === 'testing'
        ? row.last_test_status
        : undefined,
    last_connected: asNumber(row.last_connected),
    created_at: asNumber(row.created_at),
    updated_at: asNumber(row.updated_at),
    original_json: originalJson ?? JSON.stringify({ mcpServers: { [name]: transport } }, null, 2),
    builtin: asBoolean(row.builtin, false),
  };
};

const extractConfigServers = (value: unknown): unknown[] => {
  const parsed = parseJson(value);
  if (Array.isArray(parsed)) return parsed;
  const record = asRecord(parsed);
  if (!record) return [];
  const nested = parseJson(record[LEGACY_MCP_CONFIG_KEY] ?? record.mcpServers ?? record.mcp_servers);
  if (Array.isArray(nested)) return nested;
  const nestedRecord = asRecord(nested);
  if (!nestedRecord) return [];
  return Object.entries(nestedRecord).map(([name, transport]) => ({ name, transport }));
};

const extractRows = (table: string, rows: UnknownRecord[]): unknown[] => {
  if (/^mcp(?:_|$)|mcp_servers?|mcp_configs?/i.test(table)) return rows;
  return rows.flatMap((row) => {
    const key = asString(row.key ?? row.name ?? row.setting_key ?? row.config_key);
    if (key !== LEGACY_MCP_CONFIG_KEY) return [];
    return extractConfigServers(row.value ?? row.json_value ?? row.setting_value ?? row.config_value ?? row.data);
  });
};

const defaultOpenDatabase = async (databasePath: string): Promise<LegacyMcpSqliteDatabase> => {
  const module = await import('better-sqlite3');
  return new module.default(databasePath, { readonly: true, fileMustExist: true }) as LegacyMcpSqliteDatabase;
};

const readDatabaseServers = async (
  databasePath: string,
  openDatabase: NonNullable<LegacyMcpImportOptions['openDatabase']>
): Promise<unknown[]> => {
  let database: LegacyMcpSqliteDatabase | undefined;
  try {
    database = await openDatabase(databasePath);
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .flatMap((row) => (typeof row.name === 'string' && DATABASE_TABLE_HINT.test(row.name) ? [row.name] : []));
    return tables.flatMap((table) => {
      try {
        const escaped = table.replaceAll('"', '""');
        return extractRows(table, database?.prepare(`SELECT * FROM "${escaped}"`).all() ?? []);
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  } finally {
    database?.close();
  }
};

/**
 * Read legacy MCP sources without starting the old executable or mutating its
 * config/database. SQLite schemas are discovered at runtime to support old releases.
 */
export const readLegacyMcpSources = async (
  options: LegacyMcpImportOptions
): Promise<Array<Partial<IMcpServer> & Pick<IMcpServer, 'name' | 'transport'>>> => {
  const openDatabase = options.openDatabase ?? defaultOpenDatabase;
  const databaseRows = (
    await Promise.all((options.databasePaths ?? []).map((databasePath) => readDatabaseServers(databasePath, openDatabase)))
  ).flat();
  let configRows: unknown[] = [];
  try {
    configRows = extractConfigServers(await options.readConfig?.(LEGACY_MCP_CONFIG_KEY));
  } catch {
    // Missing or unreadable legacy config is expected on fresh installs.
  }
  const deduped = new Map<string, Partial<IMcpServer> & Pick<IMcpServer, 'name' | 'transport'>>();
  for (const row of [...databaseRows, ...configRows]) {
    const server = normalizeServer(row);
    if (!server) continue;
    const key = server.name.trim().toLowerCase();
    if (!deduped.has(key)) deduped.set(key, server);
  }
  return [...deduped.values()];
};
