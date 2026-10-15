import { describe, expect, it } from 'vitest';
import {
  classifyRepository,
  parsePackageManifest,
  resolveWebEntrypoint,
} from '../../../../packages/desktop/src/common/packages';

const BUILT_PAGE = '<!doctype html><html><body><script src="assets/app.js"></script></body></html>';
const SOURCE_PAGE = '<!doctype html><html><body><script type="module" src="/src/main.tsx"></script></body></html>';

describe('web entry point resolution', () => {
  it('prefers published output over the root page', () => {
    const files = ['index.html', 'dist/index.html', 'docs/index.html', 'src/main.tsx'];
    expect(resolveWebEntrypoint(files, {})).toEqual({ entrypoint: 'dist/index.html', needsBuild: false });
    expect(resolveWebEntrypoint(['index.html', 'docs/index.html'], {}).entrypoint).toBe('docs/index.html');
  });

  it('skips a page that loads source files and reports that a build is needed', () => {
    const files = ['index.html', 'src/main.tsx'];
    expect(resolveWebEntrypoint(files, { 'index.html': SOURCE_PAGE })).toEqual({
      needsBuild: true,
      unbuiltEntrypoint: 'index.html',
    });
  });

  it.each([
    ['a module script with a TypeScript source', '<script type="module" src="./main.ts"></script>'],
    ['a Create React App template placeholder', '<link rel="icon" href="%PUBLIC_URL%/favicon.ico">'],
    ['a server template tag', '<title><%= title %></title>'],
  ])('detects %s as unbuilt', (_label, html) => {
    expect(resolveWebEntrypoint(['index.html'], { 'index.html': html }).needsBuild).toBe(true);
  });

  it('falls back to the root page when the published output page is itself unbuilt', () => {
    const resolved = resolveWebEntrypoint(['dist/index.html', 'index.html'], {
      'dist/index.html': SOURCE_PAGE,
      'index.html': BUILT_PAGE,
    });
    expect(resolved).toEqual({ entrypoint: 'index.html', needsBuild: false });
  });

  it('assumes a page is ready when nothing says otherwise, and keeps the real file name casing', () => {
    expect(resolveWebEntrypoint(['Index.HTML'], {})).toEqual({ entrypoint: 'Index.HTML', needsBuild: false });
  });

  it('finds nothing when there is no page', () => {
    expect(resolveWebEntrypoint(['src/main.rs'], {})).toEqual({ needsBuild: false });
  });
});

describe('what this app version can run', () => {
  it('marks a built static site as runnable and points at the published page', () => {
    const result = classifyRepository({
      files: ['dist/index.html', 'dist/assets/app.js', 'src/main.tsx', 'package.json'],
      packageJson: { name: 'site', dependencies: { vite: '^5' } },
      fileSnippets: { 'dist/index.html': BUILT_PAGE },
    });
    expect(result.archetype).toBe('web-surface-app');
    expect(result.runnable).toBe(true);
    expect(result.entrypoint).toBe('dist/index.html');
    expect(result.runnableIssueCode).toBeUndefined();
  });

  it('refuses source that still needs a build, naming the page and the fix', () => {
    const result = classifyRepository({
      files: ['index.html', 'src/main.tsx', 'vite.config.ts', 'package.json'],
      packageJson: { name: 'app', dependencies: { vite: '^5', react: '^18' } },
      fileSnippets: { 'index.html': SOURCE_PAGE },
    });
    expect(result.archetype).toBe('web-surface-app');
    expect(result.runnable).toBe(false);
    expect(result.runnableIssueCode).toBe('WEB_NEEDS_BUILD');
    expect(result.runnableIssue).toContain('index.html');
    expect(result.runnableIssue).toContain('--path');
  });

  it('refuses a web framework with no page at all', () => {
    const result = classifyRepository({
      files: ['src/App.tsx', 'package.json'],
      packageJson: { name: 'lib', dependencies: { react: '^18' } },
    });
    expect(result.runnable).toBe(false);
    expect(result.runnableIssueCode).toBe('NO_WEB_ENTRYPOINT');
  });

  it.each([
    [
      'chat-stage',
      { files: ['src/docsStage.ts'], fileSnippets: { 'src/docsStage.ts': 'class A implements IChatStage {}' } },
    ],
    ['workflow-capsule', { files: ['workflow.json'], repositoryName: 'flow' }],
    ['service-daemon', { files: ['src/server.ts'], packageJson: { name: 'gw', dependencies: { express: '^4' } } }],
  ] as const)('recognizes %s but refuses it because the host has no runtime for it', (archetype, input) => {
    const result = classifyRepository({ ...input, files: [...input.files] });
    expect(result.archetype).toBe(archetype);
    expect(result.isSupported).toBe(true);
    expect(result.runnable).toBe(false);
    expect(result.runnableIssueCode).toBe('HOST_RUNTIME_MISSING');
    expect(() => parsePackageManifest(result.manifest)).not.toThrow();
  });

  it('runs an MCP server only when a published package can start it', () => {
    const input = { files: ['mcp.json', 'src/index.ts'], repositoryName: 'weather' };
    const without = classifyRepository(input);
    expect(without.archetype).toBe('mcp-tool-server');
    expect(without.runnable).toBe(false);
    expect(without.runnableIssueCode).toBe('MCP_NO_LAUNCH_RECIPE');
    expect(without.manifest.contributions).toBeUndefined();

    const withLaunch = classifyRepository({
      ...input,
      mcpLaunch: { command: 'npx', args: ['-y', 'weather-mcp@1.0.0'], packageName: 'weather-mcp' },
    });
    expect(withLaunch.runnable).toBe(true);
    expect(withLaunch.permissions).toEqual(['mcp.server.stdio']);
    expect(withLaunch.manifest.modules).toEqual([]);
    expect(withLaunch.manifest.contributions?.mcpServers).toHaveLength(1);
    expect(() => parsePackageManifest(withLaunch.manifest)).not.toThrow();
  });

  it('does not invent a placeholder page for a repository with nothing to run', () => {
    for (const files of [['mylib/__init__.py', 'pyproject.toml'], ['src/main.rs', 'Cargo.toml'], ['README.md']]) {
      const result = classifyRepository({ files, repositoryName: 'plain' });
      expect(result.archetype).toBe('source-only');
      expect(result.isSupported).toBe(false);
      expect(result.runnable).toBe(false);
      expect(result.runnableIssueCode).toBe('NO_WEB_ENTRYPOINT');
      expect(result.manifest.modules).toEqual([]);
      expect(() => parsePackageManifest(result.manifest)).not.toThrow();
    }
  });

  it('only treats a folder as a theme when it has a stylesheet and nothing else is code', () => {
    const theme = classifyRepository({ files: ['theme.css', 'preview.png', 'README.md'], repositoryName: 'neon' });
    expect(theme.archetype).toBe('ui-theme');
    expect(theme.runnable).toBe(true);

    for (const files of [
      ['src/theme/index.ts', 'src/theme/colors.css'],
      ['styles/main.scss'],
      ['tokens.json', 'README.md'],
    ]) {
      expect(classifyRepository({ files, repositoryName: 'x' }).archetype).not.toBe('ui-theme');
    }
  });

  it('keeps native code a safe rejection', () => {
    const result = classifyRepository({ files: ['driver.c', 'kernel_hook.h'], repositoryName: 'drv' });
    expect(result.archetype).toBe('unsupported-native');
    expect(result.runnable).toBe(false);
    expect(result.runnableIssueCode).toBe('UNSUPPORTED_NATIVE');
  });
});

