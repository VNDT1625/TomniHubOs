import { describe, expect, it } from 'vitest';
import {
  ADAPTER_CONNECTION_KINDS,
  ADAPTER_INSTALLABLE_KINDS,
  adapterFromManifest,
  connectionNotInstallableReason,
  isInstallableConnection,
  parseAdapterDocument,
  serializeAdapterDocument,
  type AdapterDocument,
} from '../../../packages/desktop/src/common/packages';

const document = (connections: unknown[]): unknown => ({ schemaVersion: 1, generatedBy: 'classifier', connections });
const mcp = { kind: 'mcp', id: 'context7', title: 'Context7', command: 'npx', args: ['-y', '@upstash/context7-mcp'] };

describe('adapter.json', () => {
  it('accepts every connection kind and round-trips through serialization', () => {
    const parsed = parseAdapterDocument(
      document([
        { ...mcp, env: [{ name: 'CONTEXT7_API_KEY', required: false, hint: 'context7.com/dashboard' }] },
        { kind: 'skill', path: 'source/skills/find-docs' },
        { kind: 'cli', id: 'ctx7', title: 'ctx7', command: 'npx', args: ['-y', 'ctx7'], display: 'terminal' },
        { kind: 'tool', id: 'translate', title: 'Translate', command: 'python', args: ['main.py'] },
        { kind: 'web-embed', id: 'facebook', title: 'Facebook', url: 'https://www.facebook.com' },
        {
          kind: 'web-embed',
          id: 'ui',
          title: 'UI',
          process: {
            services: [
              {
                id: 'web',
                cwd: 'source',
                setup: [['npm', 'install']],
                start: ['npm', 'run', 'dev'],
                ready: { port: 3000 },
                env: [{ name: 'API_URL', required: true }],
              },
            ],
            embed: { service: 'web', path: '/' },
          },
        },
        {
          kind: 'launcher',
          id: 'blender',
          title: 'Blender',
          target: { kind: 'installed', executable: 'blender.exe', downloadUrl: 'https://www.blender.org/download' },
          mcp: { command: 'uvx', args: ['blender-mcp'] },
        },
        {
          kind: 'launcher',
          id: 'tiny',
          title: 'Tiny',
          target: { kind: 'source', command: 'python', args: ['source/app.py'] },
        },
        {
          kind: 'bridge',
          id: 'panel',
          title: 'Panel',
          ui: 'adapter/ui.json',
          bridge: 'adapter/bridge.js',
          backend: { command: 'python', args: ['server.py'] },
        },
      ])
    );
    expect(parsed.connections).toHaveLength(9);
    expect(parseAdapterDocument(JSON.parse(serializeAdapterDocument(parsed)))).toEqual(parsed);
  });

  it('refuses paths that leave source/ and adapter/', () => {
    for (const bad of ['../x', 'source/../x', '/etc/passwd', 'C:/x', 'source\\x', 'other/x', 'source//x']) {
      expect(() => parseAdapterDocument(document([{ kind: 'skill', path: bad }]))).toThrow();
    }
  });

  it('refuses launch arguments that carry shell syntax and commands that are not a single token', () => {
    expect(() => parseAdapterDocument(document([{ ...mcp, args: ['-y', 'a; rm -rf /'] }]))).toThrow();
    expect(() => parseAdapterDocument(document([{ ...mcp, command: 'bash' }]))).toThrow();
    expect(() =>
      parseAdapterDocument(document([{ kind: 'cli', id: 'x', title: 'x', command: 'rm -rf', display: 'terminal' }]))
    ).toThrow();
  });

  it('never lets a launcher name a folder: an installed app is a file name the user binds locally', () => {
    const launcher = (target: unknown) => document([{ kind: 'launcher', id: 'x', title: 'X', target }]);
    for (const executable of [
      'C:/Windows/cmd.exe',
      ['a', 'b.exe'].join(String.fromCharCode(92)),
      '../cmd.exe',
      '/usr/bin/sh',
      'a/b.exe',
      '.exe',
    ]) {
      expect(() => parseAdapterDocument(launcher({ kind: 'installed', executable }))).toThrow();
    }
    expect(() => parseAdapterDocument(launcher({ kind: 'installed', executable: 'blender.exe' }))).not.toThrow();
    expect(() =>
      parseAdapterDocument(launcher({ kind: 'installed', executable: 'blender.exe', path: 'C:/x' }))
    ).toThrow();
    expect(() => parseAdapterDocument(launcher(undefined))).toThrow();
  });

  it('needs exactly one of url or process for web-embed, and https only', () => {
    const base = { kind: 'web-embed', id: 'w', title: 'W' };
    expect(() => parseAdapterDocument(document([base]))).toThrow();
    expect(() =>
      parseAdapterDocument(
        document([
          {
            ...base,
            url: 'https://a.example',
            process: {
              services: [
                {
                  id: 'web',
                  cwd: 'source',
                  setup: [['npm', 'install']],
                  start: ['npm', 'run', 'dev'],
                  ready: { port: 3000 },
                  env: [{ name: 'API_URL', required: true }],
                },
              ],
              embed: { service: 'web', path: '/' },
            },
          },
        ])
      )
    ).toThrow();
    expect(() => parseAdapterDocument(document([{ ...base, url: 'http://a.example' }]))).toThrow();
  });

  it('only starts known programs from a folder inside source/, with the embedded service among them', () => {
    const embed = (process: unknown) => document([{ kind: 'web-embed', id: 'w', title: 'W', process }]);
    const service = { id: 'web', cwd: 'source/apps/web', start: ['npm', 'run', 'dev'], ready: { port: 3000 } };
    const ok = { services: [service], embed: { service: 'web' } };
    expect(() => parseAdapterDocument(embed(ok))).not.toThrow();
    for (const bad of [
      { ...ok, services: [{ ...service, start: ['bash', '-c', 'x'] }] },
      { ...ok, services: [{ ...service, start: ['npm', 'run', 'dev; rm -rf /'] }] },
      { ...ok, services: [{ ...service, cwd: '../elsewhere' }] },
      { ...ok, services: [{ ...service, ready: { port: 80 } }] },
      { ...ok, embed: { service: 'missing' } },
      { ...ok, embed: { service: 'web', path: 'no-slash' } },
      { services: [], embed: { service: 'web' } },
    ]) {
      expect(() => parseAdapterDocument(embed(bad))).toThrow();
    }
  });

  it('accepts open items the writer produces and refuses malformed ones', () => {
    const base = { schemaVersion: 1, generatedBy: 'classifier', connections: [] };
    const ok = [
      { kind: 'env-value', connection: 'web', name: 'DATABASE_URL', note: 'Needs a value' },
      { kind: 'unrecognized', path: 'source/apps/worker', note: 'Has a Dockerfile' },
      { kind: 'needs-runtime', connection: 'web', note: 'Waiting for a runtime' },
      { kind: 'choose', note: 'Pick one', options: ['a', 'b'] },
    ];
    expect(parseAdapterDocument({ ...base, openItems: ok }).openItems).toHaveLength(4);
    for (const bad of [
      { kind: 'env-value', note: '' },
      { kind: 'env-value', name: 'lower', note: 'x' },
      { kind: 'unrecognized', path: '../x', note: 'x' },
      { kind: 'other', note: 'x' },
      { kind: 'choose', note: 'x', extra: 1 },
    ]) {
      expect(() => parseAdapterDocument({ ...base, openItems: [bad] })).toThrow();
    }
  });

  it('refuses unknown fields, duplicate connections and a wrong schema version', () => {
    expect(() => parseAdapterDocument(document([{ ...mcp, extra: 1 }]))).toThrow();
    expect(() => parseAdapterDocument(document([mcp, mcp]))).toThrow();
    expect(() => parseAdapterDocument({ ...(document([]) as object), schemaVersion: 2 })).toThrow();
    expect(() =>
      parseAdapterDocument(
        document([
          { kind: 'skill', path: 'source/a' },
          { kind: 'skill', path: 'source/a' },
        ])
      )
    ).toThrow();
  });

  it('says which kinds this version installs and why the others stay off', () => {
    const parsed = parseAdapterDocument(
      document([
        mcp,
        { kind: 'launcher', id: 'blender', title: 'Blender', target: { kind: 'installed', executable: 'blender.exe' } },
      ])
    ) as AdapterDocument;
    expect(parsed.connections.map(isInstallableConnection)).toEqual([true, true]);
    expect(connectionNotInstallableReason(parsed.connections[0])).toBeUndefined();
    expect(connectionNotInstallableReason(parsed.connections[1])).toBeUndefined();
  });

  it('builds the adapter of a package that predates the standard layout from its manifest', () => {
    const adapter = adapterFromManifest({
      contributions: {
        version: 1,
        mcpServers: [
          {
            id: 'rea-agents',
            title: 'Rea Agents',
            description: 'Agents',
            command: 'npx',
            args: ['-y', 'rea-agents@6.0.0'],
            envKeys: ['REA_TOKEN'],
          },
        ],
      },
    });
    expect(adapter.connections).toEqual([
      {
        kind: 'mcp',
        id: 'rea-agents',
        title: 'Rea Agents',
        description: 'Agents',
        command: 'npx',
        args: ['-y', 'rea-agents@6.0.0'],
        env: [{ name: 'REA_TOKEN', required: false }],
      },
    ]);
    expect(() => parseAdapterDocument(adapter)).not.toThrow();
    expect(adapterFromManifest({}).connections).toEqual([]);
  });
});

