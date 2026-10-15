import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectionSchema } from '@/common/packages/adapter/connections';
import { parseAdapterDocument, type AdapterConnection, type AdapterOpenItem } from '@/common/packages/adapter';
import { createInventory, detectWith, type DetectorResult, type RepoInventory } from '@/common/integrations/detectors';
import { agentPlugins } from '@/common/integrations/detectors/agent';

const FIXTURES = path.resolve(__dirname, '../../../fixtures/repotopackage');
const SECRET = 'fixture-secret-do-not-leak-7f3a9c';

const walk = (directory: string, prefix = ''): string[] =>
  fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(directory, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`]
    );

type Fixture = Readonly<{ inventory: RepoInventory; expected: unknown }>;

/** A fixture tree as an inventory; `expected.adapter.json` is the expectation and not part of the repository. */
const loadFixture = (name: string): Fixture => {
  const root = path.join(FIXTURES, name);
  const files = walk(root).filter((file) => file !== 'expected.adapter.json');
  return {
    inventory: createInventory({ files, readText: (file) => fs.readFileSync(path.join(root, file), 'utf8') }),
    expected: JSON.parse(fs.readFileSync(path.join(root, 'expected.adapter.json'), 'utf8')) as unknown,
  };
};

const inventoryOf = (texts: Readonly<Record<string, string>>, extraFiles: readonly string[] = []): RepoInventory =>
  createInventory({ files: [...Object.keys(texts), ...extraFiles], readText: (file) => texts[file] });

const detect = (texts: Readonly<Record<string, string>>, extraFiles: readonly string[] = []): DetectorResult =>
  agentPlugins.detect(inventoryOf(texts, extraFiles));

const json = (value: unknown): string => JSON.stringify(value);
const claudeManifest = json({ name: 'demo' });
const skillText = (name: string): string => `---\nname: ${name}\ndescription: x\n---\nBody`;

type Found = Readonly<{ connections: readonly AdapterConnection[]; openItems: readonly AdapterOpenItem[] }>;

const kinds = (result: Found): string[] => result.connections.map((connection) => connection.kind);
const countKinds = (result: Found): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const kind of kinds(result)) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
};
const items = (result: Found, kind: AdapterOpenItem['kind']): AdapterOpenItem[] =>
  result.openItems.filter((item) => item.kind === kind);
const connectionsOf = (result: Found, kind: AdapterConnection['kind']): AdapterConnection[] =>
  result.connections.filter((connection) => connection.kind === kind);
type McpConnection = AdapterConnection & { kind: 'mcp' };
const mcpOf = (result: Found): McpConnection[] => {
  const found: McpConnection[] = [];
  for (const connection of result.connections) if (connection.kind === 'mcp') found.push(connection);
  return found;
};
const notes = (result: Found): string => result.openItems.map((item) => item.note).join('\n');

const asDocument = (merged: { connections: unknown; openItems: unknown; detectors: unknown }): unknown =>
  parseAdapterDocument({
    schemaVersion: 1,
    generatedBy: 'classifier',
    connections: merged.connections,
    openItems: merged.openItems,
    detectors: merged.detectors,
  });

describe('agent-plugins detector contract', () => {
  it('has the id and version from the design', () => {
    expect(agentPlugins.id).toBe('agent-plugins');
    expect(agentPlugins.version).toBe(1);
  });

  it('finds nothing in a repository without plugins', () => {
    const result = detect({ 'package.json': '{}', 'README.md': 'x' });
    expect(result).toEqual({ connections: [], openItems: [], reasons: [], claimed: [] });
  });

  it('is deterministic and does not depend on the order files are listed in', () => {
    const { inventory } = loadFixture('claude-plugin-full');
    const reversed = createInventory({
      files: [...inventory.files].toReversed(),
      readText: (file) => inventory.text(file),
    });
    expect(agentPlugins.detect(inventory)).toEqual(agentPlugins.detect(inventory));
    expect(agentPlugins.detect(reversed)).toEqual(agentPlugins.detect(inventory));
  });

  it('asks the inventory only for files of the tree', () => {
    const { inventory } = loadFixture('multi-host-plugin');
    const asked: string[] = [];
    agentPlugins.detect({
      ...inventory,
      text: (file) => {
        asked.push(file);
        return inventory.text(file);
      },
    });
    expect(asked.length).toBeGreaterThan(0);
    for (const file of asked) expect(inventory.files).toContain(file);
  });
});

describe('fixture multi-host-plugin (upstash/context7 layout)', () => {
  const { inventory, expected } = loadFixture('multi-host-plugin');
  const raw = agentPlugins.detect(inventory);

  it('finds a plugin folder for each host and labels connections with the host that declared them', () => {
    const plugins = new Map(raw.connections.map((connection) => [connection.plugin, connection.origin]));
    expect(Object.fromEntries(plugins)).toEqual({
      'source/plugins/claude/context7': 'claude-plugin',
      'source/plugins/codex/context7': 'codex-plugin',
      'source/plugins/copilot/context7': 'copilot',
      'source/plugins/agent-plugins/context7': 'agent-plugins',
      'source/plugins/antigravity/context7': 'agent-plugins',
    });
  });

  it('yields an http MCP from the Claude plugin and a skill for each of the other hosts', () => {
    const claudeMcp = raw.connections.filter(
      (connection) => connection.kind === 'mcp' && connection.plugin === 'source/plugins/claude/context7'
    );
    expect(claudeMcp).toHaveLength(1);
    expect(claudeMcp[0]).toMatchObject({
      transport: 'http',
      id: 'context7',
      url: 'https://mcp.context7.com/mcp',
      headers: [{ name: 'Authorization', fromEnv: 'CONTEXT7_API_KEY' }],
    });

    const skillOrigins = connectionsOf(raw, 'skill').map((connection) => connection.origin);
    expect(skillOrigins.toSorted()).toEqual(['agent-plugins', 'agent-plugins', 'codex-plugin', 'copilot']);
    expect(connectionsOf(raw, 'skill').map((connection) => 'path' in connection && connection.path)).toContain(
      'source/plugins/antigravity/context7/skills/context7-mcp'
    );
  });

  it('reads a streamable-http server as http and the serverUrl alias', () => {
    const urls = mcpOf(raw).map((connection) =>
      'url' in connection ? `${connection.transport}:${connection.origin}` : 'stdio'
    );
    expect(urls.toSorted()).toEqual([
      'http:agent-plugins',
      'http:agent-plugins',
      'http:claude-plugin',
      'http:copilot',
      'stdio',
    ]);
  });

  it('reports a plugin in another repository without fetching it', () => {
    expect(notes(raw)).toContain('Plugin "remote-helper" nằm ở repo khác (github.com/example-org/remote-helper)');
    expect(raw.connections.every((connection) => connection.plugin?.startsWith('source/plugins/'))).toBe(true);
  });

  it('claims the plugin and marketplace files but not the Gemini extension', () => {
    expect(raw.claimed).toEqual(
      expect.arrayContaining([
        '.agents/plugins/marketplace.json',
        '.claude-plugin/marketplace.json',
        '.github/plugin/marketplace.json',
        'plugins/agent-plugins/context7/plugin.json',
        'plugins/antigravity/context7/mcp_config.json',
        'plugins/claude/context7/.claude-plugin/plugin.json',
        'plugins/claude/context7/.mcp.json',
        'plugins/codex/context7/.codex-plugin/plugin.json',
        'plugins/codex/context7/skills/context7-mcp/SKILL.md',
        'plugins/copilot/context7/plugin.json',
      ])
    );
    expect(raw.claimed).not.toContain('gemini-extension.json');
  });

  it('after the merge keeps one copy of the skill and groups the MCP servers that really differ', () => {
    const merged = detectWith(inventory, [agentPlugins]);
    expect(connectionsOf(merged, 'skill')).toHaveLength(1);
    const mcp = connectionsOf(merged, 'mcp');
    expect(mcp.map((connection) => 'id' in connection && connection.id)).toEqual(['context7-http', 'context7-npx']);
    expect(mcp.every((connection) => connection.group === 'mcp-context7')).toBe(true);
    expect(mcp[0]).toMatchObject({ transport: 'http', origin: 'claude-plugin' });
    expect(mcp[1]).toMatchObject({ command: 'npx', args: ['-y', '@upstash/context7-mcp'], origin: 'codex-plugin' });
    expect(items(merged, 'choose')).toEqual([
      expect.objectContaining({ connections: ['context7-http', 'context7-npx'] }),
    ]);
    expect(merged.reasons).toContain('preferred: context7-http (nhóm context7)');
  });

  it('leaves the Gemini extension file to the merge, which reports it as unclaimed (C2)', () => {
    const merged = detectWith(inventory, [agentPlugins]);
    expect(merged.openItems).toContainEqual({
      kind: 'unrecognized',
      note: 'Tệp khai báo chưa có bộ nhận diện nào xử lý',
      path: 'source/gemini-extension.json',
    });
    const claimedByAnyone = new Set(raw.claimed);
    const unclaimed = inventory.files.filter(
      (file) =>
        /(?:^|\/)(?:plugin|marketplace|gemini-extension|\.mcp|mcp|mcp_config)\.json$/u.test(file) &&
        !claimedByAnyone.has(file)
    );
    expect(unclaimed).toEqual(['gemini-extension.json']);
  });

  it('matches expected.adapter.json and is a valid adapter document', () => {
    const merged = detectWith(inventory, [agentPlugins]);
    expect(asDocument(merged)).toEqual(expected);
    expect(parseAdapterDocument(expected)).toBeTruthy();
  });
});

describe('fixture claude-plugin-full', () => {
  const { inventory, expected } = loadFixture('claude-plugin-full');
  const result = agentPlugins.detect(inventory);

  it('produces every kind of connection the layout allows', () => {
    expect(countKinds(result)).toEqual({
      skill: 2,
      command: 2,
      agent: 1,
      hook: 3,
      mcp: 3,
      cli: 1,
    });
    expect(
      result.connections.every((connection) => connection.origin === 'claude-plugin' && connection.plugin === 'source')
    ).toBe(true);
  });

  it('reads command and agent front matter without granting tools', () => {
    expect(connectionsOf(result, 'command')).toContainEqual(
      expect.objectContaining({
        id: 'deploy',
        path: 'source/commands/deploy.md',
        format: 'markdown',
        description: 'Deploy the current branch',
        argumentHint: '[environment]',
      })
    );
    expect(connectionsOf(result, 'command').map((connection) => 'id' in connection && connection.id)).toContain(
      'tools-lint'
    );
    expect(connectionsOf(result, 'agent')).toEqual([
      expect.objectContaining({
        id: 'reviewer',
        format: 'claude-md',
        tools: ['Read', 'Grep', 'Glob'],
        model: 'sonnet',
      }),
    ]);
    expect(JSON.stringify(connectionsOf(result, 'command'))).not.toContain('allowed-tools');
  });

  it('turns each hook handler into a connection and the unsupported ones into open items', () => {
    const hooks = connectionsOf(result, 'hook');
    expect(hooks).toContainEqual(
      expect.objectContaining({
        event: 'PostToolUse',
        matcher: 'Write|Edit',
        command: '${CLAUDE_PLUGIN_ROOT}/scripts/format.sh',
        timeoutSec: 30,
      })
    );
    expect(hooks).toContainEqual(
      expect.objectContaining({
        event: 'PreToolUse',
        command: 'python',
        args: ['${CLAUDE_PLUGIN_ROOT}/scripts/guard.py'],
      })
    );
    const ids = hooks.map((connection) => 'id' in connection && connection.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => typeof id === 'string' && /^[a-z]+-\d+-[0-9a-f]{8}$/u.test(id))).toBe(true);

    const runtime = items(result, 'needs-runtime').map((item) => item.note);
    expect(runtime.some((note) => note.includes('"FutureEvent"'))).toBe(true);
    expect(runtime.some((note) => note.includes('hooks.Stop[0]'))).toBe(true);
    const preCompact = hooks.find((connection) => connection.kind === 'hook' && connection.event === 'PreCompact');
    expect(preCompact).toBeDefined();
    // One grouped note for the whole event, not one per hook.
    expect(runtime.filter((note) => note.includes('"PreCompact"'))).toHaveLength(1);
  });

  it('reads stdio and http MCP servers and refuses a command outside the allowed list', () => {
    const mcp = connectionsOf(result, 'mcp');
    expect(mcp).toContainEqual(
      expect.objectContaining({
        id: 'local-tool',
        command: 'node',
        args: ['dist/index.js'],
        cwd: 'source',
        setup: [['npm', 'install']],
        env: [
          { name: 'API_TOKEN', required: true },
          { name: 'LOG_LEVEL', required: false },
        ],
      })
    );
    expect(mcp).toContainEqual(expect.objectContaining({ id: 'search', command: 'uvx', args: ['demo-search-mcp'] }));
    expect(mcp).toContainEqual(
      expect.objectContaining({ id: 'docs', transport: 'http', url: 'https://docs.example.com/mcp' })
    );
    expect(mcp.some((connection) => 'id' in connection && connection.id === 'custom')).toBe(false);
    expect(notes(result)).toContain('MCP "custom": lệnh không thuộc danh sách cho phép');
  });

  it('flags a server that runs from source when the built file is missing', () => {
    expect(items(result, 'needs-runtime')).toContainEqual(
      expect.objectContaining({ connection: 'local-tool', note: expect.stringContaining('dist/index.js') })
    );
  });

  it('turns bin files into CLIs that run from source', () => {
    // A bin script runs as node from the plugin folder; a bin file that is not a script needs a runtime.
    expect(connectionsOf(result, 'cli')).toEqual([
      expect.objectContaining({
        id: 'statusline.mjs',
        command: 'node',
        args: ['bin/statusline.mjs'],
        source: 'source',
        cwd: 'source',
        display: 'terminal',
      }),
    ]);
    expect(items(result, 'needs-runtime').map((item) => item.note)).toEqual(
      expect.arrayContaining([expect.stringContaining('Lệnh bin helper.sh'), expect.stringContaining('Lệnh bin tool')])
    );
  });

  it('names the components Tomny cannot run and the sensitive user settings', () => {
    const runtime = items(result, 'needs-runtime').map((item) => item.note);
    for (const kind of ['lspServers', 'monitors', 'outputStyles']) {
      expect(runtime.some((note) => note.includes(`khai báo ${kind}`))).toBe(true);
    }
    expect(items(result, 'env-value')).toContainEqual(
      expect.objectContaining({ name: 'API_TOKEN', required: true, path: 'source/.claude-plugin/plugin.json' })
    );
    expect(items(result, 'env-value').some((item) => item.name === 'REGION')).toBe(false);
  });

  it('claims every declaration file it handled, so nothing is left for C2', () => {
    expect(result.claimed).toEqual(
      expect.arrayContaining([
        '.claude-plugin/plugin.json',
        '.mcp.json',
        'hooks/hooks.json',
        'skills/review-code/SKILL.md',
        'skills/write-docs/SKILL.md',
        'commands/deploy.md',
        'commands/tools/lint.md',
        'agents/reviewer.md',
      ])
    );
    const merged = detectWith(inventory, [agentPlugins]);
    expect(merged.openItems.filter((item) => item.note.includes('chưa có bộ nhận diện'))).toEqual([]);
  });

  it('writes no literal header or environment value anywhere in the result', () => {
    const merged = detectWith(inventory, [agentPlugins]);
    const everything = JSON.stringify([result, merged]);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain('"info"');
    expect(inventory.text('.mcp.json')).toContain(SECRET);
  });

  it('matches expected.adapter.json and is a valid adapter document', () => {
    const merged = detectWith(inventory, [agentPlugins]);
    expect(asDocument(merged)).toEqual(expected);
    expect(merged.archetype).toBe('agent-skill');
    for (const connection of result.connections) expect(connectionSchema.safeParse(connection).success).toBe(true);
  });
});

describe('plugin discovery', () => {
  it('uses the manifest to choose the host and prefers Claude over Codex over agent-plugins over Copilot', () => {
    const result = detect({
      'both/.claude-plugin/plugin.json': claudeManifest,
      'both/.codex-plugin/plugin.json': claudeManifest,
      'both/skills/a/SKILL.md': skillText('a'),
      'codex/.codex-plugin/plugin.json': claudeManifest,
      'codex/skills/b/SKILL.md': skillText('b'),
      'agent/plugin.json': json({ $schema: 'https://agent-plugins.org/schema/plugin.json' }),
      'agent/skills/c/SKILL.md': skillText('c'),
      'copilot/.github/plugin/plugin.json': claudeManifest,
      'copilot/skills/d/SKILL.md': skillText('d'),
    });
    const origins = Object.fromEntries(result.connections.map((connection) => [connection.plugin, connection.origin]));
    expect(origins).toEqual({
      'source/both': 'claude-plugin',
      'source/codex': 'codex-plugin',
      'source/agent': 'agent-plugins',
      'source/copilot': 'copilot',
    });
  });

  it('takes the host from the marketplace location when the folder has no manifest', () => {
    const result = detect({
      '.agents/plugins/marketplace.json': json({
        plugins: [{ name: 'x', source: { source: 'local', path: './p/x' } }],
      }),
      'p/x/skills/s/SKILL.md': skillText('s'),
    });
    expect(result.connections).toEqual([
      { kind: 'skill', path: 'source/p/x/skills/s', plugin: 'source/p/x', origin: 'codex-plugin' },
    ]);
  });

  it('accepts a marketplace source of "./" for a plugin at the repository root', () => {
    const result = detect({
      '.claude-plugin/marketplace.json': json({ plugins: [{ name: 'root', source: './' }] }),
      'skills/s/SKILL.md': skillText('s'),
    });
    expect(result.connections).toEqual([
      { kind: 'skill', path: 'source/skills/s', plugin: 'source', origin: 'claude-plugin' },
    ]);
  });

  it('reads components declared inline in a marketplace entry', () => {
    const result = detect({
      '.claude-plugin/marketplace.json': json({
        plugins: [
          {
            name: 'inline',
            source: './p',
            mcpServers: { docs: { type: 'http', url: 'https://docs.example.com/mcp' } },
          },
        ],
      }),
      'p/readme.txt': 'x',
    });
    expect(connectionsOf(result, 'mcp')).toEqual([
      expect.objectContaining({ id: 'docs', plugin: 'source/p', origin: 'claude-plugin' }),
    ]);
  });

  it('does not treat a plain plugin.json without the agent-plugins.org schema as a plugin', () => {
    const result = detect({
      'tool/plugin.json': json({ name: 'x', $schema: 'https://example.com/schema.json' }),
      'tool/skills/s/SKILL.md': skillText('s'),
      'other/plugin.json': json({ $schema: 'https://agent-plugins.org.evil.example/plugin.json' }),
    });
    expect(result.connections).toEqual([]);
    expect(items(result, 'unrecognized')).toHaveLength(2);
    expect(result.claimed).toEqual(['other/plugin.json', 'tool/plugin.json']);
  });

  it('reads every plugin folder of a marketplace listed in more than one location only once', () => {
    const result = detect({
      '.claude-plugin/marketplace.json': json({ plugins: [{ name: 'a', source: './p/a' }] }),
      '.github/plugin/marketplace.json': json({ plugins: [{ name: 'a', source: './p/a' }] }),
      'p/a/skills/s/SKILL.md': skillText('s'),
    });
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]?.origin).toBe('claude-plugin');
  });
});

describe('plugins in another repository and unsafe paths', () => {
  const marketplace = (sources: readonly unknown[]): string =>
    json({ plugins: sources.map((source, index) => ({ name: `p${index}`, source })) });

  it('reports a plugin from github, a URL, npm or a bare repository name, with credentials and queries removed', () => {
    const result = detect({
      '.claude-plugin/marketplace.json': marketplace([
        { source: 'github', repo: 'org/repo' },
        { source: 'url', url: `https://user:${SECRET}@git.example.com/org/repo.git?token=${SECRET}#frag` },
        { source: 'git-subdir', url: 'https://git.example.com/org/mono.git', path: 'plugins/x' },
        { source: 'npm', package: '@org/plugin' },
        'org/repo',
        'github.com/org/repo',
        'git@git.example.com:org/repo.git',
      ]),
    });
    expect(result.connections).toEqual([]);
    const text = notes(result);
    expect(text).toContain('github.com/org/repo');
    expect(text).toContain('https://git.example.com/org/repo.git');
    expect(text).toContain('https://git.example.com/org/mono.git (plugins/x)');
    expect(text).toContain('npm:@org/plugin');
    expect(text).toContain('git.example.com/org/repo.git');
    expect(items(result, 'unrecognized')).toHaveLength(7);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain('frag');
  });

  it.each([
    './../outside',
    './a/../../b',
    '../outside',
    '/etc/passwd',
    'C:\\Windows',
    './a\\b',
    './bad:name',
    './dir/..',
    { source: 'local', path: '../x' },
    { source: 'local', path: '/abs' },
    { source: 'local', path: 'a/../../x' },
  ])('rejects the unsafe source %j', (source) => {
    const result = detect({
      '.claude-plugin/marketplace.json': marketplace([source]),
      'outside/skills/s/SKILL.md': skillText('s'),
      'x/skills/s/SKILL.md': skillText('s'),
      'a/skills/s/SKILL.md': skillText('s'),
    });
    expect(result.connections).toEqual([]);
    expect(items(result, 'unrecognized')).toEqual([
      expect.objectContaining({ note: expect.stringContaining('không an toàn') }),
    ]);
  });

  it('requires the plugin folder to be in the inventory', () => {
    const result = detect({
      '.claude-plugin/marketplace.json': marketplace(['./missing', './present']),
      'present/skills/s/SKILL.md': skillText('s'),
    });
    expect(connectionsOf(result, 'skill')).toHaveLength(1);
    expect(notes(result)).toContain('thư mục nguồn không có trong repo');
  });

  it('rejects a path that a manifest key names outside the plugin', () => {
    const result = detect({
      'p/.claude-plugin/plugin.json': json({
        skills: ['../other', '/abs', './ok'],
        commands: '..',
        mcpServers: '../x.json',
      }),
      'p/ok/s/SKILL.md': skillText('s'),
      'other/s/SKILL.md': skillText('o'),
    });
    expect(connectionsOf(result, 'skill')).toEqual([expect.objectContaining({ path: 'source/p/ok/s' })]);
    expect(items(result, 'unrecognized').length).toBeGreaterThanOrEqual(4);
  });
});

