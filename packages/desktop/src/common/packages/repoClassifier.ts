/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import semver from 'semver';
import {
  findMcpServerSignals,
  mcpConnectionFromRecipe,
  type McpPublishedRecipe,
} from '../integrations/detectors/agent/mcpPublished';
import { detectRepository } from '../integrations/detectors/repoDetection';
import type { AdapterConnection, AdapterOpenItem } from './adapter';
import { detectServices, findUnclaimedProjects, type DetectedService, type EnvironmentUsage } from './serviceDetector';
import type { PackageManifest, PackageModuleContribution, PackageType } from './types';

/**
 * 7 canonical package archetypes defined in docs/platform/package-taxonomy.md, plus two safe
 * rejections: native code, and a repository with nothing the host could run.
 */
export type RepoArchetype =
  | 'web-surface-app'
  | 'web-service-app'
  | 'ui-theme'
  | 'ide-viewer'
  | 'chat-stage'
  | 'mcp-tool-server'
  | 'agent-skill'
  | 'workflow-capsule'
  | 'service-daemon'
  | 'unsupported-native'
  | 'source-only';

/** Why a classified repository cannot be hosted by this version of the app. */
export type RunnableIssueCode =
  | 'NO_WEB_ENTRYPOINT'
  | 'WEB_NEEDS_BUILD'
  | 'HOST_RUNTIME_MISSING'
  | 'UNSUPPORTED_NATIVE'
  | 'MCP_NO_LAUNCH_RECIPE';

/** How an MCP server published as a package is started: a launcher plus a pinned package name. */
export type McpLaunchRecipe = McpPublishedRecipe;

export type RepoClassificationInput = {
  /** Relative paths of all scanned files in the repository (using forward slashes) */
  files: readonly string[];
  /** Parsed or string content of package.json (if present) */
  packageJson?: Record<string, unknown> | string;
  /** Repository name (e.g. from git or directory name) */
  repositoryName?: string;
  /** Optional publisher identifier, defaults to 'com.community' */
  publisherId?: string;
  /** Sample contents of specific key files for deeper inspection (optional) */
  fileSnippets?: Record<string, string>;
  /** Launch recipe of an MCP server, when the caller found a published package for it. */
  mcpLaunch?: McpLaunchRecipe;
  /** Environment variables the source files read, found by the caller with scanEnvironmentUsage. */
  environmentUsage?: readonly EnvironmentUsage[];
};

export type RepoClassificationResult = {
  readonly archetype: RepoArchetype;
  readonly packageType: PackageType;
  readonly suggestedId: string;
  readonly name: string;
  readonly description: string;
  readonly reasons: readonly string[];
  readonly permissions: readonly string[];
  /** The archetype is part of the package taxonomy. It does not mean this app version can run it. */
  readonly isSupported: boolean;
  /** True when the installed host has a runtime that can actually run the package. */
  readonly runnable: boolean;
  readonly runnableIssueCode?: RunnableIssueCode;
  readonly runnableIssue?: string;
  readonly adminApprovalRequired: boolean;
  readonly entrypoint?: string;
  /** Agent skills: the folders that hold a SKILL.md, relative to the repository; '' is the root itself. */
  readonly skillRoots?: readonly string[];
  /** What the repository offers the app: MCP launch, skills. Packaged into adapter/adapter.json. */
  readonly connections?: readonly AdapterConnection[];
  /** What the rules could not finish; handed to an agent or the user in adapter.json. */
  readonly openItems?: readonly AdapterOpenItem[];
  /** `<id>@<version>` of the detectors that ran, for the document-level `detectors` list of adapter.json. */
  readonly detectors?: readonly string[];
  /** Display label from the detectors' merge (design section 7.5 rule 4). It is not the `archetype`. */
  readonly archetypeLabel?: string;
  readonly manifest: PackageManifest;
};

const SANITIZE_ID_REGEX = /[^a-z0-9.-]/g;

