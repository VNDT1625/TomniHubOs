/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the pure DeepWiki-style planning helpers (`selectKeyFiles` +
 * `planWikiSections`). These exercise the selection/outline logic directly with
 * in-memory graphs — no fs, no network, no model — so behaviour is fully
 * deterministic.
 */

import { describe, expect, it } from 'vitest';
import {
  buildRuntimeInventory,
  buildWikiTestProfile,
  planWikiSections,
  renderWikiTestProfile,
  selectKeyFiles,
} from '@/process/ide/wikiPlanner';

import { runWikiBootstrap } from '@/process/ide/wiki/wikiBootstrap';
import type { RepoGraph } from '@/process/ide/repoGraph';
import type { KnowledgeGraph } from '@/process/ide/understandTypes';
import type { PersistedWiki } from '@/process/ide/wiki/wikiStore';

/** Build a minimal RepoGraph for tests. */
const makeGraph = (
  nodes: Array<{ id: string; label: string; group: string }>,
  edges: Array<{ from: string; to: string }>
): RepoGraph => ({
  nodes,
  edges,
  rootPath: '/repo',
  fileCount: nodes.length,
  truncated: false,
});

describe('selectKeyFiles', () => {
  it('prioritises docs, then manifests, then entry points, then hubs', () => {
    const graph = makeGraph(
      [
        { id: 'src/index.ts', label: 'index.ts', group: 'src' },
        { id: 'src/util.ts', label: 'util.ts', group: 'src' },
        { id: 'src/other.ts', label: 'other.ts', group: 'src' },
      ],
      [
        { from: 'src/index.ts', to: 'src/util.ts' },
        { from: 'src/other.ts', to: 'src/util.ts' },
      ]
    );
    const picked = selectKeyFiles(graph, ['README.md', 'package.json'], 18);
    const order = picked.map((p) => p.reason);

    expect(picked[0]).toMatchObject({ path: 'README.md', reason: 'doc' });
    expect(picked[1]).toMatchObject({ path: 'package.json', reason: 'manifest' });
    // index.ts is an entry point; util.ts is the highest-degree hub.
    expect(order).toContain('entry');
    expect(picked.find((p) => p.path === 'src/util.ts')?.reason).toBe('hub');
    // util.ts (in-degree 2) ranks above any degree-0 hub.
    expect(picked.find((p) => p.path === 'src/util.ts')?.degree).toBe(2);
  });

  it('de-duplicates and respects the limit', () => {
    // d.ts imports a, b, c → all three are hubs (in-degree 1); cap to 2.
    const graph = makeGraph(
      [
        { id: 'a.ts', label: 'a.ts', group: '.ts' },
        { id: 'b.ts', label: 'b.ts', group: '.ts' },
        { id: 'c.ts', label: 'c.ts', group: '.ts' },
        { id: 'd.ts', label: 'd.ts', group: '.ts' },
      ],
      [
        { from: 'd.ts', to: 'a.ts' },
        { from: 'd.ts', to: 'b.ts' },
        { from: 'd.ts', to: 'c.ts' },
      ]
    );
    const picked = selectKeyFiles(graph, [], 2);
    expect(picked.length).toBe(2);
    const paths = picked.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('returns an empty list for an empty graph and no meta files', () => {
    expect(selectKeyFiles(makeGraph([], []), [], 18)).toEqual([]);
  });

  it('keeps code evidence when a repository contains many README files', () => {
    const graph = makeGraph(
      [
        { id: 'src/index.ts', label: 'index.ts', group: 'src' },
        { id: 'src/core.ts', label: 'core.ts', group: 'src' },
      ],
      [{ from: 'src/index.ts', to: 'src/core.ts' }]
    );
    const docs = Array.from({ length: 20 }, (_, index) => `packages/p${index}/README.md`);
    const picked = selectKeyFiles(graph, [...docs, 'package.json'], 16);

    expect(picked.some((file) => file.reason === 'manifest')).toBe(true);
    expect(picked.some((file) => file.reason === 'entry')).toBe(true);
    expect(picked.some((file) => file.reason === 'hub')).toBe(true);
  });

  it('falls back to source files when a flat repository has no entry points or import hubs', () => {
    const graph = makeGraph(
      [
        { id: 'src/feature.ts', label: 'feature.ts', group: 'src' },
        { id: 'src/helper.ts', label: 'helper.ts', group: 'src' },
      ],
      []
    );

    const picked = selectKeyFiles(graph, ['README.md'], 4);

    expect(picked.some((file) => file.path === 'src/feature.ts' && file.reason === 'source')).toBe(true);
    expect(picked.some((file) => file.path === 'src/helper.ts' && file.reason === 'source')).toBe(true);
  });
});

describe('Wiki-guided test profile', () => {
  const knowledgeGraph = (): KnowledgeGraph => ({
    rootPath: '/repo',
    version: 4,
    builtAt: 200,
    nodes: [
      {
        id: 'packages/desktop/src/process/ide/traceContextBuilder.ts',
        label: 'traceContextBuilder.ts',
        group: 'packages',
        layer: 'service',
        summary: 'Maps runtime trace evidence into a bounded ContextPack.',
        tags: ['trace', 'context'],
        symbols: [{ name: 'buildTraceContext', kind: 'function', line: 120 }],
        language: 'typescript',
        importedBy: 2,
        fingerprint: 'source-fingerprint',
      },
      {
        id: 'tests/unit/ide/traceContextBuilder.test.ts',
        label: 'traceContextBuilder.test.ts',
        group: 'tests',
        layer: 'test',
        summary: 'Covers network route ranking, trace evidence, and bounded context slices.',
        tags: ['vitest'],
        symbols: [
          { name: 'makeTrace', kind: 'function', line: 30 },
          { name: 'unrelatedHelper', kind: 'function', line: 45 },
        ],
        language: 'typescript',
        importedBy: 0,
        fingerprint: 'test-fingerprint',
      },
    ],
    edges: [
      {
        from: 'tests/unit/ide/traceContextBuilder.test.ts',
        to: 'packages/desktop/src/process/ide/traceContextBuilder.ts',
      },
    ],
    tours: [],
    runbook: {
      packageManager: 'bun',
      commands: [
        { name: 'test', command: 'bunx vitest run', cwd: '.', kind: 'test' },
        { name: 'typecheck', command: 'bunx tsc --noEmit', cwd: '.', kind: 'build' },
      ],
      env: [],
      ports: [],
    },
    truncated: false,
    fileCount: 2,
  });

  const staleWiki = (): PersistedWiki => ({
    version: 1,
    rootPath: '/repo',
    builtAt: 100,
    sections: [
      {
        id: 'architecture',
        titleKey: 'architecture',
        content: 'traceContextBuilder maps RuntimeTrace into a focused ContextPack for debugging.',
      },
    ],
    keyFiles: ['packages/desktop/src/process/ide/traceContextBuilder.ts'],
    docReports: [],
  });

  it('selects the nearest deterministic test, reusable fixture, and repository commands', () => {
    const profile = buildWikiTestProfile({
      graph: knowledgeGraph(),
      wiki: staleWiki(),
      intent: 'A network 404 is ranked into unrelated ContextPack slices',
      targetFiles: ['packages/desktop/src/process/ide/traceContextBuilder.ts'],
      symbols: ['buildTraceContext'],
      graphFresh: true,
    });

    expect(profile).not.toBeNull();
    expect(profile).toMatchObject({
      source: 'wiki+live-graph',
      strategy: 'unit',
      deepRuntimeRecommended: false,
      testFiles: ['tests/unit/ide/traceContextBuilder.test.ts'],
    });
    expect(profile?.fixtureSymbols).toContain('makeTrace');
    expect(profile?.testCommands).toContain('.: bunx vitest run');
    expect(profile?.typecheckCommands).toContain('.: bunx tsc --noEmit');
    expect(profile?.freshness).toMatchObject({ graphFresh: true, wikiFresh: false });
  });

  it('labels stale Wiki prose as a hint while keeping live graph evidence authoritative', () => {
    const profile = buildWikiTestProfile({
      graph: knowledgeGraph(),
      wiki: staleWiki(),
      intent: 'Fix buildTraceContext network ranking',
      symbols: ['buildTraceContext'],
    });
    const rendered = renderWikiTestProfile(profile!);

    expect(rendered).toContain('wiki=stale-hints-only');
    expect(rendered).toContain('Behavior hints (not assertions; verify against current source/tests)');
    expect(rendered).toContain('confirm it fails before editing');
  });

  it('returns no plan when neither current files nor symbols identify a testable target', () => {
    const graph = knowledgeGraph();
    graph.nodes = [];
    graph.edges = [];

    expect(buildWikiTestProfile({ graph, intent: 'unrelated unknown concern' })).toBeNull();
  });
});

describe('wiki bootstrap grounding', () => {
  it('sends verified documentation and flat source files to the model without duplicating docs as code', async () => {
    const prompts: string[] = [];
    await runWikiBootstrap(
      '/repo',
      {
        collectFiles: async () => [
          { relPath: 'README.md', content: '# Project documentation' },
          { relPath: 'src/feature.ts', content: 'export const feature = true;' },
        ],
        chat: async (_model, _system, user) => {
          prompts.push(user);
          return 'The implementation in `src/feature.ts` provides the documented project behavior. '.repeat(4);
        },
        writeDoc: async () => undefined,
        saveWiki: async () => undefined,
      },
      { model: 'test-model', fixDocs: false, maxRefineIterations: 0 }
    );

    expect(prompts[0]).toContain('# Project documentation');
    expect(prompts[0]).toContain('export const feature = true;');
    expect(prompts[0].match(/### README\.md/g)).toHaveLength(1);
  });
});
describe('planWikiSections', () => {
  it('always plans overview, architecture and build/run sections', () => {
    const sections = planWikiSections(makeGraph([{ id: 'a.ts', label: 'a.ts', group: 'src' }], []), []);
    const ids = sections.map((s) => s.id);
    expect(ids).toContain('overview');
    expect(ids).toContain('architecture');
    expect(ids).toContain('buildRun');
  });

  it('adds a module map only when there is more than one top-level group', () => {
    const oneGroup = planWikiSections(
      makeGraph(
        [
          { id: 'src/a.ts', label: 'a.ts', group: 'src' },
          { id: 'src/b.ts', label: 'b.ts', group: 'src' },
        ],
        []
      ),
      []
    );
    expect(oneGroup.map((s) => s.id)).not.toContain('modules');

    const twoGroups = planWikiSections(
      makeGraph(
        [
          { id: 'src/a.ts', label: 'a.ts', group: 'src' },
          { id: 'lib/b.ts', label: 'b.ts', group: 'lib' },
        ],
        []
      ),
      []
    );
    expect(twoGroups.map((s) => s.id)).toContain('modules');
  });

  it('adds a data-model section when schema/model files exist', () => {
    const sections = planWikiSections(makeGraph([{ id: 'src/schema.ts', label: 'schema.ts', group: 'src' }], []), []);
    expect(sections.map((s) => s.id)).toContain('dataModel');
  });

  it('adds an API section when route/controller files exist (via meta paths too)', () => {
    const sections = planWikiSections(makeGraph([{ id: 'src/routes/users.ts', label: 'users.ts', group: 'src' }], []), [
      'docs/api.md',
    ]);
    expect(sections.map((s) => s.id)).toContain('api');
  });

  it('requires the build/run section to enumerate the complete runtime topology', () => {
    const sections = planWikiSections(
      makeGraph(
        [
          { id: 'apps/web/src/main.ts', label: 'main.ts', group: 'apps/web' },
          { id: 'services/api/src/server.ts', label: 'server.ts', group: 'services/api' },
          { id: 'services/worker/src/index.ts', label: 'index.ts', group: 'services/worker' },
        ],
        []
      ),
      ['apps/web/package.json', 'services/api/package.json', 'services/worker/package.json']
    );

    const buildRun = sections.find((section) => section.id === 'buildRun');
    expect(buildRun?.brief).toMatch(/every independently required runtime process/i);
    expect(buildRun?.brief).toMatch(/startup order/i);
    expect(buildRun?.brief).toMatch(/single root orchestrator/i);
  });

  it('summarizes every workspace runtime manifest for Wiki grounding', () => {
    const inventory = buildRuntimeInventory([
      {
        relPath: 'apps/web/package.json',
        content: JSON.stringify({ name: 'web', scripts: { dev: 'vite' } }),
      },
      {
        relPath: 'services/api/package.json',
        content: JSON.stringify({ name: 'api', scripts: { dev: 'tsx src/server.ts' } }),
      },
      {
        relPath: 'services/worker/package.json',
        content: JSON.stringify({ name: 'worker', scripts: { start: 'node dist/worker.js' } }),
      },
      {
        relPath: 'compose.yaml',
        content: 'services:\n  postgres:\n    image: postgres:16',
      },
    ]);

    expect(inventory).toContain('apps/web/package.json');
    expect(inventory).toContain('services/api/package.json');
    expect(inventory).toContain('services/worker/package.json');
    expect(inventory).toContain('compose.yaml');
  });

  it('omits data-model and api sections for a plain repo', () => {
    const ids = planWikiSections(makeGraph([{ id: 'src/index.ts', label: 'index.ts', group: 'src' }], []), []).map(
      (s) => s.id
    );
    expect(ids).not.toContain('dataModel');
    expect(ids).not.toContain('api');
  });
});
