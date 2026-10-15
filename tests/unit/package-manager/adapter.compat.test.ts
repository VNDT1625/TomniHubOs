import { describe, expect, it } from 'vitest';
import {
  parseAdapterDocument,
  readAdapterDocument,
  serializeAdapterDocument,
} from '../../../packages/desktop/src/common/packages';

const mcp = { kind: 'mcp', id: 'context7', title: 'Context7', command: 'npx', args: ['-y', '@upstash/context7-mcp'] };
const skill = { kind: 'skill', path: 'source/skills/find-docs' };
const document = (connections: unknown[], extra: Record<string, unknown> = {}): unknown => ({
  schemaVersion: 1,
  generatedBy: 'classifier',
  connections,
  ...extra,
});

describe('reading an adapter written by another version', () => {
  it('ignores a field it does not know, in the document and in a connection, without reporting an error', () => {
    const { document: read, issues } = readAdapterDocument(
      document([{ ...mcp, futureOption: { a: 1 } }, skill], { futureDocumentField: [{ kind: 'x' }] })
    );
    expect(issues).toEqual([]);
    expect(read.connections).toEqual([mcp, skill]);
    expect(Object.keys(read.connections[0] ?? {})).not.toContain('futureOption');
  });

  it('reads open items, skips a kind it does not know and drops a broken one on its own', () => {
    const { document: read, issues } = readAdapterDocument(
      document([mcp], {
        openItems: [
          { kind: 'env-value', connection: 'context7', name: 'API_KEY', note: 'Needs a value', futureField: 1 },
          { kind: 'teleport', note: 'from a newer version' },
          { kind: 'unrecognized', path: '../outside', note: 'bad path' },
          { kind: 'choose', note: 'Pick one', options: ['a', 'b'] },
        ],
      })
    );
    expect(read.openItems?.map((item) => item.kind)).toEqual(['env-value', 'choose']);
    expect(issues.map((issue) => [issue.index, issue.reason])).toEqual([
      [1, 'unknown-kind'],
      [2, 'invalid'],
    ]);
    expect(Object.keys(read.openItems?.[0] ?? {})).not.toContain('futureField');
  });

  it('skips a connection kind it does not know and keeps the rest', () => {
    const { document: read, issues } = readAdapterDocument(
      document([{ kind: 'hologram', id: 'x', anything: true }, mcp, skill])
    );
    expect(read.connections).toEqual([mcp, skill]);
    expect(issues).toEqual([expect.objectContaining({ index: 0, kind: 'hologram', reason: 'unknown-kind' })]);
  });

  it('drops one broken connection on its own, and never keeps a connection that fails the writer’s checks', () => {
    const { document: read, issues } = readAdapterDocument(
      document([{ kind: 'skill', path: '../../outside' }, { ...mcp, args: ['-y', 'a; rm -rf /'] }, skill])
    );
    expect(read.connections).toEqual([skill]);
    expect(issues.map((issue) => [issue.index, issue.reason])).toEqual([
      [0, 'invalid'],
      [1, 'invalid'],
    ]);
  });

  it('does not treat a missing or empty list of connections as an error', () => {
    for (const raw of [document([]), { schemaVersion: 1 }, { schemaVersion: 1, connections: 'nope' }]) {
      const { document: read, issues } = readAdapterDocument(raw);
      expect(read.connections).toEqual([]);
      expect(issues).toEqual([]);
    }
  });

  it('reads a newer schema version as an empty adapter with a reason, and never throws', () => {
    const { document: read, issues } = readAdapterDocument(document([mcp], { schemaVersion: 2 }));
    expect(read.connections).toEqual([]);
    expect(issues).toEqual([expect.objectContaining({ index: -1, reason: 'newer-version' })]);
    for (const garbage of [null, 'text', 7, []]) {
      expect(() => readAdapterDocument(garbage)).not.toThrow();
      expect(readAdapterDocument(garbage).issues[0]?.reason).toBe('unreadable');
    }
  });

  it('keeps the first of two identical connections and treats an unknown author as the least trusted', () => {
    const { document: read, issues } = readAdapterDocument(document([mcp, mcp], { generatedBy: 'someone-new' }));
    expect(read.connections).toEqual([mcp]);
    expect(issues).toEqual([expect.objectContaining({ index: 1, reason: 'duplicate' })]);
    expect(read.generatedBy).toBe('agent');
  });

  it('still lets the writer be strict, and what the reader returns can be written back', () => {
    expect(() => parseAdapterDocument(document([{ ...mcp, futureOption: 1 }]))).toThrow();
    const { document: read } = readAdapterDocument(document([{ ...mcp, futureOption: 1 }, skill]));
    expect(parseAdapterDocument(JSON.parse(serializeAdapterDocument(read)))).toEqual(read);
  });

  it('applies the same limits to the fields it knows inside a tolerant read', () => {
    const service = { id: 'web', cwd: 'source/apps/web', start: ['bash', '-c', 'x'], ready: { port: 3000 } };
    const web = { kind: 'web-embed', id: 'w', title: 'W', process: { services: [service], embed: { service: 'web' } } };
    expect(readAdapterDocument(document([web])).document.connections).toEqual([]);
    const fine = {
      ...web,
      process: { services: [{ ...service, start: ['npm', 'run', 'dev'], extra: 1 }], embed: { service: 'web' } },
    };
    expect(readAdapterDocument(document([fine])).document.connections).toHaveLength(1);
  });
});

