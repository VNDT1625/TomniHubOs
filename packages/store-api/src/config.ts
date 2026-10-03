export type StoreApiConfig = Readonly<{
  port: number;
  databaseUrl: string;
  supabaseIssuer: string;
  supabaseAudience: string;
  jwksUrl: string;
  nodeEnv: 'development' | 'test' | 'production';
  internalToken?: string;
  downloadTicketSecret?: string;
  dbPoolMax: number;
  dbIdleTimeoutMs: number;
  dbConnectionTimeoutMs: number;
}>;

const required = (env: Readonly<Record<string, string | undefined>>, key: string): string => {
  const value = env[key]?.trim();
  if (!value) throw new Error(`STORE_API_CONFIG_MISSING:${key}`);
  return value;
};

const boundedInteger = (
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: number,
  min: number,
  max: number
): number => {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`STORE_API_CONFIG_INVALID:${key}`);
  return value;
};

export const readStoreApiConfig = (env: Readonly<Record<string, string | undefined>> = process.env): StoreApiConfig => {
  const port = Number(env.PORT ?? '8080');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('STORE_API_CONFIG_INVALID:PORT');
  const issuer = required(env, 'SUPABASE_ISSUER').replace(/\/$/u, '');
  const jwksUrl = required(env, 'SUPABASE_JWKS_URL');
  const parsed = new URL(jwksUrl);
  if (parsed.protocol !== 'https:') throw new Error('STORE_API_CONFIG_INVALID:SUPABASE_JWKS_URL');
  const nodeEnv = env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development';
  const internalToken = env.STORE_INTERNAL_TOKEN?.trim();
  const downloadTicketSecret = env.DOWNLOAD_TICKET_SECRET?.trim();
  if (nodeEnv === 'production' && !internalToken) throw new Error('STORE_API_CONFIG_MISSING:STORE_INTERNAL_TOKEN');
  if (nodeEnv === 'production' && !downloadTicketSecret)
    throw new Error('STORE_API_CONFIG_MISSING:DOWNLOAD_TICKET_SECRET');
  if (nodeEnv === 'production' && !env.PADDLE_WEBHOOK_SECRET?.trim())
    throw new Error('STORE_API_CONFIG_MISSING:PADDLE_WEBHOOK_SECRET');
  if (nodeEnv === 'production' && !env.PADDLE_API_KEY?.trim())
    throw new Error('STORE_API_CONFIG_MISSING:PADDLE_API_KEY');
  if (nodeEnv === 'production' && !env.GCS_BUCKET?.trim()) throw new Error('STORE_API_CONFIG_MISSING:GCS_AUTHORITY');
  if (nodeEnv === 'production' && env.PADDLE_ENV && env.PADDLE_ENV.trim().toLowerCase() !== 'production')
    throw new Error('STORE_API_CONFIG_INVALID:PADDLE_ENV');

  const databaseUrl = required(env, 'DATABASE_URL');
  const dbPoolMax = boundedInteger(env, 'STORE_DB_POOL_MAX', 4, 1, 32);
  const dbIdleTimeoutMs = boundedInteger(env, 'STORE_DB_IDLE_TIMEOUT_MS', 10_000, 0, 300_000);
  const dbConnectionTimeoutMs = boundedInteger(env, 'STORE_DB_CONNECTION_TIMEOUT_MS', 5_000, 250, 60_000);
  if (nodeEnv === 'production') {
    const user = new URL(databaseUrl).username.toLowerCase();
    if (!user || user === 'postgres' || user === 'supabase_admin')
      throw new Error('STORE_API_CONFIG_INVALID:DATABASE_ROLE');
  }
  return {
    databaseUrl,
    port,
    supabaseIssuer: issuer,
    supabaseAudience: required(env, 'SUPABASE_AUDIENCE'),
    jwksUrl: parsed.toString(),
    nodeEnv,
    ...(internalToken ? { internalToken } : {}),
    ...(downloadTicketSecret ? { downloadTicketSecret } : {}),
    dbPoolMax,
    dbIdleTimeoutMs,
    dbConnectionTimeoutMs,
  };
};
