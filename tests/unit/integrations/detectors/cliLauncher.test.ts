import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInventory } from '@/common/integrations/detectors';
import { cliLauncher } from '@/common/integrations/detectors/apps';
import type { AdapterConnection, AdapterOpenItem } from '@/common/packages/adapter';
import { fixtureInventory, inventoryOf } from './mcpFixtures';

const FIXTURES = path.resolve(__dirname, '../../../fixtures/repotopackage');

const byKey = (left: AdapterConnection, right: AdapterConnection): number =>
  `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`);

/** Open items are compared by kind and path: the notes are for people and may be reworded. */
const summary = (items: readonly AdapterOpenItem[]) =>
  items
    .map((item) => ({ kind: item.kind, path: item.path }))
    .toSorted((a, b) => (a.path ?? '').localeCompare(b.path ?? ''));

const expectedOf = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name, 'expected.adapter.json'), 'utf8')) as {
    connections: AdapterConnection[];
    openItems: { kind: string; path?: string }[];
  };

describe('cli-launcher detector', () => {
  it.each(['cli-node', 'cli-python', 'cli-rust', 'desktop-electron'])(
    'matches the expected connections and open items of the %s fixture',
    (name) => {
      const result = cliLauncher.detect(fixtureInventory(name));
      const expected = expectedOf(name);

      expect([...result.connections].toSorted(byKey)).toEqual([...expected.connections].toSorted(byKey));
      expect(summary(result.openItems)).toEqual(summary(expected.openItems as AdapterOpenItem[]));
    }
  );

  it('builds an npx argument vector for a published single-bin package and never a shell string', () => {
    const result = cliLauncher.detect(fixtureInventory('cli-node'));
    const npx = result.connections.find((connection) => connection.id === 'demo-cli');

    expect(npx).toEqual(expect.objectContaining({ command: 'npx', args: ['-y', '@demo/cli-node'] }));
    expect(JSON.stringify(result.connections)).not.toMatch(/&&|\|\||;|\$\(/u);
  });

  it('keeps a private package runnable from source only when its bin is JavaScript', () => {
    const result = cliLauncher.detect(fixtureInventory('cli-node'));

    expect(result.connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local-tool', command: 'node', cwd: 'source/tools/local', source: 'source' }),
      ])
    );
    expect(result.openItems).toEqual([
      expect.objectContaining({ kind: 'needs-runtime', path: 'source/tools/local/package.json' }),
    ]);
  });

  it('does not claim a plain package.json: it is not a launcher and must not become an open item', () => {
    const result = cliLauncher.detect(inventoryOf({ 'package.json': '{"name":"lib","version":"1.0.0"}' }));

    expect(result.connections).toEqual([]);
    expect(result.openItems).toEqual([]);
    expect(result.claimed).toEqual([]);
  });

  it('never lets a package name become a flag: "-y" is not a registry package', () => {
    const result = cliLauncher.detect(
      inventoryOf({ 'package.json': JSON.stringify({ name: '-y', version: '1.0.0', bin: { x: 'bin/x.js' } }) })
    );

    expect(result.connections).toEqual([expect.objectContaining({ command: 'node' })]);
    expect(JSON.stringify(result.connections)).not.toContain('"-y"');
  });

  describe('hostile input', () => {
    it('refuses a bin path that escapes the package', () => {
      const result = cliLauncher.detect(
        inventoryOf({ 'package.json': JSON.stringify({ name: 'x', bin: { x: '../../evil.js' } }) })
      );

      expect(result.connections).toEqual([]);
      expect(result.openItems).toEqual([expect.objectContaining({ kind: 'unrecognized' })]);
    });

    it('refuses a command name with shell syntax', () => {
      const result = cliLauncher.detect(
        inventoryOf({ 'package.json': JSON.stringify({ name: 'x', version: '1.0.0', bin: { 'evil;rm': 'bin/x.js' } }) })
      );

      expect(result.connections).toEqual([]);
      expect(result.openItems).toEqual([expect.objectContaining({ kind: 'unrecognized' })]);
    });

    it('reports more than eight bins and reads only the first eight', () => {
      const bin = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`tool${index}`, `bin/t${index}.js`]));
      const result = cliLauncher.detect(
        inventoryOf({ 'package.json': JSON.stringify({ name: 'many', private: true, bin }) })
      );

      expect(result.connections).toHaveLength(8);
      expect(result.openItems).toEqual([expect.objectContaining({ kind: 'unrecognized' })]);
    });

    it('reports a bin field that is neither a string nor an object', () => {
      const result = cliLauncher.detect(inventoryOf({ 'package.json': '{"name":"x","bin":42}' }));

      expect(result.connections).toEqual([]);
      expect(result.openItems).toEqual([expect.objectContaining({ kind: 'unrecognized' })]);
    });

    it('reports an invalid TOML file and a pyproject whose text was cut', () => {
      const invalid = cliLauncher.detect(inventoryOf({ 'pyproject.toml': '[project\nname = ' }));
      const cut = cliLauncher.detect(inventoryOf({}, ['pyproject.toml']));

      expect(invalid.openItems).toEqual([
        expect.objectContaining({ kind: 'unrecognized', path: 'source/pyproject.toml' }),
      ]);
      expect(cut.openItems).toEqual([expect.objectContaining({ kind: 'unrecognized', path: 'source/pyproject.toml' })]);
    });

    it('does not read a file that is not a declaration, nor a vendored manifest', () => {
      const read: string[] = [];
      const inventory = createInventory({
        files: ['src/index.ts', 'package.json', 'node_modules/pkg/package.json'],
        readText: (file) => {
          read.push(file);
          return '{"name":"x","bin":{"x":"bin/x.js"}}';
        },
      });
      cliLauncher.detect(inventory);

      expect(read).toEqual(['package.json']);
    });

    it('drops traversal paths before any manifest is read', () => {
      const result = cliLauncher.detect(inventoryOf({ '../package.json': '{"name":"x","bin":{"x":"bin/x.js"}}' }));

      expect(result.connections).toEqual([]);
      expect(result.claimed).toEqual([]);
    });
  });

  it('turns the main packages of a Go module into open items, from file names only', () => {
    const result = cliLauncher.detect(
      inventoryOf({ 'go.mod': 'module example.com/tool' }, [
        'main.go',
        'cmd/tool/main.go',
        'cmd/tool/nested/main.go',
        'cmd/tool/domain.go',
        'pkg/main.go',
        'vendor/lib/main.go',
      ])
    );

    expect(result.connections).toEqual([]);
    expect(summary(result.openItems)).toEqual([
      { kind: 'needs-runtime', path: 'source/cmd/tool/main.go' },
      { kind: 'needs-runtime', path: 'source/main.go' },
    ]);
  });

  it('reads the product name of an electron-builder YAML file', () => {
    const result = cliLauncher.detect(
      inventoryOf({ 'electron-builder.yml': 'appId: dev.x\nproductName: "Tomny Demo"\n' })
    );

    expect(result.connections).toEqual([
      expect.objectContaining({
        kind: 'launcher',
        id: 'tomny-demo',
        target: { kind: 'installed', executable: 'Tomny Demo' },
        origin: 'classifier',
      }),
    ]);
  });

  it('reads the product name of a Tauri configuration', () => {
    const result = cliLauncher.detect(inventoryOf({ 'src-tauri/tauri.conf.json': '{"productName":"Tauri Demo"}' }));

    expect(result.connections).toEqual([expect.objectContaining({ kind: 'launcher', id: 'tauri-demo' })]);
  });

  it('reports a desktop app without a product name instead of inventing one', () => {
    const result = cliLauncher.detect(inventoryOf({ 'electron-builder.yml': 'appId: dev.x\n' }));

    expect(result.connections).toEqual([]);
    expect(result.openItems).toEqual([expect.objectContaining({ kind: 'unrecognized' })]);
  });

  it('reports a Godot project as needing the editor', () => {
    const result = cliLauncher.detect(inventoryOf({ 'project.godot': '[application]' }));

    expect(result.connections).toEqual([]);
    expect(result.openItems).toEqual([
      expect.objectContaining({ kind: 'needs-runtime', path: 'source/project.godot' }),
    ]);
  });

  it('leaves the bin of an MCP server package to the MCP connection and says why', () => {
    const result = cliLauncher.detect(
      inventoryOf({
        'package.json': JSON.stringify({
          name: 'srv',
          version: '1.0.0',
          bin: { srv: 'cli.js' },
          dependencies: { '@modelcontextprotocol/sdk': '1' },
        }),
      })
    );

    expect(result.connections).toEqual([]);
    expect(result.reasons).toEqual([expect.stringContaining('máy chủ MCP')]);
  });

  it('gives a second package with the same bin name a unique id', () => {
    const result = cliLauncher.detect(
      inventoryOf({
        'a/package.json': JSON.stringify({ name: 'a', private: true, bin: { tool: 'x.js' } }),
        'b/package.json': JSON.stringify({ name: 'b', private: true, bin: { tool: 'y.js' } }),
      })
    );

    expect(result.connections.map((connection) => connection.id).toSorted()).toEqual(['tool', 'tool-2']);
  });
});