/** The seven kinds a reader from before repotopackage v2 knew; its KNOWN_KINDS, frozen here. */
const OLD_KINDS: ReadonlySet<string> = new Set(['mcp', 'skill', 'tool', 'cli', 'web-embed', 'launcher', 'bridge']);

/** One connection of each old kind, exactly as an old writer produced it (no transport, no common fields). */
const OLD_CONNECTIONS: Record<string, unknown>[] = [
  { ...mcp, env: [{ name: 'CONTEXT7_API_KEY', required: false, hint: 'context7.com/dashboard' }] },
  skill,
  { kind: 'tool', id: 'translate', title: 'Translate', command: 'python', args: ['main.py'] },
  { kind: 'cli', id: 'ctx7', title: 'ctx7', command: 'npx', args: ['-y', 'ctx7'], display: 'terminal' },
  { kind: 'web-embed', id: 'facebook', title: 'Facebook', url: 'https://www.facebook.com' },
  {
    kind: 'launcher',
    id: 'blender',
    title: 'Blender',
    target: { kind: 'installed', executable: 'blender.exe', downloadUrl: 'https://www.blender.org/download' },
    mcp: { command: 'uvx', args: ['blender-mcp'] },
  },
  {
    kind: 'bridge',
    id: 'panel',
    title: 'Panel',
    ui: 'adapter/ui.json',
    bridge: 'adapter/bridge.js',
    backend: { command: 'python', args: ['server.py'] },
  },
];

const NEWER_CONNECTIONS: Record<string, unknown>[] = [
  {
    kind: 'hook',
    id: 'format',
    event: 'PostToolUse',
    command: 'echo',
    timeoutSec: 30,
    plugin: 'source/plugins/a',
    origin: 'claude-plugin',
  },
  { kind: 'command', id: 'review', title: 'Review', path: 'source/c.md', format: 'markdown' },
  {
    kind: 'mcp',
    transport: 'http',
    id: 'remote',
    title: 'Remote',
    url: 'https://mcp.example.com',
    headers: [{ name: 'Authorization', fromEnv: 'TOKEN' }],
  },
];

/**
 * What a reader from before repotopackage v2 would keep of a document: only the seven kinds it knew, and an `mcp`
 * only when it has the `command` its schema required. The real old reader is not importable, so this is its
 * contract written out; the point is that the new reader keeps at least what the old one kept, unchanged.
 */
const keptByOldReader = (connections: readonly Record<string, unknown>[]): Record<string, unknown>[] =>
  connections.filter(
    (connection) =>
      OLD_KINDS.has(String(connection.kind)) &&
      (connection.kind !== 'mcp' || ['npx', 'uvx'].includes(String(connection.command)))
  );

