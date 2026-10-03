import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createFirstPartyPackageCatalog } from '@/common/packages/catalog';
import { collectBaseArtifactInputsFromGraph } from '@/common/packages/optionalOwnership';

const PROJECT_ROOT = process.cwd();
const OPTIONAL_OWNERSHIP_AUDIT_PATH = 'tests/regression/wave0/optionalOwnership.test.ts';
const RENDERER_GRAPH_PATH = 'store-artifacts/base-renderer-metafile.json';
const MAIN_GRAPH_PATH = 'store-artifacts/base-main-metafile.json';

/**
 * These optional Surface implementations have no first-party catalog package
 * identity. This inventory records both legacy desktop roots and package-owned
 * roots; it does not claim that any root appears in the emitted base artifact.
 */
const UNCATALOGUED_OPTIONAL_SURFACES = [
  {
    packageId: 'com.tomni.company',
    sourceRoots: ['packages/desktop/src/process/company', 'packages/package-apps/company/src/renderer/company'],
    uncoveredAuditMarkers: ['@process/company'],
  },
  {
    packageId: 'com.tomni.knowledge',
    sourceRoots: ['packages/desktop/src/process/knowledge', 'packages/package-apps/knowledge/src/renderer/knowledge'],
    uncoveredAuditMarkers: ['@process/knowledge'],
  },

  {
    packageId: 'com.tomni.pet',
    sourceRoots: ['packages/desktop/src/process/pet', 'packages/package-apps/pet/src/renderer/PetPage.tsx'],
    uncoveredAuditMarkers: ['@process/pet'],
  },

  {
    packageId: 'com.tomni.makevideo',
    sourceRoots: ['packages/desktop/src/process/makevideo', 'packages/desktop/src/renderer/pages/studio/makevideo'],
    uncoveredAuditMarkers: ['@process/makevideo', '@renderer/pages/studio/makevideo'],
  },
  {
    packageId: 'com.tomni.monitor',
    sourceRoots: ['packages/desktop/src/process/monitor', 'packages/desktop/src/renderer/pages/monitor'],
    uncoveredAuditMarkers: ['@process/monitor', '@renderer/pages/monitor'],
  },
  {
    packageId: 'com.tomni.music',
    sourceRoots: ['packages/desktop/src/process/music', 'packages/desktop/src/renderer/pages/music'],
    uncoveredAuditMarkers: ['@renderer/pages/music'],
  },
] as const;

const readJson = (relativePath: string): unknown =>
  JSON.parse(readFileSync(resolve(PROJECT_ROOT, relativePath), 'utf8'));

describe('C0 optional Surface ownership inventory', () => {
  it('records optional Surface roots that the current first-party catalog and narrowed graph audit do not own', () => {
    const catalogPackageIds = createFirstPartyPackageCatalog()
      .map((entry) => entry.manifest.id)
      .toSorted();
    const ownershipAudit = readFileSync(resolve(PROJECT_ROOT, OPTIONAL_OWNERSHIP_AUDIT_PATH), 'utf8');

    expect(catalogPackageIds).toEqual([
      'com.tomni.calculator',
      'com.tomni.design-studio',
      'com.tomni.document-studio',
      'com.tomni.studio',
    ]);
    expect(UNCATALOGUED_OPTIONAL_SURFACES.map((surface) => surface.packageId)).toEqual([
      'com.tomni.company',
      'com.tomni.knowledge',

      'com.tomni.pet',
      'com.tomni.makevideo',
      'com.tomni.monitor',
      'com.tomni.music',
    ]);

    for (const surface of UNCATALOGUED_OPTIONAL_SURFACES) {
      expect(catalogPackageIds).not.toContain(surface.packageId);
      for (const root of surface.sourceRoots) {
        expect(existsSync(resolve(PROJECT_ROOT, root)), 'Known optional Surface source root is missing.').toBe(true);
      }
      for (const marker of surface.uncoveredAuditMarkers) {
        expect(ownershipAudit).not.toContain(marker);
      }
    }
  });

  it('treats the current graph audit as source-input evidence, not artifact or clean-base runtime proof', () => {
    for (const graphPath of [RENDERER_GRAPH_PATH, MAIN_GRAPH_PATH]) {
      expect(existsSync(resolve(PROJECT_ROOT, graphPath)), 'Missing current graph evidence.').toBe(true);

      const graph = readJson(graphPath);
      const inputs = collectBaseArtifactInputsFromGraph(graph);

      expect(inputs.length).toBeGreaterThan(0);
      expect(inputs.some((input) => input.startsWith('packages/desktop/src/'))).toBe(true);
      expect(JSON.stringify(graph)).not.toContain('app.asar');
    }
  });
});
