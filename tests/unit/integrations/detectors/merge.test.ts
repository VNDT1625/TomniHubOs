import { describe, expect, it } from 'vitest';
import { parseAdapterDocument, type AdapterConnection, type AdapterOpenItem } from '@/common/packages/adapter';
import {
  createInventory,
  defaultHash,
  detectAll,
  detectors,
  detectWith,
  isHighSignalDeclaration,
  mergeResults,
  pickArchetypeLabel,
  type Detector,
  type DetectorResult,
  type RepoInventory,
} from '@/common/integrations/detectors';
import { MAX_TOTAL_CHARS } from '@/common/integrations/detectors/inventory';

const inventoryOf = (texts: Readonly<Record<string, string>> = {}, extraFiles: readonly string[] = []): RepoInventory =>
  createInventory({ files: [...Object.keys(texts), ...extraFiles], readText: (path) => texts[path] });

const result = (partial: Partial<DetectorResult>): DetectorResult => ({
  connections: [],
  openItems: [],
  reasons: [],
  claimed: [],
  ...partial,
});

const detector = (id: string, partial: Partial<DetectorResult>): Detector => ({
  id,
  version: 1,
  detect: () => result(partial),
});

const npxMcp = (id: string, extra: Partial<AdapterConnection> = {}): AdapterConnection =>
  ({ kind: 'mcp', id, title: id, command: 'npx', args: ['-y', `${id}-mcp`], ...extra }) as AdapterConnection;
const httpMcp = (id: string, extra: Partial<AdapterConnection> = {}): AdapterConnection =>
  ({
    kind: 'mcp',
    transport: 'http',
    id,
    title: id,
    url: `https://mcp.example.com/${id}`,
    ...extra,
  }) as AdapterConnection;
const hook = (id: string, extra: Partial<AdapterConnection> = {}): AdapterConnection =>
  ({
    kind: 'hook',
    id,
    event: 'PreToolUse',
    matcher: 'Bash',
    command: 'echo',
    args: ['hi'],
    ...extra,
  }) as AdapterConnection;
const skill = (path: string, extra: Partial<AdapterConnection> = {}): AdapterConnection =>
  ({ kind: 'skill', path, ...extra }) as AdapterConnection;
const command = (id: string, extra: Partial<AdapterConnection> = {}): AdapterConnection =>
  ({
    kind: 'command',
    id,
    title: id,
    path: `source/commands/${id}.md`,
    format: 'markdown',
    ...extra,
  }) as AdapterConnection;

const ids = (connections: readonly AdapterConnection[]): string[] =>
  connections.map((connection) =>
    'id' in connection ? `${connection.kind}:${connection.id}` : `skill:${connection.path}`
  );

const frontmatter = (name: string): string => `---\nname: ${name}\ndescription: x\n---\nBody`;

