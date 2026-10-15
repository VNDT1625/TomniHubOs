import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePackageManifest } from '../../../../packages/desktop/src/common/packages';
import { buildTomnyPackageFromRepo } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/packager';
import { renderSuccess } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/report';
import type { RepoToPackageOptions } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/types';
import { readArchive, testSigning, withTemp, writeTree } from './helpers';

const SDK = { '@modelcontextprotocol/sdk': '^1.0.0' };

const serverPackage = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    name: '@acme/docs-mcp',
    version: '1.4.2',
    description: 'Docs for agents',
    bin: { 'docs-mcp': 'dist/index.js' },
    dependencies: SDK,
    ...extra,
  });

const build = (root: string, parent: string, overrides: Partial<RepoToPackageOptions> = {}) =>
  buildTomnyPackageFromRepo({
    source: '',
    workspaceRoot: root,
    outputDirectory: path.join(parent, 'out'),
    signing: testSigning(),
    ...overrides,
  });

describe('an MCP server repository', () => {
  it('carries the repository under source/ and a launch recipe in adapter/, and the host accepts the manifest', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'repo');
      await writeTree(repo, {
        'package.json': serverPackage(),
        'README.md': '# docs mcp',
        LICENSE: 'MIT',
        'src/index.ts': 'import { Server } from "@modelcontextprotocol/sdk/server/index.js";',
        'dist/index.js': 'console.log("server")',
      });
      const result = await build(repo, parent);

      expect(result.classification.archetype).toBe('mcp-tool-server');
      expect(result.verified).toBe(true);
      const server = result.manifest.contributions?.mcpServers?.[0];
      expect(server).toMatchObject({ command: 'npx', args: ['-y', '@acme/docs-mcp@1.4.2'] });
      expect(result.manifest.permissions).toEqual(['mcp.server.stdio']);
      expect(result.manifest.modules).toEqual([]);
      expect(() => parsePackageManifest(result.manifest)).not.toThrow();

      const archive = await readArchive(result.artifactPath);
      const stored = [...archive.keys()].filter((name) => !name.endsWith('.json'));
      // The whole repository travels untouched; build output (dist/) is the only thing left out.
      expect(stored.toSorted()).toEqual(['source/LICENSE', 'source/README.md', 'source/src/index.ts']);
      const adapter = JSON.parse(archive.get('adapter/adapter.json')?.toString('utf8') ?? 'null');
      expect(adapter).toMatchObject({
        schemaVersion: 1,
        generatedBy: 'classifier',
        connections: [{ kind: 'mcp', command: 'npx', args: ['-y', '@acme/docs-mcp@1.4.2'] }],
      });
      expect(result.adapter).toEqual(adapter);
      expect(renderSuccess(result)).toContain('npx -y @acme/docs-mcp@1.4.2');
    });
  });

  it('finds the one publishable package of a monorepo whose root is private', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'repo');
      await writeTree(repo, {
        'package.json': JSON.stringify({ name: 'root', private: true, version: '0.0.0' }),
        'README.md': '# mono',
        'packages/mcp/package.json': serverPackage(),
        'packages/mcp/src/index.ts': 'import { Server } from "@modelcontextprotocol/sdk/server/index.js";',
        'packages/sdk/package.json': JSON.stringify({ name: '@acme/sdk', version: '1.0.0', main: 'index.js' }),
      });
      const result = await build(repo, parent);
      expect(result.manifest.contributions?.mcpServers?.[0]?.args).toEqual(['-y', '@acme/docs-mcp@1.4.2']);
    });
  });

  it('picks the server over a command line tool that sits next to it, as in a docs-server monorepo', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'repo');
      await writeTree(repo, {
        'package.json': JSON.stringify({ name: 'root', private: true, version: '0.0.0' }),
        'README.md': '# mono',
        'mcp.json': '{}',
        'packages/mcp/package.json': serverPackage(),
        'packages/cli/package.json': JSON.stringify({
          name: 'acme-cli',
          version: '2.0.0',
          bin: { acme: 'dist/cli.js' },
          dependencies: { commander: '^12.0.0' },
        }),
      });
      const result = await build(repo, parent);
      expect(result.manifest.contributions?.mcpServers?.[0]?.args).toEqual(['-y', '@acme/docs-mcp@1.4.2']);
      const note = result.warnings.find((warning) => warning.code === 'MCP_OTHER_PACKAGES');
      expect(note?.message).toContain('packages/cli/package.json');
      expect(note?.message).toContain('--path');
    });
  });

  it('asks for --path when a monorepo has several publishable servers', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'repo');
      await writeTree(repo, {
        'package.json': JSON.stringify({ name: 'root', private: true, version: '0.0.0' }),
        'README.md': '# mono',
        'mcp.json': '{}',
        'packages/a/package.json': serverPackage({ name: '@acme/a-mcp' }),
        'packages/b/package.json': serverPackage({ name: '@acme/b-mcp' }),
      });
      await expect(build(repo, parent)).rejects.toMatchObject({ code: 'MCP_AMBIGUOUS' });
    });
  });

  it('keeps unpublished MCP server source inert and tells the user what is missing', async () => {
    await withTemp(async (parent) => {
      const variants: Array<[string, Record<string, unknown>]> = [
        ['private', { private: true }],
        ['nobin', { bin: undefined }],
        ['badversion', { version: 'not-a-version' }],
        ['badname', { name: 'Bad Name' }],
      ];
      for (const [label, extra] of variants) {
        const repo = path.join(parent, `repo-${label}`);
        // oxlint-disable-next-line no-await-in-loop
        await writeTree(repo, { 'package.json': serverPackage(extra), 'README.md': '# x' });
        // oxlint-disable-next-line no-await-in-loop
        const result = await build(repo, parent);
        expect(result.classification).toMatchObject({
          runnable: false,
          runnableIssueCode: 'MCP_NO_LAUNCH_RECIPE',
        });
        expect(result.manifest.modules).toEqual([]);
        expect(result.adapter?.connections).toEqual([]);
        expect(result.adapter?.openItems?.some((item) => item.kind === 'needs-runtime')).toBe(true);
        expect(renderSuccess(result)).toContain('Chỉ lưu mã nguồn');
        expect(renderSuccess(result)).toContain('bin');
        expect(result.adapter?.openItems?.some((item) => item.note.includes('bin'))).toBe(true);
      }
    });
  });

  it('reads a Python server that declares scripts', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'repo');
      await writeTree(repo, {
        'pyproject.toml': [
          '[project]',
          'name = "acme-mcp"',
          'version = "0.3.1"',
          'dependencies = ["mcp"]',
          '',
          '[project.scripts]',
          'acme-mcp = "acme.server:main"',
        ].join('\n'),
        'README.md': '# py',
        'acme/server.py': ['from mcp.server import Server', 'server = Server("acme")'].join('\n'),
        'mcp.json': '{}',
      });
      const result = await build(repo, parent);
      expect(result.manifest.contributions?.mcpServers?.[0]).toMatchObject({
        command: 'uvx',
        args: ['acme-mcp==0.3.1'],
      });
    });
  });
});

