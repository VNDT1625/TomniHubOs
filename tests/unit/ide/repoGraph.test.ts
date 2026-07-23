/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the pure intra-repo import-graph builder. Every case exercises
 * `buildGraphFromFiles` directly with in-memory files — no fs, no network — so
 * the parser/resolver behavior is fully deterministic.
 */

import { describe, expect, it } from 'vitest';
import { buildGraphFromFiles, collectRepoFiles } from '@/process/ide/repoGraph';
import type { GraphEdge } from '@/process/ide/repoGraph';

/** Find an edge by from/to (helper for assertions). */
const hasEdge = (edges: GraphEdge[], from: string, to: string): boolean =>
  edges.some((e) => e.from === from && e.to === to);

describe('buildGraphFromFiles', () => {
  it('builds a node for every provided file', () => {
    const graph = buildGraphFromFiles('/repo', [
      { relPath: 'src/a.ts', content: '' },
      { relPath: 'src/b.ts', content: '' },
      { relPath: 'README.md', content: '# hi' },
    ]);

    expect(graph.nodes).toHaveLength(3);
    expect(graph.fileCount).toBe(3);
    expect(graph.rootPath).toBe('/repo');
    expect(graph.truncated).toBe(false);
    const ids = graph.nodes.map((n) => n.id).toSorted();
    expect(ids).toEqual(['README.md', 'src/a.ts', 'src/b.ts']);
    // label is the basename, group is the top-level folder (or extension at root)
    const a = graph.nodes.find((n) => n.id === 'src/a.ts');
    expect(a?.label).toBe('a.ts');
    expect(a?.group).toBe('src');
    const readme = graph.nodes.find((n) => n.id === 'README.md');
    expect(readme?.group).toBe('.md');
  });

  it('resolves a relative `./a` import to a.ts', () => {
    const graph = buildGraphFromFiles('/repo', [
      { relPath: 'src/index.ts', content: "import { a } from './a';" },
      { relPath: 'src/a.ts', content: 'export const a = 1;' },
    ]);

    expect(hasEdge(graph.edges, 'src/index.ts', 'src/a.ts')).toBe(true);
    expect(graph.edges).toHaveLength(1);
  });

  it('resolves a directory specifier `./dir` to ./dir/index.ts', () => {
    const graph = buildGraphFromFiles('/repo', [
      { relPath: 'src/main.ts', content: "import helpers from './dir';" },
      { relPath: 'src/dir/index.ts', content: 'export default {};' },
    ]);

    expect(hasEdge(graph.edges, 'src/main.ts', 'src/dir/index.ts')).toBe(true);
    expect(graph.edges).toHaveLength(1);
  });

  it('ignores bare/package imports (no edge to react)', () => {
    const graph = buildGraphFromFiles('/repo', [
      {
        relPath: 'src/app.ts',
        content: "import React from 'react';\nimport x from '@scope/x';\nimport { b } from './b';",
      },
      { relPath: 'src/b.ts', content: 'export const b = 2;' },
    ]);

    // No node and no edge for bare packages.
    expect(graph.nodes.some((n) => n.id === 'react')).toBe(false);
    expect(graph.edges.some((e) => e.to === 'react')).toBe(false);
    expect(graph.edges.some((e) => e.to === '@scope/x')).toBe(false);
    // The intra-repo edge is still captured.
    expect(hasEdge(graph.edges, 'src/app.ts', 'src/b.ts')).toBe(true);
    expect(graph.edges).toHaveLength(1);
  });

  it('resolves the workspace TypeScript aliases to unique source files', () => {
    const graph = buildGraphFromFiles('/repo', [
      {
        relPath: 'packages/desktop/src/renderer/pages/chat/send.ts',
        content: [
          "import { ipcBridge } from '@/common/adapter/ipcBridge';",
          "import { service } from '@process/services/chat/service';",
          "import { view } from '@renderer/pages/chat/view';",
          "const worker = import('@worker/index');",
        ].join('\n'),
      },
      { relPath: 'packages/desktop/src/common/adapter/ipcBridge.ts', content: 'export const ipcBridge = {};' },
      { relPath: 'packages/desktop/src/process/services/chat/service.ts', content: 'export const service = {};' },
      { relPath: 'packages/desktop/src/renderer/pages/chat/view.tsx', content: 'export const view = {};' },
      { relPath: 'packages/desktop/src/process/worker/index.ts', content: 'export default {};' },
    ]);

    expect(
      hasEdge(
        graph.edges,
        'packages/desktop/src/renderer/pages/chat/send.ts',
        'packages/desktop/src/common/adapter/ipcBridge.ts'
      )
    ).toBe(true);
    expect(
      hasEdge(
        graph.edges,
        'packages/desktop/src/renderer/pages/chat/send.ts',
        'packages/desktop/src/process/services/chat/service.ts'
      )
    ).toBe(true);
    expect(
      hasEdge(
        graph.edges,
        'packages/desktop/src/renderer/pages/chat/send.ts',
        'packages/desktop/src/renderer/pages/chat/view.tsx'
      )
    ).toBe(true);
    expect(
      hasEdge(
        graph.edges,
        'packages/desktop/src/renderer/pages/chat/send.ts',
        'packages/desktop/src/process/worker/index.ts'
      )
    ).toBe(true);
  });

  it('resolves an aliased directory import to its index file', () => {
    const graph = buildGraphFromFiles('/repo', [
      {
        relPath: 'packages/desktop/src/renderer/app.ts',
        content: "import { createService } from '@process/services/chat';",
      },
      {
        relPath: 'packages/desktop/src/process/services/chat/index.ts',
        content: 'export const createService = () => undefined;',
      },
    ]);

    expect(
      hasEdge(
        graph.edges,
        'packages/desktop/src/renderer/app.ts',
        'packages/desktop/src/process/services/chat/index.ts'
      )
    ).toBe(true);
  });

  it('drops an aliased edge when more than one source root can satisfy it', () => {
    const graph = buildGraphFromFiles('/repo', [
      {
        relPath: 'packages/desktop/src/renderer/app.ts',
        content: "import { value } from '@/common/value';",
      },
      { relPath: 'packages/desktop/src/common/value.ts', content: 'export const value = 1;' },
      { relPath: 'src/common/value.ts', content: 'export const value = 2;' },
    ]);

    expect(graph.edges).toEqual([]);
  });

  it('handles require() and dynamic import()', () => {
    const graph = buildGraphFromFiles('/repo', [
      { relPath: 'src/cjs.ts', content: "const dep = require('./dep');" },
      { relPath: 'src/dep.ts', content: 'module.exports = {};' },
      { relPath: 'src/lazy.ts', content: "const load = () => import('./dep');" },
    ]);

    expect(hasEdge(graph.edges, 'src/cjs.ts', 'src/dep.ts')).toBe(true);
    expect(hasEdge(graph.edges, 'src/lazy.ts', 'src/dep.ts')).toBe(true);
  });

  it('dedupes repeated edges and drops self-edges', () => {
    const graph = buildGraphFromFiles('/repo', [
      {
        relPath: 'src/a.ts',
        // duplicate import of ./b, plus a self require of ./a
        content: "import { b } from './b';\nconst again = require('./b');\nconst me = require('./a');",
      },
      { relPath: 'src/b.ts', content: 'export const b = 1;' },
    ]);

    const aToB = graph.edges.filter((e) => e.from === 'src/a.ts' && e.to === 'src/b.ts');
    expect(aToB).toHaveLength(1);
    // self-edge removed
    expect(graph.edges.some((e) => e.from === e.to)).toBe(false);
  });

  it('keeps every provided file so retrieval can see the whole repo', () => {
    const many = Array.from({ length: 450 }, (_v, i) => ({ relPath: `src/f${i}.ts`, content: '' }));
    const graph = buildGraphFromFiles('/repo', many);

    expect(graph.truncated).toBe(false);
    expect(graph.nodes).toHaveLength(450);
    expect(graph.fileCount).toBe(450);
  });

  it('handles posix path resolution across nested directories', () => {
    const graph = buildGraphFromFiles('/repo', [
      {
        relPath: 'src/features/auth/login.ts',
        content: "import { token } from '../shared/token';\nimport { util } from '../../utils/util';",
      },
      { relPath: 'src/features/shared/token.ts', content: 'export const token = "";' },
      { relPath: 'src/utils/util.ts', content: 'export const util = 1;' },
    ]);

    expect(hasEdge(graph.edges, 'src/features/auth/login.ts', 'src/features/shared/token.ts')).toBe(true);
    expect(hasEdge(graph.edges, 'src/features/auth/login.ts', 'src/utils/util.ts')).toBe(true);
    expect(graph.edges).toHaveLength(2);
  });
});