describe('broken input', () => {
  it('reports broken JSON with its path and does not throw', () => {
    const texts = {
      'a/.claude-plugin/plugin.json': '{ not json',
      'b/.claude-plugin/plugin.json': claudeManifest,
      'b/.mcp.json': '[1, 2',
      'b/hooks/hooks.json': '',
      'c/plugin.json': '{',
      '.claude-plugin/marketplace.json': 'null',
      '.github/plugin/marketplace.json': '{"plugins": 5}',
      '.agents/plugins/marketplace.json': '{"plugins": ["x", {"name": "n"}, {"name": "m", "source": 7}]}',
    };
    const result = detect(texts);
    expect(result.connections).toEqual([]);
    const paths = items(result, 'unrecognized').map((item) => item.path);
    for (const file of [
      'a/.claude-plugin/plugin.json',
      'b/.mcp.json',
      'b/hooks/hooks.json',
      'c/plugin.json',
      '.claude-plugin/marketplace.json',
      '.github/plugin/marketplace.json',
    ]) {
      expect(paths).toContain(`source/${file}`);
    }
    expect(result.claimed).toContain('a/.claude-plugin/plugin.json');
  });

  it('reports a declaration file with no text (too large) as unrecognized', () => {
    const inventory = createInventory({
      files: ['.claude-plugin/plugin.json', '.mcp.json', 'skills/s/SKILL.md'],
      readText: (file) => (file === '.claude-plugin/plugin.json' ? claudeManifest : undefined),
    });
    const result = agentPlugins.detect(inventory);
    expect(connectionsOf(result, 'skill')).toHaveLength(1);
    expect(items(result, 'unrecognized')).toEqual([
      expect.objectContaining({ path: 'source/.mcp.json', note: expect.stringContaining('không đọc được') }),
    ]);
  });

  it('survives hostile object keys and shapes', () => {
    const result = detect({
      'p/.claude-plugin/plugin.json': '{"__proto__": {"skills": "x"}, "constructor": 1, "mcpServers": []}',
      'p/.mcp.json': '{"mcpServers": {"__proto__": {"command": "npx", "args": ["-y", "x"]}, "ok": 1}}',
      'p/hooks/hooks.json': '{"hooks": {"PreToolUse": "no", "__proto__": []}}',
    });
    expect(Array.isArray(result.connections)).toBe(true);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('never throws when the inventory itself misbehaves', () => {
    const inventory = createInventory({ files: ['.claude-plugin/plugin.json'], readText: () => claudeManifest });
    const hostile: RepoInventory = {
      ...inventory,
      text: () => {
        throw new Error('boom');
      },
    };
    const result = agentPlugins.detect(hostile);
    expect(result.connections).toEqual([]);
    expect(items(result, 'unrecognized')).toHaveLength(1);
  });
});

describe('components named by a manifest', () => {
  it('adds the folders and files the manifest names to the defaults', () => {
    const result = detect({
      'p/.claude-plugin/plugin.json': json({
        skills: './extra-skills',
        commands: ['./prompts/one.md', './more-commands'],
        agents: './team',
        hooks: './config/hooks.json',
        mcpServers: './config/mcp.json',
      }),
      'p/skills/a/SKILL.md': skillText('a'),
      'p/extra-skills/b/SKILL.md': skillText('b'),
      'p/prompts/one.md': '---\ndescription: One\n---\n',
      'p/more-commands/two.md': 'Two',
      'p/team/lead.agent.md': '---\ndescription: Lead\n---\n',
      'p/config/hooks.json': json({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo', args: ['hi'] }] }] },
      }),
      'p/config/mcp.json': json({ mcpServers: { s: { type: 'sse', url: 'https://s.example.com/sse' } } }),
    });
    expect(
      connectionsOf(result, 'skill')
        .map((connection) => 'path' in connection && connection.path)
        .toSorted()
    ).toEqual(['source/p/extra-skills/b', 'source/p/skills/a']);
    expect(
      connectionsOf(result, 'command')
        .map((connection) => 'id' in connection && connection.id)
        .toSorted()
    ).toEqual(['one', 'two']);
    expect(connectionsOf(result, 'agent')).toEqual([expect.objectContaining({ id: 'lead', format: 'copilot-agent' })]);
    expect(connectionsOf(result, 'hook')).toEqual([expect.objectContaining({ event: 'SessionStart', args: ['hi'] })]);
    expect(connectionsOf(result, 'mcp')).toEqual([expect.objectContaining({ id: 's', transport: 'sse' })]);
  });

  it('accepts hooks and servers written inline in the manifest', () => {
    const result = detect({
      'p/.claude-plugin/plugin.json': json({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo' }] }] },
        mcpServers: { inline: { command: 'uvx', args: ['pkg'] } },
      }),
    });
    expect(kinds(result).toSorted()).toEqual(['hook', 'mcp']);
    expect(result.claimed).toEqual(['p/.claude-plugin/plugin.json']);
  });

  it('reports a manifest path that does not exist', () => {
    const result = detect({
      'p/.claude-plugin/plugin.json': json({ mcpServers: './gone.json', hooks: './gone-hooks.json' }),
    });
    expect(items(result, 'unrecognized')).toHaveLength(2);
  });

  it('treats a skills path that is itself a skill folder as one skill', () => {
    const result = detect({
      'p/.claude-plugin/plugin.json': json({ skills: './only' }),
      'p/only/SKILL.md': skillText('only'),
    });
    expect(connectionsOf(result, 'skill')).toEqual([expect.objectContaining({ path: 'source/p/only' })]);
  });

  it('emits a skill once even when two plugin folders reach it', () => {
    const result = detect({
      '.claude-plugin/plugin.json': json({ skills: './plugins/x/skills' }),
      'plugins/x/.claude-plugin/plugin.json': claudeManifest,
      'plugins/x/skills/s/SKILL.md': skillText('s'),
    });
    expect(connectionsOf(result, 'skill')).toHaveLength(1);
  });

  it('makes ids unique inside a plugin', () => {
    const result = detect({
      'p/.claude-plugin/plugin.json': claudeManifest,
      'p/commands/a/b.md': 'x',
      'p/commands/a-b.md': 'y',
    });
    expect(
      connectionsOf(result, 'command')
        .map((connection) => 'id' in connection && connection.id)
        .toSorted()
    ).toEqual(['a-b', 'a-b-2']);
  });
});

describe('MCP servers', () => {
  const mcp = (servers: unknown, extra: Readonly<Record<string, string>> = {}): DetectorResult =>
    detect({ 'p/.claude-plugin/plugin.json': claudeManifest, 'p/.mcp.json': json({ mcpServers: servers }), ...extra });

  it('reads http, sse and the aliases of http', () => {
    const result = mcp({
      a: { type: 'http', url: 'https://a.example.com/mcp' },
      b: { type: 'sse', url: 'https://b.example.com/sse' },
      c: { type: 'streamable_http', url: 'https://c.example.com/mcp' },
      d: { url: 'https://d.example.com/mcp' },
      e: { httpUrl: 'https://e.example.com/mcp' },
    });
    expect(
      mcpOf(result).map((connection) => ('url' in connection ? `${connection.id}:${connection.transport}` : ''))
    ).toEqual(['a:http', 'b:sse', 'c:http', 'd:http', 'e:http']);
  });

  it('refuses an http URL, a URL with credentials or a secret-looking query, and a URL with a placeholder', () => {
    const result = mcp({
      plain: { type: 'http', url: 'http://a.example.com/mcp' },
      userinfo: { type: 'http', url: `https://me:${SECRET}@a.example.com/mcp` },
      query: { type: 'http', url: `https://a.example.com/mcp?apiKey=${SECRET}` },
      placeholder: { type: 'http', url: 'https://${HOST}/mcp' },
      websocket: { type: 'ws', url: 'wss://a.example.com' },
      empty: {},
    });
    expect(result.connections).toEqual([]);
    expect(items(result, 'unrecognized')).toHaveLength(6);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('keeps a harmless query string', () => {
    const result = mcp({ a: { type: 'http', url: 'https://a.example.com/mcp?tools=search,fetch' } });
    expect(connectionsOf(result, 'mcp')).toEqual([
      expect.objectContaining({ url: 'https://a.example.com/mcp?tools=search,fetch' }),
    ]);
  });

  it('keeps only the variable name of a header and asks for its value', () => {
    const result = mcp({
      exact: { type: 'http', url: 'https://a.example.com/mcp', headers: { 'X-Key': '${EXACT_KEY}', Other: '$BARE' } },
      prefix: { type: 'http', url: 'https://a.example.com/mcp', headers: { Authorization: `Bearer \${PREFIX_KEY}` } },
      literal: { type: 'http', url: 'https://a.example.com/mcp', headers: { Authorization: `Bearer ${SECRET}` } },
      config: { type: 'http', url: 'https://a.example.com/mcp', headers: { 'X-Token': '${user_config.api_token}' } },
      many: { type: 'http', url: 'https://a.example.com/mcp', headers: { 'X-Many': '${A_ONE}:${A_TWO}' } },
      bad: { type: 'http', url: 'https://a.example.com/mcp', headers: { 'Bad Name': 'x', Fine: 'y' } },
    });
    const headers = Object.fromEntries(
      mcpOf(result).map((connection) => [connection.id, 'headers' in connection ? connection.headers : undefined])
    );
    expect(headers).toEqual({
      exact: [
        { name: 'X-Key', fromEnv: 'EXACT_KEY' },
        { name: 'Other', fromEnv: 'BARE' },
      ],
      prefix: [{ name: 'Authorization', fromEnv: 'PREFIX_KEY' }],
      literal: [{ name: 'Authorization', fromEnv: 'LITERAL_AUTHORIZATION' }],
      config: [{ name: 'X-Token', fromEnv: 'API_TOKEN' }],
      many: [{ name: 'X-Many', fromEnv: 'MANY_X_MANY' }],
      bad: [{ name: 'Fine', fromEnv: 'BAD_FINE' }],
    });
    expect(
      items(result, 'env-value')
        .map((item) => item.name)
        .toSorted()
    ).toEqual(['API_TOKEN', 'BAD_FINE', 'BARE', 'EXACT_KEY', 'LITERAL_AUTHORIZATION', 'MANY_X_MANY', 'PREFIX_KEY']);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(items(result, 'env-value').find((item) => item.name === 'PREFIX_KEY')?.note).toContain('giá trị đầy đủ');
  });

  it('never copies an environment value', () => {
    const result = mcp({
      s: { command: 'npx', args: ['-y', 'pkg'], env: { API_KEY: SECRET, TOKEN: '${TOKEN}', lower: 'x', EMPTY: '' } },
    });
    expect(connectionsOf(result, 'mcp')).toEqual([
      expect.objectContaining({
        env: [
          { name: 'API_KEY', required: false },
          { name: 'TOKEN', required: true },
          { name: 'EMPTY', required: true },
        ],
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(notes(result)).toContain('1 biến môi trường có tên không hợp lệ');
  });

  it('accepts only the commands the adapter allows and arguments that pass its pattern', () => {
    const result = mcp({
      npx: { command: 'npx', args: ['-y', 'pkg'] },
      sh: { command: 'sh', args: ['-c', `echo ${SECRET}`] },
      path: { command: '/usr/bin/node', args: ['x.js'] },
      flag: { command: 'npx', args: ['-y', 'pkg', `--token=${SECRET}`] },
      noargs: { command: 'npx' },
      text: { command: 'npx', args: 'oops' },
      docker: { command: 'docker', args: ['run', '-i', '--rm', 'image'] },
      dockerVolume: { command: 'docker', args: ['run', '-v', '/:/host', 'image'] },
    });
    expect(connectionsOf(result, 'mcp').map((connection) => 'id' in connection && connection.id)).toEqual([
      'npx',
      'docker',
    ]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(items(result, 'unrecognized')).toHaveLength(6);
  });

  it('runs a server from the plugin source when its arguments use the plugin root', () => {
    const present = mcp(
      { s: { command: 'python', args: ['${CLAUDE_PLUGIN_ROOT}/server/main.py'] } },
      { 'p/server/main.py': 'print(1)' }
    );
    expect(connectionsOf(present, 'mcp')).toEqual([
      expect.objectContaining({ command: 'python', args: ['server/main.py'], cwd: 'source/p' }),
    ]);
    expect(connectionsOf(present, 'mcp')[0]).not.toHaveProperty('setup');
    expect(items(present, 'needs-runtime')).toEqual([]);

    const missing = mcp(
      { s: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/index.js'] } },
      { 'p/package.json': '{}' }
    );
    expect(connectionsOf(missing, 'mcp')).toEqual([
      expect.objectContaining({ args: ['dist/index.js'], cwd: 'source/p', setup: [['npm', 'install']] }),
    ]);
    expect(items(missing, 'needs-runtime')).toEqual([expect.objectContaining({ connection: 's' })]);

    const escaping = mcp({ s: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/../outside.js'] } });
    expect(escaping.connections).toEqual([]);
  });

  it('reads a bare map of servers and the "servers" wrapper', () => {
    const bare = detect({
      'p/.claude-plugin/plugin.json': claudeManifest,
      'p/.mcp.json': json({ a: { command: 'npx', args: ['-y', 'a'] } }),
    });
    const wrapped = detect({
      'p/.claude-plugin/plugin.json': claudeManifest,
      'p/mcp.json': json({ servers: { b: { command: 'uvx', args: ['b'] } } }),
    });
    expect(connectionsOf(bare, 'mcp')).toHaveLength(1);
    expect(connectionsOf(wrapped, 'mcp')).toHaveLength(1);
  });

  it('keeps the first of a server declared in two files of one plugin', () => {
    const result = detect({
      'p/.claude-plugin/plugin.json': claudeManifest,
      'p/.mcp.json': json({ mcpServers: { s: { command: 'npx', args: ['-y', 'a'] } } }),
      'p/mcp.json': json({ mcpServers: { s: { command: 'npx', args: ['-y', 'b'] } } }),
    });
    expect(connectionsOf(result, 'mcp')).toEqual([expect.objectContaining({ args: ['-y', 'a'] })]);
  });
});

describe('hooks', () => {
  const hooks = (value: unknown): DetectorResult =>
    detect({ 'p/.claude-plugin/plugin.json': claudeManifest, 'p/hooks/hooks.json': json({ hooks: value }) });

  it('gives each handler a stable id made of the event, its position and a short hash', () => {
    const value = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            { type: 'command', command: 'one' },
            { type: 'command', command: 'two', args: [], timeout: 5 },
          ],
        },
      ],
    };
    const first = hooks(value);
    const ids = connectionsOf(first, 'hook').map((connection) => 'id' in connection && connection.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^pretooluse-0-[0-9a-f]{8}$/u);
    expect(ids[1]).toMatch(/^pretooluse-1-[0-9a-f]{8}$/u);
    expect(hooks(value)).toEqual(first);
    expect(connectionsOf(first, 'hook')[1]).toMatchObject({ args: [], timeoutSec: 5 });
    expect(connectionsOf(first, 'hook')[0]).not.toHaveProperty('timeoutSec');
  });

  it('keeps a hook for an event Tomny does not fire, switched off with a reason', () => {
    const result = hooks({ SubagentStop: [{ hooks: [{ type: 'command', command: 'x' }] }] });
    expect(connectionsOf(result, 'hook')).toHaveLength(1);
    expect(items(result, 'needs-runtime')).toEqual([
      expect.objectContaining({ kind: 'needs-runtime', note: expect.stringContaining('"SubagentStop"') }),
    ]);
  });

  it('reports other handler types, unknown events and malformed groups', () => {
    const result = hooks({
      PreToolUse: [{ hooks: [{ type: 'http', url: 'https://x.example.com' }, { type: 'agent' }, { type: 'command' }] }],
      Whatever: [],
      PostToolUse: 'nope',
    });
    expect(result.connections).toEqual([]);
    expect(items(result, 'needs-runtime')).toHaveLength(3);
    expect(items(result, 'unrecognized').length).toBeGreaterThanOrEqual(2);
  });

  it('writes nothing for an event name that could carry a value', () => {
    const result = hooks({ [`Bad ${'x'.repeat(100)}`]: [] });
    expect(notes(result).length).toBeLessThan(300);
  });
});

describe('user settings', () => {
  it('turns only sensitive options into variables, upper-casing the key', () => {
    const result = detect({
      'p/.claude-plugin/plugin.json': json({
        userConfig: {
          api_token: { sensitive: true, required: true, default: SECRET },
          'second-key': { sensitive: true },
          '9digits': { sensitive: true },
          visible: { description: 'x' },
        },
      }),
    });
    expect(items(result, 'env-value').map((item) => [item.name, item.required])).toEqual([
      ['API_TOKEN', true],
      ['SECOND_KEY', false],
      ['X_9DIGITS', false],
    ]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