const kinds = (result: ReturnType<typeof classifyRepository>) => (result.connections ?? []).map((c) => c.kind);

describe('classification built from the detectors (T1.10)', () => {
  const REMOTE_MCP = JSON.stringify({ mcpServers: { c7: { type: 'http', url: 'https://mcp.context7.com/mcp' } } });

  it('lists the components of a plugin next to the legacy skill, and reports the detectors that ran', () => {
    const result = classifyRepository({
      repositoryName: 'plug',
      files: ['.claude-plugin/plugin.json', 'skills/docs/SKILL.md', '.mcp.json', 'commands/ask.md'],
      fileSnippets: {
        '.claude-plugin/plugin.json': JSON.stringify({ name: 'plug' }),
        '.mcp.json': REMOTE_MCP,
        'commands/ask.md': 'Ask',
      },
    });
    expect(result.archetype).toBe('agent-skill');
    expect(kinds(result)).toEqual(expect.arrayContaining(['skill', 'mcp', 'command']));
    expect(result.connections?.filter((connection) => connection.kind === 'skill')).toHaveLength(1);
    expect(result.detectors).toEqual([
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
    expect(result.archetypeLabel).toBe('agent-skill');
  });

  it('keeps the legacy archetype when a repository only carries a .mcp.json', () => {
    const result = classifyRepository({
      repositoryName: 'cfg',
      files: ['.mcp.json', 'README.md'],
      fileSnippets: { '.mcp.json': REMOTE_MCP },
    });
    expect(result.archetype).toBe('source-only');
    expect(result.runnable).toBe(false);
    expect(result.connections).toEqual([expect.objectContaining({ kind: 'mcp', id: 'c7', transport: 'http' })]);
    expect(result.archetypeLabel).toBe('mcp-tool-server');
  });

  it('turns every declaration file nobody handled into an open item (criterion C2)', () => {
    const result = classifyRepository({
      repositoryName: 'loose',
      files: ['hooks.json', '.mcp.json', 'gemini-extension.json', 'README.md'],
      fileSnippets: { '.mcp.json': '{ "mcpServers": ' },
    });
    const paths = (result.openItems ?? []).filter((item) => item.kind === 'unrecognized').map((item) => item.path);
    expect(paths).toEqual(
      expect.arrayContaining(['source/hooks.json', 'source/.mcp.json', 'source/gemini-extension.json'])
    );
    expect(result.connections).toBeUndefined();
  });

  it('names a published MCP server once, under the id the classifier gives it', () => {
    const packageJson = JSON.stringify({
      name: '@acme/docs-mcp',
      version: '1.4.2',
      bin: { docs: 'dist/index.js' },
      dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
    });
    const result = classifyRepository({
      repositoryName: 'docs',
      files: ['package.json', 'src/index.ts'],
      packageJson,
      fileSnippets: { 'package.json': packageJson },
      mcpLaunch: { command: 'npx', args: ['-y', '@acme/docs-mcp@1.4.2'], packageName: '@acme/docs-mcp' },
    });
    expect(result.archetype).toBe('mcp-tool-server');
    expect(result.connections).toEqual([
      expect.objectContaining({ kind: 'mcp', id: 'docs-mcp', command: 'npx', args: ['-y', '@acme/docs-mcp@1.4.2'] }),
    ]);
    expect(result.runnable).toBe(true);
  });

  it('leaves the connections of a web page repository undefined when no detector finds anything', () => {
    const result = classifyRepository({ files: ['index.html'], repositoryName: 'page' });
    expect(result.archetype).toBe('web-surface-app');
    expect(result.connections).toBeUndefined();
    expect(result.openItems).toBeUndefined();
  });
});
