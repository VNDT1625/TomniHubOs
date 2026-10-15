import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAdapterDocument } from '../../../../packages/desktop/src/common/packages/adapter';
import { buildTomnyPackageFromRepo } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/packager';
import { renderSuccess } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/report';
import { readArchive, testSigning, withTemp, writeTree } from './helpers';

const MCP_CONFIG = JSON.stringify({
  mcpServers: { files: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@1.0.0'] } },
});

const build = (parent: string, repo: string) =>
  buildTomnyPackageFromRepo({
    source: '',
    workspaceRoot: repo,
    outputDirectory: path.join(parent, 'out'),
    signing: testSigning('local:test'),
  });

describe('packaging a repository whose connections come from the detectors', () => {
  it('writes adapter.json for a repository the legacy rules cannot host, with provenance and detectors', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'mcp-config-only');
      await writeTree(repo, { '.mcp.json': MCP_CONFIG, 'README.md': '# readme' });
      const result = await build(parent, repo);

      // The legacy archetype is unchanged; only the connections are new.
      expect(result.classification.runnable).toBe(false);
      expect(result.adapter?.connections.map((connection) => connection.kind)).toEqual(['mcp']);
      expect(result.adapter?.detectors?.length).toBeGreaterThan(0);
      expect(result.adapter?.provenance).toMatchObject({ kind: 'local' });
      expect(result.adapter?.provenance?.packagedAt).toBe(Date.parse(result.provenance.packagedAt));

      const archive = await readArchive(result.artifactPath);
      const written = parseAdapterDocument(JSON.parse(archive.get('adapter/adapter.json')?.toString('utf8') ?? 'null'));
      expect(written).toEqual(result.adapter);
      expect(archive.has('source/.mcp.json')).toBe(true);
      // The package holds nothing the host would run by itself.
      expect(result.manifest.modules).toEqual([]);
      expect(result.manifest.permissions).toEqual([]);
      expect(result.manifest.contributions).toBeUndefined();
    });
  });

  it('retains a runnable web app and its MCP connection in the same verified package', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'web-and-mcp');
      await writeTree(repo, {
        'index.html': '<!doctype html><main>hello</main>',
        '.mcp.json': MCP_CONFIG,
        'README.md': '# mixed',
      });
      const result = await build(parent, repo);
      expect(result.classification.runnable).toBe(true);
      expect(result.manifest.modules[0]?.entrypoint).toBe('index.html');
      expect(result.adapter?.connections.some((connection) => connection.kind === 'mcp')).toBe(true);
      expect(result.verified).toBe(true);
      const archive = await readArchive(result.artifactPath);
      expect(archive.has('index.html')).toBe(true);
      expect(archive.has('source/.mcp.json')).toBe(true);
      expect(archive.has('adapter/adapter.json')).toBe(true);
    });
  });

  it('keeps detector connections when the web entrypoint is in dist/', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'dist-and-mcp');
      await writeTree(repo, {
        'dist/index.html': '<!doctype html><main>hello</main>',
        '.mcp.json': MCP_CONFIG,
      });
      const result = await build(parent, repo);
      expect(result.manifest.modules[0]?.entrypoint).toBe('index.html');
      expect(result.adapter?.connections.some((connection) => connection.kind === 'mcp')).toBe(true);
      const archive = await readArchive(result.artifactPath);
      expect(archive.has('index.html')).toBe(true);
      expect(archive.has('source/.mcp.json')).toBe(true);
      expect(archive.has('adapter/adapter.json')).toBe(true);
    });
  });

  it('keeps an MCP connection alongside unbuilt web source and reports the missing build', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'unbuilt-web-and-mcp');
      await writeTree(repo, {
        'index.html': '<!doctype html><script type="module" src="/src/main.tsx"></script>',
        'src/main.tsx': 'export {}',
        'package.json': JSON.stringify({ name: 'mixed-unbuilt', dependencies: { vite: '^5', react: '^18' } }),
        '.mcp.json': MCP_CONFIG,
      });
      const result = await build(parent, repo);
      expect(result.classification.runnable).toBe(false);
      expect(result.classification.runnableIssueCode).toBe('WEB_NEEDS_BUILD');
      expect(result.manifest.modules).toEqual([]);
      expect(result.adapter?.connections.some((connection) => connection.kind === 'mcp')).toBe(true);
      expect(
        result.adapter?.openItems?.some((item) => item.kind === 'needs-runtime' && item.note.includes('build'))
      ).toBe(true);
      expect(renderSuccess(result)).toContain('Giao diện web chưa chạy được');
      const archive = await readArchive(result.artifactPath);
      expect(archive.has('source/index.html')).toBe(true);
      expect(archive.has('source/.mcp.json')).toBe(true);
    });
  });

  it('reads declaration files nested in plugin folders, up to the inventory cap', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'plugin-repo');
      await writeTree(repo, {
        'plugins/demo/.claude-plugin/plugin.json': JSON.stringify({ name: 'demo', version: '1.0.0' }),
        'plugins/demo/.mcp.json': MCP_CONFIG,
        'README.md': '# readme',
      });
      const result = await build(parent, repo);
      expect(result.adapter?.connections.some((connection) => connection.kind === 'mcp')).toBe(true);
    });
  });

  it('keeps even an unrecognized repository as inert source with a reason', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'nothing');
      await writeTree(repo, { 'notes.txt': 'hello', 'README.md': '# readme' });
      const result = await build(parent, repo);
      expect(result.manifest.modules).toEqual([]);
      expect(result.adapter?.connections).toEqual([]);
      expect(result.adapter?.openItems).toContainEqual(expect.objectContaining({ kind: 'needs-runtime' }));
      const archive = await readArchive(result.artifactPath);
      expect(archive.get('source/notes.txt')?.toString()).toBe('hello');
    });
  });
});
