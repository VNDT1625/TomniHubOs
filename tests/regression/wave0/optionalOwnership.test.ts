import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createFirstPartyPackageCatalog } from '@/common/packages/catalog';
import {
  assertOptionalPackageOwnershipClean,
  collectBaseArtifactInputsFromGraph,
  createOptionalPackageOwnershipDenylist,
  createOptionalPackageOwnershipDenylistFromCatalog,
  scanOptionalPackageOwnership,
  type OptionalOwnershipSourceFile,
  type OptionalPackageOwnershipDeclaration,
} from '@/common/packages/optionalOwnership';

const IDE_OWNERSHIP: OptionalPackageOwnershipDeclaration = {
  // ponytail: default IDE coverage ends at direct base ownership; use a separate
  // default-surface manifest when the base bundle gains independently versioned modules.
  manifest: { id: 'com.tomni.legacy-ide-test' },
  importPathPrefixes: ['@renderer/package-apps/ide'],
  artifactPathPrefixes: ['packages/desktop/src/renderer/package-apps/ide'],
};

/** Studio-owned recent-file state is not a neutral Hub dependency. */
const STUDIO_RECENT_FILE_OWNERSHIP: OptionalPackageOwnershipDeclaration = {
  manifest: { id: 'com.tomni.studio' },
  importPathPrefixes: ['@package-apps/document-studio/renderer/studioStorage'],
  artifactPathPrefixes: ['packages/package-apps/document-studio/src/renderer/studioStorage.ts'],
};

const PROJECT_ROOT = process.cwd();
const RENDERER_SOURCE_ROOT = resolve(PROJECT_ROOT, 'packages/desktop/src/renderer');

const readRendererSourceFiles = (directory = RENDERER_SOURCE_ROOT): OptionalOwnershipSourceFile[] =>
  readdirSync(directory, { withFileTypes: true })
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry): OptionalOwnershipSourceFile[] => {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) return readRendererSourceFiles(absolutePath);
      if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) return [];
      return [
        {
          path: relative(PROJECT_ROOT, absolutePath).replaceAll('\\', '/'),
          content: readFileSync(absolutePath, 'utf8'),
        },
      ];
    });

const LEGACY_OPTIONAL_ROOTS = [] as const;

/** Relocated optional source must remain absent from both emitted base graphs. */
const EXTRACTED_OPTIONAL_OWNERSHIP: readonly OptionalPackageOwnershipDeclaration[] = [
  {
    manifest: { id: 'com.tomni.design-studio' },
    importPathPrefixes: ['@package-apps/design'],
    artifactPathPrefixes: ['packages/package-apps/design'],
  },
  {
    manifest: { id: 'com.tomni.document-studio' },
    importPathPrefixes: ['@package-apps/document-studio'],
    artifactPathPrefixes: ['packages/package-apps/document-studio'],
  },
];

/** Optional domains that must not be emitted by a clean MVP base candidate. */
const MVP_BASE_OPTIONAL_OWNERSHIP: readonly OptionalPackageOwnershipDeclaration[] = [
  ...EXTRACTED_OPTIONAL_OWNERSHIP,
  {
    manifest: { id: 'com.tomni.testing' },
    importPathPrefixes: ['@renderer/pages/testing'],
    artifactPathPrefixes: ['packages/desktop/src/renderer/pages/testing'],
  },
];

const RELEASE_GRAPH_PATH = resolve(PROJECT_ROOT, 'store-artifacts/base-renderer-metafile.json');
const MAIN_RELEASE_GRAPH_PATH = resolve(PROJECT_ROOT, 'store-artifacts/base-main-metafile.json');

const readRendererGraphSourceFiles = (inputs: readonly string[]): OptionalOwnershipSourceFile[] =>
  inputs.flatMap((input): OptionalOwnershipSourceFile[] => {
    if (!input.startsWith('packages/desktop/src/renderer/') || !/\.(?:ts|tsx)$/.test(input)) return [];
    const absolutePath = resolve(PROJECT_ROOT, input);
    return existsSync(absolutePath) ? [{ path: input, content: readFileSync(absolutePath, 'utf8') }] : [];
  });

