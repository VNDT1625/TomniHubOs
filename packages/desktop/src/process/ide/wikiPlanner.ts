/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure planning helpers for the DeepWiki-style "generate a wiki" IDE feature.
 *
 * Generating a useful codebase wiki from an arbitrary repo is fundamentally a
 * SELECTION problem: a repo can hold hundreds of files but a single model call
 * has a finite context budget. This module turns a scanned {@link RepoGraph}
 * (plus a few well-known meta files) into:
 *
 *   1. A ranked shortlist of the most architecturally significant files
 *      ({@link selectKeyFiles}) — entry points, config/manifest files, and the
 *      highest in-degree "hub" modules the rest of the repo imports.
 *   2. A deterministic outline of wiki sections ({@link planWikiSections}) the
 *      model is asked to write, derived from what the repo actually contains
 *      (overview always; architecture + module map when there are modules; data
 *      model / API / build sections when tell-tale files exist).
 *
 * Everything here is a PURE function of its inputs (no fs, no network, no
 * `node:path`) so it is trivially unit-testable and reusable; the bridge does
 * the IO and the model call.
 *
 * Process boundary: Main-process (Node.js) module, but DOM-free and IO-free.
 */

import type { RepoGraph } from './repoGraph';
import type { KnowledgeGraph, KnowledgeNode } from './understandTypes';
import type { PersistedWiki } from './wiki/wikiStore';

/** A file the planner deems worth feeding to the model, with why it was picked. */
export type KeyFile = {
  /** Repo-relative, forward-slash path. */
  path: string;
  /** Why this file was selected (drives ordering + the UI "evidence" list). */
  reason: 'entry' | 'manifest' | 'doc' | 'hub' | 'source';
  /** In-degree (how many modules import it); 0 for non-graph meta files. */
  degree: number;
};

/** A single planned wiki section the model is asked to author. */
export type WikiSectionPlan = {
  /** Stable id (anchor / dedupe key). */
  id: string;
  /** i18n key suffix under `ide.wiki.section.*` for the human title. */
  titleKey: string;
  /** Short instruction injected into the prompt telling the model what to cover. */
  brief: string;
};

/** Compact, evidence-backed testing advice derived from the live graph plus the saved Wiki. */
export type WikiTestProfile = {
  source: 'live-graph' | 'wiki+live-graph';
  strategy: 'unit' | 'unit-dom' | 'integration' | 'runtime';
  targetFiles: string[];
  targetSymbols: string[];
  testFiles: string[];
  fixtureSymbols: string[];
  behaviorHints: string[];
  testCommands: string[];
  typecheckCommands: string[];
  verificationGates: string[];
  deepRuntimeRecommended: boolean;
  confidence: 'high' | 'medium' | 'low';
  freshness: {
    graphBuiltAt: number;
    wikiBuiltAt?: number;
    graphFresh: boolean;
    wikiFresh: boolean;
    targetFingerprints: Record<string, string>;
  };
};

/** Inputs for {@link buildWikiTestProfile}. */
export type WikiTestProfileRequest = {
  graph: KnowledgeGraph;
  wiki?: PersistedWiki | null;
  intent: string;
  targetFiles?: string[];
  symbols?: string[];
  graphFresh?: boolean;
};

/** Well-known manifest/config basenames that describe how a repo is built/run. */
const MANIFEST_FILES = new Set([
  'package.json',
  'cargo.toml',
  'go.mod',
  'pyproject.toml',
  'pom.xml',
  'build.gradle',
  'composer.json',
  'gemfile',
  'requirements.txt',
  'tsconfig.json',
  'pubspec.yaml',
  'deno.json',
  'dockerfile',
  'compose.yaml',
  'compose.yml',
  'docker-compose.yaml',
  'docker-compose.yml',
  'makefile',
  'justfile',
  'procfile',
  'turbo.json',
  'nx.json',
  'lerna.json',
  'pnpm-workspace.yaml',
]);

/** Basenames (lowercased) that usually mark a program's entry point. */
const ENTRY_BASENAMES = new Set([
  'index.ts',
  'index.tsx',
  'index.js',
  'main.ts',
  'main.tsx',
  'main.js',
  'main.py',
  'main.go',
  'main.rs',
  'app.ts',
  'app.tsx',
  'app.py',
  'server.ts',
  'server.js',
  'cli.ts',
  'cli.js',
  '__main__.py',
  'mod.rs',
  'lib.rs',
]);

