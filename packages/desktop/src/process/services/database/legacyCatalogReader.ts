import type { IProvider, ModelCapability, ModelType } from '@/common/config/storage';
import type { AgentEnvEntry, AgentMetadata, AgentType } from '@/common/types/agent/agentMetadata';
import type { Assistant, AssistantSource } from '@/common/types/agent/assistantTypes';

export type LegacyCatalogSnapshot = {
  providers: IProvider[];
  assistants: Assistant[];
  agents: AgentMetadata[];
};

export type LegacyCatalogReaderOptions = {
  databasePaths?: readonly string[];
  readConfig?: (key: string) => Promise<unknown>;
};

type UnknownRow = Record<string, unknown>;
type SqliteDatabase = {
  prepare(sql: string): { all(...params: unknown[]): UnknownRow[] };
  close(): void;
};
type SqliteDatabaseConstructor = new (
  databasePath: string,
  options: { readonly: boolean; fileMustExist: boolean }
) => SqliteDatabase;

const asObject = (value: unknown): UnknownRow | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRow) : undefined;
const asString = (...values: unknown[]): string | undefined =>
  values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
const asBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return fallback;
};
const asOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const asNumber = (value: unknown, fallback = 0): number => asOptionalNumber(value) ?? fallback;
const parseJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};
const asStringArray = (value: unknown): string[] => {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return [
    ...new Set(
      parsed.flatMap((item) => {
        const normalized = asString(item);
        return normalized ? [normalized] : [];
      })
    ),
  ];
};
const asStringRecord = (value: unknown): Record<string, string> => {
  const parsed = asObject(parseJson(value));
  if (!parsed) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
};
const asBooleanRecord = (value: unknown): Record<string, boolean> => {
  const parsed = asObject(parseJson(value));
  if (!parsed) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
  );
};
const nonEmptyRecord = <T>(record: Record<string, T>): Record<string, T> | undefined =>
  Object.keys(record).length > 0 ? record : undefined;
const asStringArrayRecord = (value: unknown): Record<string, string[]> => {
  const parsed = asObject(parseJson(value));
  if (!parsed) return {};
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([key, item]) => {
      const values = asStringArray(item);
      return values.length > 0 ? [[key, values]] : [];
    })
  );
};
const objectField = (row: UnknownRow, ...keys: string[]): UnknownRow | undefined => {
  for (const key of keys) {
    const value = asObject(parseJson(row[key]));
    if (value) return value;
  }
  return undefined;
};
const valueField = (row: UnknownRow, ...keys: string[]): unknown => {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key];
  return undefined;
};
const dedupe = <T extends { id: string }>(rows: T[]): T[] => [...new Map(rows.map((row) => [row.id, row])).values()];

