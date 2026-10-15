import { describe, expect, it, vi } from 'vitest';
import {
  createInventory,
  isDeclarationFile,
  MAX_DECLARATION_CHARS,
  MAX_TOTAL_CHARS,
  MAX_USERSCRIPT_CHARS,
  normalizeRepoPath,
} from '@/common/integrations/detectors/inventory';

describe('normalizeRepoPath', () => {
  it('uses forward slashes and drops empty and dot parts', () => {
    expect(normalizeRepoPath('a\\b//c/./d.json')).toBe('a/b/c/d.json');
    expect(normalizeRepoPath('./package.json')).toBe('package.json');
  });

  it.each(['../x', 'a/../b', '/etc/passwd', 'C:\\Windows\\x', 'C:x', '', '.', 'a/\u0000b', '..\\x'])(
    'rejects %j',
    (path) => {
      expect(normalizeRepoPath(path)).toBeUndefined();
    }
  );
});

describe('isDeclarationFile', () => {
  it.each([
    'package.json',
    'apps/web/package.json',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod',
    'requirements.txt',
    'requirements-dev.txt',
    '.env.example',
    'docker-compose.yml',
    'compose.yaml',
    'manifest.json',
    'src/plugin.json',
    '.claude-plugin/marketplace.json',
    'hooks/hooks.json',
    '.mcp.json',
    'mcp.json',
    'mcp_config.json',
    '.vscode/mcp.json',
    'gemini-extension.json',
    '.claude/settings.json',
    'skills/a/SKILL.md',
    'SKILL.md',
    'script.user.js',
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    '.cursorrules',
    '.cursor/rules/style.mdc',
    '.github/copilot-instructions.md',
    '.github/instructions/ts.md',
    '.kiro/steering/product.md',
    '.clinerules',
    '.windsurf/rules/a.md',
    'commands/build.md',
    '.gemini/commands/x.toml',
    '.github/prompts/a.prompt.md',
    '.github/agents/a.agent.md',
    '.opencode/command/c.md',
    '.opencode/agent/a.md',
    'wxt.config.ts',
    'ext/wxt.config.mjs',
    'ext/.output/chrome-mv3/manifest.json',
    'scripts/Tool.User.JS',
    'electron-builder.yml',
    'src-tauri/tauri.conf.json',
    'project.godot',
  ])('accepts %s', (path) => {
    expect(isDeclarationFile(path)).toBe(true);
  });

  it.each([
    'README.md',
    'LICENSE',
    'src/index.ts',
    'docs/guide.md',
    'package-lock.json',
    'commands/build.sh',
    'node_modules/pkg/package.json',
    'a/.git/hooks.json',
    'image.png',
  ])('rejects %s', (path) => {
    expect(isDeclarationFile(path)).toBe(false);
  });
});

describe('createInventory', () => {
  it('lists normalized, unique, sorted files and drops unsafe paths', () => {
    const inventory = createInventory({
      files: ['b.txt', 'a\\x.txt', '../escape.json', '/abs/package.json', 'a/x.txt', './b.txt', 'C:\\pkg.json'],
      readText: () => undefined,
    });
    expect(inventory.files).toEqual(['a/x.txt', 'b.txt']);
  });

  it('returns text only for declaration files and never reads other files', () => {
    const readText = vi.fn((path: string) => `content of ${path}`);
    const inventory = createInventory({
      files: ['package.json', 'README.md', 'src/main.ts', 'skills/a/SKILL.md'],
      readText,
    });
    expect(readText.mock.calls.map(([path]) => path).toSorted()).toEqual(['package.json', 'skills/a/SKILL.md']);
    expect(inventory.text('package.json')).toBe('content of package.json');
    expect(inventory.text('README.md')).toBeUndefined();
    expect(inventory.text('src/main.ts')).toBeUndefined();
    expect(inventory.text('not-listed/package.json')).toBeUndefined();
    expect(inventory.text('../package.json')).toBeUndefined();
  });

  it('does not read a file that was only suggested by a README', () => {
    const readText = vi.fn(() => 'x');
    createInventory({ files: ['README.md', 'docs/setup.md', 'install.sh'], readText });
    expect(readText).not.toHaveBeenCalled();
  });

  it('caps a declaration file at 256 KB and a userscript at its first 8 KB', () => {
    const inventory = createInventory({
      files: ['package.json', 'tool.user.js'],
      readText: (path) =>
        path === 'package.json' ? 'a'.repeat(MAX_DECLARATION_CHARS + 500) : `b${'c'.repeat(20_000)}`,
    });
    expect(inventory.text('package.json')?.length).toBe(MAX_DECLARATION_CHARS);
    expect(inventory.text('tool.user.js')?.length).toBe(MAX_USERSCRIPT_CHARS);
    expect(inventory.text('tool.user.js')?.startsWith('b')).toBe(true);
  });

  it('stops returning text past 32 MB in total and lists the skipped files in overflow', () => {
    const files = Array.from({ length: 150 }, (_, index) => `pkg${String(index).padStart(3, '0')}/package.json`);
    const block = 'x'.repeat(MAX_DECLARATION_CHARS);
    const inventory = createInventory({ files, readText: () => block });
    const fits = Math.floor(MAX_TOTAL_CHARS / MAX_DECLARATION_CHARS);
    expect(fits).toBe(128);
    expect(inventory.overflow).toEqual(files.slice(fits));
    expect(inventory.text(files[0] as string)).toBe(block);
    expect(inventory.text(files[fits - 1] as string)).toBe(block);
    expect(inventory.text(files[fits] as string)).toBeUndefined();
    expect(inventory.files).toHaveLength(150);
  });

  it('decides overflow by path order, not by the order text is requested', () => {
    const files = Array.from({ length: 140 }, (_, index) => `d${String(index).padStart(3, '0')}/package.json`);
    const build = () =>
      createInventory({ files: files.toReversed(), readText: () => 'y'.repeat(MAX_DECLARATION_CHARS) });
    const first = build();
    const second = build();
    second.text('d139/package.json');
    expect(second.overflow).toEqual(first.overflow);
  });

  it('keeps going when readText throws or has nothing, and does not count them as overflow', () => {
    const inventory = createInventory({
      files: ['a/package.json', 'b/package.json', 'c/package.json'],
      readText: (path) => {
        if (path.startsWith('a')) throw new Error('boom');
        return path.startsWith('b') ? undefined : '{}';
      },
    });
    expect(inventory.text('a/package.json')).toBeUndefined();
    expect(inventory.text('b/package.json')).toBeUndefined();
    expect(inventory.text('c/package.json')).toBe('{}');
    expect(inventory.overflow).toEqual([]);
  });

  it('keeps sizes only for files that are in the tree', () => {
    const inventory = createInventory({
      files: ['a.txt', 'b.txt'],
      sizes: new Map([
        ['a.txt', 10],
        ['.\\b.txt', 20],
        ['gone.txt', 30],
        ['../x.txt', 40],
      ]),
      readText: () => undefined,
    });
    expect([...inventory.sizes.entries()]).toEqual([
      ['a.txt', 10],
      ['b.txt', 20],
    ]);
  });
});
