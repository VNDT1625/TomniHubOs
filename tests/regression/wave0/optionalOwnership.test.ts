import { describe, expect, it } from 'vitest';

import {
  createOptionalPackageOwnershipDenylist,
  scanOptionalPackageOwnership,
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
});