/** Doc basenames worth grounding the overview on. */
const DOC_BASENAMES = new Set(['readme.md', 'readme', 'readme.txt', 'architecture.md', 'contributing.md', 'docs.md']);

/** Tell-tale path fragments that imply a data layer worth its own section. */
const DATA_HINTS = ['schema', 'migration', 'entity', 'entities', 'model', 'models', 'prisma', '.sql'];

/** Tell-tale path fragments that imply an HTTP/API surface worth its own section. */
const API_HINTS = ['route', 'router', 'controller', 'endpoint', 'api/', 'handler', 'graphql', 'resolver'];

/** Minimal scanned file shape used to build deterministic runtime grounding. */
export type RuntimeInventoryFile = { relPath: string; content: string };

const RUNTIME_CONFIG_FILES = new Set([
  'dockerfile',
  'compose.yaml',
  'compose.yml',
  'docker-compose.yaml',
  'docker-compose.yml',
  'makefile',
  'justfile',
  'procfile',
  'turbo.json',
  'nx.json',
  'lerna.json',
  'pnpm-workspace.yaml',
]);

/**
 * Build compact, deterministic grounding for every independently runnable
 * workspace and orchestration file. Unlike key-file selection this does not
 * silently drop later workspace manifests when a monorepo exceeds the general
 * Wiki evidence limit.
 */
