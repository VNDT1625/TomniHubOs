import pg from 'pg';
const { Pool } = pg;

export type StoreDatabase = Readonly<{
  pool: pg.Pool;
  close: () => Promise<void>;
  health: () => Promise<void>;
  transaction: <T>(work: (client: pg.PoolClient) => Promise<T>) => Promise<T>;
}>;

export type StoreDatabaseOptions = Readonly<{
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}>;

export const createStoreDatabase = (databaseUrl: string, options: StoreDatabaseOptions = {}): StoreDatabase => {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: options.max ?? 4,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 10_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
  });
  return {
    pool,
    close: () => pool.end(),
    health: async () => {
      await pool.query('SELECT 1');
    },
    transaction: async <T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const value = await work(client);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
};