describe('merge by key', () => {
  it('keeps the outermost copy of an MCP server declared twice the same way', () => {
    const merged = mergeResults(inventoryOf(), [
      result({ connections: [npxMcp('context7', { plugin: 'source/plugins/a', origin: 'claude-plugin' })] }),
      result({ connections: [npxMcp('context7', { origin: 'mcp-config' })] }),
    ]);
    expect(merged.connections).toHaveLength(1);
    expect(merged.connections[0]).toMatchObject({ id: 'context7', origin: 'mcp-config' });
    expect(merged.connections[0]).not.toHaveProperty('group');
    expect(merged.openItems).toEqual([]);
  });

  it('merges a command by name only inside the same plugin', () => {
    const merged = mergeResults(inventoryOf(), [
      result({
        connections: [
          command('review', { plugin: 'source/plugins/a' }),
          command('review', { plugin: 'source/plugins/a', path: 'source/plugins/a/deeper/review.md' }),
          command('review', { plugin: 'source/plugins/b' }),
        ],
      }),
    ]);
    expect(merged.connections).toHaveLength(2);
    expect(new Set(ids(merged.connections)).size).toBe(2);
    expect(merged.connections.map((connection) => connection.plugin).toSorted()).toEqual([
      'source/plugins/a',
      'source/plugins/b',
    ]);
  });

  it('merges hooks with the same event, matcher, command and args even when their ids differ', () => {
    const merged = mergeResults(inventoryOf(), [
      result({ connections: [hook('one'), hook('two', { matcher: 'Bash' }), hook('three', { command: 'other' })] }),
    ]);
    expect(merged.connections.map((connection) => connection.kind)).toEqual(['hook', 'hook']);
    expect(ids(merged.connections)).toContain('hook:three');
  });

  it('treats an empty, missing or star matcher as the same hook', () => {
    const merged = mergeResults(inventoryOf(), [
      result({
        connections: [hook('a', { matcher: '' }), hook('b', { matcher: '*' }), hook('c', { matcher: undefined })],
      }),
    ]);
    expect(merged.connections).toHaveLength(1);
  });

  it('uses the injected hash for the hook key', () => {
    const calls: string[] = [];
    mergeResults(inventoryOf(), [result({ connections: [hook('a')] })], {
      hash: (text) => {
        calls.push(text);
        return 'h';
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('PreToolUse');
    expect(defaultHash('abc')).toBe(defaultHash('abc'));
    expect(defaultHash('abc')).not.toBe(defaultHash('abd'));
    expect(defaultHash('abc')).toMatch(/^[0-9a-f]{32}$/u);
  });

  it('keeps only the outermost skill when several hosts carry the same skill name', () => {
    const inventory = inventoryOf({
      'skills/find-docs/SKILL.md': frontmatter('find-docs'),
      'plugins/claude/skills/find-docs/SKILL.md': frontmatter('Find-Docs'),
      '.codex/plugins/x/skills/find-docs/SKILL.md': frontmatter('find-docs'),
      'skills/other/SKILL.md': frontmatter('other'),
      'skills/nameless/SKILL.md': '# no frontmatter',
    });
    const merged = mergeResults(inventory, [
      result({
        connections: [
          skill('source/plugins/claude/skills/find-docs'),
          skill('source/skills/find-docs'),
          skill('source/.codex/plugins/x/skills/find-docs'),
          skill('source/skills/other'),
          skill('source/skills/nameless'),
        ],
      }),
    ]);
    expect(ids(merged.connections)).toEqual([
      'skill:source/skills/find-docs',
      'skill:source/skills/nameless',
      'skill:source/skills/other',
    ]);
  });

  it('falls back to the path for a skill without a name in its frontmatter', () => {
    const merged = mergeResults(inventoryOf({ 'a/SKILL.md': '---\ndescription: x\n---\n' }), [
      result({ connections: [skill('source/a'), skill('source/a')] }),
    ]);
    expect(merged.connections).toHaveLength(1);
  });

  it('gives colliding ids of different connections unique ids', () => {
    const merged = mergeResults(inventoryOf(), [
      result({
        connections: [
          hook('format', { command: 'a' }),
          hook('format', { command: 'b' }),
          hook('format', { command: 'c' }),
          hook('format-2', { command: 'd' }),
        ],
      }),
    ]);
    const keys = ids(merged.connections);
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
    expect(() =>
      parseAdapterDocument({ schemaVersion: 1, generatedBy: 'classifier', connections: merged.connections })
    ).not.toThrow();
  });
});

describe('alternative MCP groups', () => {
  const base = [
    npxMcp('context7', { origin: 'mcp-config' }),
    httpMcp('context7', { origin: 'mcp-config', plugin: 'source/plugins/http' }),
    { kind: 'mcp', id: 'context7', title: 'c7', command: 'docker', args: ['run', 'c7'] } as AdapterConnection,
    npxMcp('context7', { cwd: 'source/server', args: ['server.js'] }),
  ];

  it('keeps every different variant in one group, with a choose item, and puts http first', () => {
    const merged = mergeResults(inventoryOf(), [result({ connections: base })]);
    expect(ids(merged.connections)).toEqual([
      'mcp:context7-docker',
      'mcp:context7-http',
      'mcp:context7-npx',
      'mcp:context7-source',
    ]);
    expect(new Set(merged.connections.map((connection) => connection.group))).toEqual(new Set(['mcp-context7']));
    const choose = merged.openItems.filter((item) => item.kind === 'choose');
    expect(choose).toHaveLength(1);
    expect(choose[0]?.connections).toEqual(['context7-http', 'context7-npx', 'context7-source', 'context7-docker']);
    expect(merged.reasons).toContain('preferred: context7-http (nhóm context7)');
  });

  it('produces a document the strict writer accepts', () => {
    const merged = mergeResults(inventoryOf(), [result({ connections: base })]);
    expect(() =>
      parseAdapterDocument({
        schemaVersion: 1,
        generatedBy: 'classifier',
        connections: merged.connections,
        openItems: merged.openItems,
      })
    ).not.toThrow();
  });

  it('prefers sse/http over uvx over docker and leaves a unique variant alone', () => {
    const merged = mergeResults(inventoryOf(), [
      result({
        connections: [
          { kind: 'mcp', id: 'm', title: 'm', command: 'docker', args: ['run'] } as AdapterConnection,
          { kind: 'mcp', id: 'm', title: 'm', command: 'uvx', args: ['pkg'] } as AdapterConnection,
          { kind: 'mcp', transport: 'sse', id: 'm', title: 'm', url: 'https://x.example.com/sse' } as AdapterConnection,
          npxMcp('solo'),
        ],
      }),
    ]);
    const choose = merged.openItems.find((item) => item.kind === 'choose');
    expect(choose?.connections).toEqual(['m-sse', 'm-uvx', 'm-docker']);
    expect(ids(merged.connections)).toContain('mcp:solo');
    expect(merged.connections.find((connection) => 'id' in connection && connection.id === 'solo')).not.toHaveProperty(
      'group'
    );
  });

  it('points an open item about the server at each alternative', () => {
    const merged = mergeResults(inventoryOf(), [
      result({
        connections: base,
        openItems: [{ kind: 'env-value', note: 'key', connection: 'context7', name: 'API_KEY', required: false }],
      }),
    ]);
    const env = merged.openItems.filter((item) => item.kind === 'env-value');
    expect(env.map((item) => item.connection).toSorted()).toEqual([
      'context7-docker',
      'context7-http',
      'context7-npx',
      'context7-source',
    ]);
  });

  it('truncates a very long server name into a valid group id', () => {
    const name = 'a'.repeat(64);
    const merged = mergeResults(inventoryOf(), [result({ connections: [npxMcp(name), httpMcp(name)] })]);
    const group = merged.connections[0]?.group;
    expect(group).toBeDefined();
    expect(group).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/u);
    for (const connection of merged.connections) expect('id' in connection && connection.id.length <= 64).toBe(true);
  });
});

describe('plugin copies for several hosts', () => {
  it('keeps the Claude Code version and adds only what the other hosts have extra', () => {
    const plugin = 'source/plugins/x';
    const merged = mergeResults(inventoryOf(), [
      result({
        connections: [
          httpMcp('x', { plugin, origin: 'claude-plugin' }),
          command('shared', { plugin, origin: 'claude-plugin' }),
        ],
      }),
      result({
        connections: [
          npxMcp('x', { plugin, origin: 'codex-plugin' }),
          command('shared', { plugin, origin: 'codex-plugin', path: 'source/plugins/x/codex/shared.md' }),
          command('codex-only', { plugin, origin: 'codex-plugin' }),
        ],
      }),
      result({ connections: [command('copilot-only', { plugin, origin: 'copilot' })] }),
    ]);
    expect(ids(merged.connections)).toEqual(['command:codex-only', 'command:copilot-only', 'command:shared', 'mcp:x']);
    const mcp = merged.connections.find((connection) => connection.kind === 'mcp');
    expect(mcp).toMatchObject({ transport: 'http', origin: 'claude-plugin' });
    expect(mcp).not.toHaveProperty('group');
    expect(merged.openItems.filter((item) => item.kind === 'choose')).toEqual([]);
    const shared = merged.connections.find((connection) => 'id' in connection && connection.id === 'shared');
    expect(shared).toMatchObject({ origin: 'claude-plugin' });
  });

  it('ranks agent-plugins above codex and codex above copilot and gemini', () => {
    const plugin = 'source/p';
    const merged = mergeResults(inventoryOf(), [
      result({
        connections: [
          command('c', { plugin, origin: 'gemini-extension', title: 'gemini' }),
          command('c', { plugin, origin: 'copilot', title: 'copilot' }),
          command('c', { plugin, origin: 'codex-plugin', title: 'codex' }),
          command('c', { plugin, origin: 'agent-plugins', title: 'agent-plugins' }),
        ],
      }),
    ]);
    expect(merged.connections).toHaveLength(1);
    expect(merged.connections[0]).toMatchObject({ origin: 'agent-plugins' });
  });

  it('does not let a plugin host version drop a differing server from a plain MCP config', () => {
    const merged = mergeResults(inventoryOf(), [
      result({
        connections: [
          npxMcp('svc', { plugin: 'source/p', origin: 'claude-plugin' }),
          httpMcp('svc', { origin: 'mcp-config' }),
        ],
      }),
    ]);
    expect(merged.connections).toHaveLength(2);
    expect(merged.openItems.some((item) => item.kind === 'choose')).toBe(true);
  });
});

describe('criterion C2 (declaration files nobody claimed)', () => {
  const files = {
    '.claude-plugin/plugin.json': '{}',
    '.mcp.json': '{}',
    'package.json': '{}',
    'hooks/hooks.json': '{}',
    'ext/manifest.json': '{"manifest_version":3}',
    'web/manifest.json': '{"start_url":"/"}',
    'README.md': '# hi',
    'skills/a/SKILL.md': '---\nname: a\n---',
  };

  it('turns unclaimed high-signal files into unrecognized open items with a package path', () => {
    const merged = mergeResults(inventoryOf(files), [result({ claimed: ['.mcp.json'] })]);
    const flagged = merged.openItems.filter((item) => item.kind === 'unrecognized').map((item) => item.path);
    expect(flagged.toSorted()).toEqual([
      'source/.claude-plugin/plugin.json',
      'source/ext/manifest.json',
      'source/hooks/hooks.json',
      'source/skills/a/SKILL.md',
    ]);
  });

  it('stays quiet when every high-signal file is claimed, even by different detectors', () => {
    const merged = mergeResults(inventoryOf(files), [
      result({ claimed: ['.claude-plugin/plugin.json', 'hooks/hooks.json'] }),
      result({ claimed: ['.mcp.json', 'ext/manifest.json', 'skills/a/SKILL.md', 'package.json'] }),
    ]);
    expect(merged.openItems).toEqual([]);
  });

  it('never flags package.json or a web manifest, and flags nothing for an empty detector list', () => {
    const merged = mergeResults(inventoryOf({ 'package.json': '{}', 'web/manifest.json': '{}' }), []);
    expect(merged.openItems).toEqual([]);
  });

  it('flags a userscript only when it has the header, and settings.json only when it has hooks', () => {
    expect(isHighSignalDeclaration('a.user.js', '// ==UserScript==\n')).toBe(true);
    expect(isHighSignalDeclaration('a.user.js', 'console.log(1)')).toBe(false);
    expect(isHighSignalDeclaration('.claude/settings.json', '{"hooks":{}}')).toBe(true);
    expect(isHighSignalDeclaration('.claude/settings.json', '{"theme":"dark"}')).toBe(false);
    expect(isHighSignalDeclaration('pyproject.toml', '')).toBe(false);
  });

  it('turns files skipped for size into open items, capped, with a summary line', () => {
    const count = 150;
    const big = 'z'.repeat(256 * 1024);
    const names = Array.from({ length: count }, (_, index) => `d${String(index).padStart(3, '0')}/package.json`);
    const inventory = createInventory({ files: names, readText: () => big });
    const skippedTotal = inventory.overflow.length;
    expect(skippedTotal).toBe(count - Math.floor(MAX_TOTAL_CHARS / big.length));
    const merged = mergeResults(inventory, []);
    const items = merged.openItems.filter((item) => item.note.includes('quá nhiều tệp khai báo'));
    expect(items.some((item) => item.path === `source/${inventory.overflow[0]}`)).toBe(true);
    expect(items.filter((item) => item.path === undefined)).toHaveLength(1);
    expect(items).toHaveLength(21);
  });
});

describe('detectAll', () => {
  it('reports a throwing detector as an unrecognized item and keeps the others', () => {
    const broken: Detector = {
      id: 'broken',
      version: 3,
      detect: () => {
        throw new Error('boom');
      },
    };
    const good = detector('good', { connections: [npxMcp('ok')], reasons: ['found ok'] });
    const report = detectWith(inventoryOf(), [broken, good]);
    expect(ids(report.connections)).toEqual(['mcp:ok']);
    expect(report.reasons).toContain('found ok');
    const item = report.openItems.find((entry) => entry.kind === 'unrecognized');
    expect(item?.note).toContain('broken');
    expect(item?.note).toContain('boom');
    expect(report.detectors).toEqual(['broken@3', 'good@1']);
  });

  it('survives a detector that returns garbage', () => {
    const garbage = { id: 'garbage', version: 1, detect: () => null } as unknown as Detector;
    const sloppy = {
      id: 'sloppy',
      version: 1,
      detect: () => ({ connections: 'nope', reasons: [1, 'ok'] }),
    } as unknown as Detector;
    const report = detectWith(inventoryOf(), [garbage, sloppy]);
    expect(report.connections).toEqual([]);
    expect(report.openItems.map((item) => item.note).join('\n')).toContain('garbage');
    expect(report.reasons).toContain('ok');
  });

  it('runs the registered detectors', () => {
    expect(detectors.map((registered) => registered.id).toSorted()).toEqual([
      'agent-plugins',
      'browser-ext',
      'cli-launcher',
      'commands-agents',
      'gemini',
      'hooks',
      'knowledge-misc',
      'mcp-config',
      'mcp-published',
      'rules',
      'services',
    ]);
    const report = detectAll(inventoryOf({ 'package.json': '{}' }));
    expect(report.connections).toEqual([]);
    expect(report.detectors).toEqual([
      'agent-plugins@1',
      'browser-ext@1',
      'cli-launcher@1',
      'commands-agents@1',
      'gemini@1',
      'hooks@1',
      'knowledge-misc@1',
      'mcp-config@1',
      'mcp-published@1',
      'rules@1',
      'services@1',
    ]);
    expect(report.archetype).toBe('source-only');
  });

  it('turns files a detector claimed without producing anything into open items (criterion C2)', () => {
    const silent = detector('silent', { claimed: ['hooks.json', 'plugin.json'] });
    const report = detectWith(inventoryOf({ 'hooks.json': '{}', 'plugin.json': '{}' }), [silent]);
    expect(report.connections).toEqual([]);
    expect(report.openItems.map((item) => item.path)).toEqual(['source/hooks.json', 'source/plugin.json']);
    expect(report.openItems.every((item) => item.kind === 'unrecognized')).toBe(true);
    const covered = detector('covered', { claimed: ['hooks.json'], connections: [skill('source/s/one')] });
    expect(detectWith(inventoryOf({ 'hooks.json': '{}' }), [covered]).openItems).toEqual([]);
  });

  it('gives the same report for 24 seeded shuffles of the detector order', () => {
    const plugin = 'source/plugins/x';
    const list: Detector[] = [
      detector('a', {
        connections: [
          httpMcp('context7'),
          command('shared', { plugin, origin: 'claude-plugin' }),
          skill('source/s/one'),
        ],
        reasons: ['a'],
        claimed: ['.mcp.json'],
      }),
      detector('b', {
        connections: [npxMcp('context7'), command('shared', { plugin, origin: 'codex-plugin' }), hook('h1')],
        openItems: [{ kind: 'env-value', note: 'k', connection: 'context7', name: 'KEY', required: true }],
        reasons: ['b'],
      }),
      detector('c', {
        connections: [hook('h2'), skill('source/deep/s/one'), httpMcp('context7', { plugin: 'source/p' })],
        claimed: ['plugin.json'],
      }),
      detector('d', {
        connections: [
          { kind: 'mcp', id: 'context7', title: 'c', command: 'docker', args: ['run'] } as AdapterConnection,
          command('only-d', { plugin }),
        ],
        reasons: ['d'],
      }),
      {
        id: 'e',
        version: 2,
        detect: () => {
          throw new Error('e failed');
        },
      },
      detector('f', { connections: [hook('format', { command: 'x' }), hook('format', { command: 'y' })] }),
    ];
    const inventory = inventoryOf({
      'plugin.json': '{}',
      '.mcp.json': '{}',
      's/one/SKILL.md': '---\nname: one\n---',
      'deep/s/one/SKILL.md': '---\nname: one\n---',
    });
    const baseline = detectWith(inventory, list);

    let seed = 20261009;
    const random = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const shuffle = <T>(items: readonly T[]): T[] => {
      const copy = [...items];
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const other = Math.floor(random() * (index + 1));
        [copy[index], copy[other]] = [copy[other] as T, copy[index] as T];
      }
      return copy;
    };
    const seen = new Set<string>();
    for (let round = 0; round < 24; round += 1) {
      const order = shuffle(list);
      seen.add(order.map((entry) => entry.id).join(''));
      expect(detectWith(inventory, order)).toEqual(baseline);
    }
    expect(seen.size).toBeGreaterThan(10);
    // Sanity: the baseline is not trivially empty.
    expect(baseline.connections.length).toBeGreaterThan(5);
    expect(baseline.openItems.some((item) => item.kind === 'choose')).toBe(true);
  });
});

describe('pickArchetypeLabel', () => {
  it('picks the label with the most usable connections', () => {
    expect(pickArchetypeLabel([npxMcp('a'), npxMcp('b'), skill('source/s')])).toBe('mcp-tool-server');
    expect(pickArchetypeLabel([skill('source/s'), command('c'), hook('h'), npxMcp('a')])).toBe('agent-skill');
  });

  it('breaks a tie by the fixed order and ignores an extension that still needs a build', () => {
    expect(pickArchetypeLabel([skill('source/s'), npxMcp('a')])).toBe('mcp-tool-server');
    const unbuilt = {
      kind: 'extension',
      id: 'e',
      title: 'e',
      format: 'chrome-mv3',
      root: 'source',
      permissions: [],
      hostPermissions: [],
      unsupported: [],
      needsBuild: true,
    } as AdapterConnection;
    expect(pickArchetypeLabel([unbuilt])).toBe('source-only');
    expect(pickArchetypeLabel([unbuilt, skill('source/s')])).toBe('agent-skill');
    expect(pickArchetypeLabel([])).toBe('source-only');
  });
});

describe('result hygiene', () => {
  it('sorts connections by key and open items and reasons by content', () => {
    const items: AdapterOpenItem[] = [
      { kind: 'needs-runtime', note: 'z' },
      { kind: 'needs-runtime', note: 'a' },
      { kind: 'needs-runtime', note: 'a' },
    ];
    const merged = mergeResults(inventoryOf(), [
      result({ connections: [npxMcp('zeta'), npxMcp('alpha')], openItems: items, reasons: ['y', 'x', 'x'] }),
    ]);
    expect(ids(merged.connections)).toEqual(['mcp:alpha', 'mcp:zeta']);
    expect(merged.openItems.map((item) => item.note)).toEqual(['a', 'z']);
    expect(merged.reasons).toEqual(['x', 'y']);
  });
});