describe('the manifest rules for MCP servers', () => {
  const manifest = (server: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    id: 'com.community.docs-mcp',
    publisherId: 'com.community',
    name: 'Docs MCP',
    description: 'Docs',
    type: 'agent-capsule',
    bundleKind: 'single',
    version: '1.0.0',
    engines: { tomni: '>=0.0.0' },
    modules: [],
    permissions: ['mcp.server.stdio'],
    dependencies: [],
    tags: [],
    contributions: {
      version: 1,
      mcpServers: [{ id: 'docs', title: 'Docs', command: 'npx', args: ['-y', 'docs-mcp@1.0.0'], ...server }],
    },
    ...overrides,
  });

  it('accepts a plain launch recipe', () => {
    expect(() => parsePackageManifest(manifest({}))).not.toThrow();
  });

  it.each([
    ['a command that is not a package launcher', { command: 'bash' }],
    ['npx running a shell string', { args: ['-c', 'curl x | sh'] }],
    ['npx with a package option', { args: ['--package', 'x', 'y'] }],
    ['an argument with a space', { args: ['-y', 'docs mcp'] }],
    ['an argument with a shell metacharacter', { args: ['-y', 'docs;rm'] }],
    ['an argument with a newline', { args: ['-y', 'docs' + String.fromCharCode(10) + 'rm'] }],
    ['only flags and no package', { args: ['-y'] }],
    ['an environment name in lowercase', { envKeys: ['api_key'] }],
  ])('rejects %s', (_label, server) => {
    expect(() => parsePackageManifest(manifest(server))).toThrow();
  });

  it('needs the permission, and only agent capsules may carry servers', () => {
    expect(() => parsePackageManifest(manifest({}, { permissions: [] }))).toThrow();
    expect(() => parsePackageManifest(manifest({}, { type: 'ui' }))).toThrow();
  });
});
