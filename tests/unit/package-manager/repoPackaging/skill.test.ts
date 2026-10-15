import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyRepository } from '../../../../packages/desktop/src/common/packages';
import { buildTomnyPackageFromRepo } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/packager';
import {
  extractSkillsFromPackage,
  orderSkillRoots,
} from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/skillInstall';
import { readArchive, testSigning, withTemp, writeTree } from './helpers';

const SKILL = '---\nname: demo-skill\ndescription: Does a demo\n---\n\n# Demo\n';

describe('classifying an agent skill repository', () => {
  it('recognises skills/<name>/SKILL.md as runnable and records the folder', () => {
    const result = classifyRepository({
      files: ['skills/demo/SKILL.md', 'skills/demo/assets/a.html', 'scripts/build.py', 'README.md'],
      repositoryName: 'demo-design',
    });
    expect(result.archetype).toBe('agent-skill');
    expect(result.packageType).toBe('agent-capsule');
    expect(result.runnable).toBe(true);
    expect(result.permissions).toEqual([]);
    expect(result.skillRoots).toEqual(['skills/demo']);
    expect(result.connections).toEqual([{ kind: 'skill', path: 'source/skills/demo' }]);
  });

  it('keeps only the outermost folder and ignores fixtures and node_modules', () => {
    const result = classifyRepository({
      files: [
        'skills/a/SKILL.md',
        'skills/a/sub/SKILL.md',
        'scripts/fixtures/SKILL.md',
        'node_modules/x/SKILL.md',
        'skills/b/skill.md',
      ],
    });
    expect(result.skillRoots).toEqual(['skills/a', 'skills/b']);
  });

  it('treats a SKILL.md at the root as the whole repository', () => {
    const result = classifyRepository({ files: ['SKILL.md', 'references/x.md'] });
    expect(result.archetype).toBe('agent-skill');
    expect(result.skillRoots).toEqual(['']);
    expect(result.connections).toEqual([{ kind: 'skill', path: 'source' }]);
  });

  it('prefers a runnable MCP server over a skill', () => {
    const result = classifyRepository({
      files: ['skills/a/SKILL.md', 'package.json'],
      packageJson: { name: 'x', dependencies: { '@modelcontextprotocol/sdk': '1.0.0' } },
    });
    expect(result.archetype).toBe('mcp-tool-server');
    expect(result.connections?.map((connection) => connection.kind)).toEqual(['skill']);
  });

  it('offers both the MCP server and the skills of a platform repository', () => {
    const result = classifyRepository({
      files: ['skills/find-docs/SKILL.md', 'skills/cli/SKILL.md', 'package.json'],
      packageJson: { name: 'platform', version: '1.0.0', dependencies: { '@modelcontextprotocol/sdk': '1.0.0' } },
      mcpLaunch: { command: 'npx', args: ['-y', 'platform-mcp@1.0.0'], packageName: 'platform-mcp' },
      repositoryName: 'platform',
    });
    expect(result.archetype).toBe('mcp-tool-server');
    expect(result.connections).toEqual([
      expect.objectContaining({ kind: 'mcp', id: 'platform', command: 'npx', args: ['-y', 'platform-mcp@1.0.0'] }),
      { kind: 'skill', path: 'source/skills/cli' },
      { kind: 'skill', path: 'source/skills/find-docs' },
    ]);
  });

  it('does not mistake a repository without SKILL.md for a skill', () => {
    expect(classifyRepository({ files: ['README.md', 'src/main.rs'] }).archetype).not.toBe('agent-skill');
  });
});

describe('ordering skill folders for import', () => {
  it('puts the outermost copy of a skill first so a duplicate shipped per host plugin loses', () => {
    expect(
      orderSkillRoots([
        'source/plugins/cursor/context7/skills/context7-mcp',
        'source/skills/find-docs',
        'source/skills/context7-mcp',
        'source/packages/pi/skills/context7-docs',
      ])
    ).toEqual([
      'source/skills/context7-mcp',
      'source/skills/find-docs',
      'source/packages/pi/skills/context7-docs',
      'source/plugins/cursor/context7/skills/context7-mcp',
    ]);
  });
});

describe('packaging an agent skill repository', () => {
  it('keeps the whole repository under source/ and lists the skill in adapter/adapter.json', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'demo-design');
      await writeTree(repo, {
        'skills/demo/SKILL.md': SKILL,
        'skills/demo/assets/example.html': '<svg/>',
        'scripts/build.py': 'print(1)',
        'commands/doctor.md': '# doctor',
        LICENSE: 'MIT',
        'README.md': '# readme',
      });
      const result = await buildTomnyPackageFromRepo({
        source: '',
        workspaceRoot: repo,
        outputDirectory: path.join(parent, 'out'),
        signing: testSigning(),
      });
      expect(result.classification.archetype).toBe('agent-skill');
      expect(result.verified).toBe(true);
      const archive = await readArchive(result.artifactPath);
      const names = [...archive.keys()];
      for (const kept of [
        'source/skills/demo/SKILL.md',
        'source/skills/demo/assets/example.html',
        'source/scripts/build.py',
        'source/commands/doctor.md',
        'source/LICENSE',
        'adapter/adapter.json',
      ]) {
        expect(names).toContain(kept);
      }
      // Nothing sits outside source/ and adapter/ except the manifest.
      expect(names.filter((name) => !/^(?:source|adapter)\//u.test(name))).toEqual(['tomny-package.json']);
      expect(result.adapter?.connections).toEqual([{ kind: 'skill', path: 'source/skills/demo' }]);
      expect(JSON.parse(archive.get('adapter/adapter.json')?.toString('utf8') ?? 'null')).toEqual(result.adapter);
    });
  });

  it('extracts each skill into a folder that holds its SKILL.md at the top', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'demo-design');
      await writeTree(repo, {
        'skills/demo/SKILL.md': SKILL,
        'skills/demo/assets/example.html': '<svg/>',
        'scripts/build.py': 'print(1)',
      });
      const result = await buildTomnyPackageFromRepo({
        source: '',
        workspaceRoot: repo,
        outputDirectory: path.join(parent, 'out'),
        signing: testSigning(),
      });
      const paths = (result.adapter?.connections ?? []).flatMap((connection) =>
        connection.kind === 'skill' ? [connection.path] : []
      );
      const extracted = await extractSkillsFromPackage(result.artifactPath, paths);
      try {
        expect(extracted.directories).toHaveLength(1);
        const [directory] = extracted.directories;
        expect(path.basename(directory)).toBe('demo');
        expect(await readFile(path.join(directory, 'SKILL.md'), 'utf8')).toBe(SKILL);
        expect(await readdir(path.join(directory, 'assets'))).toEqual(['example.html']);
      } finally {
        await extracted.cleanup();
      }
    });
  });
});