const MODEL_TYPES = new Set<ModelType>([
  'text',
  'vision',
  'function_calling',
  'image_generation',
  'web_search',
  'reasoning',
  'embedding',
  'rerank',
  'excludeFromPrimary',
]);
const normalizeCapabilities = (value: unknown): ModelCapability[] | undefined => {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return undefined;
  return parsed.flatMap((item): ModelCapability[] => {
    const row = asObject(item);
    const type = asString(row?.type);
    if (!type || !MODEL_TYPES.has(type as ModelType)) return [];
    return [
      {
        type: type as ModelType,
        ...(typeof row?.isUserSelected === 'boolean' ? { isUserSelected: row.isUserSelected } : {}),
      },
    ];
  });
};
const normalizeModelHealth = (value: unknown): IProvider['model_health'] => {
  const parsed = asObject(parseJson(value));
  if (!parsed) return undefined;
  const entries = Object.entries(parsed).flatMap(([model, item]) => {
    const row = asObject(item);
    const status = asString(row?.status);
    if (!row || (status !== 'unknown' && status !== 'healthy' && status !== 'unhealthy')) return [];
    const health: NonNullable<IProvider['model_health']>[string] = {
      status,
      ...(asOptionalNumber(row.last_check) !== undefined ? { last_check: asOptionalNumber(row.last_check) } : {}),
      ...(asOptionalNumber(row.latency) !== undefined ? { latency: asOptionalNumber(row.latency) } : {}),
      ...(asString(row.error) ? { error: asString(row.error) } : {}),
    };
    return [[model, health] as const];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};
const normalizeAgentEnv = (value: unknown): AgentEnvEntry[] | undefined => {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return undefined;
  const entries = parsed.flatMap((item): AgentEnvEntry[] => {
    const row = asObject(item);
    const name = asString(row?.name);
    if (!row || !name || typeof row.value !== 'string') return [];
    return [
      { name, value: row.value, ...(asString(row.description) ? { description: asString(row.description) } : {}) },
    ];
  });
  return entries.length > 0 ? entries : undefined;
};
const normalizeBehaviorPolicy = (value: unknown): AgentMetadata['behavior_policy'] => {
  const row = asObject(parseJson(value));
  return typeof row?.supports_side_question === 'boolean'
    ? { supports_side_question: row.supports_side_question }
    : undefined;
};
const AGENT_TYPES = new Set<AgentType>(['acp', 'remote', 'aionrs', 'openclaw-gateway', 'nanobot']);
const asAgentType = (value: unknown): AgentType => {
  const candidate = asString(value);
  return candidate && AGENT_TYPES.has(candidate as AgentType) ? (candidate as AgentType) : 'acp';
};

const normalizeProvider = (raw: unknown): IProvider | undefined => {
  const row = asObject(raw);
  if (!row) return undefined;
  const id = asString(row.id);
  const platform = asString(row.platform, row.provider, row.type);
  const name = asString(row.name, platform);
  const baseUrl = asString(row.base_url, row.baseUrl, row.endpoint) ?? '';
  if (!id || !platform || !name) return undefined;
  const bedrock = objectField(row, 'bedrock_config', 'bedrockConfig');
  return {
    id,
    platform,
    name,
    base_url: baseUrl,
    api_key: asString(row.api_key, row.apiKey, row.token) ?? '',
    models: asStringArray(valueField(row, 'models', 'model')),
    enabled: asBoolean(row.enabled, true),
    capabilities: normalizeCapabilities(row.capabilities),
    context_limit: asOptionalNumber(valueField(row, 'context_limit', 'contextLimit')),
    model_protocols: nonEmptyRecord(asStringRecord(valueField(row, 'model_protocols', 'modelProtocols'))),
    model_enabled: nonEmptyRecord(asBooleanRecord(valueField(row, 'model_enabled', 'modelEnabled'))),
    model_health: normalizeModelHealth(valueField(row, 'model_health', 'modelHealth')),
    is_full_url: asBoolean(valueField(row, 'is_full_url', 'isFullUrl'), false),
    bedrock_config: bedrock
      ? {
          auth_method: asString(bedrock.auth_method, bedrock.authMethod) === 'profile' ? 'profile' : 'accessKey',
          region: asString(bedrock.region) ?? '',
          access_key_id: asString(bedrock.access_key_id, bedrock.accessKeyId),
          secret_access_key: asString(bedrock.secret_access_key, bedrock.secretAccessKey),
          profile: asString(bedrock.profile),
        }
      : undefined,
  };
};

const normalizeAssistant = (raw: unknown): Assistant | undefined => {
  const row = asObject(raw);
  if (!row) return undefined;
  const id = asString(row.id);
  const name = asString(row.name);
  if (!id || !name) return undefined;
  const builtin = asBoolean(row.isBuiltin, false) || asBoolean(row.is_builtin, false) || id.startsWith('builtin-');
  const source = (asString(row.source) ?? (builtin ? 'builtin' : 'user')) as AssistantSource;
  return {
    id: id.startsWith('builtin-') ? id.slice('builtin-'.length) : id,
    source: source === 'builtin' || source === 'extension' ? source : 'user',
    name,
    name_i18n: asStringRecord(valueField(row, 'name_i18n', 'nameI18n')),
    description: asString(row.description),
    description_i18n: asStringRecord(valueField(row, 'description_i18n', 'descriptionI18n')),
    avatar: asString(row.avatar),
    enabled: asBoolean(row.enabled, true),
    sort_order: asNumber(valueField(row, 'sort_order', 'sortOrder')),
    preset_agent_type: asString(row.preset_agent_type, row.presetAgentType) ?? 'aionrs',
    enabled_skills: asStringArray(valueField(row, 'enabled_skills', 'enabledSkills')),
    custom_skill_names: asStringArray(valueField(row, 'custom_skill_names', 'customSkillNames')),
    disabled_builtin_skills: asStringArray(valueField(row, 'disabled_builtin_skills', 'disabledBuiltinSkills')),
    context: asString(row.context),
    context_i18n: asStringRecord(valueField(row, 'context_i18n', 'contextI18n')),
    prompts: asStringArray(row.prompts),
    prompts_i18n: asStringArrayRecord(valueField(row, 'prompts_i18n', 'promptsI18n')),
    models: asStringArray(row.models),
    last_used_at: asOptionalNumber(valueField(row, 'last_used_at', 'lastUsedAt')),
  };
};

const normalizeAgent = (raw: unknown): AgentMetadata | undefined => {
  const row = asObject(raw);
  if (!row) return undefined;
  const id = asString(row.id);
  const name = asString(row.name);
  const command = asString(row.command, row.cli_path, row.cliPath);
  if (!id || !name || !command) return undefined;
  const source = asString(row.agent_source, row.agentSource) ?? 'custom';
  if (source !== 'custom') return undefined;
  return {
    id,
    name,
    icon: asString(row.icon),
    description: asString(row.description),
    backend: asString(row.backend) ?? id,
    agent_type: asAgentType(valueField(row, 'agent_type', 'agentType')),
    agent_source: 'custom',
    enabled: asBoolean(row.enabled, true),
    available: false,
    team_capable: asBoolean(valueField(row, 'team_capable', 'teamCapable'), true),
    command,
    args: asStringArray(row.args),
    env: normalizeAgentEnv(row.env),
    native_skills_dirs: asStringArray(valueField(row, 'native_skills_dirs', 'nativeSkillsDirs')),
    behavior_policy: normalizeBehaviorPolicy(valueField(row, 'behavior_policy', 'behaviorPolicy')),
    yolo_id: asString(row.yolo_id, row.yoloId),
  };
};

const CONFIG_KEYS = {
  providers: ['model.config', 'providers'],
  assistants: ['assistants'],
  agents: ['agents', 'customAgents', 'agent.config'],
} as const;
const TABLES = {
  providers: ['providers', 'provider_configs'],
  assistants: ['assistants', 'assistant_configs'],
  agents: ['agents', 'agent_configs', 'custom_agents'],
} as const;

const readConfigRows = async (
  readConfig: LegacyCatalogReaderOptions['readConfig'],
  keys: readonly string[]
): Promise<unknown[]> => {
  if (!readConfig) return [];
  const values = await Promise.all(
    keys.map(async (key): Promise<unknown> => {
      try {
        return await readConfig(key);
      } catch {
        // Missing legacy keys are expected.
        return undefined;
      }
    })
  );
  return values.flatMap((value) => {
    const parsed = parseJson(value);
    return Array.isArray(parsed) ? parsed : [];
  });
};

const readSqliteRows = async (databasePaths: readonly string[], tableNames: readonly string[]): Promise<unknown[]> => {
  const rows: unknown[] = [];
  let Database: SqliteDatabaseConstructor;
  try {
    const module: unknown = await import('better-sqlite3');
    const candidate = asObject(module)?.default ?? module;
    if (typeof candidate !== 'function') return rows;
    Database = candidate as SqliteDatabaseConstructor;
  } catch {
    return rows;
  }
  for (const databasePath of databasePaths) {
    let database: SqliteDatabase | undefined;
    try {
      database = new Database(databasePath, { readonly: true, fileMustExist: true });
      const existing = new Set(
        database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .flatMap((row) => (typeof row.name === 'string' ? [row.name] : []))
      );
      for (const table of tableNames) {
        if (!existing.has(table)) continue;
        rows.push(...database.prepare(`SELECT * FROM "${table}"`).all());
      }
    } catch {
      // A missing database, table, native binding, or old schema must not block startup.
    } finally {
      database?.close();
    }
  }
  return rows;
};

/** Read-only, schema-tolerant legacy catalog import that never starts the old executable. */
export const readLegacyCatalog = async (options: LegacyCatalogReaderOptions): Promise<LegacyCatalogSnapshot> => {
  const [providerConfig, assistantConfig, agentConfig, providerDb, assistantDb, agentDb] = await Promise.all([
    readConfigRows(options.readConfig, CONFIG_KEYS.providers),
    readConfigRows(options.readConfig, CONFIG_KEYS.assistants),
    readConfigRows(options.readConfig, CONFIG_KEYS.agents),
    readSqliteRows(options.databasePaths ?? [], TABLES.providers),
    readSqliteRows(options.databasePaths ?? [], TABLES.assistants),
    readSqliteRows(options.databasePaths ?? [], TABLES.agents),
  ]);
  return {
    providers: dedupe(
      [...providerDb, ...providerConfig].flatMap((row): IProvider[] => {
        const provider = normalizeProvider(row);
        return provider ? [provider] : [];
      })
    ),
    assistants: dedupe(
      [...assistantDb, ...assistantConfig].flatMap((row): Assistant[] => {
        const assistant = normalizeAssistant(row);
        return assistant ? [assistant] : [];
      })
    ),
    agents: dedupe(
      [...agentDb, ...agentConfig].flatMap((row): AgentMetadata[] => {
        const agent = normalizeAgent(row);
        return agent ? [agent] : [];
      })
    ),
  };
};
