/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import semver from 'semver';
import type { PackageManifest, PackageModuleContribution, PackageType } from './types';

/**
 * 7 canonical package archetypes defined in docs/platform/package-taxonomy.md
 * plus unsupported archetype for safe rejection.
 */
export type RepoArchetype =
  | 'web-surface-app'
  | 'ui-theme'
  | 'ide-viewer'
  | 'chat-stage'
  | 'mcp-tool-server'
  | 'workflow-capsule'
  | 'service-daemon'
  | 'unsupported-native';

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
};

export type RepoClassificationResult = {
  readonly archetype: RepoArchetype;
  readonly packageType: PackageType;
  readonly suggestedId: string;
  readonly name: string;
  readonly description: string;
  readonly reasons: readonly string[];
  readonly permissions: readonly string[];
  readonly isSupported: boolean;
  readonly adminApprovalRequired: boolean;
  readonly entrypoint?: string;
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

const fileExists = (files: readonly string[], target: string): boolean => {
  const normalized = target.toLowerCase();
  return files.some((file) => file.toLowerCase() === normalized);
};

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

/**
 * Heuristically classifies a repository tree and its metadata into one of the 7 canonical
 * package archetypes and derives a valid, least-privilege PackageManifest (schemaVersion 1).
 */
export const classifyRepository = (input: RepoClassificationInput): RepoClassificationResult => {
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

  const reasons: string[] = [];

  // 1. MCP Tool Server Detection
  const hasMcpJson = fileExists(files, 'mcp.json') || files.some((f) => f.includes('/mcp.json'));
  const hasMcpSdk = deps.has('@modelcontextprotocol/sdk') || deps.has('@modelcontextprotocol/server');
  const hasMcpSnippets = Object.values(snippets).some(
    (content) => content.includes('@modelcontextprotocol/sdk') || content.includes('Server("')
  );

  if (hasMcpJson || hasMcpSdk || hasMcpSnippets) {
    if (hasMcpJson) reasons.push('Detected mcp.json configuration file');
    if (hasMcpSdk) reasons.push('Detected @modelcontextprotocol/sdk in dependencies');
    if (hasMcpSnippets) reasons.push('Detected Model Context Protocol Server instantiation in code');

    const permissions = ['mcp.tool'];
    const manifest: PackageManifest = {
      schemaVersion: 1,
      id: suggestedId,
      publisherId,
      name: displayName,
      description,
      type: 'agent-capsule',
      bundleKind: 'single',
      version,
      engines: { tomni: '>=0.0.0' },
      modules: [
        {
          id: 'mcp-server',
          title: displayName,
          surface: `capsules/${cleanName}`,
          pinnable: false,
          runtime: 'sandboxed-web',
          entrypoint: 'index.html',
        },
      ],
      permissions,
      dependencies: [],
      tags: ['mcp', 'tool-server', 'agent-capsule'],
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
      adminApprovalRequired: false,
      entrypoint: 'index.html',
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
      schemaVersion: 1,
      id: suggestedId,
      publisherId,
      name: displayName,
      description,
      type: 'agent-capsule',
      bundleKind: 'single',
      version,
      engines: { tomni: '>=0.0.0' },
      modules: [
        {
          id: 'chat-stage',
          title: displayName,
          surface: `stages/${cleanName}`,
          pinnable: false,
          runtime: 'sandboxed-web',
          entrypoint: 'index.html',
        },
      ],
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
      schemaVersion: 1,
      id: suggestedId,
      publisherId,
      name: displayName,
      description,
      type: 'agent-capsule',
      bundleKind: 'single',
      version,
      engines: { tomni: '>=0.0.0' },
      modules: [
        {
          id: 'workflow',
          title: displayName,
          surface: `workflows/${cleanName}`,
          pinnable: false,
          runtime: 'sandboxed-web',
          entrypoint: 'index.html',
        },
      ],
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
      adminApprovalRequired: false,
      entrypoint: 'index.html',
      manifest,
    };
  }

  // 4. UI Theme & Shell Detection
  const isOnlyCssOrTheme =
    files.length > 0 &&
    files.every(
      (f) =>
        f.endsWith('.css') ||
        f.endsWith('.scss') ||
        f.endsWith('.less') ||
        f.endsWith('.json') ||
        f.endsWith('.png') ||
        f.endsWith('.svg') ||
        f.endsWith('.md') ||
        f.includes('theme') ||
        f.includes('uno.config') ||
        f.includes('tailwind.config')
    ) &&
    !fileExists(files, 'index.html');

  if (isOnlyCssOrTheme) {
    reasons.push('Repository consists solely of CSS, theme tokens, icons, and theme configuration');

    const permissions = ['ui.theme'];
    const manifest: PackageManifest = {
      schemaVersion: 1,
      id: suggestedId,
      publisherId,
      name: displayName,
      description,
      type: 'ui',
      bundleKind: 'single',
      version,
      engines: { tomni: '>=0.0.0' },
      modules: [
        {
          id: 'theme',
          title: displayName,
          surface: `themes/${cleanName}`,
          pinnable: false,
          runtime: 'sandboxed-web',
          entrypoint: 'index.html',
        },
      ],
      contributions: {
        version: 1,
        themes: [
          {
            id: cleanName,
            name: displayName,
            css: '/* Custom theme */',
          },
        ],
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
      adminApprovalRequired: false,
      entrypoint: 'index.html',
      manifest,
    };
  }

  // 5. Check for Web Surface App / IDE Document Viewer
  const hasIndexHtml =
    fileExists(files, 'index.html') || fileExists(files, 'dist/index.html') || fileExists(files, 'public/index.html');
  const hasWebFramework =
    deps.has('react') ||
    deps.has('vue') ||
    deps.has('svelte') ||
    deps.has('vite') ||
    deps.has('webpack') ||
    hasAnyFile(files, (f) => f.includes('vite.config') || f.includes('webpack.config'));

  if (hasIndexHtml || hasWebFramework) {
    // Check if it's an IDE Document Viewer
    const isViewer =
      cleanName.includes('viewer') ||
      cleanName.includes('editor') ||
      cleanName.includes('mermaid') ||
      cleanName.includes('sheet') ||
      cleanName.includes('three') ||
      cleanName.includes('preview');

    if (isViewer) {
      reasons.push('Detected document viewer or editor utility capable of embedding into IDE subtabs');

      const entrypoint = fileExists(files, 'dist/index.html') ? 'dist/index.html' : 'index.html';
      const permissions = ['workspace.read'];
      const manifest: PackageManifest = {
        schemaVersion: 1,
        id: suggestedId,
        publisherId,
        name: displayName,
        description,
        type: 'ui',
        bundleKind: 'single',
        version,
        engines: { tomni: '>=0.0.0' },
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
            hostApiVersion: '>=1.0.0',
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
        dependencies: [{ id: 'com.tomni.ide', version: '>=1.0.0' }],
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
        adminApprovalRequired: false,
        entrypoint,
        manifest,
      };
    }

    // Standard Web Surface App
    if (hasIndexHtml) reasons.push('Detected index.html entrypoint');
    if (hasWebFramework) reasons.push('Detected modern web application framework / bundler');

    const entrypoint = fileExists(files, 'dist/index.html') ? 'dist/index.html' : 'index.html';
    const permissions: string[] = [];
    const manifest: PackageManifest = {
      schemaVersion: 1,
      id: suggestedId,
      publisherId,
      name: displayName,
      description,
      type: 'app',
      bundleKind: 'single',
      version,
      engines: { tomni: '>=0.0.0' },
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
        apps: [
          {
            id: 'main',
            title: displayName,
            moduleId: 'main',
          },
        ],
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
      schemaVersion: 1,
      id: suggestedId,
      publisherId,
      name: displayName,
      description,
      type: 'agent-capsule',
      bundleKind: 'single',
      version,
      engines: { tomni: '>=0.0.0' },
      modules: [
        {
          id: 'daemon',
          title: displayName,
          surface: `services/${cleanName}`,
          pinnable: false,
          runtime: 'sandboxed-web',
          entrypoint: 'index.html',
        },
      ],
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
      adminApprovalRequired: true,
      entrypoint: 'index.html',
      manifest,
    };
  }

  // 7. Unsupported Native / Kernel
  const hasOnlyCppOrNative =
    files.some((f) => f.endsWith('.cpp') || f.endsWith('.c') || f.endsWith('.h') || f.endsWith('.sys')) &&
    !hasIndexHtml &&
    !hasWebFramework &&
    !hasMcpJson;

  if (hasOnlyCppOrNative) {
    reasons.push('Repository appears to be native C/C++ driver or kernel code without web/WASM interface');

    const permissions: string[] = [];
    const manifest: PackageManifest = {
      schemaVersion: 1,
      id: suggestedId,
      publisherId,
      name: displayName,
      description,
      type: 'agent-capsule',
      bundleKind: 'single',
      version,
      engines: { tomni: '>=0.0.0' },
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
      adminApprovalRequired: true,
      manifest,
    };
  }

  // Fallback: Default to Web Surface App (or agent-capsule)
  reasons.push(
    'Generic repository without specific framework markers; classified as Web Surface App with zero-permission'
  );
  const permissions: string[] = [];
  const manifest: PackageManifest = {
    schemaVersion: 1,
    id: suggestedId,
    publisherId,
    name: displayName,
    description,
    type: 'app',
    bundleKind: 'single',
    version,
    engines: { tomni: '>=0.0.0' },
    modules: [
      {
        id: 'main',
        title: displayName,
        surface: `apps/${cleanName}`,
        pinnable: true,
        runtime: 'sandboxed-web',
        entrypoint: 'index.html',
      },
    ],
    contributions: {
      version: 1,
      apps: [
        {
          id: 'main',
          title: displayName,
          moduleId: 'main',
        },
      ],
    },
    permissions,
    dependencies: [],
    tags: ['app', 'community'],
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
    adminApprovalRequired: false,
    entrypoint: 'index.html',
    manifest,
  };
};