describe('collectRepoFiles', () => {
  it('skips generated/cache folders and returns files in stable order', async () => {
    const dirs = new Map<string, Array<{ name: string; fullPath: string; isDir: boolean }>>([
      [
        '/repo',
        [
          { name: 'z.ts', fullPath: '/repo/z.ts', isDir: false },
          { name: '.aionui', fullPath: '/repo/.aionui', isDir: true },
          { name: '.omni', fullPath: '/repo/.omni', isDir: true },
          { name: 'src', fullPath: '/repo/src', isDir: true },
          { name: 'target', fullPath: '/repo/target', isDir: true },
          { name: '.mtui', fullPath: '/repo/.mtui', isDir: true },
          { name: '.tmp', fullPath: '/repo/.tmp', isDir: true },
        ],
      ],
      [
        '/repo/src',
        [
          { name: 'b.ts', fullPath: '/repo/src/b.ts', isDir: false },
          { name: 'a.ts', fullPath: '/repo/src/a.ts', isDir: false },
          { name: '.turbo', fullPath: '/repo/src/.turbo', isDir: true },
        ],
      ],
      ['/repo/.aionui', [{ name: 'ignored.ts', fullPath: '/repo/.aionui/ignored.ts', isDir: false }]],
      ['/repo/.omni', [{ name: 'wiki', fullPath: '/repo/.omni/wiki', isDir: true }]],
      [
        '/repo/.omni/wiki',
        [
          { name: 'wiki.json', fullPath: '/repo/.omni/wiki/wiki.json', isDir: false },
          { name: 'overview.md', fullPath: '/repo/.omni/wiki/overview.md', isDir: false },
        ],
      ],
      ['/repo/.mtui', [{ name: 'ignored.ts', fullPath: '/repo/.mtui/ignored.ts', isDir: false }]],
      ['/repo/.tmp', [{ name: 'stale-copy.ts', fullPath: '/repo/.tmp/stale-copy.ts', isDir: false }]],
      ['/repo/target', [{ name: 'ignored.ts', fullPath: '/repo/target/ignored.ts', isDir: false }]],
      ['/repo/src/.turbo', [{ name: 'ignored.ts', fullPath: '/repo/src/.turbo/ignored.ts', isDir: false }]],
    ]);

    const files = await collectRepoFiles('/repo', {
      listDir: async (dir) => dirs.get(dir) ?? [],
      readFile: async (filePath) => `// ${filePath}`,
      toRel: (full) => full.replace('/repo/', ''),
    });

    expect(files.map((file) => file.relPath)).toEqual(['z.ts', 'src/a.ts', 'src/b.ts']);
  });

  it('honors repository gitignore rules while preserving negated files', async () => {
    const dirs = new Map<string, Array<{ name: string; fullPath: string; isDir: boolean }>>([
      [
        '/repo',
        [
          { name: '.gitignore', fullPath: '/repo/.gitignore', isDir: false },
          { name: 'scratch', fullPath: '/repo/scratch', isDir: true },
          { name: 'src', fullPath: '/repo/src', isDir: true },
        ],
      ],
      ['/repo/scratch', [{ name: 'draft.ts', fullPath: '/repo/scratch/draft.ts', isDir: false }]],
      [
        '/repo/src',
        [
          { name: 'drop.generated.ts', fullPath: '/repo/src/drop.generated.ts', isDir: false },
          { name: 'index.ts', fullPath: '/repo/src/index.ts', isDir: false },
          { name: 'keep.generated.ts', fullPath: '/repo/src/keep.generated.ts', isDir: false },
        ],
      ],
    ]);
    const content = new Map([
      ['/repo/.gitignore', 'scratch/\n*.generated.ts\n!src/keep.generated.ts\n'],
      ['/repo/scratch/draft.ts', 'export const draft = true;'],
      ['/repo/src/drop.generated.ts', 'export const drop = true;'],
      ['/repo/src/index.ts', 'export const canonical = true;'],
      ['/repo/src/keep.generated.ts', 'export const keep = true;'],
    ]);

    const files = await collectRepoFiles('/repo', {
      listDir: async (dir) => dirs.get(dir) ?? [],
      readFile: async (filePath) => content.get(filePath) ?? '',
      toRel: (full) => full.replace('/repo/', ''),
    });

    expect(files.map((file) => file.relPath)).toEqual(['src/index.ts', 'src/keep.generated.ts']);
  });

  it('applies nested gitignore rules relative to their directory', async () => {
    const dirs = new Map<string, Array<{ name: string; fullPath: string; isDir: boolean }>>([
      [
        '/repo',
        [
          { name: '.gitignore', fullPath: '/repo/.gitignore', isDir: false },
          { name: 'root-only.ts', fullPath: '/repo/root-only.ts', isDir: false },
          { name: 'src', fullPath: '/repo/src', isDir: true },
        ],
      ],
      [
        '/repo/src',
        [
          { name: '.gitignore', fullPath: '/repo/src/.gitignore', isDir: false },
          { name: 'local.ts', fullPath: '/repo/src/local.ts', isDir: false },
          { name: 'root-only.ts', fullPath: '/repo/src/root-only.ts', isDir: false },
          { name: 'safe.ts', fullPath: '/repo/src/safe.ts', isDir: false },
        ],
      ],
    ]);
    const content = new Map([
      ['/repo/.gitignore', '/root-only.ts\n'],
      ['/repo/src/.gitignore', 'local.ts\n'],
      ['/repo/root-only.ts', 'export const ignoredAtRoot = true;'],
      ['/repo/src/local.ts', 'export const ignoredLocally = true;'],
      ['/repo/src/root-only.ts', 'export const allowedBelowRoot = true;'],
      ['/repo/src/safe.ts', 'export const safe = true;'],
    ]);

    const files = await collectRepoFiles('/repo', {
      listDir: async (dir) => dirs.get(dir) ?? [],
      readFile: async (filePath) => content.get(filePath) ?? '',
      toRel: (full) => full.replace('/repo/', ''),
    });

    expect(files.map((file) => file.relPath)).toEqual(['src/root-only.ts', 'src/safe.ts']);
  });

  it('unwraps a duplicated single parent folder before collecting files', async () => {
    const dirs = new Map<string, Array<{ name: string; fullPath: string; isDir: boolean }>>([
      [
        '/repo/AI_Education-main',
        [{ name: 'AI_Education-main', fullPath: '/repo/AI_Education-main/AI_Education-main', isDir: true }],
      ],
      [
        '/repo/AI_Education-main/AI_Education-main',
        [{ name: 'frontend', fullPath: '/repo/AI_Education-main/AI_Education-main/frontend', isDir: true }],
      ],
      [
        '/repo/AI_Education-main/AI_Education-main/frontend',
        [{ name: 'lib', fullPath: '/repo/AI_Education-main/AI_Education-main/frontend/lib', isDir: true }],
      ],
      [
        '/repo/AI_Education-main/AI_Education-main/frontend/lib',
        [
          {
            name: 'client.ts',
            fullPath: '/repo/AI_Education-main/AI_Education-main/frontend/lib/client.ts',
            isDir: false,
          },
        ],
      ],
    ]);

    const files = await collectRepoFiles('/repo/AI_Education-main', {
      listDir: async (dir) => dirs.get(dir) ?? [],
      readFile: async (filePath) => `// ${filePath}`,
      toRel: (full) => full.replace('/repo/AI_Education-main/', ''),
    });

    expect(files).toEqual([
      {
        relPath: 'frontend/lib/client.ts',
        content: '// /repo/AI_Education-main/AI_Education-main/frontend/lib/client.ts',
      },
    ]);
  });

  it('does not walk generated .omni/wiki exports', async () => {
    const visited: string[] = [];
    const files = await collectRepoFiles('/repo', {
      listDir: async (dir) => {
        visited.push(dir);
        if (dir === '/repo') {
          return [
            { name: '.omni', fullPath: '/repo/.omni', isDir: true },
            { name: 'src', fullPath: '/repo/src', isDir: true },
          ];
        }
        if (dir === '/repo/.omni') {
          return [{ name: 'wiki', fullPath: '/repo/.omni/wiki', isDir: true }];
        }
        if (dir === '/repo/.omni/wiki') {
          return [{ name: 'wiki.json', fullPath: '/repo/.omni/wiki/wiki.json', isDir: false }];
        }
        if (dir === '/repo/src') {
          return [{ name: 'index.ts', fullPath: '/repo/src/index.ts', isDir: false }];
        }
        return [];
      },
      readFile: async (filePath) => `content:${filePath}`,
      toRel: (full) => full.replace('/repo/', ''),
    });

    expect(visited).not.toContain('/repo/.omni');
    expect(visited).not.toContain('/repo/.omni/wiki');
    expect(files.map((file) => file.relPath)).toEqual(['src/index.ts']);
  });

  it('caps retained readable content per file', async () => {
    const files = await collectRepoFiles(
      '/repo',
      {
        listDir: async () => [{ name: 'index.ts', fullPath: '/repo/index.ts', isDir: false }],
        readFile: async () => '0123456789',
        toRel: (full) => full.replace('/repo/', ''),
      },
      { maxReadBytes: 4 }
    );

    expect(files).toEqual([{ relPath: 'index.ts', content: '0123' }]);
  });

  it('reads selected non-code text files when collecting repository metadata', async () => {
    const files = await collectRepoFiles(
      '/repo',
      {
        listDir: async () => [
          { name: 'README.md', fullPath: '/repo/README.md', isDir: false },
          { name: 'logo.png', fullPath: '/repo/logo.png', isDir: false },
        ],
        readFile: async (filePath) => `content:${filePath}`,
        toRel: (full) => full.replace('/repo/', ''),
      },
      { codeOnly: false, readContent: (relPath) => relPath.endsWith('.md') }
    );

    expect(files).toEqual([
      { relPath: 'logo.png', content: '' },
      { relPath: 'README.md', content: 'content:/repo/README.md' },
    ]);
  });
});