const readMainGraphSourceFiles = (inputs: readonly string[]): OptionalOwnershipSourceFile[] =>
  inputs.flatMap((input): OptionalOwnershipSourceFile[] => {
    if (!input.startsWith('packages/desktop/src/') || !/\.(?:ts|tsx)$/.test(input)) return [];
    const absolutePath = resolve(PROJECT_ROOT, input);
    return existsSync(absolutePath) ? [{ path: input, content: readFileSync(absolutePath, 'utf8') }] : [];
  });

const MVP_MAIN_OPTIONAL_OWNERSHIP: readonly OptionalPackageOwnershipDeclaration[] = [
  ...EXTRACTED_OPTIONAL_OWNERSHIP,

  {
    manifest: { id: 'com.tomni.office' },
    importPathPrefixes: ['@process/office'],
    artifactPathPrefixes: ['packages/desktop/src/process/office'],
  },
  {
    manifest: { id: 'com.tomni.music' },
    importPathPrefixes: ['@process/music'],
    artifactPathPrefixes: ['packages/desktop/src/process/music'],
  },
];

describe('optional package ownership audit', () => {
  it('allows core-only imports and artifact inputs', () => {
    const result = scanOptionalPackageOwnership({
      denylist: createOptionalPackageOwnershipDenylist([IDE_OWNERSHIP]),
      coreSourceFiles: [
        {
          path: 'packages/desktop/src/renderer/hub/HubPage.tsx',
          content: "import { runGoal } from '@renderer/hub/runGoal';",
        },
      ],
      baseArtifactInputs: ['packages/desktop/src/renderer/hub/runGoal.ts'],
    });

    expect(result.violations).toEqual([]);
  });

  it('reports static, dynamic, and require imports plus optional ownership in the base artifact', () => {
    const result = scanOptionalPackageOwnership({
      denylist: createOptionalPackageOwnershipDenylist([IDE_OWNERSHIP]),
      coreSourceFiles: [
        {
          path: 'packages/desktop/src/renderer/hub/HubPage.tsx',
          content: `
            import { IdePage } from '@renderer/package-apps/ide';
            export { default as IDE } from '@package-apps/ide/renderer/IdeWorkspace';
            const loadIde = () => import('@renderer/package-apps/ide/lazy');
            const legacyIde = require('@renderer/pages/studio/ide/legacy');
          `,
        },
      ],
      baseArtifactInputs: [
        'packages/desktop/src/renderer/package-apps/ide/index.tsx',
        'packages/desktop/src/renderer/hub/HubPage.tsx',
      ],
    });

    expect(result.violations).toEqual([
      {
        kind: 'base-artifact-owns-optional-package',
        packageId: 'com.tomni.legacy-ide-test',
        path: 'packages/desktop/src/renderer/package-apps/ide/index.tsx',
        referencedPath: 'packages/desktop/src/renderer/package-apps/ide/index.tsx',
      },
      {
        kind: 'core-imports-optional-package',
        packageId: 'com.tomni.legacy-ide-test',
        path: 'packages/desktop/src/renderer/hub/HubPage.tsx',
        referencedPath: '@renderer/package-apps/ide',
      },
      {
        kind: 'core-imports-optional-package',
        packageId: 'com.tomni.legacy-ide-test',
        path: 'packages/desktop/src/renderer/hub/HubPage.tsx',
        referencedPath: '@renderer/package-apps/ide/lazy',
      },
    ]);
  });

  it('derives future optional ownership from its manifest declaration without a hard-coded package ID', () => {
    const futurePackage: OptionalPackageOwnershipDeclaration = {
      manifest: { id: 'com.tomni.workspace-lab' },
      importPathPrefixes: ['@renderer/package-apps/workspace-lab'],
      artifactPathPrefixes: ['packages/desktop/src/renderer/package-apps/workspace-lab'],
    };

    const result = scanOptionalPackageOwnership({
      denylist: createOptionalPackageOwnershipDenylist([futurePackage]),
      coreSourceFiles: [
        {
          path: 'packages/desktop/src/renderer/hub/HubPage.tsx',
          content: "import WorkspaceLab from '@renderer/package-apps/workspace-lab';",
        },
      ],
      baseArtifactInputs: ['packages/desktop/src/renderer/package-apps/workspace-lab/index.tsx'],
    });

    expect(result.violations.map((violation) => violation.packageId)).toEqual([
      'com.tomni.workspace-lab',
      'com.tomni.workspace-lab',
    ]);
  });

  it('derives package-app ownership from the actual first-party catalog manifests', () => {
    const denylist = createOptionalPackageOwnershipDenylistFromCatalog(createFirstPartyPackageCatalog());
    const result = scanOptionalPackageOwnership({
      denylist,
      coreSourceFiles: [
        {
          path: 'packages/desktop/src/renderer/hub/HubPage.tsx',
          content: `import IdeWorkspace from '@renderer/package-apps/ide';`,
        },
      ],
      baseArtifactInputs: ['packages/desktop/src/renderer/package-apps/ide.tsx'],
    });

    expect(denylist.owners.find((owner) => owner.packageId === 'com.tomni.ide')).toBeUndefined();
    expect(result.violations).toEqual([]);
  });

  it('forbids Studio recent-file storage from a base source graph or artifact input', () => {
    const result = scanOptionalPackageOwnership({
      denylist: createOptionalPackageOwnershipDenylist([STUDIO_RECENT_FILE_OWNERSHIP]),
      coreSourceFiles: [
        {
          path: 'packages/desktop/src/renderer/pages/hub/HubWorkspacePage.tsx',
          content: "import { getRecentFiles } from '@package-apps/document-studio/renderer/studioStorage';",
        },
      ],
      baseArtifactInputs: [
        'packages/desktop/src/renderer/pages/hub/HubWorkspacePage.tsx',
        ...STUDIO_RECENT_FILE_OWNERSHIP.artifactPathPrefixes,
      ],
    });

    expect(result.violations).toEqual([
      {
        kind: 'base-artifact-owns-optional-package',
        packageId: 'com.tomni.studio',
        path: 'packages/package-apps/document-studio/src/renderer/studioStorage.ts',
        referencedPath: 'packages/package-apps/document-studio/src/renderer/studioStorage.ts',
      },
      {
        kind: 'core-imports-optional-package',
        packageId: 'com.tomni.studio',
        path: 'packages/desktop/src/renderer/pages/hub/HubWorkspacePage.tsx',
        referencedPath: '@package-apps/document-studio/renderer/studioStorage',
      },
    ]);
    expect(() => assertOptionalPackageOwnershipClean(result)).toThrow('Optional package ownership audit failed:');
  });

  it('keeps base Workspace free of direct optional Browser and editor runner imports', () => {
    const workspaceBridgePath = 'packages/desktop/src/process/workspace/workspaceBridge.ts';
    const workspaceFramePath = 'packages/desktop/src/renderer/pages/workspace/components/SurfaceFrame.tsx';
    const workspaceBridgeSource = readFileSync(resolve(PROJECT_ROOT, workspaceBridgePath), 'utf8');
    const workspaceFrameSource = readFileSync(resolve(PROJECT_ROOT, workspaceFramePath), 'utf8');
    const result = scanOptionalPackageOwnership({
      denylist: createOptionalPackageOwnershipDenylist(MVP_MAIN_OPTIONAL_OWNERSHIP),
      coreSourceFiles: [
        {
          path: workspaceBridgePath,
          content: workspaceBridgeSource,
        },
      ],
      baseArtifactInputs: [],
    });

    expect(result.violations).toEqual([]);
    expect(() => assertOptionalPackageOwnershipClean(result)).not.toThrow();
    expect(workspaceBridgeSource).not.toContain("from './browserSurfaceRunner'");
    expect(workspaceBridgeSource).not.toContain("from './editorAgentRunner'");
    expect(workspaceBridgeSource).not.toContain("from '@process/resources/nativeFileGateway'");

    const rendererResult = scanOptionalPackageOwnership({
      denylist: createOptionalPackageOwnershipDenylist(MVP_BASE_OPTIONAL_OWNERSHIP),
      coreSourceFiles: [{ path: workspaceFramePath, content: workspaceFrameSource }],
      baseArtifactInputs: [],
    });
    expect(rendererResult.violations).toEqual([]);
    expect(workspaceFrameSource).not.toContain("from './BrowserSurfaceView'");
    expect(workspaceFrameSource).not.toContain("from './EditorSurfaceView'");
  });

  it('keeps base Conversation free of direct optional Surface and secret-rendering clients', () => {
    const conversationFiles = readRendererSourceFiles().filter((file) =>
      file.path.startsWith('packages/desktop/src/renderer/pages/conversation/')
    );
    const forbiddenImports = [
      '@renderer/services/coreIdeClient',
      '@/renderer/services/coreIdeClient',
      '@renderer/services/planningGuard',
      '@/renderer/services/planningGuard',
      '@renderer/pages/browser',
      '@/renderer/pages/browser',
      '@renderer/pages/studio/ide',
      '@/renderer/pages/studio/ide',
    ];
    const offenders = conversationFiles.flatMap((file) =>
      forbiddenImports.some((specifier) => file.content.includes(specifier)) ? [file.path] : []
    );

    expect(offenders).toEqual([]);
  });

  it('parses Vite/Rollup and esbuild graph module inputs without accepting an empty graph', () => {
    expect(
      collectBaseArtifactInputsFromGraph({
        inputs: { 'packages/desktop/src/renderer/package-apps/ide.tsx': {} },
        outputs: {
          'assets/app.js': {
            modules: { 'packages/package-apps/ide/src/renderer/IdeWorkspace.tsx': {} },
          },
        },
      })
    ).toEqual([
      'packages/desktop/src/renderer/package-apps/ide.tsx',
      'packages/package-apps/ide/src/renderer/IdeWorkspace.tsx',
    ]);
    expect(() => collectBaseArtifactInputsFromGraph({ outputs: {} })).toThrow(
      'Base artifact graph must expose input or output module paths.'
    );
  });

  it('keeps extracted IDE entry, client, planning guard, and code adapter out of the base-source baseline while rejecting remaining IDE residue', () => {
    const sourceFiles = readRendererSourceFiles();
    const result = scanOptionalPackageOwnership({
      denylist: createOptionalPackageOwnershipDenylistFromCatalog(
        createFirstPartyPackageCatalog(),
        LEGACY_OPTIONAL_ROOTS
      ),
      coreSourceFiles: sourceFiles,
      // The committed renderer source is a conservative base-input baseline.
      // A release gate must additionally feed the exact emitted candidate graph.
      baseArtifactInputs: sourceFiles.map((source) => source.path),
    });

    expect(sourceFiles.some(({ path }) => path === 'packages/desktop/src/renderer/package-apps/ide.tsx')).toBe(false);
    expect(
      sourceFiles.some(({ path }) => path === 'packages/desktop/src/renderer/pages/editor/adapters/TextCodeAdapter.tsx')
    ).toBe(false);
    expect(sourceFiles.some(({ path }) => path === 'packages/desktop/src/renderer/services/coreIdeClient.ts')).toBe(
      false
    );
    expect(sourceFiles.some(({ path }) => path === 'packages/desktop/src/renderer/services/planningGuard.ts')).toBe(
      false
    );
    expect(existsSync(resolve(PROJECT_ROOT, 'packages/package-apps/ide/src/entry.tsx'))).toBe(true);
    expect(existsSync(resolve(PROJECT_ROOT, 'packages/package-apps/ide/src/TextCodeAdapter.tsx'))).toBe(true);
    expect(existsSync(resolve(PROJECT_ROOT, 'packages/package-apps/ide/src/coreIdeClient.ts'))).toBe(true);
    expect(existsSync(resolve(PROJECT_ROOT, 'packages/package-apps/ide/src/planningGuard.ts'))).toBe(true);
    expect(existsSync(resolve(PROJECT_ROOT, 'packages/desktop/src/renderer/pages/studio/ide/Viu'))).toBe(false);
    expect(
      existsSync(resolve(PROJECT_ROOT, 'packages/package-apps/design/src/renderer/viu/next/ViuNextCanvas.tsx'))
    ).toBe(true);
    expect(
      readFileSync(resolve(PROJECT_ROOT, 'packages/package-apps/ide/src/renderer/IdeWorkspace.tsx'), 'utf8')
    ).not.toContain("from './Viu'");
    expect(
      readFileSync(resolve(PROJECT_ROOT, 'packages/package-apps/design/src/renderer/index.tsx'), 'utf8')
    ).not.toContain('@renderer/pages/studio/ide/Viu');
    expect(
      result.violations.some(
        (violation) =>
          violation.kind === 'base-artifact-owns-optional-package' && violation.packageId === 'com.tomni.ide'
      )
    ).toBe(false);
    expect(result.violations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'packages/desktop/src/renderer/package-apps/ide.tsx' }),
        expect.objectContaining({ path: 'packages/desktop/src/renderer/pages/editor/adapters/TextCodeAdapter.tsx' }),
      ])
    );
    expect(() => assertOptionalPackageOwnershipClean(result)).toThrow('Optional package ownership audit failed:');
  });

  it('rejects optional domains from the exact emitted base graph when release evidence is present', () => {
    const required = process.env.TOMNI_REQUIRE_RELEASE_ARTIFACT_AUDIT === '1';
    if (!required) return;
    if (!existsSync(RELEASE_GRAPH_PATH)) {
      expect(required, 'release audit requires a freshly emitted base graph').toBe(false);
      return;
    }

    const inputs = collectBaseArtifactInputsFromGraph(JSON.parse(readFileSync(RELEASE_GRAPH_PATH, 'utf8')));
    const result = scanOptionalPackageOwnership({
      denylist: createOptionalPackageOwnershipDenylist(MVP_BASE_OPTIONAL_OWNERSHIP),
      coreSourceFiles: readRendererGraphSourceFiles(inputs),
      baseArtifactInputs: inputs,
    });

    expect(result.violations).toEqual([]);
    expect(() => assertOptionalPackageOwnershipClean(result)).not.toThrow();
  });

  it('rejects optional domains from the exact emitted main-process graph when release evidence is present', () => {
    const required = process.env.TOMNI_REQUIRE_RELEASE_ARTIFACT_AUDIT === '1';
    if (!required) return;
    if (!existsSync(MAIN_RELEASE_GRAPH_PATH)) {
      expect(required, 'release audit requires a freshly emitted main-process graph').toBe(false);
      return;
    }

    const inputs = collectBaseArtifactInputsFromGraph(JSON.parse(readFileSync(MAIN_RELEASE_GRAPH_PATH, 'utf8')));
    const result = scanOptionalPackageOwnership({
      denylist: createOptionalPackageOwnershipDenylist(MVP_MAIN_OPTIONAL_OWNERSHIP),
      coreSourceFiles: readMainGraphSourceFiles(inputs),
      baseArtifactInputs: inputs,
    });

    expect(result.violations).toEqual([]);
    expect(() => assertOptionalPackageOwnershipClean(result)).not.toThrow();
  });
});