export const buildRuntimeInventory = (files: readonly RuntimeInventoryFile[], limitChars = 16_000): string => {
  const sections: string[] = [];
  let remaining = Math.max(0, limitChars);
  const append = (path: string, body: string): void => {
    if (remaining <= 0 || body.length === 0) return;
    const header = `### ${path}\n`;
    if (header.length >= remaining) return;
    const allowance = remaining - header.length;
    const clipped = body.length > allowance ? `${body.slice(0, Math.max(0, allowance - 12))}\n[truncated]` : body;
    sections.push(`${header}${clipped}`);
    remaining -= header.length + clipped.length + 2;
  };

  for (const file of files) {
    const path = file.relPath.replace(/\\/g, '/').replace(/^\.\//, '');
    const basename = basenameOf(path).toLowerCase();
    if (basename === 'package.json') {
      try {
        const pkg = JSON.parse(file.content) as {
          name?: unknown;
          packageManager?: unknown;
          scripts?: Record<string, unknown>;
          workspaces?: unknown;
        };
        const scripts = Object.entries(pkg.scripts ?? {}).filter((entry): entry is [string, string] => {
          return typeof entry[1] === 'string';
        });
        if (scripts.length === 0 && pkg.workspaces === undefined) continue;
        const lines = [
          ...(typeof pkg.name === 'string' ? [`name: ${pkg.name}`] : []),
          ...(typeof pkg.packageManager === 'string' ? [`packageManager: ${pkg.packageManager}`] : []),
          ...(pkg.workspaces !== undefined ? [`workspaces: ${JSON.stringify(pkg.workspaces)}`] : []),
          ...scripts.map(([name, command]) => `script ${name}: ${command}`),
        ];
        append(path, lines.join('\n'));
      } catch {
        append(path, file.content);
      }
      continue;
    }
    if (RUNTIME_CONFIG_FILES.has(basename)) append(path, file.content);
  }
  return sections.join('\n\n');
};

/** Basename (last forward-slash segment) of a relative path. */
const basenameOf = (relPath: string): string => {
  const slash = relPath.lastIndexOf('/');
  return slash >= 0 ? relPath.slice(slash + 1) : relPath;
};

/** Compute in-degree (imported-by count) for every node in the graph. */
const inDegrees = (graph: RepoGraph): Map<string, number> => {
  const indeg = new Map<string, number>();
  for (const node of graph.nodes) indeg.set(node.id, 0);
  for (const edge of graph.edges) {
    if (indeg.has(edge.to)) indeg.set(edge.to, (indeg.get(edge.to) ?? 0) + 1);
  }
  return indeg;
};

/**
 * Rank the most architecturally significant files in a scanned repo.
 *
 * Selection order (highest priority first), de-duplicated by path and capped at
 * `limit`: README/docs, manifest/config files, conventional entry points, then
 * the highest in-degree "hub" modules. Pure function of the graph + the list of
 * meta (non-code) file paths discovered alongside it.
 */
export const selectKeyFiles = (graph: RepoGraph, metaPaths: string[], limit: number): KeyFile[] => {
  const indeg = inDegrees(graph);
  const seen = new Set<string>();
  const picked: KeyFile[] = [];

  const add = (path: string, reason: KeyFile['reason'], degree: number): void => {
    const rel = path.replace(/\\/g, '/').replace(/^\.\//, '');
    if (seen.has(rel) || picked.length >= limit) return;
    seen.add(rel);
    picked.push({ path: rel, reason, degree });
  };

  const allPaths = [...metaPaths.map((p) => p.replace(/\\/g, '/')), ...graph.nodes.map((n) => n.id)];

  const docs = allPaths.filter((path) => DOC_BASENAMES.has(basenameOf(path).toLowerCase()));
  const docQuota = Math.min(docs.length, Math.max(1, Math.floor(limit / 4)));

  // 1) A bounded doc sample — enough for intent without crowding out code.
  for (const path of docs.slice(0, docQuota)) add(path, 'doc', indeg.get(path) ?? 0);
  // 2) Manifests / build config.
  for (const path of allPaths) {
    if (MANIFEST_FILES.has(basenameOf(path).toLowerCase())) add(path, 'manifest', indeg.get(path) ?? 0);
  }
  // 3) Entry points.
  for (const path of graph.nodes.map((n) => n.id)) {
    if (ENTRY_BASENAMES.has(basenameOf(path).toLowerCase())) add(path, 'entry', indeg.get(path) ?? 0);
  }
  // 4) Hubs — most-imported modules, by in-degree desc (stable tiebreak).
  const hubs = [...graph.nodes]
    .map((n) => ({ id: n.id, degree: indeg.get(n.id) ?? 0 }))
    .filter((n) => n.degree > 0)
    .toSorted((a, b) => (b.degree - a.degree !== 0 ? b.degree - a.degree : a.id.localeCompare(b.id)));
  for (const hub of hubs) add(hub.id, 'hub', hub.degree);

  // 5) Fall back to source files for flat repos with no conventional entry or imports.
  for (const node of graph.nodes) add(node.id, 'source', indeg.get(node.id) ?? 0);

  // 6) Reuse any remaining capacity for additional documentation.
  for (const path of docs.slice(docQuota)) add(path, 'doc', indeg.get(path) ?? 0);

  return picked;
};

/** Whether any path in the repo matches one of the given fragment hints. */
const anyPathMatches = (paths: string[], hints: string[]): boolean =>
  paths.some((p) => hints.some((h) => p.toLowerCase().includes(h)));

/**
 * Derive the wiki outline from what the repo actually contains. The overview +
 * architecture + module-map sections are always planned; data-model / API /
 * build sections are added only when matching files exist, so the wiki reflects
 * the real shape of the project rather than a fixed template.
 */
export const planWikiSections = (graph: RepoGraph, metaPaths: string[]): WikiSectionPlan[] => {
  const allPaths = [...metaPaths, ...graph.nodes.map((n) => n.id)];
  const groups = Array.from(new Set(graph.nodes.map((n) => n.group)));

  const sections: WikiSectionPlan[] = [
    {
      id: 'overview',
      titleKey: 'overview',
      brief:
        'A high-level overview: what this project is, the problem it solves, its primary technologies, and how to run it. Ground this in the README and manifest files.',
    },
    {
      id: 'architecture',
      titleKey: 'architecture',
      brief:
        'The system architecture: the major layers/components, how control and data flow between them, and the key design decisions. Include a Mermaid `graph` or `flowchart` diagram of the high-level components.',
    },
  ];

  if (groups.length > 1) {
    sections.push({
      id: 'modules',
      titleKey: 'modules',
      brief: `A module map of the top-level folders (${groups.slice(0, 12).join(', ')}). For each, state its responsibility and its most important files.`,
    });
  }

  if (anyPathMatches(allPaths, DATA_HINTS)) {
    sections.push({
      id: 'dataModel',
      titleKey: 'dataModel',
      brief:
        'The data model: the main entities/tables/schemas, their key fields, and relationships. Include a Mermaid `erDiagram` when the relationships are clear.',
    });
  }

  if (anyPathMatches(allPaths, API_HINTS)) {
    sections.push({
      id: 'api',
      titleKey: 'api',
      brief:
        'The API / interaction surface: the main endpoints, routes, commands, or public entry functions, what they do, and who calls them.',
    });
  }

  sections.push({
    id: 'buildRun',
    titleKey: 'buildRun',
    brief:
      'How to build, run, test, and contribute. Enumerate every independently required runtime process (web UI, API, workers, queues, databases, emulators, proxies, or other services), its command and working directory, required environment and ports, dependencies between processes, and startup order. State the exact process count needed for a complete working application, and determine whether a single root orchestrator command starts everything or whether multiple commands must run concurrently. Ground this in every relevant manifest, workspace, container, and config file; do not reduce a multi-service project to a generic frontend/backend pair.',
  });

  return sections;
};

const TEST_PATH_RE = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[^/]+$/i;
const FIXTURE_SYMBOL_RE = /^(?:make|create|build|fake|mock|stub|fixture|seed)[A-Z0-9_]|(?:fixture|factory)$/i;
const TEST_COMMAND_RE = /(?:^|\s)(?:test|vitest|jest|pytest|mocha|ava|tap|cargo test|go test)(?:\s|$)/i;
const TYPECHECK_COMMAND_RE = /(?:tsc|typecheck|type-check|check:types)/i;
const RUNTIME_INTENT_RE = /\b(?:browser|cdp|console|electron|network|runtime|screenshot|websocket|android|windows)\b/i;
const TEST_TOKEN_STOPWORDS = new Set([
  'src',
  'source',
  'packages',
  'package',
  'test',
  'tests',
  'spec',
  'index',
  'type',
  'types',
  'util',
  'utils',
]);

const normalizeWikiPath = (value: string): string => value.replace(/\\/g, '/').replace(/^\.\//, '');

const isTestPath = (value: string): boolean => TEST_PATH_RE.test(normalizeWikiPath(value));

const testTokens = (value: string): string[] => {
  const words = normalizeWikiPath(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\.[^./]+$/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !TEST_TOKEN_STOPWORDS.has(word));
  return [...new Set(words)];
};

const targetNodesForProfile = (
  graph: KnowledgeGraph,
  requestedFiles: readonly string[],
  symbols: readonly string[],
  intent: string
): KnowledgeNode[] => {
  const byId = new Map(graph.nodes.map((node) => [normalizeWikiPath(node.id).toLowerCase(), node] as const));
  const selected = new Map<string, KnowledgeNode>();
  for (const file of requestedFiles) {
    const node = byId.get(normalizeWikiPath(file).toLowerCase());
    if (node && !isTestPath(node.id)) selected.set(node.id, node);
  }
  const normalizedSymbols = new Set(symbols.map((symbol) => symbol.toLowerCase()));
  if (selected.size < 4 && normalizedSymbols.size > 0) {
    for (const node of graph.nodes) {
      if (isTestPath(node.id)) continue;
      if (node.symbols.some((symbol) => normalizedSymbols.has(symbol.name.toLowerCase()))) selected.set(node.id, node);
      if (selected.size >= 4) break;
    }
  }
  if (selected.size === 0) {
    const intentTokens = testTokens(intent);
    const ranked = graph.nodes
      .filter((node) => !isTestPath(node.id))
      .map((node) => ({
        node,
        score: testTokens(`${node.id} ${node.summary} ${node.tags.join(' ')}`).filter((token) =>
          intentTokens.includes(token)
        ).length,
      }))
      .filter((candidate) => candidate.score > 0)
      .toSorted((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id));
    for (const candidate of ranked.slice(0, 4)) selected.set(candidate.node.id, candidate.node);
  }
  return [...selected.values()].slice(0, 4);
};

const scoreTestNode = (
  testNode: KnowledgeNode,
  targets: readonly KnowledgeNode[],
  graph: KnowledgeGraph,
  requestedFiles: ReadonlySet<string>,
  intentTokens: readonly string[]
): number => {
  const testId = normalizeWikiPath(testNode.id);
  let score = requestedFiles.has(testId.toLowerCase()) ? 1_000 : 0;
  const testPathTokens = testTokens(testId);
  for (const target of targets) {
    const linked = graph.edges.some(
      (edge) =>
        (edge.from === testNode.id && edge.to === target.id) || (edge.to === testNode.id && edge.from === target.id)
    );
    if (linked) score += 120;
    const shared = testPathTokens.filter((token) => testTokens(target.id).includes(token)).length;
    score += shared * 18;
    if (target.group === testNode.group) score += 2;
    for (const symbol of target.symbols) {
      if (symbol.name.length > 2 && testNode.summary.toLowerCase().includes(symbol.name.toLowerCase())) score += 8;
    }
  }
  score += testPathTokens.filter((token) => intentTokens.includes(token)).length * 3;
  return score;
};

const wikiBehaviorHints = (wiki: PersistedWiki | null | undefined, anchors: readonly string[]): string[] => {
  if (!wiki || anchors.length === 0) return [];
  const normalizedAnchors = anchors.map((anchor) => anchor.toLowerCase()).filter((anchor) => anchor.length > 3);
  const hints: string[] = [];
  for (const section of wiki.sections) {
    for (const rawLine of section.content.split(/\r?\n/)) {
      const line = rawLine
        .replace(/^[#>*\-\s]+/, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (line.length < 24 || line.length > 260) continue;
      const lower = line.toLowerCase();
      if (!normalizedAnchors.some((anchor) => lower.includes(anchor))) continue;
      hints.push(`${section.titleKey}: ${line}`);
      if (hints.length >= 3) return hints;
    }
  }
  return hints;
};

const uniqueLimited = (values: readonly string[], limit: number): string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);

/**
 * Build a compact testing profile from the current knowledge graph and optional durable Wiki.
 * Wiki prose is retained only as labelled hints; graph paths, symbols, fingerprints and commands
 * remain the executable evidence so stale documentation cannot silently become an assertion.
 */
export const buildWikiTestProfile = (request: WikiTestProfileRequest): WikiTestProfile | null => {
  const requestedFiles = uniqueLimited((request.targetFiles ?? []).map(normalizeWikiPath), 12);
  const requestedFileSet = new Set(requestedFiles.map((file) => file.toLowerCase()));
  const requestedSymbols = uniqueLimited(request.symbols ?? [], 8);
  const targets = targetNodesForProfile(request.graph, requestedFiles, requestedSymbols, request.intent);
  const targetFiles = uniqueLimited(
    [...targets.map((node) => node.id), ...requestedFiles.filter((file) => !isTestPath(file))],
    4
  );
  if (targetFiles.length === 0) return null;

  const intentTokens = testTokens(request.intent);
  const testNodes = request.graph.nodes
    .filter((node) => isTestPath(node.id))
    .map((node) => ({
      node,
      score: scoreTestNode(node, targets, request.graph, requestedFileSet, intentTokens),
    }))
    .filter((candidate) => candidate.score > 0)
    .toSorted((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id))
    .slice(0, 5)
    .map((candidate) => candidate.node);
  const explicitTests = requestedFiles.filter(isTestPath);
  const testFiles = uniqueLimited([...explicitTests, ...testNodes.map((node) => node.id)], 5);
  const selectedTestNodes = testFiles
    .map((file) => request.graph.nodes.find((node) => normalizeWikiPath(node.id) === file))
    .filter((node): node is KnowledgeNode => Boolean(node));
  const fixtureSymbols = uniqueLimited(
    selectedTestNodes.flatMap((node) =>
      node.symbols.map((symbol) => symbol.name).filter((name) => FIXTURE_SYMBOL_RE.test(name))
    ),
    6
  );
  const testBehaviorHints = selectedTestNodes
    .map((node) => node.summary.trim())
    .filter((summary) => summary.length > 16);
  const anchors = uniqueLimited(
    [
      ...targetFiles.flatMap(testTokens),
      ...requestedSymbols,
      ...targets.flatMap((node) => node.symbols.map((s) => s.name)),
    ],
    12
  );
  const wikiHints = wikiBehaviorHints(request.wiki, anchors);
  const behaviorHints = uniqueLimited(
    [
      ...testBehaviorHints.map((hint) => `Existing test evidence: ${hint}`),
      ...wikiHints.map((hint) => `Wiki hint: ${hint}`),
    ],
    4
  );
  const runCommands = request.graph.runbook?.commands ?? [];
  const testCommands = uniqueLimited(
    runCommands
      .filter((command) => command.kind === 'test' || TEST_COMMAND_RE.test(`${command.name} ${command.command}`))
      .map((command) => `${command.cwd || '.'}: ${command.command}`),
    3
  );
  const typecheckCommands = uniqueLimited(
    runCommands
      .filter((command) => TYPECHECK_COMMAND_RE.test(`${command.name} ${command.command}`))
      .map((command) => `${command.cwd || '.'}: ${command.command}`),
    2
  );
  const hasDomTest = testFiles.some((file) => /\.dom\.(?:test|spec)\./i.test(file));
  const hasUiTarget = targets.some((node) => node.layer === 'ui');
  const runtimeIntent = RUNTIME_INTENT_RE.test(request.intent);
  const deterministicTargetAvailable = testFiles.length > 0;
  const strategy: WikiTestProfile['strategy'] =
    hasDomTest || hasUiTarget
      ? 'unit-dom'
      : deterministicTargetAvailable
        ? 'unit'
        : runtimeIntent
          ? 'runtime'
          : 'integration';
  const deepRuntimeRecommended = runtimeIntent && !deterministicTargetAvailable;
  const primaryTest = testFiles[0];
  const verificationGates = [
    primaryTest
      ? `Add the smallest failing behavior assertion in ${primaryTest} and confirm it fails before editing.`
      : 'Create a bounded deterministic reproduction and confirm it fails before editing.',
    'After the edit, rerun the identical reproduction before broader checks.',
    testCommands.length > 0
      ? `Run the focused repository test command (${testCommands[0]}).`
      : 'Run the nearest focused framework test.',
    typecheckCommands.length > 0
      ? `Run the repository typecheck (${typecheckCommands[0]}).`
      : 'Run the repository typecheck when the changed language supports it.',
  ];
  const graphFresh = request.graphFresh !== false;
  const wikiFresh = Boolean(request.wiki && request.wiki.builtAt >= request.graph.builtAt && graphFresh);
  const targetFingerprints = Object.fromEntries(
    targets.flatMap((node) => (node.fingerprint ? [[node.id, node.fingerprint] as const] : []))
  );
  const confidence: WikiTestProfile['confidence'] =
    graphFresh && testFiles.length > 0 && (fixtureSymbols.length > 0 || testCommands.length > 0)
      ? 'high'
      : graphFresh && testFiles.length > 0
        ? 'medium'
        : 'low';

  return {
    source: request.wiki ? 'wiki+live-graph' : 'live-graph',
    strategy,
    targetFiles,
    targetSymbols: requestedSymbols,
    testFiles,
    fixtureSymbols,
    behaviorHints,
    testCommands,
    typecheckCommands,
    verificationGates,
    deepRuntimeRecommended,
    confidence,
    freshness: {
      graphBuiltAt: request.graph.builtAt,
      wikiBuiltAt: request.wiki?.builtAt,
      graphFresh,
      wikiFresh,
      targetFingerprints,
    },
  };
};

/** Render a token-bounded profile for direct inclusion in an agent research pack. */
export const renderWikiTestProfile = (profile: WikiTestProfile): string => {
  const lines = [
    '## Wiki-guided test profile',
    `Evidence: ${profile.source}; confidence=${profile.confidence}; graph=${profile.freshness.graphFresh ? 'current' : 'stale'}; wiki=${profile.freshness.wikiFresh ? 'current' : profile.source === 'live-graph' ? 'absent' : 'stale-hints-only'}.`,
    `Strategy: ${profile.strategy}. Deep runtime evidence: ${profile.deepRuntimeRecommended ? 'recommended after deterministic checks' : 'not required unless the focused reproduction cannot observe the failure'}.`,
    `Targets: ${profile.targetFiles.join(', ')}`,
    `Nearest tests: ${profile.testFiles.join(', ') || '(none found; create a focused regression near the target)'}`,
    ...(profile.fixtureSymbols.length > 0 ? [`Reusable fixture helpers: ${profile.fixtureSymbols.join(', ')}`] : []),
    ...(profile.behaviorHints.length > 0
      ? [
          'Behavior hints (not assertions; verify against current source/tests):',
          ...profile.behaviorHints.map((hint) => `- ${hint}`),
        ]
      : []),
    ...(profile.testCommands.length > 0
      ? ['Known test commands:', ...profile.testCommands.map((command) => `- ${command}`)]
      : []),
    ...(profile.typecheckCommands.length > 0
      ? ['Known typecheck commands:', ...profile.typecheckCommands.map((command) => `- ${command}`)]
      : []),
    'Verification gates:',
    ...profile.verificationGates.map((gate, index) => `${index + 1}. ${gate}`),
  ];
  return lines.join('\n').slice(0, 3_200);
};
