import { describe, expect, it } from 'vitest';
import { parseAdapterDocument } from '@/common/packages/adapter';
import {
  findMcpServerSignals,
  mcpConnectionFromRecipe,
  mcpPublished,
  npmLaunchRecipe,
  pythonLaunchRecipe,
} from '@/common/integrations/detectors/agent/mcpPublished';
import { inventoryOf } from './mcpFixtures';

const server = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: '@acme/weather-mcp',
    version: '1.2.3',
    description: 'Weather tools',
    bin: { 'weather-mcp': 'dist/index.js' },
    dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
    ...extra,
  });

const run = (texts: Record<string, string>) => mcpPublished.detect(inventoryOf(texts));

describe('mcp-published: recipes', () => {
  it('pins an npm package and refuses unpublishable ones', () => {
    expect(npmLaunchRecipe(server())).toEqual({
      command: 'npx',
      args: ['-y', '@acme/weather-mcp@1.2.3'],
      packageName: '@acme/weather-mcp',
    });
    for (const bad of [
      server({ private: true }),
      server({ bin: undefined }),
      server({ bin: {} }),
      server({ version: 'latest' }),
      server({ name: 'Bad Name' }),
      'not json',
      '[]',
    ]) {
      expect(npmLaunchRecipe(bad)).toBeUndefined();
    }
  });

  it('reads a Python project with scripts', () => {
    const toml = '[project]\nname = "weather-mcp"\nversion = "0.4.1"\n\n[project.scripts]\nweather-mcp = "w:main"\n';
    expect(pythonLaunchRecipe(toml)).toEqual({
      command: 'uvx',
      args: ['weather-mcp==0.4.1'],
      packageName: 'weather-mcp',
    });
    expect(pythonLaunchRecipe(toml.replace('[project.scripts]', '[tool.x]'))).toBeUndefined();
    expect(pythonLaunchRecipe(toml.replace('0.4.1', '1.0; rm -rf'))).toBeUndefined();
  });
});

describe('mcp-published: detector', () => {
  it('is a versioned detector', () => {
    expect(mcpPublished.id).toBe('mcp-published');
    expect(mcpPublished.version).toBe(1);
  });

  it('emits an npx connection for a package that depends on the MCP SDK', () => {
    const result = run({ 'package.json': server() });
    expect(result.connections).toEqual([
      {
        kind: 'mcp',
        id: 'weather-mcp',
        title: '@acme/weather-mcp',
        description: 'Weather tools',
        command: 'npx',
        args: ['-y', '@acme/weather-mcp@1.2.3'],
        origin: 'package-json',
      },
    ]);
    expect(result.claimed).toEqual(['package.json']);
    expect(
      parseAdapterDocument({ schemaVersion: 1, generatedBy: 'classifier', connections: result.connections })
    ).toBeDefined();
  });

  it('emits a uvx connection for a Python server', () => {
    const result = run({
      'pyproject.toml':
        '[project]\nname = "weather-mcp"\nversion = "0.4.1"\ndescription = "Weather"\ndependencies = ["mcp>=1.0"]\n\n[project.scripts]\nweather-mcp = "w:main"\n',
    });
    expect(result.connections).toEqual([
      expect.objectContaining({ command: 'uvx', args: ['weather-mcp==0.4.1'], origin: 'pyproject' }),
    ]);
  });

  it('ignores a command line tool that does not speak MCP', () => {
    const result = run({ 'package.json': server({ dependencies: {} }) });
    expect(result).toEqual({ connections: [], openItems: [], reasons: [], claimed: [] });
  });

  it('reports an MCP package that cannot be published as it is', () => {
    const result = run({ 'package.json': server({ private: true }) });
    expect(result.connections).toEqual([]);
    expect(result.openItems).toEqual([expect.objectContaining({ kind: 'unrecognized', path: 'source/package.json' })]);
    expect(result.claimed).toEqual(['package.json']);
  });

  it('finds workspace packages up to three folders deep, in a stable order', () => {
    const texts = {
      'packages/b/package.json': server({ name: 'b-mcp' }),
      'packages/a/package.json': server({ name: 'a-mcp' }),
      'a/b/c/d/package.json': server({ name: 'too-deep-mcp' }),
    };
    const result = run(texts);
    expect(result.connections.map((connection) => connection.kind === 'mcp' && connection.id)).toEqual([
      'a-mcp',
      'b-mcp',
    ]);
    expect(run(Object.fromEntries(Object.entries(texts).toReversed()))).toEqual(result);
  });

  it('keeps one connection per id and caps the number of servers', () => {
    const texts: Record<string, string> = {};
    for (let index = 0; index < 12; index += 1) texts[`p/s${index}/package.json`] = server({ name: `srv-${index}` });
    texts['q/package.json'] = server({ name: 'srv-0' });
    const result = run(texts);
    expect(result.connections).toHaveLength(8);
    expect(result.openItems.length).toBeGreaterThan(0);
  });

  it('survives hostile metadata', () => {
    for (const text of ['', '{', '\u0000', '"x"', server({ description: 7 })]) {
      expect(() => run({ 'package.json': text })).not.toThrow();
    }
  });
});

describe('mcp-published: classifier helpers', () => {
  it('keeps the signals the classifier branch used', () => {
    const base = { files: [] as string[], dependencies: new Set<string>(), snippets: {} };
    expect(findMcpServerSignals(base).isMcpServer).toBe(false);
    expect(findMcpServerSignals({ ...base, files: ['MCP.json'] })).toMatchObject({
      isMcpServer: true,
      hasMcpJson: true,
    });
    expect(findMcpServerSignals({ ...base, files: ['a/mcp.json'] }).hasMcpJson).toBe(true);
    expect(findMcpServerSignals({ ...base, files: ['.mcp.json'] }).isMcpServer).toBe(false);
    expect(findMcpServerSignals({ ...base, dependencies: new Set(['@modelcontextprotocol/sdk']) }).reasons).toEqual([
      'Detected @modelcontextprotocol/sdk in dependencies',
    ]);
    expect(findMcpServerSignals({ ...base, snippets: { 'a.py': 'srv = Server("x")' } }).isMcpServer).toBe(true);
  });

  it('builds the connection the classifier used to build', () => {
    expect(
      mcpConnectionFromRecipe(
        { command: 'npx', args: ['-y', 'w@1.0.0'], packageName: 'w' },
        { id: 'w', title: 'W'.repeat(200), description: 'd'.repeat(2000) }
      )
    ).toEqual({
      kind: 'mcp',
      id: 'w',
      title: 'W'.repeat(120),
      description: 'd'.repeat(1000),
      command: 'npx',
      args: ['-y', 'w@1.0.0'],
    });
  });
});
