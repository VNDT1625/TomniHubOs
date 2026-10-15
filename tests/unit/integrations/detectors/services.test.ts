import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInventory } from '@/common/integrations/detectors';
import { services } from '@/common/integrations/detectors/apps';
import { detectServices } from '@/common/packages/serviceDetector';
import type { AdapterConnection, AdapterOpenItem } from '@/common/packages/adapter';
import { fixtureInventory, inventoryOf } from './mcpFixtures';

const FIXTURES = path.resolve(__dirname, '../../../fixtures/repotopackage');

const byKey = (left: AdapterConnection, right: AdapterConnection): number =>
  `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`);

/** Open items are compared by kind, path and variable name; notes may be reworded. */
const summary = (items: readonly AdapterOpenItem[]) =>
  items
    .map((item) => ({ kind: item.kind, path: item.path, name: item.name }))
    .toSorted((a, b) =>
      `${a.kind}${a.path ?? ''}${a.name ?? ''}`.localeCompare(`${b.kind}${b.path ?? ''}${b.name ?? ''}`)
    );

const expectedOf = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name, 'expected.adapter.json'), 'utf8')) as {
    connections: AdapterConnection[];
    openItems: { kind: string; path?: string; name?: string }[];
  };

describe('services detector', () => {
  it.each(['web-service', 'compose-app', 'discord-bot'])(
    'matches the expected connections and open items of the %s fixture',
    (name) => {
      const result = services.detect(fixtureInventory(name));
      const expected = expectedOf(name);

      expect([...result.connections].toSorted(byKey)).toEqual([...expected.connections].toSorted(byKey));
      expect(summary(result.openItems)).toEqual(summary(expected.openItems as AdapterOpenItem[]));
    }
  );

  it('keeps the classifier result for a front end with its back end: one web-embed with both processes', () => {
    const inventory = fixtureInventory('web-service');
    const direct = detectServices(inventory.files, {
      'backend/pyproject.toml': inventory.text('backend/pyproject.toml') ?? '',
      'frontend/package.json': inventory.text('frontend/package.json') ?? '',
    });
    const result = services.detect(inventory);
    const embed = result.connections.find((connection) => connection.kind === 'web-embed');

    expect(direct.embed).toBeDefined();
    expect(embed).toEqual(
      expect.objectContaining({
        id: direct.embed,
        process: expect.objectContaining({
          services: expect.arrayContaining(
            direct.services.map((service) => expect.objectContaining({ id: service.id }))
          ),
          embed: { service: direct.embed },
        }),
      })
    );
  });

  it('never copies a token value from an example file into the output', () => {
    const result = services.detect(
      inventoryOf({
        'package.json': JSON.stringify({ name: 'bot', dependencies: { telegraf: '4' } }),
        '.env.example': 'TELEGRAM_BOT_TOKEN=real-token-value-do-not-copy\n',
      })
    );

    expect(result.openItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'env-value', name: 'TELEGRAM_BOT_TOKEN' })])
    );
    expect(JSON.stringify(result)).not.toContain('real-token-value-do-not-copy');
  });

  it('finds a Python bot from requirements and reads the token name next to it', () => {
    const result = services.detect(
      inventoryOf(
        {
          'bots/chat/requirements.txt': 'discord.py==2.4.0\n',
          'bots/chat/.env.example': 'DISCORD_TOKEN=\n',
        },
        []
      )
    );

    // No bot.py or main.py next to the manifest: the entry point is unknown, so no connection is made.
    expect(summary(result.openItems)).toEqual([
      { kind: 'env-value', name: 'DISCORD_TOKEN', path: 'source/bots/chat/requirements.txt' },
      { kind: 'needs-runtime', path: 'source/bots/chat/requirements.txt', name: undefined },
    ]);
    expect(result.connections).toEqual([]);
    expect(result.claimed).toEqual(expect.arrayContaining(['bots/chat/requirements.txt', 'bots/chat/.env.example']));
  });

  it('starts a Python bot from its bot.py as a headless service with the token as a required variable', () => {
    const result = services.detect(
      inventoryOf(
        {
          'bots/chat/requirements.txt': 'discord.py==2.4.0\n',
          'bots/chat/bot.py': 'print("hello")\n',
          'bots/chat/.env.example': 'DISCORD_TOKEN=\n',
        },
        []
      )
    );
    const connection = result.connections[0] as Extract<AdapterConnection, { kind: 'service' }>;

    expect(result.connections).toHaveLength(1);
    expect(connection).toEqual(expect.objectContaining({ kind: 'service', headless: true, title: 'Discord bot' }));
    expect(connection.process.services[0]).toEqual({
      id: connection.id,
      cwd: 'source/bots/chat',
      setup: [['pip', 'install', '-r', 'requirements.txt']],
      start: ['python', 'bot.py'],
      env: [{ name: 'DISCORD_TOKEN', required: true, hint: '.env.example' }],
    });
    expect(JSON.stringify(result)).not.toContain('"ready"');
  });

  it('reports the published ports of a compose file and keeps only the host side', () => {
    const result = services.detect(fixtureInventory('compose-app'));

    expect(summary(result.openItems)).toEqual([
      { kind: 'unrecognized', path: 'source/docker-compose.yml', name: undefined },
    ]);
    expect(result.openItems[0]?.note).toContain('8080, 9000');
    expect(result.connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'web-embed', id: 'compose-web', url: 'http://127.0.0.1:8080/' }),
      ])
    );
  });

  describe('hostile input', () => {
    it('reports a compose file whose text is missing rather than dropping it', () => {
      const result = services.detect(inventoryOf({}, ['docker-compose.yml']));

      expect(result.connections).toEqual([]);
      expect(result.openItems).toEqual([
        expect.objectContaining({ kind: 'unrecognized', path: 'source/docker-compose.yml' }),
      ]);
    });

    it('does not read a README or a source file for services or tokens', () => {
      const read: string[] = [];
      const inventory = createInventory({
        files: ['README.md', 'src/bot.ts', '.env.example'],
        readText: (file) => {
          read.push(file);
          return 'DISCORD_TOKEN=\n';
        },
      });
      services.detect(inventory);

      expect(read).toEqual(['.env.example']);
    });

    it('drops traversal paths before any manifest is read', () => {
      const result = services.detect(inventoryOf({ '../package.json': '{"dependencies":{"discord.js":"1"}}' }));

      expect(result.openItems).toEqual([]);
      expect(result.claimed).toEqual([]);
    });
  });

  it('produces nothing for a repository without services or bots', () => {
    const result = services.detect(inventoryOf({ 'package.json': '{"name":"lib","version":"1.0.0"}' }));

    expect(result.connections).toEqual([]);
    expect(result.openItems).toEqual([]);
  });
});