const sanitizePackageIdPart = (value: string): string => {
  const normalized = value.toLowerCase().replace(SANITIZE_ID_REGEX, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized.length > 0 ? normalized : 'app';
};

const parsePackageJsonRecord = (raw?: Record<string, unknown> | string): Record<string, unknown> | undefined => {
  if (!raw) return undefined;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

const hasAnyFile = (files: readonly string[], matcher: (path: string) => boolean): boolean =>
  files.some((file) => matcher(file.toLowerCase()));

const findFile = (files: readonly string[], target: string): string | undefined => {
  const normalized = target.toLowerCase();
  return files.find((file) => file.toLowerCase() === normalized);
};

const fileExists = (files: readonly string[], target: string): boolean => findFile(files, target) !== undefined;

const getDependenciesSet = (pkg?: Record<string, unknown>): Set<string> => {
  const set = new Set<string>();
  if (!pkg) return set;
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const section = pkg[field];
    if (typeof section === 'object' && section !== null) {
      for (const key of Object.keys(section)) {
        set.add(key.toLowerCase());
      }
    }
  }
  return set;
};

// ---------------------------------------------------------------------------
// Web entry point
// ---------------------------------------------------------------------------

/** Folders a static site is commonly published from, in the order they are preferred. */
const WEB_ENTRY_CANDIDATES = ['dist/index.html', 'build/index.html', 'docs/index.html', 'index.html'] as const;

/** A page that loads source files or template placeholders only works after a build step. */
const UNBUILT_PAGE =
  /<script\b[^>]*\bsrc\s*=\s*["'](?:\.?\/)?src\/|<script\b[^>]*\bsrc\s*=\s*["'][^"']+\.(?:tsx?|jsx|vue|svelte)(?:\?[^"']*)?["']|%PUBLIC_URL%|<%[=-]/iu;

export type WebEntryResolution = Readonly<{
  /** A page the sandbox can open as it is. */
  entrypoint?: string;
  /** Only pages that need a build were found. */
  needsBuild: boolean;
  /** The page that needs a build, when there is one. */
  unbuiltEntrypoint?: string;
}>;

/**
 * Finds the page a sandboxed web module can open without a build. Published output (`dist/`,
 * `build/`, `docs/`) wins over a root `index.html`. When no snippet is available the page is assumed
 * to be ready, because nothing says otherwise.
 */
export const resolveWebEntrypoint = (
  files: readonly string[],
  snippets: Readonly<Record<string, string>> = {}
): WebEntryResolution => {
  let unbuilt: string | undefined;
  for (const candidate of WEB_ENTRY_CANDIDATES) {
    const actual = findFile(files, candidate);
    if (actual === undefined) continue;
    const html = snippets[actual];
    if (html !== undefined && UNBUILT_PAGE.test(html)) {
      unbuilt ??= actual;
      continue;
    }
    return { entrypoint: actual, needsBuild: false };
  }
  return { needsBuild: unbuilt !== undefined, ...(unbuilt === undefined ? {} : { unbuiltEntrypoint: unbuilt }) };
};

// ---------------------------------------------------------------------------
// Shared manifest pieces
// ---------------------------------------------------------------------------

type Identity = Readonly<{
  suggestedId: string;
  publisherId: string;
  displayName: string;
  description: string;
  version: string;
  cleanName: string;
}>;

const baseManifest = (identity: Identity, type: PackageType) =>
  ({
    schemaVersion: 1 as const,
    id: identity.suggestedId,
    publisherId: identity.publisherId,
    name: identity.displayName,
    description: identity.description,
    type,
    bundleKind: 'single' as const,
    version: identity.version,
    engines: { tomni: '>=0.0.0' },
  }) satisfies Partial<PackageManifest>;

const placeholderModule = (
  identity: Identity,
  id: string,
  surfaceDirectory: string,
  entrypoint = 'index.html'
): PackageModuleContribution => ({
  id,
  title: identity.displayName,
  surface: `${surfaceDirectory}/${identity.cleanName}`,
  pinnable: false,
  runtime: 'sandboxed-web',
  entrypoint,
});

const SKILL_FILE = /(?:^|\/)skill\.md$/iu;
const SKILL_IGNORED_FOLDER = /(?:^|\/)(?:node_modules|fixtures|__tests__)\//u;

/** Folders that hold a SKILL.md, outermost only; an empty string means the repository root itself. */
const findSkillRoots = (files: readonly string[]): string[] => {
  const roots = files
    .filter((file) => SKILL_FILE.test(file) && !SKILL_IGNORED_FOLDER.test(file))
    .map((file) => file.slice(0, Math.max(0, file.length - 'SKILL.md'.length - 1)))
    .toSorted();
  if (roots.includes('')) return [''];
  const unique = [...new Set(roots)];
  return unique.filter((root) => !unique.some((other) => other !== root && root.startsWith(`${other}/`)));
};

/** The skill folder as it is named inside a package, where the repository sits under source/. */
const skillConnectionFor = (root: string): AdapterConnection => ({
  kind: 'skill',
  path: root === '' ? 'source' : `source/${root}`,
});

/** Connection ids are lowercase tokens; a repository name can start with a dot or be very long. */
const connectionIdFor = (cleanName: string): string => {
  const id = cleanName.replace(/^[^a-z0-9]+/u, '').slice(0, 64);
  return id === '' ? 'app' : id;
};

// A repository with C/C++ files is native only when nothing else is written in it: Flutter, Electron and
// similar tools generate C++ runner files inside apps that are mostly Dart or TypeScript.
const OTHER_SOURCE_EXTENSIONS = [
  '.py',
  '.js',
  '.jsx',
  '.mjs',
  '.ts',
  '.tsx',
  '.dart',
  '.java',
  '.kt',
  '.swift',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.cs',
] as const;

const serviceConnection = (service: DetectedService) => ({
  id: service.id,
  cwd: service.directory === '' ? 'source' : `source/${service.directory}`,
  ...(service.setup.length > 0 ? { setup: service.setup.map((command) => [...command]) } : {}),
  start: [...service.start],
  ready: { port: service.port },
  ...(service.env.length > 0
    ? {
        env: service.env.map((variable) => ({
          name: variable.name,
          required: variable.required,
          ...(variable.hint === undefined ? {} : { hint: variable.hint }),
        })),
      }
    : {}),
});

/** The handoff for a repository with services: values to fill in, projects not understood, a choice to make. */
const openItemsFor = (
  detection: ReturnType<typeof detectServices>,
  connection: string,
  files: readonly string[],
  skillRoots: readonly string[]
): AdapterOpenItem[] => {
  const items: AdapterOpenItem[] = [];
  const embeddable = detection.services.filter((service) => service.embeddable);
  if (embeddable.length > 1) {
    items.push({
      kind: 'choose',
      connection,
      note: `Có ${embeddable.length} giao diện có thể nhúng; đang hiển thị "${detection.embed ?? ''}".`,
      options: embeddable.map((service) => service.id).slice(0, 8),
    });
  }
  for (const service of detection.services) {
    for (const variable of service.env.filter((entry) => entry.required)) {
      items.push({
        kind: 'env-value',
        connection,
        name: variable.name,
        note: `Cần giá trị cho ${variable.name} (dịch vụ ${service.id}).`,
      });
    }
  }
  const claimed = [...detection.services.map((service) => service.directory), ...skillRoots];
  for (const project of findUnclaimedProjects(files, claimed)) {
    items.push({
      kind: 'unrecognized',
      path: `source/${project.directory}`,
      note: `Có ${project.marker} nhưng chưa nhận ra cách chạy hoặc cách nối vào Tomny.`,
    });
  }
  return items.slice(0, 80);
};

const HOST_RUNTIME_MISSING = (label: string): string =>
  `This version of the app has no runtime that can run ${label} from a package yet. The repository was recognized, but packaging it would produce a page that does nothing.`;

/**
 * The legacy archetype rules: picks one archetype and derives its manifest. Connections here are only what these
 * branches know (skills, the MCP launch recipe, services); `classifyRepository` merges the detectors' findings in.
 */
const classifyArchetype = (input: RepoClassificationInput): RepoClassificationResult => {
  const files = input.files.map((file) => file.replaceAll('\\', '/'));
  const pkg = parsePackageJsonRecord(input.packageJson);
  const deps = getDependenciesSet(pkg);
  const snippets = input.fileSnippets ?? {};

  const repoName =
    (typeof pkg?.name === 'string' && pkg.name.trim().length > 0 ? pkg.name.trim() : undefined) ??
    input.repositoryName ??
    'my-package';

  const cleanName = sanitizePackageIdPart(repoName.replace(/^@[^/]+\//, ''));
  const publisherId = input.publisherId ? sanitizePackageIdPart(input.publisherId) : 'com.community';
  const suggestedId = `${publisherId}.${cleanName}`;

  const displayName =
    typeof pkg?.name === 'string' && pkg.name.trim().length > 0
      ? pkg.name
          .replace(/^@[^/]+\//, '')
          .split(/[-_]/)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ')
      : repoName
          .split(/[-_]/)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ');

  const description =
    typeof pkg?.description === 'string' && pkg.description.trim().length > 0
      ? pkg.description.trim()
      : `Automated package for ${displayName}`;

  const version =
    typeof pkg?.version === 'string' && semver.valid(pkg.version.trim()) !== null ? pkg.version.trim() : '1.0.0';

  const identity: Identity = { suggestedId, publisherId, displayName, description, version, cleanName };
  const reasons: string[] = [];

  const skillRoots = findSkillRoots(files);
  const skillConnections = skillRoots.map(skillConnectionFor);

  // 1. MCP Tool Server Detection
  // The signals and the launch connection live in the `mcp-published` detector; this branch only delegates.
  const mcpSignals = findMcpServerSignals({ files, dependencies: deps, snippets });
  const { hasMcpJson } = mcpSignals;

  if (mcpSignals.isMcpServer) {
    reasons.push(...mcpSignals.reasons);

    const launch = input.mcpLaunch;
    const permissions = launch ? ['mcp.server.stdio'] : [];
    if (launch) reasons.push(`Launches with ${launch.command} ${launch.args.join(' ')}`);
    const manifest: PackageManifest = {
      ...baseManifest(identity, 'agent-capsule'),
      modules: [],
      permissions,
      dependencies: [],
      tags: ['mcp', 'tool-server', 'agent-capsule'],
      ...(launch
        ? {
            contributions: {
              version: 1 as const,
              mcpServers: [
                {
                  id: identity.cleanName,
                  title: displayName,
                  description,
                  command: launch.command,
                  args: [...launch.args],
                },
              ],
            },
          }
        : {}),
    };

    return {
      archetype: 'mcp-tool-server',
      packageType: 'agent-capsule',
      suggestedId,
      name: displayName,
      description,
      reasons,
      permissions,
      isSupported: true,
      runnable: launch !== undefined,
      ...(skillRoots.length > 0 ? { skillRoots } : {}),
      connections: [
        ...(launch
          ? [
              mcpConnectionFromRecipe(launch, {
                id: connectionIdFor(identity.cleanName),
                title: displayName,
                description,
              }),
            ]
          : []),
        ...skillConnections,
      ],
      ...(launch
        ? {}
        : {
            runnableIssueCode: 'MCP_NO_LAUNCH_RECIPE' as const,
            runnableIssue:
              'MCP server found, but no published package to start it: it needs a package.json with a name, a version and a bin entry (not private), or a pyproject.toml with scripts.',
          }),
      adminApprovalRequired: false,
      manifest,
    };
  }

  // 1b. Agent skill: folders with a SKILL.md. They are instructions and templates for an agent, so nothing
  // has to run; the host imports them into its skill catalog. This runs before the web checks because a
  // skill repository often carries example pages that would otherwise look like an app.
  if (skillRoots.length > 0) {
    reasons.push(
      `Detected agent skill ${skillRoots.map((root) => (root === '' ? 'SKILL.md' : `${root}/SKILL.md`)).join(', ')}`
    );
    const permissions: string[] = [];
    const manifest: PackageManifest = {
      ...baseManifest(identity, 'agent-capsule'),
      modules: [],
      permissions,
      dependencies: [],
      tags: ['skill', 'agent-skill', 'agent-capsule'],
    };
    return {
      archetype: 'agent-skill',
      packageType: 'agent-capsule',
      suggestedId,
      name: displayName,
      description,
      reasons,
      permissions,
      isSupported: true,
      runnable: true,
      adminApprovalRequired: false,
      skillRoots,
      connections: skillConnections,
      manifest,
    };
  }

  // 2. Chat Stage Package Detection
  const hasChatStageFile = hasAnyFile(files, (f) => f.endsWith('chatstage.ts') || f.endsWith('stage.ts'));
  const hasChatStageSnippets = Object.values(snippets).some(
    (content) =>
      content.includes('IChatStage') ||
      content.includes('pre_query') ||
      content.includes('pre_model') ||
      content.includes('post_model')
  );

  if (hasChatStageFile || hasChatStageSnippets) {
    if (hasChatStageFile) reasons.push('Detected chat stage interface file');
    if (hasChatStageSnippets) reasons.push('Detected IChatStage or pipeline phase in code');

    const permissions = ['chat.stage'];
    const manifest: PackageManifest = {
      ...baseManifest(identity, 'agent-capsule'),
      modules: [placeholderModule(identity, 'chat-stage', 'stages')],
      permissions,
      dependencies: [],
      tags: ['chat-pipeline', 'stage', 'agent-capsule'],
    };

    return {
      archetype: 'chat-stage',
      packageType: 'agent-capsule',
      suggestedId,
      name: displayName,
      description,
      reasons,
      permissions,
      isSupported: true,
      runnable: false,
      runnableIssueCode: 'HOST_RUNTIME_MISSING',
      runnableIssue: HOST_RUNTIME_MISSING('a chat pipeline stage'),
      adminApprovalRequired: false,
      entrypoint: 'index.html',
      manifest,
    };
  }

  // 3. Workflow Capsule Detection (n8n-style deterministic + AI)
  const hasWorkflowJson = fileExists(files, 'workflow.json') || files.some((f) => f.includes('workflows/'));
  const hasWorkflowSnippets = Object.values(snippets).some(
    (content) => content.includes('"nodes"') && content.includes('"connections"')
  );

  if (hasWorkflowJson || hasWorkflowSnippets) {
    if (hasWorkflowJson) reasons.push('Detected workflow.json or workflow configuration directory');
    if (hasWorkflowSnippets) reasons.push('Detected automation pipeline graph nodes and connections');

    const permissions: string[] = [];
    const manifest: PackageManifest = {
      ...baseManifest(identity, 'agent-capsule'),
      modules: [placeholderModule(identity, 'workflow', 'workflows')],
      permissions,
      dependencies: [],
      tags: ['workflow', 'automation', 'capsule'],
    };

    return {
      archetype: 'workflow-capsule',
      packageType: 'agent-capsule',
      suggestedId,
      name: displayName,
      description,
      reasons,
      permissions,
      isSupported: true,
      runnable: false,
      runnableIssueCode: 'HOST_RUNTIME_MISSING',
      runnableIssue: HOST_RUNTIME_MISSING('an automation workflow'),
      adminApprovalRequired: false,
      entrypoint: 'index.html',
      manifest,
    };
  }

  // 4. UI Theme Detection: stylesheets (and their assets) only, with at least one stylesheet
  const THEME_ASSET_EXTENSIONS = ['.css', '.json', '.png', '.svg', '.jpg', '.jpeg', '.webp', '.gif', '.md', '.txt'];
  const hasStylesheet = files.some((f) => f.toLowerCase().endsWith('.css'));
  const isOnlyCssOrTheme =
    files.length > 0 &&
    hasStylesheet &&
    files.every((f) => {
      const lower = f.toLowerCase();
      return (
        THEME_ASSET_EXTENSIONS.some((extension) => lower.endsWith(extension)) ||
        lower.includes('uno.config') ||
        lower.includes('tailwind.config')
      );
    }) &&
    !fileExists(files, 'index.html');

  if (isOnlyCssOrTheme) {
    reasons.push('Repository consists solely of CSS, theme tokens, icons, and theme configuration');

    const permissions = ['ui.theme'];
    const manifest: PackageManifest = {
      ...baseManifest(identity, 'ui'),
      modules: [placeholderModule(identity, 'theme', 'themes')],
      contributions: {
        version: 1,
        themes: [{ id: cleanName, name: displayName, css: '/* Custom theme */' }],
      },
      permissions,
      dependencies: [],
      tags: ['theme', 'ui', 'appearance'],
    };

    return {
      archetype: 'ui-theme',
      packageType: 'ui',
      suggestedId,
      name: displayName,
      description,
      reasons,
      permissions,
      isSupported: true,
      runnable: true,
      adminApprovalRequired: false,
      entrypoint: 'index.html',
      manifest,
    };
  }

  // 5. Web Surface App / IDE Document Viewer
  const web = resolveWebEntrypoint(files, snippets);

  // 4b. A front end that is started from source (Next.js, Vite, Streamlit, Gradio, Flask…) with the back ends
  // beside it. The page is shown embedded; the rest is started for it. Anything not recognised (a mobile
  // app, data, notebooks) is left in source/ and simply not connected. A page that can be opened as it is
  // (a built site) is packaged the plain way below.
  const detection = detectServices(files, snippets, input.environmentUsage ?? []);
  if (detection.embed !== undefined && web.entrypoint === undefined) {
    for (const service of detection.services) {
      reasons.push(
        `Detected ${service.framework} service "${service.id}" in ${service.directory === '' ? '.' : service.directory}`
      );
    }
    reasons.push(...detection.notes);
    const openItems = openItemsFor(detection, connectionIdFor(identity.cleanName), files, skillRoots);
    const permissions: string[] = [];
    const manifest: PackageManifest = {
      ...baseManifest(identity, 'agent-capsule'),
      modules: [],
      permissions,
      dependencies: [],
      tags: ['web-embed', 'process', 'agent-capsule'],
    };
    return {
      archetype: 'web-service-app',
      packageType: 'agent-capsule',
      suggestedId,
      name: displayName,
      description,
      reasons,
      permissions,
      isSupported: true,
      runnable: true,
      adminApprovalRequired: true,
      ...(openItems.length > 0 ? { openItems } : {}),
      ...(skillRoots.length > 0 ? { skillRoots } : {}),
      connections: [
        {
          kind: 'web-embed' as const,
          id: connectionIdFor(identity.cleanName),
          title: displayName.slice(0, 120),
          process: {
            services: detection.services.map(serviceConnection),
            embed: { service: detection.embed },
          },
        },
        ...skillConnections,
      ],
      manifest,
    };
  }
  const hasWebFramework =
    deps.has('react') ||
    deps.has('vue') ||
    deps.has('svelte') ||
    deps.has('vite') ||
    deps.has('webpack') ||
    hasAnyFile(files, (f) => f.includes('vite.config') || f.includes('webpack.config'));

  if (web.entrypoint !== undefined || web.needsBuild || hasWebFramework) {
    const entrypoint = web.entrypoint ?? web.unbuiltEntrypoint ?? 'index.html';
    const runnable = web.entrypoint !== undefined;
    const issue = runnable
      ? undefined
      : web.needsBuild
        ? ({
            code: 'WEB_NEEDS_BUILD',
            message: `${web.unbuiltEntrypoint} loads source files (TypeScript, JSX or templates) that only work after a build step. Build the project, then package the output folder (for example with --path dist).`,
          } as const)
        : ({
            code: 'NO_WEB_ENTRYPOINT',
            message:
              'A web framework was detected but no page the sandbox can open was found: there is no index.html or committed build output (dist/, build/, docs/). Build the project and package the output folder.',
          } as const);

    const isViewer =
      cleanName.includes('viewer') ||
      cleanName.includes('editor') ||
      cleanName.includes('mermaid') ||
      cleanName.includes('sheet') ||
      cleanName.includes('three') ||
      cleanName.includes('preview');

    if (isViewer) {
      reasons.push('Detected document viewer or editor utility capable of embedding into IDE subtabs');

      const permissions = ['workspace.read'];
      const manifest: PackageManifest = {
        ...baseManifest(identity, 'ui'),
        modules: [
          {
            id: 'viewer',
            title: displayName,
            surface: `ide/viewers/${cleanName}`,
            pinnable: true,
            runtime: 'sandboxed-web',
            entrypoint,
          },
        ],
        contributions: {
          version: 1,
          ide: {
            hostApiVersion: '>=0.0.0',
            subtabs: [
              {
                id: cleanName,
                title: displayName,
                activityGroupId: 'codebase',
                moduleId: 'viewer',
                activation: 'on-open',
              },
            ],
          },
        },
        permissions,
        dependencies: [{ id: 'com.tomni.ide', version: '>=0.0.0' }],
        tags: ['ide', 'viewer', 'document-viewer'],
      };

      return {
        archetype: 'ide-viewer',
        packageType: 'ui',
        suggestedId,
        name: displayName,
        description,
        reasons,
        permissions,
        isSupported: true,
        runnable,
        ...(issue ? { runnableIssueCode: issue.code, runnableIssue: issue.message } : {}),
        adminApprovalRequired: false,
        entrypoint,
        manifest,
      };
    }

    if (web.entrypoint !== undefined) reasons.push(`Detected ${web.entrypoint} entrypoint`);
    if (hasWebFramework) reasons.push('Detected modern web application framework / bundler');

    const permissions: string[] = [];
    const manifest: PackageManifest = {
      ...baseManifest(identity, 'app'),
      modules: [
        {
          id: 'main',
          title: displayName,
          surface: `apps/${cleanName}`,
          pinnable: true,
          runtime: 'sandboxed-web',
          entrypoint,
        },
      ],
      contributions: {
        version: 1,
        apps: [{ id: 'main', title: displayName, moduleId: 'main' }],
      },
      permissions,
      dependencies: [],
      tags: ['app', 'web', 'tools'],
    };

    return {
      archetype: 'web-surface-app',
      packageType: 'app',
      suggestedId,
      name: displayName,
      description,
      reasons,
      permissions,
      isSupported: true,
      runnable,
      ...(issue ? { runnableIssueCode: issue.code, runnableIssue: issue.message } : {}),
      adminApprovalRequired: false,
      entrypoint,
      manifest,
    };
  }

  // 6. Service Daemon Detection
  const hasServerDeps = deps.has('express') || deps.has('fastify') || deps.has('koa') || deps.has('@nestjs/core');
  const hasServerSnippets = Object.values(snippets).some(
    (content) => content.includes('.listen(') || content.includes('createServer(')
  );

  if (hasServerDeps || hasServerSnippets) {
    if (hasServerDeps) reasons.push('Detected backend web server framework (Express/Fastify/Koa)');
    if (hasServerSnippets) reasons.push('Detected server socket or HTTP listener code');

    const permissions = ['network.listen', 'process.keepalive'];
    const manifest: PackageManifest = {
      ...baseManifest(identity, 'agent-capsule'),
      modules: [placeholderModule(identity, 'daemon', 'services')],
      permissions,
      dependencies: [],
      tags: ['daemon', 'service', 'server'],
    };

    return {
      archetype: 'service-daemon',
      packageType: 'agent-capsule',
      suggestedId,
      name: displayName,
      description,
      reasons,
      permissions,
      isSupported: true,
      runnable: false,
      runnableIssueCode: 'HOST_RUNTIME_MISSING',
      runnableIssue: HOST_RUNTIME_MISSING('a background service'),
      adminApprovalRequired: true,
      entrypoint: 'index.html',
      manifest,
    };
  }

  // 7. Unsupported Native / Kernel
  const hasOnlyCppOrNative =
    files.some((f) => f.endsWith('.cpp') || f.endsWith('.c') || f.endsWith('.h') || f.endsWith('.sys')) &&
    web.entrypoint === undefined &&
    !hasWebFramework &&
    !hasMcpJson &&
    !files.some((f) => OTHER_SOURCE_EXTENSIONS.some((extension) => f.toLowerCase().endsWith(extension)));

  if (hasOnlyCppOrNative) {
    reasons.push('Repository appears to be native C/C++ driver or kernel code without web/WASM interface');

    const permissions: string[] = [];
    const manifest: PackageManifest = {
      ...baseManifest(identity, 'agent-capsule'),
      modules: [],
      permissions,
      dependencies: [],
      tags: ['unsupported'],
    };

    return {
      archetype: 'unsupported-native',
      packageType: 'agent-capsule',
      suggestedId,
      name: displayName,
      description,
      reasons,
      permissions,
      isSupported: false,
      runnable: false,
      runnableIssueCode: 'UNSUPPORTED_NATIVE',
      runnableIssue: 'Native C/C++ code has no web or WebAssembly interface that the host can run.',
      adminApprovalRequired: true,
      manifest,
    };
  }

  // Fallback: nothing the host can run. Never invent a placeholder page.
  reasons.push('No web entry point, theme, or other runnable structure was found');
  const permissions: string[] = [];
  const manifest: PackageManifest = {
    ...baseManifest(identity, 'agent-capsule'),
    modules: [],
    permissions,
    dependencies: [],
    tags: ['source-only'],
  };

  return {
    archetype: 'source-only',
    packageType: 'agent-capsule',
    suggestedId,
    name: displayName,
    description,
    reasons,
    permissions,
    isSupported: false,
    runnable: false,
    runnableIssueCode: 'NO_WEB_ENTRYPOINT',
    runnableIssue:
      'No runnable entry point was found: the repository has no index.html or committed build output (dist/, build/, docs/), and this app version cannot run its language directly.',
    adminApprovalRequired: false,
    manifest,
  };
};

/**
 * Heuristically classifies a repository tree and its metadata into one of the canonical package
 * archetypes and derives a valid, least-privilege PackageManifest (schemaVersion 1). The result also
 * says whether this app version can host the package (`runnable`), so callers never ship a placeholder.
 *
 * The archetype, manifest and `runnable` come from the legacy rules and are not changed by the detectors: a
 * repository that only carries a `.mcp.json` stays what it was. The connections and open items come from running the
 * registered detectors (design section 7) and merging them with the legacy rules' own output, so a plugin, an MCP
 * configuration or a published MCP package is listed whatever the archetype is. Every high-signal declaration file
 * ends up as a connection or an open item (criterion C2).
 */
export const classifyRepository = (input: RepoClassificationInput): RepoClassificationResult => {
  const base = classifyArchetype(input);
  const detection = detectRepository({
    files: input.files, // normalized (separators, '..') by the inventory
    ...(input.packageJson === undefined ? {} : { packageJson: input.packageJson }),
    snippets: input.fileSnippets ?? {},
    findings: {
      connections: base.connections ?? [],
      openItems: base.openItems ?? [],
      skillRoots: base.skillRoots ?? [],
    },
  });
  const reasons = [...new Set([...base.reasons, ...detection.reasons])];
  // The merge sorts open items by content; the legacy rules' own items keep the order they were found in.
  const present = new Set(detection.openItems);
  const own = new Set(base.openItems);
  const openItems = [
    ...(base.openItems ?? []).filter((item) => present.has(item)),
    ...detection.openItems.filter((item) => !own.has(item)),
  ];
  return {
    ...base,
    reasons,
    ...(detection.connections.length > 0 || base.connections !== undefined
      ? { connections: detection.connections }
      : {}),
    ...(openItems.length > 0 ? { openItems } : {}),
    detectors: detection.detectors,
    archetypeLabel: detection.archetype,
  };
};
