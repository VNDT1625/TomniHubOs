import { describe, expect, it } from 'vitest';
import { readLegacyMcpSources, type LegacyMcpSqliteDatabase } from '@process/resources/mcpRegistry/legacyMcpImport';

type Row = Record<string, unknown>;

const fakeDatabase = (tables: Record<string, Row[]>): LegacyMcpSqliteDatabase => ({
  prepare: (sql: string) => ({
    all: () => {
      if (sql.includes('sqlite_master')) return Object.keys(tables).map((name) => ({ name }));
      const table = Object.keys(tables).find((name) => sql.includes(`"${name}"`));
      return table ? tables[table] : [];
    },
  }),
  close: () => undefined,
});

describe('legacy MCP import', () => {
  it('combines local config and live legacy SQLite rows without mutating either source', async () => {
    const local = [
      {
        id: 'local-one',
        name: 'Local MCP',
        enabled: true,
        transport: { type: 'stdio' as const, command: 'local-command', args: [] },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
      },
    ];
    let closed = false;
    const database = fakeDatabase({
      mcp_servers: [
        {
          id: 'legacy-one',
          name: 'Legacy HTTP',
          description: 'from old database',
          enabled: 1,
          transport_type: 'streamable-http',
          transport_config: JSON.stringify({ url: 'https://example.test/mcp', headers: { Authorization: 'Bearer x' } }),
          builtin: 0,
          created_at: 10,
          updated_at: 20,
          original_json: '{"legacy":true}',
          deleted_at: null,
        },
        {
          id: 'deleted',
          name: 'Deleted MCP',
          enabled: 1,
          transport_type: 'stdio',
          transport_config: JSON.stringify({ command: 'deleted-command' }),
          builtin: 0,
          deleted_at: 123,
        },
      ],
    });
    const originalClose = database.close;
    database.close = () => {
      closed = true;
      originalClose();
    };

    const result = await readLegacyMcpSources({
      readConfig: async (key) => (key === 'mcp.config' ? local : undefined),
      databasePaths: ['legacy.db'],
      openDatabase: async () => database,
    });

    expect(result.map((server) => server.name)).toEqual(['Legacy HTTP', 'Local MCP']);
    expect(result[0].transport).toEqual({
      type: 'streamable_http',
      url: 'https://example.test/mcp',
      headers: { Authorization: 'Bearer x' },
    });
    expect(closed).toBe(true);
    expect(local[0].name).toBe('Local MCP');
  });

  it('reads schema-tolerant mcp.config values and de-duplicates names case-insensitively', async () => {
    const database = fakeDatabase({
      client_preferences: [
        {
          key: 'mcp.config',
          value: JSON.stringify([
            { name: 'Shared', transport: { type: 'stdio', command: 'first' }, enabled: true },
            { name: 'shared', transport: { type: 'stdio', command: 'duplicate' }, enabled: true },
          ]),
        },
      ],
      unknown_settings: [{ config_key: 'unrelated', config_value: '[]' }],
    });

    const result = await readLegacyMcpSources({
      databasePaths: ['legacy.db'],
      openDatabase: async () => database,
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Shared');
  });

  it('continues when a legacy database cannot be opened', async () => {
    const result = await readLegacyMcpSources({
      databasePaths: ['missing.db'],
      openDatabase: async () => {
        throw new Error('missing');
      },
    });

    expect(result).toEqual([]);
  });
});