/** One valid example of every connection kind added in repotopackage v2 (design section 6.2). */
const NEW_KIND_SAMPLES: Record<string, Record<string, unknown>> = {
  command: {
    kind: 'command',
    id: 'review',
    title: 'Review',
    path: 'source/commands/review.md',
    format: 'markdown',
    argumentHint: '[file]',
  },
  agent: {
    kind: 'agent',
    id: 'planner',
    title: 'Planner',
    path: 'source/agents/planner.md',
    format: 'claude-md',
    tools: ['Read', 'Grep'],
    model: 'sonnet',
  },
  hook: {
    kind: 'hook',
    id: 'format-on-edit',
    event: 'PostToolUse',
    matcher: 'Write|Edit',
    command: '${CLAUDE_PLUGIN_ROOT}/scripts/format.sh',
    args: [],
    timeoutSec: 30,
    plugin: 'source/plugins/claude/formatter',
    origin: 'claude-plugin',
  },
  rules: { kind: 'rules', id: 'house-rules', title: 'House rules', path: 'source/AGENTS.md', format: 'agents-md' },
  extension: {
    kind: 'extension',
    id: 'dark-mode',
    title: 'Dark mode',
    format: 'chrome-mv3',
    root: 'source/extension/dist',
    version: '1.2.3',
    permissions: ['storage'],
    hostPermissions: ['https://example.com/*'],
    unsupported: [],
    needsBuild: false,
    publicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA',
  },
  knowledge: { kind: 'knowledge', id: 'handbook', title: 'Handbook', paths: ['source/docs/a.md', 'source/docs/b.md'] },
  service: {
    kind: 'service',
    id: 'worker',
    title: 'Worker',
    process: {
      services: [{ id: 'api', cwd: 'source/api', start: ['npm', 'run', 'start'], ready: { port: 8080 } }],
    },
  },
  vscode: {
    kind: 'vscode',
    id: 'theme-pack',
    title: 'Theme pack',
    path: 'source/vsx/package.json',
    contributes: ['themes', 'snippets'],
  },
};

