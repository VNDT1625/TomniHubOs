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
  manifest: { id: 'com.tomni.ide' },
  importPathPrefixes: ['@renderer/package-apps/ide', '@renderer/pages/studio/ide'],
  artifactPathPrefixes: [
    'packages/desktop/src/renderer/package-apps/ide',
    'packages/desktop/src/renderer/pages/studio/ide',
  ],
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

const LEGACY_OPTIONAL_ROOTS = [
  {
    moduleId: 'ide',
    importPathPrefixes: ['@renderer/pages/studio/ide'],
    artifactPathPrefixes: ['packages/desktop/src/renderer/pages/studio/ide'],
  },
] as const;

/** Optional domains that must not be emitted by a clean MVP base candidate. */
const MVP_BASE_OPTIONAL_OWNERSHIP: readonly OptionalPackageOwnershipDeclaration[] = [
  IDE_OWNERSHIP,
  {
    manifest: { id: 'com.tomni.browser' },
    importPathPrefixes: ['@renderer/pages/browser'],
    artifactPathPrefixes: ['packages/desktop/src/renderer/pages/browser'],
  },
  {
    manifest: { id: 'com.tomni.terminal' },
    importPathPrefixes: ['@renderer/pages/terminal'],
    artifactPathPrefixes: ['packages/desktop/src/renderer/pages/terminal'],
  },
  {
    manifest: { id: 'com.tomni.testing' },
    importPathPrefixes: ['@renderer/pages/testing'],
    artifactPathPrefixes: ['packages/desktop/src/renderer/pages/testing'],
  },
];

const RELEASE_GRAPH_PATH = resolve(PROJECT_ROOT, 'store-artifacts/base-renderer-metafile.json');

const readRendererGraphSourceFiles = (inputs: readonly string[]): OptionalOwnershipSourceFile[] =>
  inputs.flatMap((input): OptionalOwnershipSourceFile[] => {
    if (!input.startsWith('packages/desktop/src/renderer/') || !/\.(?:ts|tsx)$/.test(input)) return [];
    const absolutePath = resolve(PROJECT_ROOT, input);
    return existsSync(absolutePath) ? [{ path: input, content: readFileSync(absolutePath, 'utf8') }] : [];
  });

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
            export { default as IDE } from '@renderer/pages/studio/ide/IdeWorkspace';
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
        packageId: 'com.tomni.ide',
        path: 'packages/desktop/src/renderer/package-apps/ide/index.tsx',
        referencedPath: 'packages/desktop/src/renderer/package-apps/ide/index.tsx',
      },
      {
        kind: 'core-imports-optional-package',
        packageId: 'com.tomni.ide',
        path: 'packages/desktop/src/renderer/hub/HubPage.tsx',
        referencedPath: '@renderer/package-apps/ide',
      },
      {
        kind: 'core-imports-optional-package',
        packageId: 'com.tomni.ide',
        path: 'packages/desktop/src/renderer/hub/HubPage.tsx',
        referencedPath: '@renderer/package-apps/ide/lazy',
      },
      {
        kind: 'core-imports-optional-package',
        packageId: 'com.tomni.ide',
        path: 'packages/desktop/src/renderer/hub/HubPage.tsx',
        referencedPath: '@renderer/pages/studio/ide/IdeWorkspace',
      },
      {
        kind: 'core-imports-optional-package',
        packageId: 'com.tomni.ide',
        path: 'packages/desktop/src/renderer/hub/HubPage.tsx',
        referencedPath: '@renderer/pages/studio/ide/legacy',
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

    expect(denylist.owners.find((owner) => owner.packageId === 'com.tomni.ide')).toMatchObject({
      importPathPrefixes: expect.arrayContaining(['@renderer/package-apps/ide']),
    });
    expect(result.violations.map((violation) => violation.packageId)).toEqual(['com.tomni.ide', 'com.tomni.ide']);
  });

  it('parses Vite/Rollup and esbuild graph module inputs without accepting an empty graph', () => {
    expect(
      collectBaseArtifactInputsFromGraph({
        inputs: { 'packages/desktop/src/renderer/package-apps/ide.tsx': {} },
        outputs: {
          'assets/app.js': {
            modules: { 'packages/desktop/src/renderer/pages/studio/ide/IdeWorkspace.tsx': {} },
          },
        },
      })
    ).toEqual([
      'packages/desktop/src/renderer/package-apps/ide.tsx',
      'packages/desktop/src/renderer/pages/studio/ide/IdeWorkspace.tsx',
    ]);
    expect(() => collectBaseArtifactInputsFromGraph({ outputs: {} })).toThrow(
      'Base artifact graph must expose input or output module paths.'
    );
  });

  it('reports the current base-source extraction gap and rejects it at the ownership gate', () => {
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

    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'base-artifact-owns-optional-package',
          packageId: 'com.tomni.ide',
          path: 'packages/desktop/src/renderer/package-apps/ide.tsx',
        }),
        expect.objectContaining({
          kind: 'core-imports-optional-package',
          packageId: 'com.tomni.ide',
          path: 'packages/desktop/src/renderer/pages/editor/adapters/TextCodeAdapter.tsx',
          referencedPath: '@renderer/pages/studio/ide/codeRelations',
        }),
      ])
    );
    expect(() => assertOptionalPackageOwnershipClean(result)).toThrow('Optional package ownership audit failed:');
  });

  it('rejects optional domains from the exact emitted base graph when release evidence is present', () => {
    const required = process.env.TOMNI_REQUIRE_RELEASE_ARTIFACT_AUDIT === '1';
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
});