describe('reading across repotopackage v2', () => {
  it('reads a document of only the old seven kinds exactly as before: same connections, nothing added', () => {
    const { document: read, issues } = readAdapterDocument(document(OLD_CONNECTIONS));
    expect(issues).toEqual([]);
    expect(read).toEqual({ schemaVersion: 1, generatedBy: 'classifier', connections: OLD_CONNECTIONS });
    // No default is written back: an old mcp has no transport, an old document has no provenance or detectors.
    expect(Object.keys(read.connections[0] ?? {})).not.toContain('transport');
    expect(Object.keys(read)).toEqual(['schemaVersion', 'generatedBy', 'connections']);
    expect(JSON.parse(serializeAdapterDocument(read))).toEqual(read);
  });

  it('keeps every old connection, in order, when newer kinds are mixed in', () => {
    const mixed = [NEWER_CONNECTIONS[0], OLD_CONNECTIONS[0], NEWER_CONNECTIONS[2], ...OLD_CONNECTIONS.slice(1)];
    const { document: read, issues } = readAdapterDocument(document(mixed as unknown[]));
    expect(issues).toEqual([]);
    expect(
      read.connections.filter((connection) => OLD_KINDS.has(connection.kind) && connection.kind !== 'mcp')
    ).toEqual(OLD_CONNECTIONS.filter((connection) => connection.kind !== 'mcp'));
    expect(read.connections.map((connection) => connection.kind)).toEqual(mixed.map((connection) => connection?.kind));
  });

  it('lets a reader that knows only the seven old kinds keep the old connections of a new document', () => {
    const mixed = [NEWER_CONNECTIONS[0], ...OLD_CONNECTIONS.slice(0, 3), NEWER_CONNECTIONS[1], NEWER_CONNECTIONS[2]];
    const newRead = readAdapterDocument(document(mixed as unknown[])).document;
    const simulated = readAdapterDocument(document(keptByOldReader(mixed as Record<string, unknown>[])));
    expect(simulated.issues).toEqual([]);
    expect(simulated.document.connections).toEqual(OLD_CONNECTIONS.slice(0, 3));
    for (const connection of simulated.document.connections) {
      expect(newRead.connections).toContainEqual(connection);
    }
    // The connections the old reader cannot understand are exactly the ones it must drop, none of the old ones.
    const dropped = mixed.filter((connection) => !keptByOldReader([connection as Record<string, unknown>]).length);
    expect(dropped.map((connection) => (connection as Record<string, unknown>).kind)).toEqual([
      'hook',
      'command',
      'mcp',
    ]);
  });

  it('skips a kind this build does not know by name, then reads the same names once they are known', () => {
    const { document: read, issues } = readAdapterDocument(
      document([{ kind: 'hologram', id: 'x' }, ...NEWER_CONNECTIONS])
    );
    expect(read.connections.map((connection) => connection.kind)).toEqual(['hook', 'command', 'mcp']);
    expect(issues).toEqual([expect.objectContaining({ index: 0, kind: 'hologram', reason: 'unknown-kind' })]);
  });

  it('drops only the connection that is wrong, for each new kind, and reports its position', () => {
    const wrong: Record<string, unknown>[] = [
      { ...NEWER_CONNECTIONS[0], command: 'x'.repeat(501) },
      { ...NEWER_CONNECTIONS[0], id: 'h2', timeoutSec: 601 },
      { ...NEWER_CONNECTIONS[1], id: 'c2', path: '../c.md' },
      { kind: 'agent', id: 'a', title: 'A', path: 'source/a.md', format: 'unknown-format' },
      { ...NEWER_CONNECTIONS[2], id: 'r2', url: 'http://mcp.example.com' },
      { ...NEWER_CONNECTIONS[2], id: 'r3', headers: [{ name: 'Authorization', value: 'Bearer abc' }] },
      {
        ...NEWER_CONNECTIONS[2],
        id: 'r4',
        headers: [{ name: 'Authorization', fromEnv: 'TOKEN', value: 'Bearer abc' }],
      },
    ];
    const items = [skill, ...wrong, NEWER_CONNECTIONS[1], NEWER_CONNECTIONS[0]];
    const { document: read, issues } = readAdapterDocument(document(items));
    expect(read.connections.map((connection) => connection.kind)).toEqual(['skill', 'command', 'hook']);
    expect(issues.every((issue) => issue.reason === 'invalid')).toBe(true);
    expect(issues.map((issue) => issue.kind)).toEqual(['hook', 'hook', 'command', 'agent', 'mcp', 'mcp', 'mcp']);
  });

  it('refuses a header value in a tolerant read instead of stripping it', () => {
    const header = { name: 'Authorization', fromEnv: 'TOKEN', value: 'Bearer abc' };
    const remote = { ...NEWER_CONNECTIONS[2], headers: [header] };
    const { document: read, issues } = readAdapterDocument(document([remote, skill]));
    expect(read.connections).toEqual([skill]);
    expect(issues).toEqual([expect.objectContaining({ index: 0, kind: 'mcp', reason: 'invalid' })]);
  });

  it('keeps a remote mcp that has no command, and ignores a field it does not know on a new kind', () => {
    const remote = NEWER_CONNECTIONS[2];
    const { document: read, issues } = readAdapterDocument(
      document([
        { ...remote, futureOption: 1 },
        { ...NEWER_CONNECTIONS[0], futureOption: 1 },
      ])
    );
    expect(issues).toEqual([]);
    expect(read.connections).toEqual([remote, NEWER_CONNECTIONS[0]]);
  });

  it('reports a duplicate of a new kind and keeps the first', () => {
    const hook = NEWER_CONNECTIONS[0];
    const { document: read, issues } = readAdapterDocument(document([hook, { ...hook, command: 'other' }, skill]));
    expect(read.connections).toEqual([hook, skill]);
    expect(issues).toEqual([expect.objectContaining({ index: 1, kind: 'hook', reason: 'duplicate' })]);
  });

  it('reads the new open item kinds, and an older reader would skip them as unknown kinds', () => {
    const items = [
      { kind: 'needs-build', path: 'source/ext', note: 'Build first' },
      { kind: 'needs-consent', connection: 'x', note: 'Broad access' },
      { kind: 'choose', note: 'Pick', connections: ['a', 'b'], futureField: 1 },
      { kind: 'needs-build', path: '../x', note: 'bad path' },
    ];
    const { document: read, issues } = readAdapterDocument(document([], { openItems: items }));
    expect(read.openItems?.map((item) => item.kind)).toEqual(['needs-build', 'needs-consent', 'choose']);
    expect(read.openItems?.[2]?.connections).toEqual(['a', 'b']);
    expect(issues.map((issue) => [issue.index, issue.reason])).toEqual([[3, 'invalid']]);
  });

  it('reads provenance and detectors, and drops a malformed one without losing the connections', () => {
    const provenance = {
      kind: 'git',
      url: 'https://github.com/o/r',
      commit: 'b'.repeat(40),
      packagedAt: 5,
      futureField: 1,
    };
    const good = readAdapterDocument(document([skill], { provenance, detectors: ['skill-md@1'] }));
    expect(good.issues).toEqual([]);
    expect(good.document.provenance).toEqual({
      kind: 'git',
      url: 'https://github.com/o/r',
      commit: 'b'.repeat(40),
      packagedAt: 5,
    });
    expect(good.document.detectors).toEqual(['skill-md@1']);
    const bad = readAdapterDocument(
      document([skill], { provenance: { kind: 'git', commit: 'zz', packagedAt: 5 }, detectors: 'nope' })
    );
    expect(bad.document.connections).toEqual([skill]);
    expect(bad.document.provenance).toBeUndefined();
    expect(bad.document.detectors).toBeUndefined();
    expect(bad.issues.map((issue) => [issue.index, issue.kind, issue.reason])).toEqual([
      [-1, 'provenance', 'invalid'],
      [-1, 'detectors', 'invalid'],
    ]);
  });

  it('reads at most 128 connections and says so', () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ kind: 'skill', path: `source/s${i}` }));
    const { document: read, issues } = readAdapterDocument(document(many));
    expect(read.connections).toHaveLength(128);
    expect(issues).toEqual([expect.objectContaining({ index: 128, reason: 'invalid' })]);
  });
});