const GOOD_HOOK = NEW_KIND_SAMPLES.hook ?? {};
const remoteMcp = {
  kind: 'mcp',
  transport: 'http',
  id: 'docs',
  title: 'Docs',
  url: 'https://mcp.example.com/mcp',
  headers: [{ name: 'Authorization', fromEnv: 'DOCS_TOKEN' }],
  env: [{ name: 'DOCS_TOKEN', required: true }],
};

describe('adapter.json extended connections (repotopackage v2)', () => {
  it('accepts every new kind and round-trips through serialization', () => {
    const parsed = parseAdapterDocument(document(Object.values(NEW_KIND_SAMPLES)));
    expect(parsed.connections.map((connection) => connection.kind)).toEqual(Object.keys(NEW_KIND_SAMPLES));
    expect(parseAdapterDocument(JSON.parse(serializeAdapterDocument(parsed)))).toEqual(parsed);
  });

  it('lists known kinds and recognizes installable agent connections', () => {
    expect(ADAPTER_CONNECTION_KINDS.toSorted()).toEqual(
      ['bridge', 'cli', 'launcher', 'mcp', 'skill', 'tool', 'web-embed', ...Object.keys(NEW_KIND_SAMPLES)].toSorted()
    );
    // Every kind with a host in defaultHosts is installable; bridge and vscode have no host yet.
    expect([...ADAPTER_INSTALLABLE_KINDS].toSorted()).toEqual(
      [
        'agent',
        'cli',
        'command',
        'extension',
        'hook',
        'knowledge',
        'launcher',
        'mcp',
        'rules',
        'service',
        'skill',
        'tool',
        'web-embed',
      ].toSorted()
    );
    expect(ADAPTER_INSTALLABLE_KINDS.has('bridge')).toBe(false);
    expect(ADAPTER_INSTALLABLE_KINDS.has('vscode')).toBe(false);
    const parsed = parseAdapterDocument(document(Object.values(NEW_KIND_SAMPLES)));
    for (const connection of parsed.connections) {
      const installable = connection.kind !== 'vscode';
      expect(isInstallableConnection(connection), connection.kind).toBe(installable);
      if (installable) expect(connectionNotInstallableReason(connection)).toBeUndefined();
      else expect(connectionNotInstallableReason(connection)).toContain(connection.kind);
    }
  });

  it('refuses an unknown field on every new kind, at the top and inside nested objects', () => {
    for (const [kind, sample] of Object.entries(NEW_KIND_SAMPLES)) {
      expect(() => parseAdapterDocument(document([sample])), kind).not.toThrow();
      expect(() => parseAdapterDocument(document([{ ...sample, extra: 1 }])), kind).toThrow();
    }
    const service = NEW_KIND_SAMPLES.service as { process: { services: Record<string, unknown>[] } };
    const nested = { ...service, process: { services: [{ ...service.process.services[0], extra: 1 }] } };
    expect(() => parseAdapterDocument(document([nested]))).toThrow();
  });

  it('accepts the common fields on every kind and refuses a bad plugin path, group or origin', () => {
    const common = { plugin: 'source/plugins/a', group: 'alt-1', origin: 'mcp-config' };
    for (const sample of [mcp, { kind: 'skill', path: 'source/s' }, ...Object.values(NEW_KIND_SAMPLES)]) {
      expect(() => parseAdapterDocument(document([{ ...sample, ...common }]))).not.toThrow();
      for (const bad of [
        { plugin: '../x' },
        { plugin: 'elsewhere/x' },
        { group: 'Upper Case' },
        { origin: 'nobody' },
      ]) {
        expect(() => parseAdapterDocument(document([{ ...sample, ...bad }]))).toThrow();
      }
    }
  });

  it('keeps an old stdio mcp valid and widens only the program list', () => {
    expect(() => parseAdapterDocument(document([mcp]))).not.toThrow();
    expect(() => parseAdapterDocument(document([{ ...mcp, transport: 'stdio' }]))).not.toThrow();
    for (const command of ['node', 'python', 'uv', 'bun', 'uvx']) {
      expect(() => parseAdapterDocument(document([{ ...mcp, command }])), command).not.toThrow();
    }
    // docker is the one program with a fixed subcommand: it only accepts `docker run [flags] <image>`.
    const docker = { ...mcp, command: 'docker', args: ['run', '-i', '--rm', 'ghcr.io/acme/server:1.2.3'] };
    expect(() => parseAdapterDocument(document([docker]))).not.toThrow();
    expect(() => parseAdapterDocument(document([{ ...mcp, command: 'bash' }]))).toThrow();
    const fromSource = { ...mcp, command: 'node', args: ['server.js'], cwd: 'source/server', setup: [['npm', 'ci']] };
    expect(() => parseAdapterDocument(document([fromSource]))).not.toThrow();
    expect(() => parseAdapterDocument(document([{ ...fromSource, cwd: '../x' }]))).toThrow();
    expect(() => parseAdapterDocument(document([{ ...fromSource, setup: [['bash', '-c', 'x']] }]))).toThrow();
  });

  it('accepts only fixed known-safe flags for a local mcp, per program', () => {
    const accepted: [string, string[]][] = [
      ['docker', ['run', '-i', '--rm', 'ghcr.io/acme/server:1.2.3']],
      ['docker', ['run', '--interactive', '--rm', 'acme/server@sha256:0123abcd', 'serve']],
      ['uvx', ['--from', 'acme-mcp==1.0.0', 'acme-mcp']],
      ['python', ['-m', 'acme_server']],
      ['python', ['-u', '-m', 'acme.server']],
      ['npx', ['-y', 'acme-mcp@1.0.0']],
    ];
    for (const [command, args] of accepted) {
      expect(
        () => parseAdapterDocument(document([{ ...mcp, command, args }])),
        `${command} ${args.join(' ')}`
      ).not.toThrow();
    }
    const refused: [string, string[]][] = [
      // Flags that mount the host, pass secrets, open the network or raise privileges.
      ['docker', ['run', '-v', '/:/host', 'img']],
      ['docker', ['run', '--volume=/:/host', 'img']],
      ['docker', ['run', '-e', 'TOKEN', 'img']],
      ['docker', ['run', '--env-file', 'secrets', 'img']],
      ['docker', ['run', '--privileged', 'img']],
      ['docker', ['run', '--network', 'host', 'img']],
      ['docker', ['run', '-it', 'img']],
      ['docker', ['run', '-p', '80:80', 'img']],
      // The docker verb is fixed, and an image is required.
      ['docker', ['exec', '-i', 'box', 'sh']],
      ['docker', ['rm', 'box']],
      ['docker', ['-i', 'run', 'img']],
      ['docker', ['run', '-i', '--rm']],
      // A flag is not allowed for a program that does not list it.
      ['npx', ['-i', 'pkg']],
      ['npx', ['--from', 'pkg', 'cmd']],
      ['node', ['--rm', 'server.js']],
      ['node', ['-m', 'server']],
      ['python', ['-c', 'print(1)']],
      ['python', ['-i', 'server.py']],
      ['uvx', ['--with', 'pkg', 'cmd']],
      ['uvx', ['--from', '--rm']],
      ['python', ['-m']],
      // Values, shell syntax and spaces are never accepted, with or without a flag.
      ['docker', ['run', '-i', '--rm', 'img;rm']],
      ['docker', ['run', '--rm=true', 'img']],
      ['python', ['-m', 'a b']],
      ['uvx', ['--from', '$(x)', 'cmd']],
      ['docker', ['run', '--', 'img']],
    ];
    for (const [command, args] of refused) {
      expect(
        () => parseAdapterDocument(document([{ ...mcp, command, args }])),
        `${command} ${args.join(' ')}`
      ).toThrow();
    }
  });
  it('accepts an http or sse mcp that has no command, and only over https', () => {
    expect(() => parseAdapterDocument(document([remoteMcp]))).not.toThrow();
    expect(() => parseAdapterDocument(document([{ ...remoteMcp, transport: 'sse' }]))).not.toThrow();
    expect(() => parseAdapterDocument(document([{ ...remoteMcp, url: 'http://mcp.example.com' }]))).toThrow();
    expect(() => parseAdapterDocument(document([{ ...remoteMcp, url: undefined }]))).toThrow();
    expect(() => parseAdapterDocument(document([{ ...remoteMcp, transport: 'ws' }]))).toThrow();
    // A remote server is not a local program: command and args are not part of it.
    expect(() => parseAdapterDocument(document([{ ...remoteMcp, command: 'npx' }]))).toThrow();
    expect(() => parseAdapterDocument(document([{ ...remoteMcp, args: ['-y', 'x'] }]))).toThrow();
    // And a local server needs its command.
    expect(() => parseAdapterDocument(document([{ ...mcp, command: undefined }]))).toThrow();
  });

  it('refuses a header that carries a value: the value must come from the secret store', () => {
    for (const header of [
      { name: 'Authorization', value: 'Bearer abc' },
      { name: 'Authorization', fromEnv: 'DOCS_TOKEN', value: 'Bearer abc' },
      { name: 'Authorization' },
      { name: 'Bad Header', fromEnv: 'DOCS_TOKEN' },
      { name: 'Authorization', fromEnv: 'lower' },
    ]) {
      expect(
        () => parseAdapterDocument(document([{ ...remoteMcp, headers: [header] }])),
        JSON.stringify(header)
      ).toThrow();
    }
  });

  it('bounds hook commands: 500 characters, 32 arguments of 500 characters, 1 to 600 seconds', () => {
    const hook = (patch: Record<string, unknown>) => document([{ ...GOOD_HOOK, ...patch }]);
    expect(() => parseAdapterDocument(hook({ command: 'x'.repeat(500) }))).not.toThrow();
    expect(() => parseAdapterDocument(hook({ command: 'x'.repeat(501) }))).toThrow();
    expect(() => parseAdapterDocument(hook({ command: '' }))).toThrow();
    expect(() => parseAdapterDocument(hook({ command: 'a\nb' }))).toThrow();
    expect(() => parseAdapterDocument(hook({ args: Array.from({ length: 32 }, () => 'a') }))).not.toThrow();
    expect(() => parseAdapterDocument(hook({ args: Array.from({ length: 33 }, () => 'a') }))).toThrow();
    expect(() => parseAdapterDocument(hook({ args: ['x'.repeat(500)] }))).not.toThrow();
    expect(() => parseAdapterDocument(hook({ args: ['x'.repeat(501)] }))).toThrow();
    for (const timeoutSec of [1, 600]) expect(() => parseAdapterDocument(hook({ timeoutSec }))).not.toThrow();
    for (const timeoutSec of [0, 601, 1.5, -1]) expect(() => parseAdapterDocument(hook({ timeoutSec }))).toThrow();
    expect(() => parseAdapterDocument(hook({ matcher: 'x'.repeat(301) }))).toThrow();
    expect(() => parseAdapterDocument(hook({ event: 'Pre Tool' }))).toThrow();
    expect(() => parseAdapterDocument(hook({ event: 'PreCompact' }))).not.toThrow();
  });

  it('checks the file-based kinds: markdown or toml commands, safe paths, https-free base64 keys', () => {
    const sample = (kind: string) => NEW_KIND_SAMPLES[kind] ?? {};
    expect(() => parseAdapterDocument(document([{ ...sample('command'), path: 'source/c.txt' }]))).toThrow();
    expect(() => parseAdapterDocument(document([{ ...sample('command'), path: 'source/c.prompt.md' }]))).not.toThrow();
    expect(() => parseAdapterDocument(document([{ ...sample('command'), format: 'other' }]))).toThrow();
    expect(() => parseAdapterDocument(document([{ ...sample('agent'), path: '../a.md' }]))).toThrow();
    expect(() => parseAdapterDocument(document([{ ...sample('knowledge'), paths: [] }]))).toThrow();
    expect(() => parseAdapterDocument(document([{ ...sample('knowledge'), paths: ['/etc/passwd'] }]))).toThrow();
    expect(() => parseAdapterDocument(document([{ ...sample('extension'), publicKey: 'not base64!' }]))).toThrow();
    expect(() => parseAdapterDocument(document([{ ...sample('extension'), root: 'C:/ext' }]))).toThrow();
    expect(() => parseAdapterDocument(document([{ ...sample('service'), process: { services: [] } }]))).toThrow();
    expect(() => parseAdapterDocument(document([{ ...sample('vscode'), contributes: ['commands'] }]))).toThrow();
  });

  it('extends cli and launcher without loosening them', () => {
    const cli = { kind: 'cli', id: 'ctx7', title: 'ctx7', command: 'npx', display: 'terminal' };
    const full = { ...cli, source: 'npm', package: 'ctx7@1.0.0', cwd: 'source/cli', setup: [['npm', 'ci']] };
    expect(() => parseAdapterDocument(document([full]))).not.toThrow();
    expect(() => parseAdapterDocument(document([{ ...full, source: 'brew' }]))).toThrow();
    expect(() => parseAdapterDocument(document([{ ...full, package: 'a b' }]))).toThrow();
    const installed = {
      kind: 'installed',
      executable: 'blender.exe',
      release: { owner: 'blender', repo: 'blender', assetPattern: 'blender-*-windows-x64.msi' },
    };
    const launcher = (target: unknown) => document([{ kind: 'launcher', id: 'b', title: 'B', target }]);
    expect(() => parseAdapterDocument(launcher(installed))).not.toThrow();
    expect(() =>
      parseAdapterDocument(launcher({ ...installed, release: { ...installed.release, owner: 'a/b' } }))
    ).toThrow();
    expect(() => parseAdapterDocument(launcher({ ...installed, release: { owner: 'a', repo: 'b' } }))).toThrow();
    expect(() => parseAdapterDocument(launcher({ kind: 'compose', file: 'source/docker-compose.yml' }))).not.toThrow();
    expect(() => parseAdapterDocument(launcher({ kind: 'compose', file: '../docker-compose.yml' }))).toThrow();
    expect(() => parseAdapterDocument(launcher({ kind: 'compose' }))).toThrow();
  });

  it('keeps a document-level provenance and detector list, and refuses bad ones', () => {
    const provenance = {
      kind: 'git',
      url: 'https://github.com/o/r',
      commit: 'a'.repeat(40),
      ref: 'main',
      subdirectory: 'plugins/x',
      packagedAt: 1_760_000_000_000,
    };
    const withDocument = (extra: Record<string, unknown>) => ({ ...(document([]) as object), ...extra });
    const ok = parseAdapterDocument(withDocument({ provenance, detectors: ['claude-plugin@1', 'mcp-config@2'] }));
    expect(ok.provenance).toEqual(provenance);
    const store = { kind: 'chrome-web-store', url: 'https://chromewebstore.google.com/detail/x', packagedAt: 1 };
    const withIds = { ...store, extensionId: 'a'.repeat(32), extensionVersion: '1.2.3' };
    expect(() => parseAdapterDocument(withDocument({ provenance: withIds }))).not.toThrow();
    for (const bad of [
      { ...provenance, commit: 'a'.repeat(39) },
      { ...provenance, kind: 'ftp' },
      { ...provenance, url: 'http://github.com/o/r' },
      { ...provenance, subdirectory: '../x' },
      { ...provenance, extensionId: 'short' },
      { ...provenance, extra: 1 },
      { kind: 'git' },
    ]) {
      expect(() => parseAdapterDocument(withDocument({ provenance: bad })), JSON.stringify(bad)).toThrow();
    }
    expect(() => parseAdapterDocument(withDocument({ provenance: { kind: 'local', packagedAt: 1 } }))).not.toThrow();
    for (const detectors of [['no-version'], ['Upper@1'], ['a@x'], 'a@1']) {
      expect(() => parseAdapterDocument(withDocument({ detectors }))).toThrow();
    }
  });

  it('accepts the new open item kinds and the connections of a choice, and refuses malformed ones', () => {
    const base = { schemaVersion: 1, generatedBy: 'classifier', connections: [] };
    const ok = [
      { kind: 'needs-build', path: 'source/extension', note: 'Build, then point at dist' },
      { kind: 'needs-consent', connection: 'dark-mode', note: 'Asks for all URLs' },
      { kind: 'choose', note: 'Pick one', options: ['a', 'b'], connections: ['alt-a', 'alt-b'] },
    ];
    expect(parseAdapterDocument({ ...base, openItems: ok }).openItems).toHaveLength(3);
    for (const bad of [
      { kind: 'needs-build', note: '' },
      { kind: 'choose', note: 'x', connections: ['Bad Id'] },
      { kind: 'choose', note: 'x', connections: Array.from({ length: 17 }, (_, i) => `c${i}`) },
      { kind: 'needs-consent', note: 'x', extra: 1 },
    ]) {
      expect(() => parseAdapterDocument({ ...base, openItems: [bad] })).toThrow();
    }
  });

  it('reports a duplicate key for new kinds, and the same id under a different kind is not a duplicate', () => {
    const hook = GOOD_HOOK;
    expect(() => parseAdapterDocument(document([hook, hook]))).toThrow(/Duplicate connection hook:format-on-edit/);
    const command = NEW_KIND_SAMPLES.command ?? {};
    const rules = NEW_KIND_SAMPLES.rules ?? {};
    expect(() => parseAdapterDocument(document([command, command]))).toThrow(/Duplicate connection command:review/);
    expect(() =>
      parseAdapterDocument(
        document([
          { ...command, id: 'same' },
          { ...rules, id: 'same' },
        ])
      )
    ).not.toThrow();
    expect(() => parseAdapterDocument(document([remoteMcp, { ...mcp, id: 'docs' }]))).toThrow(
      /Duplicate connection mcp:docs/
    );
  });

  it('allows up to 128 connections and no more', () => {
    const skills = (count: number) =>
      document(Array.from({ length: count }, (_, i) => ({ kind: 'skill', path: `source/s${i}` })));
    expect(parseAdapterDocument(skills(128)).connections).toHaveLength(128);
    expect(() => parseAdapterDocument(skills(129))).toThrow();
  });
});
