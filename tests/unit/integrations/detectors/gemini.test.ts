import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInventory } from '@/common/integrations/detectors';
import { gemini } from '@/common/integrations/detectors/agent/gemini';
import type { AdapterConnection, AdapterOpenItem } from '@/common/packages/adapter';
import { fixtureInventory, inventoryOf } from './mcpFixtures';

const FIXTURES = path.resolve(__dirname, '../../../fixtures/repotopackage');
const SECRET = 'FAKE-GEMINI-TOKEN-0123456789';

const byKey = (left: AdapterConnection, right: AdapterConnection): number =>
  `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`);

const summary = (items: readonly AdapterOpenItem[]) =>
  items
    .map((item) => ({ kind: item.kind, path: item.path, name: item.name }))
    .toSorted((a, b) =>
      `${a.kind}${a.path ?? ''}${a.name ?? ''}`.localeCompare(`${b.kind}${b.path ?? ''}${b.name ?? ''}`)
    );

const manifest = (value: unknown): string => JSON.stringify(value);

describe('gemini detector', () => {
  it('matches the expected connections and open items of the gemini-extension fixture', () => {
    const result = gemini.detect(fixtureInventory('gemini-extension'));
    const expected = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, 'gemini-extension', 'expected.adapter.json'), 'utf8')
    ) as { connections: AdapterConnection[]; openItems: { kind: string; path?: string; name?: string }[] };

    expect([...result.connections].toSorted(byKey)).toEqual([...expected.connections].toSorted(byKey));
    expect(summary(result.openItems)).toEqual(summary(expected.openItems as AdapterOpenItem[]));
    expect(result.claimed).toEqual(
      expect.arrayContaining(['commands/review.toml', 'commands/tools/lint.toml', 'gemini-extension.json'])
    );
  });

  it('never copies a token value from the server environment into the output', () => {
    const result = gemini.detect(fixtureInventory('gemini-extension'));

    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('rewrites the extension placeholders so the server runs from the extension folder', () => {
    const result = gemini.detect(fixtureInventory('gemini-extension'));
    const local = result.connections.find((connection) => connection.id === 'demo-local');

    expect(JSON.stringify(local)).not.toContain('${extensionPath}');
    expect(local).toEqual(expect.objectContaining({ kind: 'mcp', origin: 'gemini-extension' }));
  });

  it('maps httpUrl to url for a remote server', () => {
    const result = gemini.detect(fixtureInventory('gemini-extension'));

    expect(result.connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'mcp', id: 'demo-remote', url: 'https://mcp.example.com/mcp' }),
      ])
    );
  });

  it('does not claim a manifest that has only a context file name, which commands-agents already handles', () => {
    const result = gemini.detect(
      inventoryOf({ 'gemini-extension.json': manifest({ name: 'x', contextFileName: 'G.md' }) })
    );

    expect(result.connections).toEqual([]);
    expect(result.openItems).toEqual([]);
    expect(result.claimed).toEqual([]);
  });

  it('reports a setting whose envVar is not a valid variable name instead of using it', () => {
    const result = gemini.detect(
      inventoryOf({ 'gemini-extension.json': manifest({ settings: [{ envVar: 'bad name;rm' }] }) })
    );

    expect(result.openItems).toEqual([expect.objectContaining({ kind: 'unrecognized' })]);
    expect(JSON.stringify(result.openItems)).not.toContain('bad name');
  });

  describe('hostile input', () => {
    it('reports a manifest whose text is missing and an invalid JSON manifest', () => {
      const missing = gemini.detect(inventoryOf({}, ['gemini-extension.json']));
      const broken = gemini.detect(inventoryOf({ 'gemini-extension.json': '{"mcpServers": ' }));

      expect(missing.openItems).toEqual([
        expect.objectContaining({ kind: 'unrecognized', path: 'source/gemini-extension.json' }),
      ]);
      expect(broken.openItems).toEqual([expect.objectContaining({ kind: 'unrecognized' })]);
    });

    it('reports a command without a prompt, and a command whose TOML is broken', () => {
      const result = gemini.detect(
        inventoryOf({
          'gemini-extension.json': manifest({ name: 'x' }),
          'commands/no-prompt.toml': 'description = "missing"',
          'commands/broken.toml': 'prompt = ',
        })
      );

      expect(result.connections).toEqual([]);
      expect(result.openItems.map((item) => item.path).toSorted()).toEqual([
        'source/commands/broken.toml',
        'source/commands/no-prompt.toml',
      ]);
    });

    it('does not read a file that is not a declaration, nor one beside a vendored copy', () => {
      const read: string[] = [];
      const inventory = createInventory({
        files: ['src/main.ts', 'node_modules/x/gemini-extension.json', 'gemini-extension.json'],
        readText: (file) => {
          read.push(file);
          return manifest({ name: 'x' });
        },
      });
      gemini.detect(inventory);

      expect(read).toEqual(['gemini-extension.json']);
    });

    it('drops traversal paths before any manifest is read', () => {
      const result = gemini.detect(inventoryOf({ '../gemini-extension.json': manifest({ mcpServers: {} }) }));

      expect(result.connections).toEqual([]);
      expect(result.claimed).toEqual([]);
    });
  });
});
